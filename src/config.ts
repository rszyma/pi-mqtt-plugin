import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { MqttPluginConfig } from "./types.js";

const DEFAULT_BROKER = "mqtt://127.0.0.1:1883";
const DEFAULT_DISCOVERY_PREFIX = "homeassistant";
const DEFAULT_QOS = 1;
const DEFAULT_PUBLISH_INTERVAL_SECONDS = 30;

function getHomeDir(): string {
  return os.homedir();
}

export function getStableInstanceId(explicitId?: string): string {
  if (explicitId && explicitId.trim().length > 0) {
    return explicitId.trim();
  }

  const idFile = path.join(getHomeDir(), ".pi", "agent", "mqtt-instance-id");
  try {
    if (fs.existsSync(idFile)) {
      const content = fs.readFileSync(idFile, "utf8").trim();
      if (content.length > 0) {
        return content;
      }
    }
  } catch {
    // Ignore read errors
  }

  const hostname = os.hostname().toLowerCase().replace(/[^a-z0-9_-]/g, "-") || "pi";
  const generatedId = `${hostname}-${randomUUID().slice(0, 6)}`;

  try {
    const dir = path.dirname(idFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(idFile, generatedId, "utf8");
  } catch {
    // If saving fails, still return the generated ID
  }

  return generatedId;
}

function tryReadJsonFile<T>(filePath: string): T | null {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf8");
      return JSON.parse(content) as T;
    }
  } catch {
    // Ignore invalid JSON files
  }
  return null;
}

export function resolveConfig(
  cwd: string = process.cwd(),
  customConfig?: Partial<MqttPluginConfig>,
): MqttPluginConfig {
  const globalConfigPath = path.join(getHomeDir(), ".pi", "agent", "mqtt.json");
  const projectConfigPath = path.join(cwd, ".pi", "mqtt.json");

  const globalFileConfig = tryReadJsonFile<Partial<MqttPluginConfig>>(globalConfigPath) ?? {};
  const projectFileConfig = tryReadJsonFile<Partial<MqttPluginConfig>>(projectConfigPath) ?? {};

  const envBroker = process.env.PI_AGENT_MQTT_BROKER || process.env.MQTT_BROKER;
  const envUsername = process.env.PI_AGENT_MQTT_USERNAME || process.env.MQTT_USERNAME;
  const envPasswordEnv = process.env.PI_AGENT_MQTT_PASSWORD_ENV;
  const envPassword =
    process.env.PI_AGENT_MQTT_PASSWORD ||
    process.env.MQTT_PASSWORD ||
    (envPasswordEnv && process.env[envPasswordEnv]);
  const envInstanceId = process.env.PI_AGENT_MQTT_INSTANCE_ID;
  const envDeviceName = process.env.PI_AGENT_MQTT_DEVICE_NAME;
  const envBaseTopic = process.env.PI_AGENT_MQTT_BASE_TOPIC;
  const envDiscoveryPrefix = process.env.PI_AGENT_MQTT_DISCOVERY_PREFIX;
  const envEnableStop = process.env.PI_AGENT_MQTT_ENABLE_STOP === "true" || process.env.PI_AGENT_MQTT_ENABLE_STOP === "1";

  const mergedPartial: Partial<MqttPluginConfig> = {
    ...globalFileConfig,
    ...projectFileConfig,
    ...customConfig,
  };

  const instanceId = getStableInstanceId(
    envInstanceId || mergedPartial.instance_id,
  );

  const hostname = os.hostname() || "host";
  const deviceName =
    envDeviceName ||
    mergedPartial.device_name ||
    `Pi Agent on ${hostname}`;

  const baseTopic =
    envBaseTopic ||
    mergedPartial.base_topic ||
    `pi-agent/${instanceId}`;

  const discoveryPrefix =
    envDiscoveryPrefix ||
    mergedPartial.discovery_prefix ||
    DEFAULT_DISCOVERY_PREFIX;

  let resolvedPassword =
    envPassword ||
    mergedPartial.password;

  if (!resolvedPassword && mergedPartial.password_env) {
    resolvedPassword = process.env[mergedPartial.password_env];
  }

  const broker = envBroker || mergedPartial.broker || DEFAULT_BROKER;
  const username = envUsername || mergedPartial.username;
  const qos = mergedPartial.qos !== undefined ? mergedPartial.qos : DEFAULT_QOS;
  const retainState = mergedPartial.retain_state !== undefined ? mergedPartial.retain_state : true;
  const publishIntervalSeconds =
    mergedPartial.publish_interval_seconds !== undefined
      ? mergedPartial.publish_interval_seconds
      : DEFAULT_PUBLISH_INTERVAL_SECONDS;

  const controls = {
    stop: envEnableStop || mergedPartial.controls?.stop || false,
  };

  const expose = {
    session: mergedPartial.expose?.session ?? true,
    model: mergedPartial.expose?.model ?? true,
    tool: mergedPartial.expose?.tool ?? true,
    token_usage: mergedPartial.expose?.token_usage ?? true,
    errors: mergedPartial.expose?.errors ?? true,
    context_percent: mergedPartial.expose?.context_percent ?? true,
  };

  return {
    broker,
    username,
    password: resolvedPassword,
    password_env: mergedPartial.password_env || envPasswordEnv,
    instance_id: instanceId,
    device_name: deviceName,
    base_topic: baseTopic,
    discovery_prefix: discoveryPrefix,
    qos,
    retain_state: retainState,
    publish_interval_seconds: publishIntervalSeconds,
    controls,
    expose,
  };
}
