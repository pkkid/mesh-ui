import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { type AuthState, composeBackend } from "./backend";
import { createEngine, fileSettings, memorySettings } from "./engine";
import { BackendError } from "./errors";
import type { Device, HostEvent, NetworkSummary } from "./model";
import { createRegistry } from "./registry";
import { type AnyCommand, defineCommand, ref } from "./spec";

const network = (id: string, name: string): NetworkSummary => ({
  id,
  name,
  nickname: null,
  role: "owner",
  status: "online",
  eeroCount: 1,
  devicesOnline: 1,
  isp: null,
  updateAvailable: null,
  lastSeen: null,
  selected: false,
});

const device = (id: string, name: string, mac: string): Device =>
  ({ id, name, mac, nickname: null, hostname: null, connected: true }) as Device;

function setup(opts: { signedIn?: boolean; specs?: AnyCommand[]; now?: () => number } = {}) {
  const auth: AuthState = { signedIn: opts.signedIn ?? true, pending: false, login: null, storage: "memory" };
  const calls = { networks: 0, devices: 0, ran: [] as string[] };
  let failWith: unknown = null;
  const backend = composeBackend("demo", {
    auth: {
      status: async () => auth,
      start: async () => {},
      verify: async () => {},
      resend: async () => {},
      logout: async () => {},
    },
    network: {
      list: async () => {
        calls.networks++;
        return [network("n1", "Maple Street"), network("n2", "Lake Cabin"), network("n3", "lake cabin")];
      },
      get: async () => {
        throw new Error("unused");
      },
      health: async () => {
        throw new Error("unused");
      },
      permissions: async () => {
        throw new Error("unused");
      },
    },
    device: {
      list: async () => {
        calls.devices++;
        if (failWith) throw failWith;
        return [device("aa0000000001", "Leo's Switch", "aa:00:00:00:00:01"), device("aa0000000002", "Office Printer", "aa:00:00:00:00:02")];
      },
      get: async () => {
        throw new Error("unused");
      },
      requestBurst: async () => ({ nextBurstAt: "2026-11-12T00:00:12Z" }),
    },
  });

  const specs: AnyCommand[] = opts.specs ?? [
    defineCommand({
      id: "test.devices",
      label: "Devices",
      params: z.object({ search: z.string().optional() }),
      effect: "query",
      topic: "devices",
      run: async (ctx) => ({ net: ctx.net, devices: await ctx.backend.device.list(ctx.net) }),
    }),
    defineCommand({
      id: "test.device.pick",
      label: "Pick device",
      params: z.object({ device: ref("device") }),
      effect: "query",
      run: async (ctx, p) => ctx.resolve("device", p.device),
    }),
    defineCommand({
      id: "test.device.pause",
      label: "Pause device",
      params: z.object({ device: ref("device") }),
      effect: "write",
      invalidates: ["devices"],
      run: async (_ctx, p) => {
        calls.ran.push(`pause ${p.device}`);
        return { paused: true };
      },
    }),
    defineCommand({
      id: "test.network.restart",
      label: "Restart network",
      params: z.object({}),
      effect: "disruptive",
      confirmMessage: (ctx) => `Restarts every eero on ${ctx.net}.`,
      run: async (ctx) => {
        calls.ran.push("restart");
        return { restarted: ctx.net };
      },
    }),
    defineCommand({
      id: "test.profile.delete",
      label: "Delete profile",
      params: z.object({ profile: ref("profile") }),
      effect: "destructive",
      run: async () => {
        calls.ran.push("delete");
        return { deleted: true };
      },
    }),
    defineCommand({
      id: "test.app.ping",
      label: "Ping",
      params: z.object({}),
      effect: "query",
      scope: "app",
      run: async () => "pong",
    }),
  ];

  const settings = memorySettings();
  const engine = createEngine({ backend, commands: specs, settings, clock: opts.now });
  const events: HostEvent[] = [];
  engine.onEvent((e) => events.push(e));
  return {
    engine,
    calls,
    events,
    settings,
    auth,
    fail: (err: unknown) => {
      failWith = err;
    },
  };
}

