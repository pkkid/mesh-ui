import { describe, expect, it } from "vitest";
import { createFakeEero, type FakeEero } from "../../../test/fake-eero/server";
import type { AuthState, Backend, SecretStore } from "../backend";
import { createDemoBackend } from "../demo";
import { createEeroBackend } from "../eero/backend";
import { isPrivateIpv4, mapHealth, mapMessages, mapPermissions, mapRole, mapStatus, networkStatus, portSpeedMbps, toIso } from "../eero/map/network";
import { createEngine, memorySettings } from "../engine";
import type * as M from "../model";
import type { SettingsStore } from "../spec";

const NOW = Date.parse("2026-11-12T22:41:00Z");
const MAPLE = "4821907";
const LAKE = "5130264";
const MOM = "6092118";

function demoEngine(opts: { scenario?: NonNullable<Parameters<typeof createDemoBackend>[0]>["scenario"]; settings?: SettingsStore } = {}) {
  const engine = createEngine({ backend: createDemoBackend({ clock: () => NOW, scenario: opts.scenario }), clock: () => NOW, settings: opts.settings });
  const events: M.HostEvent[] = [];
  engine.onEvent((e) => events.push(e));
  return { engine, events };
}

async function ok<R>(p: Promise<{ ok: true; result: R } | { ok: false; error: { code: string; message: string } }>): Promise<R> {
  const r = await p;
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.result;
}

const code = async (p: Promise<{ ok: boolean; error?: { code: string } }>) => (await p).error?.code;

// ---------------------------------------------------------------------------
// Demo backend through the engine

