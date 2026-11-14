import { describe, expect, it } from "vitest";
import { BackendError, type UsageQuery } from "../backend";
import type * as M from "../model";
import { createDemoBackend, type DemoBackend, dayStart, EVENT_PAGE_SIZE, isDemoBackend } from "./backend";
import { createEeroBackend } from "../eero/backend";
import { createFixtures } from "./fixtures";
import { SCENARIO_NAMES } from "./scenario";

// Thursday Nov 12 2026, 2:41 PM in Los Angeles, as in the mockups.
const NOW = Date.parse("2026-11-12T22:41:00Z");
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const MAPLE = "4821907";
const LAKE = "5130264";
const MOM = "6092118";
const TZ = "America/Los_Angeles";

const demo = (opts: Parameters<typeof createDemoBackend>[0] = {}) => createDemoBackend({ clock: () => NOW, ...opts });

const day = { range: "day", from: iso(NOW - 24 * HOUR), to: iso(NOW), cadence: "hourly", timezone: TZ } as const;
const week = { range: "week", from: iso(dayStart(NOW - 6 * 24 * HOUR, TZ)), to: iso(NOW), cadence: "daily", timezone: TZ } as const;
const series = (b: DemoBackend, net: string, scope: M.UsageScope, id: string | null, q: Omit<UsageQuery, "scope" | "id"> = day) => b.usage.series(net, { ...q, scope, id });
const sum = (xs: { down: number; up: number }[]) => xs.reduce((s, x) => s + x.down + x.up, 0);
const count = <T>(xs: T[], f: (x: T) => boolean) => xs.filter(f).length;

describe("demo fixtures", () => {
  it("are deterministic for a clock and seed", () => {
    expect(createFixtures(NOW, 7)).toEqual(createFixtures(NOW, 7));
  });

  it("is a demo Backend", () => {
    const b = demo();
    expect(b.kind).toBe("demo");
    expect(isDemoBackend(b)).toBe(true);
  });
});

describe("networks and account", () => {
  it("lists the three networks from the mockups with counts that match the lists", async () => {
    const b = demo();
    const nets = await b.network.list();
    expect(nets.map((n) => [n.name, n.nickname, n.role, n.status])).toEqual([
      ["Maple Street", null, "owner", "online"],
      ["Lake Cabin", null, "owner", "offline"],
      ["Kim Home", "Mom's House", "admin", "online"],
    ]);
    for (const n of nets) {
      const eeros = await b.eero.list(n.id);
      const devices = await b.device.list(n.id);
      const profiles = await b.profile.list(n.id);
      const full = await b.network.get(n.id);
      expect(n.eeroCount).toBe(eeros.length);
      expect(n.devicesOnline).toBe(count(devices, (d) => d.connected));
      expect(n.updateAvailable).toBe(eeros.some((e) => e.updateAvailable));
      expect(full.counts).toEqual({ eeros: eeros.length, devices: devices.length, profiles: profiles.length });
      expect(full).toMatchObject({ id: n.id, eeroCount: n.eeroCount, devicesOnline: n.devicesOnline });
    }
    expect(nets.map((n) => [n.eeroCount, n.devicesOnline])).toEqual([[4, 31], [1, 0], [2, 9]]);
    const account = await b.account.get();
    expect(account).toMatchObject({ name: "Alex Kim", email: { value: "alex@example.com", verified: true }, networkCount: nets.length });
  });

  it("covers the states pages must handle", async () => {
    const b = demo();
    const lake = await b.network.get(LAKE);
    expect(lake.lastSeen).not.toBeNull();
    expect((await b.eero.list(LAKE))[0]?.status).toBe("offline");
    const mom = await b.network.get(MOM);
    expect(mom.connectionMode).toBe("bridged");
    expect(mom.capabilities.thread_network).toBe(false);
    expect((await b.network.permissions(MOM)).role).toBe("admin");
    expect((await b.network.permissions(MOM)).can["network.transfer"]?.update).toBe(false);
    expect((await b.network.permissions(MAPLE)).can["network.transfer"]?.update).toBe(true);
    const eeros = await b.eero.list(MAPLE);
    expect(eeros.every((e) => e.updateAvailable)).toBe(true);
    expect(eeros.filter((e) => e.nightlight !== null).map((e) => e.model)).toEqual(["eero Beacon"]);
    const devices = await b.device.list(MAPLE);
    expect(count(devices, (d) => d.blocked)).toBe(2);
    const states = (await b.profile.list(MAPLE)).map((p) => [p.name, p.state]);
    expect(states).toEqual([["Alex", "active"], ["Jamie", "active"], ["Mia", "scheduled"], ["Leo", "paused"]]);
  });

  it("reports health per eero with the Garage weak link", async () => {
    const b = demo();
    const health = await b.network.health(MAPLE);
    const eeros = await b.eero.list(MAPLE);
    expect(health.eeros.map((e) => e.id)).toEqual(eeros.map((e) => e.id));
    expect(health.eeros.filter((e) => e.weakLink).map((e) => e.location)).toEqual(["Garage"]);
    expect((await b.network.health(LAKE)).status).toBe("offline");
  });
});

