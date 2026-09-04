import { describe, expect, it } from "vitest";
import { StateManager } from "../src/state.js";
import type { MqttPluginConfig } from "../src/types.js";

describe("StateManager", () => {
  const config: MqttPluginConfig = {
    broker: "mqtt://127.0.0.1:1883",
    instance_id: "dev-pi",
    device_name: "Pi Agent on workstation",
    base_topic: "pi-agent/dev-pi",
    discovery_prefix: "homeassistant",
    qos: 1,
    retain_state: true,
    publish_interval_seconds: 30,
    will_delay_seconds: 90,
    controls: { stop: false },
    expose: {
      session: true,
      model: true,
      tool: true,
      token_usage: true,
      errors: true,
    },
  };

  it("initializes with idle state", () => {
    const manager = new StateManager(config);
    const raw = manager.getRawState();
    expect(raw.status).toBe("idle");
    expect(raw.busy).toBe(false);
    expect(raw.turn_count).toBe(0);
  });

  it("updates status and busy flag correctly", () => {
    const manager = new StateManager(config);

    manager.setStatus("working");
    expect(manager.getRawState().status).toBe("working");
    expect(manager.getRawState().busy).toBe(true);

    manager.setStatus("idle");
    expect(manager.getRawState().status).toBe("idle");
    expect(manager.getRawState().busy).toBe(false);

    manager.setStatus("stopping");
    expect(manager.getRawState().busy).toBe(true);
  });

  it("handles tool execution transitions", () => {
    const manager = new StateManager(config);

    manager.setTool("bash");
    expect(manager.getRawState().status).toBe("tool");
    expect(manager.getRawState().tool).toBe("bash");
    expect(manager.getRawState().busy).toBe(true);

    manager.setTool(null);
    expect(manager.getRawState().tool).toBeNull();
  });

  it("increments turn count", () => {
    const manager = new StateManager(config);
    manager.incrementTurn();
    manager.incrementTurn();
    expect(manager.getRawState().turn_count).toBe(2);
  });

  it("updates token usage stats", () => {
    const manager = new StateManager(config);
    manager.updateTokens(1500, 400, 25.5);
    const raw = manager.getRawState();
    expect(raw.input_tokens).toBe(1500);
    expect(raw.output_tokens).toBe(400);
    expect(raw.context_percent).toBe(25.5);
  });

  it("filters state payload based on expose configuration", () => {
    const customConfig: MqttPluginConfig = {
      ...config,
      expose: {
        session: false,
        model: false,
        tool: false,
        token_usage: false,
        errors: false,
      },
    };

    const manager = new StateManager(customConfig);
    manager.setSession("test-session");
    manager.setModel("openai/gpt-4o");
    manager.setTool("read");
    manager.updateTokens(100, 50);

    const payload = manager.buildFilteredStatePayload();
    expect(payload.status).toBe("tool");
    expect(payload.busy).toBe(true);
    expect(payload.session).toBeUndefined();
    expect(payload.model).toBeUndefined();
    expect(payload.tool).toBeUndefined();
    expect(payload.input_tokens).toBeUndefined();
  });

  it("exposes project in state payload defaulting to unknown", () => {
    const manager = new StateManager(config);
    expect(manager.buildFilteredStatePayload().project).toBe("unknown");
    manager.setProject("myproj");
    expect(manager.buildFilteredStatePayload().project).toBe("myproj");
  });

  it("does not leak prompt text, responses, or tool arguments in payload", () => {
    const manager = new StateManager(config);
    manager.setSession("dev");
    manager.setTool("bash");

    const payload = manager.buildFilteredStatePayload();
    expect(payload).not.toHaveProperty("prompt");
    expect(payload).not.toHaveProperty("response");
    expect(payload).not.toHaveProperty("args");
    expect(payload).not.toHaveProperty("input");
    expect(payload).not.toHaveProperty("output");
  });
});
