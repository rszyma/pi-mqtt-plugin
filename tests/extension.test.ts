import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import homeAssistantMqttExtension from "../src/index.js";

describe("Pi Extension Lifecycle", () => {
  it("registers listeners and commands on pi extension initialization", () => {
    const listeners: Record<string, ((...args: any[]) => Promise<any>)[]> = {};
    const commands: Record<string, any> = {};

    const mockPi: Partial<ExtensionAPI> = {
      on: vi.fn((event: string, handler: any) => {
        if (!listeners[event]) {
          listeners[event] = [];
        }
        listeners[event].push(handler);
      }) as any,
      registerCommand: vi.fn((name: string, def: any) => {
        commands[name] = def;
      }) as any,
    };

    homeAssistantMqttExtension(mockPi as ExtensionAPI);

    expect(mockPi.on).toHaveBeenCalledWith("session_start", expect.any(Function));
    expect(mockPi.on).toHaveBeenCalledWith("session_info_changed", expect.any(Function));
    expect(mockPi.on).toHaveBeenCalledWith("before_agent_start", expect.any(Function));
    expect(mockPi.on).toHaveBeenCalledWith("agent_start", expect.any(Function));
    expect(mockPi.on).toHaveBeenCalledWith("turn_start", expect.any(Function));
    expect(mockPi.on).toHaveBeenCalledWith("tool_execution_start", expect.any(Function));
    expect(mockPi.on).toHaveBeenCalledWith("tool_execution_end", expect.any(Function));
    expect(mockPi.on).toHaveBeenCalledWith("turn_end", expect.any(Function));
    expect(mockPi.on).toHaveBeenCalledWith("agent_settled", expect.any(Function));
    expect(mockPi.on).toHaveBeenCalledWith("model_select", expect.any(Function));
    expect(mockPi.on).toHaveBeenCalledWith("session_before_compact", expect.any(Function));
    expect(mockPi.on).toHaveBeenCalledWith("session_compact", expect.any(Function));
    expect(mockPi.on).toHaveBeenCalledWith("session_compact_failed", expect.any(Function));
    expect(mockPi.on).toHaveBeenCalledWith("session_shutdown", expect.any(Function));

    expect(commands["mqtt"]).toBeDefined();
    expect(commands["mqtt-clean"]).toBeDefined();
  });
});