describe("eeros", () => {
  it("has the four Maple Street eeros with clients counted from the device list", async () => {
    const b = demo();
    const eeros = await b.eero.list(MAPLE);
    const devices = await b.device.list(MAPLE);
    expect(eeros.map((e) => [e.location, e.model, e.isGateway, e.clients.total])).toEqual([
      ["Living Room", "eero Max 7", true, 12],
      ["Office", "eero Pro 7", false, 9],
      ["Upstairs Hall", "eero 7", false, 7],
      ["Garage", "eero Beacon", false, 3],
    ]);
    for (const e of eeros) {
      const on = devices.filter((d) => d.connected && d.eeroId === e.id);
      expect(e.clients.total).toBe(on.length);
      expect(e.clients.wired).toBe(count(on, (d) => d.band === "wired"));
      expect((e.clients.wired ?? 0) + (e.clients.wireless ?? 0)).toBe(e.clients.total);
      expect(e.radios.reduce((s, r) => s + (r.clients ?? 0), 0)).toBe(e.clients.wireless);
      if (e.upstream) expect(eeros.some((x) => x.id === e.upstream)).toBe(true);
      expect(await b.eero.get(MAPLE, e.id)).toEqual(e);
    }
  });

  it("fails like eero for an unknown eero or network", async () => {
    const b = demo();
    await expect(b.eero.get(MAPLE, "nope")).rejects.toMatchObject({ code: "eero_error", detail: { status: 404 } });
    await expect(b.network.get("nope")).rejects.toBeInstanceOf(BackendError);
  });
});

describe("devices", () => {
  it("matches the Devices page counts", async () => {
    const devices = await demo().device.list(MAPLE);
    const online = devices.filter((d) => d.connected);
    expect(devices).toHaveLength(38);
    expect(online).toHaveLength(31);
    expect(count(devices, (d) => !d.connected && !d.blocked)).toBe(5);
    expect(count(devices, (d) => d.paused)).toBe(3);
    const byBand = (band: M.Band) => count(online, (d) => d.band === band);
    expect([byBand("wired"), byBand("2.4"), byBand("5"), byBand("6")]).toEqual([4, 11, 10, 6]);
    const byCat = (c: M.DeviceCategory) => count(devices, (d) => d.category === c);
    expect([byCat("phones_tablets"), byCat("computers"), byCat("entertainment"), byCat("smart_home"), byCat("other")]).toEqual([12, 7, 6, 10, 3]);
    const weekAgo = NOW - 7 * 24 * HOUR;
    expect(devices.filter((d) => d.firstSeen && Date.parse(d.firstSeen) > weekAgo).map((d) => d.name)).toEqual(["Grandma's iPad", "Nest Thermostat", "ESP_3A9F21"]);
    expect(devices.filter((d) => d.ssid === "guest").map((d) => d.name)).toEqual(["Sam's Pixel"]);
    expect(new Set(devices.map((d) => d.id)).size).toBe(38);
    for (const d of devices) {
      expect(d.id).toBe(d.mac.replace(/:/g, ""));
      if (!d.connected) expect([d.band, d.signal, d.rates]).toEqual([null, null, null]);
      if (d.paused) expect(d.rates).toBeNull();
      if (d.blocked) expect([d.eeroId, d.ipv4]).toEqual([null, null]);
    }
  });

  it("returns a reservation from device.get only", async () => {
    const b = demo();
    const mbp = (await b.device.list(MAPLE)).find((d) => d.name === "Alex's MacBook Pro");
    expect(mbp?.reservation).toBeNull();
    const got = await b.device.get(MAPLE, mbp?.id ?? "");
    expect(got.reservation).toEqual({ id: expect.any(String), ip: "192.168.4.23" });
  });

  it("moves live rates after a burst, deterministically", async () => {
    let t = NOW;
    const b1 = createDemoBackend({ clock: () => t });
    const b2 = createDemoBackend({ clock: () => t });
    const rate = async (b: DemoBackend) => (await b.device.list(MAPLE)).find((d) => d.name === "Living Room TV")?.rates;
    const before = await rate(b1);
    expect(before).toEqual({ downMbps: 58.2, upMbps: 0.6, at: iso(NOW) });
    const burst = await b1.device.requestBurst(MAPLE);
    expect(Date.parse(burst.nextBurstAt) - NOW).toBe(3_000);
    await b2.device.requestBurst(MAPLE);
    t += 3_000;
    const after = await rate(b1);
    expect(after?.downMbps).not.toBe(58.2);
    expect(after).toEqual(await rate(b2));
  });

  it("returns copies, so callers cannot change the fixtures", async () => {
    const b = demo();
    const [first] = await b.device.list(MAPLE);
    if (first) first.name = "changed";
    expect((await b.device.list(MAPLE))[0]?.name).not.toBe("changed");
  });
});

