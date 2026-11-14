import { describe, expect, it } from "vitest";
import { createFakeEero, type FakeEero } from "../../../test/fake-eero/server";
import { composeBackend, type SecretStore } from "../backend";
import { createDemoBackend } from "../demo";
import { createEeroBackend } from "../eero/backend";
import { eventCategory, mapEvent } from "../eero/backend/events";
import { createEngine } from "../engine";
import type { RawAppEvent } from "../eero/raw";
import type * as M from "../model";
import { EVENT_CATEGORIES, GROUP_WINDOW_MS, groupEvents, MAX_PAGES_PER_CALL, MAX_SUMMARY_PAGES } from "./activity";

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

describe("events.list grouping", () => {
  const ev = (id: string, min: number, title = "Garage mesh link dropped to 2 bars", type = "eero_mesh_quality_changed"): M.NetworkEvent => ({
    id,
    at: new Date(NOW - min * 60_000).toISOString(),
    category: "eero_status",
    type,
    title,
    detail: null,
    refs: {},
  });

  it("folds repeats of the same type and title within the window into the newest row", () => {
    const rows = groupEvents([ev("a", 0), ev("b", 5, "Other"), ev("c", 30), ev("d", 30 + GROUP_WINDOW_MS / 60_000 + 1)]);
    expect(rows.map((r) => [r.id, r.grouped?.map((g) => g.id)])).toEqual([
      ["a", ["c"]],
      ["b", undefined],
      ["d", undefined],
    ]);
  });

  it("groups the demo's repeated mesh link drop and keeps every event in the page", async () => {
    const { engine } = demoEngine();
    const raw = await ok(engine.execute<M.EventPage>("events.list", { eero: "Garage" }));
    const grouped = await ok(engine.execute<M.EventPage>("events.list", { eero: "Garage", grouped: true }));
    const drop = grouped.events.find((e) => e.title === "Garage mesh link dropped to 2 bars");
    expect(drop?.grouped).toHaveLength(1);
    const flat = grouped.events.flatMap((e) => [e, ...(e.grouped ?? [])]);
    expect(flat.map((e) => e.id).sort()).toEqual(raw.events.map((e) => e.id).sort());
    expect(grouped.events.length).toBeLessThan(raw.events.length);
    expect(grouped.nextCursor).toBe(raw.nextCursor);
    // CSV stays one line per event.
    const csv = await ok(engine.execute<string>("events.list", { eero: "Garage", grouped: true, format: "csv" }));
    expect(csv.trimEnd().split("\r\n")).toHaveLength(raw.events.length + 1);
  });
});

