import { describe, expect, it, vi } from "vitest";
import mqtt from "mqtt";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import homeAssistantMqttExtension from "../src/index.js";

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
    cwd: "/tmp/nonexistent-pi-mqtt-resume",
    hasUI: false,
    ui: { notify: () => {} },
    model: undefined,
    sessionManager: { getSessionId: () => sessionId, getEntries: () => [] },
  };
}

async function readRetained(ids: string[]): Promise<{ configs: Map<string, string>; availability: Map<string, string> }> {
  const watcher = mqtt.connect(BROKER);
  await new Promise<void>((resolve, reject) => {
    watcher.on("connect", () => resolve());
    watcher.on("error", (err) => reject(err));
  });
  const configs = new Map<string, string>();
  const availability = new Map<string, string>();
  await new Promise<void>((resolve) => {
    watcher.on("message", (topic, payload) => {
      const c = topic.match(/^homeassistant\/sensor\/([^/]+)\/status\/config$/);
      if (c && ids.includes(c[1])) configs.set(c[1], payload.toString());
      const a = topic.match(/^pi-agent\/([^/]+)\/availability$/);
      if (a && ids.includes(a[1])) availability.set(a[1], payload.toString());
    });
    watcher.subscribe(
      ["homeassistant/sensor/+/status/config", "pi-agent/+/availability"],
      () => setTimeout(resolve, 2000),
    );
  });
  watcher.end(true);
  return { configs, availability };
}

async function clearRetained(ids: string[]): Promise<void> {
  const cleaner = mqtt.connect(BROKER);
  await new Promise<void>((resolve, reject) => {
    cleaner.on("connect", () => resolve());
    cleaner.on("error", (e) => reject(e));
  });
  for (const node of ids) {
    for (const t of [
      `homeassistant/sensor/${node}/status/config`,
      `homeassistant/binary_sensor/${node}/busy/config`,
      `homeassistant/sensor/${node}/model/config`,
      `homeassistant/sensor/${node}/project/config`,
      `homeassistant/sensor/${node}/cost/config`,
      `homeassistant/sensor/${node}/last_activity/config`,
      `pi-agent/${node}/availability`,
      `pi-agent/${node}/state`,
    ]) {
      cleaner.publish(t, "", { retain: true });
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
  cleaner.end(true);
}

describe("resume flow (live broker)", () => {
  it("startup then resume leaves exactly one online device", async () => {
    if (!(await brokerUp())) {
      console.log(`skip: no broker at ${BROKER}`);
      return;
    }
    const suffix = Date.now().toString(36);
    const idA = `resume-A-${suffix}`;
    const idB = `resume-B-${suffix}`;

    const oldHandlers: Record<string, ((...args: any[]) => Promise<any>)[]> = {};
    const newHandlers: Record<string, ((...args: any[]) => Promise<any>)[]> = {};
    function spawnInstance(handlers: Record<string, ((...args: any[]) => Promise<any>)[]>): void {
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

    // pi start (reason "startup"), then /resume: teardown("resume") on the
    // outgoing runner, then start("resume") on the replacement runner.
    await oldHandlers["session_start"][0]({ reason: "startup" }, fakeCtx(idA));
    await new Promise((r) => setTimeout(r, 1500));
    await oldHandlers["session_shutdown"][0](
      { reason: "resume", targetSessionFile: `/sessions/${idB}.jsonl` },
      fakeCtx(idA),
    );
    await newHandlers["session_start"][0]({ reason: "resume" }, fakeCtx(idB));
    await new Promise((r) => setTimeout(r, 2500));

    const { configs, availability } = await readRetained([idA, idB]);
    console.log("configs:", [...configs.keys()]);
    console.log("availability:", [...availability.entries()].map(([k, v]) => `${k}=${v}`));
    const live = [...configs.keys()].filter((n) => availability.get(n) === "online");

    await oldHandlers["session_shutdown"][0]({ reason: "quit" }, fakeCtx(idA));
    await newHandlers["session_shutdown"][0]({ reason: "quit" }, fakeCtx(idB));
    await new Promise((r) => setTimeout(r, 800));
    await clearRetained([idA, idB]);

    expect(live).toHaveLength(1);
    expect(live[0]).toBe(idB);
  }, 30000);
});