describe("profiles", () => {
  it("lists devices from the device list's profile ids", async () => {
    const b = demo();
    const profiles = await b.profile.list(MAPLE);
    const devices = await b.device.list(MAPLE);
    expect(profiles.map((p) => [p.name, p.deviceIds.length, p.devicesOnline])).toEqual([
      ["Alex", 6, 6],
      ["Jamie", 5, 3],
      ["Mia", 4, 3],
      ["Leo", 3, 2],
    ]);
    for (const p of profiles) {
      expect(p.deviceIds).toEqual(devices.filter((d) => d.profileId === p.id).map((d) => d.id));
      expect(p.devicesOnline).toBe(count(devices, (d) => d.profileId === p.id && d.connected));
      expect(await b.profile.get(MAPLE, p.id)).toEqual(p);
    }
    expect(count(devices, (d) => d.profileId === null)).toBe(20);
    const mia = profiles.find((p) => p.name === "Mia");
    expect(mia?.schedules.map((s) => [s.name, s.start, s.end, s.enabled])).toEqual([
      ["Bedtime", "21:00", "07:00", true],
      ["Homework", "16:00", "18:00", true],
      ["Weekend lights out", "23:00", "09:00", false],
    ]);
    expect((await b.profile.list(MOM))).toEqual([]);
  });
});

describe("usage", () => {
  it("adds up across network, eero, profile and device scopes", async () => {
    const b = demo();
    const network = await series(b, MAPLE, "network", null);
    expect(network.points.length).toBeGreaterThanOrEqual(24);
    expect(sum(network.points)).toBe(network.total.down + network.total.up);
    expect(network.total.down).toBeGreaterThan(network.total.up);
    expect(network.busiest).not.toBeNull();
    const eeros = await b.eero.list(MAPLE);
    const byEero = await Promise.all(eeros.map((e) => series(b, MAPLE, "eero", e.id)));
    expect(sum(byEero.map((s) => s.total))).toBe(network.total.down + network.total.up);

    for (const by of ["device", "eero", "profile"] as const) {
      const br = await b.usage.breakdown(MAPLE, { by, range: "day", from: day.from, to: day.to });
      expect(br.total).toEqual(network.total);
      expect(sum(br.rows)).toBe(sum([br.total]));
    }
    const profiles = await b.profile.list(MAPLE);
    const profileBreakdown = await b.usage.breakdown(MAPLE, { by: "profile", range: "day", from: day.from, to: day.to });
    for (const p of profiles) {
      const s = await series(b, MAPLE, "profile", p.id);
      expect(profileBreakdown.rows.find((r) => r.id === p.id)).toMatchObject(s.total);
    }
    expect(profileBreakdown.rows.at(-1)).toMatchObject({ id: null, name: "Unassigned" });
    const tv = (await b.device.list(MAPLE)).find((d) => d.name === "Living Room TV");
    const tvSeries = await series(b, MAPLE, "device", tv?.id ?? null);
    const deviceBreakdown = await b.usage.breakdown(MAPLE, { by: "device", range: "day", from: day.from, to: day.to });
    expect(deviceBreakdown.rows.find((r) => r.id === tv?.id)).toMatchObject(tvSeries.total);
    // The TV is the top device on the Overview mockup.
    const top = [...deviceBreakdown.rows].sort((a, z) => z.down + z.up - (a.down + a.up))[0];
    expect(top?.name).toBe("Living Room TV");
  });

  it("gives daily buckets at local midnight for a week", async () => {
    const b = demo();
    const s = await series(b, MAPLE, "network", null, week);
    expect(s.points).toHaveLength(7);
    for (const p of s.points) expect(new Date(p.at).toLocaleTimeString("en-US", { timeZone: TZ, hour12: false })).toBe("00:00:00");
    const hourly = await series(b, MAPLE, "network", null, { ...week, cadence: "hourly" });
    expect(hourly.total).toEqual(s.total);
    const today = s.points.at(-1);
    expect(s.todaySoFar).toBe((today?.down ?? 0) + (today?.up ?? 0));
  });

  it("keeps guest usage to guest devices and offline networks quiet", async () => {
    const b = demo();
    const guest = await series(b, MAPLE, "guest", null, week);
    const sam = (await b.device.list(MAPLE)).find((d) => d.name === "Sam's Pixel");
    expect(guest.total).toEqual((await series(b, MAPLE, "device", sam?.id ?? null, week)).total);
    const lake = await series(b, LAKE, "network", null);
    expect(lake.total).toEqual({ down: 0, up: 0 });
    expect(lake.busiest).toBeNull();
  });

  it("rejects an unknown scope id or a bad range", async () => {
    const b = demo();
    await expect(series(b, MAPLE, "profile", "nope")).rejects.toMatchObject({ code: "eero_error" });
    await expect(b.usage.series(MAPLE, { ...day, to: day.from, scope: "network", id: null })).rejects.toMatchObject({ code: "bad_params" });
  });
});

