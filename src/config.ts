import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { MqttPluginConfig } from "./types.js";

const DEFAULT_BROKER = "mqtt://127.0.0.1:1883";
const DEFAULT_DISCOVERY_PREFIX = "homeassistant";
const DEFAULT_QOS = 1;
const DEFAULT_PUBLISH_INTERVAL_SECONDS = 5;
const DEFAULT_SLOT_COUNT = 4;
const DEFAULT_WILL_DELAY_SECONDS = 90;

export const SETTINGS_KEY = "mqtt";

export type MqttSettings = Partial<MqttPluginConfig>;

/**
 * Sanitize an identifier fragment for MQTT topics / HA ids.
 * Allows letters, digits, dash, underscore; anything else becomes "-".
 */
export function sanitizeInstancePart(input: string): string {
  const cleaned = input.trim().replace(/[^A-Za-z0-9_-]/g, "-");
  return cleaned.replace(/-+/g, "-").replace(/^-+|-+$/g, "");
}

export function parseSlotNumber(suffix: string | undefined): number | null {
  if (!suffix) return null;
  const trimmed = suffix.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
}

function defaultHostPart(): string {
  const hostname = os.hostname().toLowerCase().replace(/[^a-z0-9_-]/g, "-") || "pi";
  return sanitizeInstancePart(hostname) || "pi";
}

/**
 * Resolve the stable instance ID.
 *
 * Priority:
 * 1. explicitId (PI_AGENT_MQTT_INSTANCE_ID / mqtt.instance_id) — full override.
 * 2. hostname + suffix (PI_AGENT_MQTT_INSTANCE_SUFFIX / mqtt.instance_suffix).
 * 3. hostname alone.
 *
 * The default is stable per host: restarts reuse the same Home Assistant
 * device instead of registering a new one. Pass a suffix (e.g. "1", "2")
 * from the VM launcher when several live VMs share one hostname.
 */
export function getStableInstanceId(explicitId?: string, suffix?: string): string {
  if (explicitId && explicitId.trim().length > 0) {
    return explicitId.trim();
  }
  const host = defaultHostPart();
  const cleanSuffix = suffix ? sanitizeInstancePart(suffix) : "";
  if (cleanSuffix) {
    return `${host}-${cleanSuffix}`;
  }
  return host;
}

/** Deprecated no-op kept for backwards compatibility (ids are now stable). */
export function _resetEphemeralIdCache(): void {}

function tryReadJsonFile<T>(filePath: string): T | null {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf8");
      return JSON.parse(content) as T;
    }
  } catch {
    // Intentionally silent: file reads happen before ctx.ui exists.
    // Warnings for invalid JSON are surfaced in session_start via
    // loadMqttSettings (same pattern as pi-ding).
  }
  return null;
}

export type LoadMqttSettingsResult = {
  config: Partial<MqttPluginConfig>;
  loadError: string | undefined;
};

/**
 * Read mqtt config from pi settings.json files.
 * - Global:  ~/.pi/agent/settings.json  -> settings["mqtt"]
 * - Project: <cwd>/.pi/settings.json     -> settings["mqtt"]
 * Project overrides global (shallow merge, same as pi-ding).
 * Falls back to legacy dedicated files (~/.pi/agent/mqtt.json, .pi/mqtt.json)
 * for backwards compatibility.
 */
