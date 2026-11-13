import { describe, expect, it } from "vitest";
import { createFakeEero, type FakeEero } from "../../../test/fake-eero/server";
import type { AuthState, Backend, SecretStore } from "../backend";
import { createDemoBackend } from "../demo";
import { createEeroBackend } from "../eero/backend";
import { mapInternet, mapSpeedTests } from "../eero/map/network";
import { createEngine, memorySettings } from "../engine";
import type * as M from "../model";
import type { SettingsStore } from "../spec";
import { internetText, speedRating } from "./internet";

const NOW = Date.parse("2026-11-12T22:41:00Z");
const HOUR = 3_600_000;
const MAPLE = "4821907";
const LAKE = "5130264";

async function ok<R>(p: Promise<{ ok: true; result: R } | { ok: false; error: { code: string; message: string } }>): Promise<R> {
  const r = await p;
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.result;
}

const code = async (p: Promise<{ ok: boolean; error?: { code: string } }>) => (await p).error?.code;

const demoEngine = (opts: { settings?: SettingsStore; scenario?: "signed_out" } = {}) =>
  createEngine({ backend: createDemoBackend({ clock: () => NOW, scenario: opts.scenario }), clock: () => NOW, settings: opts.settings });

// ---------------------------------------------------------------------------
// Demo backend through the engine

describe("internet commands (demo)", () => {
  it("internet.get adds the plan from settings and rates the last test", async () => {
    const none = await ok(demoEngine().execute<M.Internet>("internet.get", { networkId: MAPLE }));
    expect(none).toMatchObject({ planMbps: null, isp: { name: "Ziply Fiber" }, lastSpeedTest: { downMbps: 942, upMbps: 918, rating: null } });

    const settings = memorySettings({ planMbps: { [MAPLE]: { down: 1200, up: 1200 } } });
    const rated = await ok(demoEngine({ settings }).execute<M.Internet>("internet.get", { networkId: MAPLE }));
    expect(rated.planMbps).toEqual({ down: 1200, up: 1200 });
    expect(rated.lastSpeedTest?.rating).toBe("great");
  });

  it("internet.get format text is the Copy details block", async () => {
    const text = await ok(demoEngine().execute<string>("internet.get", { networkId: MAPLE, format: "text" }));
    expect(typeof text).toBe("string");
    expect(text).toMatch(/^Internet provider\nISP: Ziply Fiber\n/);
    expect(text).toContain("\nAddressing\n");
    expect(text).toContain("Plan: -");
  });

  it("speedtest.history returns the week newest first with 7-day averages", async () => {
    const engine = demoEngine({ settings: memorySettings({ planMbps: { [MAPLE]: { down: 1000, up: 1000 } } }) });
    const week = await ok(engine.execute<M.SpeedHistory>("speedtest.history", { networkId: MAPLE }));
    expect(week.tests).toHaveLength(15);
    expect([...week.tests].sort((a, b) => b.at.localeCompare(a.at))).toEqual(week.tests);
    expect(week.tests.every((t) => Date.parse(t.at) >= NOW - 7 * 24 * HOUR)).toBe(true);
    expect(week.tests.find((t) => t.downMbps === 702)?.rating).toBe("below_plan");
    expect(week.tests[0]?.rating).toBe("great");
    const avg = (xs: number[]) => Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10;
    expect(week.avg7d).toEqual({ downMbps: avg(week.tests.map((t) => t.downMbps ?? 0)), upMbps: avg(week.tests.map((t) => t.upMbps ?? 0)) });

    const day = await ok(engine.execute<M.SpeedHistory>("speedtest.history", { networkId: MAPLE, range: "day", limit: 1 }));
    expect(day.tests).toHaveLength(1);
    expect(day.tests[0]).toEqual(week.tests[0]);
    expect(day.avg7d).toEqual(week.avg7d);
  });

  it("speedtest.history format csv is the Export CSV file", async () => {
    const csv = await ok(demoEngine().execute<string>("speedtest.history", { networkId: MAPLE, range: "day", format: "csv" }));
    const lines = csv.trimEnd().split("\r\n");
    expect(lines[0]).toBe("When,Download (Mbps),Upload (Mbps),Verdict");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toMatch(/^2026-11-12T20:41:00\.000Z,942,918,$/);
  });

  it("an offline network still answers", async () => {
    const engine = demoEngine();
    expect((await ok(engine.execute<M.Internet>("internet.get", { networkId: LAKE }))).status).toBe("offline");
    expect(await ok(engine.execute<M.SpeedHistory>("speedtest.history", { networkId: LAKE, range: "day" }))).toMatchObject({ tests: [] });
  });

  it("rejects bad params", async () => {
    const engine = demoEngine();
    expect(await code(engine.execute("internet.get", { format: "csv" }))).toBe("bad_params");
    expect(await code(engine.execute("internet.get", { extra: 1 }))).toBe("bad_params");
    expect(await code(engine.execute("internet.get", { networkId: "Nowhere" }))).toBe("bad_params");
    expect(await code(engine.execute("speedtest.history", { range: "month" }))).toBe("bad_params");
    expect(await code(engine.execute("speedtest.history", { limit: 0 }))).toBe("bad_params");
    expect(await code(engine.execute("speedtest.history", { limit: 201 }))).toBe("bad_params");
    expect(await code(engine.execute("speedtest.history", { limit: 1.5 }))).toBe("bad_params");
    expect(await code(engine.execute("speedtest.history", { format: "text" }))).toBe("bad_params");
  });

  it("needs a session", async () => {
    const engine = demoEngine({ scenario: "signed_out" });
    expect(await code(engine.execute("internet.get"))).toBe("not_signed_in");
    expect(await code(engine.execute("speedtest.history"))).toBe("not_signed_in");
  });
});

