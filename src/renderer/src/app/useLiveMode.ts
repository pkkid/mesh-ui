/**
 * The Live switch (#319): whether views that show live rates may ask eero for
 * them. The switch sits in the topbar on every page and stays on wherever you
 * go, and while it is on LiveCollector asks eero for them on every page, so
 * the live charts keep their history. Like the eero app's live usage
 * view, live reporting runs only when asked: off at every launch, and it
 * turns itself off after LIVE_AUTO_OFF_MIN so a window left open does not
 * keep asking eero.
 */
import { useSyncExternalStore } from "react";

export const LIVE_AUTO_OFF_MIN = 15;

let on = false;
let offTimer: ReturnType<typeof setTimeout> | undefined;
/** When Live turns itself off, epoch ms; null while off. */
let offAt: number | null = null;
const listeners = new Set<() => void>();

function armAutoOff() {
  clearTimeout(offTimer);
  offAt = on ? Date.now() + LIVE_AUTO_OFF_MIN * 60_000 : null;
  if (on) offTimer = setTimeout(() => setLive(false), LIVE_AUTO_OFF_MIN * 60_000);
}

export function setLive(next: boolean): void {
  if (next === on) return;
  on = next;
  armAutoOff();
  for (const l of listeners) l();
}

/** When Live will turn itself off (epoch ms), or null while it is off. */
export const liveOffAt = (): number | null => offAt;

/** Whether Live is on right now, outside React. */
export const isLive = (): boolean => on;

/** Whether Live is on, and a setter. */
export function useLiveMode(): [boolean, (next: boolean) => void] {
  const value = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => on,
  );
  return [value, setLive];
}