describe("internet and speed tests", () => {
  it("returns the newest test as the last speed test, filtered by range and limit", async () => {
    const b = demo();
    const internet = await b.internet.get(MAPLE);
    expect(internet.isp.name).toBe("Ziply Fiber");
    expect(internet.lastSpeedTest).toMatchObject({ downMbps: 942, upMbps: 918, rating: null });
    const lastWeek = await b.internet.speedTests(MAPLE, { from: iso(NOW - 7 * 24 * HOUR), to: iso(NOW), limit: 100 });
    expect(lastWeek).toHaveLength(15);
    expect(lastWeek[0]).toEqual(internet.lastSpeedTest);
    expect([...lastWeek].sort((a, z) => z.at.localeCompare(a.at))).toEqual(lastWeek);
    expect(await b.internet.speedTests(MAPLE, { from: iso(NOW - 30 * 24 * HOUR), to: iso(NOW), limit: 5 })).toHaveLength(5);
  });
});

describe("events", () => {
  it("pages through every event newest first, covering every category", async () => {
    const b = demo();
    const all: M.NetworkEvent[] = [];
    let cursor: string | null = null;
    do {
      const page: { events: M.NetworkEvent[]; nextCursor: string | null } = await b.events.list(MAPLE, cursor);
      expect(page.events.length).toBeLessThanOrEqual(EVENT_PAGE_SIZE);
      all.push(...page.events);
      cursor = page.nextCursor;
    } while (cursor);
    expect(all.length).toBeGreaterThan(400);
    expect(new Set(all.map((e) => e.id)).size).toBe(all.length);
    expect([...all].sort((a, z) => z.at.localeCompare(a.at)).map((e) => e.id)).toEqual(all.map((e) => e.id));
    const categories: M.EventCategory[] = ["devices", "pause_block", "schedules", "eero_status", "speed_tests", "firmware", "admin", "ports_temperature", "other"];
    for (const c of categories) expect(all.some((e) => e.category === c)).toBe(true);
    expect(all.every((e) => Date.parse(e.at) <= NOW)).toBe(true);
    expect(all.slice(0, 2).map((e) => e.title)).toEqual(["Profile Leo paused by Alex Kim", "New device joined: Nest Thermostat"]);
    await expect(b.events.list(MAPLE, "x")).rejects.toMatchObject({ code: "bad_params" });
  });
});

describe("auth", () => {
  it("signs in with any 6-digit code and rejects 111111", async () => {
    const b = demo({ scenario: "signed_out" });
    expect(await b.auth.status()).toEqual({ signedIn: false, pending: false, login: null, storage: "memory" });
    await expect(b.network.list()).rejects.toMatchObject({ code: "not_signed_in" });
    await expect(b.auth.start("not a login")).rejects.toMatchObject({ code: "bad_params" });
    await b.auth.start("alex@example.com");
    expect(await b.auth.status()).toMatchObject({ pending: true, login: "al***@example.com" });
    await b.auth.resend();
    await expect(b.auth.verify("111111")).rejects.toMatchObject({ code: "eero_error" });
    expect((await b.auth.status()).pending).toBe(true);
    await b.auth.verify("000000");
    expect(await b.auth.status()).toMatchObject({ signedIn: true, pending: false });
    expect(await b.network.list()).toHaveLength(3);
    await b.auth.logout();
    await expect(b.account.get()).rejects.toMatchObject({ code: "not_signed_in" });
  });
});

