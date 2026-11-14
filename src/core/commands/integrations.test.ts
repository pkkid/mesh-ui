import { afterEach, describe, expect, it } from "vitest";
import { createFakeEero, type FakeEero } from "../../../test/fake-eero/server";
import type { AuthState, Backend, SecretStore } from "../backend";
import { createDemoBackend } from "../demo";
import { createEeroBackend } from "../eero/backend";
import { mapIntegrations } from "../eero/map/settings";
import { createEngine } from "../engine";
import type * as M from "../model";
import { commands as integrationCommands } from "./integrations";

const NOW = Date.parse("2026-11-12T22:41:00Z");
const MAPLE = "4821907";
const MOM = "6092118";

type Result<R> = { ok: true; result: R } | { ok: false; error: { code: string; message: string } };
async function ok<R>(p: Promise<Result<R>>): Promise<R> {
  const r = await p;
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.result;
}
const code = async (p: Promise<{ ok: boolean; error?: { code: string } }>) => (await p).error?.code;

const demoEngine = (scenario?: "signed_out") => createEngine({ backend: createDemoBackend({ clock: () => NOW, scenario }), clock: () => NOW });
const IDS: M.IntegrationId[] = ["amazon", "builtin", "ffs", "homekit", "smart_home_hub"];

describe("integrations.get (demo)", () => {
  it("lists every integration with available and enabled", async () => {
    const maple = await ok(demoEngine().execute<M.Integrations>("integrations.get", { networkId: MAPLE }));
    expect(Object.keys(maple).sort()).toEqual(IDS);
    expect(maple.amazon).toMatchObject({ available: true, enabled: true });
    expect(maple.builtin).toMatchObject({ available: true, enabled: true, detail: "1 Echo extends your network" });
    expect(maple.smart_home_hub).toEqual({ available: true, enabled: null, detail: null });
  });

  it("marks bridge-mode features unavailable, with no enabled state", async () => {
    const mom = await ok(demoEngine().execute<M.Integrations>("integrations.get", { networkId: MOM }));
    expect(mom.homekit).toMatchObject({ available: false, enabled: null });
    expect(mom.builtin).toMatchObject({ available: false, enabled: null });
  });

  it("rejects bad params and needs a session", async () => {
    const engine = demoEngine();
    expect(await code(engine.execute("integrations.get", { amazon: true }))).toBe("bad_params");
    expect(await code(engine.execute("integrations.get", { networkId: "Nowhere" }))).toBe("bad_params");
    expect(await code(demoEngine("signed_out").execute("integrations.get"))).toBe("not_signed_in");
    expect(engine.commands().find((c) => c.id === "integrations.get")).toMatchObject({ effect: "query", sensitive: false });
  });
});

const LAKE = "5130264";
const get = (engine: ReturnType<typeof demoEngine>, networkId = MAPLE) => ok(engine.execute<M.Integrations>("integrations.get", { networkId }));
const WRITES = ["integrations.builtin.set", "integrations.ffs.set", "integrations.zigbee.discover", "integrations.amazon.unlink"] as const;
const VALID: Record<(typeof WRITES)[number], Record<string, unknown>> = {
  "integrations.builtin.set": { enabled: false },
  "integrations.ffs.set": { enabled: false },
  "integrations.zigbee.discover": {},
  "integrations.amazon.unlink": { confirm: true },
};

