import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as os from "node:os";
import { getStableInstanceId, resolveConfig, sanitizeInstancePart } from "../src/config.js";

const TEST_AGENT_DIR = "/tmp/nonexistent-pi-home/.pi/agent";

describe("Config resolution", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    // NOTE: resolveConfig's third arg pins the agent dir so tests never read
    // the developer's real ~/.pi/agent/settings.json.
    delete process.env.PI_AGENT_MQTT_BROKER;
    delete process.env.MQTT_BROKER;
    delete process.env.PI_AGENT_MQTT_USERNAME;
    delete process.env.MQTT_USERNAME;
    delete process.env.PI_AGENT_MQTT_PASSWORD;
    delete process.env.MQTT_PASSWORD;
    delete process.env.PI_AGENT_MQTT_INSTANCE_ID;
    delete process.env.PI_AGENT_MQTT_INSTANCE_SUFFIX;
    delete process.env.PI_AGENT_MQTT_DEVICE_NAME;
    delete process.env.PI_AGENT_MQTT_BASE_TOPIC;
    delete process.env.PI_AGENT_MQTT_DISCOVERY_PREFIX;
    delete process.env.PI_AGENT_MQTT_PASSWORD_ENV;
    delete process.env.PI_AGENT_MQTT_ENABLE_STOP;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("resolves default configuration", () => {
    const config = resolveConfig("/tmp/nonexistent", undefined, TEST_AGENT_DIR);
    expect(config.broker).toBe("mqtt://127.0.0.1:1883");
    expect(config.discovery_prefix).toBe("homeassistant");
    expect(config.qos).toBe(1);
    expect(config.retain_state).toBe(true);
    expect(config.publish_interval_seconds).toBe(5);
    expect(config.controls.stop).toBe(false);
    expect(config.expose.session).toBe(true);
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

  it("generates stable instance id when explicit is provided", () => {
    const id = getStableInstanceId("my-explicit-node");
    expect(id).toBe("my-explicit-node");
  });

  it("defaults to the sanitized hostname (stable across restarts)", () => {
    const expected = sanitizeInstancePart(os.hostname().toLowerCase()) || "pi";
    expect(getStableInstanceId()).toBe(expected);
    const a = resolveConfig("/tmp/nonexistent", undefined, TEST_AGENT_DIR);
    const b = resolveConfig("/tmp/nonexistent", undefined, TEST_AGENT_DIR);
    expect(a.instance_id).toBe(expected);
    expect(a.instance_id).toBe(b.instance_id);
    expect(a.base_topic).toBe(`pi-agent/${expected}`);
  });

  it("appends instance suffix to the hostname by default", () => {
    const host = sanitizeInstancePart(os.hostname().toLowerCase()) || "pi";
    expect(getStableInstanceId(undefined, "2")).toBe(`${host}-2`);
    process.env.PI_AGENT_MQTT_INSTANCE_SUFFIX = "3";
    const config = resolveConfig("/tmp/nonexistent", undefined, TEST_AGENT_DIR);
    expect(config.instance_id).toBe(`${host}-3`);
    expect(config.base_topic).toBe(`pi-agent/${host}-3`);
  });

  it("prefers full instance_id override over suffix", () => {
    process.env.PI_AGENT_MQTT_INSTANCE_SUFFIX = "2";
    process.env.PI_AGENT_MQTT_INSTANCE_ID = "vm-opencode-2";
    const config = resolveConfig("/tmp/nonexistent", undefined, TEST_AGENT_DIR);
    expect(config.instance_id).toBe("vm-opencode-2");
  });

  it("sanitizes suffix characters", () => {
    expect(sanitizeInstancePart("vm 2!")).toBe("vm-2");
    const host = sanitizeInstancePart(os.hostname().toLowerCase()) || "pi";
    expect(getStableInstanceId(undefined, "vm 2!")).toBe(`${host}-vm-2`);
  });
});
