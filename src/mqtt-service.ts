import mqtt, { type MqttClient, type IClientOptions } from "mqtt";
import { buildDiscoveryMessages } from "./discovery.js";
import { StateManager } from "./state.js";
import type { IncomingCommandPayload, MqttPluginConfig } from "./types.js";

export type CommandHandler = (command: string) => Promise<void> | void;

export interface MqttServiceOptions {
  config: MqttPluginConfig;
  stateManager: StateManager;
  onCommand?: CommandHandler;
  clientFactory?: (url: string, opts: IClientOptions) => MqttClient;
}

export class MqttService {
  private config: MqttPluginConfig;
  private stateManager: StateManager;
  private onCommand?: CommandHandler;
  private clientFactory: (url: string, opts: IClientOptions) => MqttClient;
  private client: MqttClient | null = null;
  private isConnected: boolean = false;
  private intervalTimer: NodeJS.Timeout | null = null;

  constructor(options: MqttServiceOptions) {
    this.config = options.config;
    this.stateManager = options.stateManager;
    this.onCommand = options.onCommand;
    this.clientFactory = options.clientFactory || ((url, opts) => mqtt.connect(url, opts));
  }

  public getConnected(): boolean {
    return this.isConnected;
  }

  public getConfig(): MqttPluginConfig {
    return this.config;
  }

  public start(): void {
    if (this.client) {
      return;
    }

    const availabilityTopic = `${this.config.base_topic}/availability`;
    const commandTopic = `${this.config.base_topic}/command`;

    const clientOpts: IClientOptions = {
      clientId: `pi-agent-${this.config.instance_id}`,
      clean: true,
      reconnectPeriod: 5000,
      connectTimeout: 10000,
      // MQTT 5 only: hold the LWT back so short sleeps / lid-closes do not
      // flap sessions to offline. Omitted entirely when 0 (3.1.1 safe).
      will: {
        topic: availabilityTopic,
        payload: Buffer.from("offline"),
        qos: 1,
        retain: true,
        ...(this.config.will_delay_seconds > 0
          ? { properties: { willDelayInterval: this.config.will_delay_seconds } }
          : {}),
      },
    };

    if (this.config.username) {
      clientOpts.username = this.config.username;
    }
    if (this.config.password) {
      clientOpts.password = this.config.password;
    }

    try {
      this.client = this.clientFactory(this.config.broker, clientOpts);
    } catch {
      // Prevent unhandled constructor exceptions
      return;
    }

    this.client.on("connect", () => {
      this.isConnected = true;
      this.publishAvailability("online");
      this.publishDiscovery();
      this.publishState();

      if (this.config.controls.stop) {
        this.client?.subscribe(commandTopic, { qos: 1 }, (err) => {
          if (err) {
            // Subscribe failure
          }
        });
      }
    });

    this.client.on("reconnect", () => {
      // Reconnecting
    });

    this.client.on("close", () => {
      this.isConnected = false;
    });

    this.client.on("offline", () => {
      this.isConnected = false;
    });

    this.client.on("error", () => {
      // Keep agent process running even when broker is unreachable
    });

    this.client.on("message", (topic, messageBuffer) => {
      if (topic === commandTopic && this.onCommand) {
        this.handleIncomingCommand(messageBuffer.toString("utf8"));
      }
    });

    if (this.config.publish_interval_seconds > 0) {
      this.intervalTimer = setInterval(() => {
        if (this.isConnected) {
          this.publishState();
        }
      }, this.config.publish_interval_seconds * 1000);
      if (this.intervalTimer.unref) {
        this.intervalTimer.unref();
      }
    }
  }

  private handleIncomingCommand(rawPayload: string): void {
    try {
      let commandName: string | undefined;

      const trimmed = rawPayload.trim();
      if (trimmed.startsWith("{")) {
        const parsed = JSON.parse(trimmed) as IncomingCommandPayload;
        commandName = parsed.command || parsed.action;
      } else {
        commandName = trimmed;
      }

      if (commandName && commandName.toLowerCase() === "stop") {
        this.onCommand?.("stop");
      }
    } catch {
      // Discard invalid command payloads safely
    }
  }

  public publishAvailability(status: "online" | "offline"): void {
    if (!this.client || !this.isConnected) {
      return;
    }

    const topic = `${this.config.base_topic}/availability`;
    this.client.publish(topic, status, {
      retain: true,
      qos: 1,
    });
  }

  public publishDiscovery(): void {
    if (!this.client || !this.isConnected) {
      return;
    }

    const messages = buildDiscoveryMessages(this.config);
    for (const msg of messages) {
      this.client.publish(msg.topic, msg.payload, {
        retain: msg.retain,
        qos: msg.qos,
      });
    }
  }

  public publishState(): void {
    if (!this.client || !this.isConnected) {
      return;
    }

    const topic = `${this.config.base_topic}/state`;
    const payload = JSON.stringify(this.stateManager.buildFilteredStatePayload());

    this.client.publish(topic, payload, {
      retain: this.config.retain_state,
      qos: this.config.qos,
    });
  }

  public async shutdown(): Promise<void> {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }

    if (!this.client) {
      return;
    }

    if (this.isConnected) {
      await new Promise<void>((resolve) => {
        const topic = `${this.config.base_topic}/availability`;
        this.client?.publish(topic, "offline", { retain: true, qos: 1 }, () => {
          resolve();
        });
        setTimeout(resolve, 500);
      });
    }

    await new Promise<void>((resolve) => {
      if (this.client) {
        this.client.end(true, {}, () => {
          this.isConnected = false;
          this.client = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}
