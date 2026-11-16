import { afterEach, describe, expect, it, vi } from "vitest";

import { isLive, LIVE_AUTO_OFF_MIN, setLive } from "./useLiveMode";

afterEach(() => {
  setLive(false);
  vi.useRealTimers();
});

describe("Live switch (#319)", () => {
  it("starts off and turns itself off after LIVE_AUTO_OFF_MIN", () => {
    vi.useFakeTimers();
    expect(isLive()).toBe(false);
    setLive(true);
    expect(isLive()).toBe(true);
    vi.advanceTimersByTime(LIVE_AUTO_OFF_MIN * 60_000 - 1);
    expect(isLive()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(isLive()).toBe(false);
  });

  it("restarts the auto-off when turned on again", () => {
    vi.useFakeTimers();
    setLive(true);
    vi.advanceTimersByTime(5 * 60_000);
    setLive(false);
    setLive(true);
    vi.advanceTimersByTime(LIVE_AUTO_OFF_MIN * 60_000 - 1);
    expect(isLive()).toBe(true);
  });
});
