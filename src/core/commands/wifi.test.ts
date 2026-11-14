import { describe, expect, it } from "vitest";
import { createFakeEero, type FakeEero } from "../../../test/fake-eero/server";
import type { AuthState, Backend, SecretStore } from "../backend";
import { createDemoBackend } from "../demo";
import { READ_SHARE_MS, type RequestLogEntry } from "../eero/client";
import { createEeroBackend } from "../eero/backend";
import type { RawEeroFull } from "../eero/map/eero";
import { mapHide5g, mapSecurity, mapWifi } from "../eero/map/wifi";
import { createEngine } from "../engine";
import type * as M from "../model";
import { type GeneratedPassword, generatePassword, PASSWORD_ALPHABET, type WifiPassword } from "./wifi";

const NOW = Date.parse("2026-11-12T22:41:00Z");
const MAPLE = "4821907";
const LAKE = "5130264";

type Result<R> = { ok: true; result: R } | { ok: false; error: { code: string; message: string } };
async function ok<R>(p: Promise<Result<R>>): Promise<R> {
  const r = await p;
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.result;
}
const code = async (p: Promise<{ ok: boolean; error?: { code: string } }>) => (await p).error?.code;

const demoEngine = (scenario?: "signed_out") => createEngine({ backend: createDemoBackend({ clock: () => NOW, scenario }), clock: () => NOW });

