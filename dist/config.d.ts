import type { MqttPluginConfig } from "./types.js";
export declare const SETTINGS_KEY = "mqtt";
export type MqttSettings = Partial<MqttPluginConfig>;
/**
 * Sanitize an identifier fragment for MQTT topics / HA ids.
 * Allows letters, digits, dash, underscore; anything else becomes "-".
 */
export declare function sanitizeInstancePart(input: string): string;
export declare function parseSlotNumber(suffix: string | undefined): number | null;
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
export declare function getStableInstanceId(explicitId?: string, suffix?: string): string;
/** Deprecated no-op kept for backwards compatibility (ids are now stable). */
export declare function _resetEphemeralIdCache(): void;
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
export declare function loadMqttSettings(cwd: string, agentDir: string): LoadMqttSettingsResult;
export declare function sanitizeMqttConfig(input: unknown): Partial<MqttPluginConfig>;
export declare function resolveConfig(cwd?: string, customConfig?: Partial<MqttPluginConfig>, agentDir?: string): MqttPluginConfig;
