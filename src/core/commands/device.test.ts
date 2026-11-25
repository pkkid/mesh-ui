import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeEero } from "../../../test/fake-eero/server";
import { type AuthState, composeBackend, type SecretStore } from "../backend";
import { createDemoBackend } from "../demo";
import { createEeroBackend } from "../eero/backend";
import { deviceCategory, deviceName, mapDevice } from "../eero/map/device";
import { createEngine } from "../engine";
import type * as M from "../model";
import { BURST_LEAD_SEC, burstReadTimes } from "../poll";
import { commands as deviceCommands, rateSortValue, summarize } from "./device";

const NOW = Date.parse("2026-11-12T22:41:00Z");
const LAKE = "5130264";

function demo(clock: () => number = () => NOW) {
  const backend = createDemoBackend({ clock: () => NOW });
  return { backend, engine: createEngine({ backend, clock }) };
}

async function list(engine: ReturnType<typeof createEngine>, params: Record<string, unknown> = {}): Promise<M.DeviceList> {
  const r = await engine.execute<M.DeviceList>("device.list", params);
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.result;
}

const names = (l: M.DeviceList) => l.devices.map((d) => d.name);

describe("device.list (demo)", () => {
  it("lists every device by name with a summary of the whole network", async () => {
    const l = await list(demo().engine);
    expect(l.devices).toHaveLength(38);
    expect(names(l)).toEqual([...names(l)].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })));
    expect(l.summary).toMatchObject({
      total: 38,
      online: 31,
      offline: 5,
      paused: 3,
      blocked: 2,
      byBand: { "2.4": 11, "5": 10, "6": 6, wired: 4 },
      byCategory: { phones_tablets: 13, computers: 7, entertainment: 6, smart_home: 11, other: 1 },
    });
    expect(l.summary.newThisWeek.map((id) => l.devices.find((d) => d.id === id)?.name)).toEqual(["Nest Thermostat", "Grandma's iPad", "ESP_3A9F21"]);
    const rated = l.devices.filter((d) => d.rates);
    expect(l.summary.rates).toMatchObject({ active: rated.filter((d) => (d.rates?.downMbps ?? 0) + (d.rates?.upMbps ?? 0) > 0).length, at: new Date(NOW).toISOString() });
    const down = rated.reduce((s, d) => s + (d.rates?.downMbps ?? 0), 0);
    expect(l.summary.rates?.downMbps).toBeCloseTo(down, 1);
  });

  it("counts by eero, profile and manufacturer, each summing to the total", async () => {
    const l = await list(demo().engine);
    const { total, byEero, byProfile, byManufacturer } = l.summary;
    for (const rows of [byEero, byProfile, byManufacturer]) {
      expect(rows.reduce((s, r) => s + r.count, 0)).toBe(total);
      expect(rows.map((r) => r.count)).toEqual([...rows.map((r) => r.count)].sort((a, b) => b - a));
    }
    const per = <K extends string | null>(key: (d: M.Device) => K) => {
      const m = new Map<K, number>();
      for (const d of l.devices) m.set(key(d), (m.get(key(d)) ?? 0) + 1);
      return m;
    };
    expect(new Map(byEero.map((r) => [r.eeroId, r.count]))).toEqual(per((d) => d.eeroId));
    expect(new Map(byProfile.map((r) => [r.profileId, r.count]))).toEqual(per((d) => d.profileId));
    expect(new Map(byManufacturer.map((r) => [r.manufacturer, r.count]))).toEqual(per((d) => d.manufacturer));
    // Blocked devices are on no eero; Apple leads the makers.
    expect(byEero.find((r) => r.eeroId === null)?.count).toBe(2);
    expect(byManufacturer[0]).toEqual({ manufacturer: "Apple", count: 12 });
    expect(byProfile.find((r) => r.profileId === null)?.count).toBe(l.devices.filter((d) => d.profileId === null).length);
  });

  it("keeps the summary counts for the whole network when filtered", async () => {
    const l = await list(demo().engine, { status: "online", eero: "Office" });
    expect(l.summary.byEero.reduce((s, r) => s + r.count, 0)).toBe(38);
  });

  it("summarize counts a missing manufacturer as null", () => {
    const d = { id: "x", eeroId: null, profileId: null, manufacturer: "  ", category: "other", connected: false, band: null, rates: null, firstSeen: null, paused: false, blocked: false } as unknown as M.Device;
    expect(summarize([d], NOW).byManufacturer).toEqual([{ manufacturer: null, count: 1 }]);
  });

  it("totals live rates per band with shares of traffic and connected devices", async () => {
    const l = await list(demo().engine);
    const rates = l.summary.rates;
    if (!rates) throw new Error("fixture has rates");
    const connected = l.devices.filter((d) => d.connected && d.band);
    for (const band of ["2.4", "5", "6", "wired"] as const) {
      const on = connected.filter((d) => d.band === band);
      expect(rates.byBand[band].downMbps).toBeCloseTo(on.reduce((s, d) => s + (d.rates?.downMbps ?? 0), 0), 1);
      expect(rates.byBand[band].upMbps).toBeCloseTo(on.reduce((s, d) => s + (d.rates?.upMbps ?? 0), 0), 1);
    }
    // 6 of 31 connected devices; shares are 0 to 100 and add up to 100.
    expect(rates.byBand["6"].devicePct).toBe(19.4);
    const traffic = Object.values(rates.byBand).reduce((s, b) => s + (b.trafficPct ?? 0), 0);
    expect(traffic).toBeCloseTo(100, 0);
    // The busiest Wi-Fi band, even though wired carries more.
    expect(rates.topBand).toBe("6");
    expect(rates.byBand.wired.trafficPct).toBeGreaterThan(rates.byBand["6"].trafficPct ?? 0);
    expect(rates.byBand["6"].trafficPct).toBeGreaterThan(rates.byBand["5"].trafficPct ?? 0);
  });

  it("has no band shares or busiest band while nothing moves", async () => {
    const l = await list(demo().engine);
    const idle = l.devices.map((d) => (d.rates ? { ...d, rates: { ...d.rates, downMbps: 0, upMbps: 0 } } : d));
    const rates = summarize(idle, NOW).rates;
    expect(rates).toMatchObject({ downMbps: 0, upMbps: 0, active: 0, topBand: null });
    expect(rates?.byBand["6"]).toEqual({ downMbps: 0, upMbps: 0, trafficPct: null, devicePct: 19.4 });
  });

  it("filters by status, keeping the summary for the whole network", async () => {
    const { engine } = demo();
    const online = await list(engine, { status: "online" });
    expect(online.devices).toHaveLength(31);
    expect(online.devices.every((d) => d.connected)).toBe(true);
    expect(online.summary.total).toBe(38);
    expect((await list(engine, { status: "offline" })).devices.map((d) => d.name).sort()).toEqual(["Jamie's Apple Watch", "Jamie's Peloton", "Leo's Chromebook", "Mia's iPhone", "Sam's Pixel"]);
    expect(names(await list(engine, { status: "paused" }))).toEqual(["Leo's Chromebook", "Leo's Fire HD", "Leo's Switch"]);
    expect(names(await list(engine, { status: "blocked" }))).toEqual(["android-7f3a", "ESP_3A9F21"]);
    expect((await list(engine, { connected: true, paused: true })).devices).toHaveLength(2);
    expect((await list(engine, { blocked: false })).devices).toHaveLength(36);
  });

  it("filters by eero, profile, band, type, network, manufacturer and new this week", async () => {
    const { engine } = demo();
    const office = await list(engine, { eero: "Office" });
    expect(office.devices.every((d) => d.eeroId === "80012")).toBe(true);
    expect(office.devices.filter((d) => d.connected)).toHaveLength(9);
    expect(names(await list(engine, { profile: "leo" }))).toEqual(["Leo's Chromebook", "Leo's Fire HD", "Leo's Switch"]);
    const unassigned = await list(engine, { profile: null });
    expect(unassigned.devices.every((d) => d.profileId === null)).toBe(true);
    expect(unassigned.devices.map((d) => d.name)).toContain("Living Room TV");
    expect((await list(engine, { band: "wired" })).devices).toHaveLength(4);
    expect((await list(engine, { type: "entertainment" })).devices).toHaveLength(6);
    expect(names(await list(engine, { ssid: "guest" }))).toEqual(["Grandma's iPad", "Sam's Pixel"]);
    expect(names(await list(engine, { manufacturer: "sonos" }))).toEqual(["Sonos Kitchen", "Sonos Living Room"]);
    const since = new Date(NOW - 7 * 86_400_000).toISOString();
    expect(names(await list(engine, { newSince: since }))).toEqual(["ESP_3A9F21", "Grandma's iPad", "Nest Thermostat"]);
  });

  it("takes New this week from eero's New Device notifications, not first_active", async () => {
    const { engine } = demo();
    const all = (await list(engine)).devices;
    const tv = all.find((d) => d.name === "Living Room TV");
    const esp = all.find((d) => d.name === "ESP_3A9F21");
    if (!tv || !esp) throw new Error("fixture");
    // The TV rejoined minutes ago (first_active restarts) but eero never announced it; the ESP was announced 10 days ago.
    const rejoined = all.map((d) => (d.id === tv.id ? { ...d, firstSeen: new Date(NOW - 5 * 60_000).toISOString() } : d));
    const announced = new Map([
      [esp.id, NOW - 10 * 86_400_000],
      [tv.id + "-gone", NOW - 60_000],
    ]);
    const s = summarize(rejoined, NOW, announced);
    expect(s.newThisWeek).toEqual([]);
    expect(s.newestAt).toBeNull();
    const recent = summarize(all, NOW, new Map([[esp.id, NOW - 3_600_000]]));
    expect(recent.newThisWeek).toEqual([esp.id]);
    expect(recent.newestAt).toBe(new Date(NOW - 3_600_000).toISOString());
  });

  it("still lists devices when the notifications read fails, with none new", async () => {
    const backend = createDemoBackend({ clock: () => NOW });
    backend.notifications.list = async () => {
      throw new Error("down");
    };
    const engine = createEngine({ backend, clock: () => NOW });
    const r = await list(engine);
    expect(r.devices.length).toBeGreaterThan(0);
    expect(r.summary.newThisWeek).toEqual([]);
  });

  it("lists the demo's announced devices newest first", async () => {
    const { engine } = demo();
    const r = await list(engine);
    const byId = new Map(r.devices.map((d) => [d.id, d.name]));
    expect(r.summary.newThisWeek.map((id) => byId.get(id))).toEqual(["Nest Thermostat", "Grandma's iPad", "ESP_3A9F21"]);
    expect(r.summary.newestAt).toBe(new Date(NOW - 48 * 60_000).toISOString());
  });

  it("searches name, manufacturer, MAC with or without colons, and IP", async () => {
    const { engine } = demo();
    const all = await list(engine);
    const tv = all.devices.find((d) => d.name === "Living Room TV");
    if (!tv?.ipv4) throw new Error("fixture");
    expect(names(await list(engine, { search: "peloton" }))).toEqual(["Jamie's Peloton"]);
    expect(names(await list(engine, { search: "Synology" }))).toEqual(["Synology NAS"]);
    expect(names(await list(engine, { search: tv.mac }))).toEqual(["Living Room TV"]);
    expect(names(await list(engine, { search: tv.mac.replace(/:/g, "").toUpperCase() }))).toEqual(["Living Room TV"]);
    // Search is a substring match, so pick an IP that is not the prefix of another (.4.12 would also match .4.127).
    const nas = all.devices.find((d) => d.name === "Synology NAS");
    expect(names(await list(engine, { search: nas?.ipv4 ?? "fixture" }))).toEqual(["Synology NAS"]);
    expect((await list(engine, { search: "nothing like this" })).devices).toEqual([]);
  });

  it("sorts by rate, last seen and usage, and limits", async () => {
    const { engine } = demo();
    const byRate = await list(engine, { sort: "rate", limit: 3 });
    expect(byRate.devices).toHaveLength(3);
    const r = byRate.devices.map((d) => (d.rates?.downMbps ?? 0) + (d.rates?.upMbps ?? 0));
    expect(r).toEqual([...r].sort((a, b) => b - a));
    const seen = await list(engine, { sort: "last_seen", status: "offline" });
    expect(names(seen)).toEqual(["Jamie's Apple Watch", "Mia's iPhone", "Leo's Chromebook", "Jamie's Peloton", "Sam's Pixel"]);
    const used = await list(engine, { sort: "usage", limit: 1 });
    expect(names(used)).toEqual(["Living Room TV"]);
  });

  it("sorts rate as online by speed, then paused, then offline by last seen, then blocked, and reverses fully", async () => {
    const { engine } = demo();
    const tier = (d: M.Device) => (d.blocked ? 0 : !d.connected ? 1 : d.paused ? 2 : 3);
    const desc = (await list(engine, { sort: "rate" })).devices;
    const tiers = desc.map(tier);
    expect(tiers).toEqual([...tiers].sort((a, b) => b - a));
    expect(new Set(tiers).size).toBe(4);
    const speeds = desc.filter((d) => tier(d) === 3).map((d) => (d.rates?.downMbps ?? 0) + (d.rates?.upMbps ?? 0));
    expect(speeds).toEqual([...speeds].sort((a, b) => b - a));
    const offline = desc.filter((d) => tier(d) === 1).map((d) => Date.parse(d.lastActive ?? "") || 0);
    expect(offline).toEqual([...offline].sort((a, b) => b - a));
    const asc = (await list(engine, { sort: "rate", order: "asc" })).devices;
    expect(asc.map(tier)).toEqual([...tiers].reverse());
  });

  it("sorts rate with no live readings (Live off): online first by name, offline after by last seen", () => {
    const at = (iso: string | null, extra: Partial<M.Device> = {}) => ({ connected: false, blocked: false, paused: false, rates: null, lastActive: iso, ...extra }) as M.Device;
    const values = [at(null, { connected: true }), at("2026-11-20T00:00:00Z"), at("2026-11-23T00:00:00Z"), at(null), at("2026-11-23T00:00:00Z", { blocked: true })].map(rateSortValue);
    expect(values).toEqual([[3, 0], [1, Date.parse("2026-11-20T00:00:00Z")], [1, Date.parse("2026-11-23T00:00:00Z")], [1, 0], [0, Date.parse("2026-11-23T00:00:00Z")]]);
  });

  it("sorts by every key in both orders, missing values last, ties by name", async () => {
    const { engine } = demo();
    const eeros = new Map<string, string>();
    const er = await engine.execute<M.Eero[]>("eero.list");
    const pr = await engine.execute<M.ProfileList>("profile.list");
    if (!er.ok || !pr.ok) throw new Error("setup");
    for (const e of er.result) eeros.set(e.id, e.location);
    const profiles = new Map(pr.result.profiles.map((p) => [p.id, p.name]));
    const live = (d: M.Device) => d.connected && !d.blocked;
    const ip = (s: string | null) => (s ? s.split(".").reduce((a, n) => a * 256 + Number(n), 0) : null);
    const status = (d: M.Device) => (d.blocked ? 2 : !d.connected ? 3 : d.paused ? 1 : 0);
    const keys: Record<string, (d: M.Device) => number | string | null> = {
      profile: (d) => (d.profileId ? (profiles.get(d.profileId) ?? null) : null),
      eero: (d) => (d.eeroId ? (eeros.get(d.eeroId) ?? null) : null),
      band: (d) => (live(d) && d.band ? ["2.4", "5", "6", "wired"].indexOf(d.band) : null),
      signal: (d) => (live(d) && d.band !== "wired" && d.signal?.bars != null ? d.signal.bars : null),
      ip: (d) => ip(d.ipv4),
      status,
    };
    const cmp = (a: number | string, b: number | string) => (typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), "en", { sensitivity: "base" }));
    for (const [key, value] of Object.entries(keys)) {
      for (const order of ["asc", "desc"] as const) {
        const vals = (await list(engine, { sort: key, order })).devices.map(value);
        const firstNull = vals.indexOf(null);
        expect(vals.length, key).toBeGreaterThan(5);
        if (firstNull >= 0) expect(vals.slice(firstNull).every((v) => v === null), `${key} ${order}: missing last`).toBe(true);
        const present = vals.filter((v) => v !== null) as (number | string)[];
        expect(new Set(present).size, `${key} has several values`).toBeGreaterThan(1);
        for (let i = 1; i < present.length; i++) expect(cmp(present[i - 1]!, present[i]!) * (order === "asc" ? 1 : -1), `${key} ${order}`).toBeLessThanOrEqual(0);
      }
    }
    // Natural defaults: signal strongest first, status online first; ties fall back to name A to Z.
    const sig = (await list(engine, { sort: "signal" })).devices.map(keys.signal!);
    expect(sig[0]).toBe(Math.max(...(sig.filter((v) => v !== null) as number[])));
    const st = await list(engine, { sort: "status" });
    expect(status(st.devices[0]!)).toBe(0);
    const online = st.devices.filter((d) => status(d) === 0).map((d) => d.name);
    expect(online).toEqual([...online].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })));
    // Name Z to A; IP in numeric order, not string order.
    const za = names(await list(engine, { order: "desc" }));
    expect(za).toEqual([...names(await list(engine))].reverse());
    const ips = (await list(engine, { sort: "ip" })).devices.flatMap((d) => (d.ipv4 ? [ip(d.ipv4) as number] : []));
    expect(ips).toEqual([...ips].sort((a, b) => a - b));
    // Rate, last seen and usage flip too.
    expect(names(await list(engine, { sort: "usage", order: "asc", limit: 1 }))).not.toEqual(["Living Room TV"]);
    const seenAsc = await list(engine, { sort: "last_seen", order: "asc", status: "offline" });
    expect(names(seenAsc).slice(0, 4)).toEqual(["Sam's Pixel", "Jamie's Peloton", "Leo's Chromebook", "Mia's iPhone"]);
  });

  it("drops offline devices eero has aged out (7 days), but keeps blocked ones", async () => {
    const { engine } = demo();
    const lake = await list(engine, { networkId: LAKE });
    expect(names(lake)).toEqual(["Cabin Camera", "Cabin Thermostat"]);
    expect((await list(engine, { status: "blocked" })).devices.map((d) => d.name)).toContain("android-7f3a");
  });

  it("exports CSV with eero and profile names", async () => {
    const r = await demo().engine.execute<string>("device.list", { format: "csv", profile: "Leo" });
    if (!r.ok) throw new Error(r.error.message);
    const lines = r.result.trimEnd().split("\r\n");
    expect(lines[0]).toBe("Name,Status,Connected to,Band,Network,IP,MAC,Profile,Manufacturer,Model,Category,Down Mbps,Up Mbps,Last active,Active since");
    expect(lines).toHaveLength(4);
    expect(lines[3]).toMatch(/^Leo's Switch,Paused,Living Room,5 GHz,main,192\.168\.4\.172,[0-9a-f:]+,Leo,Nintendo,Switch 2,entertainment,,,/);
  });

  it("fails bad_params for wrong values and unknown refs", async () => {
    const { engine } = demo();
    for (const params of [{ status: "sleeping" }, { band: "7" }, { limit: 0 }, { newSince: "yesterday" }, { sort: "size" }, { order: "up" }, { sort: "ip", order: "ASC" }, { eero: "Attic" }, { profile: "Nobody" }]) {
      expect(await engine.execute("device.list", params)).toMatchObject({ ok: false, error: { code: "bad_params" } });
    }
  });

  it("shows rates older than 90 s as missing", async () => {
    let t = NOW;
    const { engine } = demo(() => t);
    expect((await list(engine)).summary.rates).not.toBeNull();
    t = NOW + 91_000;
    const stale = await list(engine, { search: "a" });
    expect(stale.devices.every((d) => d.rates === null)).toBe(true);
    expect(stale.summary.rates).toBeNull();
  });
});

