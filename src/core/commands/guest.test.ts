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
import { runCli } from "../../cli/index";
import { memoryAudit } from "../audit";
import { passwordStrength, wifiEscape, wifiPayload } from "./guest";

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

// ---------------------------------------------------------------------------
// Writes (M4.6)

const NEW_PASS = "Quiet-Otter-Lantern-73";
type Err = { code: string; message: string; detail?: { issues?: { path: string; message: string }[] } };
const fail = async (p: Promise<{ ok: boolean; error?: Err }>) => {
  const r = await p;
  if (r.ok) throw new Error("expected an error");
  return r.error as Err;
};

describe("guest writes (demo)", () => {
  it("guest.disable needs confirm, names the guests it drops, then turns the network off", async () => {
    const engine = demoEngine();
    const ask = await fail(engine.execute("guest.disable", { networkId: MAPLE }));
    expect(ask.code).toBe("needs_confirm");
    expect(ask.message).toBe("1 guest is disconnected right away. Guests cannot join until it is turned back on.");
    // Nothing changed on the refusal.
    expect(await ok(engine.execute<M.GuestNetwork>("guest.get", { networkId: MAPLE }))).toMatchObject({ enabled: true, online: 1 });
    const off = await ok(engine.execute<M.GuestNetwork>("guest.disable", { networkId: MAPLE, confirm: true }));
    expect(off).toMatchObject({ enabled: false, online: 0 });
    expect(await ok(engine.execute<M.GuestNetwork>("guest.get", { networkId: MAPLE }))).toMatchObject({ enabled: false, online: 0 });
    // confirm: false is not a confirm.
    expect(await code(engine.execute("guest.disable", { networkId: MAPLE, confirm: false }))).toBe("needs_confirm");
  });

  it("guest.enable is a plain write that turns it back on", async () => {
    const engine = demoEngine();
    expect(await ok(engine.execute<M.GuestNetwork>("guest.enable", { networkId: MOM }))).toMatchObject({ enabled: true });
    expect(await ok(engine.execute<M.GuestNetwork>("guest.get", { networkId: MOM }))).toMatchObject({ enabled: true });
  });

  it("guest.rename renames after confirm and refuses the main network name", async () => {
    const engine = demoEngine();
    expect((await fail(engine.execute("guest.rename", { networkId: MAPLE, name: "Visitors" }))).message).toBe(
      '1 guest is disconnected right away. Guests join "Visitors" from now on.',
    );
    expect(await ok(engine.execute<M.GuestNetwork>("guest.rename", { networkId: MAPLE, name: "  Visitors ", confirm: true }))).toMatchObject({ name: "Visitors" });
    expect((await ok(engine.execute<M.WifiShare>("guest.share", { networkId: MAPLE }))).qr).toBe("WIFI:T:WPA;S:Visitors;P:lemon-harbor-42;;");
    // Same as the main SSID, in any case: bad_params on the name, before any confirm and with confirm.
    for (const params of [{ name: "maple street" }, { name: "Maple Street", confirm: true }]) {
      const err = await fail(engine.execute("guest.rename", { networkId: MAPLE, ...params }));
      expect(err.code).toBe("bad_params");
      expect(err.detail?.issues).toEqual([{ path: "name", message: "The guest network name must be different from your main network name." }]);
    }
    expect(await ok(engine.execute<M.GuestNetwork>("guest.get", { networkId: MAPLE }))).toMatchObject({ name: "Visitors" });
  });

  it("guest.password.set changes the password, and null makes the network open", async () => {
    const engine = demoEngine();
    const set = await ok(engine.execute<M.GuestNetwork>("guest.password.set", { networkId: MAPLE, password: NEW_PASS, confirm: true }));
    expect(set).toMatchObject({ hasPassword: true });
    expect(JSON.stringify(set)).not.toContain(NEW_PASS);
    expect((await ok(engine.execute<M.WifiShare>("guest.share", { networkId: MAPLE }))).password).toBe(NEW_PASS);

    const ask = await fail(engine.execute("guest.password.set", { networkId: MAPLE, password: null }));
    expect(ask).toMatchObject({ code: "needs_confirm", message: "1 guest is disconnected right away. With no password the guest network is open: anyone nearby can join." });
    const open = await ok(engine.execute<M.GuestNetwork>("guest.password.set", { networkId: MAPLE, password: null, confirm: true }));
    expect(open).toMatchObject({ hasPassword: false, security: { "2.4": null, "5": null, "6": null } });
    expect(await ok(engine.execute<M.WifiShare>("guest.share", { networkId: MAPLE }))).toMatchObject({ password: null, security: "nopass" });
    // A password again follows the main network's security.
    const back = await ok(engine.execute<M.GuestNetwork>("guest.password.set", { networkId: MAPLE, password: NEW_PASS, confirm: true }));
    expect(back.security["5"]).toBe("WPA2_WPA3");
  });

  it("rejects bad params with messages that never echo the password", async () => {
    const engine = demoEngine();
    const bad: [string, Record<string, unknown>][] = [
      ["guest.enable", { name: "x" }],
      ["guest.disable", { extra: 1 }],
      ["guest.rename", {}],
      ["guest.rename", { name: "   " }],
      ["guest.rename", { name: "x".repeat(33) }],
      ["guest.password.set", {}],
      ["guest.password.set", { password: "short7!" }],
      ["guest.password.set", { password: "x".repeat(64) }],
      ["guest.password.set", { password: "caf\u00e9-latte-42" }],
      ["guest.password.set", { password: 12345678 }],
    ];
    for (const [id, params] of bad) {
      const err = await fail(engine.execute(id, { networkId: MAPLE, confirm: true, ...params }));
      expect(err.code, `${id} ${JSON.stringify(params)}`).toBe("bad_params");
      if (typeof params.password === "string") expect(JSON.stringify(err)).not.toContain(params.password);
    }
    // Bounds pass.
    expect((await engine.execute("guest.password.set", { networkId: MAPLE, password: "a b c d ", confirm: true })).ok).toBe(true);
    expect((await engine.execute("guest.password.set", { networkId: MAPLE, password: "~".repeat(63), confirm: true })).ok).toBe(true);
    expect(await code(demoEngine("signed_out").execute("guest.disable", { confirm: true }))).toBe("not_signed_in");
  });

  it("registers enable as a write and the rest as disruptive, all invalidating guest and devices", () => {
    const infos = demoEngine().commands();
    const effect = (id: string) => infos.find((c) => c.id === id)?.effect;
    expect(["guest.enable", "guest.disable", "guest.rename", "guest.password.set"].map(effect)).toEqual(["write", "disruptive", "disruptive", "disruptive"]);
  });

  it("a write makes the next guest.get read fresh", async () => {
    const backend = createDemoBackend({ clock: () => NOW });
    let reads = 0;
    const counted: Backend = { ...backend, guest: { ...backend.guest, get: (net) => (reads++, backend.guest.get(net)) } };
    const engine = createEngine({ backend: counted, clock: () => NOW });
    await ok(engine.execute("guest.get"));
    await ok(engine.execute("guest.get"));
    expect(reads).toBe(1);
    await ok(engine.execute("guest.enable"));
    expect(await ok(engine.execute<M.GuestNetwork>("guest.get"))).toMatchObject({ enabled: true });
    expect(reads).toBe(2);
  });
});

