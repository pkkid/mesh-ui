import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeEero, type FakeEero } from "../../../test/fake-eero/server";
import type { AuthState, Backend, SecretStore } from "../backend";
import { createDemoBackend } from "../demo";
import type { ScenarioName } from "../demo/scenario";
import { createEeroBackend } from "../eero/backend";
import { WAIT } from "../eero/backend/coverage";
import { READ_SHARE_MS } from "../eero/client";
import { diagnosticsPending, mapDiagnostics, mapSupport } from "../eero/map/diagnostics";
import { RateLimiter } from "../eero/ratelimit";
import { createEngine, type Engine } from "../engine";
import type * as M from "../model";
import { RUN_READS } from "../../../test/fake-eero/routes/diagnostics";
import { commands as diagnosticsCommands, diagnosisSteps, healthScore, overallStatus, redact, redactMac, scrub, supportReport } from "./diagnostics";

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

function demo(scenario?: ScenarioName) {
  const backend = createDemoBackend({ clock: () => NOW, scenario });
  return { backend, engine: createEngine({ backend, clock: () => NOW }) };
}

const byId = (r: M.HealthReport, id: string) => r.checks.find((c) => c.id === id);
const eeroChecks = (r: M.HealthReport) => r.checks.filter((c) => c.id.startsWith("eero."));

describe("health.check (demo)", () => {
  it("Run again (refresh: true) reads afresh; a plain read within the TTL is the cached report", async () => {
    let t = NOW;
    const backend = createDemoBackend({ clock: () => t });
    const engine = createEngine({ backend, clock: () => t });
    const first = await ok(engine.execute<M.HealthReport>("health.check", { networkId: MAPLE }));
    t += 5_000;
    // Before the fix Run again was this plain read: the same report came back at once, so the click looked ignored.
    expect((await ok(engine.execute<M.HealthReport>("health.check", { networkId: MAPLE }))).at).toBe(first.at);
    expect((await ok(engine.execute<M.HealthReport>("health.check", { networkId: MAPLE, refresh: true }))).at).toBe(new Date(t).toISOString());
    expect(await code(engine.execute("health.check", { networkId: MAPLE, refresh: "yes" }))).toBe("bad_params");
  });

  it("default: every check good except the Garage weak link, one warning, score 86", async () => {
    const { engine } = demo();
    const r = await ok(engine.execute<M.HealthReport>("health.check", { networkId: MAPLE }));
    expect(r.checks.map((c) => c.id.replace(/^eero\..*/, "eero"))).toEqual(["internet", "dns", "eero", "eero", "eero", "eero", "mesh", "firmware"]);
    expect(byId(r, "mesh")).toMatchObject({ status: "warning", detail: "Garage 2 bars to Office" });
    expect(r.checks.filter((c) => c.id !== "mesh").every((c) => c.status === "good")).toBe(true);
    expect(byId(r, "internet")?.detail).toMatch(/^Ziply Fiber up · .+ down, .+ up$/);
    expect(eeroChecks(r)[0]).toMatchObject({ label: "Living Room", detail: "Gateway · 10 Gbps WAN" });
    expect(r).toMatchObject({ overall: "warning", score: 86, at: new Date(NOW).toISOString() });
  });

  it("eero_offline: that eero is a problem with its last check-in", async () => {
    const { engine } = demo("eero_offline");
    const r = await ok(engine.execute<M.HealthReport>("health.check", { networkId: MAPLE }));
    const garage = eeroChecks(r).find((c) => c.label === "Garage");
    expect(garage).toMatchObject({ status: "problem", detail: "Offline · last seen 9m ago" });
    expect(byId(r, "internet")?.status).toBe("good");
    expect(byId(r, "mesh")).toMatchObject({ status: "good", detail: "No weak links among the eeros online" });
    expect(r.overall).toBe("problem");
    expect(r.score).toBeLessThan(86);
  });

  it("network_offline: internet, DNS, every eero and the mesh fail", async () => {
    const { engine } = demo("network_offline");
    const r = await ok(engine.execute<M.HealthReport>("health.check", { networkId: MAPLE }));
    expect(byId(r, "internet")).toMatchObject({ status: "problem", detail: "Ziply Fiber is down" });
    expect(byId(r, "dns")?.status).toBe("problem");
    expect(byId(r, "mesh")?.status).toBe("problem");
    expect(eeroChecks(r).every((c) => c.status === "problem")).toBe(true);
    expect(r.overall).toBe("problem");
    expect(r.score).toBe(0);
  });

  it("a network with nothing wrong is all good, score 100", async () => {
    const { engine } = demo();
    const r = await ok(engine.execute<M.HealthReport>("health.check", { networkId: MOM }));
    expect(r.overall).toBe("good");
    expect(r.score).toBe(100);
  });

  it("errors: fails with eero_error, never a half report", async () => {
    expect(await code(demo("errors").engine.execute("health.check", { networkId: MAPLE }))).toBe("eero_error");
  });

  it("rejects bad params and needs a session", async () => {
    const { engine } = demo();
    expect(await code(engine.execute("health.check", { probe: true }))).toBe("bad_params");
    expect(await code(engine.execute("health.check", { networkId: "Nowhere" }))).toBe("bad_params");
    expect(await code(demo("signed_out").engine.execute("health.check"))).toBe("not_signed_in");
    expect(engine.commands().find((c) => c.id === "health.check")).toMatchObject({ effect: "query" });
  });
});