describe("events.summary on the demo backend", () => {
  it("counts the week by category and by day, with the daily average", async () => {
    const { engine, backend } = demoEngine();
    const s = await ok(engine.execute<M.EventSummary>("events.summary", { range: "week" }));
    const from = Date.parse(s.from);
    const inWeek = (await allEvents(backend)).filter((e) => Date.parse(e.at) >= from && Date.parse(e.at) <= NOW);
    expect(s.bucket).toBe("day");
    expect(s.total).toBe(inWeek.length);
    expect(s.total).toBeGreaterThan(300);
    expect(s.dailyAverage).toBeCloseTo(s.total / 7);
    for (const c of EVENT_CATEGORIES) expect(s.counts[c]).toBe(inWeek.filter((e) => e.category === c).length);
    expect(s.buckets).toHaveLength(7);
    expect(s.buckets.reduce((n, b) => n + b.total, 0)).toBe(s.total);
    for (const b of s.buckets) expect(Object.values(b.counts).reduce((n, v) => n + v, 0)).toBe(b.total);
    // Demo history is 7 days, so the week before is unknown.
    expect(s.prior).toBeNull();
    expect(s.change).toBeNull();
    expect(s.partial).toBe(false);
    const hourly = await ok(engine.execute<M.EventSummary>("events.summary", { range: "week", bucket: "hour" }));
    expect(hourly.buckets.length).toBeGreaterThanOrEqual(6 * 24 + 1);
    expect(hourly.total).toBe(s.total);
  });

  it("compares the last day with the day before it", async () => {
    const { engine, backend } = demoEngine();
    const s = await ok(engine.execute<M.EventSummary>("events.summary", { range: "day" }));
    const from = Date.parse(s.from);
    const priorFrom = from - (NOW - from);
    const all = await allEvents(backend);
    const day = all.filter((e) => Date.parse(e.at) >= from && Date.parse(e.at) <= NOW).length;
    const before = all.filter((e) => Date.parse(e.at) >= priorFrom && Date.parse(e.at) < from).length;
    expect(s.bucket).toBe("hour");
    expect(s.buckets).toHaveLength(24);
    expect(s.total).toBe(day);
    expect(s.dailyAverage).toBe(day);
    expect(s.prior).toBe(before);
    expect(before).toBeGreaterThan(0);
    expect(s.change).toBeCloseTo((day - before) / before);
  });

  it("applies type, device, eero and profile filters", async () => {
    const { engine, backend } = demoEngine();
    const all = await allEvents(backend);
    const s = await ok(engine.execute<M.EventSummary>("events.summary", { range: "week" }));
    const from = Date.parse(s.from);
    const week = all.filter((e) => Date.parse(e.at) >= from);
    const fw = await ok(engine.execute<M.EventSummary>("events.summary", { range: "week", type: ["firmware"] }));
    expect(fw.total).toBe(week.filter((e) => e.category === "firmware").length);
    expect(fw.counts.devices).toBe(0);
    const garage = (await backend.eero.list(MAPLE)).find((e) => e.location === "Garage") as M.Eero;
    const byEero = await ok(engine.execute<M.EventSummary>("events.summary", { range: "week", eero: "Garage" }));
    expect(byEero.total).toBe(week.filter((e) => e.refs.eeroId === garage.id).length);
    const byProfile = await ok(engine.execute<M.EventSummary>("events.summary", { range: "week", profile: "Mia" }));
    expect(byProfile.total).toBeGreaterThan(0);
    const byDevice = await ok(engine.execute<M.EventSummary>("events.summary", { range: "week", device: "Nest Thermostat" }));
    expect(byDevice.total).toBeGreaterThan(0);
  });

  it("counts no device events on the empty_network scenario, and zeros for a filter with no matches", async () => {
    const { engine } = demoEngine();
    await ok(engine.execute("demo.scenario.set", { scenario: "empty_network" }));
    const s = await ok(engine.execute<M.EventSummary>("events.summary", { range: "week" }));
    expect(s.counts.devices + s.counts.pause_block + s.counts.schedules).toBe(0);
    const none = await ok(engine.execute<M.EventSummary>("events.summary", { range: "week", type: ["devices"] }));
    expect(none.total).toBe(0);
    expect(none.buckets.every((b) => b.total === 0)).toBe(true);
    expect(none.change).toBeNull();
  });

  it("rejects bad params", async () => {
    const { engine } = demoEngine();
    for (const params of [{}, { range: "month" }, { range: "week", bucket: "minute" }, { range: "week", type: [] }, { range: "week", type: ["parties"] }, { range: "week", device: "No Such Device" }, { range: "week", extra: 1 }]) {
      expect(await engine.execute("events.summary", params)).toMatchObject({ ok: false, error: { code: "bad_params" } });
    }
  });

  it("stops at the page budget and says the counts are partial", async () => {
    let calls = 0;
    const demo = createDemoBackend({ clock: () => NOW });
    const backend = composeBackend("demo", {
      auth: demo.auth,
      network: demo.network,
      events: {
        list: async (_net, cursor) => {
          calls++;
          const n = cursor ? Number(cursor) : 0;
          // One event a second: the budget runs out long before a day back.
          const events = Array.from({ length: 50 }, (_, i): M.NetworkEvent => ({ id: `e${n + i}`, at: new Date(NOW - (n + i) * 1000).toISOString(), category: "other", type: "x", title: "Busy", detail: null, refs: {} }));
          return { events, nextCursor: String(n + 50) };
        },
      },
    });
    const engine = createEngine({ backend, clock: () => NOW });
    const s = await ok(engine.execute<M.EventSummary>("events.summary", { range: "day" }));
    expect(calls).toBe(MAX_SUMMARY_PAGES);
    expect(s.partial).toBe(true);
    expect(s.total).toBe(MAX_SUMMARY_PAGES * 50);
    expect(s.change).toBeNull();
  });
});

