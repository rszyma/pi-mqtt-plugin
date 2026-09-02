import { describe, expect, it } from "vitest";
import {
  buildCleanupMessages,
  buildDevicePayload,
  buildDiscoveryMessages,
  sanitizeNodeId,
} from "../src/discovery.js";
import type { MqttPluginConfig } from "../src/types.js";

describe("Home Assistant MQTT Discovery Builder", () => {
  const baseConfig: MqttPluginConfig = {
    broker: "mqtt://127.0.0.1:1883",
    instance_id: "dev-pi",
    device_name: "Pi Agent on workstation",
    base_topic: "pi-agent/dev-pi",
    discovery_prefix: "homeassistant",
    qos: 1,
    retain_state: true,
    publish_interval_seconds: 30,
    controls: {
      stop: false,
    },
    expose: {
      session: true,
      model: true,
      tool: true,
      token_usage: true,
      errors: true,
    },
  };

  it("sanitizes node id correctly", () => {
    expect(sanitizeNodeId("dev.pi@host:1")).toBe("dev_pi_host_1");
    expect(sanitizeNodeId("dev-pi_123")).toBe("dev-pi_123");
  });

  it("builds correct device identity payload", () => {
    const device = buildDevicePayload(baseConfig);
    expect(device.identifiers).toEqual(["pi-agent:dev-pi"]);
    expect(device.name).toBe("Pi Agent on workstation");
    expect(device.manufacturer).toBe("Pi");
    expect(device.model).toBe("Pi Agent");
  });

  it("builds discovery messages for standard entities", () => {
    const messages = buildDiscoveryMessages(baseConfig);

    const statusMsg = messages.find((m) =>
      m.topic === "homeassistant/sensor/dev-pi/status/config",
    );
    expect(statusMsg).toBeDefined();
    expect(statusMsg?.retain).toBe(true);
    expect(statusMsg?.qos).toBe(1);

    const statusPayload = JSON.parse(statusMsg!.payload);
    expect(statusPayload.name).toBe("Status");
    expect(statusPayload.unique_id).toBe("pi_agent_dev_pi_status");
    expect(statusPayload.state_topic).toBe("pi-agent/dev-pi/state");
    expect(statusPayload.value_template).toBe("{{ value_json.status }}");
    expect(statusPayload.availability_topic).toBe("pi-agent/dev-pi/availability");
    expect(statusPayload.payload_available).toBe("online");
    expect(statusPayload.payload_not_available).toBe("offline");

    const busyMsg = messages.find((m) =>
      m.topic === "homeassistant/binary_sensor/dev-pi/busy/config",
    );
    expect(busyMsg).toBeDefined();
    const busyPayload = JSON.parse(busyMsg!.payload);
    expect(busyPayload.name).toBe("Busy");
    expect(busyPayload.device_class).toBe("running");
    expect(busyPayload.payload_on).toBe("ON");
    expect(busyPayload.payload_off).toBe("OFF");

    const sessionMsg = messages.find((m) =>
      m.topic === "homeassistant/sensor/dev-pi/session/config",
    );
    expect(sessionMsg).toBeDefined();

    const modelMsg = messages.find((m) =>
      m.topic === "homeassistant/sensor/dev-pi/model/config",
    );
    expect(modelMsg).toBeDefined();

    const lastActivityMsg = messages.find((m) =>
      m.topic === "homeassistant/sensor/dev-pi/last_activity/config",
    );
    expect(lastActivityMsg).toBeDefined();
    const lastActivityPayload = JSON.parse(lastActivityMsg!.payload);
    expect(lastActivityPayload.device_class).toBe("timestamp");

    // Stop button should not be present when controls.stop is false
    const stopMsg = messages.find((m) =>
      m.topic === "homeassistant/button/dev-pi/stop/config",
    );
    expect(stopMsg).toBeUndefined();
  });

  it("includes stop button when controls.stop is true", () => {
    const stopConfig: MqttPluginConfig = {
      ...baseConfig,
      controls: { stop: true },
    };

    const messages = buildDiscoveryMessages(stopConfig);
    const stopMsg = messages.find((m) =>
      m.topic === "homeassistant/button/dev-pi/stop/config",
    );
    expect(stopMsg).toBeDefined();
    const stopPayload = JSON.parse(stopMsg!.payload);
    expect(stopPayload.name).toBe("Stop");
    expect(stopPayload.command_topic).toBe("pi-agent/dev-pi/command");
    expect(stopPayload.payload_press).toBe(JSON.stringify({ command: "stop" }));
  });

  it("omits session and model when disabled in expose config", () => {
    const minConfig: MqttPluginConfig = {
      ...baseConfig,
      expose: {
        session: false,
        model: false,
      },
    };

    const messages = buildDiscoveryMessages(minConfig);
    expect(messages.find((m) => m.topic.includes("/session/"))).toBeUndefined();
    expect(messages.find((m) => m.topic.includes("/model/"))).toBeUndefined();
  });

  it("builds cleanup messages with empty retained payloads", () => {
    const cleanup = buildCleanupMessages(baseConfig);
    expect(cleanup.length).toBeGreaterThan(0);
    for (const msg of cleanup) {
      expect(msg.payload).toBe("");
      expect(msg.retain).toBe(true);
    }
  });
});
