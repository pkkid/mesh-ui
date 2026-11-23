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
    expect(s.powerSaving.schedules.map((x) => x.name)).toEqual(["At work"]);
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
    // Only ZTS is on: eero's app turns it on with ZTS and off with DEFAULT, which eero stores as LTS.
    expect(["ZTS", "zts", "LTS", "DEFAULT", "OFF", true, "enabled", null].map(simpleSetup)).toEqual([true, true, false, false, false, true, null, null]);
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
    // eero.restart, guest writes, pauses and blocks have their own impact copy (gateway-aware, guests only, the devices named);
    // conversation.approve shows eero's own permission ask.
    const own = new Set(["conversation.approve", "eero.restart", "guest.disable", "guest.rename", "guest.password.set", "wifi.hide5g.set", "device.pause", "device.block", "profile.pause", "profile.unassigned.pause", "integrations.builtin.set"]);
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
  it("maps eero Simple Setup's captured LTS value to off (M5 review: eero's app said Off), and keeps unknown words null", () => {
    expect(simpleSetup("LTS")).toBe(false);
    expect(simpleSetup("ZTS")).toBe(true);
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

// ---------------------------------------------------------------------------
// Wireless, mesh and Thread writes (M5.3)

/** A valid call per M5.3 write on the demo's Maple Street, each a change, and how the next read shows it. */
const M53: [string, Record<string, unknown>, (s: M.NetworkSettings) => unknown, unknown][] = [
  ["settings.band_steering.set", { enabled: false }, (s) => s.bandSteering, false],
  ["settings.fast_transition.set", { enabled: false }, (s) => s.fastTransition, false],
  ["settings.mlo.set", { mode: "single" }, (s) => s.mlo, "single"],
  ["settings.legacy_mode.set", { enabled: true }, (s) => s.legacyMode, true],
  ["settings.power_saving.set", { enabled: false, scheduleEnabled: false }, (s) => [s.powerSaving.enabled, s.powerSaving.scheduleEnabled], [false, false]],
  ["settings.timezone.set", { timezone: "Europe/Berlin" }, (s) => s.timezone, "Europe/Berlin"],
  ["settings.simple_setup.set", { enabled: false }, (s) => s.simpleSetup, false],
  ["settings.thread.set", { enabled: false, credentialSync: false }, (s) => [s.thread?.enabled, s.thread?.credentialSync], [false, false]],
];
const M53_DISRUPTIVE = ["settings.mlo.set", "settings.legacy_mode.set", "settings.fast_transition.set", "settings.thread.set", "settings.timezone.set"];
const m53conf = (id: string) => (M53_DISRUPTIVE.includes(id) ? { confirm: true } : {});
const THREAD_KEY = "00112233445566778899aabbccddeeff";

describe("wireless, mesh and Thread settings writes (demo)", () => {
  it.each(M53)("%s shows in the next settings.get", async (id, params, pick, want) => {
    const engine = demoEngine();
    await settingsOf(engine, MAPLE); // cached: the read after proves the write invalidates settings
    const result = await ok(engine.execute<M.NetworkSettings>(id, { networkId: MAPLE, ...params, ...m53conf(id) }));
    expect(pick(result)).toEqual(want);
    expect(pick(await settingsOf(engine, MAPLE))).toEqual(want);
  });

  it("MLO, legacy mode, fast roaming and Thread need confirm; the live toggles do not", async () => {
    const engine = demoEngine();
    const impact = await ok(engine.execute<M.SettingsImpact>("settings.impact", { networkId: MAPLE, changes: [{ id: "settings.mlo.set" }] }));
    expect(await engine.execute("settings.mlo.set", { networkId: MAPLE, mode: "single" })).toMatchObject({ ok: false, error: { code: "needs_confirm", message: impact.summary } });
    const legacy = await engine.execute("settings.legacy_mode.set", { networkId: MAPLE, enabled: true });
    expect(legacy).toMatchObject({ ok: false, error: { code: "needs_confirm", message: expect.stringMatching(/^Legacy device mode turns on\. Every eero restarts .*about 2 to 3 minutes\.$/) } });
    expect(await engine.execute("settings.mlo.set", { networkId: MAPLE, mode: "multi" })).toMatchObject({ ok: false, error: { code: "needs_confirm", message: "Nothing changes, so nothing restarts." } });
    expect(await engine.execute("settings.fast_transition.set", { networkId: MAPLE, enabled: true })).toMatchObject({ ok: false, error: { code: "needs_confirm", message: "Nothing changes." } });
    expect(await engine.execute("settings.fast_transition.set", { networkId: MAPLE, enabled: false })).toMatchObject({ ok: false, error: { code: "needs_confirm", message: "Fast roaming turns off. Nothing restarts and no device disconnects." } });
    const thread = await engine.execute("settings.thread.set", { networkId: MAPLE, enabled: false });
    expect(thread).toMatchObject({ ok: false, error: { code: "needs_confirm", message: expect.stringMatching(/^Thread turns off\. /) } });
    const live = M53.filter(([id]) => !M53_DISRUPTIVE.includes(id));
    for (const [id, params] of live) expect((await engine.execute(id, { networkId: MAPLE, ...params })).ok, id).toBe(true);
  });

  it("a time zone change always asks, naming who goes offline when it starts a scheduled pause now", async () => {
    const engine = demoEngine();
    const before = (await settingsOf(engine, MAPLE)).timezone;
    // 14:41 in Los Angeles is 23:41 in Berlin, inside Mia's Bedtime (9:00 PM to 7:00 AM).
    const berlin = await engine.execute("settings.timezone.set", { networkId: MAPLE, timezone: "Europe/Berlin" });
    expect(berlin).toMatchObject({
      ok: false,
      error: { code: "needs_confirm", message: expect.stringMatching(/^Profile pauses, power saving and the update window move to Europe\/Berlin time\. In Europe\/Berlin, Mia's Bedtime pause is on now, so .+ lose internet until 7:00 AM\.$/) },
    });
    expect((await settingsOf(engine, MAPLE)).timezone).toBe(before);
    // 15:41 in Denver starts nothing, but schedules still shift, so it asks too.
    const denver = await engine.execute("settings.timezone.set", { networkId: MAPLE, timezone: "America/Denver" });
    expect(denver).toMatchObject({ ok: false, error: { code: "needs_confirm", message: "Profile pauses, power saving and the update window move to America/Denver time. No schedule starts now, so no device goes offline." } });
    expect((await engine.execute("settings.timezone.set", { networkId: MAPLE, timezone: "America/Denver", confirm: true })).ok).toBe(true);
  });

  it("a change that changes nothing returns the settings as they are", async () => {
    const engine = demoEngine();
    const before = await settingsOf(engine, MAPLE);
    for (const [id, params] of [
      ["settings.band_steering.set", { enabled: true }],
      ["settings.power_saving.set", { enabled: true }],
      ["settings.timezone.set", { timezone: before.timezone, confirm: true }],
      ["settings.thread.set", { enabled: true, confirm: true }],
      ["settings.mlo.set", { mode: "multi", confirm: true }],
    ] as const) {
      expect(await ok(engine.execute<M.NetworkSettings>(id, { networkId: MAPLE, ...params }))).toEqual(before);
    }
  });

  it("a time zone the backend answers for but does not keep is an eero_error, not a saved result", async () => {
    const demo = createDemoBackend({ clock: () => NOW });
    // As a real network did (M5.R-fix4): the write is accepted and the next read has the old zone.
    const backend: Backend = { ...demo, settings: { ...demo.settings, setTimezone: (id) => demo.settings.get(id) } };
    const engine = createEngine({ backend, clock: () => NOW });
    const before = (await settingsOf(engine, MAPLE)).timezone;
    const r = await engine.execute("settings.timezone.set", { networkId: MAPLE, timezone: "Europe/Berlin", confirm: true });
    expect(r).toMatchObject({ ok: false, error: { code: "eero_error", message: `eero accepted the time zone but still reports ${before}, not Europe/Berlin. Check again in a minute; if it has not changed, eero did not save it.` } });
  });

  it("bad_params for what the network lacks, bad values and empty changes", async () => {
    const engine = demoEngine();
    const bad = async (id: string, params: Record<string, unknown>) => expect(await code(engine.execute(id, { networkId: MAPLE, ...params })), `${id} ${JSON.stringify(params)}`).toBe("bad_params");
    await bad("settings.power_saving.set", {});
    await bad("settings.thread.set", {});
    await bad("settings.timezone.set", { timezone: "Mars/Olympus" });
    await bad("settings.timezone.set", { timezone: "" });
    await bad("settings.mlo.set", { mode: "max", confirm: true });
    await bad("settings.band_steering.set", { enabled: "yes" });
    // Mom's House reports no MLO or Thread, and power_saving not capable (only schedule deletes still work there).
    expect(await code(engine.execute("settings.mlo.set", { networkId: MOM, mode: "single", confirm: true }))).toBe("bad_params");
    expect(await code(engine.execute("settings.power_saving.set", { networkId: MOM, enabled: true }))).toBe("bad_params");
    expect(await code(engine.execute("settings.thread.set", { networkId: MOM, enabled: true, confirm: true }))).toBe("bad_params");
    expect(await code(engine.execute("settings.thread.credentials", { networkId: MOM }))).toBe("bad_params");
    expect(await code(engine.execute("settings.thread.reset", { networkId: MOM, confirm: true }))).toBe("bad_params");
  });

  it("power saving schedules: add one past midnight, edit, remove, with field errors", async () => {
    const engine = demoEngine();
    await settingsOf(engine, MAPLE);
    const added = await ok(engine.execute<M.Schedule>("settings.power_schedule.add", { networkId: MAPLE, name: "Late night", days: ["SUN", "FRI", "SAT"], start: "22:30", end: "06:15" }));
    expect(added).toMatchObject({ name: "Late night", days: ["FRI", "SAT", "SUN"], start: "22:30", end: "06:15", enabled: true });
    // End before start: kept as given, the timeline wraps it into the next day.
    expect((await settingsOf(engine, MAPLE)).powerSaving.schedules.find((s) => s.id === added.id)).toEqual(added);

    const edited = await ok(engine.execute<M.Schedule>("settings.power_schedule.update", { networkId: MAPLE, schedule: "late night", end: "07:00", enabled: false }));
    expect(edited).toEqual({ ...added, end: "07:00", enabled: false });

    const fails = async (id: string, params: Record<string, unknown>, path: string) => {
      const r = await engine.execute(id, { networkId: MAPLE, ...params });
      expect(r, `${id} ${JSON.stringify(params)}`).toMatchObject({ ok: false, error: { code: "bad_params", detail: { issues: expect.arrayContaining([expect.objectContaining({ path: expect.stringMatching(new RegExp(`^${path}`)) })]) } } });
    };
    await fails("settings.power_schedule.add", { name: "Same", days: ["MON"], start: "08:00", end: "08:00" }, "end");
    await fails("settings.power_schedule.add", { name: "Overnight", days: ["MON"], start: "08:00", end: "09:00" }, "name");
    await fails("settings.power_schedule.add", { name: "Bad", days: [], start: "08:00", end: "09:00" }, "days");
    await fails("settings.power_schedule.add", { name: "Bad", days: ["MON"], start: "24:00", end: "09:00" }, "start");
    await fails("settings.power_schedule.update", { schedule: "Nope", end: "09:00" }, "schedule");

    const removed = await ok(engine.execute<{ removed: string; schedule: M.Schedule }>("settings.power_schedule.remove", { networkId: MAPLE, schedule: added.id }));
    expect(removed).toEqual({ removed: added.id, schedule: edited });
    expect((await settingsOf(engine, MAPLE)).powerSaving.schedules.map((s) => s.name)).toEqual(["Overnight", "Weekday daytime"]);
  });

  it("Thread credentials: a sensitive, uncached query; settings.get never carries them; reset needs confirm and makes new ones", async () => {
    const engine = demoEngine();
    const info = engine.commands().find((c) => c.id === "settings.thread.credentials");
    expect(info).toMatchObject({ effect: "query", sensitive: true });
    const creds = await ok(engine.execute<M.ThreadCredentials>("settings.thread.credentials", { networkId: MAPLE }));
    expect(creds.networkKey).toBe(THREAD_KEY);

    expect(engine.commands().find((c) => c.id === "settings.thread.reset")).toMatchObject({ effect: "destructive" });
    expect(await engine.execute("settings.thread.reset", { networkId: MAPLE })).toMatchObject({
      ok: false,
      error: { code: "needs_confirm", message: "Makes new credentials for MapleThread. Every Thread accessory must be paired again. This cannot be undone." },
    });
    expect((await ok(engine.execute<M.ThreadCredentials>("settings.thread.credentials", { networkId: MAPLE }))).networkKey).toBe(THREAD_KEY);
    expect(await ok(engine.execute("settings.thread.reset", { networkId: MAPLE, confirm: true }))).toEqual({ networkId: MAPLE, reset: true });
    const fresh = await ok(engine.execute<M.ThreadCredentials>("settings.thread.credentials", { networkId: MAPLE }));
    expect(fresh.networkKey).not.toBe(THREAD_KEY);
    const s = JSON.stringify(await settingsOf(engine, MAPLE));
    expect(s).not.toContain(fresh.networkKey);
    expect(s).not.toMatch(SECRET_WORDS);
  });

  it("Thread credentials stay out of the audit log and the CLI table without --reveal", async () => {
    const audit = memoryAudit();
    const host: CliHost = { ...nodeHost(), createEngine: ({ surface }) => createEngine({ backend: createDemoBackend({ clock: () => NOW }), surface, audit, clock: () => NOW }) };
    const run = async (args: string[]) => {
      let out = "";
      const io = { stdout: (s: string) => void (out += s), stderr: (s: string) => void (out += s) };
      expect(await runCli(args, io, host)).toBe(0);
      return out;
    };
    const table = await run(["--no-color", "--format", "table", "run", "settings.thread.credentials"]);
    expect(table).not.toContain(THREAD_KEY);
    expect(table).not.toContain("445f2b5ca6f2a93a55ce570a70efeecb");
    expect(table).toContain("********");
    expect(await run(["--no-color", "--format", "table", "--reveal", "run", "settings.thread.credentials"])).toContain(THREAD_KEY);
    await run(["--no-color", "run", "settings.thread.reset", "--confirm"]);
    expect(JSON.stringify(audit.entries)).not.toContain(THREAD_KEY);
    expect(audit.entries.map((e) => e.id)).toEqual(["settings.thread.credentials", "settings.thread.credentials", "settings.thread.reset"]);
  });

  it("declares effects, gates and the topics each write invalidates", () => {
    const info = (id: string) => allCommands().find((c) => c.id === id);
    const rows = Object.fromEntries(
      [...M53.map(([id]) => id), "settings.power_schedule.add", "settings.power_schedule.update", "settings.power_schedule.remove", "settings.thread.reset"].map((id) => [id, [info(id)?.effect, info(id)?.gate, info(id)?.invalidates]]),
    );
    const g = (op?: string) => (op ? { area: "settings", op } : { area: "settings" });
    expect(rows).toEqual({
      "settings.band_steering.set": ["write", g(), ["settings"]],
      "settings.fast_transition.set": ["disruptive", g(), ["settings"]],
      "settings.mlo.set": ["disruptive", g(), ["settings", "network", "wifi"]],
      "settings.legacy_mode.set": ["disruptive", g(), ["settings", "network", "wifi"]],
      "settings.power_saving.set": ["write", g(), ["settings"]],
      "settings.timezone.set": ["disruptive", g(), ["settings", "network", "profiles"]],
      "settings.simple_setup.set": ["write", g(), ["settings"]],
      "settings.thread.set": ["disruptive", g(), ["settings"]],
      "settings.power_schedule.add": ["write", g(), ["settings"]],
      "settings.power_schedule.update": ["write", g(), ["settings"]],
      "settings.power_schedule.remove": ["write", g("delete"), ["settings"]],
      "settings.thread.reset": ["destructive", g(), ["settings"]],
    });
  });

  it("refuses every power saving change but a schedule delete with the hardware reason when eero reports power_saving not capable", async () => {
    const engine = demoEngine();
    const before = await settingsOf(engine, MOM);
    const refused = [
      ["settings.power_saving.set", { enabled: true }],
      ["settings.power_saving.set", { scheduleEnabled: true }],
      ["settings.power_schedule.add", { name: "Night", days: ["MON"], start: "22:00", end: "06:00" }],
      ["settings.power_schedule.update", { schedule: "At work", enabled: false }],
    ] as const;
    for (const [id, params] of refused) {
      const r = await engine.execute(id, { networkId: MOM, ...params });
      expect(r, id).toMatchObject({ ok: false, error: { code: "bad_params", message: "Your eero hardware does not support power saving." } });
    }
    expect(await settingsOf(engine, MOM)).toEqual(before);
    // Delete stays allowed, so old schedules can be cleaned up.
    await ok(engine.execute("settings.power_schedule.remove", { networkId: MOM, schedule: "At work" }));
    expect((await settingsOf(engine, MOM)).powerSaving.schedules).toEqual([]);
  });
});

describe("wireless, mesh and Thread settings writes (fake eero server)", () => {
  let fake: FakeEero | null = null;
  afterEach(async () => {
    await fake?.close();
    fake = null;
  });
  const N = "100001";
  const base = `/2.2/networks/${N}`;
  const sent = (f: FakeEero) => f.writes.map(({ method, path, encoding, body, status }) => ({ method, path, encoding, body, status }));
  const req = (method: string, path: string, body: Record<string, unknown>, encoding = "json") => ({ method, path: `${base}${path}`, encoding, body, status: 200 });

  // The fake's Maple Street: steering, fast roaming, MLO multi, power saving on, Simple Setup on, Thread on.
  const CASES: [string, Record<string, unknown>, ReturnType<typeof req>, (s: M.NetworkSettings) => unknown, unknown][] = [
    ["settings.band_steering.set", { enabled: false }, req("PUT", "/settings", { band_steering: false }), (s) => s.bandSteering, false],
    ["settings.fast_transition.set", { enabled: false }, req("PUT", "/fast_transition", { fast_transition: false }), (s) => s.fastTransition, false],
    ["settings.mlo.set", { mode: "disabled" }, req("PUT", "/mlo_mode", { mlo_mode: "disabled" }), (s) => s.mlo, "disabled"],
    ["settings.legacy_mode.set", { enabled: true }, req("PUT", "/ac_compat", { enabled: "true" }, "form"), (s) => s.legacyMode, true],
    ["settings.power_saving.set", { scheduleEnabled: false }, req("PUT", "/power_saving", { power_saving_schedule_enabled: false }), (s) => [s.powerSaving.enabled, s.powerSaving.scheduleEnabled], [true, false]],
    ["settings.power_saving.set", { enabled: false }, req("PUT", "/power_saving", { enable: false }), (s) => s.powerSaving.enabled, false],
    ["settings.simple_setup.set", { enabled: false }, req("PUT", "/auto_setup_mode", { mode: "DEFAULT" }), (s) => s.simpleSetup, false],
    ["settings.thread.set", { enabled: false }, req("PUT", "/thread/enable", { enabled: false }), (s) => s.thread?.enabled, false],
    ["settings.thread.set", { credentialSync: false }, req("PUT", "/thread", { enable_credential_syncing: false }), (s) => s.thread?.credentialSync, false],
  ];

  it.each(CASES)("%s sends its request once, and the next (cached) read shows it", async (id, params, request, pick, want) => {
    const s = fakeEngine();
    fake = s.fake;
    await settingsOf(s.engine, N);
    const result = await ok(s.engine.execute<M.NetworkSettings>(id, { networkId: N, ...params, ...m53conf(id) }));
    expect(sent(s.fake)).toEqual([request]);
    expect(pick(result)).toEqual(want);
    expect(pick(await settingsOf(s.engine, N))).toEqual(want);
  });

  it("Simple Setup: LTS (eero's off) reads off; on sends ZTS; off sends DEFAULT, which eero stores as LTS", async () => {
    // Lake Cabin reads LTS, as the M5 review's real network did while eero's app said Off.
    const L = "100002";
    const s = fakeEngine();
    fake = s.fake;
    expect((await settingsOf(s.engine, L)).simpleSetup).toBe(false);
    await ok(s.engine.execute("settings.simple_setup.set", { networkId: L, enabled: true }));
    expect((await settingsOf(s.engine, L)).simpleSetup).toBe(true);
    await ok(s.engine.execute("settings.simple_setup.set", { networkId: L, enabled: false }));
    expect((await settingsOf(s.engine, L)).simpleSetup).toBe(false);
    const at = `/2.2/networks/${L}/auto_setup_mode`;
    expect(sent(s.fake).map((w) => [w.path, w.body])).toEqual([
      [at, { mode: "ZTS" }],
      [at, { mode: "DEFAULT" }],
    ]);
    expect(s.fake.state.networks.get(L)?.network.auto_setup_mode).toBe("LTS");
  });

  it("Thread off goes to {thread}/enable; thread_enable on {thread} is ignored by eero, as the M5 review saw", async () => {
    const s = fakeEngine();
    fake = s.fake;
    await ok(s.engine.execute("settings.thread.set", { networkId: N, enabled: false, credentialSync: false, confirm: true }));
    expect(sent(s.fake)).toEqual([req("PUT", "/thread/enable", { enabled: false }), req("PUT", "/thread", { enable_credential_syncing: false })]);
    expect((await settingsOf(s.engine, N)).thread).toMatchObject({ enabled: false, credentialSync: false });
    expect(s.fake.state.networks.get(N)?.network.thread).toBe(false);
    await ok(s.engine.execute("settings.thread.set", { networkId: N, enabled: true, confirm: true }));
    expect((await settingsOf(s.engine, N)).thread?.enabled).toBe(true);
  });

  it("a write eero answers 200 but does not apply fails with eero_error instead of reporting success", async () => {
    const s = fakeEngine();
    fake = s.fake;
    // The old Thread request: eero answers 200 and Thread stays on.
    await s.fake.fetch(`${s.fake.origin}${base}/thread`, { method: "PUT", headers: { "content-type": "application/json", cookie: `s=${s.fake.signIn()}` }, body: JSON.stringify({ thread_enable: false }) });
    expect(s.fake.state.networks.get(N)?.thread?.enabled).toBe(true);
    const stuck: typeof s.backend = { ...s.backend, settings: { ...s.backend.settings, setThread: (id) => s.backend.settings.get(id), setSimpleSetup: (id) => s.backend.settings.get(id) } };
    const engine = createEngine({ backend: stuck, clock: () => NOW });
    expect(await engine.execute("settings.thread.set", { networkId: N, enabled: false, confirm: true })).toMatchObject({
      ok: false,
      error: { code: "eero_error", message: "eero accepted the change but did not apply it. Thread is still on." },
    });
    expect(await engine.execute("settings.simple_setup.set", { networkId: N, enabled: false })).toMatchObject({ ok: false, error: { code: "eero_error" } });
  });

  it("power saving schedules: POST, PUT and DELETE on the schedule, past midnight", async () => {
    const s = fakeEngine();
    fake = s.fake;
    const added = await ok(s.engine.execute<M.Schedule>("settings.power_schedule.add", { networkId: N, name: "Late night", days: ["SAT", "SUN"], start: "23:00", end: "05:30" }));
    expect(added).toEqual({ id: "2", name: "Late night", days: ["SAT", "SUN"], start: "23:00", end: "05:30", enabled: true });
    expect((await settingsOf(s.engine, N)).powerSaving.schedules.map((x) => [x.name, x.start, x.end])).toEqual([["Overnight", "01:00", "06:00"], ["Late night", "23:00", "05:30"]]);
    await ok(s.engine.execute("settings.power_schedule.update", { networkId: N, schedule: "Late night", enabled: false }));
    await ok(s.engine.execute("settings.power_schedule.remove", { networkId: N, schedule: "2" }));
    const body = { name: "Late night", days: ["Saturday", "Sunday"], start_time: "23:00", end_time: "05:30", enabled: true };
    expect(sent(s.fake)).toEqual([
      req("POST", "/power_saving/schedules", body),
      req("PUT", "/power_saving/schedules/2", { ...body, enabled: false }),
      { method: "DELETE", path: `${base}/power_saving/schedules/2`, encoding: "empty", body: {}, status: 200 },
    ]);
    expect((await settingsOf(s.engine, N)).powerSaving.schedules.map((x) => x.name)).toEqual(["Overnight"]);
  });

  // M5.R-fix4: on a real network whose gateway lacks power saving, eero sends capable false and answers `enable`
  // with 403; the command now refuses first, with the reason, and sends nothing. The schedule switch still answers.
  const INCAPABLE = "100002";
  it("on hardware without power saving, every change but a schedule delete is refused before eero is called", async () => {
    const s = fakeEngine();
    fake = s.fake;
    // A schedule left over from before, as the eero app can leave one behind.
    s.fake.state.networks.get(INCAPABLE)!.powerSavingSchedules.push({ url: `/2.2/networks/${INCAPABLE}/power_saving/schedules/1`, id: 1, name: "Old", days: ["Monday"], start_time: "01:00", end_time: "06:00", enabled: true });
    expect((await ok(s.engine.execute<M.Network>("network.get", { networkId: INCAPABLE }))).capabilities.power_saving).toBe(false);
    const refused = [
      ["settings.power_saving.set", { enabled: true }],
      ["settings.power_saving.set", { scheduleEnabled: true }],
      ["settings.power_schedule.add", { name: "Night", days: ["MON"], start: "22:00", end: "06:00" }],
      ["settings.power_schedule.update", { schedule: "1", enabled: false }],
    ] as const;
    for (const [id, params] of refused) {
      const r = await s.engine.execute(id, { networkId: INCAPABLE, ...params });
      expect(r, id).toMatchObject({ ok: false, error: { code: "bad_params", message: "Your eero hardware does not support power saving." } });
    }
    expect(s.fake.writes).toEqual([]);
    await ok(s.engine.execute("settings.power_schedule.remove", { networkId: INCAPABLE, schedule: "1" }));
    expect(sent(s.fake)).toEqual([{ method: "DELETE", path: `/2.2/networks/${INCAPABLE}/power_saving/schedules/1`, encoding: "empty", body: {}, status: 200 }]);
  });

  it("the fake answers like the real API: 403 for enable on incapable hardware, 400 error.form.errors for MON or monday days", async () => {
    const f = createFakeEero({ now: () => NOW });
    fake = f;
    const token = f.signIn();
    const send = (net: string, method: string, path: string, body: unknown) =>
      f.fetch(`${f.origin}/2.2/networks/${net}${path}`, { method, headers: { "content-type": "application/json", cookie: `s=${token}` }, body: JSON.stringify(body) });
    expect((await send(INCAPABLE, "PUT", "/power_saving", { enable: true })).status).toBe(403);
    for (const days of [["MON"], ["monday"]]) {
      const post = await send(N, "POST", "/power_saving/schedules", { name: "Night", days, start_time: "23:00", end_time: "06:00", enabled: true });
      expect(post.status, days[0]).toBe(400);
      expect(((await post.json()) as { meta: { error: string } }).meta.error).toBe("error.form.errors");
    }
    expect((await send(N, "POST", "/power_saving/schedules", { name: "Night", days: ["Monday"], start_time: "23:00", end_time: "06:00", enabled: true })).status).toBe(200);
  });

  it("time zone: the eero backend sends nothing and answers not available yet (no request eero applies is known, M6.9)", async () => {
    const s = fakeEngine();
    fake = s.fake;
    const before = (await settingsOf(s.engine, N)).timezone;
    const r = await s.engine.execute("settings.timezone.set", { networkId: N, timezone: "Europe/Berlin", confirm: true });
    expect(r).toMatchObject({ ok: false, error: { code: "eero_error", message: "settings.setTimezone is not available in the eero backend yet." } });
    expect(s.fake.writes).toEqual([]);
    expect((await settingsOf(s.engine, N)).timezone).toBe(before);
  });

  it("the fake answers the old time zone request 200 and keeps the zone, as the real network did (M5.R-fix4)", async () => {
    const f = createFakeEero({ now: () => NOW });
    fake = f;
    const token = f.signIn();
    const res = await f.fetch(`${f.origin}${base}/settings`, { method: "PUT", headers: { "content-type": "application/json", cookie: `s=${token}` }, body: JSON.stringify({ timezone: { value: "Europe/Berlin" } }) });
    expect(res.status).toBe(200);
    expect((f.state.networks.get(N)!.network.timezone as { value?: string } | undefined)?.value).not.toBe("Europe/Berlin");
  });

  it("Thread credentials come from GET {net}/thread, uncached; reset is one POST {net}/thread after confirm", async () => {
    const s = fakeEngine();
    fake = s.fake;
    const before = await ok(s.engine.execute<M.ThreadCredentials>("settings.thread.credentials", { networkId: N }));
    expect(before.networkKey).toBe("fake-thread-master-key-0000000001");
    expect(await code(s.engine.execute("settings.thread.reset", { networkId: N }))).toBe("needs_confirm");
    expect(s.fake.writes).toEqual([]);
    await ok(s.engine.execute("settings.thread.reset", { networkId: N, confirm: true }));
    expect(sent(s.fake)).toEqual([{ method: "POST", path: `${base}/thread`, encoding: "empty", body: {}, status: 200 }]);
    const after = await ok(s.engine.execute<M.ThreadCredentials>("settings.thread.credentials", { networkId: N }));
    expect(after.networkKey).not.toBe(before.networkKey);
    expect(JSON.stringify(await settingsOf(s.engine, N))).not.toContain(after.networkKey);
  });

  it("the client request log never carries Thread secrets", async () => {
    const log: RequestLogEntry[] = [];
    const s = fakeEngine(undefined, (e) => log.push(e));
    fake = s.fake;
    await ok(s.engine.execute("settings.thread.credentials", { networkId: N }));
    await ok(s.engine.execute("settings.thread.reset", { networkId: N, confirm: true }));
    expect(log.length).toBeGreaterThan(0);
    expect(JSON.stringify(log)).not.toMatch(/fake-thread-(master-key|pskc)/);
  });

  it("the fake answers 400 for bad bodies and 404 for Thread on a network without it", async () => {
    const f = createFakeEero({ now: () => NOW });
    fake = f;
    const token = f.signIn();
    const send = (method: string, path: string, body: unknown, form = false) =>
      f.fetch(`${f.origin}/2.2/networks/${path}`, {
        method,
        headers: { "content-type": form ? "application/x-www-form-urlencoded" : "application/json", cookie: `s=${token}` },
        body: form ? String(body) : JSON.stringify(body),
      });
    const before = structuredClone(f.state.networks.get(N)!.network);
    for (const [path, body] of [
      ["settings", { band_steering: "on" }],
      ["settings", { timezone: { value: "not a zone" } }],
      ["fast_transition", { fast_transition: 1 }],
      ["mlo_mode", { mlo_mode: "max" }],
      ["power_saving", { enable: "yes" }],
      ["power_saving", {}],
      ["auto_setup_mode", { mode: "MANUAL" }],
      ["thread", { thread_enable: "no" }],
    ] as const) {
      expect((await send("PUT", `${N}/${path}`, body)).status, `${path} ${JSON.stringify(body)}`).toBe(400);
    }
    expect((await send("POST", `${N}/power_saving/schedules`, { name: "x", days: [], start_time: "01:00", end_time: "02:00" })).status).toBe(400);
    expect((await send("PUT", `${N}/ac_compat`, "enabled=maybe", true)).status).toBe(400);
    expect(f.state.networks.get(N)!.network).toEqual(before);
    expect((await send("PUT", "100002/thread", { thread_enable: true })).status).toBe(404);
    expect((await send("POST", "100002/thread", "")).status).toBe(404);
  });
});