describe("filters on events without refs (the real eero stream)", () => {
  it("match a device, eero or profile by name in the event text", async () => {
    const demo = createDemoBackend({ clock: () => NOW });
    const at = (m: number) => new Date(NOW - m * 60_000).toISOString();
    const events: M.NetworkEvent[] = [
      { id: "1", at: at(1), category: "devices", type: "device", title: "Nest Thermostat connected", detail: null, refs: {} },
      { id: "2", at: at(2), category: "eero_status", type: "eero", title: "Garage went offline", detail: null, refs: {} },
      { id: "3", at: at(3), category: "pause_block", type: "profile", title: "Mia was paused", detail: null, refs: {} },
      { id: "4", at: at(4), category: "devices", type: "device", title: "Something else", detail: null, refs: { eeroId: "nope" } },
    ];
    const backend = composeBackend("demo", { ...demo, events: { list: async () => ({ events, nextCursor: null }) } });
    const engine = createEngine({ backend, clock: () => NOW });
    const ids = async (params: object) => (await ok(engine.execute<M.EventPage>("events.list", params))).events.map((e) => e.id);
    expect(await ids({ device: "Nest Thermostat" })).toEqual(["1"]);
    expect(await ids({ eero: "Garage" })).toEqual(["2"]);
    expect(await ids({ profile: "Mia" })).toEqual(["3"]);
  });
});

describe("event categories", () => {
  it("maps every demo event type to the category the demo gives it", async () => {
    const { backend } = demoEngine();
    for (const net of await backend.network.list()) {
      for (const e of await allEvents(backend, net.id)) expect([e.type, eventCategory(e.type)]).toEqual([e.type, e.category]);
    }
  });

  it("maps dotted types, the real stream's bare nouns by their description, and sends unknown ones to other", () => {
    expect(eventCategory("device.connected")).toBe("devices");
    expect(eventCategory("profile.paused")).toBe("pause_block");
    expect(eventCategory("eero.offline")).toBe("eero_status");
    expect(eventCategory("speed_test.completed")).toBe("speed_tests");
    expect(eventCategory("something_new")).toBe("other");
    expect(eventCategory("device", "Alex's Phone connected")).toBe("devices");
    expect(eventCategory("profile", "Leo was paused")).toBe("pause_block");
    expect(eventCategory("eero", "Garage went offline")).toBe("eero_status");
    expect(eventCategory("network", "eeroOS 7.13.0 installed")).toBe("firmware");
    expect(eventCategory("profile", "Bedtime schedule started")).toBe("schedules");
    expect(eventCategory("mystery", "Something happened")).toBe("other");
  });

  it("maps a real app_events row and skips rows without a time", () => {
    const raw: RawAppEvent = { hash: "abc123", timestamp_ms: Date.parse("2026-11-12T17:50:00Z"), description: "Phone connected", category: "device" };
    expect(mapEvent(raw)).toEqual({
      id: "abc123",
      at: "2026-11-12T17:50:00.000Z",
      category: "devices",
      type: "device",
      title: "Phone connected",
      detail: null,
      refs: {},
    });
    expect(mapEvent({ timestamp_ms: Date.parse("2026-11-12T17:50:00Z") })).toMatchObject({ title: "unknown", id: "unknown@2026-11-12T17:50:00.000Z", category: "other" });
    expect(mapEvent({ description: "No time", category: "device" })).toBeNull();
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
      ["Alex's Phone connected", "devices", "device"],
      ["Leo was paused", "pause_block", "profile"],
      ["Garage went offline", "eero_status", "eero"],
    ]);
    expect(page.nextCursor).toBeNull();
    const [req] = eventRequests(fake);
    expect(req?.path).toBe(`/2.2/networks/${FAKE_NET}/app_events`);
    expect(Object.fromEntries(new URLSearchParams(req?.query))).toEqual({ page_size: "50" });
  });

  it("pages with the time of the last event as the timestamp cursor", async () => {
    const { fake, engine } = fakeEngine();
    const net = fake.state.networks.get(FAKE_NET);
    for (let i = 0; i < 120; i++) {
      net?.appEvents.push({ hash: `filler-${i}`, category: "eero", description: `Filler ${i}`, timestamp_ms: Date.parse("2026-11-11T00:00:00Z") - i * 60_000 });
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
    fake.state.networks.get(FAKE_NET)?.appEvents.push({ hash: "x99", category: "device", description: "=HYPERLINK(\"x\")", timestamp_ms: Date.parse("2026-11-12T18:00:00Z") });
    const csv = await ok(engine.execute<string>("events.list", { limit: 1, format: "csv" }));
    expect(csv).toBe('Time,Category,Type,Title,Detail\r\n2026-11-12T18:00:00.000Z,devices,device,"\'=HYPERLINK(""x"")",\r\n');
  });
});