describe("scenarios", () => {
  it("every scenario answers every read consistently", async () => {
    const b = demo({ slowMs: 1 });
    for (const name of SCENARIO_NAMES) {
      b.setScenario(name);
      expect(b.scenario()).toBe(name);
      if (name === "signed_out") {
        await expect(b.network.list()).rejects.toMatchObject({ code: "not_signed_in" });
        continue;
      }
      if (name === "errors") {
        await expect(b.network.list()).rejects.toMatchObject({ code: "eero_error" });
        continue;
      }
      const nets = await b.network.list();
      expect((await b.account.get()).networkCount).toBe(nets.length);
      for (const n of nets) {
        const devices = await b.device.list(n.id);
        const eeros = await b.eero.list(n.id);
        expect(n.devicesOnline).toBe(count(devices, (d) => d.connected));
        expect(sum(eeros.map((e) => ({ down: e.clients.total ?? 0, up: 0 })))).toBe(n.devicesOnline);
        await b.network.get(n.id);
        await b.network.health(n.id);
        await b.network.permissions(n.id);
        await b.internet.get(n.id);
        await b.profile.list(n.id);
        await b.events.list(n.id, null);
        await series(b, n.id, "network", null);
        await b.guest.get(n.id);
        await b.wifi.get(n.id);
        await b.settings.get(n.id);
        await b.diagnostics.latest(n.id);
        await b.diagnostics.support(n.id);
        await b.admins.list(n.id);
        await b.integrations.get(n.id);
        await b.notifications.list(n.id, null);
        await b.notifications.settings(n.id);
      }
    }
  });

  it("slow delays every read but sign-in", async () => {
    const b = demo({ scenario: "slow", slowMs: 60 });
    let t = performance.now();
    await b.auth.status();
    expect(performance.now() - t).toBeLessThan(40);
    t = performance.now();
    await b.network.list();
    expect(performance.now() - t).toBeGreaterThanOrEqual(55);
    t = performance.now();
    await b.guest.get(MAPLE);
    expect(performance.now() - t).toBeGreaterThanOrEqual(55);
  });

  it("errors fails every read with eero_error, keeps sign-in, and resets cleanly", async () => {
    const b = demo({ scenario: "errors" });
    expect(await b.auth.status()).toMatchObject({ signedIn: true });
    for (const read of [() => b.network.list(), () => b.device.list(MAPLE), () => b.wifi.get(MAPLE), () => b.notifications.list(MAPLE, null)]) {
      const err = await read().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BackendError);
      expect(err).toMatchObject({ code: "eero_error" });
    }
    b.setScenario("default");
    expect(await b.network.list()).toHaveLength(3);
  });

  it("drops the Garage eero and its devices in eero_offline", async () => {
    const b = demo({ scenario: "eero_offline" });
    const eeros = await b.eero.list(MAPLE);
    const garage = eeros.find((e) => e.location === "Garage");
    expect(garage).toMatchObject({ status: "offline", clients: { total: 0 } });
    expect((await b.network.list())[0]?.devicesOnline).toBe(28);
  });

  it("resets to pristine fixtures", async () => {
    const b = demo({ scenario: "no_networks" });
    expect(await b.network.list()).toEqual([]);
    b.setScenario("default");
    expect(await b.network.list()).toHaveLength(3);
  });
});

describe("M2 fixtures", () => {
  it("attach each wired port to the connected device that device.list puts on it", async () => {
    const b = demo();
    for (const n of await b.network.list()) {
      const devices = await b.device.list(n.id);
      for (const e of await b.eero.list(n.id)) {
        const { eeroId, ports } = await b.eero.ports(n.id, e.id);
        expect(eeroId).toBe(e.id);
        for (const p of ports) {
          const wired = devices.find((d) => d.connected && d.wiredPort?.eeroId === e.id && d.wiredPort.port === p.number);
          expect(p.attached?.deviceId ?? null).toBe(wired?.id ?? null);
          if (p.attached) expect(wired?.eeroId).toBe(e.id);
          if (wired && e.status !== "offline") expect(p).toMatchObject({ status: "up", speedMbps: wired.wiredPort?.speedMbps });
        }
      }
      // Every connected wired device sits on a port of its eero.
      for (const d of devices.filter((x) => x.connected && x.wiredPort)) {
        const { ports } = await b.eero.ports(n.id, d.wiredPort?.eeroId ?? "");
        expect(ports.find((p) => p.number === d.wiredPort?.port)?.attached?.deviceId).toBe(d.id);
      }
    }
  });

  it("give the gateway WAN port the internet gateway's speed and the Beacon no ports", async () => {
    const b = demo();
    const wan = (await b.eero.ports(MAPLE, "80011")).ports.find((p) => p.isWan);
    expect(wan).toMatchObject({ number: 1, status: "up", speedMbps: (await b.internet.get(MAPLE)).gateway?.wanPortSpeedMbps, attached: null });
    expect((await b.eero.ports(MAPLE, "80014")).ports).toEqual([]);
    expect((await b.eero.ports(LAKE, "81021")).ports.every((p) => p.status === "down")).toBe(true);
  });

  it("end firmware history at each eero's current version, newest first", async () => {
    const b = demo();
    for (const n of await b.network.list()) {
      for (const e of await b.eero.list(n.id)) {
        const h = await b.eero.firmwareHistory(n.id, e.id, 50);
        expect(h.length).toBeGreaterThan(0);
        expect(h[0]).toMatchObject({ version: e.firmware, current: true });
        expect(h.filter((x) => x.current)).toHaveLength(1);
        expect(h.map((x) => x.installedAt)).toEqual([...h.map((x) => x.installedAt)].sort().reverse());
      }
    }
    expect(await b.eero.firmwareHistory(MAPLE, "80011", 2)).toHaveLength(2);
  });

  it("refuse ports and firmware for an unknown eero or one on another network", async () => {
    const b = demo();
    await expect(b.eero.ports(MAPLE, "nope")).rejects.toBeInstanceOf(BackendError);
    await expect(b.eero.ports(MAPLE, "81021")).rejects.toMatchObject({ code: "eero_error" });
    await expect(b.eero.firmwareHistory(MOM, "80011", 5)).rejects.toMatchObject({ code: "eero_error" });
  });

  it("put every Maple Street forward on a reserved device, with matching counts", async () => {
    const b = demo();
    const r = await b.routing.get(MAPLE);
    expect(r.reservations).toHaveLength(8);
    expect(r.forwards).toHaveLength(5);
    expect(r.pinholes).toHaveLength(2);
    const devices = await b.device.list(MAPLE);
    for (const f of r.forwards) {
      const res = r.reservations.find((x) => x.deviceId === f.deviceId);
      expect(res?.ip).toBe(f.ip);
      expect(devices.find((d) => d.id === f.deviceId)?.ipv4).toBe(f.ip);
    }
    for (const res of r.reservations) expect(res.forwards).toBe(r.forwards.filter((f) => f.deviceId === res.deviceId).length);
    for (const p of r.pinholes) expect(devices.find((d) => d.id === p.deviceId)?.ipv6).toContain(p.address);
    // Leases are counted in core (reservation.list), not by the backend.
    expect(r.lan?.pool.leased).toBe(0);
  });

  it("answer routing empty in bridge mode", async () => {
    expect(await demo().routing.get(MOM)).toEqual({ reservations: [], forwards: [], pinholes: [], lan: null });
  });

  it("report updates per network with per-eero versions from the eeros", async () => {
    const b = demo();
    const maple = await b.updates.get(MAPLE);
    expect(maple).toMatchObject({ status: "scheduled", current: "7.12.1", target: "7.13.0", canUpdateNow: true });
    expect(maple.eeros.map((e) => e.firmware)).toEqual((await b.eero.list(MAPLE)).map((e) => e.firmware));
    expect(Date.parse(maple.scheduledAt ?? "")).toBeGreaterThan(NOW);
    expect(await b.updates.get(LAKE)).toMatchObject({ status: "up_to_date", current: "7.11.4", target: null });
    expect(await b.updates.get(MOM)).toMatchObject({ status: "available", target: "7.13.0" });
  });

  it("fill tx power, auto channel, subnet and link-local addresses, and no lease time", async () => {
    const b = demo();
    expect(await b.internet.get(MAPLE)).not.toHaveProperty("leaseRenewsAt");
    const office = await b.eero.get(MAPLE, "80012");
    expect(office).toMatchObject({ subnet: "192.168.4.0/22", gatewayIp: "192.168.4.1" });
    expect(office.radios.find((r) => r.band === "5")).toMatchObject({ txPowerDbm: 23, autoChannel: false });
    expect(office.radios.find((r) => r.band === "6")).toMatchObject({ txPowerDbm: 24, autoChannel: true });
    expect((await b.eero.get(LAKE, "81021")).radios.every((r) => r.txPowerDbm === null)).toBe(true);
    const devices = await b.device.list(MAPLE);
    expect(devices.filter((d) => d.ipv4).every((d) => d.ipv6LinkLocal?.startsWith("fe80::"))).toBe(true);
    expect(new Set(devices.map((d) => d.ipv6LinkLocal).filter(Boolean)).size).toBe(count(devices, (d) => !!d.ipv4));
  });
});