describe("device.get (demo)", () => {
  it("gets a device by name, id or MAC with its reservation", async () => {
    const { engine } = demo();
    const r = await engine.execute<M.Device>("device.get", { device: "synology nas" });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.result).toMatchObject({ name: "Synology NAS", band: "wired", wiredPort: { port: 2, speedMbps: 10000 } });
    expect((await engine.execute<M.Device>("device.get", { device: r.result.mac })).ok).toBe(true);
    expect(await engine.execute("device.get", { device: "Toaster" })).toMatchObject({ ok: false, error: { code: "bad_params" } });
    expect(await engine.execute("device.get", {})).toMatchObject({ ok: false, error: { code: "bad_params" } });
  });
});

describe("device.rates.refresh (demo)", () => {
  it("bursts at most once a minute per network", async () => {
    let t = NOW;
    const { backend, engine } = demo(() => t);
    const spy = vi.spyOn(backend.device, "requestBurst");
    const first = await engine.execute<M.BurstResult>("device.rates.refresh");
    if (!first.ok) throw new Error(first.error.message);
    t += 30_000;
    const second = await engine.execute<M.BurstResult>("device.rates.refresh");
    expect(second).toEqual(first);
    expect(spy).toHaveBeenCalledTimes(1);
    // Another network has its own minute.
    expect((await engine.execute("device.rates.refresh", { networkId: LAKE })).ok).toBe(true);
    expect(spy).toHaveBeenCalledTimes(2);
    t += 31_000;
    expect((await engine.execute("device.rates.refresh")).ok).toBe(true);
    expect(spy).toHaveBeenCalledTimes(3);
    expect(engine.commands().find((c) => c.id === "device.rates.refresh")).toMatchObject({ effect: "write", poll: 60 });
  });
});