describe("health score and overall", () => {
  it("counts each status", () => {
    const s = (...st: M.Check["status"][]) => st.map((status) => ({ status }));
    expect(healthScore(s("good", "good"))).toBe(100);
    expect(healthScore(s("warning", "unknown"))).toBe(81);
    expect(healthScore(s("problem", "problem", "problem", "problem"))).toBe(0);
    expect(overallStatus(s("good", "unknown"))).toBe("good");
    expect(overallStatus(s("warning", "good"))).toBe("warning");
    expect(overallStatus(s("warning", "problem"))).toBe("problem");
  });
});

describe("support.info (demo)", () => {
  it("has eero and ISP contacts and the Support ID", async () => {
    const { engine, backend } = demo();
    const info = await ok(engine.execute<M.SupportInfo>("support.info", { networkId: MAPLE }));
    expect(info.supportId).toBe((await backend.account.get()).id);
    expect(info.eero.phone).toMatch(/^\+1/);
    expect(info.isp).toMatchObject({ name: "Ziply Fiber", phone: expect.stringMatching(/^\+1/) });
  });

  it("names the ISP from the connection when eero gives no ISP contact", async () => {
    const { engine, backend } = demo();
    const info = await ok(engine.execute<M.SupportInfo>("support.info", { networkId: LAKE }));
    expect(info.isp).toEqual({ name: (await backend.internet.get(LAKE)).isp.name, phone: null, url: null });
  });

  it("rejects bad params", async () => {
    const { engine } = demo();
    expect(await code(engine.execute("support.info", { extra: 1 }))).toBe("bad_params");
    expect(await code(engine.execute("support.report", { format: "pdf" }))).toBe("bad_params");
    expect(await code(demo("errors").engine.execute("support.info", { networkId: MAPLE }))).toBe("eero_error");
  });
});

/** Every name, serial, MAC and IP the demo knows for a network. */
async function sensitive(b: Backend, net: string): Promise<string[]> {
  const [network, eeros, devices, internet] = await Promise.all([b.network.get(net), b.eero.list(net), b.device.list(net), b.internet.get(net)]);
  const out: (string | null)[] = [network.name, network.nickname, internet.publicIpv4, internet.publicIpv6, internet.ipv6Prefix, internet.ispGateway, ...internet.dnsInUse];
  for (const e of eeros) out.push(e.location, e.serial, e.mac, e.ipv4, e.gatewayIp, e.subnet, ...e.ipv6, ...e.bssids.map((x) => x.mac));
  for (const d of devices) out.push(d.name, d.nickname, d.hostname, d.mac, d.id);
  return [...new Set(out.filter((v): v is string => typeof v === "string" && v.length > 4))];
}

describe("support.report (demo)", () => {
  for (const scenario of ["default", "eero_offline", "network_offline"] as const) {
    it(`${scenario}: no full MAC, IP, serial or name survives`, async () => {
      const { engine, backend } = demo(scenario);
      const text = await ok(engine.execute<string>("support.report", { networkId: MAPLE }));
      const values = await sensitive(backend, MAPLE);
      expect(values.length).toBeGreaterThan(20);
      for (const v of values) expect(text, v).not.toContain(v);
      expect(text).not.toMatch(/\b[0-9a-f]{2}(?::[0-9a-f]{2}){5}\b/i);
      expect(text).not.toMatch(/\b\d{1,3}(?:\.\d{1,3}){3}\b/);
      expect(text).toContain("Health check");
      expect(text).toContain("***rage");
    });
  }

  it("keeps the shape a support agent needs", async () => {
    const { engine, backend } = demo();
    const text = await ok(engine.execute<string>("support.report", { networkId: MAPLE }));
    expect(text).toContain(`Support ID: ${(await backend.account.get()).id}`);
    expect(text).toMatch(/\[WARNING\] Mesh links: \*\*\*rage 2 bars to \*\*\*fice/);
    expect(text).toContain("Overall: warning (score 86)");
    expect(text).toContain("ISP: Ziply Fiber");
    expect(text).toContain("Last cloud diagnostics");
    expect(text).not.toContain("******");
    expect(text).toMatch(/Generated: 2026-11-12T22:41:00/);
  });

  it("errors: fails with eero_error like every read", async () => {
    expect(await code(demo("errors").engine.execute("support.report", { networkId: MAPLE }))).toBe("eero_error");
  });

});