describe("integrations writes (demo)", () => {
  it("eero Built-in and Frustration-Free Setup switch off and on, and the next read shows it", async () => {
    const engine = demoEngine();
    expect((await ok(engine.execute<M.Integrations>("integrations.builtin.set", { networkId: MAPLE, enabled: false }))).builtin.enabled).toBe(false);
    expect((await get(engine)).builtin).toMatchObject({ available: true, enabled: false });
    await ok(engine.execute("integrations.builtin.set", { networkId: MAPLE, enabled: true }));
    expect((await get(engine)).builtin.enabled).toBe(true);
    expect((await ok(engine.execute<M.Integrations>("integrations.ffs.set", { networkId: MAPLE, enabled: false }))).ffs.enabled).toBe(false);
    expect((await get(engine)).ffs).toMatchObject({ available: true, enabled: false });
    await ok(engine.execute("integrations.ffs.set", { networkId: LAKE, enabled: true }));
    expect((await get(engine, LAKE)).ffs.enabled).toBe(true);
  });

  it("refuses an unavailable integration with eero's reason, before anything changes", async () => {
    const engine = demoEngine();
    const bridged = await engine.execute("integrations.builtin.set", { networkId: MOM, enabled: true });
    expect(bridged).toMatchObject({ ok: false, error: { code: "bad_params", message: "eero Built-in is not available on this network: Not available in bridge mode." } });
    const hub = await engine.execute("integrations.zigbee.discover", { networkId: LAKE });
    expect(hub).toMatchObject({ ok: false, error: { code: "bad_params", message: "Smart Home Hub is not available on this network: Needs an eero with a Zigbee radio." } });
    // Not linked: nothing to unlink, and the confirm is never asked.
    expect(await engine.execute("integrations.amazon.unlink", { networkId: LAKE })).toMatchObject({ ok: false, error: { code: "bad_params", message: "This network is not linked to an Amazon account." } });
    expect(await code(engine.execute("integrations.amazon.unlink", { networkId: LAKE, confirm: true }))).toBe("bad_params");
    expect((await get(engine, MOM)).builtin).toMatchObject({ available: false, enabled: null });
  });

  it("starts Zigbee discovery on a network with a Smart Home Hub", async () => {
    expect(await ok(demoEngine().execute("integrations.zigbee.discover", { networkId: MAPLE }))).toEqual({ started: true });
  });

  it("unlinking Amazon needs confirm, then the next read shows it unlinked", async () => {
    const engine = demoEngine();
    const ask = await engine.execute("integrations.amazon.unlink", { networkId: MAPLE });
    expect(ask).toMatchObject({ ok: false, error: { code: "needs_confirm" } });
    expect(ask.ok ? "" : ask.error.message).toContain("Linking again needs Amazon sign-in in the eero app");
    expect((await get(engine)).amazon.enabled).toBe(true);
    expect(await code(engine.execute("integrations.amazon.unlink", { networkId: MAPLE, confirm: false }))).toBe("needs_confirm");
    await ok(engine.execute("integrations.amazon.unlink", { networkId: MAPLE, confirm: true }));
    expect((await get(engine)).amazon).toEqual({ available: true, enabled: false, detail: "Link in the eero app" });
    expect(await code(engine.execute("integrations.amazon.unlink", { networkId: MAPLE, confirm: true }))).toBe("bad_params");
  });

  it("rejects bad params and needs a session", async () => {
    for (const id of WRITES) {
      expect(await code(demoEngine().execute(id, { ...VALID[id], extra: 1 })), id).toBe("bad_params");
      expect(await code(demoEngine().execute(id, { ...VALID[id], networkId: "Nowhere" })), id).toBe("bad_params");
      expect(await code(demoEngine("signed_out").execute(id, VALID[id])), id).toBe("not_signed_in");
    }
    for (const id of ["integrations.builtin.set", "integrations.ffs.set"]) {
      expect(await code(demoEngine().execute(id, {})), id).toBe("bad_params");
      expect(await code(demoEngine().execute(id, { enabled: "yes" })), id).toBe("bad_params");
    }
  });

  it("declares effect, gate and the topics each write invalidates", () => {
    const spec = (id: string) => integrationCommands.find((c) => c.id === id);
    expect(spec("integrations.builtin.set")).toMatchObject({ effect: "write", gate: { area: "network.proxied_nodes", bridgeOff: true }, invalidates: ["integrations", "devices"] });
    expect(spec("integrations.ffs.set")).toMatchObject({ effect: "write", gate: { area: "network" }, invalidates: ["integrations"] });
    expect(spec("integrations.zigbee.discover")).toMatchObject({ effect: "write", gate: { area: "network.smart_home_hub" }, invalidates: ["integrations"] });
    expect(spec("integrations.amazon.unlink")).toMatchObject({ effect: "destructive", gate: { area: "amazon.account", op: "delete" }, invalidates: ["integrations", "network"] });
  });
});

