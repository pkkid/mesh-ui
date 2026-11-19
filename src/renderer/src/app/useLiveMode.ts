/**
 * The Live switch (#319): whether views that show live rates may ask eero for
 * them. Only two pages show live rates, Devices and a device's detail page;
 * each shows the switch in the topbar and calls `useLivePage`. One setting
 * shared by both, so moving between them keeps Live on; leaving them for any
 * other page turns it off. Like the eero app's live usage view, live
 * reporting runs only when asked: off at every launch, and it turns itself
 * off after LIVE_AUTO_OFF_MIN so a window left open does not keep asking eero.
 */
import { useEffect, useSyncExternalStore } from "react";

export const LIVE_AUTO_OFF_MIN = 10;

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

/** Pages showing live rates that are mounted now (Devices, device detail). */
let livePages = 0;

/** A live page opened. */
export function enterLivePage(): void {
  livePages += 1;
}

/**
 * A live page closed. Live turns off unless another live page opens in the
 * same navigation (Devices to a device and back), which mounts before this
 * check runs.
 */
export function leaveLivePage(): void {
  livePages = Math.max(0, livePages - 1);
  setTimeout(() => {
    if (livePages === 0) setLive(false);
  }, 0);
}

/** Marks the calling page as one that shows live rates, for as long as it is mounted. */
export function useLivePage(): void {
  useEffect(() => {
    enterLivePage();
    return leaveLivePage;
  }, []);
}
