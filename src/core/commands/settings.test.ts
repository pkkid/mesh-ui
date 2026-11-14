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