const signedIn: AuthState = { signedIn: true, pending: false, login: null, storage: "memory" };
const secrets = (token: string): SecretStore => ({ load: async () => token, save: async () => "memory", clear: async () => {}, storage: async () => "memory" });

function fakeEngine(prepare?: (fake: FakeEero) => void) {
  const fake = createFakeEero({ now: () => NOW });
  prepare?.(fake);
  const eero = createEeroBackend({ secrets: secrets(fake.signIn()), origin: fake.origin, fetch: fake.fetch });
  const backend: Backend = { ...eero, auth: { ...eero.auth, status: async () => signedIn } };
  return { fake, engine: createEngine({ backend, clock: () => NOW }) };
}

describe("integrations.get (fake eero server)", () => {
  let fake: FakeEero | null = null;
  afterEach(async () => {
    await fake?.close();
    fake = null;
  });

  it("reads everything from GET {net}: HomeKit null is unavailable, eero Built-in from the embedded proxied_nodes", async () => {
    const s = fakeEngine();
    fake = s.fake;
    const maple = await ok(s.engine.execute<M.Integrations>("integrations.get", { networkId: "100001" }));
    expect(maple).toEqual({
      homekit: { available: false, enabled: null, detail: "Not reported for this network's eeros" },
      amazon: { available: true, enabled: true, detail: "Linked to an Amazon account" },
      builtin: { available: true, enabled: true, detail: "1 Echo extends your network" },
      smart_home_hub: { available: false, enabled: null, detail: "Needs an eero with a Zigbee radio" },
      ffs: { available: true, enabled: true, detail: null },
    });
    // Never the 404 route: state lives on the network object.
    expect(s.fake.log.map((l) => l.path)).not.toContain("/2.2/networks/100001/proxied_nodes");
    const lake = await ok(s.engine.execute<M.Integrations>("integrations.get", { networkId: "100002" }));
    expect(lake).toMatchObject({ amazon: { available: true, enabled: false }, builtin: { available: true, enabled: false, detail: null } });
  });

  it("maps HomeKit when eero sends it", async () => {
    const s = fakeEngine((f) => {
      const n = f.state.networks.get("100001")?.network;
      if (n) n.homekit = { enabled: true };
    });
    fake = s.fake;
    expect((await ok(s.engine.execute<M.Integrations>("integrations.get"))).homekit).toEqual({ available: true, enabled: true, detail: null });
  });
});

