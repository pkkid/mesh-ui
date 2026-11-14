/**
 * The write kit against the demo engine. Real write commands land in wave 2
 * of M4, so besides a real demo write (`network.select`) the engine gets
 * test-only specs: a reversible write, a disruptive restart and a
 * destructive delete, each with its own state so a run is visible.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createDemoBackend } from "../../../core/demo";
import { createEngine, type Engine } from "../../../core/engine";
import type { Network, NetworkSummary, Permissions } from "../../../core/model";
import { allCommands } from "../../../core/registry";
import { type AnyCommand, defineCommand } from "../../../core/spec";
import { toast } from "../components/ui/toast";
import { resetRegistry } from "./useCommand";
import { BRIDGE_OFF, type ConfirmAsk, fieldErrors, gateFor, NO_PERMISSION, NOT_AVAILABLE, performWrite, type WriteDeps } from "./useWrite";

const NOW = Date.parse("2026-11-12T22:41:00Z");

type Kit = { light: boolean; restarts: number; profiles: string[]; failNext: boolean };

function testCommands(kit: Kit): AnyCommand[] {
  return [
    defineCommand({
      id: "kit.light.set",
      label: "Set status light",
      effect: "write",
      scope: "app",
      params: z.object({ on: z.boolean() }),
      run: async (_ctx, p) => {
        if (kit.failNext) {
          kit.failNext = false;
          const { BackendError } = await import("../../../core/errors");
          throw new BackendError("eero_error", "eero did not answer.");
        }
        kit.light = p.on;
        return { on: kit.light };
      },
    }),
    defineCommand({
      id: "kit.network.restart",
      label: "Restart network",
      effect: "disruptive",
      scope: "app",
      params: z.object({}),
      confirmMessage: () => "Everyone loses internet for about 2 to 3 minutes.",
      run: async () => ({ restarts: ++kit.restarts }),
    }),
    defineCommand({
      id: "kit.profile.delete",
      label: "Delete profile",
      effect: "destructive",
      scope: "app",
      params: z.object({ name: z.string().min(1, "Name the profile.") }),
      run: async (_ctx, p) => {
        kit.profiles = kit.profiles.filter((n) => n !== p.name);
        return { profiles: kit.profiles };
      },
    }),
  ];
}

function setup(answers: boolean[] = []) {
  const kit: Kit = { light: false, restarts: 0, profiles: ["Mia", "Leo"], failNext: false };
  const backend = createDemoBackend({ clock: () => NOW });
  const engine = createEngine({ backend, clock: () => NOW, commands: [...allCommands(), ...testCommands(kit)] });
  const asks: ConfirmAsk[] = [];
  const executed: { id: string; params: unknown }[] = [];
  const invalidated: (ReadonlyArray<string> | undefined)[] = [];
  const deps: WriteDeps = {
    execute: (id, params) => {
      executed.push({ id, params });
      return engine.execute(id, params);
    },
    info: async (id) => engine.commands().find((c) => c.id === id),
    ask: async (a) => {
      asks.push(a);
      return answers.shift() ?? false;
    },
    invalidate: (p) => invalidated.push(p),
  };
  return { kit, engine, deps, asks, executed, invalidated };
}

async function networks(engine: Engine): Promise<NetworkSummary[]> {
  const r = await engine.execute<NetworkSummary[]>("network.list");
  if (!r.ok) throw new Error(r.error.message);
  return r.result;
}

beforeEach(() => toast.clear());
afterEach(() => {
  toast.clear();
  vi.useRealTimers();
});

describe("performWrite: success and Undo", () => {
  it("runs a write without confirm, refetches its area and shows a success toast", async () => {
    const t = setup();
    const res = await performWrite({ id: "kit.light.set", params: { on: true }, success: "Status light on" }, t.deps);
    expect(res).toEqual({ ok: true, result: { on: true } });
    expect(t.kit.light).toBe(true);
    expect(t.asks).toEqual([]);
    expect(t.executed).toEqual([{ id: "kit.light.set", params: { on: true } }]);
    expect(t.invalidated).toEqual([["kit.", "network.get"]]);
    expect(toast.list()).toMatchObject([{ kind: "success", title: "Status light on" }]);
  });

  it("Undo runs the inverse write and the next read shows the old state (network.select)", async () => {
    const t = setup();
    const [first, second] = await networks(t.engine);
    expect(first && second).toBeTruthy();
    await t.engine.execute("network.select", { network: first?.id });
    const before = first?.id;

    await performWrite(
      {
        id: "network.select",
        params: { network: second?.id },
        success: `Switched to ${second?.name}`,
        undo: { id: "network.select", params: { network: before } },
      },
      t.deps,
    );
    expect((await networks(t.engine)).find((n) => n.selected)?.id).toBe(second?.id);

    const [done] = toast.list();
    expect(done).toMatchObject({ kind: "success", action: { label: "Undo" } });
    await done?.action?.run();
    expect((await networks(t.engine)).find((n) => n.selected)?.id).toBe(before);
    expect(toast.list().at(-1)).toMatchObject({ kind: "success", title: "Undone" });
  });

  it("success toasts close after 4 s; at most 3 stay", async () => {
    vi.useFakeTimers();
    toast.success("a");
    toast.success("b");
    toast.error("c");
    toast.success("d");
    expect(toast.list().map((x) => x.title)).toEqual(["b", "c", "d"]);
    vi.advanceTimersByTime(4000);
    expect(toast.list().map((x) => x.title)).toEqual(["c"]);
  });
});

describe("performWrite: confirm", () => {
  it("disruptive: needs_confirm message goes to the confirm, then runs with confirm: true and a progress toast", async () => {
    const t = setup([true]);
    const res = await performWrite(
      { id: "kit.network.restart", success: "Restarted Maple Street", progress: "Restarting Maple Street", confirm: { confirmLabel: "Yes, restart network" } },
      t.deps,
    );
    expect(res).toMatchObject({ ok: true, result: { restarts: 1 } });
    expect(t.executed).toEqual([
      { id: "kit.network.restart", params: {} },
      { id: "kit.network.restart", params: { confirm: true } },
    ]);
    expect(t.asks).toEqual([
      {
        id: "kit.network.restart",
        effect: "disruptive",
        title: "Restart network?",
        message: "Everyone loses internet for about 2 to 3 minutes.",
        confirmLabel: "Yes, restart network",
        typeToConfirm: undefined,
      },
    ]);
    // The progress toast was replaced in place by the result.
    expect(toast.list()).toMatchObject([{ kind: "success", title: "Restarted Maple Street" }]);
  });

  it("cancelling the confirm runs nothing and returns null", async () => {
    const t = setup([false]);
    const res = await performWrite({ id: "kit.network.restart", success: "Restarted" }, t.deps);
    expect(res).toBeNull();
    expect(t.kit.restarts).toBe(0);
    expect(t.executed).toEqual([{ id: "kit.network.restart", params: {} }]);
    expect(t.invalidated).toEqual([]);
    expect(toast.list()).toEqual([]);
  });

  it("never forwards a caller's confirm: true without asking", async () => {
    const t = setup([false]);
    const res = await performWrite({ id: "kit.network.restart", params: { confirm: true } as Record<string, unknown> }, t.deps);
    expect(res).toBeNull();
    expect(t.kit.restarts).toBe(0);
    expect(t.executed[0]?.params).toEqual({});
  });

  it("destructive: the dialog gets type-to-confirm and the engine's default message", async () => {
    const t = setup([true]);
    await performWrite(
      { id: "kit.profile.delete", params: { name: "Mia" }, success: "Deleted Mia", confirm: { title: "Delete Mia?", typeToConfirm: "Mia" } },
      t.deps,
    );
    expect(t.asks[0]).toMatchObject({ effect: "destructive", title: "Delete Mia?", typeToConfirm: "Mia", message: expect.stringContaining("cannot be undone") });
    expect(t.kit.profiles).toEqual(["Leo"]);
  });

  it("askFirst: a write the UI confirms on its own asks, then runs without confirm", async () => {
    const t = setup([true]);
    await performWrite({ id: "kit.light.set", params: { on: true }, askFirst: true, confirm: { title: "Block Leo's iPad?", message: "It loses internet until unblocked." } }, t.deps);
    expect(t.asks[0]).toMatchObject({ effect: "write", title: "Block Leo's iPad?", message: "It loses internet until unblocked." });
    expect(t.executed).toEqual([{ id: "kit.light.set", params: { on: true } }]);
  });
});

describe("performWrite: errors", () => {
  it("an eero error leaves the state alone and shows an error toast whose Retry runs it again", async () => {
    const t = setup();
    t.kit.failNext = true;
    const res = await performWrite({ id: "kit.light.set", params: { on: true }, success: "Status light on", failure: "Couldn't turn the light on" }, t.deps);
    expect(res).toMatchObject({ ok: false, error: { code: "eero_error" } });
    expect(t.kit.light).toBe(false);
    expect(t.invalidated).toEqual([]);
    const [err] = toast.list();
    expect(err).toMatchObject({ kind: "error", title: "Couldn't turn the light on", detail: "eero did not answer.", action: { label: "Retry" } });

    await err?.action?.run();
    expect(t.kit.light).toBe(true);
    // Retry consumed the error toast, so it cannot run the write again.
    expect(toast.list()).toMatchObject([{ kind: "success", title: "Status light on" }]);
  });

  it("Retry after a confirmed disruptive write does not ask again", async () => {
    const t = setup([true]);
    const kitRestart = t.deps.execute;
    let failOnce = true;
    t.deps.execute = async (id, params) =>
      failOnce && (params as { confirm?: boolean }).confirm
        ? ((failOnce = false), { ok: false, error: { code: "network_error", message: "Can't reach eero." } })
        : kitRestart(id, params);
    await performWrite({ id: "kit.network.restart", progress: "Restarting" }, t.deps);
    const [err] = toast.list();
    expect(err).toMatchObject({ kind: "error", title: "Couldn't restart network", detail: "Can't reach eero." });
    await err?.action?.run();
    expect(t.asks).toHaveLength(1);
    expect(t.kit.restarts).toBe(1);
  });

  it("bad_params from a form goes to the fields, not a toast", async () => {
    const t = setup([true]);
    const res = await performWrite({ id: "kit.profile.delete", params: { name: "" }, form: true }, t.deps);
    expect(res).toMatchObject({ ok: false, error: { code: "bad_params" } });
    expect(toast.list()).toEqual([]);
    expect(fieldErrors(res && !res.ok ? res.error : null)).toEqual({ name: "Name the profile." });
  });

  it("an unknown command says Mesh UI could not run it", async () => {
    const t = setup();
    await performWrite({ id: "kit.nothing.here" }, t.deps);
    expect(toast.list()).toMatchObject([{ kind: "error", detail: "Mesh UI could not run kit.nothing.here." }]);
  });
});

describe("performWrite: default deps over window.mesh", () => {
  it("reads the effect from the registry the bridge reports", async () => {
    const t = setup();
    const asked: ConfirmAsk[] = [];
    vi.stubGlobal("window", { mesh: { execute: t.engine.execute, commands: async () => t.engine.commands() } });
    resetRegistry();
    try {
      const { askInDialog, answerDialog, defaultDeps } = await import("./useWrite");
      const run = performWrite({ id: "kit.network.restart" }, { ...defaultDeps, ask: (a) => (asked.push(a), askInDialog(a)) });
      await vi.waitFor(() => expect(asked).toHaveLength(1));
      answerDialog(true);
      expect(await run).toMatchObject({ ok: true });
      expect(asked[0]).toMatchObject({ effect: "disruptive", message: "Everyone loses internet for about 2 to 3 minutes." });
    } finally {
      vi.unstubAllGlobals();
      resetRegistry();
    }
  });
});

describe("gateFor", () => {
  const owner: Permissions = { role: "owner", can: { eeros: { read: true, create: true, update: true, delete: true } } };
  const admin: Permissions = { role: "admin", can: { eeros: { read: true, create: false, update: false, delete: false } } };
  const net = (mode: Network["connectionMode"], capabilities: Record<string, boolean> = {}) => ({ connectionMode: mode, capabilities }) as Network;

  it("allows while the reads load and for a permitted owner", () => {
    expect(gateFor({ area: "eeros", capability: "led", bridgeOff: true }, undefined, undefined)).toEqual({ allowed: true, reason: null });
    expect(gateFor({ area: "eeros" }, owner, net("nat"))).toEqual({ allowed: true, reason: null });
  });

  it("closes with a reason for no permission, bridge mode and a missing capability", () => {
    expect(gateFor({ area: "eeros" }, admin, undefined)).toEqual({ allowed: false, reason: "Owner only" });
    expect(gateFor({ area: "eeros" }, { role: null, can: {} }, undefined)).toEqual({ allowed: false, reason: NO_PERMISSION });
    expect(gateFor({ bridgeOff: true }, owner, net("bridged"))).toEqual({ allowed: false, reason: BRIDGE_OFF });
    expect(gateFor({ bridgeOff: true }, owner, net("ipPassthrough"))).toEqual({ allowed: false, reason: BRIDGE_OFF });
    expect(gateFor({ capability: "led" }, owner, net("nat", { led: false }))).toEqual({ allowed: false, reason: NOT_AVAILABLE });
    expect(gateFor({ capability: "led" }, owner, net("nat"))).toEqual({ allowed: false, reason: NOT_AVAILABLE });
  });
});
