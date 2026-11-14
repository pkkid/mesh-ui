import { afterEach, describe, expect, it } from "vitest";
import { createFakeEero, type FakeEero } from "../../../test/fake-eero/server";
import type { AuthState, Backend, SecretStore } from "../backend";
import { createDemoBackend } from "../demo";
import { createEeroBackend } from "../eero/backend";
import { READ_SHARE_MS, type RequestLogEntry } from "../eero/client";
import { connectionMode, hhmm, mapPowerSavingSchedule, mapSettings, mapThread, mapThreadCredentials, mloMode, prefixMask, simpleSetup } from "../eero/map/settings";
import { RateLimiter } from "../eero/ratelimit";
import { createEngine, type Engine } from "../engine";
import type * as M from "../model";
import { allCommands } from "../registry";
import { RESTART_ESTIMATE } from "./network";
import { dhcpProblem, IMPACT, isIpv4, isIpv6, SETTINGS_RESTART_ESTIMATE, UPDATE_RESTART_ESTIMATE, wanStaticProblem } from "./settings";
import { type CliHost, nodeHost, runCli } from "../../cli/index";
import { memoryAudit } from "../audit";
import { SECURITY_RESTART_ESTIMATE } from "./wifi";

const NOW = Date.parse("2026-11-12T22:41:00Z");
const MAPLE = "4821907";
const LAKE = "5130264";
const MOM = "6092118";

type Result<R> = { ok: true; result: R } | { ok: false; error: { code: string; message: string } };
async function ok<R>(p: Promise<Result<R>>): Promise<R> {
  const r = await p;
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.result;
}
const code = async (p: Promise<{ ok: boolean; error?: { code: string } }>) => (await p).error?.code;

const demoEngine = (scenario?: "signed_out") => createEngine({ backend: createDemoBackend({ clock: () => NOW, scenario }), clock: () => NOW });

/** Every string a Thread secret could hide in. */
const SECRET_WORDS = /network.?key|pskc|master.?key|commissioning|dataset/i;

describe("settings.get (demo)", () => {
  it("returns every group for a routed network, with power saving schedules and Thread", async () => {
    const s = await ok(demoEngine().execute<M.NetworkSettings>("settings.get", { networkId: MAPLE }));
    expect(s.dns).toMatchObject({ mode: "automatic", caching: true });
    expect(s.dns.ispServers.length).toBeGreaterThan(0);
    expect(s.dhcp).toMatchObject({ mode: "automatic", subnetMask: "255.255.252.0" });
    expect(s.dhcp.gateway).toBeTruthy();
    expect(s).toMatchObject({ connectionMode: "nat", upnp: true, sqm: false, bandSteering: true, fastTransition: true, mlo: "multi", legacyMode: false, simpleSetup: true, ipv6: { enabled: true } });
    expect(s.powerSaving.schedules.map((p) => p.name)).toEqual(["Overnight", "Weekday daytime"]);
    expect(s.thread).toMatchObject({ enabled: true, name: "MapleThread", channel: 15, devices: 6 });
  });

  it("never includes Thread secrets", async () => {
    const engine = demoEngine();
    const s = await ok(engine.execute<M.NetworkSettings>("settings.get", { networkId: MAPLE }));
    const json = JSON.stringify(s);
    expect(json).not.toContain("00112233445566778899aabbccddeeff");
    expect(json).not.toContain("445f2b5ca6f2a93a55ce570a70efeecb");
    expect(json).not.toMatch(SECRET_WORDS);
    expect(Object.keys(s.thread ?? {}).sort()).toEqual(["borderAgent", "channel", "credentialSync", "devices", "enabled", "name", "panId", "xpanId"]);
  });

  it("drops secrets even when a backend leaks them into the settings", async () => {
    const backend = createDemoBackend({ clock: () => NOW });
    const leaky: Backend = {
      ...backend,
      settings: {
        ...backend.settings,
        get: async (net) => {
          const s = await backend.settings.get(net);
          return { ...s, thread: s.thread && ({ ...s.thread, networkKey: "leaked-key", pskc: "leaked-pskc" } as M.NetworkSettings["thread"]) };
        },
      },
    };
    const s = await ok(createEngine({ backend: leaky, clock: () => NOW }).execute<M.NetworkSettings>("settings.get", { networkId: MAPLE }));
    expect(JSON.stringify(s)).not.toContain("leaked");
  });

  it("reports bridge mode with nulls for what eero does not route", async () => {
    const s = await ok(demoEngine().execute<M.NetworkSettings>("settings.get", { networkId: MOM }));
    expect(s).toMatchObject({ connectionMode: "bridged", upnp: null, sqm: null, natRandomization: null, mlo: null, thread: null });
    expect(s.dhcp).toEqual({ mode: "bridged", subnetIp: null, subnetMask: null, gateway: null, startIp: null, endIp: null });
    expect(s.powerSaving.schedules).toEqual([]);
  });

  it("answers for an admin network too", async () => {
    const s = await ok(demoEngine().execute<M.NetworkSettings>("settings.get", { networkId: LAKE }));
    expect(s.dns.mode).toMatch(/automatic|custom/);
  });

  it("rejects bad params and needs a session", async () => {
    const engine = demoEngine();
    expect(await code(engine.execute("settings.get", { dns: "custom" }))).toBe("bad_params");
    expect(await code(engine.execute("settings.get", { networkId: "Nowhere" }))).toBe("bad_params");
    expect(await code(demoEngine("signed_out").execute("settings.get"))).toBe("not_signed_in");
  });

  it("is a cached query, not sensitive", () => {
    const info = demoEngine().commands().find((c) => c.id === "settings.get");
    expect(info).toMatchObject({ effect: "query", scope: "network", sensitive: false });
  });
});

// ---------------------------------------------------------------------------
// Real eero backend against the fake eero server

const signedIn: AuthState = { signedIn: true, pending: false, login: null, storage: "memory" };
const secrets = (token: string): SecretStore => ({ load: async () => token, save: async () => "memory", clear: async () => {}, storage: async () => "memory" });

