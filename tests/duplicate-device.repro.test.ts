import { describe, expect, it, vi } from "vitest";
import mqtt from "mqtt";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import homeAssistantMqttExtension from "../src/index.js";

// Live-broker regression test for the duplicate-device bug. Simulates Pi's
// session replacement the way AgentSessionRuntime runs it: the outgoing
// extension instance gets session_shutdown (reason "new") on its own
// runner, then the replacement instance gets session_start on a NEW runner.
// The old code ignored replacement shutdowns, so the stale instance kept
// its MQTT service alive and two devices stayed online.
// Needs a broker: mosquitto -p 18883 (skipped otherwise).
const BROKER = process.env.PI_MQTT_TEST_BROKER ?? "mqtt://127.0.0.1:18883";

async function brokerUp(): Promise<boolean> {
  try {
    const probe = mqtt.connect(BROKER, { connectTimeout: 1500, reconnectPeriod: 0 });
    const ok = await new Promise<boolean>((resolve) => {
      probe.on("connect", () => resolve(true));
      probe.on("error", () => resolve(false));
    });
    probe.end(true);
    return ok;
  } catch {
    return false;
  }
}

function fakeCtx(sessionId: string): any {
  return {
    cwd: "/tmp/nonexistent-pi-mqtt-repro",
    hasUI: false,
    ui: { notify: () => {} },
    model: undefined,
    sessionManager: { getSessionId: () => sessionId, getEntries: () => [] },
  };
}

describe("duplicate-device regression (live broker)", () => {
  it("leaves exactly one online device after twin session starts", async () => {
    if (!(await brokerUp())) {
      console.log(`skip: no broker at ${BROKER}`);
      return;
    }
    const suffix = Date.now().toString(36);
    const idA = `repro-twin-A-${suffix}`;
    const idB = `repro-twin-B-${suffix}`;

    // Simulate one Pi process replacing its session: the old extension
    // instance (previous factory invocation) owns device A and receives
    // the replacement shutdown; the new instance adopts device B.
    const oldHandlers: Record<string, ((...args: any[]) => Promise<any>)[]> = {};
    const newHandlers: Record<string, ((...args: any[]) => Promise<any>)[]> = {};
    function spawnInstance(
      handlers: Record<string, ((...args: any[]) => Promise<any>)[]>,
    ): void {
      const mockPi: Partial<ExtensionAPI> = {
        on: vi.fn((event: string, handler: any) => {
          (handlers[event] ??= []).push(handler);
        }) as any,
        registerCommand: vi.fn() as any,
      };
      homeAssistantMqttExtension(mockPi as ExtensionAPI, {
        broker: BROKER,
        publish_interval_seconds: 0,
        will_delay_seconds: 0,
      } as never);
    }
    spawnInstance(oldHandlers);
    spawnInstance(newHandlers);

    await oldHandlers["session_start"][0]({ reason: "startup" }, fakeCtx(idA));
    // Replacement: outgoing instance retires, incoming instance adopts.
    // Interleave them the way the runtime does (shutdown emit and new
    // runtime creation can overlap in flight).
    const shutdown = oldHandlers["session_shutdown"][0](
      { reason: "new", targetSessionFile: `/sessions/${idB}.jsonl` },
      fakeCtx(idA),
    );
    const startup = newHandlers["session_start"][0]({ reason: "new" }, fakeCtx(idB));
    await Promise.all([shutdown, startup]);
    await new Promise((resolve) => setTimeout(resolve, 2500));

    const watcher = mqtt.connect(BROKER);
    await new Promise<void>((resolve, reject) => {
      watcher.on("connect", () => resolve());
      watcher.on("error", (err) => reject(err));
    });
    const configs = new Map<string, string>();
    const availability = new Map<string, string>();
    await new Promise<void>((resolve) => {
      watcher.on("message", (topic, payload) => {
        const configMatch = topic.match(/^homeassistant\/sensor\/([^/]+)\/status\/config$/);
        if (configMatch && (configMatch[1] === idA || configMatch[1] === idB)) {
          configs.set(configMatch[1], payload.toString());
        }
        const availMatch = topic.match(/^pi-agent\/([^/]+)\/availability$/);
        if (availMatch && (availMatch[1] === idA || availMatch[1] === idB)) {
          availability.set(availMatch[1], payload.toString());
        }
      });
      watcher.subscribe(
        ["homeassistant/sensor/+/status/config", "pi-agent/+/availability"],
        () => setTimeout(resolve, 2000),
      );
    });

    const live = [...configs.keys()].filter((node) => availability.get(node) === "online");

    // Both instances shut down (process exit): everything must go offline.
    await oldHandlers["session_shutdown"][0]({ reason: "quit" }, fakeCtx(idA));
    await newHandlers["session_shutdown"][0]({ reason: "quit" }, fakeCtx(idB));
    await new Promise((resolve) => setTimeout(resolve, 800));
    const cleaner = mqtt.connect(BROKER);
    await new Promise<void>((resolve, reject) => {
      cleaner.on("connect", () => resolve());
      cleaner.on("error", (e) => reject(e));
    });
    for (const node of [idA, idB]) {
      for (const t of [
        `homeassistant/sensor/${node}/status/config`,
        `pi-agent/${node}/availability`,
        `pi-agent/${node}/state`,
      ]) {
        cleaner.publish(t, "", { retain: true });
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    watcher.end(true);
    cleaner.end(true);

    expect(live).toHaveLength(1);
  }, 30000);
});