describe("speed ratings", () => {
  it("is great at 75% of plan in every measured direction", () => {
    const plan = { down: 1000, up: 100 };
    expect(speedRating({ downMbps: 750, upMbps: 75 }, plan)).toBe("great");
    expect(speedRating({ downMbps: 749, upMbps: 100 }, plan)).toBe("below_plan");
    expect(speedRating({ downMbps: 900, upMbps: 50 }, plan)).toBe("below_plan");
    expect(speedRating({ downMbps: 900, upMbps: null }, plan)).toBe("great");
    expect(speedRating({ downMbps: null, upMbps: null }, plan)).toBeNull();
    expect(speedRating({ downMbps: 900, upMbps: 90 }, null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Real eero backend against the fake eero server

const signedIn: AuthState = { signedIn: true, pending: false, login: null, storage: "memory" };

function secretsWith(token: string): SecretStore {
  let t: string | null = token;
  return {
    load: async () => t,
    save: async (next) => {
      t = next;
      return "memory";
    },
    clear: async () => {
      t = null;
    },
    storage: async () => "memory",
  };
}

/** The eero backend on the fake server. Auth is stubbed until the auth area lands (M1.9). */
function fakeEngine(opts: { settings?: SettingsStore; prepare?: (fake: FakeEero) => void } = {}) {
  const fake = createFakeEero({ now: () => NOW });
  opts.prepare?.(fake);
  const eero = createEeroBackend({ secrets: secretsWith(fake.signIn()), origin: fake.origin, fetch: fake.fetch });
  const backend: Backend = { ...eero, auth: { ...eero.auth, status: async () => signedIn } };
  return { fake, engine: createEngine({ backend, clock: () => NOW, settings: opts.settings }) };
}

describe("internet commands (fake eero server)", () => {
  it("internet.get maps the connection from GET {net}", async () => {
    const { engine } = fakeEngine({
      prepare: (fake) => {
        const gw = fake.state.networks.get("100001")?.eeros[0] as Record<string, unknown>;
        gw.ethernet_status = { statuses: [{ isWanPort: false, speed: "P1000" }, { isWanPort: true, speed: "P2500" }] };
      },
      settings: memorySettings({ planMbps: { "100001": { down: 1000, up: 50 } } }),
    });
    const internet = await ok(engine.execute<M.Internet>("internet.get", { networkId: "100001" }));
    expect(internet).toEqual({
      status: "online",
      isp: { name: "Example Fiber", org: "Example Fiber", asn: null, city: "Springfield", region: "NY", country: "US" },
      publicIpv4: "203.0.113.9",
      publicIpv6: null,
      ipv6Prefix: null,
      wanType: "dhcp",
      ispGateway: "203.0.113.1",
      vlan: null,
      dnsInUse: ["203.0.113.53"],
      dnsMode: "automatic",
      doubleNat: false,
      gateway: { eeroId: "500001", location: "Living Room", model: "eero Max 7", wanPortSpeedMbps: 2500 },
      planMbps: { down: 1000, up: 50 },
      lastSpeedTest: { at: "2026-11-12T03:00:00Z", downMbps: 912.4, upMbps: 40.2, rating: "great" },
    });
  });

  it("speedtest.history sends the window and limit, and maps rows newest first", async () => {
    const { engine, fake } = fakeEngine({ settings: memorySettings({ planMbps: { "100001": { down: 1000, up: 100 } } }) });
    const history = await ok(engine.execute<M.SpeedHistory>("speedtest.history", { networkId: "100001" }));
    expect(history.tests).toEqual([
      { at: "2026-11-12T03:00:00Z", downMbps: 912.4, upMbps: 40.2, rating: "below_plan" },
      { at: "2026-11-11T03:00:00Z", downMbps: 884.1, upMbps: 39.7, rating: "below_plan" },
      { at: "2026-11-10T03:00:00Z", downMbps: 901.9, upMbps: 41, rating: "below_plan" },
    ]);
    expect(history.avg7d).toEqual({ downMbps: 899.5, upMbps: 40.3 });
    const req = fake.log.find((l) => l.path === "/2.2/networks/100001/speedtest");
    const q = new URLSearchParams(req?.query ?? "");
    expect([q.get("startTime"), q.get("endTime"), q.get("limit")]).toEqual(["2026-11-05T22:41:00.000Z", "2026-11-12T22:41:00.000Z", "200"]);

    const day = await ok(engine.execute<M.SpeedHistory>("speedtest.history", { networkId: "100001", range: "day" }));
    expect(day.tests.map((t) => t.at)).toEqual(["2026-11-12T03:00:00Z"]);
  });

  it("uses the speedtest link eero handed back", async () => {
    const { engine, fake } = fakeEngine({
      prepare: (fake) => {
        const net = fake.state.networks.get("100001");
        if (net?.network.resources) net.network.resources.speedtest = "/2.4/networks/100001/speedtest";
      },
    });
    await ok(engine.execute("internet.get", { networkId: "100001" }));
    await ok(engine.execute("speedtest.history", { networkId: "100001" }));
    expect(fake.log.some((l) => l.path === "/2.4/networks/100001/speedtest")).toBe(true);
  });

  it("an offline network maps to offline with no gateway port speed", async () => {
    const { engine } = fakeEngine();
    const lake = await ok(engine.execute<M.Internet>("internet.get", { networkId: "Lake Cabin" }));
    expect(lake).toMatchObject({ status: "offline", gateway: { eeroId: "500010", wanPortSpeedMbps: null }, planMbps: null });
  });
});

describe("internet mapping", () => {
  it("detects double NAT from a private WAN address when eero does not say", () => {
    expect(mapInternet({ wan_ip: "100.64.3.4" }).doubleNat).toBe(true);
    expect(mapInternet({ wan_ip: "203.0.113.9" }).doubleNat).toBe(false);
    expect(mapInternet({}).doubleNat).toBeNull();
    expect(mapInternet({ wan_ip: "10.0.0.2", ip_settings: { double_nat: false } }).doubleNat).toBe(false);
  });

  it("reads PPPoE, custom DNS, ASN and Gbps speeds", () => {
    const i = mapInternet({
      wan_type: "PPPoE",
      dns: { mode: "custom", parent: { ips: ["1.1.1.1"] }, custom: { ips: ["9.9.9.9", ""] } },
      geo_ip: { asn: 64500 },
      speed: { date: "2026-11-12T03:00:00Z", down: { value: 1.2, units: "Gbps" }, up: { value: 40 } },
    });
    expect(i).toMatchObject({ wanType: "pppoe", dnsMode: "custom", dnsInUse: ["9.9.9.9"], isp: { asn: "AS64500" }, lastSpeedTest: { downMbps: 1200, upMbps: 40 } });
    expect(i.gateway).toBeNull();
  });

  it("drops undated speed test rows and sorts newest first", () => {
    expect(mapSpeedTests([{ date: "2026-11-10T03:00:00+0000", down_mbps: 1 }, { down_mbps: 2 }, { date: "2026-11-11T03:00:00+0000" }])).toEqual([
      { at: "2026-11-11T03:00:00Z", downMbps: null, upMbps: null, rating: null },
      { at: "2026-11-10T03:00:00Z", downMbps: 1, upMbps: null, rating: null },
    ]);
  });

  it("formats missing values as -", () => {
    const text = internetText({ ...mapInternet({}), planMbps: null });
    expect(text).toContain("ISP: -");
    expect(text).toContain("Double NAT: -");
    expect(text).toContain("Gateway: -");
  });
});
