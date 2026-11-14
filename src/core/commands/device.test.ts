import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeEero } from "../../../test/fake-eero/server";
import { type AuthState, composeBackend, type SecretStore } from "../backend";
import { createDemoBackend } from "../demo";
import { createEeroBackend } from "../eero/backend";
import { deviceCategory, deviceName, mapDevice } from "../eero/map/device";
import { createEngine } from "../engine";
import type * as M from "../model";
import { summarize } from "./device";

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
      byCategory: { phones_tablets: 12, computers: 7, entertainment: 6, smart_home: 10, other: 3 },
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

  it("filters by eero, profile, band, type, network, manufacturer and first seen", async () => {
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
    expect(names(await list(engine, { firstSeenSince: since }))).toEqual(["ESP_3A9F21", "Grandma's iPad", "Nest Thermostat"]);
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
    expect(lines[0]).toBe("Name,Status,Connected to,Band,Network,IP,MAC,Profile,Manufacturer,Model,Category,Down Mbps,Up Mbps,Last active,First seen");
    expect(lines).toHaveLength(4);
    expect(lines[3]).toMatch(/^Leo's Switch,Paused,Living Room,5 GHz,main,192\.168\.4\.172,[0-9a-f:]+,Leo,Nintendo,Switch 2,entertainment,,,/);
  });

  it("fails bad_params for wrong values and unknown refs", async () => {
    const { engine } = demo();
    for (const params of [{ status: "sleeping" }, { band: "7" }, { limit: 0 }, { firstSeenSince: "yesterday" }, { sort: "size" }, { eero: "Attic" }, { profile: "Nobody" }]) {
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

function fakeEngine() {
  const fake = createFakeEero();
  const token = fake.signIn();
  const secrets: SecretStore = { load: async () => token, save: async () => "memory", clear: async () => {}, storage: async () => "memory" };
  const live = createEeroBackend({ secrets, origin: fake.origin, fetch: fake.fetch });
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
    expect(l.summary).toMatchObject({ total: 9, online: 6, offline: 1, paused: 1, blocked: 2, rates: null });
    // The profile list tells eero's default (Unassigned) profile from people's profiles.
    expect(fake.log.map((e) => `${e.method} ${e.path}`).sort()).toEqual([
      "GET /2.2/networks/100001/blacklist",
      "GET /2.2/networks/100001/devices",
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
    expect(unassigned.devices.map((d) => d.name).sort((a, b) => a.localeCompare(b))).toEqual(["esp-plug-07", "Living Room TV", "Old Printer"]);
    expect(all.summary.byProfile.find((r) => r.profileId === null)?.count).toBe(3);
    expect(all.summary.byProfile.map((r) => r.profileId)).not.toContain("790");

    const one = await engine.execute<M.Device>("device.get", { device: "Living Room TV" });
    expect(one.ok && one.result.profileId).toBeNull();
    const csv = await engine.execute<string>("device.list", { profile: null, format: "csv" });
    if (!csv.ok) throw new Error(csv.error.message);
    expect(csv.result.match(/Unassigned/g)).toHaveLength(3);
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
    expect(l.devices.find((d) => d.name === "Alex's Phone")?.rates).toEqual({ downMbps: 10, upMbps: 1, at: new Date(start + 12_000).toISOString() });
    expect(l.devices.find((d) => d.name === "Leo's Switch")?.rates).toBeNull();

    vi.setSystemTime(start + 61_000);
    expect((await engine.execute("device.rates.refresh")).ok).toBe(true);
    expect(posts()).toHaveLength(2);
    // Without another burst, rates go missing 90 s after the last one.
    vi.setSystemTime(start + 73_000 + 91_000);
    expect((await list(engine, { limit: 1 })).summary.rates).toBeNull();
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
});
