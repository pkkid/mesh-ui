/**
 * Poll intervals and cache lifetimes, the one table every surface shares.
 * See docs/architecture/engine.md (Cache, Polling intervals).
 *
 * Polling is driven by surfaces: a spec's `poll` comes from POLL and is
 * reported by `engine.commands()`. TTLs sit a little under the poll interval,
 * so a poll always reaches the backend while two views share one request.
 */

/** Poll intervals in seconds. */
export const POLL = {
  /** network.get, network.health, internet.get */
  network: 60,
  /** eero.list, eero.get */
  eeros: 60,
  /** device.list, device.get */
  devices: 60,
  /** device.rates.refresh, only while a page shows live rates */
  rates: 60,
  /** profile.list, profile.get */
  profiles: 60,
  /** events.list first page, on the Activity page */
  events: 60,
  /** notifications.list */
  notifications: 60,
  /** usage.get, usage.breakdown */
  usage: 300,
  /** updates.get on the Updates page */
  updates: 900,
} as const;

/** Cache topics. A query reads one; a write invalidates some. */
export type Topic =
  | "account"
  | "network"
  | "eeros"
  | "eero_ports"
  | "devices"
  | "profiles"
  | "guest"
  | "settings"
  | "routing"
  | "updates"
  | "release_notes"
  | "speedtest"
  | "usage"
  | "events"
  | "notifications"
  | "notification_settings"
  | "admins"
  | "permissions"
  | "firmware_history"
  | "coverage"
  | "diagnostics";

const MIN = 60;

/** Cache lifetime per topic, in seconds. */
export const TTL: Record<Topic, number> = {
  account: 10 * MIN,
  network: 30,
  eeros: 30,
  eero_ports: 30,
  devices: 30,
  profiles: 30,
  guest: 2 * MIN,
  settings: 2 * MIN,
  routing: 2 * MIN,
  updates: 5 * MIN,
  release_notes: 6 * 60 * MIN,
  speedtest: 5 * MIN,
  usage: 4 * MIN,
  events: 30,
  notifications: 30,
  notification_settings: 10 * MIN,
  admins: 5 * MIN,
  permissions: 10 * MIN,
  firmware_history: 24 * 60 * MIN,
  coverage: 60 * MIN,
  diagnostics: MIN,
};

/** Usage cache lifetime by range: day 4 min, week 15 min. */
export const USAGE_TTL = { day: 4 * MIN, week: 15 * MIN } as const;

/** eero allows one burst reporter per minute per network. */
export const BURST_COOLDOWN_SEC = 60;

/** Device rates older than this are shown as missing. */
export const RATES_STALE_SEC = 90;

/** Extra wait after `next_burst` before devices are read again. */
export const BURST_SETTLE_SEC = 2;

/**
 * After a write, reads of its topics fetched in this window expire at its end,
 * so the read after it sees eero's new state even when eero is slow to apply it.
 */
export const WRITE_SETTLE_SEC = 2;

/** The engine cache keeps entries for this many networks, most recently used. */
export const CACHE_NETWORKS = 2;

/** Polls are jittered by up to this fraction. */
export const POLL_JITTER = 0.1;

/** A poll delay in ms with up to 10 percent jitter. `random` is injectable for tests. */
export function pollDelayMs(seconds: number, random: () => number = Math.random): number {
  return Math.round(seconds * 1000 * (1 + POLL_JITTER * random()));
}
