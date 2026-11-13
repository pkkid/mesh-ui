import { describe, expect, it } from "vitest";
import { createFakeEero, type FakeEero } from "../../../test/fake-eero/server";
import { composeBackend, type SecretStore } from "../backend";
import { createDemoBackend } from "../demo";
import { createEeroBackend } from "../eero/backend";
import { eventCategory, mapEvent } from "../eero/backend/events";
import { createEngine } from "../engine";
import type { RawEvent } from "../eero/raw";
import type * as M from "../model";
import { EVENT_CATEGORIES, MAX_PAGES_PER_CALL } from "./activity";

const NOW = Date.parse("2026-11-12T22:41:00Z");
const MAPLE = "4821907";

function demoEngine() {
  const backend = createDemoBackend({ clock: () => NOW });
  return { backend, engine: createEngine({ backend, clock: () => NOW }) };
}

async function ok<R>(p: Promise<{ ok: true; result: R } | { ok: false; error: unknown }>): Promise<R> {
  const r = await p;
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
  return r.result;
}

/** Every event of a network straight from the backend, newest first. */
async function allEvents(backend: ReturnType<typeof createDemoBackend>, net = MAPLE): Promise<M.NetworkEvent[]> {
  const out: M.NetworkEvent[] = [];
  let cursor: string | null = null;
  do {
    const chunk = await backend.events.list(net, cursor);
    out.push(...chunk.events);
    cursor = chunk.nextCursor;
  } while (cursor);
  return out;
}

