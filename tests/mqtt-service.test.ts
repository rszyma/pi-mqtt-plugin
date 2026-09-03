import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { IClientOptions, MqttClient } from "mqtt";
import { MqttService } from "../src/mqtt-service.js";
import { StateManager } from "../src/state.js";
import type { MqttPluginConfig } from "../src/types.js";

class MockMqttClient extends EventEmitter {
  public publishedMessages: Array<{
    topic: string;
    message: string;
    opts: Record<string, unknown>;
  }> = [];
  public subscribedTopics: Array<{ topic: string; opts: Record<string, unknown> }> = [];
  public clientOptions: IClientOptions;
  public ended: boolean = false;

  constructor(public brokerUrl: string, opts: IClientOptions) {
    super();
    this.clientOptions = opts;
  }

  public publish(
    topic: string,
    message: string | Buffer,
    opts: Record<string, unknown>,
    callback?: (err?: Error) => void,
  ): this {
    this.publishedMessages.push({
      topic,
      message: message.toString(),
      opts,
    });
    if (callback) {
      callback();
    }
    return this;
  }

  public subscribe(
    topic: string,
    opts: Record<string, unknown>,
    callback?: (err?: Error) => void,
  ): this {
    this.subscribedTopics.push({ topic, opts });
    if (callback) {
      callback();
    }
    return this;
  }

  public end(force?: boolean, opts?: Record<string, unknown>, callback?: () => void): this {
    this.ended = true;
    if (callback) {
      callback();
    }
    return this;
  }
}

describe("MqttService", () => {
  const config: MqttPluginConfig = {
    broker: "mqtt://127.0.0.1:1883",
    instance_id: "test-node",
    device_name: "Pi Agent Test",
    base_topic: "pi-agent/test-node",
    discovery_prefix: "homeassistant",
    qos: 1,
    retain_state: true,
    publish_interval_seconds: 0,
    slot_count: 4,
    will_delay_seconds: 90,
    slot_overflow: false,
    controls: { stop: true },
    expose: {
      session: true,
      model: true,
      tool: true,
      token_usage: true,
      errors: true,
    },
  };

  it("configures Last Will and Testament correctly", () => {
    let mockClientInstance: MockMqttClient | null = null;
    const stateManager = new StateManager(config);

    const service = new MqttService({
      config,
      stateManager,
      clientFactory: (url, opts) => {
        mockClientInstance = new MockMqttClient(url, opts);
        return mockClientInstance as unknown as MqttClient;
      },
    });

    service.start();

    expect(mockClientInstance).toBeDefined();
    expect(mockClientInstance!.clientOptions.will).toEqual({
      topic: "pi-agent/test-node/availability",
      payload: Buffer.from("offline"),
      qos: 1,
      retain: true,
      properties: { willDelayInterval: 90 },
    });
  });

  it("omits will-delay properties when disabled", () => {
    let mockClientInstance: MockMqttClient | null = null;
    const stateManager = new StateManager({ ...config, will_delay_seconds: 0 });

    const service = new MqttService({
      config: { ...config, will_delay_seconds: 0 },
      stateManager,
      clientFactory: (url, opts) => {
        mockClientInstance = new MockMqttClient(url, opts);
        return mockClientInstance as unknown as MqttClient;
      },
    });

    service.start();

    expect(mockClientInstance!.clientOptions.will).toEqual({
      topic: "pi-agent/test-node/availability",
      payload: Buffer.from("offline"),
      qos: 1,
      retain: true,
    });
  });

  it("uses a unique per-process clientId so slots never evict each other", () => {
    let mockClientInstance: MockMqttClient | null = null;
    const stateManager = new StateManager(config);

    const service = new MqttService({
      config,
      stateManager,
      clientFactory: (url, opts) => {
        mockClientInstance = new MockMqttClient(url, opts);
        return mockClientInstance as unknown as MqttClient;
      },
    });

    service.start();

    expect(mockClientInstance!.clientOptions.clientId).toBe(
      `pi-agent-test-node-${process.pid}`,
    );
  });

  it("publishes availability, discovery, and initial state on connect", () => {
    let mockClientInstance: MockMqttClient | null = null;
    const stateManager = new StateManager(config);

    const service = new MqttService({
      config,
      stateManager,
      clientFactory: (url, opts) => {
        mockClientInstance = new MockMqttClient(url, opts);
        return mockClientInstance as unknown as MqttClient;
      },
    });

    service.start();
    mockClientInstance!.emit("connect");

    expect(service.getConnected()).toBe(true);

    const onlineMsg = mockClientInstance!.publishedMessages.find(
      (m) => m.topic === "pi-agent/test-node/availability" && m.message === "online",
    );
    expect(onlineMsg).toBeDefined();
    expect(onlineMsg?.opts.retain).toBe(true);

    const discoveryMsg = mockClientInstance!.publishedMessages.find((m) =>
      m.topic.startsWith("homeassistant/sensor/test-node/status/config"),
    );
    expect(discoveryMsg).toBeDefined();

    const stateMsg = mockClientInstance!.publishedMessages.find(
      (m) => m.topic === "pi-agent/test-node/state",
    );
    expect(stateMsg).toBeDefined();
  });

  it("subscribes to command topic and dispatches stop command", () => {
    let mockClientInstance: MockMqttClient | null = null;
    const stateManager = new StateManager(config);
    const onCommandMock = vi.fn();

    const service = new MqttService({
      config,
      stateManager,
      onCommand: onCommandMock,
      clientFactory: (url, opts) => {
        mockClientInstance = new MockMqttClient(url, opts);
        return mockClientInstance as unknown as MqttClient;
      },
    });

    service.start();
    mockClientInstance!.emit("connect");

    expect(
      mockClientInstance!.subscribedTopics.some(
        (s) => s.topic === "pi-agent/test-node/command",
      ),
    ).toBe(true);

    // Emit incoming stop command
    mockClientInstance!.emit(
      "message",
      "pi-agent/test-node/command",
      Buffer.from(JSON.stringify({ command: "stop" })),
    );

    expect(onCommandMock).toHaveBeenCalledWith("stop");
  });

  it("publishes offline availability on graceful shutdown", async () => {
    let mockClientInstance: MockMqttClient | null = null;
    const stateManager = new StateManager(config);

    const service = new MqttService({
      config,
      stateManager,
      clientFactory: (url, opts) => {
        mockClientInstance = new MockMqttClient(url, opts);
        return mockClientInstance as unknown as MqttClient;
      },
    });

    service.start();
    mockClientInstance!.emit("connect");

    await service.shutdown();

    const offlineMsg = mockClientInstance!.publishedMessages.find(
      (m) => m.topic === "pi-agent/test-node/availability" && m.message === "offline",
    );
    expect(offlineMsg).toBeDefined();
    expect(mockClientInstance!.ended).toBe(true);
  });

  it("publishes empty retained payloads on cleanDiscovery", async () => {
    let mockClientInstance: MockMqttClient | null = null;
    const stateManager = new StateManager(config);

    const service = new MqttService({
      config,
      stateManager,
      clientFactory: (url, opts) => {
        mockClientInstance = new MockMqttClient(url, opts);
        return mockClientInstance as unknown as MqttClient;
      },
    });

    service.start();
    mockClientInstance!.emit("connect");

    await service.cleanDiscovery();

    const cleanMessages = mockClientInstance!.publishedMessages.filter(
      (m) => m.message === "" && m.opts.retain === true,
    );
    expect(cleanMessages.length).toBeGreaterThan(0);
  });
});