describe("engine.execute", () => {
  it("returns unknown_command for an id that is not registered", async () => {
    const { engine } = setup();
    const res = await engine.execute("nope.list");
    expect(res).toEqual({ ok: false, error: { code: "unknown_command", message: 'Unknown command "nope.list".' } });
  });

  it("returns bad_params for a missing, wrong or unknown param", async () => {
    const { engine, calls } = setup();
    const missing = await engine.execute("test.device.pause", {});
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.error.code).toBe("bad_params");
      expect(missing.error.detail?.issues?.[0]?.path).toBe("device");
    }
    const wrong = await engine.execute("test.device.pause", { device: 42 });
    expect(!wrong.ok && wrong.error.code).toBe("bad_params");
    const extra = await engine.execute("test.device.pause", { device: "Leo's Switch", typo: true });
    expect(!extra.ok && extra.error.code).toBe("bad_params");
    const notObject = await engine.execute("test.device.pause", "Leo's Switch");
    expect(!notObject.ok && notObject.error.code).toBe("bad_params");
    expect(calls.ran).toEqual([]);
  });

  it("needs confirm for disruptive commands, then runs with confirm: true", async () => {
    const { engine, calls } = setup();
    const first = await engine.execute("test.network.restart");
    expect(first).toEqual({ ok: false, error: { code: "needs_confirm", message: "Restarts every eero on n1." } });
    const notTrue = await engine.execute("test.network.restart", { confirm: false });
    expect(!notTrue.ok && notTrue.error.code).toBe("needs_confirm");
    expect(calls.ran).toEqual([]);
    const ok = await engine.execute("test.network.restart", { confirm: true });
    expect(ok).toEqual({ ok: true, result: { restarted: "n1" } });
    expect(calls.ran).toEqual(["restart"]);
  });

  it("needs confirm for destructive commands, then runs with confirm: true", async () => {
    const { engine, calls } = setup();
    const first = await engine.execute("test.profile.delete", { profile: "Leo" });
    expect(first.ok).toBe(false);
    if (!first.ok) {
      expect(first.error.code).toBe("needs_confirm");
      expect(first.error.message).toContain("cannot be undone");
    }
    expect(calls.ran).toEqual([]);
    expect(await engine.execute("test.profile.delete", { profile: "Leo", confirm: true })).toEqual({ ok: true, result: { deleted: true } });
  });

  it("runs a query and returns its result", async () => {
    const { engine } = setup();
    const res = await engine.execute<{ net: string; devices: Device[] }>("test.devices");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.result.net).toBe("n1");
      expect(res.result.devices.map((d) => d.name)).toEqual(["Leo's Switch", "Office Printer"]);
    }
  });

  it("maps a thrown BackendError to eero_error with its detail", async () => {
    const { engine, fail } = setup();
    fail(new BackendError("eero_error", "That eero is offline.", { status: 503, eeroError: "error.eero.offline" }));
    expect(await engine.execute("test.devices")).toEqual({
      ok: false,
      error: { code: "eero_error", message: "That eero is offline.", detail: { status: 503, eeroError: "error.eero.offline" } },
    });
  });

  it("maps any other thrown error to eero_error without leaking its message", async () => {
    const { engine, fail } = setup();
    fail(new Error("cookie s=secret-token"));
    const res = await engine.execute("test.devices");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("eero_error");
      expect(res.error.message).not.toContain("secret");
    }
  });

  it("maps an unimplemented backend area to eero_error", async () => {
    const backend = composeBackend("demo", {
      auth: { status: async () => ({ signedIn: true, pending: false, login: null, storage: "memory" }) } as never,
      network: { list: async () => [network("n1", "Maple Street")] } as never,
    });
    const spec = defineCommand({ id: "test.eero.list", label: "eeros", params: z.object({}), effect: "query", run: (ctx) => ctx.backend.eero.list(ctx.net) });
    const engine = createEngine({ backend, commands: [spec] });
    const res = await engine.execute("test.eero.list");
    expect(!res.ok && res.error.code).toBe("eero_error");
  });

  it("returns not_signed_in without a session, except for app and auth commands", async () => {
    const { engine } = setup({ signedIn: false });
    expect(await engine.execute("test.devices")).toEqual({ ok: false, error: { code: "not_signed_in", message: "Not signed in." } });
    expect(await engine.execute("test.app.ping")).toEqual({ ok: true, result: "pong" });
  });

  it("emits session.changed and drops the cache when the backend finds the session dead", async () => {
    const { engine, events, fail, calls } = setup();
    await engine.execute("test.devices");
    fail(new BackendError("not_signed_in", "Your session expired."));
    await engine.execute("test.device.pause", { device: "x" });
    const res = await engine.execute("test.devices");
    expect(!res.ok && res.error.code).toBe("not_signed_in");
    expect(calls.devices).toBe(2);
    expect(events).toContainEqual({ type: "session.changed", state: "signed_out", storage: "memory" });
  });
});