describe("events.list on the demo backend", () => {
  it("pages newest first with a cursor until every event is seen once", async () => {
    const { engine, backend } = demoEngine();
    const all = await allEvents(backend);
    expect(all.length).toBeGreaterThan(100);
    const seen: M.NetworkEvent[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 20; i++) {
      const page: M.EventPage = await ok(engine.execute<M.EventPage>("events.list", cursor ? { cursor, limit: 40 } : { limit: 40 }));
      expect(page.events.length).toBeLessThanOrEqual(40);
      seen.push(...page.events);
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(seen.map((e) => e.id)).toEqual(all.map((e) => e.id));
    for (let i = 1; i < seen.length; i++) expect((seen[i - 1] as M.NetworkEvent).at >= (seen[i] as M.NetworkEvent).at).toBe(true);
  });

  it("returns the latest 3 for Recent activity, with counts per category for that page", async () => {
    const { engine, backend } = demoEngine();
    const page = await ok(engine.execute<M.EventPage>("events.list", { limit: 3 }));
    expect(page.events.map((e) => e.id)).toEqual((await allEvents(backend)).slice(0, 3).map((e) => e.id));
    expect(page.events[0]?.title).toBe("Profile Leo paused by Alex Kim");
    expect(page.nextCursor).not.toBeNull();
    expect(Object.keys(page.counts).sort()).toEqual([...EVENT_CATEGORIES].sort());
    expect(Object.values(page.counts).reduce((a, b) => a + b, 0)).toBe(3);
    expect(page.counts.pause_block).toBe(page.events.filter((e) => e.category === "pause_block").length);
  });

  it("filters by category across backend pages", async () => {
    const { engine, backend } = demoEngine();
    const firmware = (await allEvents(backend)).filter((e) => e.category === "firmware" || e.category === "speed_tests");
    const page = await ok(engine.execute<M.EventPage>("events.list", { type: ["firmware", "speed_tests"] }));
    expect(page.events.map((e) => e.id)).toEqual(firmware.slice(0, 50).map((e) => e.id));
    expect(page.counts.firmware + page.counts.speed_tests).toBe(page.events.length);
    expect(page.counts.devices).toBe(0);
  });

  it("filters by device, eero and profile refs given by name", async () => {
    const { engine, backend } = demoEngine();
    const all = await allEvents(backend);
    const garage = (await backend.eero.list(MAPLE)).find((e) => e.location === "Garage") as M.Eero;
    const byEero = await ok(engine.execute<M.EventPage>("events.list", { eero: "garage" }));
    expect(byEero.events.map((e) => e.id)).toEqual(all.filter((e) => e.refs.eeroId === garage.id).slice(0, 50).map((e) => e.id));
    const byProfile = await ok(engine.execute<M.EventPage>("events.list", { profile: "Mia" }));
    expect(byProfile.events.length).toBeGreaterThan(0);
    expect(byProfile.events.every((e) => e.refs.profileId === byProfile.events[0]?.refs.profileId)).toBe(true);
    const byDevice = await ok(engine.execute<M.EventPage>("events.list", { device: "Nest Thermostat" }));
    expect(byDevice.events.map((e) => e.title)).toContain("New device joined: Nest Thermostat");
    expect(await engine.execute("events.list", { device: "No Such Device" })).toMatchObject({ ok: false, error: { code: "bad_params" } });
  });

  it("filters by text and by time", async () => {
    const { engine, backend } = demoEngine();
    const all = await allEvents(backend);
    const search = await ok(engine.execute<M.EventPage>("events.list", { search: "GRANDMA" }));
    expect(search.events.map((e) => e.title)).toContain("New device joined: Grandma's iPad");
    expect(search.events.every((e) => `${e.title} ${e.detail}`.toLowerCase().includes("grandma"))).toBe(true);

    const since = new Date(NOW - 3 * 3_600_000).toISOString();
    const until = new Date(NOW - 3_600_000).toISOString();
    const window = await ok(engine.execute<M.EventPage>("events.list", { since, until }));
    const expected = all.filter((e) => e.at >= since && e.at <= until);
    expect(expected.length).toBeGreaterThan(0);
    expect(window.events.map((e) => e.id)).toEqual(expected.slice(0, 50).map((e) => e.id));
    expect(window.nextCursor).toBeNull();
  });

  it("exports the page as CSV", async () => {
    const { engine } = demoEngine();
    const json = await ok(engine.execute<M.EventPage>("events.list", { limit: 5 }));
    const csv = await ok(engine.execute<string>("events.list", { limit: 5, format: "csv" }));
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("Time,Category,Type,Title,Detail");
    expect(lines).toHaveLength(7);
    const first = json.events[0] as M.NetworkEvent;
    expect(lines[1]?.startsWith(`${first.at},${first.category},${first.type},`)).toBe(true);
  });

  it("rejects bad params", async () => {
    const { engine } = demoEngine();
    for (const params of [
      { limit: 0 },
      { limit: 51 },
      { type: ["parties"] },
      { type: [] },
      { cursor: "not-a-cursor" },
      { since: "yesterday" },
      { since: "2026-11-12T00:00:00Z", until: "2026-11-11T00:00:00Z" },
      { format: "xml" },
      { grouped: true, unknown: 1 },
    ]) {
      expect(await engine.execute("events.list", params)).toMatchObject({ ok: false, error: { code: "bad_params" } });
    }
  });

  it("stops after a fixed number of backend pages and hands back a cursor", async () => {
    let calls = 0;
    const demo = createDemoBackend({ clock: () => NOW });
    const backend = composeBackend("demo", {
      auth: demo.auth,
      network: demo.network,
      events: {
        list: async (_net, cursor) => {
          calls++;
          const n = cursor ? Number(cursor) : 0;
          const at = new Date(NOW - n * 60_000).toISOString();
          return { events: [{ id: `e${n}`, at, category: "other", type: "x", title: "Nothing to see", detail: null, refs: {} }], nextCursor: String(n + 1) };
        },
      },
    });
    const engine = createEngine({ backend, clock: () => NOW });
    const page = await ok(engine.execute<M.EventPage>("events.list", { type: ["firmware"] }));
    expect(calls).toBe(MAX_PAGES_PER_CALL);
    expect(page.events).toEqual([]);
    expect(page.nextCursor).not.toBeNull();
    await ok(engine.execute<M.EventPage>("events.list", { type: ["firmware"], cursor: page.nextCursor as string }));
    expect(calls).toBe(2 * MAX_PAGES_PER_CALL);
  });
});

describe("event categories", () => {
  it("maps every demo event type to the category the demo gives it", async () => {
    const { backend } = demoEngine();
    for (const net of await backend.network.list()) {
      for (const e of await allEvents(backend, net.id)) expect([e.type, eventCategory(e.type)]).toEqual([e.type, e.category]);
    }
  });

  it("maps dotted eero types and sends unknown ones to other", () => {
    expect(eventCategory("device.connected")).toBe("devices");
    expect(eventCategory("profile.paused")).toBe("pause_block");
    expect(eventCategory("eero.offline")).toBe("eero_status");
    expect(eventCategory("speed_test.completed")).toBe("speed_tests");
    expect(eventCategory("something_new")).toBe("other");
  });

  it("maps a raw event's refs, title and detail, and skips events without a time", () => {
    const raw: RawEvent = {
      id: 9,
      event_type: "device.connected",
      title: "Phone connected",
      message: "Living Room · 5 GHz",
      created: "2026-11-12T17:50:00Z",
      device: { mac: "0A:1B:2C:00:00:01" },
      eero: { url: "/2.2/eeros/500001" },
      profile: { url: "/2.2/networks/100001/profiles/700" },
    };
    expect(mapEvent(raw)).toEqual({
      id: "9",
      at: "2026-11-12T17:50:00.000Z",
      category: "devices",
      type: "device.connected",
      title: "Phone connected",
      detail: "Living Room · 5 GHz",
      refs: { deviceId: "0a1b2c000001", eeroId: "500001", profileId: "700" },
    });
    expect(mapEvent({ event_type: "x", message: "Only a message", timestamp: "2026-11-12T17:50:00Z" })).toMatchObject({ title: "Only a message", detail: null, id: "x@2026-11-12T17:50:00.000Z" });
    expect(mapEvent({ event_type: "x", title: "No time" })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The real eero client against the fake eero server

function memorySecrets(token: string): SecretStore {
  let t: string | null = token;
  return { load: async () => t, save: async (v) => ((t = v), "keychain"), clear: async () => void (t = null), storage: async () => "keychain" };
}

const FAKE_NET = "100001";
const FAKE_NOW = Date.parse("2026-11-12T18:20:00Z");

function fakeEngine() {
  const fake: FakeEero = createFakeEero({ now: () => FAKE_NOW });
  const live = createEeroBackend({ secrets: memorySecrets(fake.signIn()), origin: fake.origin, fetch: fake.fetch });
  const summary = { id: FAKE_NET, name: "Maple Street", nickname: null, role: "owner", status: "online", eeroCount: null, devicesOnline: null, isp: null, updateAvailable: null, lastSeen: null, selected: false } as const;
  const backend = composeBackend("eero", {
    auth: { ...live.auth, status: async () => ({ signedIn: true, pending: false, login: null, storage: "keychain" }) },
    network: { ...live.network, list: async () => [{ ...summary }] },
    events: live.events,
  });
  return { fake, engine: createEngine({ backend, clock: () => FAKE_NOW }) };
}

const eventRequests = (fake: FakeEero) => fake.log.filter((e) => e.path.endsWith("/app_events"));

describe("events.list on the fake eero server", () => {
  it("maps app_events to model events with categories", async () => {
    const { fake, engine } = fakeEngine();
    const page = await ok(engine.execute<M.EventPage>("events.list", {}));
    expect(page.events.map((e) => [e.title, e.category, e.type])).toEqual([
      ["Alex's Phone connected", "devices", "device.connected"],
      ["Leo was paused", "pause_block", "profile.paused"],
      ["Garage went offline", "eero_status", "eero.offline"],
    ]);
    expect(page.nextCursor).toBeNull();
    const [req] = eventRequests(fake);
    expect(req?.path).toBe(`/2.2/networks/${FAKE_NET}/app_events`);
    expect(Object.fromEntries(new URLSearchParams(req?.query))).toEqual({ page_size: "50" });
  });

  it("pages with the created time of the last event as the timestamp cursor", async () => {
    const { fake, engine } = fakeEngine();
    const net = fake.state.networks.get(FAKE_NET);
    for (let i = 0; i < 120; i++) {
      net?.events.push({ id: 100 + i, event_type: "eero.channel_changed", title: `Filler ${i}`, created: new Date(Date.parse("2026-11-11T00:00:00Z") - i * 60_000).toISOString() });
    }
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const page: M.EventPage = await ok(engine.execute<M.EventPage>("events.list", cursor ? { cursor } : {}));
      ids.push(...page.events.map((e) => e.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(ids).toHaveLength(123);
    expect(new Set(ids).size).toBe(123);
    const stamps = eventRequests(fake).map((e) => new URLSearchParams(e.query).get("timestamp"));
    expect(stamps[0]).toBeNull();
    expect(stamps.slice(1).every((s) => s !== null && Number.isFinite(Date.parse(s)))).toBe(true);
    expect(eventRequests(fake).every((e) => e.body === "" && new URLSearchParams(e.query).get("page_size") === "50")).toBe(true);
  });

  it("exports CSV from eero events with the formula guard", async () => {
    const { fake, engine } = fakeEngine();
    fake.state.networks.get(FAKE_NET)?.events.push({ id: 99, event_type: "device.renamed", title: "=HYPERLINK(\"x\")", created: "2026-11-12T18:00:00Z" });
    const csv = await ok(engine.execute<string>("events.list", { limit: 1, format: "csv" }));
    expect(csv).toBe('Time,Category,Type,Title,Detail\r\n2026-11-12T18:00:00.000Z,devices,device.renamed,"\'=HYPERLINK(""x"")",\r\n');
  });
});
