import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeEero, type FakeEero } from "../../../test/fake-eero/server";
import type { AuthState, Backend, SecretStore } from "../backend";
import { createDemoBackend } from "../demo";
import { createEeroBackend } from "../eero/backend";
import { WAIT } from "../eero/backend/coverage";
import { generationOf, mapCoverageScan, mapGenerationScan, mapPlacement, placementRating } from "../eero/map/diagnostics";
import { createEngine } from "../engine";
import type * as M from "../model";
import { commands, GENERATIONS } from "./coverage";

const NOW = Date.parse("2026-11-12T22:41:00Z");
const MAPLE = "4821907";

type Result<R> = { ok: true; result: R } | { ok: false; error: { code: string; message: string } };
async function ok<R>(p: Promise<Result<R>>): Promise<R> {
  const r = await p;
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.result;
}
const code = async (p: Promise<{ ok: boolean; error?: { code: string } }>) => (await p).error?.code;

function demo() {
  const backend = createDemoBackend({ clock: () => NOW });
  return createEngine({ backend, clock: () => NOW });
}

const spec = (id: string) => commands.find((c) => c.id === id);

describe("coverage commands (spec)", () => {
  it("keeps the eero-area ids, with the scans as queries and the placement test a gated write", () => {
    expect(commands.map((c) => c.id)).toEqual(["coverage.scan", "coverage.upgrade_report", "eero.placement.test"]);
    expect(spec("coverage.scan")).toMatchObject({ effect: "query", topic: "coverage" });
    expect(spec("coverage.upgrade_report")).toMatchObject({ effect: "query", topic: "coverage" });
    expect(spec("eero.placement.test")).toMatchObject({ effect: "write", gate: { area: "eeros" }, invalidates: ["coverage"] });
  });

  it("Scan again (refresh: true) is never served from the cache", () => {
    const ttl = spec("coverage.scan")?.ttl as (p: { refresh?: boolean }) => number;
    expect(ttl({ refresh: true })).toBe(0);
    expect(ttl({})).toBeGreaterThan(0);
  });
});

describe("coverage.scan and coverage.upgrade_report (demo)", () => {
  it("lists every eero as a room, weakest first, with advice for the weak one", async () => {
    const scan = await ok(demo().execute<M.CoverageScan>("coverage.scan", { networkId: MAPLE }));
    expect(scan.rooms.length).toBeGreaterThan(1);
    expect(scan.rooms[0]).toMatchObject({ location: "Garage", quality: 40 });
    const qualities = scan.rooms.map((r) => r.quality ?? 101);
    expect(qualities).toEqual([...qualities].sort((a, b) => a - b));
    expect(scan.advice.join(" ")).toContain("Garage");
    expect(scan.scannedAt).toBe(new Date(NOW).toISOString());
  });

  it("accepts refresh and rejects bad params", async () => {
    const engine = demo();
    expect((await engine.execute("coverage.scan", { networkId: MAPLE, refresh: true })).ok).toBe(true);
    expect(await code(engine.execute("coverage.scan", { networkId: MAPLE, refresh: "yes" }))).toBe("bad_params");
    expect(await code(engine.execute("coverage.upgrade_report", { networkId: MAPLE, extra: 1 }))).toBe("bad_params");
  });

  it("the upgrade report has all five generations in order", async () => {
    const r = await ok(demo().execute<M.UpgradeReport>("coverage.upgrade_report", { networkId: MAPLE }));
    expect(r.byGeneration.map((g) => g.generation)).toEqual(GENERATIONS);
    expect(r.byGeneration.reduce((n, g) => n + g.devices, 0)).toBeGreaterThan(0);
  });
});