// ---------------------------------------------------------------------------
// Against the fake eero server, through the real client and mappers.

function fakeEngine(readShareMs = 0) {
  const fake = createFakeEero();
  const token = fake.signIn();
  const secrets: SecretStore = { load: async () => token, save: async () => "memory", clear: async () => {}, storage: async () => "memory" };
  const live = createEeroBackend({ secrets, origin: fake.origin, fetch: fake.fetch, readShareMs });
  const auth: AuthState = { signedIn: true, pending: false, login: null, storage: "memory" };
  const summary = (id: string, name: string) => ({ id, name, nickname: null, role: "owner", status: "online", eeroCount: null, devicesOnline: null, isp: null, updateAvailable: null, lastSeen: null, selected: false }) as M.NetworkSummary;
  // Stub auth (no eero auth area yet) and network (keeps these tests to their own routes).
  const backend = composeBackend("eero", {
    auth: { ...live.auth, status: async () => auth },
    network: { ...live.network, list: async () => [summary("100001", "Maple Street"), summary("100002", "Lake Cabin")] },
    eero: live.eero,
    device: live.device,
    profile: live.profile,
    usage: live.usage,
  });
  return { fake, engine: createEngine({ backend }) };
}

describe("device commands (fake eero server)", () => {
  let close: (() => Promise<void>) | null = null;
  afterEach(async () => {
    vi.useRealTimers();
    await close?.();
    close = null;
  });

  it("maps devices with the name fallback chain and merges the blocklist", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse("2026-11-12T18:00:00Z"));
    const { fake, engine } = fakeEngine();
    close = fake.close;
    const maple = fake.state.networks.get("100001");
    if (!maple) throw new Error("fixture");
    maple.blacklist.push("0a:1b:2c:00:00:03", "0a:1b:2c:00:0f:ff");
    const l = await list(engine);
    const plug = l.devices.find((d) => d.mac === "0a:1b:2c:00:00:07");
    expect(plug).toMatchObject({ id: "0a1b2c000007", name: "esp-plug-07", nickname: null, hostname: "esp-plug-07", category: "smart_home", band: "2.4", signal: { dbm: -52, bars: 4 }, eeroId: "500002" });
    expect(l.devices.find((d) => d.name === "Jamie's Phone")).toMatchObject({ blocked: true, connected: false, band: null });
    expect(l.devices.find((d) => d.id === "0a1b2c000fff")).toMatchObject({ name: "0a:1b:2c:00:0f:ff", blocked: true, connected: false });
    expect(l.devices.find((d) => d.name === "Living Room TV")).toMatchObject({ band: "wired", category: "entertainment", signal: null, profileId: null });
    expect(l.devices.find((d) => d.name === "Alex's Phone")).toMatchObject({ profileId: "700", ssid: "main", ipv4: "192.168.4.101" });
    // Jamie's Tablet is offline and only in Jamie's profile, not in GET {net}/devices (M5.R-fix6).
    expect(l.devices.find((d) => d.name === "Jamie's Tablet")).toMatchObject({ profileId: "701", connected: false });
    // Den Dot: an Echo eero leaves out of GET {net}/devices, read from its own device link (real capture 2026-11-24).
    expect(l.devices.find((d) => d.name === "Den Dot")).toMatchObject({ connected: true, model: "Echo Dot (4th Gen)", eeroId: "0a1b2c0003de" });
    expect(l.summary).toMatchObject({ total: 11, online: 7, offline: 2, paused: 1, blocked: 2, rates: null });
    // The profiles give offline members, then tell eero's default (Unassigned) profile from people's
    // profiles. The app shares the second read (READ_SHARE_MS); this test client shares only in flight.
    // The network object names the Echos eero leaves out of the list; each one not acting as an eero is read by its own link.
    expect(fake.log.map((e) => `${e.method} ${e.path}`).sort()).toEqual([
      "GET /2.2/networks/100001",
      "GET /2.2/networks/100001/blacklist",
      "GET /2.2/networks/100001/devices",
      "GET /2.2/networks/100001/devices/0a1b2c0003df",
      "GET /2.2/networks/100001/profiles",
      "GET /2.2/networks/100001/profiles",
    ]);
  });

  it("maps devices on eero's default profile to Unassigned, for the filter, summary and detail", async () => {
    const { fake, engine } = fakeEngine();
    close = fake.close;
    // As on a real network: devices without a person's profile point at the default profile, never at null.
    const maple = fake.state.networks.get("100001");
    const tv = maple?.devices.find((d) => d.nickname === "Living Room TV");
    expect(tv?.profile?.url).toBe("/2.2/networks/100001/profiles/790");
    expect(maple?.profiles.find((p) => p.default)?.name).toBe("Unassigned");

    const all = await list(engine);
    expect(all.devices.some((d) => d.profileId === "790")).toBe(false);
    const unassigned = await list(engine, { profile: null });
    expect(unassigned.devices.map((d) => d.name).sort((a, b) => a.localeCompare(b))).toEqual(["Den Dot", "esp-plug-07", "Living Room TV", "Old Printer"]);
    expect(all.summary.byProfile.find((r) => r.profileId === null)?.count).toBe(4);
    expect(all.summary.byProfile.map((r) => r.profileId)).not.toContain("790");

    const one = await engine.execute<M.Device>("device.get", { device: "Living Room TV" });
    expect(one.ok && one.result.profileId).toBeNull();
    const csv = await engine.execute<string>("device.list", { profile: null, format: "csv" });
    if (!csv.ok) throw new Error(csv.error.message);
    expect(csv.result.match(/Unassigned/g)).toHaveLength(4);
    expect(csv.result).not.toContain("790");
    // The default profile is not a profile you can filter by.
    expect(await engine.execute("device.list", { profile: "790" })).toMatchObject({ ok: false, error: { code: "bad_params" } });
  });

  it("counts people's profiles for network.get, not eero's default profile", async () => {
    const { fake, engine } = fakeEngine();
    close = fake.close;
    const [n, p] = await Promise.all([engine.execute<M.Network>("network.get"), engine.execute<M.ProfileList>("profile.list")]);
    if (!n.ok || !p.ok) throw new Error("read failed");
    expect(n.result.counts.profiles).toBe(4);
    expect(n.result.counts.profiles).toBe(p.result.profiles.length);
  });

  it("sends one burst a minute and stamps rates once the burst is in", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = Date.parse("2026-11-12T18:00:00Z");
    vi.setSystemTime(start);
    const { fake, engine } = fakeEngine();
    close = fake.close;
    const first = await engine.execute<M.BurstResult>("device.rates.refresh");
    expect(first).toEqual({ ok: true, result: { nextBurstAt: new Date(start + 12_000).toISOString() } });
    vi.setSystemTime(start + 5_000);
    expect(await engine.execute("device.rates.refresh")).toEqual(first);
    const posts = () => fake.log.filter((e) => e.method === "POST" && e.path.endsWith("/burst_reporters"));
    expect(posts()).toHaveLength(1);
    expect(posts()[0]?.body).toBe('""');
    expect(fake.state.extra.bursts).toEqual({ "100001": 1 });

    // Before next_burst the rates are not in yet.
    expect((await list(engine)).summary.rates).toBeNull();
    vi.setSystemTime(start + 15_000);
    const l = await list(engine);
    expect(l.summary.rates).toMatchObject({ active: 6, at: new Date(start + 12_000).toISOString() });
    // Fake rates: Alex's Phone (5 GHz) 10 down 1 up, among others; shares follow the per-band sums.
    const r = l.summary.rates;
    if (!r) throw new Error("rates");
    const bandTraffic = (b: M.Band) => l.devices.filter((d) => d.connected && d.band === b).reduce((s, d) => s + (d.rates ? d.rates.downMbps + d.rates.upMbps : 0), 0);
    const total = (["2.4", "5", "6", "wired"] as const).reduce((s, b) => s + bandTraffic(b), 0);
    for (const b of ["2.4", "5", "6", "wired"] as const) expect(r.byBand[b].trafficPct).toBeCloseTo((bandTraffic(b) / total) * 100, 0);
    expect(r.topBand).not.toBe("wired");
    const burstAt = new Date(start + 12_000).toISOString();
    expect(l.devices.find((d) => d.name === "Alex's Phone")?.rates).toMatchObject({ downMbps: 10, upMbps: 1, at: burstAt });
    expect(l.devices.find((d) => d.name === "Leo's Switch")?.rates).toBeNull();
    // Each device's share of the network's traffic, like the eero app's live view; together about 100.
    const shares = l.devices.flatMap((d) => (d.rates?.sharePct === undefined ? [] : [d.rates.sharePct]));
    expect(shares).toHaveLength(6);
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 0);

    // #254: the burst's live window. The engine marks devices stale every few seconds through it, so the
    // next read goes to eero again and shows the figures moving.
    vi.setSystemTime(start + 18_100);
    const moving = await list(engine);
    expect(moving.devices.find((d) => d.name === "Alex's Phone")?.rates).toMatchObject({ downMbps: 11, upMbps: 1.1, at: burstAt });
    // After the window eero's figures decay to zero; a later read (the regular poll) keeps the last live ones.
    vi.setSystemTime(start + 45_000);
    const gets = () => fake.log.filter((e) => e.method === "GET" && e.path === "/2.2/networks/100001/devices").length;
    const before = gets();
    const held = await engine.execute<M.DeviceList>("device.list", {}, { fresh: true });
    if (!held.ok) throw new Error(held.error.message);
    expect(gets()).toBe(before + 1);
    expect(held.result.devices.find((d) => d.name === "Alex's Phone")?.rates).toMatchObject({ downMbps: 11, upMbps: 1.1, at: burstAt });
    expect(held.result.summary.rates?.active).toBe(6);
    const one = await engine.execute<M.Device>("device.get", { device: "Alex's Phone" }, { fresh: true });
    expect(one.ok && one.result.rates).toMatchObject({ downMbps: 11, upMbps: 1.1 });

    vi.setSystemTime(start + 61_000);
    expect((await engine.execute("device.rates.refresh")).ok).toBe(true);
    expect(posts()).toHaveLength(2);
    // A read in the new burst's window where every device is at zero (eero's figures not in, or decayed)
    // keeps the last live figures rather than showing zeros across the board.
    for (const d of fake.state.networks.get("100001")?.devices ?? []) if (d.usage) d.usage = { down_mbps: 0, up_mbps: 0 };
    vi.setSystemTime(start + 61_000 + 14_000);
    const zeros = await engine.execute<M.DeviceList>("device.list", {}, { fresh: true });
    if (!zeros.ok) throw new Error(zeros.error.message);
    expect(zeros.result.devices.find((d) => d.name === "Alex's Phone")?.rates).toMatchObject({ downMbps: 11, upMbps: 1.1, at: burstAt });
    // Without another burst, rates go missing 90 s after the last one.
    vi.setSystemTime(start + 73_000 + 91_000);
    expect((await list(engine, { limit: 1 })).summary.rates).toBeNull();
  });

  it("times a burst from the POST, since eero's next_burst is about now, and reads each live time from eero (#254)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = Date.parse("2026-11-12T18:00:00Z");
    vi.setSystemTime(start);
    // The app's client shares a GET answer for 5 s; reads in the live window must not take it.
    const { fake, engine } = fakeEngine(5_000);
    close = fake.close;
    await list(engine);
    const burst = await engine.execute<M.BurstResult>("device.rates.refresh");
    // The fake answers next_burst = the POST time, as eero does; the burst is due when the figures land.
    expect(burst).toEqual({ ok: true, result: { nextBurstAt: new Date(start + BURST_LEAD_SEC * 1000).toISOString() } });
    const gets = () => fake.log.filter((e) => e.method === "GET" && e.path === "/2.2/networks/100001/devices").length;
    const phone = (l: M.DeviceList) => l.devices.find((d) => d.name === "Alex's Phone")?.rates;
    // Too early: nothing live yet.
    vi.setSystemTime(start + 3_000);
    expect(phone(await list(engine))).toBeNull();
    const reads = burstReadTimes(start + BURST_LEAD_SEC * 1000);
    const seen: (number | undefined)[] = [];
    for (const at of reads) {
      vi.setSystemTime(at);
      const before = gets();
      seen.push(phone(await list(engine))?.downMbps);
      expect(gets()).toBe(before + 1);
    }
    expect(seen).toEqual([10, 11, 12]);
  });

  it("sorts by usage from the usage breakdown", async () => {
    const { fake, engine } = fakeEngine();
    close = fake.close;
    const l = await list(engine, { sort: "usage" });
    expect(fake.log.some((e) => e.path === "/2.2/networks/100001/data_usage/breakdown")).toBe(true);
    const b = await engine.execute<M.UsageBreakdown>("usage.breakdown", { by: "device", range: "day" });
    if (!b.ok) throw new Error(b.error.message);
    const top = [...b.result.rows].sort((x, y) => y.down + y.up - (x.down + x.up))[0];
    expect(top && top.down + top.up > 0).toBe(true);
    expect(l.devices[0]?.id).toBe(top?.id);
  });

  it("gets one device by name from GET {net}/devices/{mac}", async () => {
    const { fake, engine } = fakeEngine();
    close = fake.close;
    const r = await engine.execute<M.Device>("device.get", { device: "Mia's Tablet" });
    expect(r.ok && r.result).toMatchObject({ id: "0a1b2c000004", name: "Mia's Tablet", eeroId: "500003", profileId: "702" });
    // Then GET {net}/routing for its reservation.
    expect(fake.log.map((e) => e.path)).toEqual(expect.arrayContaining(["/2.2/networks/100001/devices/0a1b2c000004", "/2.2/networks/100001/routing", "/2.2/networks/100001/profiles"]));
  });
});

