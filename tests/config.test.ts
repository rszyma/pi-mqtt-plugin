import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as os from "node:os";
import { _resetEphemeralIdCache, getStableInstanceId, resolveConfig } from "../src/config.js";

const TEST_AGENT_DIR = "/tmp/nonexistent-pi-home/.pi/agent";

describe("Config resolution", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.PI_AGENT_MQTT_BROKER;
    delete process.env.MQTT_BROKER;
    delete process.env.PI_AGENT_MQTT_USERNAME;
    delete process.env.MQTT_USERNAME;
    delete process.env.PI_AGENT_MQTT_PASSWORD;
    delete process.env.MQTT_PASSWORD;
    delete process.env.PI_AGENT_MQTT_INSTANCE_ID;
    delete process.env.PI_AGENT_MQTT_PROJECT;
    delete process.env.PI_AGENT_MQTT_WILL_DELAY_SECONDS;
    delete process.env.PI_AGENT_MQTT_DEVICE_NAME;
    delete process.env.PI_AGENT_MQTT_BASE_TOPIC;
    delete process.env.PI_AGENT_MQTT_DISCOVERY_PREFIX;
    delete process.env.PI_AGENT_MQTT_PASSWORD_ENV;
    delete process.env.PI_AGENT_MQTT_ENABLE_STOP;
  });

  afterEach(() => {
    process.env = originalEnv;
    _resetEphemeralIdCache();
  });

  it("resolves default configuration", () => {
    const config = resolveConfig("/tmp/nonexistent", undefined, TEST_AGENT_DIR);
    expect(config.broker).toBe("mqtt://127.0.0.1:1883");
    expect(config.discovery_prefix).toBe("homeassistant");
    expect(config.qos).toBe(1);
    expect(config.retain_state).toBe(true);
    expect(config.publish_interval_seconds).toBe(5);
    expect(config.will_delay_seconds).toBe(90);
    expect(config.project).toBe("nonexistent");
    expect(config.device_name).toBe(`Pi Agent [nonexistent] (${os.hostname() || "host"})`);
    expect(config.controls.stop).toBe(false);
    expect(config.expose.model).toBe(true);
    expect(config.expose.tool).toBe(true);
    expect(config.expose.token_usage).toBe(true);
    expect(config.expose.errors).toBe(true);
  });

  it("overrides values from environment variables", () => {
    process.env.PI_AGENT_MQTT_BROKER = "mqtt://192.168.1.100:1883";
    process.env.PI_AGENT_MQTT_USERNAME = "my-user";
    process.env.PI_AGENT_MQTT_PASSWORD = "secret-password";
    process.env.PI_AGENT_MQTT_INSTANCE_ID = "custom-agent-node";
    process.env.PI_AGENT_MQTT_DEVICE_NAME = "Custom Agent Device";
    process.env.PI_AGENT_MQTT_BASE_TOPIC = "custom/topic";
    process.env.PI_AGENT_MQTT_DISCOVERY_PREFIX = "custom_ha";
    process.env.PI_AGENT_MQTT_ENABLE_STOP = "true";

    const config = resolveConfig("/tmp/nonexistent", undefined, TEST_AGENT_DIR);
    expect(config.broker).toBe("mqtt://192.168.1.100:1883");
    expect(config.username).toBe("my-user");
    expect(config.password).toBe("secret-password");
    expect(config.instance_id).toBe("custom-agent-node");
    expect(config.device_name).toBe("Custom Agent Device");
    expect(config.base_topic).toBe("custom/topic");
    expect(config.discovery_prefix).toBe("custom_ha");
    expect(config.controls.stop).toBe(true);
  });

  it("resolves password from custom password_env variable", () => {
    process.env.CUSTOM_SECRET_KEY = "resolved-secret";
    const config = resolveConfig("/tmp/nonexistent", {
      password_env: "CUSTOM_SECRET_KEY",
    }, TEST_AGENT_DIR);
    expect(config.password).toBe("resolved-secret");
  });

  it("derives instance id from session when no explicit id", () => {
    const config = resolveConfig("/tmp/nonexistent", undefined, TEST_AGENT_DIR, "sess-abc-123");
    expect(config.instance_id).toBe("sess-abc-123");
    expect(config.explicit_instance_id).toBeUndefined();
    expect(config.base_topic).toBe("pi-agent/sess-abc-123");
  });

  it("prefers explicit id over session id", () => {
    process.env.PI_AGENT_MQTT_INSTANCE_ID = "pinned";
    const config = resolveConfig("/tmp/nonexistent", undefined, TEST_AGENT_DIR, "sess-abc-123");
    expect(config.instance_id).toBe("pinned");
    expect(config.explicit_instance_id).toBe("pinned");
  });

  it("generates stable instance id when explicit is provided", () => {
    const id = getStableInstanceId("my-explicit-node");
    expect(id).toBe("my-explicit-node");
  });

  it("generates unique ephemeral ids per process by default", () => {
    const a = getStableInstanceId();
    _resetEphemeralIdCache();
    const b = getStableInstanceId();
    expect(a).not.toBe(b);
    expect(a.split("-").length).toBeGreaterThanOrEqual(4);
  });

  it("resolves will_delay and project from env", () => {
    process.env.PI_AGENT_MQTT_WILL_DELAY_SECONDS = "30";
    process.env.PI_AGENT_MQTT_PROJECT = "myproj";
    const config = resolveConfig("/tmp/nonexistent", undefined, TEST_AGENT_DIR);
    expect(config.will_delay_seconds).toBe(30);
    expect(config.project).toBe("myproj");
  });

  it("falls back to default will_delay on invalid input", () => {
    process.env.PI_AGENT_MQTT_WILL_DELAY_SECONDS = "-5";
    const config = resolveConfig("/tmp/nonexistent", undefined, TEST_AGENT_DIR);
    expect(config.will_delay_seconds).toBe(90);
  });
});
