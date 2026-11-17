/**
 * Request budget of open pages while they poll (M5.R-fix9): every query a
 * page keeps polling, as the renderer runs it (one timer per id and params,
 * shared by every reader), through the engine and the real eero client
 * against the fake eero server. Each minute of a ten minute stay runs the
 * polls due that minute, one after another and with no read sharing between
 * them, so the count is an upper bound: real timers carry up to 10 percent
 * jitter and often share reads. The engine clock moves a minute per tick, so
 * every TTL under its poll interval has expired and each poll reaches eero.
 *
 * Also: a change made outside Mesh UI (in the eero app) shows on the next
 * poll of the settings read, without a manual refresh.
 */

import { afterEach, describe, expect, it } from "vitest";
import { createFakeEero, type FakeEero } from "../../../test/fake-eero/server";
import type { SecretStore } from "../backend";
import { createEngine, type Engine } from "../engine";
import type { NetworkSettings } from "../model";
import { burstReadTimes, POLL, TTL } from "../poll";
import { allCommands } from "../registry";
import { createEeroBackend } from "./backend";
import { RateLimiter } from "./ratelimit";

/** One polled reader: command id, params, and a fixed interval when the page passes a number instead of `poll: true`. */
type Poll = [id: string, params?: unknown, sec?: number];

/** The shell around every page: the sidebar's network.get, the switcher's network.list, the bell's notifications.list. */
const SHELL: Poll[] = [["network.get"], ["network.list", undefined, 60], ["notifications.list", { networkId: "100001" }]];

const EERO = "500001";

/** Each page's polled readers, from its components (src/renderer/src/features). */
const PAGES: Record<string, Poll[]> = {
  overview: [
    ["network.health"],
    ["internet.get"],
    ["profile.list"],
    ["eero.list"],
    ["device.list"],
    ["usage.get", { scope: "eero", range: "day" }],
    ["usage.get", { scope: "profile", range: "day" }],
    ["usage.get", { scope: "network", range: "day" }],
    ["usage.get", { scope: "network", range: "week", cadence: "hourly" }],
    ["usage.breakdown", { range: "day", by: "device" }],
    ["events.list", { limit: 3 }],
  ],
  "advanced networking": [["internet.get"], ["settings.get"], ["integrations.get"]],
  "wi-fi": [["wifi.get"], ["network.health"], ["device.list", {}]],
  guest: [["guest.get"], ["device.list", { ssid: "guest" }], ["eero.list"], ["usage.breakdown", { range: "day", by: "device" }], ["usage.get", { scope: "guest", range: "day" }], ["usage.get", { scope: "network", range: "day" }]],
  devices: [
    ["device.list", {}],
    ["device.list", { ssid: "guest" }],
    ["eero.list"],
    ["profile.list"],
    ["usage.breakdown", { range: "day", by: "device" }],
    // Live rates while the page shows them (useLiveRates).
    ["device.rates.refresh", undefined, POLL.rates],
  ],
  eero: [
    ["eero.get", { eero: EERO }],
    ["eero.list"],
    ["network.health"],
    ["internet.get"],
    ["usage.breakdown", { range: "day", by: "eero" }],
    ["usage.breakdown", { range: "day", by: "device" }],
    ["usage.get", { scope: "eero", id: EERO, range: "day" }],
    ["device.list", { eero: EERO, connected: true }],
    ["eero.ports.get", { eero: EERO }],
    ["updates.get"],
  ],
  "reservations & ports": [["reservation.list"], ["forward.list"], ["pinhole.list"], ["device.list", undefined, 60], ["eero.list"], ["settings.get"]],
  troubleshooting: [["eero.list"], ["health.check"], ["wifi.get"], ["settings.get"]],
  // Settings: app.info and app.audit.list poll but never reach eero; auth.status, app.settings.get,
  // notifications.settings.get and the weekly events.summary are read on open (engine.md, Polling intervals).
  // The networks table shares the shell switcher's 60 s network.list.
  "settings & account": [["account.get"], ["app.info"], ["app.audit.list"], ["network.list", undefined, 60]],
};

const roomy = () => new RateLimiter({ perWindow: 10_000 });

function setup() {
  const fake = createFakeEero();
  const token = fake.signIn();
  const secrets: SecretStore = { load: async () => token, save: async () => "memory", clear: async () => {}, storage: async () => "memory" };
  let t = Date.parse("2026-11-14T12:00:00Z");
  const clock = { now: () => t, advance: (sec: number) => (t += sec * 1000) };
  const backend = createEeroBackend({ secrets, origin: fake.origin, fetch: fake.fetch, readShareMs: 0, limiter: roomy() });
  return { fake, clock, engine: createEngine({ backend, clock: clock.now }) };
}

