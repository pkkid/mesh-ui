/**
 * Remembers the main window's size, position and maximized state in
 * `window-state.json` in the config dir, and restores it on the next launch
 * (docs/platform/cross-platform.md#window-and-titlebar). Saved bounds are the normal
 * (unmaximized) ones. On restore they are fitted to the displays that exist
 * now: a size larger than the work area shrinks to it, and a position whose
 * titlebar is no longer on any display is dropped so the window centres.
 * Headless runs neither read nor write it.
 */

import { readFileSync, writeFileSync } from "node:fs";

export type Rect = { x: number; y: number; width: number; height: number };

export type WindowState = {
  width: number;
  height: number;
  x?: number;
  y?: number;
  maximized: boolean;
};

export type WindowLimits = { width: number; height: number; minWidth: number; minHeight: number };

/** How much of the titlebar must be on a display to keep the saved position. */
const VISIBLE_STRIP = { width: 120, height: 32 };

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Parses saved state; anything malformed reads as nothing saved. */
export function parseWindowState(text: string): WindowState | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isInt(r.width) || !isInt(r.height) || r.width <= 0 || r.height <= 0) return null;
  const state: WindowState = { width: Math.round(r.width), height: Math.round(r.height), maximized: r.maximized === true };
  if (isInt(r.x) && isInt(r.y)) {
    state.x = Math.round(r.x);
    state.y = Math.round(r.y);
  }
  return state;
}

function overlap(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return { x, y, width: Math.min(a.x + a.width, b.x + b.width) - x, height: Math.min(a.y + a.height, b.y + b.height) - y };
}

/**
 * The bounds to open with: saved state fitted to today's displays, or the
 * defaults when nothing is saved. `workAreas` are the displays' work areas,
 * the primary first.
 */
export function fitWindowState(saved: WindowState | null, workAreas: Rect[], limits: WindowLimits): WindowState {
  if (!saved) return { width: limits.width, height: limits.height, maximized: false };
  let width = Math.max(saved.width, limits.minWidth);
  let height = Math.max(saved.height, limits.minHeight);
  let x = saved.x;
  let y = saved.y;

  let home: Rect | undefined;
  if (x !== undefined && y !== undefined) {
    const strip = { x, y, width, height: VISIBLE_STRIP.height };
    home = workAreas.find((area) => {
      const o = overlap(strip, area);
      return o.width >= Math.min(VISIBLE_STRIP.width, width) && o.height >= VISIBLE_STRIP.height;
    });
    if (!home) x = y = undefined;
  }

  const area = home ?? workAreas[0];
  if (area) {
    width = Math.min(width, Math.max(area.width, limits.minWidth));
    height = Math.min(height, Math.max(area.height, limits.minHeight));
  }

  return { width, height, ...(x !== undefined && y !== undefined ? { x, y } : {}), maximized: saved.maximized };
}

export function readWindowState(file: string): WindowState | null {
  try {
    return parseWindowState(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** Best effort: a failed write only means the next launch uses the defaults. */
export function writeWindowState(file: string, state: WindowState): void {
  try {
    writeFileSync(file, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  } catch {
    // ignore
  }
}

/** The slice of BrowserWindow the tracker uses, so tests can stub it. */
export type TrackedWindow = {
  getNormalBounds(): Rect;
  isMaximized(): boolean;
  isMinimized(): boolean;
  isFullScreen(): boolean;
  on(event: "resize" | "move" | "maximize" | "unmaximize" | "close", fn: () => void): unknown;
};

/**
 * Saves the window's state when it closes, and shortly after it is moved or
 * resized so a crash or kill still keeps the last size.
 */
export function trackWindowState(win: TrackedWindow, save: (state: WindowState) => void, delayMs = 500): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const snapshot = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    // Minimized and full screen bounds are not the size to come back to.
    if (win.isMinimized() || win.isFullScreen()) return;
    const b = win.getNormalBounds();
    save({ x: b.x, y: b.y, width: b.width, height: b.height, maximized: win.isMaximized() });
  };
  const later = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(snapshot, delayMs);
  };
  win.on("resize", later);
  win.on("move", later);
  win.on("maximize", snapshot);
  win.on("unmaximize", snapshot);
  win.on("close", snapshot);
}
