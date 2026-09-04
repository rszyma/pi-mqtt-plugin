import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as path from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadMqttSettings, resolveConfig } from "./config.js";
import { MqttService } from "./mqtt-service.js";
import { StateManager } from "./state.js";
import type { MqttPluginConfig } from "./types.js";

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

  /** Same total as the footer: sum usage.cost.total over session entries. */
  function refreshCostUsd(
    entries: Array<{
      type?: string;
      message?: { role?: string; usage?: { cost?: { total?: number } } };
      usage?: { cost?: { total?: number } };
    }>,
  ): void {
    if (!stateManager) return;
    try {
      let total = 0;
      for (const e of entries) {
        if (e.type === "message" && (e.message?.role === "assistant" || e.message?.role === "toolResult")) {
          const cost = e.message?.usage?.cost?.total;
          if (typeof cost === "number") total += cost;
        } else if ((e.type === "branch_summary" || e.type === "compaction") && e.usage) {
          const cost = e.usage?.cost?.total;
          if (typeof cost === "number") total += cost;
        }
      }
      stateManager.setCostUsd(total);
    } catch { /* entries unreadable: keep last known cost */ }
  }

  async function startSessionDevice(ctx: ExtensionContext): Promise<void> {
    const sessionId = ctx.sessionManager.getSessionId();
    // Session switches arrive as session_start with reason new/resume/fork.
    // Retire the previous session's device first so it reads unavailable
    // instead of freezing green on its last state.
    if (mqttService) {
      await mqttService.shutdown();
      mqttService = null;
    }
    const { loadError } = loadSettings(ctx);
    if (loadError && ctx.hasUI) {
      ctx.ui.notify(lastLoadError!, "warning");
    }
    config = resolveConfig(ctx.cwd, customConfig, undefined, sessionId);
    stateManager = new StateManager(config);

    stateManager.setSession(sessionId);

    if (ctx.model) {
      stateManager.setModel(`${ctx.model.provider}/${ctx.model.id}`);
    }

    if (config.project) {
      stateManager.setProject(config.project);
    }

    stateManager.setStatus("idle");
    // Restore the true total on reload/resume: fresh state starts at 0.
    refreshCostUsd(ctx.sessionManager.getEntries() as Parameters<typeof refreshCostUsd>[0]);

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
  }

  pi.on("session_start", async (_event, ctx) => {
    await startSessionDevice(ctx);
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

  pi.on("turn_end", async (event, ctx) => {
    if (!stateManager) return;
    if (event.message && "usage" in event.message) {
      const usage = (event.message as { usage?: { input?: number; output?: number } }).usage;
      if (usage) {
        stateManager.updateTokens(usage.input, usage.output);
      }
    }
    // Same total as the footer: sum usage.cost.total over session entries.
    refreshCostUsd(ctx.sessionManager.getEntries() as Parameters<typeof refreshCostUsd>[0]);
    mqttService?.publishState();
  });

  pi.on("agent_settled", async () => {
    if (stateManager) {
      stateManager.setStatus("idle");
      stateManager.setTool(null);
      mqttService?.publishState();
    }
  });

  pi.on("session_before_compact", async () => {
    if (stateManager) {
      stateManager.setStatus("compacting");
      mqttService?.publishState();
    }
  });

  pi.on("session_compact", async () => {
    if (stateManager) {
      stateManager.setStatus("idle");
      mqttService?.publishState();
    }
  });

  pi.on("session_compact_failed", async () => {
    if (stateManager) {
      stateManager.setStatus("idle");
      mqttService?.publishState();
    }
  });

  pi.on("model_select", async (event) => {
    if (stateManager && event.model) {
      stateManager.setModel(`${event.model.provider}/${event.model.id}`);
      mqttService?.publishState();
    }
  });

  pi.on("session_shutdown", async (event) => {
    // Replacement (new/resume/fork) is handled at the next session_start,
    // which retires this device before adopting the new one. Only tear down
    // here on real exit/reload.
    if (event.reason === "quit" || event.reason === "reload") {
      if (mqttService) {
        await mqttService.shutdown();
        mqttService = null;
      }
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
        `MQTT: ${connected ? "connected" : "disconnected"}`,
        `Broker: ${config.broker}`,
        `Name: ${config.device_name}`,
        `Instance ID: ${config.instance_id} (one per session; PI_AGENT_MQTT_INSTANCE_ID pins it)`,
        `Project: ${config.project ?? "unknown"} (mqtt.project or PI_AGENT_MQTT_PROJECT overrides it)`,
        `Base Topic: ${config.base_topic}`,
        `Discovery Prefix: ${config.discovery_prefix}`,
        `Global settings: ${globalSettingsPath ?? "?"} / project ${projectSettingsPath ?? "?"}`,
        ...(lastLoadError ? [`Settings error: ${lastLoadError}`] : []),
        `Current Status: ${rawState.status}`,
        `Active Session: ${rawState.session ?? "none"}`,
        `Active Model: ${rawState.model ?? "none"}`,
      ].join("\n");

      ctx.ui.notify(statusText, connected ? "info" : "warning");
    },
  });

  pi.registerCommand("mqtt-prune", {
    description: "Remove Home Assistant discovery for dead Pi Agent sessions",
    handler: async (_args, ctx) => {
      if (!mqttService || !mqttService.getConnected()) {
        ctx.ui.notify("MQTT service is not connected", "warning");
        return;
      }

      ctx.ui.notify("Scanning for dead Pi Agent sessions...", "info");
      const dead = await mqttService.findDeadSessions();
      if (dead.length === 0) {
        ctx.ui.notify("No dead Pi Agent sessions found", "info");
        return;
      }

      const confirm = await ctx.ui.confirm(
        "Prune dead sessions",
        `Remove HA discovery for ${dead.length} dead session(s)?\n${dead.map((d) => d.instanceId).join("\n")}`,
      );
      if (!confirm) return;

      const pruned = await mqttService.pruneDiscovery(dead);
      ctx.ui.notify(`Pruned ${pruned} dead session(s): ${dead.map((d) => d.instanceId).join(", ")}`, "info");
    },
  });

  pi.registerCommand("mqtt-reload", {
    description: "Re-read MQTT settings (run /reload to reconnect)",
    handler: async (_args, ctx) => {
      const { loadError } = loadSettings(ctx);
      ctx.ui.notify(
        loadError
          ? `Reloaded settings (with error: ${loadError}) — run /reload to reconnect MQTT`
          : "Reloaded MQTT settings — run /reload to reconnect with new config",
        loadError ? "warning" : "info",
      );
    },
  });
}

export * from "./types.js";
export * from "./config.js";
export * from "./discovery.js";
export * from "./state.js";
export * from "./mqtt-service.js";
