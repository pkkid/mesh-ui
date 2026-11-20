import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fitWindowState,
  parseWindowState,
  readWindowState,
  trackWindowState,
  type TrackedWindow,
  type WindowState,
  writeWindowState,
} from "./window-state";

const LIMITS = { width: 1200, height: 780, minWidth: 760, minHeight: 480 };
const PRIMARY = { x: 0, y: 0, width: 1920, height: 1040 };
const RIGHT = { x: 1920, y: 0, width: 2560, height: 1400 };

describe("parseWindowState", () => {
  it("reads a saved state", () => {
    expect(parseWindowState('{"x":10,"y":20,"width":1400,"height":900,"maximized":true}')).toEqual({
      x: 10,
      y: 20,
      width: 1400,
      height: 900,
      maximized: true,
    });
  });

  it("treats malformed input as nothing saved", () => {
    expect(parseWindowState("not json")).toBeNull();
    expect(parseWindowState("null")).toBeNull();
    expect(parseWindowState('{"width":"big","height":900}')).toBeNull();
    expect(parseWindowState('{"width":0,"height":900}')).toBeNull();
  });

  it("drops a half position", () => {
    expect(parseWindowState('{"x":10,"width":1400,"height":900}')).toEqual({ width: 1400, height: 900, maximized: false });
  });
});

describe("fitWindowState", () => {
  it("uses the defaults when nothing is saved", () => {
    expect(fitWindowState(null, [PRIMARY], LIMITS)).toEqual({ width: 1200, height: 780, maximized: false });
  });

  it("keeps a saved size and position that fit", () => {
    const saved = { x: 100, y: 50, width: 1400, height: 900, maximized: false };
    expect(fitWindowState(saved, [PRIMARY], LIMITS)).toEqual(saved);
  });

  it("keeps a position on a second display", () => {
    const saved = { x: 2200, y: 100, width: 2000, height: 1200, maximized: true };
    expect(fitWindowState(saved, [PRIMARY, RIGHT], LIMITS)).toEqual(saved);
  });

  it("centres and shrinks when the saved display is gone", () => {
    const saved = { x: 2200, y: 100, width: 2000, height: 1200, maximized: false };
    expect(fitWindowState(saved, [PRIMARY], LIMITS)).toEqual({ width: 1920, height: 1040, maximized: false });
  });

  it("never goes under the minimum size", () => {
    expect(fitWindowState({ width: 300, height: 200, maximized: false }, [PRIMARY], LIMITS)).toEqual({
      width: 760,
      height: 480,
      maximized: false,
    });
  });
});

describe("window-state.json", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("round-trips, and reads a missing file as nothing saved", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "mesh-ui-window-state-"));
    dirs.push(dir);
    const file = path.join(dir, "window-state.json");
    expect(readWindowState(file)).toBeNull();
    const state = { x: 5, y: 6, width: 1300, height: 800, maximized: false };
    writeWindowState(file, state);
    expect(readWindowState(file)).toEqual(state);
  });
});

describe("trackWindowState", () => {
  function stubWindow() {
    const handlers = new Map<string, () => void>();
    const win = {
      bounds: { x: 1, y: 2, width: 1300, height: 850 },
      maximized: false,
      minimized: false,
      getNormalBounds: () => win.bounds,
      isMaximized: () => win.maximized,
      isMinimized: () => win.minimized,
      isFullScreen: () => false,
      on: (event: string, fn: () => void) => handlers.set(event, fn),
      emit: (event: string) => handlers.get(event)?.(),
    };
    return win as typeof win & TrackedWindow;
  }

  it("saves on close and shortly after a resize", () => {
    vi.useFakeTimers();
    const win = stubWindow();
    const saved: WindowState[] = [];
    trackWindowState(win, (s) => saved.push(s), 500);

    win.emit("resize");
    win.emit("resize");
    expect(saved).toHaveLength(0);
    vi.advanceTimersByTime(500);
    expect(saved).toEqual([{ x: 1, y: 2, width: 1300, height: 850, maximized: false }]);

    win.maximized = true;
    win.emit("close");
    expect(saved.at(-1)).toEqual({ x: 1, y: 2, width: 1300, height: 850, maximized: true });
    vi.useRealTimers();
  });

  it("skips a minimized window", () => {
    const win = stubWindow();
    const saved: WindowState[] = [];
    trackWindowState(win, (s) => saved.push(s));
    win.minimized = true;
    win.emit("close");
    expect(saved).toHaveLength(0);
  });
});
