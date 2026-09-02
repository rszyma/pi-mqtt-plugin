import type { MqttPluginConfig } from "./types.js";
export declare const SETTINGS_KEY = "mqtt";
export type MqttSettings = Partial<MqttPluginConfig>;
/** For tests: reset the process-scoped cached id. */
export declare function _resetEphemeralIdCache(): void;
export declare function getStableInstanceId(explicitId?: string): string;
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
