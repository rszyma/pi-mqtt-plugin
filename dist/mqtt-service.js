import mqtt from "mqtt";
import { buildCleanupMessages, buildDiscoveryMessages } from "./discovery.js";
export class MqttService {
    config;
    stateManager;
    onCommand;
    clientFactory;
    client = null;
    isConnected = false;
    intervalTimer = null;
    constructor(options) {
        this.config = options.config;
        this.stateManager = options.stateManager;
        this.onCommand = options.onCommand;
        this.clientFactory = options.clientFactory || ((url, opts) => mqtt.connect(url, opts));
    }
    getConnected() {
        return this.isConnected;
    }
    getConfig() {
        return this.config;
    }
    start() {
        if (this.client) {
            return;
        }
        const availabilityTopic = `${this.config.base_topic}/availability`;
        const commandTopic = `${this.config.base_topic}/command`;
        const clientOpts = {
            clientId: `pi-agent-${this.config.instance_id}`,
            clean: true,
            reconnectPeriod: 5000,
            connectTimeout: 10000,
            will: {
                topic: availabilityTopic,
                payload: Buffer.from("offline"),
                qos: 1,
                retain: true,
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
        }
        catch {
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
    handleIncomingCommand(rawPayload) {
        try {
            let commandName;
            const trimmed = rawPayload.trim();
            if (trimmed.startsWith("{")) {
                const parsed = JSON.parse(trimmed);
                commandName = parsed.command || parsed.action;
            }
            else {
                commandName = trimmed;
            }
            if (commandName && commandName.toLowerCase() === "stop") {
                this.onCommand?.("stop");
            }
        }
        catch {
            // Discard invalid command payloads safely
        }
    }
    publishAvailability(status) {
        if (!this.client || !this.isConnected) {
            return;
        }
        const topic = `${this.config.base_topic}/availability`;
        this.client.publish(topic, status, {
            retain: true,
            qos: 1,
        });
    }
    publishDiscovery() {
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
    publishState() {
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
    cleanDiscovery() {
        return new Promise((resolve) => {
            if (!this.client || !this.isConnected) {
                resolve();
                return;
            }
            const messages = buildCleanupMessages(this.config);
            let remaining = messages.length;
            if (remaining === 0) {
                resolve();
                return;
            }
            for (const msg of messages) {
                this.client.publish(msg.topic, msg.payload, { retain: msg.retain, qos: msg.qos }, () => {
                    remaining -= 1;
                    if (remaining <= 0) {
                        resolve();
                    }
                });
            }
        });
    }
    async shutdown() {
        if (this.intervalTimer) {
            clearInterval(this.intervalTimer);
            this.intervalTimer = null;
        }
        if (!this.client) {
            return;
        }
        if (this.isConnected) {
            await new Promise((resolve) => {
                const topic = `${this.config.base_topic}/availability`;
                this.client?.publish(topic, "offline", { retain: true, qos: 1 }, () => {
                    resolve();
                });
                setTimeout(resolve, 500);
            });
        }
        await new Promise((resolve) => {
            if (this.client) {
                this.client.end(true, {}, () => {
                    this.isConnected = false;
                    this.client = null;
                    resolve();
                });
            }
            else {
                resolve();
            }
        });
    }
}