export function loadMqttSettings(
  cwd: string,
  agentDir: string,
): LoadMqttSettingsResult {
  let loadError: string | undefined;

  function readSettingsFile(filePath: string): Record<string, unknown> | null {
    try {
      if (!fs.existsSync(filePath)) return {};
      const raw = fs.readFileSync(filePath, "utf8");
      return JSON.parse(raw) as Record<string, unknown>;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      loadError = loadError ?? `Invalid JSON in ${filePath}: ${msg}`;
      return null;
    }
  }

  const globalSettingsPath = path.join(agentDir, "settings.json");
  const projectSettingsPath = path.join(cwd, ".pi", "settings.json");

  const globalSettings = readSettingsFile(globalSettingsPath);
  const projectSettings = readSettingsFile(projectSettingsPath);

  const globalMqtt =
    globalSettings && SETTINGS_KEY in globalSettings
      ? (globalSettings[SETTINGS_KEY] as Partial<MqttPluginConfig>)
      : {};
  const projectMqtt =
    projectSettings && SETTINGS_KEY in projectSettings
      ? (projectSettings[SETTINGS_KEY] as Partial<MqttPluginConfig>)
      : {};

  // Back-compat: legacy dedicated mqtt.json files (deprecated, lowest priority
  // inside their scope so settings.json wins if both exist).
  const legacyGlobal = tryReadJsonFile<Partial<MqttPluginConfig>>(
    path.join(agentDir, "mqtt.json"),
  );
  const legacyProject = tryReadJsonFile<Partial<MqttPluginConfig>>(
    path.join(cwd, ".pi", "mqtt.json"),
  );

  // Merge order (lowest -> highest priority):
  // legacyGlobal < settings global < legacyProject < settings project
  const merged: Partial<MqttPluginConfig> = {
    ...(legacyGlobal ?? {}),
    ...(globalMqtt ?? {}),
    ...(legacyProject ?? {}),
    ...(projectMqtt ?? {}),
  };

  // Remove undefined keys so they don't shadow later merges
  for (const k of Object.keys(merged) as Array<keyof MqttPluginConfig>) {
    if (merged[k] === undefined) delete merged[k];
  }

  return { config: merged, loadError };
}

export function sanitizeMqttConfig(input: unknown): Partial<MqttPluginConfig> {
  if (!input || typeof input !== "object") return {};
  const o = input as Record<string, unknown>;
  const out: Partial<MqttPluginConfig> = {};
  if (typeof o.broker === "string") out.broker = o.broker;
  if (typeof o.username === "string") out.username = o.username;
  if (typeof o.password === "string") out.password = o.password;
  if (typeof o.password_env === "string") out.password_env = o.password_env;
  if (typeof o.instance_id === "string") out.instance_id = o.instance_id;
  if (typeof o.instance_suffix === "string") out.instance_suffix = o.instance_suffix;
  if (typeof o.holder === "string") out.holder = o.holder;
  if (typeof o.slot_count === "number" && Number.isFinite(o.slot_count)) out.slot_count = o.slot_count;
  if (typeof o.will_delay_seconds === "number" && Number.isFinite(o.will_delay_seconds)) out.will_delay_seconds = o.will_delay_seconds;
  if (typeof o.device_name === "string") out.device_name = o.device_name;
  if (typeof o.base_topic === "string") out.base_topic = o.base_topic;
  if (typeof o.discovery_prefix === "string") out.discovery_prefix = o.discovery_prefix;
  if (typeof o.qos === "number" && [0, 1, 2].includes(o.qos)) out.qos = o.qos as 0 | 1 | 2;
  if (typeof o.retain_state === "boolean") out.retain_state = o.retain_state;
  if (typeof o.publish_interval_seconds === "number") out.publish_interval_seconds = o.publish_interval_seconds;
  if (o.controls && typeof o.controls === "object") {
    const c = o.controls as Record<string, unknown>;
    out.controls = {};
    if (typeof c.stop === "boolean") out.controls.stop = c.stop;
  }
  if (o.expose && typeof o.expose === "object") {
    const e = o.expose as Record<string, unknown>;
    out.expose = {};
    if (typeof e.session === "boolean") out.expose.session = e.session;
    if (typeof e.model === "boolean") out.expose.model = e.model;
    if (typeof e.holder === "boolean") out.expose.holder = e.holder;
    if (typeof e.tool === "boolean") out.expose.tool = e.tool;
    if (typeof e.token_usage === "boolean") out.expose.token_usage = e.token_usage;
    if (typeof e.errors === "boolean") out.expose.errors = e.errors;
    if (typeof e.context_percent === "boolean") out.expose.context_percent = e.context_percent;
  }
  return out;
}

