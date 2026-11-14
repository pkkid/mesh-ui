import { afterEach, describe, expect, it } from "vitest";
import { createFakeEero, type FakeEero } from "../../../test/fake-eero/server";
import type { AuthState, Backend, SecretStore } from "../backend";
import { createDemoBackend } from "../demo";
import { createEeroBackend } from "../eero/backend";
import { READ_SHARE_MS, type RequestLogEntry } from "../eero/client";
import { guestSecurity, mapGuestNetwork, securityOf } from "../eero/map/guest";
import { RateLimiter } from "../eero/ratelimit";
import { createEngine, type Engine } from "../engine";
import type * as M from "../model";
import { wifiEscape, wifiPayload } from "./guest";

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

describe("guest.get (demo)", () => {
  it("returns the guest network without its password, with guests online and seen this week", async () => {
    const engine = demoEngine();
    const maple = await ok(engine.execute<M.GuestNetwork>("guest.get", { networkId: MAPLE }));
    expect(maple).toMatchObject({ enabled: true, name: "Maple Street Guest", hasPassword: true, online: 1, security: { "2.4": "WPA2_WPA3", "5": "WPA2_WPA3", "6": "WPA3" } });
    expect(maple.deviceIds).toHaveLength(2);
    expect(JSON.stringify(maple)).not.toContain("lemon-harbor-42");
    expect(Object.keys(maple)).not.toContain("password");
    // The ids are the guest devices of device.list.
    const guests = await ok(engine.execute<M.DeviceList>("device.list", { networkId: MAPLE, ssid: "guest" }));
    expect(guests.devices.map((d) => d.id).sort()).toEqual([...maple.deviceIds].sort());
  });

  it("reports an open guest network and a network with the guest network off", async () => {
    const engine = demoEngine();
    const lake = await ok(engine.execute<M.GuestNetwork>("guest.get", { networkId: LAKE }));
    expect(lake).toMatchObject({ enabled: true, name: "Lake Cabin Guest", hasPassword: false, online: 0, security: { "2.4": null, "5": null, "6": null } });
    const mom = await ok(engine.execute<M.GuestNetwork>("guest.get", { networkId: MOM }));
    expect(mom).toMatchObject({ enabled: false, online: 0 });
  });

  it("rejects bad params and needs a session", async () => {
    const engine = demoEngine();
    expect(await code(engine.execute("guest.get", { extra: 1 }))).toBe("bad_params");
    expect(await code(engine.execute("guest.get", { networkId: "Nowhere" }))).toBe("bad_params");
    expect(await code(demoEngine("signed_out").execute("guest.get"))).toBe("not_signed_in");
  });

  it("is a query on the devices poll, not sensitive", () => {
    const info = demoEngine().commands().find((c) => c.id === "guest.get");
    expect(info).toMatchObject({ effect: "query", scope: "network", sensitive: false, poll: 60 });
  });
});

describe("guest.share (demo)", () => {
  it("returns the name, password and the WIFI: payload", async () => {
    const engine = demoEngine();
    const maple = await ok(engine.execute<M.WifiShare>("guest.share", { networkId: MAPLE }));
    expect(maple).toEqual({ ssid: "Maple Street Guest", password: "lemon-harbor-42", security: "WPA", qr: "WIFI:T:WPA;S:Maple Street Guest;P:lemon-harbor-42;;" });
  });

  it("shares an open network as nopass, with no password", async () => {
    const lake = await ok(demoEngine().execute<M.WifiShare>("guest.share", { networkId: LAKE }));
    expect(lake).toEqual({ ssid: "Lake Cabin Guest", password: null, security: "nopass", qr: "WIFI:T:nopass;S:Lake Cabin Guest;;" });
  });

  it("rejects bad params and needs a session", async () => {
    const engine = demoEngine();
    expect(await code(engine.execute("guest.share", { password: "x" }))).toBe("bad_params");
    expect(await code(engine.execute("guest.share", { networkId: "Nowhere" }))).toBe("bad_params");
    expect(await code(demoEngine("signed_out").execute("guest.share"))).toBe("not_signed_in");
  });

  it("is marked sensitive, never cached and never polled", async () => {
    const engine = demoEngine();
    const info = engine.commands().find((c) => c.id === "guest.share");
    expect(info).toMatchObject({ effect: "query", sensitive: true, poll: null });
    // Not cached: a second call reads the backend again (the demo password changes are seen at once).
    const backend = createDemoBackend({ clock: () => NOW });
    let reads = 0;
    const counted: Backend = { ...backend, guest: { ...backend.guest, credentials: (net) => (reads++, backend.guest.credentials(net)) } };
    const e = createEngine({ backend: counted, clock: () => NOW });
    await ok(e.execute("guest.share"));
    await ok(e.execute("guest.share"));
    expect(reads).toBe(2);
  });
});

