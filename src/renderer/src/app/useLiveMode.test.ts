import { afterEach, describe, expect, it, vi } from "vitest";

import { enterLivePage, isLive, LIVE_AUTO_OFF_MIN, leaveLivePage, setLive } from "./useLiveMode";

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

  it("stays on moving between live pages and turns off leaving them", () => {
    vi.useFakeTimers();
    enterLivePage(); // Devices
    setLive(true);
    // Devices to a device: the new page mounts in the same navigation.
    leaveLivePage();
    enterLivePage();
    vi.advanceTimersByTime(1);
    expect(isLive()).toBe(true);
    // The device page to Overview: no live page left.
    leaveLivePage();
    vi.advanceTimersByTime(1);
    expect(isLive()).toBe(false);
  });
});
