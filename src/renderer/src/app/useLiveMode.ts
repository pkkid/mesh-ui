/**
 * The Live switch (#319): whether views that show live rates may ask eero for
 * them. One setting shared by the Devices page, Internet "Using the most right
 * now" and a device's Now box, so turning it on in one place turns it on
 * everywhere. Like the eero app's live usage view, live reporting runs only
 * when asked: off on a first run, the last choice is remembered (view state,
 * kept in this browser), and it turns itself off after LIVE_AUTO_OFF_MIN so a
 * window left open does not keep asking eero.
 */
import { useSyncExternalStore } from "react";

const KEY = "mesh-ui:live:v1";
export const LIVE_AUTO_OFF_MIN = 10;

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

let on = read();
let offTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function armAutoOff() {
  clearTimeout(offTimer);
  if (on) offTimer = setTimeout(() => setLive(false), LIVE_AUTO_OFF_MIN * 60_000);
}
armAutoOff();

export function setLive(next: boolean): void {
  if (next === on) return;
  on = next;
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    // Not remembered; the switch still works for this session.
  }
  armAutoOff();
  for (const l of listeners) l();
}

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