describe("redaction", () => {
  it("keeps only the last four characters", () => {
    expect(redact("Living Room")).toBe("***Room");
    expect(redact("Den")).toBe("***");
    expect(redact("abcd")).toBe("***");
    expect(redactMac("0A:1B:2C:3D:4E:5F")).toBe("***4e5f");
  });

  it("never keeps a suffix that is another known name whole", () => {
    expect(scrub("Living Room and Room", ["Living Room", "Room"])).toBe("*** and ***");
  });

  it("scrubs a device named in free text (cloud diagnostics details)", async () => {
    const { backend } = demo();
    const devices = await backend.device.list(MAPLE);
    const d = devices.find((x) => x.name.length > 8 && x.ipv4);
    if (!d) throw new Error("no demo device");
    const text = supportReport({
      now: NOW,
      app: { version: "0.0.0", backend: "demo" },
      supportId: null,
      network: null,
      health: null,
      report: null,
      devices: null,
      deviceList: devices,
      diagnostics: { status: "completed", issueArea: "device", results: [{ name: "Device", status: "warning", detail: `${d.name} at ${d.ipv4} keeps dropping` }] },
    });
    expect(text).not.toContain(d.name);
    expect(text).toContain(`${redact(d.name)} at ***`);
  });

  it("scrubs known values first, then any MAC or IP pattern", () => {
    const text = "Garage via Office at 10.0.0.12, mac 0a:1b:2c:3d:4e:5f, v6 2001:db8::1 and fd00:1:2:3:4:5:6:7, prefix 2001:db8:42::/56, at 22:41:00, serial GGC1234567";
    const out = scrub(text, ["Garage", "Office", "GGC1234567"]);
    expect(out).toBe("***rage via ***fice at ***0.12, mac ***4e5f, v6 ***8::1 and ***:6:7, prefix ***:/56, at 22:41:00, serial ***4567");
  });
});

// ---------------------------------------------------------------------------
// Fake eero server

const signedIn: AuthState = { signedIn: true, pending: false, login: null, storage: "memory" };
const secrets = (token: string): SecretStore => ({ load: async () => token, save: async () => "memory", clear: async () => {}, storage: async () => "memory" });

function fakeEngine(prepare?: (fake: FakeEero) => void) {
  const fake = createFakeEero({ now: () => NOW });
  prepare?.(fake);
  const eero = createEeroBackend({ secrets: secrets(fake.signIn()), origin: fake.origin, fetch: fake.fetch });
  const backend: Backend = { ...eero, auth: { ...eero.auth, status: async () => signedIn } };
  return { fake, backend, engine: createEngine({ backend, clock: () => NOW }) };
}

describe("diagnostics (fake eero server)", () => {
  let fake: FakeEero | null = null;
  afterEach(async () => {
    await fake?.close();
    fake = null;
  });

  it("support.info reads /2.2/ support and the account log_id", async () => {
    const s = fakeEngine();
    fake = s.fake;
    const info = await ok(s.engine.execute<M.SupportInfo>("support.info", { networkId: "100001" }));
    expect(info.supportId).toBe((await s.backend.account.get()).id);
    expect(info.supportId).toBeTruthy();
    expect(info.eero).toEqual({
      name: "eero",
      phone: "+18775550123",
      email: "support@example.com",
      helpUrl: "https://support.example.com/help",
      contactUrl: "https://support.example.com/contact",
      emailFormUrl: "mailto:support@example.com?subject=eero%20support",
    });
    expect(info.isp?.phone).toBeNull();
    expect(s.fake.log.map((l) => l.path)).toContain("/2.2/networks/100001/support");
  });

  it("health.check builds from reads only: no POST, no diagnostics run", async () => {
    const s = fakeEngine();
    fake = s.fake;
    const r = await ok(s.engine.execute<M.HealthReport>("health.check", { networkId: "100001" }));
    expect(r.checks.length).toBeGreaterThanOrEqual(5);
    expect(r.checks.every((c) => ["good", "warning", "problem", "unknown"].includes(c.status))).toBe(true);
    expect(s.fake.log.every((l) => l.method === "GET")).toBe(true);
    expect(s.fake.log.some((l) => l.path.endsWith("/diagnostics"))).toBe(false);
  });

  it("support.report reads the last diagnostics and redacts the fake network", async () => {
    const s = fakeEngine();
    fake = s.fake;
    const text = await ok(s.engine.execute<string>("support.report", { networkId: "100001" }));
    for (const v of await sensitive(s.backend, "100001")) expect(text, v).not.toContain(v);
    expect(text).toContain("Status: completed");
    expect(s.fake.log.every((l) => l.method === "GET")).toBe(true);
  });
});