describe("device mapper", () => {
  it("falls back from nickname to display name, hostname, manufacturer, then MAC", () => {
    const base = { nickname: "Nick", display_name: "Display", hostname: "host", manufacturer: "Maker", mac: "0a:00:00:00:00:01" };
    expect(deviceName(base)).toBe("Nick");
    expect(deviceName({ ...base, nickname: "  " })).toBe("Display");
    expect(deviceName({ ...base, nickname: null, display_name: null })).toBe("host");
    expect(deviceName({ ...base, nickname: null, display_name: null, hostname: null })).toBe("Maker");
    expect(deviceName({ mac: "0a:00:00:00:00:01" })).toBe("0a:00:00:00:00:01");
    expect(deviceName({})).toBe("Unknown device");
  });

  it("maps categories and odd shapes without throwing", () => {
    expect(["phone", "laptop_computer", "television", "thermostat", "car", null].map(deviceCategory)).toEqual(["phones_tablets", "computers", "entertainment", "smart_home", "other", "other"]);
    const d = mapDevice({
      mac: "0A:00:00:00:00:02",
      connected: true,
      wireless: true,
      interface: { frequency: "6" },
      ipv6_addresses: [{ address: "2001:db8::2" }, "2001:db8::3", {}],
      connectivity: { signal: "-61 dBm", score_bars: 9, rx_rate_info: { rate_bps: 2_401_900_000, channel_width: "160MHz", phy_type: "eht" }, snr: 31 },
      usage: { down_mbps: 4, up_mbps: 1 },
    });
    expect(d).toMatchObject({ id: "0a0000000002", type: "generic", band: "6", ipv6: ["2001:db8::2", "2001:db8::3"], signal: { dbm: -61, bars: 5 }, link: { rxMbps: 2401.9, widthMhz: 160, standard: "Wi-Fi 7", snr: 31 }, rates: null });
    expect(() => mapDevice({})).not.toThrow();
  });

  it("guesses a type for a generic device but keeps eero's type", () => {
    const d = mapDevice({ mac: "0a:00:00:00:00:03", device_type: "generic", manufacturer: "Sonos, Inc." });
    expect(d).toMatchObject({ type: "generic", inferredType: "audio", category: "entertainment" });
    const set = mapDevice({ mac: "0a:00:00:00:00:04", device_type: "printer", manufacturer: "Sonos, Inc." });
    expect(set).toMatchObject({ type: "printer", inferredType: null, category: "computers" });
    expect(mapDevice({ mac: "0a:00:00:00:00:05" })).toMatchObject({ type: "generic", inferredType: null, category: "other" });
  });
});

