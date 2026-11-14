import { describe, expect, it } from "vitest";
import { createFakeEero, type FakeEero } from "../../../test/fake-eero/server";
import type { AuthState, Backend, SecretStore } from "../backend";
import { createDemoBackend, DEMO_SETTINGS } from "../demo";
import { createEeroBackend } from "../eero/backend";
import { mapInternet, mapSpeedTests } from "../eero/map/network";
import { createEngine, memorySettings } from "../engine";
import type * as M from "../model";
import type { SettingsStore } from "../spec";
import { commands as internetCommands, internetText, internetVerdict, SPEEDTEST_GIVE_UP_MS, SPEEDTEST_RESULT_MS, type SpeedTestRun, speedRating } from "./internet";

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

  it("the demo hosts' settings give Maple Street the mockup plan and the other networks none", async () => {
    const engine = demoEngine({ settings: memorySettings(DEMO_SETTINGS) });
    const maple = await ok(engine.execute<M.Internet>("internet.get", { networkId: MAPLE }));
    expect(maple.planMbps).toEqual({ down: 1200, up: 1200 });
    expect(maple.verdict).toMatchObject({ kind: "steady", title: "Ziply Fiber is fast and steady" });
    const networks = await ok(engine.execute<M.Network[]>("network.list"));
    for (const n of networks.filter((x) => x.id !== MAPLE)) {
      expect((await ok(engine.execute<M.Internet>("internet.get", { networkId: n.id }))).planMbps).toBeNull();
    }
  });

  it("internet.get format text is the Copy details block", async () => {
    const text = await ok(demoEngine().execute<string>("internet.get", { networkId: MAPLE, format: "text" }));
    expect(typeof text).toBe("string");
    expect(text).toMatch(/^Internet provider\nISP: Ziply Fiber\n/);
    expect(text).toContain("\nAddressing\n");
    expect(text).toContain("Plan: -");
  });

  it("rates a 35% test poor and labels it Poor in the CSV", async () => {
    const engine = demoEngine({ settings: memorySettings({ planMbps: { [MAPLE]: { down: 2000, up: 1000 } } }) });
    const week = await ok(engine.execute<M.SpeedHistory>("speedtest.history", { networkId: MAPLE }));
    // 702 / 2000 is 35% of the plan.
    expect(week.tests.find((t) => t.downMbps === 702)?.rating).toBe("poor");
    expect(week.tests.find((t) => t.downMbps === 942)?.rating).toBe("below_plan");
    const csv = await ok(engine.execute<string>("speedtest.history", { networkId: MAPLE, format: "csv" }));
    expect(csv.split("\n").find((l) => l.includes(",702,"))).toMatch(/,Poor\r?$/);
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

describe("internet verdict", () => {
  const base = { ...mapInternet({ geo_ip: { isp: "Ziply Fiber" } }), status: "online" as M.Status };
  const test = (downMbps: number | null, upMbps: number | null, hoursAgo = 2): M.SpeedTest => ({
    at: new Date(NOW - hoursAgo * HOUR).toISOString(),
    downMbps,
    upMbps,
    rating: null,
  });
  const plan = { down: 1200, up: 1200 };

  it("is fast and steady when the last test reached 75% of the plan", () => {
    expect(internetVerdict({ ...base, planMbps: plan, lastSpeedTest: test(942, 918) }, NOW)).toEqual({
      kind: "steady",
      title: "Ziply Fiber is fast and steady",
      detail: "Last test 2 h ago hit 79% of your 1,200 Mbps plan",
    });
  });

  it("is slower than your plan when below plan or poor", () => {
    expect(internetVerdict({ ...base, planMbps: plan, lastSpeedTest: test(702, 846) }, NOW)).toMatchObject({
      kind: "slow",
      title: "Ziply Fiber is slower than your plan",
      detail: "Last test 2 h ago hit 59% of your 1,200 Mbps plan",
    });
    expect(internetVerdict({ ...base, planMbps: plan, lastSpeedTest: test(300, 900) }, NOW).kind).toBe("slow");
  });

  it("is down when the internet is offline", () => {
    expect(internetVerdict({ ...base, status: "offline", planMbps: plan, lastSpeedTest: test(942, 918) }, NOW)).toEqual({
      kind: "down",
      title: "Ziply Fiber is down",
      detail: null,
    });
    expect(internetVerdict({ ...base, isp: { ...base.isp, name: null }, status: "offline", planMbps: null, lastSpeedTest: null }, NOW).title).toBe("Your internet is down");
  });

  it("is up without a test or without a plan", () => {
    expect(internetVerdict({ ...base, planMbps: plan, lastSpeedTest: null }, NOW)).toEqual({ kind: "steady", title: "Ziply Fiber is up", detail: "No speed test yet" });
    expect(internetVerdict({ ...base, planMbps: null, lastSpeedTest: test(942, 918) }, NOW)).toEqual({
      kind: "steady",
      title: "Ziply Fiber is up",
      detail: "Last test 2 h ago measured 942 Mbps down, 918 Mbps up",
    });
  });

  it("comes back from internet.get in demo for every form", async () => {
    const plan = memorySettings({ planMbps: { [MAPLE]: { down: 1200, up: 1200 }, [LAKE]: { down: 500, up: 50 } } });
    const engine = demoEngine({ settings: plan });
    expect((await ok(engine.execute<M.Internet>("internet.get", { networkId: MAPLE }))).verdict).toMatchObject({ kind: "steady", title: "Ziply Fiber is fast and steady" });
    expect((await ok(engine.execute<M.Internet>("internet.get", { networkId: LAKE }))).verdict?.kind).toBe("down");
    const slow = demoEngine({ settings: memorySettings({ planMbps: { [MAPLE]: { down: 2000, up: 2000 } } }) });
    expect((await ok(slow.execute<M.Internet>("internet.get", { networkId: MAPLE }))).verdict).toMatchObject({
      kind: "slow",
      title: "Ziply Fiber is slower than your plan",
    });
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

  it("is poor under 40% of plan in any measured direction", () => {
    const plan = { down: 1000, up: 100 };
    expect(speedRating({ downMbps: 350, upMbps: 100 }, plan)).toBe("poor");
    expect(speedRating({ downMbps: 900, upMbps: 35 }, plan)).toBe("poor");
    expect(speedRating({ downMbps: 400, upMbps: 40 }, plan)).toBe("below_plan");
    expect(speedRating({ downMbps: 350, upMbps: null }, plan)).toBe("poor");
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
    // The fake serves the gateway's ethernet_status as eero does: the WAN-labelled port at P2500.
    const { engine } = fakeEngine({
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
      lastSpeedTest: { at: "2026-11-12T03:00:00.000Z", downMbps: 912.4, upMbps: 40.2, rating: "great" },
      verdict: { kind: "steady", title: "Example Fiber is fast and steady", detail: "Last test 20 h ago hit 91% of your 1,000 Mbps plan" },
    });
  });

  it("has no lease renew time (eero sends only the address, mask and router) and reads the WAN type", async () => {
    const seeded = (lease: unknown, wanType = "DHCP") =>
      fakeEngine({
        prepare: (fake) => {
          const net = fake.state.networks.get("100001")?.network as Record<string, unknown>;
          if (lease !== undefined) net.lease = lease;
          net.wan_type = wanType;
        },
      }).engine.execute<M.Internet>("internet.get", { networkId: "100001" });
    // The fake's default lease is the real shape: { mode, dhcp: { ip, mask, router }, static: null }.
    const dhcp = await ok(seeded(undefined));
    expect(dhcp).toMatchObject({ wanType: "dhcp", ispGateway: "203.0.113.1" });
    expect(dhcp).not.toHaveProperty("leaseRenewsAt");
    // A guessed renew field is never surfaced.
    expect(await ok(seeded({ mode: "dhcp", dhcp: { ip: "203.0.113.9", renews_on: "2026-11-13T04:00:00Z" } }))).not.toHaveProperty("leaseRenewsAt");
    expect((await ok(seeded({ mode: "static", static: { ip: "203.0.113.9" } }, "STATIC"))).wanType).toBe("static");
  });

  it("speedtest.history sends the window and limit, and maps rows newest first", async () => {
    const { engine, fake } = fakeEngine({ settings: memorySettings({ planMbps: { "100001": { down: 1000, up: 100 } } }) });
    const history = await ok(engine.execute<M.SpeedHistory>("speedtest.history", { networkId: "100001" }));
    expect(history.tests).toEqual([
      { at: "2026-11-12T03:00:00.000Z", downMbps: 912.4, upMbps: 40.2, rating: "below_plan" },
      { at: "2026-11-11T03:00:00.000Z", downMbps: 884.1, upMbps: 39.7, rating: "poor" },
      { at: "2026-11-10T03:00:00.000Z", downMbps: 901.9, upMbps: 41, rating: "below_plan" },
    ]);
    expect(history.avg7d).toEqual({ downMbps: 899.5, upMbps: 40.3 });
    const req = fake.log.find((l) => l.path === "/2.2/networks/100001/speedtest");
    const q = new URLSearchParams(req?.query ?? "");
    expect([q.get("startTime"), q.get("endTime"), q.get("limit")]).toEqual(["2026-11-05T22:41:00.000Z", "2026-11-12T22:41:00.000Z", "200"]);

    const day = await ok(engine.execute<M.SpeedHistory>("speedtest.history", { networkId: "100001", range: "day" }));
    expect(day.tests.map((t) => t.at)).toEqual(["2026-11-12T03:00:00.000Z"]);
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
      speed: { date: "2026-11-12T03:00:00.000Z", down: { value: 1.2, units: "Gbps" }, up: { value: 40 } },
    });
    expect(i).toMatchObject({ wanType: "pppoe", dnsMode: "custom", dnsInUse: ["9.9.9.9"], isp: { asn: "AS64500" }, lastSpeedTest: { downMbps: 1200, upMbps: 40 } });
    expect(i.gateway).toBeNull();
  });

  it("drops undated speed test rows and sorts newest first", () => {
    expect(mapSpeedTests([{ date: "2026-11-10T03:00:00+0000", down_mbps: 1 }, { down_mbps: 2 }, { date: "2026-11-11T03:00:00+0000" }])).toEqual([
      { at: "2026-11-11T03:00:00.000Z", downMbps: null, upMbps: null, rating: null },
      { at: "2026-11-10T03:00:00.000Z", downMbps: 1, upMbps: null, rating: null },
    ]);
  });

  it("formats missing values as -", () => {
    const text = internetText({ ...mapInternet({}), planMbps: null, verdict: null });
    expect(text).toContain("ISP: -");
    expect(text).toContain("Double NAT: -");
    expect(text).toContain("Gateway: -");
  });
});

// ---------------------------------------------------------------------------
// Writes (M4.9): speedtest.run and internet.plan.set

describe("speedtest.run and internet.plan.set (demo)", () => {
  const clocked = (start = NOW) => {
    const clock = { t: start };
    const engine = createEngine({ backend: createDemoBackend({ clock: () => clock.t }), clock: () => clock.t, settings: memorySettings() });
    return { clock, engine };
  };

  it("registers both as writes with the topics they invalidate", () => {
    const specs = Object.fromEntries(internetCommands.map((c) => [c.id, c]));
    expect([specs["speedtest.run"], specs["internet.plan.set"]].map((s) => [s?.effect, s?.invalidates])).toEqual([
      ["write", ["speedtest", "network"]],
      ["write", ["network", "speedtest"]],
    ]);
  });

  it("speedtest.run shows the new result in the next history and internet.get reads", async () => {
    const { engine } = clocked();
    // Cached reads from before the test.
    const before = await ok(engine.execute<M.SpeedHistory>("speedtest.history", { networkId: MAPLE }));
    await ok(engine.execute<M.Internet>("internet.get", { networkId: MAPLE }));
    const run = await ok(engine.execute<SpeedTestRun>("speedtest.run", { networkId: MAPLE }));
    expect(run).toEqual({ networkId: MAPLE, startedAt: new Date(NOW).toISOString(), resultAt: new Date(NOW + SPEEDTEST_RESULT_MS).toISOString() });
    const after = await ok(engine.execute<M.SpeedHistory>("speedtest.history", { networkId: MAPLE }));
    expect(before.running).toBeNull();
    // The demo posts the result at once, so the test is already over.
    expect(after.running).toBeNull();
    expect(after.tests).toHaveLength(before.tests.length + 1);
    expect(after.tests[0]?.at).toBe(run.startedAt);
    const internet = await ok(engine.execute<M.Internet>("internet.get", { networkId: MAPLE }));
    expect(internet.lastSpeedTest?.at).toBe(run.startedAt);
    expect(internet.verdict?.detail).toMatch(/^Last test just now/);
  });

  it("runs one test at a time per network until its result is read or 3 minutes pass", async () => {
    const { clock, engine } = clocked();
    await ok(engine.execute("speedtest.run", { networkId: MAPLE }));
    const second = await engine.execute("speedtest.run", { networkId: MAPLE });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toMatchObject({ code: "rate_limited", message: expect.stringMatching(/already running/), detail: { retryAfterSec: 180 } });
    // Another network is not blocked.
    await ok(engine.execute("speedtest.run", { networkId: LAKE }));
    // Reading the result ends the test (the demo posts it at once).
    await ok(engine.execute("speedtest.history", { networkId: MAPLE }));
    await ok(engine.execute("speedtest.run", { networkId: MAPLE }));
    // With no result read, the lock gives up after 3 minutes.
    clock.t += SPEEDTEST_GIVE_UP_MS - 1000;
    expect(await code(engine.execute("speedtest.run", { networkId: MAPLE }))).toBe("rate_limited");
    clock.t += 1000;
    await ok(engine.execute("speedtest.run", { networkId: MAPLE }));
    // Lake Cabin's test is still waiting for its history read.
    clock.t = NOW + 1000;
    expect(await code(engine.execute("speedtest.run", { networkId: LAKE }))).toBe("rate_limited");
  });

  it("speedtest.run rejects params and needs a session", async () => {
    expect(await code(demoEngine().execute("speedtest.run", { networkId: MAPLE, fast: true }))).toBe("bad_params");
    expect(await code(demoEngine({ scenario: "signed_out" }).execute("speedtest.run", {}))).toBe("not_signed_in");
  });

  it("internet.plan.set saves the plan, rates against it, and clears it", async () => {
    const settings = memorySettings({ planMbps: { [LAKE]: { down: 300, up: 20 } } });
    const engine = demoEngine({ settings });
    // Cached before the plan.
    expect((await ok(engine.execute<M.Internet>("internet.get", { networkId: MAPLE }))).planMbps).toBeNull();
    expect((await ok(engine.execute<M.SpeedHistory>("speedtest.history", { networkId: MAPLE }))).tests[0]?.rating).toBeNull();

    const plan = await ok(engine.execute("internet.plan.set", { networkId: MAPLE, down: 1200, up: 1200, label: " Fiber Gig " }));
    expect(plan).toEqual({ down: 1200, up: 1200, label: "Fiber Gig" });
    const rated = await ok(engine.execute<M.Internet>("internet.get", { networkId: MAPLE }));
    expect(rated.planMbps).toEqual({ down: 1200, up: 1200, label: "Fiber Gig" });
    expect(rated.verdict).toMatchObject({ kind: "steady", title: "Ziply Fiber is fast and steady" });
    expect((await ok(engine.execute<M.SpeedHistory>("speedtest.history", { networkId: MAPLE }))).tests[0]?.rating).toBe("great");
    expect((await settings.get()).planMbps).toEqual({ [LAKE]: { down: 300, up: 20 }, [MAPLE]: { down: 1200, up: 1200, label: "Fiber Gig" } });

    // A slower plan without a name replaces it.
    expect(await ok(engine.execute("internet.plan.set", { networkId: MAPLE, down: 500, up: 50 }))).toEqual({ down: 500, up: 50 });

    expect(await ok(engine.execute("internet.plan.set", { networkId: MAPLE, clear: true }))).toBeNull();
    expect((await ok(engine.execute<M.Internet>("internet.get", { networkId: MAPLE }))).planMbps).toBeNull();
    expect((await settings.get()).planMbps).toEqual({ [LAKE]: { down: 300, up: 20 } });
    // Clearing again is fine.
    expect(await ok(engine.execute("internet.plan.set", { networkId: MAPLE, clear: true }))).toBeNull();
  });

  it("internet.plan.set rejects bad params with the field that is wrong", async () => {
    const engine = demoEngine();
    const err = async (params: Record<string, unknown>) => {
      const r = await engine.execute("internet.plan.set", { networkId: MAPLE, ...params });
      return r.ok ? null : r.error;
    };
    expect(await err({ down: 1000 })).toMatchObject({ code: "bad_params", detail: { issues: [{ path: "up", message: "Enter the upload speed." }] } });
    expect(await err({})).toMatchObject({ code: "bad_params", detail: { issues: [{ path: "down" }, { path: "up" }] } });
    expect((await err({ down: 0, up: 10 }))?.detail?.issues?.[0]).toMatchObject({ path: "down", message: "The download speed must be more than 0 Mbps." });
    expect((await err({ down: 100, up: -1 }))?.detail?.issues?.[0]?.path).toBe("up");
    expect((await err({ down: 100_001, up: 10 }))?.code).toBe("bad_params");
    expect((await err({ down: "1000", up: 10 }))?.code).toBe("bad_params");
    expect((await err({ down: 100, up: 10, label: "x".repeat(41) }))?.detail?.issues?.[0]?.path).toBe("label");
    expect(await err({ clear: true, down: 100 })).toMatchObject({ code: "bad_params", message: "Pass either clear, or down and up, not both." });
    expect((await err({ clear: false }))?.code).toBe("bad_params");
    expect((await err({ down: 100, up: 10, plan: "x" }))?.code).toBe("bad_params");
  });
});

describe("speedtest.run and internet.plan.set (fake eero server)", () => {
  const clockedFake = () => {
    const clock = { t: NOW };
    const fake = createFakeEero({ now: () => clock.t });
    const eero = createEeroBackend({ secrets: secretsWith(fake.signIn()), origin: fake.origin, fetch: fake.fetch });
    const backend: Backend = { ...eero, auth: { ...eero.auth, status: async () => signedIn } };
    return { clock, fake, engine: createEngine({ backend, clock: () => clock.t, settings: memorySettings() }) };
  };
  const historyGets = (fake: FakeEero) => fake.log.filter((l) => l.method === "GET" && l.path === "/2.2/networks/100001/speedtest").length;

  it("posts {net}/speedtest empty (202), then reads the result once it lands about a minute later", async () => {
    const { clock, fake, engine } = clockedFake();
    const before = await ok(engine.execute<M.SpeedHistory>("speedtest.history", { networkId: "100001" }));
    const run = await ok(engine.execute<SpeedTestRun>("speedtest.run", { networkId: "100001" }));
    expect(run.resultAt).toBe(new Date(NOW + 60_000).toISOString());
    expect(fake.writes).toEqual([expect.objectContaining({ method: "POST", path: "/2.2/networks/100001/speedtest", version: "2.2", encoding: "empty", status: 202 })]);

    // The write made the cached history stale: it is read again, without the result yet.
    const gets = historyGets(fake);
    const early = await ok(engine.execute<M.SpeedHistory>("speedtest.history", { networkId: "100001" }));
    expect(historyGets(fake)).toBe(gets + 1);
    expect(early.tests).toEqual(before.tests);
    expect(early.running).toEqual(run);
    // A second start is refused locally and never reaches eero.
    expect(await code(engine.execute("speedtest.run", { networkId: "100001" }))).toBe("rate_limited");
    expect(fake.writes).toHaveLength(1);

    // While the test runs, a read without the result expires after a few seconds.
    clock.t += 30_000;
    await ok(engine.execute("speedtest.history", { networkId: "100001" }));
    expect(historyGets(fake)).toBe(gets + 2);
    clock.t += 4_000;
    await ok(engine.execute("speedtest.history", { networkId: "100001" }));
    expect(historyGets(fake)).toBe(gets + 2);
    clock.t += 30_000;
    const done = await ok(engine.execute<M.SpeedHistory>("speedtest.history", { networkId: "100001" }));
    expect(historyGets(fake)).toBe(gets + 3);
    expect(done.tests[0]).toEqual({ at: run.resultAt, downMbps: 909.3, upMbps: 40.8, rating: null });
    expect(done.running).toBeNull();
    expect((await ok(engine.execute<M.Internet>("internet.get", { networkId: "100001" }))).lastSpeedTest).toMatchObject({ at: run.resultAt, downMbps: 909.3 });

    // The result ends the test: history is cached normally again, and another test may start.
    clock.t += 60_000;
    await ok(engine.execute("speedtest.history", { networkId: "100001" }));
    expect(historyGets(fake)).toBe(gets + 3);
    await ok(engine.execute("speedtest.run", { networkId: "100001" }));
    expect(fake.writes).toHaveLength(2);
  });

  it("a result from before the start never finishes the next test", async () => {
    const { clock, fake, engine } = clockedFake();
    const first = await ok(engine.execute<SpeedTestRun>("speedtest.run", { networkId: "100001" }));
    clock.t += 65_000;
    expect((await ok(engine.execute<M.SpeedHistory>("speedtest.history", { networkId: "100001" }))).tests[0]?.at).toBe(first.resultAt);
    // Run again 5 s after the first result is dated: inside the clock skew allowance.
    clock.t = Date.parse(first.resultAt) + 5_000;
    const second = await ok(engine.execute<SpeedTestRun>("speedtest.run", { networkId: "100001" }));
    const h = await ok(engine.execute<M.SpeedHistory>("speedtest.history", { networkId: "100001" }));
    expect(h.tests[0]?.at).toBe(first.resultAt);
    expect(h.running).toEqual(second);
    expect(await code(engine.execute("speedtest.run", { networkId: "100001" }))).toBe("rate_limited");
    expect(fake.writes).toHaveLength(2);
  });

  it("uses the speedtest link eero handed back for the start", async () => {
    const { fake, engine } = clockedFake();
    const net = fake.state.networks.get("100001");
    if (net?.network.resources) net.network.resources.speedtest = "/2.4/networks/100001/speedtest";
    await ok(engine.execute("internet.get", { networkId: "100001" }));
    await ok(engine.execute("speedtest.run", { networkId: "100001" }));
    expect(fake.writes.map((w) => `${w.method} ${w.path}`)).toEqual(["POST /2.4/networks/100001/speedtest"]);
  });

  it("an eero error starts no test, so a retry is allowed", async () => {
    const { fake, engine } = clockedFake();
    fake.scenarios.fail(400, "error.speedtest.busy", { method: "POST", path: "/networks/100001/speedtest" });
    expect(await code(engine.execute("speedtest.run", { networkId: "100001" }))).toBe("eero_error");
    await ok(engine.execute("speedtest.run", { networkId: "100001" }));
  });

  it("internet.plan.set changes no eero state and refreshes cached reads", async () => {
    const { fake, engine } = clockedFake();
    expect((await ok(engine.execute<M.Internet>("internet.get", { networkId: "100001" }))).planMbps).toBeNull();
    await ok(engine.execute("speedtest.history", { networkId: "100001" }));
    await ok(engine.execute("internet.plan.set", { networkId: "100001", down: 1000, up: 50 }));
    const internet = await ok(engine.execute<M.Internet>("internet.get", { networkId: "100001" }));
    expect(internet.planMbps).toEqual({ down: 1000, up: 50 });
    expect(internet.lastSpeedTest?.rating).toBe("great");
    expect((await ok(engine.execute<M.SpeedHistory>("speedtest.history", { networkId: "100001" }))).tests.map((t) => t.rating)).toEqual(["great", "great", "great"]);
    await ok(engine.execute("internet.plan.set", { networkId: "100001", clear: true }));
    expect((await ok(engine.execute<M.Internet>("internet.get", { networkId: "100001" }))).planMbps).toBeNull();
    expect(fake.writes).toHaveLength(0);
  });
});