describe("invented data only", () => {
  it("uses invented MACs, private or documentation IPs and example contacts", async () => {
    const b = demo();
    const dump: unknown[] = [await b.account.get()];
    for (const n of await b.network.list()) {
      dump.push(await b.network.get(n.id), await b.internet.get(n.id), await b.eero.list(n.id), await b.device.list(n.id), await b.events.list(n.id, null));
      dump.push(await b.routing.get(n.id), await b.updates.get(n.id));
      for (const e of await b.eero.list(n.id)) dump.push(await b.eero.ports(n.id, e.id), await b.eero.firmwareHistory(n.id, e.id, 50));
    }
    const text = JSON.stringify(dump);
    const macs = text.match(/\b[0-9a-f]{2}(?::[0-9a-f]{2}){5}\b/gi) ?? [];
    expect(macs.length).toBeGreaterThan(50);
    for (const m of macs) expect(m).toMatch(/^0[26]:4d:55:/);
    const ipv4 = text.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? [];
    for (const ip of ipv4) expect(ip).toMatch(/^(192\.168\.|203\.0\.113\.|198\.51\.100\.)/);
    const ipv6 = text.match(/\b[0-9a-f]{1,4}(?::[0-9a-f]{0,4}){2,7}\b/gi)?.filter((s) => !/^0[26]:4d:55/.test(s) && s.includes("::")) ?? [];
    // Link-local addresses are built from the invented MACs (fe80::4d:55ff:fe..).
    for (const ip of ipv6) expect(ip.toLowerCase()).toMatch(/^(2001:db8:|fe80::4?4d:55ff:fe)/);
    expect(text).toContain("fe80::");
    for (const email of text.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) ?? []) expect(email).toMatch(/@example\.com$/);
    expect(text).toContain("+15550100142");
    for (const asn of text.match(/AS\d+/g) ?? []) expect(Number(asn.slice(2))).toBeGreaterThanOrEqual(64496);
  });
});