describe("wifi.get (demo)", () => {
  it("returns the SSID, security per band and the bands with their clients, without a password", async () => {
    const engine = demoEngine();
    const w = await ok(engine.execute<M.WifiSettings>("wifi.get", { networkId: MAPLE }));
    expect(w).toMatchObject({ ssid: "Maple Street", hasPassword: true, security: { "2.4": "WPA2_WPA3", "5": "WPA2_WPA3", "6": "WPA3" }, hide5g: { active: false, expiresAt: null } });
    expect(w.bands.map((b) => b.band)).toEqual(["2.4", "5", "6"]);
    expect(w.bands.reduce((n, b) => n + b.clients, 0)).toBe(w.wirelessClients);
    expect(w.wpa2OnlyDevices).toHaveLength(3);
    expect(JSON.stringify(w)).not.toMatch(/password"\s*:/);
    expect(JSON.stringify(w)).not.toContain("maple-cedar-orbit-27");
  });

  it("leaves out a band no eero has (Lake Cabin has no 6 GHz radio)", async () => {
    const w = await ok(demoEngine().execute<M.WifiSettings>("wifi.get", { networkId: LAKE }));
    expect(w.bands.map((b) => b.band)).not.toContain("6");
    expect(w.security["6"]).toBeNull();
  });

  it("rejects bad params and needs a session", async () => {
    const engine = demoEngine();
    expect(await code(engine.execute("wifi.get", { extra: 1 }))).toBe("bad_params");
    expect(await code(engine.execute("wifi.get", { networkId: "Nowhere" }))).toBe("bad_params");
    expect(await code(demoEngine("signed_out").execute("wifi.get"))).toBe("not_signed_in");
  });

  it("is a cached query on the network poll", () => {
    const info = demoEngine().commands().find((c) => c.id === "wifi.get");
    expect(info).toMatchObject({ effect: "query", scope: "network", poll: 60, sensitive: false });
  });
});

describe("wifi.password.get and wifi.share (demo)", () => {
  it("reveals the password only through the two sensitive commands", async () => {
    const engine = demoEngine();
    expect(await ok(engine.execute<WifiPassword>("wifi.password.get", { networkId: MAPLE }))).toEqual({ ssid: "Maple Street", password: "maple-cedar-orbit-27" });
    expect(await ok(engine.execute<M.WifiShare>("wifi.share", { networkId: MAPLE }))).toEqual({
      ssid: "Maple Street",
      password: "maple-cedar-orbit-27",
      security: "WPA",
      qr: "WIFI:T:WPA;S:Maple Street;P:maple-cedar-orbit-27;;",
    });
    for (const id of ["wifi.password.get", "wifi.share"]) {
      expect(engine.commands().find((c) => c.id === id)).toMatchObject({ effect: "query", sensitive: true });
    }
  });

  it("rejects bad params and needs a session", async () => {
    for (const id of ["wifi.password.get", "wifi.share"]) {
      expect(await code(demoEngine().execute(id, { password: "x" }))).toBe("bad_params");
      expect(await code(demoEngine().execute(id, { networkId: "Nowhere" }))).toBe("bad_params");
      expect(await code(demoEngine("signed_out").execute(id))).toBe("not_signed_in");
    }
  });
});

// ---------------------------------------------------------------------------
// Real eero backend against the fake eero server

const signedIn: AuthState = { signedIn: true, pending: false, login: null, storage: "memory" };
const secrets = (token: string): SecretStore => ({ load: async () => token, save: async () => "memory", clear: async () => {}, storage: async () => "memory" });

function fakeEngine(prepare?: (fake: FakeEero) => void, readShareMs?: number) {
  const fake = createFakeEero({ now: () => NOW });
  prepare?.(fake);
  const logs: RequestLogEntry[] = [];
  const eero = createEeroBackend({ secrets: secrets(fake.signIn()), origin: fake.origin, fetch: fake.fetch, readShareMs, onLog: (e) => logs.push(e) });
  const backend: Backend = { ...eero, auth: { ...eero.auth, status: async () => signedIn } };
  return { fake, logs, engine: createEngine({ backend, clock: () => NOW }) };
}

describe("wifi.get (fake eero server)", () => {
  it("maps wpa3_per_band, 6 GHz as WPA3, and the bands from every eero's radios", async () => {
    const { engine, fake } = fakeEngine((fake) => {
      const eeros = fake.state.networks.get("100001")?.eeros ?? [];
      // As the real list sends them: 5 GHz low and high are two entries, and both channels count.
      (eeros[0] as RawEeroFull).radio_channel_stats = { band_2_4GHz: { channel: 6, channel_width: "20MHz" }, band_5GHz_low: { channel: 36, channel_width: "80MHz" }, band_5GHz_high: { channel: 149, channel_width: "160MHz" } };
      (eeros[1] as RawEeroFull).radio_channel_stats = { band_2_4GHz: { channel: 11, channel_width: "20MHz" } };
    });
    const w = await ok(engine.execute<M.WifiSettings>("wifi.get", { networkId: "100001" }));
    expect(w.ssid).toBe("Maple Street");
    expect(w.hasPassword).toBe(true);
    expect(w.security["2.4"]).toBe("WPA2_WPA3");
    expect(w.security["5"]).toBe("WPA2_WPA3");
    expect(w.security["6"]).toBe("WPA3");
    expect(w.bands.map(({ band, on, widthsMhz, channels }) => ({ band, on, widthsMhz, channels }))).toEqual([
      { band: "2.4", on: true, widthsMhz: [20], channels: [6, 11] },
      { band: "5", on: true, widthsMhz: [80, 160], channels: [36, 149] },
      { band: "6", on: true, widthsMhz: [], channels: [] },
    ]);
    expect(w.hide5g).toEqual({ active: false, expiresAt: null });
    expect(w.wirelessClients).toBe(w.bands.reduce((n, b) => n + b.clients, 0));
    const paths = fake.log.map((l) => l.path);
    expect(paths).toContain("/2.2/networks/100001/wpa3_per_band");
    expect(paths).not.toContain("/2.2/networks/100001/password");
    expect(JSON.stringify(w)).not.toContain("fake-main-pass-01");
  });

  it("normalises the case of wpa3_per_band values and falls back to the wpa3 switch when eero sends no per band modes", async () => {
    const lower = fakeEngine((fake) => {
      const n = fake.state.networks.get("100001");
      if (n) n.wpa3PerBand = { band_2_4_ghz: "wpa2", band_5_ghz: "Wpa3" };
    });
    expect((await ok(lower.engine.execute<M.WifiSettings>("wifi.get", { networkId: "100001" }))).security).toMatchObject({ "2.4": "WPA2", "5": "WPA3" });

    const old = fakeEngine((fake) => {
      const n = fake.state.networks.get("100001");
      if (!n) return;
      (n as { wpa3PerBand: unknown }).wpa3PerBand = null;
      n.network.wpa3 = true;
    });
    expect((await ok(old.engine.execute<M.WifiSettings>("wifi.get", { networkId: "100001" }))).security).toMatchObject({ "2.4": "WPA2_WPA3", "5": "WPA2_WPA3" });
  });

  it("maps the 2.4 GHz only flag and its expiry from temporary_flags", async () => {
    const { engine } = fakeEngine((fake) => {
      const n = fake.state.networks.get("100001");
      if (n) n.network.temporary_flags = { hide_5g: { value: true, expires_on: "2099-11-12T23:41:00Z" } };
    });
    expect((await ok(engine.execute<M.WifiSettings>("wifi.get", { networkId: "100001" }))).hide5g).toEqual({ active: true, expiresAt: "2099-11-12T23:41:00.000Z" });
  });

  it("reads the password from GET {net} only for the sensitive commands, and none of it reaches the request log", async () => {
    const { engine, logs } = fakeEngine();
    await ok(engine.execute("wifi.get", { networkId: "100001" }));
    const pw = await ok(engine.execute<WifiPassword>("wifi.password.get", { networkId: "100001" }));
    expect(pw).toEqual({ ssid: "Maple Street", password: "fake-main-pass-01" });
    const share = await ok(engine.execute<M.WifiShare>("wifi.share", { networkId: "100001" }));
    expect(share.qr).toBe("WIFI:T:WPA;S:Maple Street;P:fake-main-pass-01;;");
    expect(logs.length).toBeGreaterThan(0);
    expect(JSON.stringify(logs)).not.toContain("fake-main-pass-01");
  });

  it("never caches a sensitive result: each reveal reads eero again", async () => {
    // No shared reads, so only the engine cache could answer a second call.
    const { engine, fake } = fakeEngine(undefined, 0);
    const reads = () => fake.log.filter((l) => l.path === "/2.2/networks/100001").length;
    await ok(engine.execute("wifi.share", { networkId: "100001" }));
    const after = reads();
    fake.state.networks.get("100001")!.network.password = "fake-main-pass-02";
    const again = await ok(engine.execute<M.WifiShare>("wifi.share", { networkId: "100001" }));
    expect(reads()).toBeGreaterThan(after);
    expect(again.password).toBe("fake-main-pass-02");
  });
});

describe("wifi mapping", () => {
  it("shows one band when every eero has one radio, and a band off when its eeros are offline", () => {
    const one = mapWifi({ name: "Solo", wpa3: false }, null, [{ bands: ["band_2_4GHz"], status: "green" }], []);
    expect(one.bands.map((b) => b.band)).toEqual(["2.4"]);
    expect(one.security).toEqual({ "2.4": "WPA2", "5": null, "6": null });
    const down = mapWifi({ name: "Down" }, { band_2_4_ghz: "WPA2", band_5_ghz: "WPA2" }, [{ bands: ["band_2_4GHz", "band_5GHz"], status: "red", heartbeat_ok: false, state: "OFFLINE" }], []);
    expect(down.bands.every((b) => !b.on)).toBe(true);
  });

  it("flags devices that joined a hybrid band with WPA2 only", () => {
    const dev = (id: string, band: M.Band, security: string | null) => ({ id, connected: true, band, ssid: "main", security }) as M.Device;
    const w = mapWifi({ name: "Mix" }, { band_2_4_ghz: "WPA2_WPA3", band_5_ghz: "WPA2" }, [{ bands: ["band_2_4GHz", "band_5GHz"] }], [
      dev("a", "2.4", "WPA2 Personal"),
      dev("b", "2.4", "WPA3 Personal (SAE)"),
      dev("c", "5", "WPA2 Personal"),
      dev("d", "wired", null),
    ]);
    expect(w.wpa2OnlyDevices).toEqual(["a"]);
    expect(w.wirelessClients).toBe(3);
  });

  it("reads security words in any case and spelling", () => {
    expect(["WPA2", "wpa2_wpa3", "WPA2/WPA3", "wpa3", "SAE", "bogus", null].map(mapSecurity)).toEqual(["WPA2", "WPA2_WPA3", "WPA2_WPA3", "WPA3", "WPA3", null, null]);
  });

  it("reads hide_5g as an object or a bare bool, and an expired flag as off", () => {
    expect(mapHide5g({}, NOW)).toEqual({ active: false, expiresAt: null });
    expect(mapHide5g(undefined, NOW)).toEqual({ active: false, expiresAt: null });
    expect(mapHide5g({ hide_5g: true }, NOW)).toEqual({ active: true, expiresAt: null });
    expect(mapHide5g({ hide_5g: { value: true, expires_on: "2026-11-12T22:00:00Z" } }, NOW)).toEqual({ active: false, expiresAt: null });
    expect(mapHide5g({ hide_5g: { value: false, expires_on: "2026-11-13T22:00:00Z" } }, NOW)).toEqual({ active: false, expiresAt: null });
  });
});

// ---------------------------------------------------------------------------
// Page-load budget: the Wi-Fi page's queries (shell plus page) through the real
// client and its shared reads. The reveal (wifi.share) is on demand and not part of a load.

const WIFI_PAGE: [string, unknown?][] = [
  ["auth.status"],
  ["account.get"],
  ["network.list"],
  ["wifi.get"],
  ["network.get"],
  ["network.health"],
  ["device.list", {}],
];

describe("Wi-Fi page load (fake eero server)", () => {
  it("reads each endpoint once, stays within budget, and never reads the password unasked", async () => {
    const fake = createFakeEero();
    const token = fake.signIn();
    const eero = createEeroBackend({ secrets: secrets(token), origin: fake.origin, fetch: fake.fetch, readShareMs: READ_SHARE_MS });
    const engine = createEngine({ backend: eero });
    try {
      const results = await Promise.all(WIFI_PAGE.map(([id, params]) => engine.execute(id, params)));
      expect(results.flatMap((r, i) => (r.ok ? [] : [`${WIFI_PAGE[i]?.[0]}: ${r.error.code}`]))).toEqual([]);
      const gets = (path: string) => fake.log.filter((l) => l.method === "GET" && l.path === path).length;
      expect(gets("/2.2/networks/100001")).toBe(1);
      expect(gets("/2.2/networks/100001/eeros")).toBe(1);
      expect(gets("/2.2/networks/100001/devices")).toBe(1);
      expect(gets("/2.2/networks/100001/wpa3_per_band")).toBe(1);
      const load = fake.log.length;
      expect(load).toBeLessThanOrEqual(10);
      expect(JSON.stringify(results.filter((r) => r.ok))).not.toContain("fake-main-pass-01");

      // Show code: one more request at most, and only then is the password read.
      const shown = await engine.execute<M.WifiShare>("wifi.share");
      expect(shown.ok).toBe(true);
      expect(fake.log.length - load).toBeLessThanOrEqual(1);
    } finally {
      await fake.close();
    }
  });
});

describe("wifi.password.generate", () => {
  const LOOK_ALIKES = /[0O1Il]/;

  it("returns 16 characters from the alphabet by default, with upper, lower and a digit", async () => {
    const engine = demoEngine();
    for (let i = 0; i < 50; i++) {
      const { password } = await ok(engine.execute<GeneratedPassword>("wifi.password.generate", {}));
      expect(password).toHaveLength(16);
      expect([...password].every((c) => PASSWORD_ALPHABET.includes(c))).toBe(true);
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/\d/);
      expect(password).not.toMatch(LOOK_ALIKES);
    }
  });

  it("keeps look-alike characters out of the alphabet", () => {
    expect(PASSWORD_ALPHABET).not.toMatch(LOOK_ALIKES);
    expect(new Set(PASSWORD_ALPHABET).size).toBe(PASSWORD_ALPHABET.length);
    expect(PASSWORD_ALPHABET).toHaveLength(55);
  });

  it("honours length from 12 to 63 and gives a new password each time", async () => {
    const engine = demoEngine();
    expect((await ok(engine.execute<GeneratedPassword>("wifi.password.generate", { length: 12 }))).password).toHaveLength(12);
    expect((await ok(engine.execute<GeneratedPassword>("wifi.password.generate", { length: 63 }))).password).toHaveLength(63);
    const seen = new Set(Array.from({ length: 20 }, () => generatePassword()));
    expect(seen.size).toBe(20);
  });

  it("uses every character of the alphabet over many draws", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 400; i++) for (const c of generatePassword(63)) counts.set(c, (counts.get(c) ?? 0) + 1);
    expect(counts.size).toBe(PASSWORD_ALPHABET.length);
  });

  it("rejects a bad length", async () => {
    const engine = demoEngine();
    for (const params of [{ length: 11 }, { length: 64 }, { length: 16.5 }, { length: "16" }, { extra: 1 }]) {
      expect(await code(engine.execute("wifi.password.generate", params)), JSON.stringify(params)).toBe("bad_params");
    }
  });

  it("is an app-scoped query, not sensitive, not cached, and works signed out", async () => {
    const info = demoEngine().commands().find((c) => c.id === "wifi.password.generate");
    expect(info).toMatchObject({ effect: "query", scope: "app", sensitive: false });
    const engine = demoEngine();
    const [a, b] = [await ok(engine.execute<GeneratedPassword>("wifi.password.generate")), await ok(engine.execute<GeneratedPassword>("wifi.password.generate"))];
    expect(a.password).not.toBe(b.password);
    expect((await ok(demoEngine("signed_out").execute<GeneratedPassword>("wifi.password.generate"))).password).toHaveLength(16);
  });
});