describe("eero.placement.test (demo)", () => {
  it("rates a weak wireless eero with advice and a wired one strong", async () => {
    const engine = demo();
    const garage = await ok(engine.execute<M.PlacementResult>("eero.placement.test", { networkId: MAPLE, eero: "Garage" }));
    expect(garage).toMatchObject({ rating: "fair" });
    expect(garage.advice).toContain("Garage");
    const living = await ok(engine.execute<M.PlacementResult>("eero.placement.test", { networkId: MAPLE, eero: "Living Room" }));
    expect(living).toMatchObject({ rating: "strong", advice: null });
  });

  it("needs an eero and never asks to confirm", async () => {
    const engine = demo();
    expect(await code(engine.execute("eero.placement.test", { networkId: MAPLE }))).toBe("bad_params");
    expect(await code(engine.execute("eero.placement.test", { networkId: MAPLE, eero: "No Such Room" }))).toBe("bad_params");
    expect((await engine.execute("eero.placement.test", { networkId: MAPLE, eero: "Office" })).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Real eero backend against the fake eero server

const signedIn: AuthState = { signedIn: true, pending: false, login: null, storage: "memory" };
const secrets = (token: string): SecretStore => ({ load: async () => token, save: async () => "memory", clear: async () => {}, storage: async () => "memory" });

function fakeEngine() {
  const fake: FakeEero = createFakeEero({ now: () => NOW });
  const eero = createEeroBackend({ secrets: secrets(fake.signIn()), origin: fake.origin, fetch: fake.fetch, readShareMs: 0 });
  const backend: Backend = { ...eero, auth: { ...eero.auth, status: async () => signedIn } };
  return { fake, engine: createEngine({ backend, clock: () => NOW }) };
}

const saved = { ...WAIT };
beforeEach(() => Object.assign(WAIT, { intervalMs: 1, timeoutMs: 2_000 }));
afterEach(() => Object.assign(WAIT, saved));

describe("coverage (fake eero server)", () => {
  it("coverage.scan reads /2.4/ wifi_coverage_scan (real shape: devices split by health) into a room per eero", async () => {
    const { engine, fake } = fakeEngine();
    const net = fake.state.networks.get("100001");
    const wireless = net?.devices.filter((d) => d.connected && d.wireless !== false) ?? [];
    const weak = wireless[0];
    if (!weak?.connectivity) throw new Error("fixture has no wireless device");
    weak.connectivity = { ...weak.connectivity, score: 0.2, score_bars: 1 };
    const scan = await ok(engine.execute<M.CoverageScan>("coverage.scan", { networkId: "100001" }));
    const req = fake.log.find((l) => l.path.includes("wifi_coverage_scan"));
    expect(req).toMatchObject({ method: "GET", path: "/2.4/networks/100001/placement/wifi_coverage_scan", query: "?allDevices=true" });
    // Before the fix the real shape mapped to no rooms ("No scan yet" after Scan now).
    expect(scan.rooms.map((r) => r.eeroId).sort()).toEqual(["500001", "500002", "500003", "500004"]);
    expect(scan.rooms.reduce((n, r) => n + (r.devices ?? 0), 0)).toBe(wireless.length);
    const weakRoom = scan.rooms.find((r) => r.eeroId === weak.source?.url?.split("/").at(-1));
    expect(weakRoom?.quality).toBeLessThan(90);
    // Garage has no wireless devices: listed with no quality, served by Office.
    expect(scan.rooms.find((r) => r.eeroId === "500004")).toMatchObject({ location: "Garage", quality: null, devices: 0, servedBy: "500002" });
    expect(scan.rooms[0]?.eeroId).toBe(weakRoom?.eeroId);
    expect(scan.advice).toEqual([`${weak.display_name} has a weak Wi-Fi link to ${weak.source?.location}. Moving it or the eero closer can help.`]);
    expect(scan.scannedAt).toBe(new Date(NOW).toISOString());
  });

  it("coverage.upgrade_report reads /2.4/ wifi_generation_scan (real shape: device rows per numeric version) and counts every wireless device", async () => {
    const { engine, fake } = fakeEngine();
    const r = await ok(engine.execute<M.UpgradeReport>("coverage.upgrade_report", { networkId: "100001" }));
    expect(fake.log.find((l) => l.path.includes("wifi_generation_scan"))).toMatchObject({ method: "GET", path: "/2.4/networks/100001/placement/wifi_generation_scan", query: "?allDevices=true" });
    expect(r.byGeneration.map((g) => g.generation)).toEqual(GENERATIONS);
    const wireless = fake.state.networks.get("100001")?.devices.filter((d) => d.connected && d.wireless !== false) ?? [];
    // Before the fix every count was 0 ("No wireless devices to report on").
    expect(r.byGeneration.reduce((n, g) => n + g.devices, 0)).toBe(wireless.length);
    const six = wireless.filter((d) => String(d.interface?.frequency).startsWith("6")).length;
    expect(r.byGeneration.find((g) => g.generation === "wifi6e")?.devices).toBe(six);
    expect(r.limitingEeros).toEqual([]);
  });

  it("eero.placement.test posts to /2.3/ placement_test/{serial}, waits while it runs, then maps the rating", async () => {
    const { engine, fake } = fakeEngine();
    const r = await ok(engine.execute<M.PlacementResult>("eero.placement.test", { networkId: "100001", eero: "Garage" }));
    expect(r).toEqual({ eeroId: "500004", rating: "poor", advice: "Move Garage closer to the eero it connects through." });
    const calls = fake.log.filter((l) => l.path.includes("placement_test")).map((l) => `${l.method} ${l.path}`);
    expect(calls).toEqual(["POST /2.3/networks/100001/placement_test/FAKE00GA0004", "GET /2.3/networks/100001/placement_test/FAKE00GA0004", "GET /2.3/networks/100001/placement_test/FAKE00GA0004"]);
    expect(fake.writes.at(-1)).toMatchObject({ method: "POST", version: "2.3" });
  });

  it("a placement test that never finishes fails eero_error instead of hanging", async () => {
    const { engine, fake } = fakeEngine();
    Object.assign(WAIT, { intervalMs: 1, timeoutMs: 20 });
    const before = fake.state.extra;
    // Every read answers "running".
    fake.state.extra = new Proxy(before, { get: (t, k) => (String(k).startsWith("placement:") ? { reads: 1e9 } : Reflect.get(t, k)) });
    expect(await code(engine.execute("eero.placement.test", { networkId: "100001", eero: "Office" }))).toBe("eero_error");
  });
});

describe("placement and coverage mapping", () => {
  it("maps rating words and numbers", () => {
    expect(["EXCELLENT", "good", "Fair", "weak", "", null].map(placementRating)).toEqual(["strong", "good", "fair", "poor", null, null]);
    expect([5, 3, 2, 1, 95, 45].map(placementRating)).toEqual(["strong", "good", "fair", "poor", "strong", "fair"]);
    expect(mapPlacement("1", { result: { rating: "GOOD", recommendation: "Fine where it is" } })).toEqual({ eeroId: "1", rating: "good", advice: "Fine where it is" });
  });

  it("groups coverage devices by their eero, averaging link scores, with weak devices as advice", () => {
    const dev = (eero: string, score: number | null, bars?: number, name = "Phone") => ({ display_name: name, source: { url: `/2.2/eeros/${eero}`, location: `Room ${eero}` }, connectivity: score === null ? { score_bars: bars } : { score } });
    const s = mapCoverageScan({ healthy_devices: [dev("7", 1), dev("7", 0.8), dev("8", null, 4), { display_name: "No eero" }], unhealthy_devices: [dev("8", 0.2, 1, "Tablet")], network_id: 1, debug: { recommendation: "x", reason: "y" } });
    expect(s.rooms).toEqual([
      { eeroId: "7", location: "Room 7", quality: 90, devices: 2, servedBy: null },
      { eeroId: "8", location: "Room 8", quality: 50, devices: 2, servedBy: null },
    ]);
    expect(s.advice).toEqual(["Tablet has a weak Wi-Fi link to Room 8. Moving it or the eero closer can help."]);
    expect(mapCoverageScan(null)).toEqual({ scannedAt: null, rooms: [], advice: [] });
  });

  it("counts generation scan device rows per numeric version, 6 GHz Wi-Fi 6 as 6E, with a note when devices outgrow the eeros", () => {
    expect(["WIFI_7", "6E", "wifi6", "ac", "n", "b", 4, "?"].map(generationOf)).toEqual(["wifi7", "wifi6e", "wifi6", "wifi5", "wifi4", "wifi4", "wifi4", null]);
    const d = (frequency = "5") => ({ interface: { frequency } });
    const r = mapGenerationScan({
      network_wifi_version: 5,
      devices_per_wifi_version: [{ wifi_version: 4, devices: [d("2.4"), d("2.4")] }, { wifi_version: 7, devices: [d()] }, { wifi_version: 5, devices: [d()] }, { wifi_version: 6, devices: [d(), d("6")] }],
      eeros_per_wifi_version: [{ wifi_version: 5, count: 3 }],
      debug: { recommendation: "x", reason: "y" },
    });
    expect(r.byGeneration).toEqual([
      { generation: "wifi4", devices: 2 },
      { generation: "wifi7", devices: 1 },
      { generation: "wifi5", devices: 1 },
      { generation: "wifi6", devices: 1 },
      { generation: "wifi6e", devices: 1 },
    ]);
    expect(r.notes).toEqual(["3 devices support a newer Wi-Fi generation than your eeros (Wi-Fi 5)."]);
    expect(mapGenerationScan(null)).toEqual({ byGeneration: [], limitingEeros: [], notes: [] });
  });
});