export function resolveConfig(
  cwd: string = process.cwd(),
  customConfig?: Partial<MqttPluginConfig>,
  agentDir?: string,
): MqttPluginConfig {
  // Resolve agentDir lazily so tests don't need to mock getAgentDir.
  const resolvedAgentDir = agentDir ?? path.join(os.homedir(), ".pi", "agent");

  const { config: fileConfig } = loadMqttSettings(cwd, resolvedAgentDir);

  const envBroker = process.env.PI_AGENT_MQTT_BROKER || process.env.MQTT_BROKER;
  const envUsername = process.env.PI_AGENT_MQTT_USERNAME || process.env.MQTT_USERNAME;
  const envPasswordEnv = process.env.PI_AGENT_MQTT_PASSWORD_ENV;
  const envPassword =
    process.env.PI_AGENT_MQTT_PASSWORD ||
    process.env.MQTT_PASSWORD ||
    (envPasswordEnv && process.env[envPasswordEnv]);
  const envInstanceId = process.env.PI_AGENT_MQTT_INSTANCE_ID;
  const envInstanceSuffix = process.env.PI_AGENT_MQTT_INSTANCE_SUFFIX;
  const envHolder = process.env.PI_AGENT_MQTT_HOLDER;
  const envSlotCount = process.env.PI_AGENT_MQTT_SLOT_COUNT;
  const envWillDelay = process.env.PI_AGENT_MQTT_WILL_DELAY_SECONDS;
  const envDeviceName = process.env.PI_AGENT_MQTT_DEVICE_NAME;
  const envBaseTopic = process.env.PI_AGENT_MQTT_BASE_TOPIC;
  const envDiscoveryPrefix = process.env.PI_AGENT_MQTT_DISCOVERY_PREFIX;
  const envEnableStop =
    process.env.PI_AGENT_MQTT_ENABLE_STOP === "true" || process.env.PI_AGENT_MQTT_ENABLE_STOP === "1";

  const mergedPartial: Partial<MqttPluginConfig> = {
    ...fileConfig,
    ...sanitizeMqttConfig(customConfig ?? {}),
  };

  const slotCountRaw =
    envSlotCount !== undefined && envSlotCount !== ""
      ? Number.parseInt(envSlotCount, 10)
      : mergedPartial.slot_count;
  const slotCount =
    typeof slotCountRaw === "number" && Number.isFinite(slotCountRaw) && slotCountRaw >= 1
      ? Math.floor(slotCountRaw)
      : DEFAULT_SLOT_COUNT;

  const willDelayRaw =
    envWillDelay !== undefined && envWillDelay !== ""
      ? Number.parseInt(envWillDelay, 10)
      : mergedPartial.will_delay_seconds;
  const willDelaySeconds =
    typeof willDelayRaw === "number" && Number.isFinite(willDelayRaw) && willDelayRaw >= 0
      ? Math.floor(willDelayRaw)
      : DEFAULT_WILL_DELAY_SECONDS;

  const explicitId = envInstanceId || mergedPartial.instance_id;
  const suffix = envInstanceSuffix || mergedPartial.instance_suffix;
  const instanceId = getStableInstanceId(explicitId, suffix);

  // Fail-loud overflow: a numeric suffix beyond the pool without a full
  // instance_id override. The caller (session_start) refuses MQTT in this
  // case so we never silently invent a 5th device.
  const slotNumber = parseSlotNumber(suffix);
  const slotOverflow = !explicitId && slotNumber !== null && slotNumber > slotCount;

  const deviceName = envDeviceName || mergedPartial.device_name || `Pi Agent on ${instanceId}`;

  const baseTopic = envBaseTopic || mergedPartial.base_topic || `pi-agent/${instanceId}`;

  const discoveryPrefix = envDiscoveryPrefix || mergedPartial.discovery_prefix || DEFAULT_DISCOVERY_PREFIX;

  let resolvedPassword = envPassword || mergedPartial.password;

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
    holder: mergedPartial.expose?.holder ?? true,
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
    instance_suffix: suffix,
    holder: envHolder || mergedPartial.holder,
    slot_count: slotCount,
    will_delay_seconds: willDelaySeconds,
    slot_overflow: slotOverflow,
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
