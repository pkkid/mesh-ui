/**
 * The header Refresh (`refreshAll`): every mounted query is fetched again once,
 * past the engine cache, and clicks while it runs start nothing. Runs over a
 * real engine on a counting backend, behind a stubbed `window.mesh`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { composeBackend } from "../../../core/backend";
import { createEngine } from "../../../core/engine";
import type { ExecuteOptions } from "../../../core/engine";
import { defineCommand } from "../../../core/spec";
import { isRefreshing, refreshAll, resetRegistry, watchQuery } from "./useCommand";

function setup() {
  const runs: Record<string, number> = {};
  const count = (id: string) => (runs[id] = (runs[id] ?? 0) + 1);
  let release: (() => void) | null = null;
  let hold = false;
  const read = (id: string) => async () => {
    if (hold) await new Promise<void>((r) => (release = r));
    return { id, n: count(id) };
  };
  const backend = composeBackend("demo", {
    auth: { status: async () => ({ signedIn: true, pending: false, login: null, storage: "memory" }), start: async () => {}, verify: async () => {}, resend: async () => {}, logout: async () => {} },
  });
  const engine = createEngine({
    backend,
    commands: [
      defineCommand({ id: "rf.eeros", label: "eeros", params: z.object({}), effect: "query", scope: "app", topic: "eeros", run: read("rf.eeros") }),
      defineCommand({ id: "rf.devices", label: "Devices", params: z.object({ q: z.string().optional() }), effect: "query", scope: "app", topic: "devices", run: read("rf.devices") }),
      defineCommand({ id: "rf.hidden", label: "Hidden", params: z.object({}), effect: "query", scope: "app", topic: "profiles", run: read("rf.hidden") }),
    ],
  });
  const sent: { id: string; options?: ExecuteOptions }[] = [];
  vi.stubGlobal("window", {
    mesh: {
      execute: (id: string, params?: unknown, options?: ExecuteOptions) => {
        sent.push({ id, options });
        return engine.execute(id, params, options);
      },
      commands: async () => engine.commands(),
    },
  });
  resetRegistry();
  return {
    engine,
    runs,
    sent,
    holdReads: () => (hold = true),
    releaseRead: () => {
      hold = false;
      release?.();
    },
  };
}

const offs: Array<() => void> = [];
afterEach(() => {
  offs.splice(0).forEach((off) => off());
  vi.unstubAllGlobals();
});

describe("refreshAll", () => {
  it("refetches each mounted query once with fresh: true, past the engine cache", async () => {
    const t = setup();
    // Two readers of the same query (page and sidebar) and one other query are mounted.
    offs.push(watchQuery("rf.eeros", undefined, () => {}), watchQuery("rf.eeros", {}, () => {}), watchQuery("rf.devices", { q: "a" }, () => {}));
    // Warm the engine cache the way page loads do; rf.hidden is cached but no longer on screen.
    await t.engine.execute("rf.eeros");
    await t.engine.execute("rf.devices", { q: "a" });
    await t.engine.execute("rf.hidden");
    // A plain read now would be the cached answer.
    await t.engine.execute("rf.eeros");
    expect(t.runs).toEqual({ "rf.eeros": 1, "rf.devices": 1, "rf.hidden": 1 });

    await refreshAll();
    expect(t.runs).toEqual({ "rf.eeros": 2, "rf.devices": 2, "rf.hidden": 1 });
    expect(t.sent.map((s) => s.id).sort()).toEqual(["rf.devices", "rf.eeros"]);
    expect(t.sent.every((s) => s.options?.fresh === true)).toBe(true);
    expect(isRefreshing()).toBe(false);
  });

  it("ignores calls while a refresh runs: same promise, no extra requests", async () => {
    const t = setup();
    offs.push(watchQuery("rf.eeros", undefined, () => {}));
    t.holdReads();
    const first = refreshAll();
    expect(isRefreshing()).toBe(true);
    const second = refreshAll();
    const third = refreshAll();
    expect(second).toBe(first);
    expect(third).toBe(first);
    // Let the held read start and then finish.
    await vi.waitFor(() => expect(t.sent).toHaveLength(1));
    t.releaseRead();
    await first;
    expect(t.runs["rf.eeros"]).toBe(1);
    expect(t.sent).toHaveLength(1);
    expect(isRefreshing()).toBe(false);
    // Once done, the next click refreshes again.
    await refreshAll();
    expect(t.runs["rf.eeros"]).toBe(2);
  });

  it("keeps errors on each query (the page's own error states) and finishes", async () => {
    const t = setup();
    offs.push(watchQuery("rf.unknown", undefined, () => {}));
    await refreshAll();
    expect(t.sent).toEqual([{ id: "rf.unknown", options: { fresh: true } }]);
    expect(isRefreshing()).toBe(false);
  });
});