describe("WIFI: payload", () => {
  it("escapes backslash, semicolon, comma, colon and double quote", () => {
    expect(wifiEscape(`a;b,c:d\\e"f`)).toBe(`a\\;b\\,c\\:d\\\\e\\"f`);
    expect(wifiPayload("Cafe; Guest", "p:a,s\\s;")).toBe("WIFI:T:WPA;S:Cafe\\; Guest;P:p\\:a\\,s\\\\s\\;;;");
    expect(wifiPayload("Open: Guest", null)).toBe("WIFI:T:nopass;S:Open\\: Guest;;");
    // Plain text needs nothing.
    expect(wifiEscape("Maple Street Guest")).toBe("Maple Street Guest");
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
  return { fake, engine: createEngine({ backend, clock: () => NOW }) };
}

describe("guest commands (fake eero server)", () => {
  let fake: FakeEero | null = null;
  afterEach(async () => {
    await fake?.close();
    fake = null;
  });

  it("maps GET {net}/guestnetwork with guests from the devices and security from wpa3_per_band", async () => {
    const s = fakeEngine();
    fake = s.fake;
    const maple = await ok(s.engine.execute<M.GuestNetwork>("guest.get", { networkId: "100001" }));
    // The plug esp-plug-07 is the one guest; the eeros have 6 GHz radios, so 6 GHz is WPA3.
    expect(maple).toEqual({
      enabled: true,
      name: "Maple Street Guest",
      hasPassword: true,
      online: 1,
      deviceIds: ["0a1b2c000007"],
      security: { "2.4": "WPA2_WPA3", "5": "WPA2_WPA3", "6": "WPA3" },
    });
    expect(JSON.stringify(maple)).not.toContain("fake-guest-pass-01");
    const paths = s.fake.log.map((l) => l.path);
    for (const p of ["guestnetwork", "devices", "wpa3_per_band", "eeros"]) expect(paths).toContain(`/2.2/networks/100001/${p}`);
    expect(s.fake.log.every((l) => l.method === "GET")).toBe(true);

    const lake = await ok(s.engine.execute<M.GuestNetwork>("guest.get", { networkId: "100002" }));
    expect(lake).toMatchObject({ enabled: false, name: "Lake Cabin Guest", hasPassword: true, online: 0, deviceIds: [] });
  });

  it("maps an open guest network and older firmware without wpa3_per_band", async () => {
    const s = fakeEngine((f) => {
      const net = f.state.networks.get("100001");
      if (net?.network.guest_network) net.network.guest_network.password = null;
    });
    fake = s.fake;
    expect(await ok(s.engine.execute<M.GuestNetwork>("guest.get"))).toMatchObject({ hasPassword: false, security: { "2.4": null, "5": null, "6": null } });
    expect(await ok(s.engine.execute<M.WifiShare>("guest.share"))).toEqual({ ssid: "Maple Street Guest", password: null, security: "nopass", qr: "WIFI:T:nopass;S:Maple Street Guest;;" });
  });

  it("shares the guest network with every special character escaped in the payload", async () => {
    const s = fakeEngine((f) => {
      const g = f.state.networks.get("100001")?.network.guest_network;
      if (!g) return;
      g.name = `Cafe; "Back",Room:2\\`;
      g.password = "p;a,s:s\\w";
    });
    fake = s.fake;
    const share = await ok(s.engine.execute<M.WifiShare>("guest.share"));
    expect(share).toEqual({
      ssid: `Cafe; "Back",Room:2\\`,
      password: "p;a,s:s\\w",
      security: "WPA",
      qr: `WIFI:T:WPA;S:Cafe\\; \\"Back\\"\\,Room\\:2\\\\;P:p\\;a\\,s\\:s\\\\w;;`,
    });
    // One read of the guest network (the rest is the engine finding the selected network).
    expect(s.fake.log.map((l) => l.path).filter((p) => p.startsWith("/2.2/networks/100001/") && !p.endsWith("/permissions"))).toEqual(["/2.2/networks/100001/guestnetwork"]);
  });

  it("refuses to share a guest network with no name", async () => {
    const s = fakeEngine((f) => {
      const g = f.state.networks.get("100001")?.network.guest_network;
      if (g) g.name = "";
    });
    fake = s.fake;
    expect(await s.engine.execute("guest.share")).toMatchObject({ ok: false, error: { code: "eero_error" } });
  });

  it("never lets the password or payload reach the request log", async () => {
    const entries: RequestLogEntry[] = [];
    const s = fakeEngine(undefined, (e) => entries.push(e));
    fake = s.fake;
    const share = await ok(s.engine.execute<M.WifiShare>("guest.share"));
    await ok(s.engine.execute("guest.get"));
    expect(entries.length).toBeGreaterThan(0);
    const logged = JSON.stringify(entries);
    expect(share.password).toBe("fake-guest-pass-01");
    expect(logged).not.toContain("fake-guest-pass-01");
    expect(logged).not.toContain("WIFI:");
    // An error carries eero's message, never the credentials.
    const failed = fakeEngine((f) => {
      const g = f.state.networks.get("100001")?.network.guest_network;
      if (g) g.name = "";
    }, (e) => entries.push(e));
    const res = await failed.engine.execute("guest.share");
    await failed.fake.close();
    expect(JSON.stringify(res)).not.toContain("fake-guest-pass-01");
    expect(JSON.stringify(entries)).not.toContain("fake-guest-pass-01");
  });
});

describe("guest mapping", () => {
  it("reads security words in any case and treats missing fields as unknown", () => {
    expect(["wpa2", "WPA3", "wpa2_wpa3", "WPA2-WPA3", "wep", null].map(securityOf)).toEqual(["WPA2", "WPA3", "WPA2_WPA3", "WPA2_WPA3", null, null]);
    expect(guestSecurity(null, false, false)).toEqual({ "2.4": null, "5": null, "6": null });
    expect(guestSecurity({ band_2_4_ghz: "WPA2", band_5_ghz: "WPA2" }, false, true)).toEqual({ "2.4": "WPA2", "5": "WPA2", "6": "WPA3" });
    expect(guestSecurity({ band_2_4_ghz: "WPA2" }, true, true)).toEqual({ "2.4": null, "5": null, "6": null });
  });

  it("counts guests online only while the guest network is on, and keeps the name null when blank", () => {
    const devices = [
      { mac: "0a:1b:2c:00:00:01", is_guest: true, connected: true },
      { mac: "0a:1b:2c:00:00:02", is_guest: true, connected: false },
      { mac: "0a:1b:2c:00:00:03", is_guest: false, connected: true },
    ];
    const none = { "2.4": null, "5": null, "6": null } as const;
    expect(mapGuestNetwork({ enabled: true, name: "G", password: "x" }, devices, none)).toMatchObject({ online: 1, deviceIds: ["0a1b2c000001", "0a1b2c000002"] });
    expect(mapGuestNetwork({ enabled: false, name: " ", password: "" }, devices, none)).toMatchObject({ enabled: false, name: null, hasPassword: false, online: 0 });
    expect(mapGuestNetwork(null, [], none)).toEqual({ enabled: false, name: null, hasPassword: false, online: 0, deviceIds: [], security: none });
  });
});

// ---------------------------------------------------------------------------
// Page-load budget: the Guest page's queries, run at once as React mounts them

const GUEST_PAGE: [string, unknown?][] = [
  ["auth.status"],
  ["account.get"],
  ["network.list"],
  ["network.get"],
  ["guest.get"],
  ["guest.share"],
  ["device.list", { ssid: "guest" }],
  ["eero.list"],
  ["usage.get", { scope: "guest", range: "day" }],
  ["usage.get", { scope: "network", range: "day" }],
  ["usage.breakdown", { range: "day", by: "device" }],
];

async function load(engine: Engine, page: [string, unknown?][]) {
  const results = await Promise.all(page.map(([id, params]) => engine.execute(id, params)));
  const failed = results.flatMap((r, i) => (r.ok ? [] : [`${page[i]?.[0]}: ${r.error.code} ${r.error.message}`]));
  expect(failed).toEqual([]);
}

describe("Guest page load against the fake eero server", () => {
  it("stays well inside the request budget and reads each resource once", async () => {
    const f = createFakeEero();
    const backend = createEeroBackend({ secrets: secrets(f.signIn()), origin: f.origin, fetch: f.fetch, readShareMs: READ_SHARE_MS, limiter: new RateLimiter() });
    const engine = createEngine({ backend });
    const started = Date.now();
    await load(engine, GUEST_PAGE);
    expect(Date.now() - started).toBeLessThan(2_000);
    const reads = (path: string) => f.log.filter((e) => e.method === "GET" && e.path === path).length;
    expect(reads("/2.2/networks/100001")).toBe(1);
    expect(reads("/2.2/networks/100001/devices")).toBe(1);
    // guest.get and guest.share share one GET in flight; the engine still never caches guest.share.
    expect(reads("/2.2/networks/100001/guestnetwork")).toBe(1);
    // One guest on the fake network: one per-device usage read for the guest series.
    expect(f.log.filter((e) => e.path.includes("/data_usage/devices/")).length).toBe(1);
    expect(f.log.length).toBeLessThanOrEqual(16);
    await f.close();
  });
});
