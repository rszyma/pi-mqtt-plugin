import type { DiscoveryMessage, HomeAssistantDevice, MqttPluginConfig } from "./types.js";
export declare function sanitizeNodeId(id: string): string;
export declare function sanitizeUniqueId(id: string): string;
export declare function buildDevicePayload(config: MqttPluginConfig): HomeAssistantDevice;
export declare function buildDiscoveryMessages(config: MqttPluginConfig): DiscoveryMessage[];
export declare function buildCleanupMessages(config: MqttPluginConfig): DiscoveryMessage[];