describe("fake eero server records writes", () => {
  it("records a PUT with a form body and a /2.3/ JSON body, method, path, version and body", async () => {
    const fake = createFakeEero({ now: () => NOW });
    const token = fake.signIn();
    const headers = (type: string) => ({ "content-type": type, cookie: `s=${token}` });
    await fake.fetch(`${fake.origin}/2.2/eeros/9001/led`, { method: "PUT", headers: headers("application/x-www-form-urlencoded"), body: "led_on=false&led_brightness=30" });
    await fake.fetch(`${fake.origin}/2.3/networks/100001/devices/0a1b2c000001`, { method: "PUT", headers: headers("application/json; charset=utf-8"), body: JSON.stringify({ paused: true }) });
    await fake.fetch(`${fake.origin}/2.2/networks/100001/reboot`, { method: "POST", headers: headers("application/json"), body: '""' });
    await fake.fetch(`${fake.origin}/2.2/networks/100001/devices`, { headers: headers("application/json") });

    expect(fake.writes).toHaveLength(3);
    expect(fake.writes[0]).toMatchObject({ method: "PUT", path: "/2.2/eeros/9001/led", version: "2.2", route: "/eeros/9001/led", contentType: "application/x-www-form-urlencoded", encoding: "form", body: { led_on: "false", led_brightness: "30" } });
    expect(fake.writes[1]).toMatchObject({ method: "PUT", path: "/2.3/networks/100001/devices/0a1b2c000001", version: "2.3", route: "/networks/100001/devices/0a1b2c000001", contentType: "application/json", encoding: "json", body: { paused: true }, rawBody: '{"paused":true}' });
    expect(fake.writes[2]).toMatchObject({ method: "POST", version: "2.2", encoding: "empty", body: {} });
    // Recorded whatever answers: these routes come with each wave-2 story, so today they are 404s.
    expect(fake.writes.map((w) => w.status)).toEqual([404, 404, 404]);
    expect(fake.log).toHaveLength(4);
  });

  it("lets a write route change the state, so the next GET shows it", async () => {
    // How a wave-2 story adds its route: match the version, change the network in place.
    const fake = createFakeEero({
      now: () => NOW,
      routes: [
        {
          method: "PUT",
          path: "/networks/:net/devices/:mac",
          versions: ["2.3"],
          handle: ({ req, params, network }) => {
            const d = network(params.net ?? "").devices.find((x) => (x.mac ?? "").replace(/:/g, "") === params.mac);
            if (!d) return { status: 404, error: "error.device.not.found" };
            if (typeof req.body.paused === "boolean") d.paused = req.body.paused;
            return { data: d };
          },
        },
      ],
    });
    const token = fake.signIn();
    const headers = { "content-type": "application/json", cookie: `s=${token}` };
    const before = (await (await fake.fetch(`${fake.origin}/2.2/networks/100001/devices/0a1b2c000001`, { headers })).json()) as { data: { paused: boolean } };
    expect(before.data.paused).toBe(false);
    const put = await fake.fetch(`${fake.origin}/2.3/networks/100001/devices/0a1b2c000001`, { method: "PUT", headers, body: JSON.stringify({ paused: true }) });
    expect(put.status).toBe(200);
    const after = (await (await fake.fetch(`${fake.origin}/2.2/networks/100001/devices/0a1b2c000001`, { headers })).json()) as { data: { paused: boolean } };
    expect(after.data.paused).toBe(true);
    // This route is /2.3/ only, so the same PUT on /2.2/ is a 404 here (eero answers 200 and drops it); either way the version is recorded.
    await fake.fetch(`${fake.origin}/2.2/networks/100001/devices/0a1b2c000001`, { method: "PUT", headers, body: JSON.stringify({ paused: false }) });
    expect(fake.writes.map((w) => [w.version, w.status])).toEqual([["2.3", 200], ["2.2", 404]]);
  });

});
