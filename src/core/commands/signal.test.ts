import { describe, expect, it } from "vitest";
import { createDemoBackend } from "../demo";
import { createEngine } from "../engine";
import type * as M from "../model";
import { channelSpan, maxRateMbps, spansOverlap } from "../signal";
import { HISTORY, nameList, wifiHealth, wifiInsights } from "./signal";

const NOW = Date.parse("2026-11-12T22:41:00Z");
const MAPLE = "4821907";

type Result<R> = { ok: true; result: R } | { ok: false; error: { code: string; message: string } };
async function ok<R>(p: Promise<Result<R>>): Promise<R> {
  const r = await p;
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.result;
}
const code = async (p: Promise<{ ok: boolean; error?: { code: string } }>) => (await p).error?.code;

function demoEngine() {
  let now = NOW;
  const engine = createEngine({ backend: createDemoBackend({ clock: () => now }), clock: () => now });
  return { engine, tick: (ms: number) => (now += ms) };
}

describe("signal helpers", () => {
  it("widens a channel to the block it sits in, and finds overlaps", () => {
    expect(channelSpan("2.4", 6, 20)).toEqual({ lo: 2427, hi: 2447, center: 2437 });
    // 80 MHz on 44 uses 36 to 48, the same block as 36.
    expect(channelSpan("5", 44, 80)).toEqual(channelSpan("5", 36, 80));
    expect(channelSpan("5", 149, 80).center).toBe(5775);
    expect(channelSpan("6", 37, 160).center).toBe(6185);
    expect(spansOverlap(channelSpan("2.4", 1, 20), channelSpan("2.4", 6, 20))).toBe(false);
    expect(spansOverlap(channelSpan("2.4", 1, 20), channelSpan("2.4", 3, 20))).toBe(true);
    expect(spansOverlap(channelSpan("5", 36, 80), channelSpan("5", 149, 80))).toBe(false);
  });

  it("knows the top rate of a link, or says it cannot", () => {
    expect(maxRateMbps("wifi6", 80, 2)).toBe(1201);
    expect(maxRateMbps("wifi4", 20, 1)).toBe(72);
    expect(maxRateMbps("wifi6", 80, null)).toBeNull();
    expect(maxRateMbps("unknown", 80, 2)).toBeNull();
  });

  it("lists names in plain English", () => {
    expect(nameList(["A"])).toBe("A");
    expect(nameList(["A", "B"])).toBe("A and B");
    expect(nameList(["A", "B", "C"])).toBe("A, B and C");
    expect(nameList(["A", "B", "C", "D", "E"])).toBe("A, B and 3 more");
  });
});

describe("wifi.health (demo): points, mesh, load and advice", () => {
  it("gives every wireless device as a point, weakest first, and each eero's roll-up", async () => {
    const { engine } = demoEngine();
    const h = await ok(engine.execute<M.WifiHealth>("wifi.health", { networkId: MAPLE }));
    expect(h.points).toHaveLength(h.devices);
    expect(h.points.map((p) => p.dbm)).toEqual([...h.points.map((p) => p.dbm)].sort((a, b) => a - b));
    for (const p of h.points) if (p.headroomPct !== null) expect(p.headroomPct).toBeLessThanOrEqual(100);
    expect(h.points.some((p) => p.maxMbps !== null)).toBe(true);
    // Gateway first, and the roll-ups add up.
    expect(h.mesh[0]?.isGateway).toBe(true);
    expect(h.mesh.reduce((n, e) => n + e.devices, 0)).toBe(h.devices);
    const garage = h.mesh.find((e) => e.eero === "Garage");
    expect(garage).toMatchObject({ backhaul: "wireless", meshQuality: "weak", weak: 3 });
    // One load cell per eero and band; Garage has no 6 GHz radio.
    expect(h.load).toHaveLength(h.mesh.length * h.bands.length);
    expect(h.load.find((l) => l.eeroId === garage?.eeroId && l.band === "6")).toMatchObject({ radio: false, devices: 0, medianDbm: null });
    expect(h.load.reduce((n, l) => n + l.devices, 0)).toBe(h.devices);
  });

  it("advises on the weak mesh link first, then retries and shared channels", async () => {
    const { engine } = demoEngine();
    const h = await ok(engine.execute<M.WifiHealth>("wifi.health", { networkId: MAPLE }));
    expect(h.advice.map((a) => a.kind)).toEqual(["weak_mesh_link", "noisy_link", "shared_channel"]);
    const link = h.advice[0] as M.SignalAdvice;
    expect(link).toMatchObject({ tone: "destructive", title: "Garage has a weak mesh link" });
    expect(link.devices.map((d) => d.name).sort()).toEqual(["Flaky Plug", "Garage Door Opener", "Ring Doorbell"]);
    expect(link.eeros.map((e) => e.name)).toEqual(["Garage", "Office"]);
    expect(h.advice[1]?.devices.map((d) => d.name)).toEqual(["Sonos Kitchen"]);
    // Garage shares Office's 2.4 GHz channel 1 because it links to it: that alone is not advice.
    expect(h.advice.filter((a) => a.kind === "shared_channel").map((a) => a.title)).toEqual(["3 eeros share 5 GHz channels 36 and 44"]);
  });

  it("calls a busy radio and weak devices on a healthy eero", () => {
    const eero = (over: Partial<M.Eero>): M.Eero => ({
      id: "e1", serial: null, location: "Hall", model: null, modelNumber: null, isGateway: true, status: "online", firmware: null, updateAvailable: null, endOfLife: null,
      backhaul: "wired", meshBars: null, upstream: null, hop: 0, meshQuality: null, clients: { total: 1, wired: 0, wireless: 1 }, bands: ["2.4"],
      radios: [{ band: "2.4", channel: 6, widthMhz: 20, utilization: 72, clients: 1, txPowerDbm: null, autoChannel: null }],
      led: { on: null, brightness: null }, nightlight: null, ipv4: null, ipv6: [], subnet: null, gatewayIp: null, mac: null, bssids: [], joined: null, uptimeSec: null, lastHeartbeat: null, powerSource: null, messages: [], ...over,
    });
    const device = { id: "d1", name: "Plug", connected: true, band: "2.4", eeroId: "e1", signal: { dbm: -82, bars: 1 }, link: null } as unknown as M.Device;
    const h = wifiHealth([device], [eero({})]);
    expect(h.advice.map((a) => a.title)).toEqual(["1 weak device on Hall", "Hall 2.4 GHz is 72% busy"]);
    expect(h.advice.map((a) => a.tone)).toEqual(["warning", "warning"]);
    expect(wifiHealth([], [eero({ radios: [] })]).advice).toEqual([]);
  });
});