const key = ([id, params]: Poll) => `${id} ${JSON.stringify(params ?? {})}`;

/** The page's polls with their intervals, one per id and params at the shortest interval asked for. */
function polls(engine: Engine, page: Poll[]): Map<string, { poll: Poll; sec: number }> {
  const registry = new Map(engine.commands().map((c) => [c.id, c.poll]));
  const out = new Map<string, { poll: Poll; sec: number }>();
  for (const p of [...SHELL, ...page]) {
    const sec = p[2] ?? registry.get(p[0]) ?? undefined;
    if (sec === undefined) throw new Error(`${p[0]} is polled by the page but has no poll interval`);
    const prev = out.get(key(p));
    out.set(key(p), { poll: p, sec: Math.min(sec, prev?.sec ?? sec) });
  }
  return out;
}

/** Requests in each minute of a ten minute stay, after the page loaded. */
async function stay(page: Poll[]): Promise<number[]> {
  const s = setup();
  fake = s.fake;
  const due = polls(s.engine, page);
  const run = async (p: Poll) => {
    const r = await s.engine.execute(p[0], p[1]);
    if (!r.ok) throw new Error(`${p[0]}: ${r.error.code} ${r.error.message}`);
  };
  for (const { poll } of due.values()) await run(poll);
  const perMinute: number[] = [];
  for (let minute = 1; minute <= 10; minute++) {
    s.clock.advance(60);
    const before = s.fake.log.length;
    for (const { poll, sec } of due.values()) if ((minute * 60) % sec === 0) await run(poll);
    // While a burst is live the renderer reads devices again every few seconds (useLiveRates, #254). Other
    // device.list views on the page share those GETs in the client's 5 s read share, so one fresh read each.
    if (due.has(key(["device.rates.refresh"]))) {
      for (const _ of burstReadTimes(0)) {
        const r = await s.engine.execute("device.list", {}, { fresh: true });
        if (!r.ok) throw new Error(`device.list: ${r.error.code} ${r.error.message}`);
      }
    }
    perMinute.push(s.fake.log.length - before);
  }
  return perMinute;
}

let fake: FakeEero | null = null;
afterEach(async () => {
  await fake?.close();
  fake = null;
});

describe("polling budget with a page open", () => {
  it("keeps every TTL under its poll interval, so each poll reaches eero", () => {
    // events.summary pages through history, so it keeps a 2 minute cache on purpose; events.list carries the live part.
    const exempt = new Set(["events.summary"]);
    const polled = allCommands().filter((c) => c.poll !== undefined && c.topic !== undefined && typeof c.ttl !== "function" && !exempt.has(c.id));
    expect(polled.map((c) => c.id)).toEqual(expect.arrayContaining(["settings.get", "integrations.get", "wifi.get", "guest.get", "network.get"]));
    for (const c of polled) expect(c.ttl ?? TTL[c.topic as keyof typeof TTL], c.id).toBeLessThan(c.poll as number);
  });

  it.each(Object.keys(PAGES))("the %s page stays under the request budget while it polls", async (name) => {
    const perMinute = await stay(PAGES[name] ?? []);
    // eero allows about 100 a minute and the client keeps to 80. A typical minute stays under half of that;
    // the busiest (every tenth, when the 5 minute usage polls and the 10 minute account read line up) under 80.
    // Measured upper bounds at M5.R-fix9: overview 31 typical, 64 busiest; the rest lower (docs/architecture/engine.md).
    expect(perMinute[0], perMinute.join(" ")).toBeLessThanOrEqual(40);
    expect(Math.max(...perMinute), perMinute.join(" ")).toBeLessThanOrEqual(70);
  });
});

describe("outside changes", () => {
  it("Simple Setup turned on in the eero app shows on the next poll of settings.get, with no manual refresh", async () => {
    const s = setup();
    fake = s.fake;
    const poll = s.engine.commands().find((c) => c.id === "settings.get")?.poll;
    expect(poll).toBe(POLL.settings);
    const read = async () => {
      const r = await s.engine.execute<NetworkSettings>("settings.get", { networkId: "100002" });
      if (!r.ok) throw new Error(r.error.message);
      return r.result.simpleSetup;
    };
    expect(await read()).toBe(false);
    // Someone turns eero Simple Setup on in the phone app.
    const lake = s.fake.state.networks.get("100002");
    if (!lake) throw new Error("fixture");
    lake.network.auto_setup_mode = "ZTS";
    // The next poll, as the renderer's timer runs it: no `fresh`, the engine cache decides.
    s.clock.advance(poll ?? Number.POSITIVE_INFINITY);
    expect(await read()).toBe(true);
  });
});
