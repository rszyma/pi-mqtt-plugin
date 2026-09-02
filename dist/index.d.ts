import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { MqttPluginConfig } from "./types.js";
export default function homeAssistantMqttExtension(pi: ExtensionAPI, customConfig?: Partial<MqttPluginConfig>): void;
export * from "./types.js";
export * from "./config.js";
export * from "./discovery.js";
export * from "./state.js";
export * from "./mqtt-service.js";
