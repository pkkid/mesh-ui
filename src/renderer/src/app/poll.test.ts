/**
 * Polling (`pollQuery`, what `useQuery` runs with `poll`): readers of one
 * query share one timer at the shortest interval any of them asks for, and
 * the timer stops when the last reader goes (M5.R-fix9).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pollQuery } from "./useCommand";

let calls: string[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  calls = [];
  vi.stubGlobal("window", {
    mesh: {
      execute: async (id: string) => {
        calls.push(id);
        return { ok: true, result: calls.length };
      },
      commands: async () => [],
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Past one interval plus its 10 percent jitter. */
const after = (sec: number) => vi.advanceTimersByTimeAsync(sec * 1100 + 1);

describe("pollQuery", () => {
  it("polls a query shown by several readers once per interval", async () => {
    const offs = [pollQuery("poll.shared", undefined, 60), pollQuery("poll.shared", {}, 60), pollQuery("poll.shared", undefined, 60)];
    await after(60);
    expect(calls).toEqual(["poll.shared"]);
    await after(60);
    expect(calls).toEqual(["poll.shared", "poll.shared"]);
    offs.forEach((off) => off());
    await after(300);
    expect(calls).toHaveLength(2);
  });

  it("runs at the shortest interval asked for, and keeps going while any reader polls", async () => {
    const slow = pollQuery("poll.mixed", undefined, 300);
    const fast = pollQuery("poll.mixed", undefined, 60);
    await after(60);
    expect(calls).toHaveLength(1);
    fast();
    // The slow reader keeps the query polling, at its own interval once the running timer fires.
    await after(60);
    expect(calls).toHaveLength(2);
    await after(60);
    expect(calls).toHaveLength(2);
    await after(300);
    expect(calls).toHaveLength(3);
    slow();
    slow();
    await after(600);
    expect(calls).toHaveLength(3);
  });

  it("does not restart a running countdown when another reader mounts", async () => {
    const offs = [pollQuery("poll.remount", undefined, 60)];
    await vi.advanceTimersByTimeAsync(50_000);
    offs.push(pollQuery("poll.remount", undefined, 60));
    await vi.advanceTimersByTimeAsync(17_000);
    expect(calls).toEqual(["poll.remount"]);
    offs.forEach((off) => off());
  });
});