function fakeEngine(prepare?: (fake: FakeEero) => void, onLog?: (e: RequestLogEntry) => void) {
  const fake = createFakeEero({ now: () => NOW });
  prepare?.(fake);
  const eero = createEeroBackend({ secrets: secrets(fake.signIn()), origin: fake.origin, fetch: fake.fetch, onLog });
  const backend: Backend = { ...eero, auth: { ...eero.auth, status: async () => signedIn } };
  return { fake, backend, engine: createEngine({ backend, clock: () => NOW }) };
}

describe("settings.get (fake eero server)", () => {
  let fake: FakeEero | null = null;
  afterEach(async () => {
    await fake?.close();
    fake = null;
  });

  it("maps the captured shapes: network fields, fast roaming, schedules, Thread and legacy mode", async () => {
    const entries: RequestLogEntry[] = [];
    const s = fakeEngine(undefined, (e) => entries.push(e));
    fake = s.fake;
    const maple = await ok(s.engine.execute<M.NetworkSettings>("settings.get", { networkId: "100001" }));
    expect(maple).toEqual({
      dns: { mode: "automatic", servers: [], ipv6Servers: [], caching: true, ispServers: ["203.0.113.53"] },
      dhcp: { mode: "automatic", subnetIp: "192.168.4.0", subnetMask: "255.255.252.0", gateway: "192.168.4.1", startIp: "192.168.4.100", endIp: "192.168.7.254" },
      ipv6: { enabled: false },
      wan: { mode: "dhcp", static: null, pppoeUsername: null, vlan: null },
      connectionMode: "nat",
      natRandomization: false,
      upnp: true,
      sqm: false,
      bandSteering: true,
      fastTransition: true,
      mlo: "multi",
      legacyMode: false,
      simpleSetup: true,
      powerSaving: { enabled: true, scheduleEnabled: true, schedules: [{ id: "1", name: "Overnight", days: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"], start: "01:00", end: "06:00", enabled: true }] },
      thread: { enabled: true, credentialSync: true, name: "FakeThread", channel: 15, panId: "0xfa4e", xpanId: "fa4efa4efa4efa4e", borderAgent: "192.168.4.1:49191", devices: null },
      timezone: "America/New_York",
    });
    const json = JSON.stringify(maple);
    expect(json).not.toContain("fake-thread-master-key");
    expect(json).not.toContain("fake-thread-pskc");
    expect(json).not.toContain("fake-main-pass");
    // The secrets come over the wire, but never into the request log.
    expect(JSON.stringify(entries)).not.toContain("fake-thread-master-key");
    const paths = s.fake.log.map((l) => l.path);
    for (const p of ["fast_transition", "power_saving/schedules", "thread", "ac_compat"]) expect(paths).toContain(`/2.2/networks/100001/${p}`);
    expect(paths).not.toContain("/2.2/networks/100001/power_saving");
    expect(s.fake.log.every((l) => l.method === "GET")).toBe(true);
  });

  it("treats Thread's 404 on the admin network (Lake Cabin) as no Thread, not an error", async () => {
    const s = fakeEngine();
    fake = s.fake;
    const lake = await ok(s.engine.execute<M.NetworkSettings>("settings.get", { networkId: "100002" }));
    expect(lake).toMatchObject({ thread: null, mlo: null, fastTransition: false, powerSaving: { enabled: false, scheduleEnabled: false, schedules: [] } });
    expect(await s.backend.settings.threadCredentials("100002")).toBeNull();
  });

  it("reads other missing extras (403, 404) as unknown instead of failing", async () => {
    const s = fakeEngine();
    fake = s.fake;
    // Older firmware or another role: these reads answer 403 or 404, simulated with a wrapped fetch.
    const wrapped = createEeroBackend({
      secrets: secrets(s.fake.signIn()),
      origin: s.fake.origin,
      fetch: async (input, init) => {
        const url = String(input instanceof Request ? input.url : input);
        if (/\/(ac_compat|fast_transition)$/.test(url)) return new Response(JSON.stringify({ meta: { code: 403, error: "error.forbidden" } }), { status: 403 });
        if (url.endsWith("/power_saving/schedules")) return new Response(JSON.stringify({ meta: { code: 404, error: "error.not_found" } }), { status: 404 });
        return s.fake.fetch(input, init);
      },
    });
    const settings = await wrapped.settings.get("100001");
    expect(settings).toMatchObject({ legacyMode: null, fastTransition: null, powerSaving: { schedules: [] } });
  });

  it("returns the Thread secrets only from the separate backend read", async () => {
    const s = fakeEngine();
    fake = s.fake;
    expect(await s.backend.settings.threadCredentials("100001")).toEqual({ networkKey: "fake-thread-master-key-0000000001", pskc: "fake-thread-pskc-0000000000000001", dataset: null });
  });

  it("maps bridge mode and custom DNS", async () => {
    const s = fakeEngine((f) => {
      const n = f.state.networks.get("100001")?.network;
      if (!n) return;
      n.connection = { mode: "bridged" };
      n.dns = { mode: "custom", caching: false, parent: { ips: ["203.0.113.53"] }, custom: { ips: ["192.0.2.10", "192.0.2.11"] } };
      n.ipv6 = { name_servers: { mode: "custom", custom: ["2001:db8::53"] } };
    });
    fake = s.fake;
    const st = await ok(s.engine.execute<M.NetworkSettings>("settings.get"));
    expect(st.connectionMode).toBe("bridged");
    expect(st.dhcp.mode).toBe("bridged");
    expect(st.dns).toEqual({ mode: "custom", servers: ["192.0.2.10", "192.0.2.11"], ipv6Servers: ["2001:db8::53"], caching: false, ispServers: ["203.0.113.53"] });
  });
});

describe("settings mapping", () => {
  it("reads modes and words eero sends in several spellings", () => {
    expect(["nat", "bridged", "BRIDGE", "ip_passthrough", "ipPassthrough", "x", null].map(connectionMode)).toEqual(["nat", "bridged", "bridged", "ipPassthrough", "ipPassthrough", null, null]);
    expect(["multi", "MLO_DISABLED", "single_link", "auto", undefined].map(mloMode)).toEqual(["multi", "disabled", "single", null, null]);
    expect(["enabled", "DISABLED", "auto", true, "mystery", null].map(simpleSetup)).toEqual([true, false, true, true, null, null]);
    expect(["1:00", "01:00:00", "23:59", "24:00", "25:00", "noon", 5].map(hhmm)).toEqual(["01:00", "01:00", "23:59", "00:00", null, null, null]);
    expect(prefixMask(22)).toBe("255.255.252.0");
    expect(prefixMask(24)).toBe("255.255.255.0");
  });

  it("maps schedules with ids from the url, sorted unique days, and drops ones without times", () => {
    expect(mapPowerSavingSchedule({ url: "/2.2/networks/1/power_saving/schedules/77", days: ["sunday", "MON", "Mon"], start_time: "22:00", end_time: "06:30" }, 0)).toEqual({
      id: "77",
      name: "Power saving",
      days: ["MON", "SUN"],
      start: "22:00",
      end: "06:30",
      enabled: true,
    });
    expect(mapPowerSavingSchedule({ name: "Broken", start_time: "x" }, 3)).toBeNull();
  });

  it("keeps Thread secrets out of the settings and in the credentials only", () => {
    const raw = { enabled: true, name: "T", master_key: "k", commissioning_credential: "p", border_agent: { ip: "192.0.2.1" } };
    const thread = mapThread(raw, true);
    expect(thread).toMatchObject({ enabled: true, borderAgent: "192.0.2.1", devices: null });
    expect(JSON.stringify(thread)).not.toMatch(/"k"|"p"/);
    expect(mapThread(null, true)).toBeNull();
    expect(mapThreadCredentials(raw)).toEqual({ networkKey: "k", pskc: "p", dataset: null });
    expect(mapThreadCredentials({ enabled: true })).toBeNull();
  });

  it("maps static WAN, PPPoE and VLAN, and never the Wi-Fi password", () => {
    const none = { fastTransition: null, schedules: [], thread: null, acCompat: null };
    const fixed = mapSettings({ lease: { mode: "static", static: { ip: "198.51.100.2", mask: "255.255.255.0", router: "198.51.100.1" } }, vlan: 201, password: "secret-wifi" }, none);
    expect(fixed.wan).toEqual({ mode: "static", static: { ip: "198.51.100.2", mask: "255.255.255.0", router: "198.51.100.1" }, pppoeUsername: null, vlan: 201 });
    expect(JSON.stringify(fixed)).not.toContain("secret-wifi");
    expect(mapSettings({ pppoe_enabled: true, pppoe_username: "user@isp", vlan: 9999 }, none).wan).toEqual({ mode: "pppoe", static: null, pppoeUsername: "user@isp", vlan: null });
    // Nothing at all: every field null or empty, never a throw.
    const empty = mapSettings({}, none);
    expect(empty).toMatchObject({ connectionMode: null, upnp: null, mlo: null, thread: null, timezone: null, dns: { mode: "automatic", servers: [], caching: null } });
  });
});

// ---------------------------------------------------------------------------
// Page-load budget: the Advanced networking page's queries, run at once as React mounts them

const ADVANCED_PAGE: [string, unknown?][] = [
  ["auth.status"],
  ["account.get"],
  ["network.list"],
  ["network.get"],
  ["internet.get"],
  ["settings.get"],
  ["integrations.get"],
];

async function load(engine: Engine, page: [string, unknown?][]) {
  const results = await Promise.all(page.map(([id, params]) => engine.execute(id, params)));
  const failed = results.flatMap((r, i) => (r.ok ? [] : [`${page[i]?.[0]}: ${r.error.code} ${r.error.message}`]));
  expect(failed).toEqual([]);
}

describe("Advanced networking page load against the fake eero server", () => {
  it("stays well inside the request budget and reads the network once", async () => {
    const f = createFakeEero();
    const backend = createEeroBackend({ secrets: secrets(f.signIn()), origin: f.origin, fetch: f.fetch, readShareMs: READ_SHARE_MS, limiter: new RateLimiter() });
    const engine = createEngine({ backend });
    const started = Date.now();
    await load(engine, ADVANCED_PAGE);
    expect(Date.now() - started).toBeLessThan(2_000);
    const reads = (path: string) => f.log.filter((e) => e.method === "GET" && e.path === path).length;
    // settings.get, integrations.get, network.get and internet.get share one GET {net}.
    expect(reads("/2.2/networks/100001")).toBe(1);
    for (const p of ["fast_transition", "power_saving/schedules", "thread", "ac_compat"]) expect(reads(`/2.2/networks/100001/${p}`)).toBe(1);
    expect(reads("/2.2/networks/100001/proxied_nodes")).toBe(0);
    expect(f.log.length).toBeLessThanOrEqual(14);
    await f.close();
  });
});

// ---------------------------------------------------------------------------
// settings.impact

describe("settings.impact (demo)", () => {
  const impact = (ids: string[], net = MAPLE, engine = demoEngine()) => ok(engine.execute<M.SettingsImpact>("settings.impact", { networkId: net, changes: ids.map((id) => ({ id })) }));

  it("has a row for every disruptive and destructive write that exists or M5 adds", () => {
    const registered = allCommands().filter((c) => c.effect === "disruptive").map((c) => c.id);
    const planned = ["settings.dns.set", "settings.dhcp.set", "settings.ipv6.set", "settings.wan.set", "settings.connection_mode.set", "settings.nat_randomization.set", "settings.mlo.set", "settings.legacy_mode.set", "updates.install", "eero.port.action"];
    // eero.restart and guest writes have their own impact copy (gateway-aware, guests only).
    const own = new Set(["eero.restart", "guest.disable", "guest.rename", "guest.password.set", "wifi.hide5g.set"]);
    for (const id of [...registered, ...planned].filter((id) => !own.has(id))) expect(IMPACT[id], id).toBeDefined();
  });

  it("each mesh-restarting setting restarts every eero, with its estimate and every online device", async () => {
    const engine = demoEngine();
    const online = (await ok(engine.execute<M.DeviceList>("device.list", { networkId: MAPLE, status: "online" }))).devices.filter((d) => !d.blocked);
    const eight = ["settings.dns.set", "settings.dhcp.set", "settings.ipv6.set", "settings.wan.set", "settings.connection_mode.set", "settings.nat_randomization.set"];
    const three = ["settings.mlo.set", "settings.legacy_mode.set", "wifi.security.set", "network.restart"];
    for (const id of [...eight, ...three, "updates.install"]) {
      const i = await impact([id], MAPLE, engine);
      const estimate = eight.includes(id) ? SETTINGS_RESTART_ESTIMATE : three.includes(id) ? RESTART_ESTIMATE.network : UPDATE_RESTART_ESTIMATE;
      expect(i, id).toMatchObject({ restarts: true, estimate, devicesOnline: online.length });
      expect(i.changes[0], id).toMatchObject({ id, restarts: true, estimate, drops: "all" });
      expect(i.deviceIds.sort(), id).toEqual(online.map((d) => d.id).sort());
      expect(i.summary, id).toContain(estimate);
      expect(i.summary, id).toContain(`${online.length} devices online lose internet`);
    }
  });

  it("toggles that apply live restart nothing and drop nobody", async () => {
    for (const id of ["settings.upnp.set", "settings.sqm.set", "settings.band_steering.set", "settings.fast_transition.set", "settings.power_saving.set", "settings.timezone.set", "settings.simple_setup.set"]) {
      const i = await impact([id]);
      expect(i, id).toMatchObject({ restarts: false, estimate: null, deviceIds: [] });
    }
  });

  it("Wi-Fi name and password drop main-network wireless devices only; Thread and port changes name no devices", async () => {
    const engine = demoEngine();
    const online = (await ok(engine.execute<M.DeviceList>("device.list", { networkId: MAPLE, status: "online" }))).devices;
    const wireless = online.filter((d) => !d.blocked && d.band !== "wired" && d.band !== null && d.ssid !== "guest");
    const name = await impact(["wifi.name.set"], MAPLE, engine);
    expect(name).toMatchObject({ restarts: false, changes: [{ drops: "wireless" }] });
    expect(name.deviceIds.sort()).toEqual(wireless.map((d) => d.id).sort());
    for (const id of ["settings.thread.reset", "settings.thread.set", "eero.port.action"]) {
      const i = await impact([id], MAPLE, engine);
      expect(i.restarts, id).toBe(false);
      expect(i.deviceIds, id).toEqual([]);
    }
  });

  it("several changes: the longest estimate wins and devices count once", async () => {
    const i = await impact(["settings.mlo.set", "settings.dns.set", "settings.upnp.set"]);
    expect(i.estimate).toBe(SETTINGS_RESTART_ESTIMATE);
    expect(i.changes.map((c) => c.id)).toEqual(["settings.mlo.set", "settings.dns.set", "settings.upnp.set"]);
    expect(new Set(i.deviceIds).size).toBe(i.deviceIds.length);
  });

  it("bad_params for an unknown id, an empty list or an extra key", async () => {
    const engine = demoEngine();
    expect(await code(engine.execute("settings.impact", { networkId: MAPLE, changes: [{ id: "settings.nope.set" }] }))).toBe("bad_params");
    expect(await code(engine.execute("settings.impact", { networkId: MAPLE, changes: [] }))).toBe("bad_params");
    expect(await code(engine.execute("settings.impact", { networkId: MAPLE, changes: [{ id: "settings.dns.set", extra: 1 }] }))).toBe("bad_params");
  });

  it("the Wi-Fi security estimate comes from the same table", () => {
    expect(SECURITY_RESTART_ESTIMATE).toBe(IMPACT["wifi.security.set"]?.estimate);
  });
});

describe("poll topics", () => {
  it("wifi.get and wifi.impact read their own topic, and integrations.get its own, apart from settings", () => {
    const topic = (id: string) => allCommands().find((c) => c.id === id)?.topic;
    expect([topic("wifi.get"), topic("wifi.impact"), topic("integrations.get"), topic("settings.get")]).toEqual(["wifi", "wifi", "integrations", "settings"]);
  });
});

describe("M5.1 mapping and fake server fixtures", () => {
  it("maps eero Simple Setup's captured LTS value to on, and keeps unknown words null", () => {
    expect(simpleSetup("LTS")).toBe(true);
    expect(simpleSetup("DISABLED")).toBe(false);
    expect(simpleSetup("SOMETHING_NEW")).toBeNull();
  });

  it("--fake Wi-Fi has widths and channels from radio_channel_stats", async () => {
    const f = createFakeEero();
    const engine = createEngine({ backend: createEeroBackend({ secrets: secrets(f.signIn()), origin: f.origin, fetch: f.fetch, limiter: new RateLimiter() }) });
    const wifi = await ok(engine.execute<M.WifiSettings>("wifi.get", { networkId: "100001" }));
    for (const band of wifi.bands) {
      expect(band.widthsMhz.length, band.band).toBeGreaterThan(0);
      expect(band.channels.length, band.band).toBeGreaterThan(0);
    }
    expect(wifi.bands.find((b) => b.band === "5")?.widthsMhz).toEqual([80]);
    await f.close();
  });

  it("--fake Updates has release notes from a manifest the fake serves without the session", async () => {
    const f = createFakeEero();
    const engine = createEngine({ backend: createEeroBackend({ secrets: secrets(f.signIn()), origin: f.origin, fetch: f.fetch, limiter: new RateLimiter() }) });
    const notes = await ok(engine.execute<M.ReleaseNotes | null>("updates.notes", { networkId: "100001" }));
    expect(notes).toMatchObject({ version: "7.11.0", title: "eeroOS 7.11.0" });
    expect(notes?.features.length).toBeGreaterThan(0);
    const manifest = f.log.find((e) => e.path === "/2.2/fake/release_manifest");
    expect(manifest?.token).toBeNull();
    await f.close();
  });
});

// ---------------------------------------------------------------------------
// Internet-side writes (M5.2)

const settingsOf = (engine: Engine, net = MAPLE) => ok(engine.execute<M.NetworkSettings>("settings.get", { networkId: net }));
const PPPOE_PASSWORD = "fake-pppoe-secret-77";

/** A valid call per write, each a change from the demo's Maple Street. */
const WRITES: Record<string, Record<string, unknown>> = {
  "settings.dns.set": { mode: "custom", servers: ["1.1.1.1", "9.9.9.9"], ipv6Servers: ["2606:4700:4700::1111"] },
  "settings.dhcp.set": { mode: "custom", subnetIp: "10.20.0.0", subnetMask: "255.255.255.0", startIp: "10.20.0.100", endIp: "10.20.0.200" },
  "settings.ipv6.set": { enabled: false },
  "settings.wan.set": { mode: "static", static: { ip: "203.0.113.10", mask: "255.255.255.0", router: "203.0.113.1" }, vlan: 201 },
  "settings.connection_mode.set": { mode: "bridged" },
  "settings.nat_randomization.set": { randomized: true },
  "settings.upnp.set": { enabled: false },
  "settings.sqm.set": { enabled: true },
};
const conf = (id: string) => (DISRUPTIVE.includes(id) ? { confirm: true } : {});
const DISRUPTIVE: string[] = ["settings.dns.set", "settings.dhcp.set", "settings.ipv6.set", "settings.wan.set", "settings.connection_mode.set", "settings.nat_randomization.set"];

describe("internet-side settings writes (demo)", () => {
  it("each write shows in the next settings.get", async () => {
    const engine = demoEngine();
    await settingsOf(engine); // cached, so the reads below prove each write invalidates settings
    const read = async (id: string) => {
      await ok(engine.execute(id, { networkId: MAPLE, ...WRITES[id], ...conf(id) }));
      return settingsOf(engine);
    };
    expect((await read("settings.dns.set")).dns).toMatchObject({ mode: "custom", servers: ["1.1.1.1", "9.9.9.9"], ipv6Servers: ["2606:4700:4700::1111"], caching: true });
    expect((await read("settings.dhcp.set")).dhcp).toEqual({ mode: "custom", subnetIp: "10.20.0.0", subnetMask: "255.255.255.0", gateway: "10.20.0.1", startIp: "10.20.0.100", endIp: "10.20.0.200" });
    expect((await read("settings.ipv6.set")).ipv6.enabled).toBe(false);
    expect((await read("settings.wan.set")).wan).toEqual({ mode: "static", static: { ip: "203.0.113.10", mask: "255.255.255.0", router: "203.0.113.1" }, pppoeUsername: null, vlan: 201 });
    expect((await read("settings.nat_randomization.set")).natRandomization).toBe(true);
    expect((await read("settings.upnp.set")).upnp).toBe(false);
    expect((await read("settings.sqm.set")).sqm).toBe(true);
    const bridged = await read("settings.connection_mode.set");
    expect(bridged.connectionMode).toBe("bridged");
    expect(bridged.dhcp.mode).toBe("bridged");
  });

  it("DNS keeps what is not given: caching alone, and automatic drops the custom servers", async () => {
    const engine = demoEngine();
    await ok(engine.execute("settings.dns.set", { networkId: MAPLE, ...WRITES["settings.dns.set"], confirm: true }));
    await ok(engine.execute("settings.dns.set", { networkId: MAPLE, caching: false, confirm: true }));
    expect((await settingsOf(engine)).dns).toMatchObject({ mode: "custom", servers: ["1.1.1.1", "9.9.9.9"], caching: false });
    await ok(engine.execute("settings.dns.set", { networkId: MAPLE, mode: "automatic", confirm: true }));
    expect((await settingsOf(engine)).dns).toMatchObject({ mode: "automatic", servers: [], ipv6Servers: [], caching: false });
    expect(await code(engine.execute("settings.dns.set", { networkId: MAPLE, mode: "custom", servers: [], confirm: true }))).toBe("bad_params");
  });

  it("WAN: PPPoE keeps the user name only, VLAN null turns the tag off, and the password is never returned", async () => {
    const engine = demoEngine();
    const r = await ok(engine.execute<M.NetworkSettings>("settings.wan.set", { networkId: MAPLE, mode: "pppoe", pppoe: { username: "maple@example.net", password: PPPOE_PASSWORD }, vlan: 35, confirm: true }));
    expect(r.wan).toEqual({ mode: "pppoe", static: null, pppoeUsername: "maple@example.net", vlan: 35 });
    expect(JSON.stringify(r)).not.toContain(PPPOE_PASSWORD);
    await ok(engine.execute("settings.wan.set", { networkId: MAPLE, mode: "dhcp", vlan: null, confirm: true }));
    expect((await settingsOf(engine)).wan).toEqual({ mode: "dhcp", static: null, pppoeUsername: null, vlan: null });
  });

  it("disruptive writes need confirm, with the settings.impact summary as the message; UPnP and SQM do not", async () => {
    const engine = demoEngine();
    for (const id of DISRUPTIVE) {
      const r = await engine.execute(id, { networkId: MAPLE, ...WRITES[id] });
      expect(r.ok, id).toBe(false);
      if (r.ok) continue;
      expect(r.error.code, id).toBe("needs_confirm");
      const impact = await ok(engine.execute<M.SettingsImpact>("settings.impact", { networkId: MAPLE, changes: [{ id }] }));
      expect(r.error.message, id).toContain(impact.summary);
      expect(r.error.message, id).toContain(SETTINGS_RESTART_ESTIMATE);
    }
    const bridge = await engine.execute("settings.connection_mode.set", { networkId: MAPLE, mode: "bridged" });
    expect(!bridge.ok && bridge.error.message).toMatch(/profiles, pausing, reservations, port forwards/);
    // Nothing ran: the settings are as they were.
    expect(await settingsOf(engine)).toMatchObject({ connectionMode: "nat", ipv6: { enabled: true }, dns: { mode: "automatic" } });
    expect((await ok(engine.execute<M.NetworkSettings>("settings.upnp.set", { networkId: MAPLE, enabled: false }))).upnp).toBe(false);
    expect((await ok(engine.execute<M.NetworkSettings>("settings.sqm.set", { networkId: MAPLE, enabled: true }))).sqm).toBe(true);
  });

  it("a change that changes nothing says so and restarts nothing", async () => {
    const engine = demoEngine();
    const r = await engine.execute("settings.ipv6.set", { networkId: MAPLE, enabled: true });
    expect(!r.ok && r.error).toMatchObject({ code: "needs_confirm", message: "Nothing changes, so nothing restarts." });
    await ok(engine.execute("settings.ipv6.set", { networkId: MAPLE, enabled: true, confirm: true }));
    await ok(engine.execute("settings.connection_mode.set", { networkId: MAPLE, mode: "nat", confirm: true }));
    expect((await ok(engine.execute<M.Network>("network.get", { networkId: MAPLE }))).status).not.toBe("updating");
  });

  it("validates IP addresses, masks and ranges with a message per field", async () => {
    const engine = demoEngine();
    const issue = async (id: string, params: Record<string, unknown>) => {
      const r = await engine.execute(id, { networkId: MAPLE, ...params, confirm: true });
      expect(r.ok, `${id} ${JSON.stringify(params)}`).toBe(false);
      if (r.ok) return null;
      expect(r.error.code, `${id} ${JSON.stringify(params)}`).toBe("bad_params");
      const issues = (r.error.detail?.issues ?? []) as { path: string; message: string }[];
      return issues[0] ?? { path: "", message: r.error.message };
    };
    const dhcp = WRITES["settings.dhcp.set"]!;
    expect(await issue("settings.dns.set", { mode: "custom", servers: ["1.1.1"] })).toMatchObject({ path: "servers.0" });
    expect(await issue("settings.dns.set", { mode: "custom", servers: ["256.1.1.1"] })).toMatchObject({ path: "servers.0" });
    expect(await issue("settings.dns.set", { mode: "custom", servers: ["1.1.1.1"], ipv6Servers: ["1.1.1.1"] })).toMatchObject({ path: "ipv6Servers.0" });
    expect(await issue("settings.dns.set", { mode: "custom", servers: ["1.1.1.1", "1.0.0.1", "8.8.8.8", "8.8.4.4", "9.9.9.9"] })).toMatchObject({ path: "servers" });
    expect(await issue("settings.dhcp.set", { mode: "custom" })).toMatchObject({ path: "subnetIp", message: "Required for a custom range." });
    expect(await issue("settings.dhcp.set", { ...dhcp, subnetIp: "8.8.8.0" })).toMatchObject({ path: "subnetIp", message: expect.stringMatching(/private range/) });
    expect(await issue("settings.dhcp.set", { ...dhcp, subnetIp: "10.20.0.5" })).toMatchObject({ path: "subnetIp", message: expect.stringMatching(/try 10\.20\.0\.0/) });
    expect(await issue("settings.dhcp.set", { ...dhcp, subnetMask: "255.255.0.255" })).toMatchObject({ path: "subnetMask" });
    expect(await issue("settings.dhcp.set", { ...dhcp, subnetMask: "255.0.0.0" })).toMatchObject({ path: "subnetMask" });
    expect(await issue("settings.dhcp.set", { ...dhcp, startIp: "10.20.0.1" })).toMatchObject({ path: "startIp", message: expect.stringMatching(/10\.20\.0\.1 is the eero/) });
    expect(await issue("settings.dhcp.set", { ...dhcp, endIp: "10.20.1.10" })).toMatchObject({ path: "endIp" });
    expect(await issue("settings.dhcp.set", { ...dhcp, startIp: "10.20.0.200", endIp: "10.20.0.100" })).toMatchObject({ path: "endIp" });
    expect(await issue("settings.dhcp.set", { mode: "automatic", subnetIp: "10.20.0.0" })).toMatchObject({ path: "subnetIp" });
    const wan = WRITES["settings.wan.set"]!;
    expect(await issue("settings.wan.set", { mode: "static" })).toMatchObject({ path: "static" });
    expect(await issue("settings.wan.set", { ...wan, static: { ip: "203.0.113.10", mask: "255.255.255.0", router: "198.51.100.1" } })).toMatchObject({ path: "static.router", message: expect.stringMatching(/same subnet/) });
    expect(await issue("settings.wan.set", { ...wan, static: { ip: "203.0.113.255", mask: "255.255.255.0", router: "203.0.113.1" } })).toMatchObject({ path: "static.ip" });
    expect(await issue("settings.wan.set", { ...wan, static: { ip: "203.0.113.1", mask: "255.255.255.0", router: "203.0.113.1" } })).toMatchObject({ path: "static.router" });
    expect(await issue("settings.wan.set", { mode: "pppoe" })).toMatchObject({ path: "pppoe" });
    expect(await issue("settings.wan.set", { mode: "pppoe", pppoe: { username: "", password: "x" } })).toMatchObject({ path: "pppoe.username" });
    expect(await issue("settings.wan.set", { mode: "dhcp", pppoe: { username: "a", password: "b" } })).toMatchObject({ path: "pppoe" });
    expect(await issue("settings.wan.set", { mode: "dhcp", vlan: 4095 })).toMatchObject({ path: "vlan" });
    expect(await issue("settings.connection_mode.set", { mode: "router" })).toMatchObject({ path: "mode" });
    for (const id of Object.keys(WRITES)) {
      expect(await code(engine.execute(id, { networkId: MAPLE, ...WRITES[id], extra: 1, ...conf(id) })), id).toBe("bad_params");
      expect(await code(demoEngine("signed_out").execute(id, { networkId: MAPLE, ...WRITES[id], ...conf(id) })), id).toBe("not_signed_in");
    }
    expect(await settingsOf(engine)).toMatchObject({ dns: { mode: "automatic" }, dhcp: { mode: "automatic" }, wan: { mode: "dhcp" } });
  });

  it("the address rules accept what eero accepts", () => {
    expect(["192.168.4.1", "0.0.0.0", "10.0.0.255"].every(isIpv4)).toBe(true);
    expect(["192.168.4", "192.168.04.1", "1.2.3.4.5", " 1.2.3.4"].some(isIpv4)).toBe(false);
    expect(["::1", "2001:db8::1", "2606:4700:4700::1111", "fe80:0:0:0:0:0:0:1", "::ffff:192.0.2.1"].every(isIpv6)).toBe(true);
    expect(["1.1.1.1", "2001:db8:::1", "2001:db8::1::2", "1:2:3:4:5:6:7:8:9", "gggg::1", "2001:db8::/64"].some(isIpv6)).toBe(false);
    expect(dhcpProblem({ subnetIp: "192.168.4.0", subnetMask: "255.255.252.0", startIp: "192.168.4.100", endIp: "192.168.7.254" })).toBeNull();
    expect(dhcpProblem({ subnetIp: "172.16.0.0", subnetMask: "255.255.0.0", startIp: "172.16.0.2", endIp: "172.16.255.254" })).toBeNull();
    expect(dhcpProblem({ subnetIp: "172.32.0.0", subnetMask: "255.255.0.0", startIp: "172.32.0.2", endIp: "172.32.0.9" })?.field).toBe("subnetIp");
    expect(dhcpProblem({ subnetIp: "192.168.4.0", subnetMask: "255.255.255.0", startIp: "192.168.4.100", endIp: "192.168.4.255" })?.field).toBe("endIp");
    expect(wanStaticProblem({ ip: "203.0.113.10", mask: "255.255.255.252", router: "203.0.113.9" })).toBeNull();
  });

  it("bridge mode turns NAT-only settings off: gates, bad_params, and nat brings them back", async () => {
    const engine = demoEngine();
    const gate = (id: string) => engine.commands().find((c) => c.id === id)?.gate;
    for (const id of ["settings.dns.set", "settings.dhcp.set", "settings.ipv6.set", "settings.wan.set", "settings.nat_randomization.set", "settings.upnp.set", "settings.sqm.set"]) {
      expect(gate(id), id).toEqual({ area: "settings", op: "update", bridgeOff: true, capability: null });
      const r = await engine.execute(id, { networkId: MOM, ...WRITES[id], ...conf(id) });
      expect(!r.ok && r.error, id).toMatchObject({ code: "bad_params", message: expect.stringMatching(/off in bridge mode/) });
    }
    expect(gate("settings.connection_mode.set")).toEqual({ area: "settings", op: "update", bridgeOff: false, capability: null });
    const routed = await ok(engine.execute<M.NetworkSettings>("settings.connection_mode.set", { networkId: MOM, mode: "nat", confirm: true }));
    expect(routed.connectionMode).toBe("nat");
    expect(routed.dhcp.mode).not.toBe("bridged");
    expect((await ok(engine.execute<M.NetworkSettings>("settings.ipv6.set", { networkId: MOM, enabled: !routed.ipv6.enabled, confirm: true }))).ipv6.enabled).toBe(!routed.ipv6.enabled);
  });

  it("declares effects, gates and the topics each write invalidates", () => {
    const info = (id: string) => allCommands().find((c) => c.id === id);
    for (const id of DISRUPTIVE) expect(info(id)?.effect, id).toBe("disruptive");
    expect(info("settings.upnp.set")?.effect).toBe("write");
    expect(info("settings.sqm.set")?.effect).toBe("write");
    expect(Object.fromEntries(Object.keys(WRITES).map((id) => [id, info(id)?.invalidates]))).toEqual({
      "settings.dns.set": ["settings", "network"],
      "settings.dhcp.set": ["settings", "network", "routing", "devices"],
      "settings.ipv6.set": ["settings", "network"],
      "settings.wan.set": ["settings", "network"],
      "settings.connection_mode.set": ["settings", "network", "routing", "devices", "profiles", "integrations"],
      "settings.nat_randomization.set": ["settings", "network"],
      "settings.upnp.set": ["settings"],
      "settings.sqm.set": ["settings"],
    });
  });

  it("the PPPoE password stays out of the CLI and the audit log", async () => {
    const audit = memoryAudit();
    let out = "";
    const io = { stdout: (s: string) => void (out += s), stderr: (s: string) => void (out += s) };
    const host: CliHost = { ...nodeHost(), createEngine: ({ surface }) => createEngine({ backend: createDemoBackend({ clock: () => NOW }), surface, audit, clock: () => NOW }) };
    const params = JSON.stringify({ mode: "pppoe", pppoe: { username: "maple@example.net", password: PPPOE_PASSWORD } });
    expect(await runCli(["run", "settings.wan.set", "--params", params], io, host)).not.toBe(0);
    expect(await runCli(["--format", "json", "run", "settings.wan.set", "--params", params, "--confirm"], io, host)).toBe(0);
    expect(out).toContain("maple@example.net");
    expect(out).not.toContain(PPPOE_PASSWORD);
    expect(JSON.stringify(audit.entries)).not.toContain(PPPOE_PASSWORD);
    expect(JSON.stringify(audit.entries)).toContain('"password":"[removed]"');
  });
});

describe("internet-side settings writes (fake eero server)", () => {
  let fake: FakeEero | null = null;
  afterEach(async () => {
    await fake?.close();
    fake = null;
  });
  const N = "100001";
  const sent = (f: FakeEero) => f.writes.map(({ method, path, version, encoding, body, status }) => ({ method, path, version, encoding, body, status }));
  const put = (body: Record<string, unknown>) => ({ method: "PUT", path: `/2.2/networks/${N}/settings`, version: "2.2", encoding: "json", body, status: 200 });

  // One engine per write: the client's rate limiter (about 100 a minute) would hold a single long run.
  const CASES: [string, Record<string, unknown>, Record<string, unknown>, (s: M.NetworkSettings) => unknown, unknown][] = [
    ["settings.dns.set", { mode: "custom", servers: ["1.1.1.1"], ipv6Servers: ["2606:4700:4700::1111"], caching: false },
      { dns: { mode: "custom", caching: false, custom: { ips: ["1.1.1.1"] } }, ipv6: { name_servers: { mode: "custom", custom: ["2606:4700:4700::1111"] } } },
      (s) => s.dns, { mode: "custom", servers: ["1.1.1.1"], ipv6Servers: ["2606:4700:4700::1111"], caching: false, ispServers: ["203.0.113.53"] }],
    ["settings.dhcp.set", WRITES["settings.dhcp.set"]!,
      { dhcp: { mode: "custom", custom: { subnet_ip: "10.20.0.0", subnet_mask: "255.255.255.0", start_ip: "10.20.0.100", end_ip: "10.20.0.200" } } },
      (s) => s.dhcp, { mode: "custom", subnetIp: "10.20.0.0", subnetMask: "255.255.255.0", gateway: "10.20.0.1", startIp: "10.20.0.100", endIp: "10.20.0.200" }],
    ["settings.ipv6.set", { enabled: true }, { ipv6_upstream: true }, (s) => s.ipv6.enabled, true],
    ["settings.wan.set", WRITES["settings.wan.set"]!,
      { lease: { mode: "static", static: { ip: "203.0.113.10", mask: "255.255.255.0", router: "203.0.113.1" } }, pppoe: { enabled: false }, vlan: "201" },
      (s) => s.wan, { mode: "static", static: { ip: "203.0.113.10", mask: "255.255.255.0", router: "203.0.113.1" }, pppoeUsername: null, vlan: 201 }],
    ["settings.wan.set", { mode: "pppoe", pppoe: { username: "maple@example.net", password: PPPOE_PASSWORD }, vlan: null },
      { lease: { mode: "dhcp" }, pppoe: { enabled: true, credentials: { username: "maple@example.net", password: PPPOE_PASSWORD } }, vlan: "" },
      (s) => s.wan, { mode: "pppoe", static: null, pppoeUsername: "maple@example.net", vlan: null }],
    ["settings.connection_mode.set", { mode: "bridged" }, { connection: { mode: "bridged" } }, (s) => [s.connectionMode, s.dhcp.mode], ["bridged", "bridged"]],
    ["settings.nat_randomization.set", { randomized: true }, { nat_port_randomization: true }, (s) => s.natRandomization, true],
    ["settings.upnp.set", { enabled: false }, { upnp: false }, (s) => s.upnp, false],
    ["settings.sqm.set", { enabled: true }, { sqm: true }, (s) => s.sqm, true],
  ];

  it.each(CASES)("%s sends one JSON PUT {net}/settings, and the next (cached) read shows it", async (id, params, body, pick, want) => {
    const s = fakeEngine();
    fake = s.fake;
    await settingsOf(s.engine, N); // cached: the read after proves the write invalidates settings
    const result = await ok(s.engine.execute<M.NetworkSettings>(id, { networkId: N, ...params, ...conf(id) }));
    expect(sent(s.fake)).toEqual([put(body)]);
    expect(pick(result)).toEqual(want);
    expect(pick(await settingsOf(s.engine, N))).toEqual(want);
    expect(JSON.stringify(result)).not.toContain(PPPOE_PASSWORD);
  });

  it("sends nothing for a change that changes nothing or is refused in core", async () => {
    const s = fakeEngine();
    fake = s.fake;
    await ok(s.engine.execute("settings.upnp.set", { networkId: N, enabled: true }));
    await ok(s.engine.execute("settings.dns.set", { networkId: N, mode: "automatic", confirm: true }));
    await ok(s.engine.execute("settings.connection_mode.set", { networkId: N, mode: "nat", confirm: true }));
    await ok(s.engine.execute("settings.wan.set", { networkId: N, mode: "dhcp", confirm: true }));
    await ok(s.engine.execute("settings.wan.set", { networkId: N, mode: "dhcp", vlan: null, confirm: true }));
    expect(await code(s.engine.execute("settings.dns.set", { networkId: N, mode: "custom", servers: ["1.1.1"], confirm: true }))).toBe("bad_params");
    expect(await code(s.engine.execute("settings.ipv6.set", { networkId: N, enabled: true }))).toBe("needs_confirm");
    expect(s.fake.writes).toEqual([]);
  });

  it("the fake answers 400 for a bad body and changes nothing", async () => {
    const f = createFakeEero({ now: () => NOW });
    fake = f;
    const token = f.signIn();
    const before = structuredClone(f.state.networks.get(N)!.network);
    const send = (body: unknown) =>
      f.fetch(`${f.origin}/2.2/networks/${N}/settings`, { method: "PUT", headers: { "content-type": "application/json", cookie: `s=${token}` }, body: JSON.stringify(body) });
    for (const body of [{ dhcp: { mode: "custom" } }, { upnp: "yes" }, { vlan: "5000" }, { lease: { mode: "static" } }, { connection: { mode: "router" } }, { dns: { mode: "custom", custom: { ips: [] } } }, { pppoe: { enabled: true } }, { bogus: 1 }, { sqm: true, upnp: "no" }]) {
      const res = await send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(f.state.networks.get(N)!.network).toEqual(before);
  });

  it("the Wi-Fi rename still goes through the same path as a form", async () => {
    const s = fakeEngine();
    fake = s.fake;
    await ok(s.engine.execute("wifi.name.set", { networkId: N, name: "Maple Renamed", confirm: true }));
    expect(sent(s.fake)).toEqual([{ ...put({ name: "Maple Renamed" }), encoding: "form" }]);
  });
});
