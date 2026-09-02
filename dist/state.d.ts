import type { AgentStateData, AgentStatus, MqttPluginConfig } from "./types.js";
export declare class StateManager {
    private config;
    private state;
    constructor(config: MqttPluginConfig);
    updateConfig(config: MqttPluginConfig): void;
    getRawState(): AgentStateData;
    setStatus(status: AgentStatus): void;
    setSession(session: string | null): void;
    setModel(model: string | null): void;
    setTool(tool: string | null): void;
    incrementTurn(): void;
    setTurnCount(count: number): void;
    updateTokens(inputTokens?: number, outputTokens?: number, contextPercent?: number): void;
    setError(error: string | null): void;
    buildFilteredStatePayload(): Record<string, unknown>;
}
