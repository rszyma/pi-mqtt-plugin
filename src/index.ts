import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { resolveConfig } from "./config.js";
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

  pi.on("session_start", async (_event, ctx) => {
    config = resolveConfig(ctx.cwd, customConfig);
    stateManager = new StateManager(config);

    const sessionFile = ctx.sessionManager.getSessionFile();
    const sessionId = ctx.sessionManager.getSessionId();
    stateManager.setSession(sessionFile ? sessionFile.split("/").pop() ?? sessionId : sessionId);

    if (ctx.model) {
      stateManager.setModel(`${ctx.model.provider}/${ctx.model.id}`);
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
        `Instance ID: ${config.instance_id}`,
        `Base Topic: ${config.base_topic}`,
        `Discovery Prefix: ${config.discovery_prefix}`,
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
}

export * from "./types.js";
export * from "./config.js";
export * from "./discovery.js";
export * from "./state.js";
export * from "./mqtt-service.js";