describe("integrations writes (fake eero server)", () => {
  let fake: FakeEero | null = null;
  afterEach(async () => {
    await fake?.close();
    fake = null;
  });
  const start = (prepare?: (fake: FakeEero) => void) => {
    const s = fakeEngine(prepare);
    fake = s.fake;
    return s;
  };

  it("eero Built-in sends PUT {net}/proxied_nodes JSON {enabled} and the next read shows it", async () => {
    const s = start();
    const after = await ok(s.engine.execute<M.Integrations>("integrations.builtin.set", { networkId: "100001", enabled: false }));
    expect(s.fake.writes.at(-1)).toMatchObject({ method: "PUT", version: "2.2", route: "/networks/100001/proxied_nodes", encoding: "json", body: { enabled: false } });
    expect(after.builtin).toMatchObject({ available: true, enabled: false });
    expect(s.fake.state.networks.get("100001")?.network.proxied_nodes?.enabled).toBe(false);
  });

  it("Frustration-Free Setup sends PUT {net}/settings JSON {ffs}, and the Wi-Fi rename still reaches its route", async () => {
    const s = start();
    const after = await ok(s.engine.execute<M.Integrations>("integrations.ffs.set", { networkId: "100001", enabled: false }));
    expect(s.fake.writes.at(-1)).toMatchObject({ method: "PUT", version: "2.2", route: "/networks/100001/settings", encoding: "json", body: { ffs: false } });
    expect(after.ffs).toEqual({ available: true, enabled: false, detail: null });
    // The fake passes a body without ffs on to the next PUT {net}/settings route.
    await ok(s.engine.execute("wifi.name.set", { networkId: "100001", name: "Fake Renamed", confirm: true }));
    expect(s.fake.state.networks.get("100001")?.network).toMatchObject({ name: "Fake Renamed", ffs: false });
  });

  it("Zigbee discovery sends POST /2.3/networks/{id}/shh/start_zigbee_discovery with no body", async () => {
    const s = start((f) => {
      const n = f.state.networks.get("100001")?.network;
      if (n) n.capabilities = { ...n.capabilities, smart_home_hub: { capable: true } };
    });
    expect(await ok(s.engine.execute("integrations.zigbee.discover", { networkId: "100001" }))).toEqual({ started: true });
    expect(s.fake.writes.at(-1)).toMatchObject({ method: "POST", version: "2.3", route: "/networks/100001/shh/start_zigbee_discovery", body: {} });
  });

  it("Amazon unlink sends POST /2.2/amazon/networks/{id}/account_unlink after confirm", async () => {
    const s = start();
    expect(await code(s.engine.execute("integrations.amazon.unlink", { networkId: "100001" }))).toBe("needs_confirm");
    expect(s.fake.writes).toHaveLength(0);
    const after = await ok(s.engine.execute<M.Integrations>("integrations.amazon.unlink", { networkId: "100001", confirm: true }));
    expect(s.fake.writes.at(-1)).toMatchObject({ method: "POST", version: "2.2", route: "/amazon/networks/100001/account_unlink" });
    expect(after.amazon).toEqual({ available: true, enabled: false, detail: "Link in the eero app" });
  });

  it("unavailable integrations send nothing and say why", async () => {
    const s = start((f) => {
      const n = f.state.networks.get("100001")?.network;
      if (n) delete n.ffs;
    });
    expect(await s.engine.execute("integrations.zigbee.discover", { networkId: "100001" })).toMatchObject({
      ok: false,
      error: { code: "bad_params", message: "Smart Home Hub is not available on this network: Needs an eero with a Zigbee radio." },
    });
    expect(await code(s.engine.execute("integrations.ffs.set", { networkId: "100001", enabled: true }))).toBe("bad_params");
    // Lake Cabin is not linked to Amazon.
    expect(await code(s.engine.execute("integrations.amazon.unlink", { networkId: "100002", confirm: true }))).toBe("bad_params");
    expect(s.fake.writes).toHaveLength(0);
  });

  it("an eero refusal maps to eero_error", async () => {
    const s = start();
    s.fake.scenarios.fail(403, "error.network.forbidden", { method: "PUT", path: "/networks/100001/proxied_nodes" });
    expect(await code(s.engine.execute("integrations.builtin.set", { networkId: "100001", enabled: false }))).toBe("eero_error");
  });
});

describe("integrations mapping", () => {
  it("treats every missing field as unavailable, never an error", () => {
    const none = mapIntegrations({});
    for (const id of IDS) expect(none[id]).toMatchObject({ available: false, enabled: null });
    expect(mapIntegrations({ connection: { mode: "bridged" }, proxied_nodes: { enabled: true, devices: [] } }).builtin).toMatchObject({ available: false, detail: "Not available in bridge mode" });
    expect(mapIntegrations({ amazon_account_linked: false }).amazon).toEqual({ available: true, enabled: false, detail: "Link in the eero app" });
    expect(mapIntegrations({ proxied_nodes: { enabled: true, devices: [{}, {}] } }).builtin.detail).toBe("2 Echos extend your network");
  });
});
