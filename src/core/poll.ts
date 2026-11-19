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
  /** reservation.list, forward.list, pinhole.list (rules change in the eero app too) */
  routing: 60,
  /**
   * settings.get, integrations.get, wifi.get, guest.get: settings someone can
   * change in the eero app while the page is open (M5.R-fix9).
   */
  settings: 60,
  /** usage.get, usage.breakdown */
  usage: 300,
  /** updates.get on the Updates page */
  updates: 900,
  /** account.get on Settings (name, verification and push change in the eero app too) */
  account: 300,
  /** app.info and app.audit.list on Settings (update state, CLI runs from another process) */
  app: 60,
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
  | "wifi"
  | "integrations"
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
  guest: 30,
  settings: 30,
  wifi: 30,
  integrations: 30,
  routing: 30,
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
export const USAGE_TTL = { day: 4 * MIN, week: 15 * MIN, month: 30 * MIN } as const;

/** eero allows one burst reporter per minute per network. */
export const BURST_COOLDOWN_SEC = 60;

/** Device rates older than this are shown as missing. */
export const RATES_STALE_SEC = 90;

/**
 * When a burst's figures land, counted from the POST. eero's `next_burst` is
 * about the POST time itself (request log on a real network, 2026-11-16:
 * reads timed from it all came too early and saw stale figures), so the
 * burst is due at the later of the two.
 */
export const BURST_LEAD_SEC = 12;

/** Extra wait after `next_burst` before devices are read again. */
export const BURST_SETTLE_SEC = 2;

/**
 * How long after `next_burst` eero's `usage` figures stay live. They land
 * about 12 s after the POST and have largely decayed by 30 s (eero-api,
 * live-verified 2026-10-20), so reads after this window keep the last live
 * figures instead of the decayed ones.
 */
export const BURST_LIVE_SEC = 14;

/** While a burst is live, devices are read again this often, like the eero app's live view. */
export const BURST_READ_EVERY_SEC = 4;

/** When to read devices for one burst, epoch ms: every few seconds through its live window. */
export function burstReadTimes(nextBurstMs: number): number[] {
  const out: number[] = [];
  for (let s = BURST_SETTLE_SEC; s < BURST_LIVE_SEC; s += BURST_READ_EVERY_SEC) out.push(nextBurstMs + s * 1000);
  return out;
}

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