describe("passwordStrength", () => {
  it("scores by length and character classes", () => {
    expect(passwordStrength("short")).toEqual({ score: 0, label: "Too short" });
    expect(passwordStrength("password")).toEqual({ score: 1, label: "Weak" });
    expect(passwordStrength("Password12")).toEqual({ score: 2, label: "Fair" });
    expect(passwordStrength("Maple-guest-2026")).toEqual({ score: 4, label: "Strong" });
    expect(passwordStrength("aB3dE6gH9jK2mN5p").label).toBe("Strong");
  });
});

describe("a new guest password stays out of logs", () => {
  it("is removed from the audit log, the CLI table and the CLI's confirm error", async () => {
    const audit = memoryAudit();
    const engine = createEngine({ backend: createDemoBackend({ clock: () => NOW }), surface: "cli", audit, clock: () => NOW });
    await engine.execute("guest.password.set", { password: NEW_PASS });
    await ok(engine.execute("guest.password.set", { password: NEW_PASS, confirm: true }));
    await engine.execute("guest.password.set", { password: "short" });
    expect(audit.entries.map((e) => [e.id, e.ok, e.code ?? null])).toEqual([
      ["guest.password.set", false, "needs_confirm"],
      ["guest.password.set", true, null],
      ["guest.password.set", false, "bad_params"],
    ]);
    expect(audit.entries.every((e) => (e.params as { password?: unknown }).password === "[removed]")).toBe(true);
    expect(JSON.stringify(audit.entries)).not.toContain(NEW_PASS);

    // CLI table and JSON output of the write, and the needs_confirm line: the result has no password.
    for (const argv of [
      ["--demo", "--format", "table", "run", "guest.password.set", "--params", JSON.stringify({ password: NEW_PASS })],
      ["--demo", "--format", "table", "run", "guest.password.set", "--confirm", "--params", JSON.stringify({ password: NEW_PASS })],
      ["--demo", "--format", "json", "run", "guest.password.set", "--confirm", "--params", JSON.stringify({ password: NEW_PASS })],
      ["--demo", "--format", "table", "run", "guest.share"],
    ]) {
      let out = "";
      await runCli(argv, { stdout: (s) => void (out += s), stderr: (s) => void (out += s) });
      expect(out, argv.join(" ")).not.toContain(NEW_PASS);
      expect(out).not.toContain("lemon-harbor-42");
    }
    // --reveal shows a sensitive read in a table; the write result never had one to show.
    let revealed = "";
    await runCli(["--demo", "--format", "table", "run", "guest.share", "--reveal"], { stdout: (s) => void (revealed += s), stderr: () => {} });
    expect(revealed).toContain("lemon-harbor-42");
  });
});