describe("events.summary on the fake eero server", () => {
  /** A busy week: one event every `stepMin` minutes for `days` days before FAKE_NOW. */
  function seedWeek(fake: FakeEero, stepMin: number, days: number) {
    const net = fake.state.networks.get(FAKE_NET);
    if (!net) throw new Error("no fake network");
    net.appEvents = [];
    for (let m = 1; m <= days * 24 * 60; m += stepMin) {
      net.appEvents.push({ hash: `h${m}`, category: m % 3 ? "device" : "eero", description: m % 3 ? "Phone connected" : "Garage went offline", timestamp_ms: FAKE_NOW - m * 60_000 });
    }
    return net.appEvents.length;
  }

  it("pages back to the range start with the timestamp cursor and counts every event once", async () => {
    const { fake, engine } = fakeEngine();
    seedWeek(fake, 30, 9); // 48 a day, 432 in 9 days
    const s = await ok(engine.execute<M.EventSummary>("events.summary", { range: "week" }));
    const from = Date.parse(s.from);
    const net = fake.state.networks.get(FAKE_NET);
    const expected = (net?.appEvents ?? []).filter((e) => (e.timestamp_ms ?? 0) >= from).length;
    expect(s.total).toBe(expected);
    expect(s.counts.devices + s.counts.eero_status).toBe(expected);
    expect(s.partial).toBe(false);
    // Stops once past the prior week's start (9 days of history: fewer pages than the whole log).
    const reqs = eventRequests(fake);
    expect(reqs.length).toBeLessThanOrEqual(Math.ceil(432 / 50));
    expect(reqs.length).toBeLessThanOrEqual(MAX_SUMMARY_PAGES);
    const stamps = reqs.map((e) => new URLSearchParams(e.query).get("timestamp"));
    expect(stamps[0]).toBeNull();
    expect(new Set(stamps).size).toBe(stamps.length);
  });

  it("keeps a very busy week within the page budget", async () => {
    const { fake, engine } = fakeEngine();
    seedWeek(fake, 5, 8); // 288 a day, about 2,300 events
    const s = await ok(engine.execute<M.EventSummary>("events.summary", { range: "week" }));
    expect(eventRequests(fake)).toHaveLength(MAX_SUMMARY_PAGES);
    expect(s.partial).toBe(true);
    expect(s.total).toBe(MAX_SUMMARY_PAGES * 50);
  });

  it("loads the Activity page well under the request budget", async () => {
    const { fake, engine } = fakeEngine();
    seedWeek(fake, 30, 7);
    // What ActivityPage mounts at once: chart, day strips, the grouped stream.
    const page: [string, unknown][] = [
      ["events.summary", { range: "week", bucket: "day" }],
      ["events.summary", { range: "week", bucket: "hour" }],
      ["events.list", { grouped: true }],
    ];
    const results = await Promise.all(page.map(([id, params]) => engine.execute(id, params)));
    expect(results.every((r) => r.ok)).toBe(true);
    const first = fake.log.length;
    // Seven pages of 50 for the week, at most twice (the two summaries) plus the stream's first page.
    expect(first).toBeLessThanOrEqual(2 * 8 + 2);
    // A poll inside the summary TTL reads only what is stale.
    await Promise.all(page.map(([id, params]) => engine.execute(id, params)));
    expect(fake.log.length - first).toBeLessThanOrEqual(1);
  });
});
