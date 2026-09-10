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

  // Overlapping session_start deliveries for one logical switch must
  // serialize: without chaining, two handlers interleave, each misses the
  // other's service as "previous", and both connect. The chain plus the
  // claim/sequence checks make the newer start win and the loser retire
  // whatever it took over, so only one device survives.
  let startChain: Promise<void> = Promise.resolve();
  let activeSessionId: string | null = null;
  let startSeq = 0;

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
    const mySeq = ++startSeq;
    // Claim the session BEFORE any await: a racing twin start observes
    // this claim and stands down, so only one device survives even when
    // two starts interleave.
    activeSessionId = sessionId;
    const previousService = mqttService;
    mqttService = null;
    const priorStart = startChain;
    let releaseChain: () => void = () => {};
    startChain = new Promise<void>((resolve) => {
      releaseChain = resolve;
    });
    try {
      // Serialize with any in-flight start so a racing twin cannot slip
      // in between our shutdown and our connect.
      await priorStart;
      if (mySeq !== startSeq || sessionId !== activeSessionId) {
        // A newer start superseded us while we waited: stand down after
        // retiring whatever we took over, so no device is left behind.
        if (previousService) {
          await previousService.shutdown();
        }
        return;
      }
      // Session switches arrive as session_start with reason
      // new/resume/fork. Retire the previous session's device first so
      // it reads unavailable instead of freezing green on its last state.
      if (previousService) {
        await previousService.shutdown();
      }
      if (mySeq !== startSeq || sessionId !== activeSessionId) {
        return;
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

      if (mySeq !== startSeq || sessionId !== activeSessionId) {
        return;
      }
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
    } finally {
      releaseChain();
    }
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

  pi.on("session_shutdown", async () => {
    // Retire the device on every shutdown, including session replacement
    // (new/resume/fork). The shutdown emit runs on the outgoing runner
    // (same extension instance that owns the live service), while the
    // next session_start lands on the replacement instance — so without
    // this, the old instance's service would stay connected with its own
    // timers and keep publishing under its own device id.
    // In-order delivery per runner makes a stale-shutdown race
    // impossible: this instance's shutdown always precedes any newer
    // start on the replacement instance.
    if (mqttService) {
      activeSessionId = null;
      const outgoing = mqttService;
      mqttService = null;
      await outgoing.shutdown();
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

}

export * from "./types.js";
export * from "./config.js";
export * from "./discovery.js";
export * from "./state.js";
export * from "./mqtt-service.js";