// ---------------------------------------------------------------------------
// Writes (M4.4)

async function ok<R>(engine: ReturnType<typeof createEngine>, id: string, params: Record<string, unknown> = {}): Promise<R> {
  const r = await engine.execute<R>(id, params);
  if (!r.ok) throw new Error(`${id}: ${r.error.code}: ${r.error.message}`);
  return r.result;
}

const WRITES = ["device.resume", "device.rename", "device.type.set", "device.profile.set", "device.unblock"];
/** Pause and Block take devices offline, so they are disruptive and need confirm on every surface. */
const OFFLINE = ["device.pause", "device.block"];

describe("device writes (demo)", () => {
  it("are reversible writes that refresh devices, network counts and profiles; pause and block are disruptive", () => {
    const { engine } = demo();
    const info = engine.commands();
    for (const id of [...WRITES, ...OFFLINE]) {
      const c = info.find((x) => x.id === id);
      expect(c, id).toBeDefined();
      expect(c?.effect, id).toBe(OFFLINE.includes(id) ? "disruptive" : "write");
    }
  });

  it("asks before moving devices into a paused profile, and only then", async () => {
    const { engine } = demo();
    const before = await list(engine);
    // Leo is paused in the demo: moving Alex's MacBook Pro in takes it offline.
    const asked = await engine.execute("device.profile.set", { devices: "Alex's MacBook Pro", profile: "Leo" });
    expect(asked).toEqual({ ok: false, error: { code: "needs_confirm", message: "Leo is paused, so Alex's MacBook Pro loses internet until it is resumed." } });
    expect(await list(engine)).toEqual(before);
    // Jamie is not paused: no question.
    expect((await engine.execute("device.profile.set", { devices: "Alex's MacBook Pro", profile: "Jamie" })).ok).toBe(true);
    // A device already in Leo stays as it is: no question.
    const leo = (await ok<M.ProfileList>(engine, "profile.list", {})).profiles.find((p) => p.name === "Leo");
    expect((await engine.execute("device.profile.set", { devices: leo?.deviceIds.slice(0, 1), profile: "Leo" })).ok).toBe(true);
    // With confirm it moves, and the device is paused with Leo.
    await ok(engine, "device.profile.set", { devices: "Alex's MacBook Pro", profile: "Leo", confirm: true });
    expect((await ok<M.Device>(engine, "device.get", { device: "Alex's MacBook Pro" })).paused).toBe(true);
  });

  it("refuses pause and block without confirm, naming who goes offline, and changes nothing", async () => {
    const { engine } = demo();
    const before = await list(engine);
    const one = await engine.execute("device.pause", { devices: "Alex's MacBook Pro" });
    expect(one).toEqual({ ok: false, error: { code: "needs_confirm", message: "Alex's MacBook Pro loses internet until resumed. It stays connected to Wi-Fi." } });
    const two = await engine.execute("device.block", { devices: ["Alex's MacBook Pro", "PlayStation 5"] });
    expect(two).toMatchObject({ ok: false, error: { code: "needs_confirm" } });
    if (!two.ok) expect(two.error.message).toMatch(/^Alex's MacBook Pro and PlayStation 5 are disconnected from every eero and can't rejoin .+ until unblocked\.$/);
    expect(await list(engine)).toEqual(before);
  });

  it("pauses and resumes one device or several, and the next read shows it", async () => {
    const { engine } = demo();
    const before = await list(engine);
    await ok(engine, "device.get", { device: "Alex's MacBook Pro" });
    const r = await ok<M.DeviceBulkResult>(engine, "device.pause", { devices: "Alex's MacBook Pro", confirm: true });
    expect(r.failed).toEqual([]);
    expect(r.devices.map((d) => [d.name, d.paused])).toEqual([["Alex's MacBook Pro", true]]);
    // The cached device.get and device.list are refreshed.
    expect((await ok<M.Device>(engine, "device.get", { device: "Alex's MacBook Pro" })).paused).toBe(true);
    expect((await list(engine)).summary.paused).toBe(before.summary.paused + 1);

    const both = await ok<M.DeviceBulkResult>(engine, "device.resume", { devices: ["Alex's MacBook Pro", "PlayStation 5"] });
    expect(both.devices.map((d) => d.paused)).toEqual([false, false]);
    expect((await list(engine, { search: "PlayStation 5" })).devices[0]?.paused).toBe(false);
  });

  it("reports a partial failure per device and fails when every device fails", async () => {
    const { engine } = demo();
    const r = await ok<M.DeviceBulkResult>(engine, "device.pause", { devices: ["Alex's MacBook Pro", "Flaky Plug"], confirm: true });
    expect(r.devices.map((d) => d.name)).toEqual(["Alex's MacBook Pro"]);
    expect(r.failed).toMatchObject([{ device: "Flaky Plug", code: "eero_error" }]);
    expect(await engine.execute("device.pause", { devices: ["Flaky Plug"], confirm: true })).toMatchObject({ ok: false, error: { code: "eero_error" } });
  });

  it("names each failed device in failed[].name, given by name, MAC or id", async () => {
    const { engine } = demo();
    const flaky = (await list(engine, { search: "Flaky Plug" })).devices[0];
    if (!flaky?.mac) throw new Error("fixture: Flaky Plug");
    for (const given of ["flaky plug", flaky.mac, flaky.id]) {
      const r = await ok<M.DeviceBulkResult>(engine, "device.block", { devices: ["PlayStation 5", given], confirm: true });
      expect(r.failed).toEqual([{ device: given, id: flaky.id, name: "Flaky Plug", code: "eero_error", message: expect.any(String) }]);
      await ok(engine, "device.unblock", { devices: "PlayStation 5" });
    }
    const moved = await ok<M.DeviceBulkResult>(engine, "device.profile.set", { devices: [flaky.id, "PlayStation 5"], profile: null });
    expect(moved.failed.map((f) => f.name)).toEqual(["Flaky Plug"]);
  });

  it("renames, and an empty nickname clears it", async () => {
    const { engine } = demo();
    const d = await ok<M.Device>(engine, "device.rename", { device: "PlayStation 5", nickname: "  Den console " });
    expect(d).toMatchObject({ name: "Den console", nickname: "Den console" });
    expect((await ok<M.Device>(engine, "device.get", { device: d.id })).name).toBe("Den console");
    const back = await ok<M.Device>(engine, "device.rename", { device: d.id, nickname: "" });
    expect(back.nickname).toBeNull();
    expect(back.name).not.toBe("Den console");
  });

  it("sets the type and its category", async () => {
    const { engine } = demo();
    const d = await ok<M.Device>(engine, "device.type.set", { device: "PlayStation 5", type: "television" });
    expect(d).toMatchObject({ type: "television", category: "entertainment" });
    const p = await ok<M.Device>(engine, "device.type.set", { device: d.id, type: "laptop_computer" });
    expect(p.category).toBe("computers");
  });

  it("drops the guess when a person sets a type, and guesses again for Other", async () => {
    const { engine } = demo();
    const before = await ok<M.Device>(engine, "device.get", { device: "Sonos Kitchen" });
    expect(before).toMatchObject({ type: "generic", inferredType: "audio", category: "entertainment" });
    const set = await ok<M.Device>(engine, "device.type.set", { device: before.id, type: "thermostat" });
    expect(set).toMatchObject({ type: "thermostat", inferredType: null, category: "smart_home" });
    const back = await ok<M.Device>(engine, "device.type.set", { device: before.id, type: "generic" });
    expect(back).toMatchObject({ type: "generic", inferredType: "audio", category: "entertainment" });
  });

  it("moves devices to a profile and back to Unassigned", async () => {
    const { engine } = demo();
    const profiles = await ok<M.ProfileList>(engine, "profile.list");
    const target = profiles.profiles[0];
    if (!target) throw new Error("fixture");
    const r = await ok<M.DeviceBulkResult>(engine, "device.profile.set", { devices: ["PlayStation 5"], profile: target.name });
    expect(r.devices[0]?.profileId).toBe(target.id);
    expect((await list(engine, { profile: target.id })).devices.map((d) => d.name)).toContain("PlayStation 5");
    const back = await ok<M.DeviceBulkResult>(engine, "device.profile.set", { devices: ["PlayStation 5"], profile: null });
    expect(back.devices[0]?.profileId).toBeNull();
    expect((await list(engine, { profile: null })).devices.map((d) => d.name)).toContain("PlayStation 5");
  });

  it("blocks and unblocks, and network.get's online count follows", async () => {
    const { engine } = demo();
    const n0 = await ok<M.Network>(engine, "network.get");
    const r = await ok<M.DeviceBulkResult>(engine, "device.block", { devices: ["PlayStation 5"], confirm: true });
    expect(r.devices[0]).toMatchObject({ blocked: true, connected: false });
    expect((await list(engine, { status: "blocked" })).devices.map((d) => d.name)).toContain("PlayStation 5");
    const n1 = await ok<M.Network>(engine, "network.get");
    expect(n1.devicesOnline).toBe((n0.devicesOnline ?? 0) - 1);
    const u = await ok<M.DeviceBulkResult>(engine, "device.unblock", { devices: ["PlayStation 5"] });
    expect(u.devices[0]).toMatchObject({ blocked: false, connected: true });
    expect((await ok<M.Network>(engine, "network.get")).devicesOnline).toBe(n0.devicesOnline);
  });

  it("fails bad_params before writing anything", async () => {
    const { engine } = demo();
    const bad: [string, Record<string, unknown>][] = [
      ["device.pause", {}],
      ["device.pause", { devices: [] }],
      ["device.pause", { devices: Array.from({ length: 51 }, (_, i) => `d${i}`) }],
      ["device.pause", { devices: ["Alex's MacBook Pro", "No Such Device"] }],
      ["device.pause", { device: "Alex's MacBook Pro" }],
      ["device.resume", { devices: 7 }],
      ["device.rename", { device: "PlayStation 5", nickname: "x".repeat(33) }],
      ["device.rename", { device: "PlayStation 5" }],
      ["device.type.set", { device: "PlayStation 5", type: "toaster_oven" }],
      ["device.profile.set", { devices: ["PlayStation 5"] }],
      ["device.profile.set", { devices: ["PlayStation 5"], profile: "Nobody" }],
      ["device.block", { devices: [""] }],
      ["device.unblock", { devices: ["No Such Device"] }],
    ];
    for (const [id, params] of bad) expect(await engine.execute(id, params), `${id} ${JSON.stringify(params)}`).toMatchObject({ ok: false, error: { code: "bad_params" } });
    // Nothing was paused by the call with one unknown ref.
    expect((await ok<M.Device>(engine, "device.get", { device: "Alex's MacBook Pro" })).paused).toBe(false);
  });

  it("works signed out only with an error", async () => {
    const { backend } = demo();
    const engine = createEngine({ backend, clock: () => NOW });
    await ok(engine, "demo.scenario.set", { scenario: "signed_out" });
    expect(await engine.execute("device.pause", { devices: ["Alex's MacBook Pro"], confirm: true })).toMatchObject({ ok: false });
  });
});