describe("network commands (demo)", () => {
  it("network.list shows no selection until one is made, then marks it", async () => {
    const settings = memorySettings();
    const { engine, events } = demoEngine({ settings });
    const before = await ok(engine.execute<M.NetworkSummary[]>("network.list"));
    expect(before.map((n) => [n.name, n.role, n.status, n.selected])).toEqual([
      ["Maple Street", "owner", "online", false],
      ["Lake Cabin", "owner", "offline", false],
      ["Kim Home", "admin", "online", false],
    ]);
    expect(events).toEqual([]);

    expect(await ok(engine.execute("network.select", { network: "mom's house" }))).toEqual({ networkId: MOM });
    expect(events).toEqual([{ type: "network.selected", networkId: MOM }]);
    expect((await settings.get()).lastNetworkId).toBe(MOM);
    expect(engine.selectedNetworkId()).toBe(MOM);
    const after = await ok(engine.execute<M.NetworkSummary[]>("network.list"));
    expect(after.filter((n) => n.selected).map((n) => n.id)).toEqual([MOM]);
  });

  it("switching networks emits network.selected and changes what network-scoped commands read", async () => {
    const { engine, events } = demoEngine();
    await ok(engine.execute("network.select", { network: "Lake Cabin" }));
    expect((await ok(engine.execute<M.Network>("network.get"))).name).toBe("Lake Cabin");
    await ok(engine.execute("network.select", { network: MAPLE }));
    const maple = await ok(engine.execute<M.Network>("network.get"));
    expect(maple).toMatchObject({ id: MAPLE, name: "Maple Street", selected: true });
    expect(events).toEqual([
      { type: "network.selected", networkId: LAKE },
      { type: "network.selected", networkId: MAPLE },
    ]);
    // networkId reads another network without changing the selection.
    const lake = await ok(engine.execute<M.Network>("network.get", { networkId: "Lake Cabin" }));
    expect(lake).toMatchObject({ id: LAKE, selected: false });
    expect(engine.selectedNetworkId()).toBe(MAPLE);
  });

  it("starts on the saved network", async () => {
    const { engine } = demoEngine({ settings: memorySettings({ lastNetworkId: LAKE }) });
    expect((await ok(engine.execute<M.NetworkSummary[]>("network.list"))).find((n) => n.selected)?.id).toBe(LAKE);
    expect((await ok(engine.execute<M.Network>("network.get"))).id).toBe(LAKE);
  });

  it("network.get, health and permissions return the model", async () => {
    const { engine } = demoEngine();
    const net = await ok(engine.execute<M.Network>("network.get", { networkId: MOM }));
    expect(net).toMatchObject({ connectionMode: "bridged", role: "admin" });
    const health = await ok(engine.execute<M.NetworkHealth>("network.health", { networkId: MAPLE }));
    expect(health.eeros.filter((e) => e.weakLink).map((e) => e.location)).toEqual(["Garage"]);
    const perms = await ok(engine.execute<M.Permissions>("network.permissions", { networkId: MOM }));
    expect(perms.role).toBe("admin");
    expect(perms.can["network.transfer"]?.update).toBe(false);
  });

  it("rejects bad params", async () => {
    const { engine, events } = demoEngine();
    expect(await code(engine.execute("network.list", { extra: 1 }))).toBe("bad_params");
    expect(await code(engine.execute("network.list", { networkId: MAPLE }))).toBe("bad_params");
    expect(await code(engine.execute("network.select", {}))).toBe("bad_params");
    expect(await code(engine.execute("network.select", { network: "" }))).toBe("bad_params");
    expect(await code(engine.execute("network.select", { network: "Nowhere" }))).toBe("bad_params");
    for (const id of ["network.get", "network.health", "network.permissions"]) {
      expect(await code(engine.execute(id, { extra: true }))).toBe("bad_params");
      expect(await code(engine.execute(id, { networkId: "Nowhere" }))).toBe("bad_params");
    }
    expect(events).toEqual([]);
  });

  it("needs a session", async () => {
    const { engine } = demoEngine({ scenario: "signed_out" });
    for (const id of ["network.list", "network.get", "network.health", "network.permissions"]) {
      expect(await code(engine.execute(id))).toBe("not_signed_in");
    }
    expect(await code(engine.execute("network.select", { network: "Maple Street" }))).toBe("not_signed_in");
  });

  it("registers the right effects, scopes and polls", () => {
    const { engine } = demoEngine();
    const info = Object.fromEntries(engine.commands().map((c) => [c.id, c]));
    expect(info["network.list"]).toMatchObject({ effect: "query", scope: "account" });
    expect(info["network.select"]).toMatchObject({ effect: "write", scope: "account" });
    expect(info["network.get"]).toMatchObject({ effect: "query", scope: "network", poll: 60 });
    expect(info["network.health"]).toMatchObject({ effect: "query", scope: "network", poll: 60 });
    expect(info["network.permissions"]).toMatchObject({ effect: "query", scope: "network" });
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
  const engine = createEngine({ backend, clock: () => NOW, settings: opts.settings });
  const events: M.HostEvent[] = [];
  engine.onEvent((e) => events.push(e));
  return { fake, engine, events };
}

describe("network commands (fake eero server)", () => {
  it("network.list maps the account's networks with role, status and counts", async () => {
    const { engine, fake } = fakeEngine();
    const nets = await ok(engine.execute<M.NetworkSummary[]>("network.list"));
    expect(nets).toEqual([
      { id: "100001", name: "Maple Street", nickname: null, role: "owner", status: "online", eeroCount: 4, devicesOnline: 7, isp: "Example Fiber", updateAvailable: true, lastSeen: null, selected: false },
      { id: "100002", name: "Lake Cabin", nickname: null, role: "admin", status: "offline", eeroCount: 1, devicesOnline: 0, isp: "Example Fiber", updateAvailable: false, lastSeen: "2026-11-12T18:00:00Z", selected: false },
    ]);
    const paths = fake.log.map((l) => l.path).sort();
    expect(paths).toEqual(["/2.2/account", "/2.2/networks/100001", "/2.2/networks/100001/permissions", "/2.2/networks/100002", "/2.2/networks/100002/permissions"]);
  });

  it("falls back to /networks, and keeps a network it cannot read", async () => {
    const { engine } = fakeEngine({
      prepare: (fake) => {
        fake.state.account.networks = { count: 0, data: [] };
      },
    });
    expect((await ok(engine.execute<M.NetworkSummary[]>("network.list"))).map((n) => n.id)).toEqual(["100001", "100002"]);

    const gone = fakeEngine({ prepare: (fake) => fake.state.networks.delete("100002") });
    const nets = await ok(gone.engine.execute<M.NetworkSummary[]>("network.list"));
    expect(nets[1]).toMatchObject({ id: "100002", name: "Lake Cabin", status: "unknown", role: "owner", eeroCount: null });
  });

  it("network.select emits network.selected; network.get reads the selected network", async () => {
    const { engine, events } = fakeEngine();
    await ok(engine.execute("network.select", { network: "lake cabin" }));
    expect(events).toEqual([{ type: "network.selected", networkId: "100002" }]);
    const net = await ok(engine.execute<M.Network>("network.get"));
    expect(net).toMatchObject({
      id: "100002",
      role: "admin",
      status: "offline",
      selected: true,
      timezone: "America/New_York",
      connectionMode: "nat",
      gatewayUptimeSec: 7 * 86_400,
      lastReboot: "2026-11-05T03:00:00Z",
      counts: { eeros: 1, devices: 0, profiles: 0 },
    });
    expect(net.capabilities).toMatchObject({ device_blacklist: true, thread_network: false });
  });

  it("network.health derives eero status and weak links from GET {net}", async () => {
    const { engine, fake } = fakeEngine();
    await ok(engine.execute("network.permissions")); // warms the network ref list
    fake.log.length = 0;
    const health = await ok(engine.execute<M.NetworkHealth>("network.health", { networkId: "Maple Street" }));
    expect(health).toMatchObject({ status: "online", internet: { status: "online", ispUp: true }, mesh: { status: "online" }, messages: [] });
    expect(health.eeros).toEqual([
      { id: "500001", location: "Living Room", status: "online", meshBars: null, weakLink: false },
      { id: "500002", location: "Office", status: "online", meshBars: 5, weakLink: false },
      { id: "500003", location: "Upstairs Hall", status: "online", meshBars: 4, weakLink: false },
      { id: "500004", location: "Garage", status: "degraded", meshBars: 1, weakLink: true },
    ]);
    expect(fake.log.filter((l) => l.path.startsWith("/2.2/networks/100001")).map((l) => l.path)).toEqual(["/2.2/networks/100001"]);
    expect(fake.log).toHaveLength(1);
  });

  it("network.permissions maps role and areas, without per_eero", async () => {
    const { engine } = fakeEngine();
    const owner = await ok(engine.execute<M.Permissions>("network.permissions", { networkId: "100001" }));
    expect(owner.role).toBe("owner");
    expect(owner.can["network.transfer"]).toEqual({ read: true, create: true, update: true, delete: true });
    const admin = await ok(engine.execute<M.Permissions>("network.permissions", { networkId: "100002" }));
    expect(admin.role).toBe("admin");
    expect(admin.can["network.transfer"]).toEqual({ read: true, create: false, update: false, delete: false });
  });

  it("maps eero errors for an unknown network", async () => {
    const { engine } = fakeEngine();
    expect(await code(engine.execute("network.get", { networkId: "999999" }))).toBe("bad_params");
    await expect(engine.backend.network.get("999999")).rejects.toMatchObject({ code: "eero_error" });
  });
});

describe("network mapping", () => {
  it("maps status words, roles and messages", () => {
    expect(["connected", "online", "offline", "disconnected", "updating", "green", "yellow", "red", "weird", undefined].map(mapStatus)).toEqual([
      "online", "online", "offline", "offline", "updating", "online", "degraded", "offline", "unknown", "unknown",
    ]);
    expect(["owner", "standard-admin", "admin", "viewer", null].map(mapRole)).toEqual(["owner", "admin", "admin", null, null]);
    expect(mapMessages(["Plain", { title: "Titled" }, { message: "Msg" }, 4, null, ""])).toEqual(["Plain", "Titled", "Msg"]);
  });

  it("downgrades online to degraded for a red eero or the ISP down", () => {
    expect(networkStatus({ status: "connected", eeros: { data: [{ status: "red" }] } })).toBe("degraded");
    expect(networkStatus({ status: "connected", health: { internet: { isp_up: false } } })).toBe("degraded");
    expect(networkStatus({ status: "connected", eeros: { data: [{ status: "yellow" }] } })).toBe("online");
    expect(networkStatus({ status: "offline", eeros: { data: [{ status: "red" }] } })).toBe("offline");
  });

  it("treats missing fields as null, not zero", () => {
    const health = mapHealth({ eeros: { data: [{ url: "/2.2/eeros/9", location: "Den" }] } });
    expect(health).toEqual({
      status: "unknown",
      internet: { status: "unknown", ispUp: null },
      mesh: { status: "unknown" },
      eeros: [{ id: "9", location: "Den", status: "unknown", meshBars: null, weakLink: false }],
      messages: [],
    });
    expect(mapPermissions({ permissions: { eeros: { read: true } } })).toEqual({ role: null, can: { eeros: { read: true, create: false, update: false, delete: false } } });
  });

  it("parses eero dates, port speeds and private addresses", () => {
    expect(toIso("2026-11-12T03:00:00+0000")).toBe("2026-11-12T03:00:00Z");
    expect(toIso("2026-11-12T03:00:00.250Z")).toBe("2026-11-12T03:00:00.250Z");
    expect(toIso("soon")).toBeNull();
    expect([portSpeedMbps("P2500"), portSpeedMbps("1000"), portSpeedMbps("fast"), portSpeedMbps(undefined)]).toEqual([2500, 1000, null, null]);
    expect(["10.0.0.1", "172.20.1.1", "192.168.1.1", "100.64.0.1", "203.0.113.9", "172.32.0.1", "nope"].map(isPrivateIpv4)).toEqual([true, true, true, true, false, false, false]);
  });
});
