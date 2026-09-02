import { type MqttClient, type IClientOptions } from "mqtt";
import { StateManager } from "./state.js";
import type { MqttPluginConfig } from "./types.js";
export type CommandHandler = (command: string) => Promise<void> | void;
export interface MqttServiceOptions {
    config: MqttPluginConfig;
    stateManager: StateManager;
    onCommand?: CommandHandler;
    clientFactory?: (url: string, opts: IClientOptions) => MqttClient;
}
export declare class MqttService {
    private config;
    private stateManager;
    private onCommand?;
    private clientFactory;
    private client;
    private isConnected;
    private intervalTimer;
    constructor(options: MqttServiceOptions);
    getConnected(): boolean;
    getConfig(): MqttPluginConfig;
    start(): void;
    private handleIncomingCommand;
    publishAvailability(status: "online" | "offline"): void;
    publishDiscovery(): void;
    publishState(): void;
    cleanDiscovery(): Promise<void>;
    shutdown(): Promise<void>;
}
