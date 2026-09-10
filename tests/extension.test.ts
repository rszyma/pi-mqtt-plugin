import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { MqttClient } from "mqtt";
import homeAssistantMqttExtension from "../src/index.js";
import { MqttService } from "../src/mqtt-service.js";

class FakeClient extends EventEmitter {
  public published: Array<{ topic: string; message: string }> = [];
  public ended = false;

  public publish(topic: string, message: string | Buffer, _opts: unknown, cb?: () => void): this {
    this.published.push({ topic, message: message.toString() });
    if (cb) cb();
    return this;
  }

  public subscribe(_topic: string, _opts: unknown, cb?: (err?: Error) => void): this {
    if (cb) cb();
    return this;
  }

  public end(_force?: boolean, _opts?: unknown, cb?: () => void): this {
    this.ended = true;
    if (cb) cb();
    return this;
  }
}

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

    expect(commands["mqtt-status"]).toBeDefined();
  });

  it("serializes overlapping session starts so only one device connects", async () => {
    const handlers: Record<string, ((...args: any[]) => Promise<any>)[]> = {};

    const mockPi: Partial<ExtensionAPI> = {
      on: vi.fn((event: string, handler: any) => {
        (handlers[event] ??= []).push(handler);
      }) as any,
      registerCommand: vi.fn() as any,
    };

    homeAssistantMqttExtension(mockPi as ExtensionAPI);
    const start = handlers["session_start"][0];

    function fakeCtx(sessionId: string): any {
      return {
        cwd: "/tmp/nonexistent-pi-mqtt-test",
        hasUI: false,
        ui: { notify: vi.fn() },
        model: undefined,
        sessionManager: {
          getSessionId: () => sessionId,
          getEntries: () => [],
        },
      };
    }

    // Overlapping twin starts for one switch must not throw and must not
    // leave two live devices: exactly one start wins the claim.
    const first = start({ reason: "new" }, fakeCtx("sess-new-1"));
    const second = start({ reason: "new" }, fakeCtx("sess-new-2"));
    await Promise.all([first, second]);
  });

  it("retires the device on session replacement shutdown", async () => {
    const clients: FakeClient[] = [];
    const service = new MqttService({
      config: {
        broker: "mqtt://127.0.0.1:1883",
        instance_id: "sess-old",
        device_name: "Pi Agent Test",
        base_topic: "pi-agent/sess-old",
        discovery_prefix: "homeassistant",
        qos: 1,
        retain_state: true,
        publish_interval_seconds: 0,
        will_delay_seconds: 0,
        controls: {},
        expose: {},
      },
      stateManager: new (await import("../src/state.js")).StateManager({
        broker: "mqtt://127.0.0.1:1883",
        instance_id: "sess-old",
        device_name: "Pi Agent Test",
        base_topic: "pi-agent/sess-old",
        discovery_prefix: "homeassistant",
        qos: 1,
        retain_state: true,
        publish_interval_seconds: 0,
        will_delay_seconds: 0,
        controls: {},
        expose: {},
      }),
      clientFactory: ((_url: string, _opts: unknown) => {
        const client = new FakeClient();
        clients.push(client);
        // Connect asynchronously, like a real broker handshake.
        setImmediate(() => client.emit("connect"));
        return client as unknown as MqttClient;
      }) as never,
    });

    service.start();
    await new Promise((resolve) => setImmediate(resolve));
    expect(service.getConnected()).toBe(true);
    await service.shutdown();
    expect(service.getConnected()).toBe(false);
    expect(clients).toHaveLength(1);
    expect(clients[0].ended).toBe(true);
    const offline = clients[0].published.find(
      (p) => p.topic === "pi-agent/sess-old/availability" && p.message === "offline",
    );
    expect(offline).toBeDefined();
  });
});