describe("wave 2 reads (M3)", () => {
  const nets = [MAPLE, LAKE, MOM];

  it("guests are the devices on the guest network", async () => {
    const b = demo();
    for (const id of nets) {
      const devices = await b.device.list(id);
      const g = await b.guest.get(id);
      const onGuest = devices.filter((d) => d.ssid === "guest");
      expect(g.deviceIds.sort()).toEqual(onGuest.map((d) => d.id).sort());
      expect(g.online).toBe(g.enabled ? count(onGuest, (d) => d.connected) : 0);
      expect(g.hasPassword).toBe((await b.guest.credentials(id)).password !== null);
    }
    const maple = await b.guest.get(MAPLE);
    expect(maple).toMatchObject({ enabled: true, name: "Maple Street Guest", hasPassword: true });
    expect(maple.deviceIds.length).toBeGreaterThan(0);
    // Guest usage is the guests' traffic.
    expect(sum([(await series(b, MAPLE, "guest", null, week)).total])).toBeGreaterThan(0);
    // Lake Cabin's guest network is open; Mom's House is in bridge mode, so it is off.
    expect(await b.guest.get(LAKE)).toMatchObject({ enabled: true, hasPassword: false, security: { "2.4": null, "5": null, "6": null } });
    expect(await b.guest.get(MOM)).toMatchObject({ enabled: false, online: 0 });
  });

  it("guest.get and wifi.get never carry a password", async () => {
    const b = demo();
    for (const id of nets) {
      const guestPw = (await b.guest.credentials(id)).password;
      const wifiPw = (await b.wifi.credentials(id)).password;
      const text = JSON.stringify([await b.guest.get(id), await b.wifi.get(id)]);
      for (const pw of [guestPw, wifiPw]) if (pw) expect(text).not.toContain(pw);
    }
  });

  it("pinholes and forwards point at reserved devices", async () => {
    const b = demo();
    for (const id of nets) {
      const r = await b.routing.get(id);
      const devices = await b.device.list(id);
      const reserved = new Map(r.reservations.map((x) => [x.deviceId, x]));
      for (const f of r.forwards) {
        expect(reserved.has(f.deviceId)).toBe(true);
        expect(f.ip).toBe(reserved.get(f.deviceId)?.ip);
      }
      for (const p of r.pinholes) {
        expect(reserved.has(p.deviceId)).toBe(true);
        expect(devices.find((d) => d.id === p.deviceId)?.ipv6).toContain(p.address);
      }
    }
    expect((await b.routing.get(MAPLE)).pinholes.length).toBeGreaterThan(0);
  });

  it("the unread flag matches the unread notifications", async () => {
    const b = demo();
    for (const id of nets) {
      const page = await b.notifications.list(id, null);
      expect(await b.notifications.unread(id)).toBe(page.notifications.some((n) => !n.read));
      const ats = page.notifications.map((n) => n.at);
      expect(ats).toEqual([...ats].sort().reverse());
      const ids = new Set((await b.device.list(id)).map((d) => d.id));
      for (const n of page.notifications) if (n.refs.deviceId) expect(ids.has(n.refs.deviceId)).toBe(true);
    }
    expect(count((await b.notifications.list(MAPLE, null)).notifications, (n) => !n.read)).toBe(3);
    expect(await b.notifications.unread(MOM)).toBe(false);
    expect(await b.notifications.settings(MAPLE)).toMatchObject({ "device.new": true, "network.dataUsageReport": false });
    await expect(b.notifications.list(MAPLE, "x")).rejects.toMatchObject({ code: "bad_params" });
  });

  it("Wi-Fi bands, clients and WPA2-only devices agree with the eeros and devices", async () => {
    const b = demo();
    for (const id of nets) {
      const w = await b.wifi.get(id);
      const devices = await b.device.list(id);
      const ids = new Set(devices.map((d) => d.id));
      expect(w.ssid).toBe((await b.network.get(id)).name);
      expect(w.wirelessClients).toBe(w.bands.reduce((n, x) => n + x.clients, 0));
      for (const d of w.wpa2OnlyDevices) expect(ids.has(d)).toBe(true);
    }
    const maple = await b.wifi.get(MAPLE);
    expect(maple.bands.map((x) => x.band)).toEqual(["2.4", "5", "6"]);
    expect(maple.bands.find((x) => x.band === "6")).toMatchObject({ on: true, widthsMhz: [160], channels: [37, 69] });
    expect(maple.wpa2OnlyDevices).toHaveLength(3);
    expect((await b.wifi.get(MOM)).bands.map((x) => x.band)).toEqual(["2.4", "5"]);
    // Lake Cabin is offline: no band is broadcasting.
    expect((await b.wifi.get(LAKE)).bands.every((x) => !x.on && x.clients === 0)).toBe(true);
  });

  it("settings take DHCP from the LAN map, keep Thread secrets out, and cover bridge mode", async () => {
    const b = demo();
    const maple = await b.settings.get(MAPLE);
    const lan = (await b.routing.get(MAPLE)).lan;
    expect(maple.dhcp).toEqual({ mode: "automatic", subnetIp: "192.168.4.0", subnetMask: "255.255.252.0", gateway: lan?.gateway, startIp: lan?.pool.start, endIp: lan?.pool.end });
    expect(maple.dns.ispServers).toEqual((await b.internet.get(MAPLE)).dnsInUse);
    expect(maple).toMatchObject({ connectionMode: "nat", timezone: TZ, wan: { mode: "dhcp" }, thread: { enabled: true } });
    expect(maple.powerSaving.schedules.some((s) => s.enabled)).toBe(true);
    const secrets = await b.settings.threadCredentials(MAPLE);
    expect(secrets?.networkKey).toBeTruthy();
    expect(JSON.stringify(maple)).not.toContain(secrets?.networkKey);
    const mom = await b.settings.get(MOM);
    expect(mom).toMatchObject({ connectionMode: "bridged", dhcp: { mode: "bridged", startIp: null }, thread: null, sqm: null });
    expect(await b.settings.threadCredentials(MOM)).toBeNull();
  });

  it("admins have one owner and one of them is you; invites are the owner's to see", async () => {
    const b = demo();
    for (const id of nets) {
      const { admins } = await b.admins.list(id);
      expect(count(admins, (a) => a.role === "owner")).toBe(1);
      expect(count(admins, (a) => a.isYou)).toBe(1);
    }
    const maple = await b.admins.list(MAPLE);
    expect(maple.admins.map((a) => a.name)).toEqual(["Alex Kim", "Jamie Kim"]);
    expect(maple.invites).toHaveLength(1);
    const invite = maple.invites[0];
    expect(Date.parse(invite?.expiresAt ?? "")).toBeGreaterThan(NOW);
    expect(Date.parse(invite?.createdAt ?? "")).toBeLessThan(NOW);
    // Events name admins by id; they must exist.
    const adminIds = new Set(maple.admins.map((a) => a.id));
    for (const e of (await b.events.list(MAPLE, null)).events) if (e.refs.adminId) expect(adminIds.has(e.refs.adminId)).toBe(true);
    // Mom's House: Alex is an admin and cannot read invites.
    const mom = await b.admins.list(MOM);
    expect(mom.admins.find((a) => a.isYou)?.role).toBe("admin");
    expect(mom.invites).toEqual([]);
  });

  it("the health inputs carry a warning, and support contacts are filled", async () => {
    const b = demo();
    const latest = await b.diagnostics.latest(MAPLE);
    expect(latest.results.some((r) => r.status === "warning")).toBe(true);
    const health = await b.network.health(MAPLE);
    expect(health.eeros.some((e) => e.weakLink)).toBe(true);
    const support = await b.diagnostics.support(MAPLE);
    expect(support.eero.phone).toMatch(/^\+1\d{3}555\d{4}$/);
    expect(support.isp?.name).toBe((await b.internet.get(MAPLE)).isp.name);
    expect((await b.diagnostics.support(LAKE)).isp).toBeNull();
  });

  it("integrations list every partner feature; unavailable ones have no enabled state", async () => {
    const b = demo();
    for (const id of nets) {
      const all = await b.integrations.get(id);
      expect(Object.keys(all).sort()).toEqual(["amazon", "builtin", "ffs", "homekit", "smart_home_hub"]);
      for (const x of Object.values(all)) if (!x.available) expect(x.enabled).toBeNull();
    }
  });

  it("names no real-looking addresses: MACs are locally administered and IPs private or documentation ranges", async () => {
    const b = demo();
    const text = JSON.stringify(await Promise.all(nets.flatMap((id) => [b.settings.get(id), b.diagnostics.support(id), b.admins.list(id), b.notifications.list(id, null)])));
    for (const ip of text.match(/\b\d{1,3}(\.\d{1,3}){3}\b/g) ?? []) expect(ip).toMatch(/^(192\.168\.|10\.|203\.0\.113\.|198\.51\.100\.|255\.)/);
    for (const email of text.match(/[\w.+-]+@[\w.-]+/g) ?? []) expect(email).toMatch(/@example\.com$/);
  });
});

describe("eero backend", () => {
  it("answers not available yet for the M3 areas until their stories land", async () => {
    const b = createEeroBackend({ secrets: { load: async () => "t", save: async () => "memory", clear: async () => {}, storage: async () => "memory" }, fetch: async () => Promise.reject(new Error("no network in tests")) });
    const calls: [string, () => Promise<unknown>][] = [
      ["guest.get", () => b.guest.get("1")],
      ["wifi.get", () => b.wifi.get("1")],
      ["settings.get", () => b.settings.get("1")],
      ["diagnostics.latest", () => b.diagnostics.latest("1")],
      ["admins.list", () => b.admins.list("1")],
      ["integrations.get", () => b.integrations.get("1")],
      ["notifications.list", () => b.notifications.list("1", null)],
    ];
    for (const [name, call] of calls) {
      await expect(call()).rejects.toMatchObject({ code: "eero_error", message: `${name} is not available in the eero backend yet.` });
    }
  });
});