describe("networks and refs", () => {
  it("selects the first network when none is saved and remembers it", async () => {
    const { engine, events, settings } = setup();
    await engine.execute("test.devices");
    expect(engine.selectedNetworkId()).toBe("n1");
    expect((await settings.get()).lastNetworkId).toBe("n1");
    expect(events).toEqual([{ type: "network.selected", networkId: "n1" }]);
  });

  it("accepts networkId as an id or a name, without changing the selection", async () => {
    const { engine } = setup();
    const byName = await engine.execute<{ net: string }>("test.devices", { networkId: "MAPLE STREET" });
    expect(byName.ok && byName.result.net).toBe("n1");
    const byId = await engine.execute<{ net: string }>("test.devices", { networkId: "n2" });
    expect(byId.ok && byId.result.net).toBe("n2");
  });

  it("fails bad_params with the matches for an ambiguous or unknown network", async () => {
    const { engine } = setup();
    const res = await engine.execute("test.devices", { networkId: "Lake Cabin" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("bad_params");
      expect(res.error.detail?.matches?.map((m) => m.id)).toEqual(["n2", "n3"]);
    }
    const none = await engine.execute("test.devices", { networkId: "Nowhere" });
    expect(!none.ok && none.error.code).toBe("bad_params");
  });

  it("resolves a device by id, MAC or case-insensitive name", async () => {
    const { engine } = setup();
    for (const r of ["aa0000000001", "AA:00:00:00:00:01", "leo's switch"]) {
      expect(await engine.execute("test.device.pick", { device: r })).toEqual({ ok: true, result: "aa0000000001" });
    }
    const none = await engine.execute("test.device.pick", { device: "Toaster" });
    expect(none).toEqual({ ok: false, error: { code: "bad_params", message: 'No device matches "Toaster".' } });
  });
});

describe("cache", () => {
  it("serves a query from cache until its TTL, and a write invalidates its topics", async () => {
    let t = 1_000_000;
    const { engine, calls } = setup({ now: () => t });
    await engine.execute("test.devices");
    await engine.execute("test.devices");
    expect(calls.devices).toBe(1);
    t += 31_000;
    await engine.execute("test.devices");
    expect(calls.devices).toBe(2);
    await engine.execute("test.device.pause", { device: "Leo's Switch" });
    await engine.execute("test.devices");
    expect(calls.devices).toBe(3);
  });

  it("shares one backend call between concurrent identical queries", async () => {
    const { engine, calls } = setup();
    await Promise.all([engine.execute("test.devices"), engine.execute("test.devices"), engine.execute("test.devices")]);
    expect(calls.devices).toBe(1);
  });
});

describe("registry", () => {
  const base = { label: "X", params: z.object({}), effect: "query" as const, run: async () => null };

  it("rejects duplicate and badly formed ids", () => {
    expect(() => createRegistry([{ ...base, id: "a.b" }, { ...base, id: "a.b" }])).toThrow(/Duplicate/);
    expect(() => createRegistry([{ ...base, id: "Device.List" }])).toThrow(/Bad command id/);
    expect(() => createRegistry([{ ...base, id: "device" }])).toThrow(/Bad command id/);
    expect(() => createRegistry([{ ...base, id: "a.b", params: z.object({ confirm: z.boolean() }), effect: "disruptive" }])).toThrow(/must not declare/);
  });

  it("adds networkId and confirm to the JSON Schema where they apply", () => {
    const reg = createRegistry([
      { ...base, id: "network.restart", effect: "disruptive" },
      { ...base, id: "app.info", scope: "app" },
    ]);
    const [restart, info] = reg.describe();
    expect(Object.keys((restart?.params.properties ?? {}) as object)).toEqual(["networkId", "confirm"]);
    expect(restart?.params.additionalProperties).toBe(false);
    expect(Object.keys((info?.params.properties ?? {}) as object)).toEqual([]);
    expect(info).toMatchObject({ id: "app.info", effect: "query", scope: "app", sensitive: false, poll: null });
  });

  it("registers backend-only commands only for that backend", () => {
    const specs = [{ ...base, id: "demo.scenario.set", backend: "demo" as const }];
    expect(createRegistry(specs, { backend: "demo" }).list()).toHaveLength(1);
    expect(createRegistry(specs, { backend: "eero" }).list()).toHaveLength(0);
  });

  it("builds from the command index without errors", () => {
    expect(() => createRegistry()).not.toThrow();
  });
});

describe("fileSettings", () => {
  const plan = { planMbps: { net_1: { down: 1200, up: 1200 } } };

  it("starts from initial when the file is missing, and the file wins once saved", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mesh-ui-settings-test-"));
    try {
      const path = join(dir, "settings.json");
      expect((await fileSettings(path, plan).get()).planMbps).toEqual(plan.planMbps);
      await writeFile(path, JSON.stringify({ planMbps: {} }));
      expect((await fileSettings(path, plan).get()).planMbps).toEqual({});
      expect((await fileSettings(join(dir, "other.json")).get()).planMbps).toEqual({});
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