describe("diagnostics.run (demo)", () => {
  it("connection drops on Maple Street: mesh finding, next steps, and the next report shows the run", async () => {
    const { engine } = demo();
    const r = await ok(engine.execute<M.Diagnosis>("diagnostics.run", { networkId: MAPLE, symptom: "connection_drops" }));
    expect(r).toMatchObject({ status: "completed", issueArea: "mesh", symptom: "connection_drops", at: new Date(NOW).toISOString() });
    expect(r.results.find((x) => x.name === "Mesh")).toMatchObject({ status: "warning" });
    expect(r.steps[0]).toContain("weak link");
    expect(r.steps.at(-1)).toContain("coverage scan");
    const report = await ok(engine.execute<string>("support.report", { networkId: MAPLE }));
    expect(report).toContain("Status: completed, issue area: mesh");
  });

  it("runs without a symptom, around a device by name, and rejects a bad symptom or device", async () => {
    const { engine } = demo();
    const plain = await ok(engine.execute<M.Diagnosis>("diagnostics.run", { networkId: MAPLE }));
    expect(plain.symptom).toBeNull();
    const dev = await ok(engine.execute<M.Diagnosis>("diagnostics.run", { networkId: MAPLE, symptom: "internet_slow", device: "Alex's iPhone" }));
    expect(dev.results.map((x) => x.name)).toContain("Alex's iPhone");
    expect(await code(engine.execute("diagnostics.run", { networkId: MAPLE, symptom: "slow" }))).toBe("bad_params");
    expect(await code(engine.execute("diagnostics.run", { networkId: MAPLE, device: "Nobody's phone" }))).toBe("bad_params");
  });

  it("is a gated write that never asks to confirm and invalidates diagnostics", () => {
    const spec = diagnosticsCommands.find((c) => c.id === "diagnostics.run");
    expect(spec).toMatchObject({ effect: "write", gate: { area: "network" }, invalidates: ["diagnostics"] });
  });

  it("a run is pending while eero says not_started (the idle state captured on a real network) or running", () => {
    expect(["not_started", "running", "IN_PROGRESS"].map((status) => diagnosticsPending({ status }))).toEqual([true, true, true]);
    expect(["completed", "failed", "idle"].map((status) => diagnosticsPending({ status }))).toEqual([false, false, false]);
  });

  it("steps: one per flagged area, then the symptom's own", () => {
    const steps = diagnosisSteps({ status: "completed", issueArea: "internet", results: [{ name: "eeros", status: "fail", detail: null }, { name: "Mesh", status: "pass", detail: null }] }, "internet_offline");
    expect(steps).toHaveLength(3);
    expect(steps[0]).toContain("modem");
    expect(steps[1]).toContain("offline eero");
    expect(steps[2]).toContain("Restart the network");
    expect(diagnosisSteps({ status: "completed", issueArea: null, results: [] }, null)).toEqual([]);
  });
});

