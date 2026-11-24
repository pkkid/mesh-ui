/**
 * Live readings since Live was turned on (#319), for every live chart: the
 * network's totals (Devices, Live throughput), each device's rates (device
 * detail, and the Devices table's Live chart column). `LiveCollector` adds
 * to it from `device.list` on every page while Live is on, so the charts keep
 * growing wherever you are; it is cleared when Live goes off. View state,
 * kept for the session, no command.
 *
 * A point is added when a burst or the figures change: each read in a burst's
 * live window can move the figures, and they all share the burst's time, so a
 * repeat of the held figures adds nothing.
 */
import { useSyncExternalStore } from "react";

/** One point: when it arrived, the burst it came from, and the rates. */
export type LiveReading = { at: string; burstAt: string; down: number; up: number };
/** What a reading is made from: the network summary's totals or one device's rates. */
export type LiveRates = { downMbps: number; upMbps: number; at: string };

/** About a reading every few seconds while a burst is live, for the 15 minutes Live stays on, with room to spare. */
export const MAX_READINGS = 400;

/** The readings after one more read; `prev` itself when the rates repeat the last point. */
export function nextReadings(prev: readonly LiveReading[], rates: LiveRates, at: string, max = MAX_READINGS): readonly LiveReading[] {
  const last = prev.at(-1);
  if (last && last.burstAt === rates.at && last.down === rates.downMbps && last.up === rates.upMbps) return prev;
  return [...prev, { at, burstAt: rates.at, down: rates.downMbps, up: rates.upMbps }].slice(-max);
}

const EMPTY: readonly LiveReading[] = [];
let store = new Map<string, readonly LiveReading[]>();
const listeners = new Set<() => void>();
const notify = () => {
  for (const l of listeners) l();
};

/** Adds one read's rates, by key (the network id, or `device:<id>`); keys with no rates keep what they have. */
export function recordReadings(entries: ReadonlyArray<readonly [string, LiveRates | null | undefined]>): void {
  const at = new Date().toISOString();
  let changed = false;
  for (const [key, rates] of entries) {
    if (!rates) continue;
    const prev = store.get(key) ?? EMPTY;
    const next = nextReadings(prev, rates, at);
    if (next === prev) continue;
    if (!changed) store = new Map(store);
    changed = true;
    store.set(key, next);
  }
  if (changed) notify();
}

/** Drops every reading (Live went off). */
export function clearReadings(): void {
  if (store.size === 0) return;
  store = new Map();
  notify();
}

/** The readings for one key, kept current. */
export function useLiveReadings(key: string): readonly LiveReading[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => store.get(key) ?? EMPTY,
  );
}
