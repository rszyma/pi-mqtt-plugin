import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import { loadMqttSettings, resolveConfig, sanitizeMqttConfig } from "./config.js";
import { MqttService } from "./mqtt-service.js";
import { StateManager } from "./state.js";
import type { MqttPluginConfig } from "./types.js";

function readJsonFile(filePath: string): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(filePath)) return {};
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function writeJsonFile(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

export default function homeAssistantMqttExtension(
  pi: ExtensionAPI,
  customConfig?: Partial<MqttPluginConfig>,
): void {
  let config: MqttPluginConfig | null = null;
  let stateManager: StateManager | null = null;
  let mqttService: MqttService | null = null;

  let globalSettingsPath: string | undefined;
  let projectSettingsPath: string | undefined;
  let lastLoadError: string | undefined;

  function loadSettings(ctx: { cwd: string }): { loadError: string | undefined } {
    const agentDir = getAgentDir();
    globalSettingsPath = path.join(agentDir, "settings.json");
    projectSettingsPath = path.join(ctx.cwd, ".pi", "settings.json");
    const { loadError } = loadMqttSettings(ctx.cwd, agentDir);
    lastLoadError = loadError;
    return { loadError };
  }

  pi.on("session_start", async (_event, ctx) => {
    const { loadError } = loadSettings(ctx);
    if (loadError && ctx.hasUI) {
      ctx.ui.notify(lastLoadError!, "warning");
    }
    config = resolveConfig(ctx.cwd, customConfig);
    stateManager = new StateManager(config);

    const sessionFile = ctx.sessionManager.getSessionFile();
    const sessionId = ctx.sessionManager.getSessionId();
    stateManager.setSession(
      sessionFile ? (sessionFile.split("/").pop() ?? sessionId) : sessionId,
    );

    if (ctx.model) {
      stateManager.setModel(`${ctx.model.provider}/${ctx.model.id}`);
    }

    if (config.holder) {
      stateManager.setHolder(config.holder);
    }

    stateManager.setStatus("idle");

    mqttService = new MqttService({
      config,
      stateManager,
      onCommand: async (command) => {
        if (command === "stop") {
          stateManager?.setStatus("stopping");
          mqttService?.publishState();
          ctx.ui.notify("Received stop command from Home Assistant", "warning");
        }
      },
    });

    mqttService.start();
  });

  pi.on("session_info_changed", async (event) => {
    if (stateManager && event.name) {
      stateManager.setSession(event.name);
      mqttService?.publishState();
    }
  });

  pi.on("before_agent_start", async () => {
    if (stateManager) {
      stateManager.setStatus("working");
      mqttService?.publishState();
    }
  });

  pi.on("agent_start", async () => {
    if (stateManager) {
      stateManager.setStatus("working");
      mqttService?.publishState();
    }
  });

  pi.on("turn_start", async () => {
    if (stateManager) {
      stateManager.incrementTurn();
      if (stateManager.getRawState().status !== "tool") {
        stateManager.setStatus("working");
      }
      mqttService?.publishState();
    }
  });

  pi.on("tool_execution_start", async (event) => {
    if (stateManager) {
      stateManager.setTool(event.toolName);
      mqttService?.publishState();
    }
  });

  pi.on("tool_execution_end", async (event) => {
    if (stateManager) {
      stateManager.setTool(null);
      if (event.isError) {
        stateManager.setError(`Tool ${event.toolName} failed`);
      } else {
        stateManager.setStatus("working");
      }
      mqttService?.publishState();
    }
  });

  pi.on("turn_end", async (event) => {
    if (stateManager && event.message && "usage" in event.message) {
      const usage = (event.message as { usage?: { input?: number; output?: number } }).usage;
      if (usage) {
        stateManager.updateTokens(usage.input, usage.output);
      }
      mqttService?.publishState();
    }
  });

  pi.on("agent_settled", async () => {
    if (stateManager) {
      stateManager.setStatus("idle");
      stateManager.setTool(null);
      mqttService?.publishState();
    }
  });

  pi.on("model_select", async (event) => {
    if (stateManager && event.model) {
      stateManager.setModel(`${event.model.provider}/${event.model.id}`);
      mqttService?.publishState();
    }
  });

  pi.on("session_shutdown", async () => {
    if (mqttService) {
      await mqttService.shutdown();
      mqttService = null;
    }
  });

  pi.registerCommand("mqtt-status", {
    description: "Show Home Assistant MQTT integration status",
    handler: async (_args, ctx) => {
      if (!config || !mqttService || !stateManager) {
        ctx.ui.notify("MQTT integration is not initialized", "warning");
        return;
      }

      const connected = mqttService.getConnected();
      const rawState = stateManager.getRawState();
      const statusText = [
        `Broker: ${config.broker}`,
        `Connected: ${connected ? "Yes" : "No"}`,
        `Instance ID: ${config.instance_id} (ephemeral per session; PI_AGENT_MQTT_INSTANCE_ID pins it)`,
        `Holder: ${config.holder ?? "free"}`,
        `Will delay: ${config.will_delay_seconds}s`,
        `Base Topic: ${config.base_topic}`,
        `Discovery Prefix: ${config.discovery_prefix}`,
        `Settings: global ${globalSettingsPath ?? "?"} / project ${projectSettingsPath ?? "?"}`,
        ...(lastLoadError ? [`Settings error: ${lastLoadError}`] : []),
        `Current Status: ${rawState.status}`,
        `Active Session: ${rawState.session ?? "none"}`,
        `Active Model: ${rawState.model ?? "none"}`,
        `Turns: ${rawState.turn_count}`,
      ].join("\n");

      ctx.ui.notify(statusText, connected ? "info" : "warning");
    },
  });

  pi.registerCommand("mqtt-clean", {
    description: "Remove Home Assistant MQTT discovery entities for this agent",
    handler: async (_args, ctx) => {
      if (!mqttService) {
        ctx.ui.notify("MQTT service is not running", "warning");
        return;
      }

      await mqttService.cleanDiscovery();
      ctx.ui.notify("Cleaned MQTT discovery topics in Home Assistant", "info");
    },
  });

  pi.registerCommand("mqtt", {
    description: "Configure Home Assistant MQTT (usage: /mqtt [info|reload|edit [project|global]])",
    handler: async (args, ctx) => {
      const tokens = (args || "").trim().split(/\s+/).filter(Boolean);
      const sub = (tokens[0] || "info").toLowerCase();

      if (sub === "info") {
        const status = mqttService?.getConnected() ? "connected" : "disconnected";
        const lines = [
          `MQTT: ${status}`,
          `Broker: ${config?.broker ?? "(not loaded yet)"}`,
          `Instance: ${config?.instance_id ?? "?"}`,
          `Base topic: ${config?.base_topic ?? "?"}`,
          `Global settings: ${globalSettingsPath ?? "?"}`,
          `Project settings: ${projectSettingsPath ?? "?"}`,
          ...(lastLoadError ? [`Error: ${lastLoadError}`] : []),
          ``,
          `Config lives under the "mqtt" key in settings.json:`,
          `  { "mqtt": { "broker": "mqtt://...", "instance_id": "..." } }`,
          `Project settings override global. Env vars override both.`,
        ];
        ctx.ui.notify(lines.join("\n"), "info");
        return;
      }

      if (sub === "reload") {
        const { loadError } = loadSettings(ctx);
        // Re-resolve without restart? Inform user they should /reload for full reconnect.
        ctx.ui.notify(
          loadError
            ? `Reloaded settings (with error: ${loadError}) — run /reload to reconnect MQTT`
            : "Reloaded MQTT settings — run /reload to reconnect with new config",
          loadError ? "warning" : "info",
        );
        return;
      }

      if (sub === "edit") {
        const scope = (tokens[1] || "").toLowerCase();
        const target: "project" | "global" = scope === "global" ? "global" : "project";
        const settingsPath =
          target === "project" ? projectSettingsPath! : globalSettingsPath!;

        const parsed = readJsonFile(settingsPath);
        if (parsed === null) {
          ctx.ui.notify(`Invalid JSON in ${settingsPath}`, "error");
          return;
        }
        const root = parsed as Record<string, unknown>;
        const existing = sanitizeMqttConfig(root["mqtt"]);
        const prefill = JSON.stringify(existing, null, 2) + "\n";
        const edited = await ctx.ui.editor(`Edit mqtt config (${target})`, prefill);
        if (edited === undefined) return;
        try {
          const next = sanitizeMqttConfig(JSON.parse(edited));
          const nextRoot = { ...root, mqtt: next };
          writeJsonFile(settingsPath, nextRoot);
          ctx.ui.notify(`Saved mqtt config to ${settingsPath} — run /reload to apply`, "info");
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          ctx.ui.notify(`Invalid JSON: ${msg}`, "error");
        }
        return;
      }

      ctx.ui.notify(`Unknown subcommand "${sub}". Usage: /mqtt [info|reload|edit [project|global]]`, "warning");
    },
  });
}

export * from "./types.js";
export * from "./config.js";
export * from "./discovery.js";
export * from "./state.js";
export * from "./mqtt-service.js";