describe("diagnostics.run (fake eero server)", () => {
  const saved = { ...WAIT };
  beforeEach(() => Object.assign(WAIT, { intervalMs: 1, timeoutMs: 2_000 }));
  afterEach(() => Object.assign(WAIT, saved));

  it("posts {symptom} to {net}/diagnostics, reads while it runs, then maps the result", async () => {
    const s = fakeEngine();
    const r = await ok(s.engine.execute<M.Diagnosis>("diagnostics.run", { networkId: "100001", symptom: "connection_drops" }));
    expect(s.fake.writes.at(-1)).toMatchObject({ method: "POST", version: "2.2", route: "/networks/100001/diagnostics", body: { symptom: "connection_drops" } });
    const reads = s.fake.log.filter((l) => l.method === "GET" && l.path === "/2.2/networks/100001/diagnostics");
    expect(reads.length).toBe(RUN_READS);
    expect(r).toMatchObject({ status: "completed", issueArea: "mesh", symptom: "connection_drops" });
    expect(r.results.map((x) => x.name)).toEqual(["Internet", "Mesh", "eeros"]);
    expect(r.steps.length).toBeGreaterThan(1);
    await s.fake.close();
  });

  it("sends the device id when one is given", async () => {
    const s = fakeEngine();
    const devices = await ok(s.engine.execute<{ devices: M.Device[] }>("device.list", { networkId: "100001" }));
    const d = devices.devices[0];
    if (!d) throw new Error("no fake devices");
    await ok(s.engine.execute("diagnostics.run", { networkId: "100001", device: d.id }));
    expect(s.fake.writes.at(-1)?.body).toEqual({ device: d.id });
    await s.fake.close();
  });

  it("a run that never finishes fails eero_error instead of hanging", async () => {
    const s = fakeEngine();
    Object.assign(WAIT, { intervalMs: 1, timeoutMs: 20 });
    const extra = s.fake.state.extra;
    s.fake.state.extra = new Proxy(extra, { get: (t, k) => (String(k).startsWith("diagnostics:") ? { reads: 1e9 } : Reflect.get(t, k)) });
    expect(await code(s.engine.execute("diagnostics.run", { networkId: "100001" }))).toBe("eero_error");
    await s.fake.close();
  });
});

describe("diagnostics mapping", () => {
  it("maps a bare status and a full run", () => {
    expect(mapDiagnostics({ status: "idle" })).toEqual({ status: "idle", issueArea: null, results: [] });
    expect(mapDiagnostics(null)).toEqual({ status: null, issueArea: null, results: [] });
    expect(mapDiagnostics({ status: "completed", issue_area: "mesh", results: [{ name: "Mesh", status: "warning", detail: "weak" }, { status: "good" }] })).toEqual({
      status: "completed",
      issueArea: "mesh",
      results: [{ name: "Mesh", status: "warning", detail: "weak" }],
    });
  });

  it("reads an issue area of none as no area, so the summary does not name one", () => {
    for (const none of ["none", "NONE", "no_issue", "no_issues"]) expect(mapDiagnostics({ status: "completed", issue_area: none }).issueArea).toBeNull();
    expect(mapDiagnostics({ status: "completed", issue_area: "internet" }).issueArea).toBe("internet");
  });

  it("maps the 2.2 support object with no ISP", () => {
    expect(mapSupport({ name: " ", support_phone: "+15555550100" })).toEqual({
      eero: { name: null, phone: "+15555550100", email: null, helpUrl: null, contactUrl: null, emailFormUrl: null },
      isp: null,
    });
    expect(mapSupport(null).eero.phone).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Page-load budget: the Troubleshooting page's queries, run at once as React mounts them

const PAGE: [string, unknown?][] = [["auth.status"], ["account.get"], ["network.list"], ["network.get"], ["health.check"], ["support.info"], ["eero.list"], ["coverage.scan"], ["coverage.upgrade_report"]];

async function load(engine: Engine, page: [string, unknown?][]) {
  const results = await Promise.all(page.map(([id, params]) => engine.execute(id, params)));
  const failed = results.flatMap((r, i) => (r.ok ? [] : [`${page[i]?.[0]}: ${r.error.code} ${r.error.message}`]));
  expect(failed).toEqual([]);
}

describe("Troubleshooting page load against the fake eero server", () => {
  it("stays well inside the request budget and reads each resource once", async () => {
    const f = createFakeEero();
    const backend = createEeroBackend({ secrets: secrets(f.signIn()), origin: f.origin, fetch: f.fetch, readShareMs: READ_SHARE_MS, limiter: new RateLimiter() });
    const engine = createEngine({ backend });
    const started = Date.now();
    await load(engine, PAGE);
    expect(Date.now() - started).toBeLessThan(2_000);
    const reads = (path: string) => f.log.filter((e) => e.method === "GET" && e.path === path).length;
    expect(reads("/2.2/networks/100001")).toBe(1);
    expect(reads("/2.2/networks/100001/eeros")).toBe(1);
    expect(reads("/2.2/account")).toBe(1);
    expect(f.log.every((e) => e.method === "GET")).toBe(true);
    expect(f.log.length).toBeLessThanOrEqual(14);
    await f.close();
  });
});
