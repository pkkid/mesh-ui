import { afterEach, describe, expect, it } from "vitest";
import { createFakeEero, type FakeEero } from "../../../test/fake-eero/server";
import type { AuthState, Backend, SecretStore } from "../backend";
import { createDemoBackend } from "../demo";
import { createEeroBackend } from "../eero/backend";
import { mapIntegrations } from "../eero/map/settings";
import { createEngine } from "../engine";
import type * as M from "../model";

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
    expect(maple.smart_home_hub).toEqual({ available: false, enabled: null, detail: "Needs an eero with a Zigbee radio" });
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

describe("integrations mapping", () => {
  it("treats every missing field as unavailable, never an error", () => {
    const none = mapIntegrations({});
    for (const id of IDS) expect(none[id]).toMatchObject({ available: false, enabled: null });
    expect(mapIntegrations({ connection: { mode: "bridged" }, proxied_nodes: { enabled: true, devices: [] } }).builtin).toMatchObject({ available: false, detail: "Not available in bridge mode" });
    expect(mapIntegrations({ amazon_account_linked: false }).amazon).toEqual({ available: true, enabled: false, detail: "Link in the eero app" });
    expect(mapIntegrations({ proxied_nodes: { enabled: true, devices: [{}, {}] } }).builtin.detail).toBe("2 Echos extend your network");
  });
});
