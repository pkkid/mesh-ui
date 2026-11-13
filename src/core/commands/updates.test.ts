import { describe, expect, it } from "vitest";
import { createFakeEero, type FakeEero } from "../../../test/fake-eero/server";
import type { AuthState, Backend, SecretStore } from "../backend";
import { createDemoBackend } from "../demo";
import { createEeroBackend } from "../eero/backend";
import { mapUpdates, updateStatus } from "../eero/map/updates";
import { createEngine } from "../engine";
import type * as M from "../model";

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

const demoEngine = (scenario?: "signed_out") =>
  createEngine({ backend: createDemoBackend({ clock: () => NOW, scenario }), clock: () => NOW });

describe("updates.get (demo)", () => {
  it("returns the current, target and per-eero versions", async () => {
    const engine = demoEngine();
    const maple = await ok(engine.execute<M.Updates>("updates.get", { networkId: MAPLE }));
    expect(maple).toMatchObject({ status: "scheduled", current: "7.12.1", target: "7.13.0", canUpdateNow: true, preferredHour: 2, stuckEeros: [] });
    expect(maple.eeros.map((e) => e.location)).toEqual(["Living Room", "Office", "Upstairs Hall", "Garage"]);
    expect(maple.eeros.every((e) => e.firmware === "7.12.1")).toBe(true);
    expect(await ok(engine.execute<M.Updates>("updates.get", { networkId: LAKE }))).toMatchObject({ status: "up_to_date", target: null });
    expect(await ok(engine.execute<M.Updates>("updates.get", { networkId: MOM }))).toMatchObject({ status: "available", target: "7.13.0" });
  });

  it("rejects bad params and needs a session", async () => {
    const engine = demoEngine();
    expect(await code(engine.execute("updates.get", { extra: 1 }))).toBe("bad_params");
    expect(await code(engine.execute("updates.get", { networkId: "Nowhere" }))).toBe("bad_params");
    expect(await code(demoEngine("signed_out").execute("updates.get"))).toBe("not_signed_in");
  });

  it("is a cached query on the updates poll", () => {
    const info = demoEngine().commands().find((c) => c.id === "updates.get");
    expect(info).toMatchObject({ effect: "query", scope: "network", poll: 900 });
  });
});

// ---------------------------------------------------------------------------
// Real eero backend against the fake eero server

const signedIn: AuthState = { signedIn: true, pending: false, login: null, storage: "memory" };
const secrets = (token: string): SecretStore => ({ load: async () => token, save: async () => "memory", clear: async () => {}, storage: async () => "memory" });

function fakeEngine(prepare?: (fake: FakeEero) => void) {
  const fake = createFakeEero({ now: () => NOW });
  prepare?.(fake);
  const eero = createEeroBackend({ secrets: secrets(fake.signIn()), origin: fake.origin, fetch: fake.fetch });
  const backend: Backend = { ...eero, auth: { ...eero.auth, status: async () => signedIn } };
  return { fake, engine: createEngine({ backend, clock: () => NOW }) };
}

describe("updates.get (fake eero server)", () => {
  it("maps GET {net}/updates with versions from GET {net}/eeros", async () => {
    const { engine, fake } = fakeEngine();
    const maple = await ok(engine.execute<M.Updates>("updates.get", { networkId: "100001" }));
    expect(maple).toEqual({
      status: "available",
      current: "7.10.1",
      target: "7.11.0",
      canUpdateNow: true,
      required: false,
      scheduledAt: null,
      preferredHour: 3,
      lastUpdatedAt: "2026-11-05T03:00:00.000Z",
      eeros: [
        { id: "500001", location: "Living Room", firmware: "7.10.1" },
        { id: "500002", location: "Office", firmware: "7.10.1" },
        { id: "500003", location: "Upstairs Hall", firmware: "7.10.1" },
        { id: "500004", location: "Garage", firmware: "7.10.1" },
      ],
      stuckEeros: [],
    });
    const paths = fake.log.map((l) => l.path);
    expect(paths).toContain("/2.2/networks/100001/updates");
    expect(paths).toContain("/2.2/networks/100001/eeros");
    const lake = await ok(engine.execute<M.Updates>("updates.get", { networkId: "100002" }));
    expect(lake).toMatchObject({ status: "up_to_date", target: null, canUpdateNow: false });
  });

  it("maps a scheduled update and stuck eeros", async () => {
    const { engine } = fakeEngine((fake) => {
      const u = fake.state.networks.get("100001")?.updates;
      if (!u) return;
      u.update_status = "scheduled";
      u.scheduled_update_time = "2026-11-14T07:00:00+0000";
      u.last_user_update = { unresponsive_eeros: [{ url: "/2.2/eeros/500004" }], incomplete_eeros: ["/2.2/eeros/500003", "/2.2/eeros/500004"] };
    });
    const u = await ok(engine.execute<M.Updates>("updates.get", { networkId: "100001" }));
    expect(u).toMatchObject({ status: "scheduled", scheduledAt: "2026-11-14T07:00:00.000Z", stuckEeros: ["500004", "500003"] });
  });
});

describe("updates mapping", () => {
  it("reads status words and falls back to has_update", () => {
    expect(["up_to_date", "available", "scheduled", "updating", "IN_PROGRESS"].map((w) => updateStatus({ update_status: w }))).toEqual(["up_to_date", "available", "scheduled", "installing", "installing"]);
    expect(updateStatus({})).toBe("up_to_date");
    expect(updateStatus({ has_update: true })).toBe("available");
    expect(updateStatus({ has_update: true, scheduled_update_time: "2026-11-14T07:00:00Z" })).toBe("scheduled");
  });

  it("treats missing fields as null, not zero", () => {
    expect(mapUpdates(null, [])).toEqual({
      status: "up_to_date",
      current: null,
      target: null,
      canUpdateNow: false,
      required: false,
      scheduledAt: null,
      preferredHour: null,
      lastUpdatedAt: null,
      eeros: [],
      stuckEeros: [],
    });
    expect(mapUpdates({ preferred_update_hour: 30, has_update: true, update_to_firmware: "7.13.0" }, []).preferredHour).toBeNull();
    expect(mapUpdates({ has_update: true, update_to_firmware: "7.13.0" }, []).target).toBe("7.13.0");
  });
});
