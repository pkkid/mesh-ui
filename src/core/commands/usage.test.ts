import { describe, expect, it } from "vitest";
import { createFakeEero, type FakeEero } from "../../../test/fake-eero/server";
import { type Backend, composeBackend, type SecretStore, type UsageQuery } from "../backend";
import { createDemoBackend } from "../demo";
import { dayStart, hourStart } from "../demo/backend";
import { createEeroBackend } from "../eero/backend";
import { createEngine } from "../engine";
import type * as M from "../model";
import { finishSeries, hourlyAverages, quietHours, USAGE_MAX_DAYS, usageWindow, windowAverage } from "./usage";

// Thursday Nov 12 2026, 2:41 PM in Los Angeles, as in the mockups.
const NOW = Date.parse("2026-11-12T22:41:00Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const TZ = "America/Los_Angeles";
const iso = (ms: number) => new Date(ms).toISOString();
const bytes = (p: { down: number; up: number }) => p.down + p.up;
const sumOf = (xs: { down: number; up: number }[]) => xs.reduce((n, x) => n + bytes(x), 0);

function demoEngine(clock = () => NOW) {
  const backend = createDemoBackend({ clock });
  return { backend, engine: createEngine({ backend, clock }) };
}

async function ok<R>(p: Promise<{ ok: true; result: R } | { ok: false; error: unknown }>): Promise<R> {
  const r = await p;
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
  return r.result;
}

describe("usageWindow and the 7-day limit", () => {
  it("covers the last 24 local hours for day and 7 local days for week", () => {
    const day = usageWindow("day", undefined, NOW, TZ);
    expect(day).toEqual({ from: hourStart(NOW, TZ) - 23 * HOUR, to: NOW, cadence: "hourly" });
    const week = usageWindow("week", undefined, NOW, TZ);
    expect(week).toEqual({ from: dayStart(NOW - 6 * DAY, TZ), to: NOW, cadence: "daily" });
    expect(iso(week.from)).toBe("2026-11-06T08:00:00.000Z"); // Friday midnight in Los Angeles
    expect(usageWindow("week", "hourly", NOW, TZ).cadence).toBe("hourly");
  });

  it("clamps the week to 7 days when a DST change makes 7 local days longer", () => {
    // Saturday Nov 7 2026, 11:30 PM in New York; DST ended on Sunday Nov 1.
    const now = Date.parse("2026-11-08T04:30:00Z");
    const tz = "America/New_York";
    expect(now - dayStart(now - 6 * DAY, tz)).toBeGreaterThan(USAGE_MAX_DAYS * DAY);
    const w = usageWindow("week", "hourly", now, tz);
    expect(w.from).toBe(now - USAGE_MAX_DAYS * DAY);
  });

  it("drops points older than the window or in the future and recomputes the figures", () => {
    const w = usageWindow("day", undefined, NOW, TZ);
    const at = (ms: number) => ({ at: iso(ms), down: 100, up: 10 });
    const raw: M.UsageSeries = {
      scope: "network",
      id: null,
      range: "day",
      cadence: "hourly",
      points: [at(NOW - 10 * DAY), at(NOW - 8 * DAY), at(w.from), { at: iso(w.from + HOUR), down: 900, up: 90 }, at(hourStart(NOW, TZ)), at(NOW + HOUR)],
      total: { down: 999_999, up: 999_999 },
      busiest: null,
      todaySoFar: 12345,
    };
    const s = finishSeries(raw, w, TZ);
    expect(s.points.map((p) => p.at)).toEqual([iso(w.from), iso(w.from + HOUR), iso(hourStart(NOW, TZ))]);
    expect(s.total).toEqual({ down: 1100, up: 110 });
    expect(s.busiest).toEqual({ at: iso(w.from + HOUR), down: 900, up: 90 });
    // Only the current hour is after local midnight on Nov 12.
    expect(s.todaySoFar).toBe(110);
  });

  it("never asks a backend for more than 7 days, and never shows older points", async () => {
    const now = Date.parse("2026-11-08T04:30:00Z");
    const asked: UsageQuery[] = [];
    const demo = createDemoBackend({ clock: () => now });
    const backend: Backend = composeBackend("demo", {
      auth: demo.auth,
      network: { ...demo.network, get: async (id) => ({ ...(await demo.network.get(id)), timezone: "America/New_York" }) },
      usage: {
        series: async (_net, q) => {
          asked.push(q);
          const points = [-9, -8, -7.5, -6, -1, 0, 1].map((d) => ({ at: iso(now + d * DAY), down: 1, up: 1 }));
          return { scope: q.scope, id: q.id, range: q.range, cadence: q.cadence, points, total: { down: 0, up: 0 }, busiest: null, todaySoFar: null };
        },
        breakdown: demo.usage.breakdown,
      },
    });
    const engine = createEngine({ backend, clock: () => now });
    const s = await ok(engine.execute<M.UsageSeries>("usage.get", { range: "week" }));
    expect(asked).toHaveLength(1);
    expect(Date.parse(asked[0]?.from ?? "")).toBeGreaterThanOrEqual(now - 7 * DAY);
    expect(asked[0]).toMatchObject({ timezone: "America/New_York", cadence: "daily", to: iso(now) });
    // The bucket at -7.5 days ends before the window starts; the one at +1 day is in the future.
    expect(s.points.map((p) => (Date.parse(p.at) - now) / DAY)).toEqual([-6, -1, 0]);
    expect(s.total).toEqual({ down: 3, up: 3 });
  });
});

describe("usage.get on the demo backend", () => {
  it("returns 24 hourly points for the network day with totals, busiest and today so far", async () => {
    const { engine, backend } = demoEngine();
    const s = await ok(engine.execute<M.UsageSeries>("usage.get", { scope: "network", range: "day" }));
    expect(s).toMatchObject({ scope: "network", id: null, range: "day", cadence: "hourly" });
    expect(s.points).toHaveLength(24);
    expect(s.points[0]?.at).toBe(iso(hourStart(NOW, TZ) - 23 * HOUR));
    expect(s.points.at(-1)?.at).toBe(iso(hourStart(NOW, TZ)));
    expect(s.total.down).toBe(s.points.reduce((n, p) => n + p.down, 0));
    expect(s.total.up).toBe(s.points.reduce((n, p) => n + p.up, 0));
    expect(bytes(s.busiest ?? { down: 0, up: 0 })).toBe(Math.max(...s.points.map(bytes)));
    const direct = await backend.usage.series("4821907", {
      scope: "network",
      id: null,
      range: "day",
      from: iso(hourStart(NOW, TZ) - 23 * HOUR),
      to: iso(NOW),
      cadence: "hourly",
      timezone: TZ,
    });
    expect(s.todaySoFar).toBe(direct.todaySoFar);
    expect(s.total).toEqual(direct.total);
  });

  it("defaults to the network day and week daily, and week hourly feeds the heatmap", async () => {
    const { engine } = demoEngine();
    const day = await ok(engine.execute<M.UsageSeries>("usage.get", {}));
    expect([day.scope, day.range, day.cadence, day.points.length]).toEqual(["network", "day", "hourly", 24]);
    const week = await ok(engine.execute<M.UsageSeries>("usage.get", { range: "week" }));
    expect([week.cadence, week.points.length]).toEqual(["daily", 7]);
    const heat = await ok(engine.execute<M.UsageSeries>("usage.get", { range: "week", cadence: "hourly" }));
    expect(heat.cadence).toBe("hourly");
    expect(heat.points.length).toBe(6 * 24 + new Date(NOW - 8 * HOUR).getUTCHours() + 1);
    expect(heat.points.every((p) => Date.parse(p.at) >= NOW - 7 * DAY && Date.parse(p.at) <= NOW)).toBe(true);
    // Same bytes whichever way the week is bucketed.
    expect(heat.total).toEqual(week.total);
  });

  it("resolves eero, device and profile by name", async () => {
    const { engine, backend } = demoEngine();
    const eeros = await backend.eero.list("4821907");
    const office = eeros.find((e) => e.location === "Office");
    const s = await ok(engine.execute<M.UsageSeries>("usage.get", { scope: "eero", id: "office" }));
    expect([s.scope, s.id]).toEqual(["eero", office?.id]);
    const devices = await backend.device.list("4821907");
    const device = devices.find((d) => d.connected && !d.paused) as M.Device;
    const d = await ok(engine.execute<M.UsageSeries>("usage.get", { scope: "device", id: device.name, range: "week" }));
    expect([d.scope, d.id, d.points.length]).toEqual(["device", device.id, 7]);
    const leo = await ok(engine.execute<M.UsageSeries>("usage.get", { scope: "profile", id: "Leo" }));
    expect(leo.scope).toBe("profile");
    const guest = await ok(engine.execute<M.UsageSeries>("usage.get", { scope: "guest" }));
    expect(guest.scope).toBe("guest");
  });

  it("returns one series per eero, and per profile plus Unassigned, that add up to the network", async () => {
    const { engine, backend } = demoEngine();
    const network = await ok(engine.execute<M.UsageSeries>("usage.get", { range: "day" }));
    const perEero = await ok(engine.execute<M.UsageSeries[]>("usage.get", { scope: "eero" }));
    expect(perEero.map((s) => s.id)).toEqual((await backend.eero.list("4821907")).map((e) => e.id));
    expect(perEero.every((s) => s.points.length === 24)).toBe(true);
    expect(sumOf(perEero.map((s) => s.total))).toBe(bytes(network.total));

    const perProfile = await ok(engine.execute<M.UsageSeries[]>("usage.get", { scope: "profile" }));
    const profiles = await backend.profile.list("4821907");
    expect(perProfile.map((s) => s.id)).toEqual([...profiles.map((p) => p.id), null]);
    expect(sumOf(perProfile.map((s) => s.total))).toBe(bytes(network.total));
    const unassigned = perProfile.at(-1) as M.UsageSeries;
    expect(unassigned.scope).toBe("profile");
    expect(bytes(unassigned.total)).toBeGreaterThan(0);
    expect(unassigned.todaySoFar).toBe(unassigned.points.filter((p) => Date.parse(p.at) >= dayStart(NOW, TZ)).reduce((n, p) => n + bytes(p), 0));
  });

  it("rejects bad params", async () => {
    const { engine } = demoEngine();
    const bad = async (params: unknown) => {
      const r = await engine.execute("usage.get", params);
      expect(r).toMatchObject({ ok: false, error: { code: "bad_params" } });
    };
    await bad({ range: "month" });
    await bad({ scope: "planet" });
    await bad({ cadence: "minutely" });
    await bad({ scope: "device" });
    await bad({ scope: "network", id: "Office" });
    await bad({ scope: "guest", id: "Office" });
    await bad({ scope: "eero", id: "Nowhere" });
    await bad({ scope: "network", from: "2026-01-01T00:00:00Z" });
  });
});

describe("usage.breakdown on the demo backend", () => {
  it("sorts device rows by total with shares of the network total", async () => {
    const { engine } = demoEngine();
    const b = await ok(engine.execute<M.UsageBreakdown>("usage.breakdown", { range: "day", by: "device" }));
    const network = await ok(engine.execute<M.UsageSeries>("usage.get", { range: "day" }));
    expect(b.total).toEqual(network.total);
    expect(b.rows.length).toBeGreaterThan(5);
    for (let i = 1; i < b.rows.length; i++) expect(bytes(b.rows[i - 1] as M.UsageBreakdownRow)).toBeGreaterThanOrEqual(bytes(b.rows[i] as M.UsageBreakdownRow));
    const top = b.rows[0] as M.UsageBreakdownRow;
    expect(top.share).toBe(Math.round((bytes(top) / bytes(b.total)) * 1000) / 10);
    const shares = b.rows.reduce((n, r) => n + r.share, 0);
    expect(shares).toBeGreaterThan(99);
    expect(shares).toBeLessThan(101);
  });

  it("breaks down by profile with Unassigned and by eero, adding up to the total", async () => {
    const { engine } = demoEngine();
    for (const by of ["profile", "eero"] as const) {
      const b = await ok(engine.execute<M.UsageBreakdown>("usage.breakdown", { range: "week", by }));
      expect(b.by).toBe(by);
      expect(sumOf(b.rows)).toBe(bytes(b.total));
      if (by === "profile") expect(b.rows.some((r) => r.id === null && r.name === "Unassigned")).toBe(true);
      else expect(b.rows.map((r) => r.name).sort()).toEqual(["Garage", "Living Room", "Office", "Upstairs Hall"]);
    }
  });

  it("limits device rows to one profile", async () => {
    const { engine, backend } = demoEngine();
    const leo = (await backend.profile.list("4821907")).find((p) => p.name === "Leo") as M.Profile;
    const b = await ok(engine.execute<M.UsageBreakdown>("usage.breakdown", { by: "device", profile: "leo" }));
    expect(b.rows.length).toBeGreaterThan(0);
    expect(b.rows.every((r) => r.id !== null && leo.deviceIds.includes(r.id))).toBe(true);
  });

  it("exports CSV with a header row and CRLF line endings", async () => {
    const { engine } = demoEngine();
    const json = await ok(engine.execute<M.UsageBreakdown>("usage.breakdown", { by: "eero" }));
    const csv = await ok(engine.execute<string>("usage.breakdown", { by: "eero", format: "csv" }));
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("Name,ID,Download (bytes),Upload (bytes),Total (bytes),Share (%)");
    expect(lines).toHaveLength(json.rows.length + 2);
    expect(lines.at(-1)).toBe("");
    const first = json.rows[0] as M.UsageBreakdownRow;
    expect(lines[1]).toBe([first.name, first.id, first.down, first.up, first.down + first.up, first.share].join(","));
  });

  it("top keeps the largest rows and folds the rest into Others (n)", async () => {
    const { engine } = demoEngine();
    const all = await ok(engine.execute<M.UsageBreakdown>("usage.breakdown", { range: "day", by: "device" }));
    const top = await ok(engine.execute<M.UsageBreakdown>("usage.breakdown", { range: "day", by: "device", top: 5 }));
    const used = all.rows.slice(5).filter((r) => bytes(r) > 0);
    expect(used.length).toBeGreaterThan(1);
    expect(top.rows).toHaveLength(6);
    expect(top.rows.slice(0, 5)).toEqual(all.rows.slice(0, 5));
    const others = top.rows[5] as M.UsageBreakdownRow;
    expect(others).toMatchObject({ id: null, name: `Others (${used.length})` });
    expect(others.down).toBe(used.reduce((n, r) => n + r.down, 0));
    expect(others.up).toBe(used.reduce((n, r) => n + r.up, 0));
    expect(others.share).toBe(Math.round((bytes(others) / bytes(all.total)) * 1000) / 10);
    expect(sumOf(top.rows)).toBe(sumOf(all.rows));
    expect(top.total).toEqual(all.total);
    // Nothing left over: no Others row.
    const wide = await ok(engine.execute<M.UsageBreakdown>("usage.breakdown", { range: "day", by: "eero", top: 10 }));
    expect(wide.rows.some((r) => r.name.startsWith("Others"))).toBe(false);
    const csv = await ok(engine.execute<string>("usage.breakdown", { range: "day", by: "device", top: 5, format: "csv" }));
    expect(csv.split("\r\n")[6]).toMatch(/^Others \(\d+\),,/);
  });

  it("rejects bad params", async () => {
    const { engine } = demoEngine();
    for (const params of [{ by: "room" }, { range: "month" }, { by: "eero", profile: "Leo" }, { profile: "Nobody" }, { format: "xml" }, { top: 0 }, { top: 1.5 }, { top: 101 }, { top: "5" }]) {
      expect(await engine.execute("usage.breakdown", params)).toMatchObject({ ok: false, error: { code: "bad_params" } });
    }
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

/**
 * The eero backend's usage area against the fake server, with stand-ins for
 * the areas other stories own (auth, network, eero, profile, device), so the
 * command runs through the engine, the real client and real HTTP shapes.
 */
function fakeEngine(opts: { dropProfile?: string } = {}) {
  const fake: FakeEero = createFakeEero({ now: () => FAKE_NOW });
  const live = createEeroBackend({ secrets: memorySecrets(fake.signIn()), origin: fake.origin, fetch: fake.fetch });
  const summary = (id: string, name: string): M.NetworkSummary => ({
    id,
    name,
    nickname: null,
    role: "owner",
    status: "online",
    eeroCount: null,
    devicesOnline: null,
    isp: null,
    updateAvailable: null,
    lastSeen: null,
    selected: false,
  });
  const net = fake.state.networks.get(FAKE_NET);
  const backend = composeBackend("eero", {
    auth: { ...live.auth, status: async () => ({ signedIn: true, pending: false, login: null, storage: "keychain" }) },
    network: {
      ...live.network,
      list: async () => [summary(FAKE_NET, "Maple Street")],
      get: async () => ({ ...summary(FAKE_NET, "Maple Street"), timezone: "America/New_York" }) as M.Network,
    },
    eero: { ...live.eero, list: async () => (net?.eeros ?? []).map((e) => ({ id: e.url?.split("/").pop(), location: e.location, serial: e.serial, mac: null }) as M.Eero) },
    device: {
      ...live.device,
      list: async () => (net?.devices ?? []).map((d) => ({ id: d.mac?.replace(/:/g, ""), name: d.nickname ?? d.hostname, nickname: d.nickname, hostname: d.hostname, mac: d.mac, ssid: d.is_guest ? "guest" : "main", connected: d.connected === true, lastActive: d.last_active ?? null }) as M.Device),
    },
    profile: {
      ...live.profile,
      // Like the live profile.list: eero's default (Unassigned) profile is left out.
      list: async () =>
        (net?.profiles ?? [])
          .filter((p) => p.default !== true && p.name !== opts.dropProfile)
          .map((p) => ({ id: p.url?.split("/").pop(), name: p.name, deviceIds: [] }) as unknown as M.Profile),
    },
    usage: live.usage,
  });
  return { fake, engine: createEngine({ backend, clock: () => FAKE_NOW }) };
}

const usageRequests = (fake: FakeEero) => fake.log.filter((e) => e.path.includes("/data_usage"));

describe("usage on the fake eero server", () => {
  it("sends start, end, cadence and timezone as query params and maps series to points", async () => {
    const { fake, engine } = fakeEngine();
    const s = await ok(engine.execute<M.UsageSeries>("usage.get", { range: "day" }));
    const [req] = usageRequests(fake);
    expect(req?.method).toBe("GET");
    expect(req?.path).toBe(`/2.2/networks/${FAKE_NET}/data_usage`);
    expect(req?.body).toBe("");
    const q = new URLSearchParams(req?.query);
    expect(Object.fromEntries(q)).toEqual({
      start: iso(hourStart(FAKE_NOW, "America/New_York") - 23 * HOUR),
      end: iso(FAKE_NOW),
      cadence: "hourly",
      timezone: "America/New_York",
    });
    expect(s.points).toHaveLength(24);
    expect(s.points.every((p) => p.down > 0 && p.up > 0)).toBe(true);
    expect(s.total.down).toBe(s.points.reduce((n, p) => n + p.down, 0));
    expect(s.todaySoFar).toBeGreaterThan(0);
  });

  it("uses the eero, device and profile chart paths, and fans out per eero without an id", async () => {
    const { fake, engine } = fakeEngine();
    await ok(engine.execute("usage.get", { scope: "eero", id: "Office" }));
    await ok(engine.execute("usage.get", { scope: "device", id: "0a:1b:2c:00:00:01", range: "week" }));
    await ok(engine.execute("usage.get", { scope: "profile", id: "Mia" }));
    expect(usageRequests(fake).map((e) => e.path)).toEqual([
      `/2.2/networks/${FAKE_NET}/data_usage/eeros/500002`,
      `/2.2/networks/${FAKE_NET}/data_usage/devices/0a1b2c000001`,
      `/2.2/networks/${FAKE_NET}/data_usage/profiles/702`,
    ]);
    const network = await ok(engine.execute<M.UsageSeries>("usage.get", {}));
    const perEero = await ok(engine.execute<M.UsageSeries[]>("usage.get", { scope: "eero" }));
    expect(perEero.map((s) => s.id)).toEqual(["500001", "500002", "500003", "500004"]);
    expect(sumOf(perEero.map((s) => s.total))).toBe(bytes(network.total));
  });

  it("keeps the week inside 7 days and gets daily buckets", async () => {
    const { fake, engine } = fakeEngine();
    const s = await ok(engine.execute<M.UsageSeries>("usage.get", { range: "week" }));
    const q = new URLSearchParams(usageRequests(fake)[0]?.query);
    expect(FAKE_NOW - Date.parse(q.get("start") ?? "")).toBeLessThanOrEqual(7 * DAY);
    expect(q.get("cadence")).toBe("daily");
    expect(s.points).toHaveLength(7);
  });

  it("maps the breakdown by device, profile and eero with names, ids and Unassigned", async () => {
    const { fake, engine } = fakeEngine();
    const devices = await ok(engine.execute<M.UsageBreakdown>("usage.breakdown", { by: "device" }));
    expect(devices.rows.every((r) => r.id && /^[0-9a-f]{12}$/.test(r.id))).toBe(true);
    // Device 7 has no nickname: the name falls back to its display name.
    expect(devices.rows.find((r) => r.id === "0a1b2c000007")?.name).toBe("esp-plug-07");
    // Paused and offline devices moved nothing, so they have no row.
    expect(devices.rows.map((r) => r.id)).not.toContain("0a1b2c000005");
    expect(sumOf(devices.rows)).toBe(bytes(devices.total));
    for (let i = 1; i < devices.rows.length; i++) expect(bytes(devices.rows[i - 1] as M.UsageBreakdownRow)).toBeGreaterThanOrEqual(bytes(devices.rows[i] as M.UsageBreakdownRow));

    const profiles = await ok(engine.execute<M.UsageBreakdown>("usage.breakdown", { by: "profile" }));
    expect(profiles.rows.map((r) => r.name).sort()).toEqual(["Alex", "Jamie", "Leo", "Mia", "Unassigned"]);
    expect(profiles.rows.find((r) => r.name === "Unassigned")?.id).toBeNull();
    expect(sumOf(profiles.rows)).toBe(bytes(profiles.total));

    const eeros = await ok(engine.execute<M.UsageBreakdown>("usage.breakdown", { by: "eero", range: "week" }));
    expect(eeros.rows.map((r) => r.name).sort()).toEqual(["Garage", "Living Room", "Office", "Upstairs Hall"]);
    expect(eeros.rows.find((r) => r.name === "Office")?.id).toBe("500002");
    expect(sumOf(eeros.rows)).toBe(bytes(eeros.total));

    const paths = usageRequests(fake).map((e) => e.path);
    expect(paths).toContain(`/2.2/networks/${FAKE_NET}/data_usage/breakdown`);
    expect(paths).toContain(`/2.2/networks/${FAKE_NET}/data_usage/eeros`);
    expect(usageRequests(fake).every((e) => e.body === "")).toBe(true);
  });

  it("maps by-profile rows on the real shape (profile_id, profile_name) to profile ids or Unassigned", async () => {
    const { fake, engine } = fakeEngine();
    const listed = new Set((fake.state.networks.get(FAKE_NET)?.profiles ?? []).filter((p) => p.default !== true).map((p) => p.url?.split("/").pop()));
    const b = await ok(engine.execute<M.UsageBreakdown>("usage.breakdown", { by: "profile", range: "week" }));
    // Replay the breakdown request: the fake answers like eero, with no url, id or name on a profile row.
    const req = usageRequests(fake).find((e) => e.path.endsWith("/breakdown"));
    if (!req) throw new Error("no breakdown request");
    const raw = (await (await fake.fetch(`${fake.origin}${req.path}${req.query}`, { headers: { cookie: `s=${req.token}` } })).json()) as { data: { profiles: Record<string, unknown>[] } };
    expect(raw.data.profiles.every((r) => Object.keys(r).sort().join() === "download,profile_id,profile_name,upload" && typeof r.profile_id === "number")).toBe(true);
    expect(b.rows.every((r) => (r.id !== null && listed.has(r.id)) || (r.id === null && r.name === "Unassigned"))).toBe(true);
    expect(b.rows.filter((r) => r.id === null)).toHaveLength(1);
    expect(b.rows.find((r) => r.name === "Mia")?.id).toBe("702");
    expect(sumOf(b.rows)).toBe(bytes(b.total));
  });

  it("folds a by-profile row whose id is not in profile.list into Unassigned", async () => {
    const { engine } = fakeEngine();
    const before = await ok(engine.execute<M.UsageBreakdown>("usage.breakdown", { by: "profile", range: "week" }));
    const { engine: dropped } = fakeEngine({ dropProfile: "Alex" });
    const after = await ok(dropped.execute<M.UsageBreakdown>("usage.breakdown", { by: "profile", range: "week" }));
    const alex = before.rows.find((r) => r.name === "Alex");
    const was = before.rows.find((r) => r.id === null);
    if (!alex || !was) throw new Error("fixture changed");
    expect(after.rows.map((r) => r.name)).not.toContain("Alex");
    expect(after.rows.filter((r) => r.id === null)).toEqual([expect.objectContaining({ name: "Unassigned", down: was.down + alex.down, up: was.up + alex.up })]);
    expect(sumOf(after.rows)).toBe(bytes(after.total));
  });

  it("adds up the guest devices' own series for guest usage (eero has no guest endpoint)", async () => {
    const { fake, engine } = fakeEngine();
    const guest = await ok(engine.execute<M.UsageSeries>("usage.get", { scope: "guest", range: "day" }));
    // The only guest is the plug esp-plug-07 (0a:1b:2c:00:00:07).
    const plug = await ok(engine.execute<M.UsageSeries>("usage.get", { scope: "device", id: "0a1b2c000007", range: "day" }));
    expect(guest).toMatchObject({ scope: "guest", id: null, range: "day", cadence: "hourly" });
    expect(guest.total).toEqual(plug.total);
    expect(bytes(guest.total)).toBeGreaterThan(0);
    expect(guest.points.map((p) => p.at)).toEqual(plug.points.map((p) => p.at));
    expect(guest.busiest).toEqual(plug.busiest);
    const paths = usageRequests(fake).map((e) => e.path);
    expect(paths).toContain(`/2.2/networks/${FAKE_NET}/data_usage/devices/0a1b2c000007`);
    expect(paths.filter((p) => p.includes("/data_usage/devices/")).every((p) => p.endsWith("0a1b2c000007"))).toBe(true);
  });

  it("leaves a guest eero no longer knows out of guest usage, and has none when no guest was online", async () => {
    const { fake, engine } = fakeEngine();
    const net = fake.state.networks.get(FAKE_NET);
    const plug = net?.devices.find((d) => d.hostname === "esp-plug-07");
    if (!net || !plug) throw new Error("fixture changed");
    // A second guest that eero has since forgotten: listed, but its usage is a 404.
    net.devices.push({ ...plug, mac: "0a:1b:2c:00:00:99", url: undefined });
    const devicesList = net.devices;
    const guest = await ok(engine.execute<M.UsageSeries>("usage.get", { scope: "guest", range: "day" }));
    net.devices = devicesList.filter((d) => d.mac !== "0a:1b:2c:00:00:99");
    const only = await ok(engine.execute<M.UsageSeries>("usage.get", { scope: "guest", range: "day" }));
    expect(guest.total).toEqual(only.total);
    plug.is_guest = false;
    const none = await ok(engine.execute<M.UsageSeries>("usage.get", { scope: "guest", range: "week" }));
    expect(none).toMatchObject({ scope: "guest", points: [], total: { down: 0, up: 0 }, busiest: null, todaySoFar: null });
  });

  it("maps eero errors", async () => {
    const { engine } = fakeEngine();
    expect(await engine.execute("usage.get", { scope: "device", id: "ffffffffffff" })).toMatchObject({ ok: false, error: { code: "bad_params" } });
  });
});

// ---------------------------------------------------------------------------
// usage.quiet_hours

describe("quiet hours", () => {
  it("averages each local hour of day and leaves out the hour in progress", () => {
    const h0 = hourStart(NOW, TZ);
    // Two days of 2 PM (local) points plus the partial current hour (2 PM today).
    const points = [
      { at: iso(h0 - DAY), down: 100, up: 0 },
      { at: iso(h0 - 2 * DAY), down: 300, up: 100 },
      { at: iso(h0 - HOUR), down: 7, up: 0 }, // 1 PM
      { at: iso(h0), down: 1e9, up: 0 }, // in progress
    ];
    const avgs = hourlyAverages(points, NOW, TZ);
    expect(avgs[14]).toBe(250);
    expect(avgs[13]).toBe(7);
    expect(avgs.filter((v) => v !== null)).toHaveLength(2);
  });

  it("finds the quietest 3-hour window, wrapping past midnight, earliest on a tie", () => {
    const avgs = Array.from({ length: 24 }, (_, h) => (h === 23 || h === 0 || h === 1 ? 1 : 10));
    expect(quietHours(avgs, "week")).toMatchObject({ quietest: { start: 23, avg: 1 }, busiest: { hour: 2, avg: 10 }, windowHours: 3 });
    expect(quietHours(Array(24).fill(5), "day").quietest).toEqual({ start: 0, avg: 5 });
    expect(windowAverage(avgs, 22)).toBe(4);
  });

  it("skips windows with missing hours and answers null without data", () => {
    const avgs: (number | null)[] = Array(24).fill(10);
    avgs[3] = 0;
    avgs[4] = null;
    expect(quietHours(avgs, "week").quietest?.start).not.toBe(3);
    expect(quietHours(avgs, "week", 2).selected).toEqual({ start: 2, avg: null });
    expect(quietHours(Array(24).fill(null), "day")).toMatchObject({ quietest: null, busiest: null });
    expect(quietHours(Array(24).fill(0), "day", 3)).toMatchObject({ quietest: null, busiest: null, selected: { start: 3, avg: null } });
  });
});

describe("usage.quiet_hours on the demo backend", () => {
  it("returns 24 hours, a quiet window overnight and the preferred window's average", async () => {
    const { engine } = demoEngine();
    const q = await ok(engine.execute<M.QuietHours>("usage.quiet_hours", { range: "week", start: 2 }));
    expect(q.hours).toHaveLength(24);
    expect(q.hours.every((h) => h.avg !== null && h.avg >= 0)).toBe(true);
    expect(q.quietest?.start).toBeGreaterThanOrEqual(0);
    expect(q.quietest?.start).toBeLessThanOrEqual(5);
    expect(q.busiest?.hour).toBeGreaterThanOrEqual(17);
    expect(q.selected?.start).toBe(2);
    expect(q.selected?.avg).toBeGreaterThanOrEqual(q.quietest?.avg ?? 0);
    // Same numbers as the hourly week series the Overview heatmap reads.
    const series = await ok(engine.execute<M.UsageSeries>("usage.get", { range: "week", cadence: "hourly" }));
    expect(q.hours.map((h) => h.avg)).toEqual(hourlyAverages(series.points, NOW, TZ));
  });

  it("defaults to the week, has no selected window unless asked, and rejects bad params", async () => {
    const { engine } = demoEngine();
    const q = await ok(engine.execute<M.QuietHours>("usage.quiet_hours"));
    expect(q.range).toBe("week");
    expect(q.selected).toBeUndefined();
    for (const bad of [{ start: 24 }, { start: -1 }, { start: 1.5 }, { range: "month" }, { extra: true }]) {
      expect((await engine.execute("usage.quiet_hours", bad)).ok, JSON.stringify(bad)).toBe(false);
      expect(await engine.execute("usage.quiet_hours", bad)).toMatchObject({ error: { code: "bad_params" } });
    }
    expect(engine.commands().find((c) => c.id === "usage.quiet_hours")).toMatchObject({ effect: "query" });
  });

  it("makes one hourly usage call on the fake eero server", async () => {
    const { fake, engine } = fakeEngine();
    const q = await ok(engine.execute<M.QuietHours>("usage.quiet_hours", { range: "day" }));
    expect(q.hours).toHaveLength(24);
    const reqs = usageRequests(fake);
    expect(reqs).toHaveLength(1);
    expect(new URLSearchParams(reqs[0]?.query).get("cadence")).toBe("hourly");
  });
});