describe("wifi.insights (demo)", () => {
  it("joins what devices support to what they connect with, and adds the advice that needs it", async () => {
    const { engine } = demoEngine();
    const i = await ok(engine.execute<M.WifiInsights>("wifi.insights", { networkId: MAPLE }));
    const h = await ok(engine.execute<M.WifiHealth>("wifi.health", { networkId: MAPLE }));
    expect(i.report).toBe(true);
    expect(i.flows.reduce((n, f) => n + f.devices.length, 0)).toBe(h.devices);
    const held = Object.fromEntries(i.heldBack.map((g) => [g.reason, g.devices.map((d) => d.name).sort()]));
    expect(held).toEqual({ on_24: ["Kitchen Echo", "Mia's Kindle"], no_6ghz_radio: ["Mia's iPad"], on_5_near_6: ["Jamie's ThinkPad"], weak_signal: ["Ring Doorbell"] });
    expect(i.advice.map((a) => a.kind)).toEqual(["weak_mesh_link", "stuck_on_24", "noisy_link", "could_use_6ghz", "shared_channel"]);
    expect(i.advice.find((a) => a.kind === "could_use_6ghz")?.detail).toContain("Upstairs Hall has no 6 GHz radio");
    expect(await code(engine.execute("wifi.insights", { networkId: MAPLE, extra: 1 }))).toBe("bad_params");
    expect(engine.commands().find((c) => c.id === "wifi.insights")).toMatchObject({ effect: "query" });
  });

  it("falls back to wifi.health's advice when the upgrade report is missing", () => {
    const h = wifiHealth([], []);
    expect(wifiInsights(h, [], null)).toEqual({ report: false, flows: [], heldBack: [], advice: [] });
  });
});

describe("wifi.history (demo)", () => {
  it("starts from the demo's invented hour and adds a sample per read, at most every 20 seconds", async () => {
    const { engine, tick } = demoEngine();
    const first = await ok(engine.execute<M.SignalHistory>("wifi.history", { networkId: MAPLE }));
    expect(first.samples).toBe(61);
    expect(first.at).toHaveLength(first.samples);
    expect(first.devices.length).toBeLessThanOrEqual(HISTORY.limit);
    for (const d of first.devices) expect(d.dbm).toHaveLength(first.samples);
    // Most drops first: the weak Garage devices drop out now and then.
    expect(first.devices[0]?.name).toBe("Flaky Plug");
    expect(first.devices[0]?.drops).toBeGreaterThan(0);
    tick(5_000);
    await ok(engine.execute("device.list", { networkId: MAPLE }));
    tick(30_000);
    await ok(engine.execute("device.list", { networkId: MAPLE }));
    const later = await ok(engine.execute<M.SignalHistory>("wifi.history", { networkId: MAPLE, minutes: 240, limit: 50 }));
    expect(later.samples).toBe(62);
    const one = await ok(engine.execute<M.SignalHistory>("wifi.history", { networkId: MAPLE, device: "Sonos Kitchen" }));
    expect(one.devices.map((d) => d.name)).toEqual(["Sonos Kitchen"]);
  });

  it("checks its params", async () => {
    const { engine } = demoEngine();
    expect(await code(engine.execute("wifi.history", { networkId: MAPLE, minutes: 1 }))).toBe("bad_params");
    expect(await code(engine.execute("wifi.history", { networkId: MAPLE, limit: 0 }))).toBe("bad_params");
    expect(await code(engine.execute("wifi.history", { networkId: MAPLE, device: "No Such Thing" }))).toBe("bad_params");
  });
});