describe("device writes (fake eero server)", () => {
  let close: (() => Promise<void>) | null = null;
  afterEach(async () => {
    await close?.();
    close = null;
  });

  const setup = () => {
    const { fake, engine } = fakeEngine();
    close = fake.close;
    const maple = fake.state.networks.get("100001");
    if (!maple) throw new Error("fixture");
    return { fake, engine, maple };
  };
  const writes = (fake: ReturnType<typeof setup>["fake"]) => fake.writes.map((w) => ({ method: w.method, path: w.path, version: w.version, encoding: w.encoding, body: w.body }));

  it("pauses and resumes with a JSON PUT on /2.3/, and the next read shows it", async () => {
    const { fake, engine } = setup();
    expect((await ok<M.Device>(engine, "device.get", { device: "Alex's Phone" })).paused).toBe(false);
    const r = await ok<M.DeviceBulkResult>(engine, "device.pause", { devices: ["Alex's Phone"], confirm: true });
    expect(r.devices[0]).toMatchObject({ name: "Alex's Phone", paused: true, profileId: "700" });
    expect(writes(fake)).toEqual([{ method: "PUT", path: "/2.3/networks/100001/devices/0a1b2c000001", version: "2.3", encoding: "json", body: { paused: true } }]);
    expect((await ok<M.Device>(engine, "device.get", { device: "Alex's Phone" })).paused).toBe(true);
    await ok(engine, "device.resume", { devices: "Alex's Phone" });
    expect(fake.writes[1]?.body).toEqual({ paused: false });
    expect((await ok<M.Device>(engine, "device.get", { device: "Alex's Phone" })).paused).toBe(false);
  });

  it("the fake drops a device write on /2.2/ with a 200, as eero does", async () => {
    const { fake, maple } = setup();
    const token = fake.signIn();
    const res = await fake.fetch(`${fake.origin}/2.2/networks/100001/devices/0a1b2c000001`, { method: "PUT", headers: { "content-type": "application/json", cookie: `s=${token}` }, body: JSON.stringify({ paused: true }) });
    expect(res.status).toBe(200);
    expect(maple.devices.find((d) => d.mac === "0a:1b:2c:00:00:01")?.paused).toBe(false);
  });

  it("renames and sets the type with JSON PUTs on /2.3/", async () => {
    const { fake, engine } = setup();
    const d = await ok<M.Device>(engine, "device.rename", { device: "Alex's Phone", nickname: "Pocket" });
    expect(d.name).toBe("Pocket");
    await ok(engine, "device.rename", { device: d.id, nickname: "" });
    const t = await ok<M.Device>(engine, "device.type.set", { device: d.id, type: "tablet" });
    expect(t).toMatchObject({ type: "tablet", category: "phones_tablets" });
    expect(writes(fake)).toEqual([
      { method: "PUT", path: "/2.3/networks/100001/devices/0a1b2c000001", version: "2.3", encoding: "json", body: { nickname: "Pocket" } },
      { method: "PUT", path: "/2.3/networks/100001/devices/0a1b2c000001", version: "2.3", encoding: "json", body: { nickname: null } },
      { method: "PUT", path: "/2.3/networks/100001/devices/0a1b2c000001", version: "2.3", encoding: "json", body: { device_type: "tablet" } },
    ]);
  });

  it("sets a profile by url, and Unassigned is eero's default profile", async () => {
    const { fake, engine, maple } = setup();
    const r = await ok<M.DeviceBulkResult>(engine, "device.profile.set", { devices: ["Living Room TV"], profile: "Jamie" });
    expect(r.devices[0]?.profileId).toBe("701");
    const back = await ok<M.DeviceBulkResult>(engine, "device.profile.set", { devices: ["Living Room TV"], profile: null });
    expect(back.devices[0]?.profileId).toBeNull();
    expect(writes(fake).map((w) => w.body)).toEqual([{ profile: { url: "/2.2/networks/100001/profiles/701" } }, { profile: { url: "/2.2/networks/100001/profiles/790" } }]);
    expect(fake.writes.every((w) => w.version === "2.3" && w.encoding === "json" && w.path.startsWith("/2.3/networks/100001/devices/"))).toBe(true);
    expect(maple.devices.find((d) => d.nickname === "Living Room TV")?.profile?.url).toBe("/2.2/networks/100001/profiles/790");
    // The default profile is never offered as a profile.
    expect(await engine.execute("device.profile.set", { devices: ["Living Room TV"], profile: "790" })).toMatchObject({ ok: false, error: { code: "bad_params" } });
    expect(await engine.execute("device.profile.set", { devices: ["Living Room TV"], profile: "Unassigned" })).toMatchObject({ ok: false, error: { code: "bad_params" } });
  });

  it("blocks with a form POST and unblocks with a DELETE", async () => {
    const { fake, engine } = setup();
    const b = await ok<M.DeviceBulkResult>(engine, "device.block", { devices: ["Alex's Phone"], confirm: true });
    expect(b.devices[0]).toMatchObject({ blocked: true, connected: false });
    expect((await list(engine, { status: "blocked" })).devices.map((d) => d.name)).toEqual(["Alex's Phone"]);
    const u = await ok<M.DeviceBulkResult>(engine, "device.unblock", { devices: ["Alex's Phone"] });
    expect(u.devices[0]?.blocked).toBe(false);
    expect(writes(fake)).toEqual([
      { method: "POST", path: "/2.2/networks/100001/blacklist", version: "2.2", encoding: "form", body: { mac: "0a:1b:2c:00:00:01" } },
      { method: "DELETE", path: "/2.2/networks/100001/blacklist/0a1b2c000001", version: "2.2", encoding: "none", body: {} },
    ]);
  });

  it("invalidates devices, network and profiles so cached reads refresh", async () => {
    const { fake, engine } = setup();
    for (const id of WRITES) expect(deviceCommands.find((c) => c.id === id)?.invalidates, id).toEqual(expect.arrayContaining(["devices", "network", "profiles"]));
    await ok(engine, "device.list");
    await ok(engine, "profile.list");
    const reads = () => fake.log.filter((e) => e.method === "GET").length;
    const n = reads();
    await ok(engine, "device.list");
    expect(reads()).toBe(n);
    await ok(engine, "device.pause", { devices: ["Alex's Phone"], confirm: true });
    const p = await ok<M.ProfileList>(engine, "profile.list");
    const l = await list(engine, { paused: true });
    expect(reads()).toBeGreaterThan(n);
    expect(l.devices.map((d) => d.name)).toContain("Alex's Phone");
    expect(p.profiles.length).toBeGreaterThan(0);
  });
});