describe("guest writes (fake eero server)", () => {
  let fake: FakeEero | null = null;
  afterEach(async () => {
    await fake?.close();
    fake = null;
  });

  it("disable and enable send PUT {net}/guestnetwork with a form enabled field", async () => {
    const s = fakeEngine();
    fake = s.fake;
    expect(await code(s.engine.execute("guest.disable"))).toBe("needs_confirm");
    expect(s.fake.writes).toHaveLength(0);
    expect(await ok(s.engine.execute<M.GuestNetwork>("guest.disable", { confirm: true }))).toMatchObject({ enabled: false, online: 0 });
    expect(await ok(s.engine.execute<M.GuestNetwork>("guest.enable"))).toMatchObject({ enabled: true, online: 1 });
    expect(s.fake.writes.map((w) => [w.method, w.path, w.encoding, w.body])).toEqual([
      ["PUT", "/2.2/networks/100001/guestnetwork", "form", { enabled: "false" }],
      ["PUT", "/2.2/networks/100001/guestnetwork", "form", { enabled: "true" }],
    ]);
    expect(s.fake.writes.every((w) => w.contentType === "application/x-www-form-urlencoded" && w.status === 200)).toBe(true);
  });

  it("rename sends the name with the current enabled state and refuses the main SSID without a request", async () => {
    const s = fakeEngine((f) => {
      const g = f.state.networks.get("100001")?.network.guest_network;
      if (g) g.enabled = false;
    });
    fake = s.fake;
    expect(await ok(s.engine.execute<M.GuestNetwork>("guest.rename", { name: "Cafe; Back Room", confirm: true }))).toMatchObject({ name: "Cafe; Back Room", enabled: false });
    expect(s.fake.writes.map((w) => [w.method, w.route, w.body, w.rawBody])).toEqual([
      ["PUT", "/networks/100001/guestnetwork", { enabled: "false", name: "Cafe; Back Room" }, "enabled=false&name=Cafe%3B+Back+Room"],
    ]);
    expect(await code(s.engine.execute("guest.rename", { name: "MAPLE STREET", confirm: true }))).toBe("bad_params");
    expect(s.fake.writes).toHaveLength(1);
  });

  it("password set sends PUT {net}/guestnetwork/password, null sends DELETE with no body, and the next reveal sees it", async () => {
    const entries: RequestLogEntry[] = [];
    const s = fakeEngine(undefined, (e) => entries.push(e));
    fake = s.fake;
    await ok(s.engine.execute("guest.share"));
    expect(await ok(s.engine.execute<M.GuestNetwork>("guest.password.set", { password: NEW_PASS, confirm: true }))).toMatchObject({ hasPassword: true });
    expect((await ok(s.engine.execute<M.WifiShare>("guest.share"))).password).toBe(NEW_PASS);
    expect(await ok(s.engine.execute<M.GuestNetwork>("guest.password.set", { password: null, confirm: true }))).toMatchObject({
      hasPassword: false,
      security: { "2.4": null, "5": null, "6": null },
    });
    expect((await ok(s.engine.execute<M.WifiShare>("guest.share"))).qr).toBe("WIFI:T:nopass;S:Maple Street Guest;;");
    expect(s.fake.writes.map((w) => [w.method, w.path, w.encoding, w.body, w.rawBody])).toEqual([
      ["PUT", "/2.2/networks/100001/guestnetwork/password", "form", { password: NEW_PASS }, `password=${NEW_PASS}`],
      ["DELETE", "/2.2/networks/100001/guestnetwork/password", "none", {}, ""],
    ]);
    // The client's request log never holds the new password.
    expect(JSON.stringify(entries)).not.toContain(NEW_PASS);
  });

  it("an eero error is an eero_error, is not retried, and leaves the guest network as it was", async () => {
    const s = fakeEngine();
    fake = s.fake;
    s.fake.scenarios.fail(500, "error.server", { method: "PUT", path: "/guestnetwork/password" });
    expect(await code(s.engine.execute("guest.password.set", { password: NEW_PASS, confirm: true }))).toBe("eero_error");
    expect(s.fake.writes).toHaveLength(1);
    expect((await ok(s.engine.execute<M.WifiShare>("guest.share"))).password).toBe("fake-guest-pass-01");
  });
});
