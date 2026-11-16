/**
 * eero backend: the network event stream, `GET {net}/app_events`. A real
 * network answers `{events: [{hash, timestamp_ms, description, category}]}`
 * (capture of 2026-11-13, docs/eero-api/endpoints.md section 17), newest
 * first.
 *
 * A real network only sends a rolling window of about the last 15 minutes
 * and ignores the `timestamp` cursor the clients document (capture of
 * 2026-11-16, #263), so a short page is not the end of history and paging
 * cannot reach older events. The backend therefore keeps an event log per
 * network for as long as it lives: every read of the newest events adds
 * eero's window to it (by `hash`, which is stable across reads), and cursor
 * pages read from the log. When the log runs out it still asks eero once with
 * `timestamp`, so a server that honours the cursor pages as the clients
 * expect; once eero answers with nothing older, it stops asking for that
 * network. Filters apply in core (src/core/commands/activity.ts). See
 * docs/architecture/data-model.md (Activity and notifications).
 */

import type { EventChunk } from "../../backend";
import type * as M from "../../model";
import { asList, type RawAppEvent } from "../raw";
import { networkPath } from "../urls";
import type { EeroArea } from "./index";

export const EVENT_PAGE_SIZE = 50;

/** How far back the log keeps events, from the newest one: two weeks, so the week summary can compare with the week before. */
export const EVENT_LOG_MS = 15 * 24 * 60 * 60 * 1000;

/** The most events the log keeps per network, so a very busy network cannot grow it without bound. */
export const EVENT_LOG_MAX = 10_000;

/**
 * Event type (eero's `category`, or a demo `type`) to category, first match
 * wins. eero documents no list of values, so this starts from what the
 * clients log and the demo stream; anything unknown is `other`.
 */
const TYPE_RULES: [RegExp, M.EventCategory][] = [
  [/^(device|profile)_(paused|unpaused|resumed|blocked|unblocked)|^(pause|resume|block|unblock)/, "pause_block"],
  [/^(profile_)?schedule/, "schedules"],
  [/^(eero_temperature|temperature|ethernet|port_)/, "ports_temperature"],
  [/^speed_?test/, "speed_tests"],
  [/^(firmware|update|os_update)/, "firmware"],
  [/^(device|client)/, "devices"],
  [/^(eero|node|mesh|network_(online|offline|down|up))/, "eero_status"],
  [/^(admin|guest|invite|member|setting)/, "admin"],
];

/**
 * The real stream sends a bare noun as its category (`device`, `profile`,
 * `eero`), so for a bare noun the description decides first and the noun is
 * the fallback.
 */
const TEXT_RULES: [RegExp, M.EventCategory][] = [
  [/\b(paused|unpaused|resumed|blocked|unblocked)\b/, "pause_block"],
  [/\bschedule/, "schedules"],
  [/\btemperature\b|\bethernet\b|\bport \d/, "ports_temperature"],
  [/\bspeed ?test/, "speed_tests"],
  [/\bfirmware\b|\beeroos\b|\bupdate (installed|available|scheduled)/, "firmware"],
  [/\b(invited|admin|guest network|password)\b/, "admin"],
];

const norm = (s: string) => s.trim().toLowerCase().replace(/[.\-\s]+/g, "_");

export function eventCategory(type: string, description?: string | null): M.EventCategory {
  const t = norm(type);
  if (description && !t.includes("_")) {
    const d = description.toLowerCase();
    const byText = TEXT_RULES.find(([re]) => re.test(d))?.[1];
    if (byText) return byText;
  }
  return TYPE_RULES.find(([re]) => re.test(t))?.[1] ?? "other";
}

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** One raw event to the model, or null when it has no usable time. The real shape carries no device, eero or profile refs. */
export function mapEvent(raw: RawAppEvent): M.NetworkEvent | null {
  const ms = typeof raw.timestamp_ms === "number" ? raw.timestamp_ms : Number.NaN;
  if (!Number.isFinite(ms)) return null;
  const at = new Date(ms).toISOString();
  const type = text(raw.category) ?? "unknown";
  const description = text(raw.description);
  return {
    id: text(raw.hash) ?? `${type}@${at}`,
    at,
    category: eventCategory(type, description),
    type,
    title: description ?? type,
    detail: null,
    refs: {},
  };
}

/** One network's log: events newest first, unique by id. `paging` turns false once eero ignores the cursor. */
type EventLog = { events: M.NetworkEvent[]; paging: boolean };

/** Adds events to a log, keeps it newest first and unique by id, and trims it to EVENT_LOG_MS and EVENT_LOG_MAX. */
function merge(log: EventLog, add: M.NetworkEvent[]): void {
  if (!add.length) return;
  const byId = new Map(log.events.map((e) => [e.id, e]));
  for (const e of add) byId.set(e.id, e);
  const all = [...byId.values()].sort((a, b) => b.at.localeCompare(a.at));
  const newest = all[0] ? Date.parse(all[0].at) : 0;
  log.events = all.filter((e, i) => i < EVENT_LOG_MAX && newest - Date.parse(e.at) <= EVENT_LOG_MS);
}

/**
 * Up to EVENT_PAGE_SIZE log events strictly older than `cursor` (all when
 * null), with the cursor for the rest. A page never ends inside a run of
 * events with the same time, so the strict cursor cannot skip one.
 */
function slice(log: EventLog, cursor: string | null): EventChunk {
  const from = cursor ? log.events.findIndex((e) => e.at < cursor) : 0;
  if (from < 0 || from >= log.events.length) return { events: [], nextCursor: null };
  let end = Math.min(from + EVENT_PAGE_SIZE, log.events.length);
  while (end < log.events.length && log.events[end]?.at === log.events[end - 1]?.at) end++;
  const events = log.events.slice(from, end);
  const last = events[events.length - 1];
  // The cursor stays even at the end of the log: the next page may still ask eero for older events.
  return { events, nextCursor: last && (end < log.events.length || log.paging) ? last.at : null };
}

export const events: EeroArea<"events"> = ({ client }) => {
  const logs = new Map<M.Id, EventLog>();

  async function fetchEvents(net: M.Id, cursor: string | null): Promise<M.NetworkEvent[]> {
    const data = await client.request<unknown>({
      method: "GET",
      path: networkPath(net, "app_events"),
      query: { page_size: EVENT_PAGE_SIZE, timestamp: cursor ?? undefined },
    });
    const events = asList<RawAppEvent>(data, "events")
      .map(mapEvent)
      .filter((e): e is M.NetworkEvent => e !== null);
    // Only events strictly older than the cursor: eero ignores it, so the rest are ones the log already has.
    return cursor ? events.filter((e) => e.at < cursor) : events;
  }

  return {
    async list(net, cursor): Promise<EventChunk> {
      let log = logs.get(net);
      if (!log) logs.set(net, (log = { events: [], paging: true }));
      if (!cursor) {
        merge(log, await fetchEvents(net, null));
        return slice(log, null);
      }
      const page = slice(log, cursor);
      if (page.events.length || !log.paging) return page;
      // The log has nothing older: ask eero, which may still have older events if it honours the cursor.
      const older = await fetchEvents(net, cursor);
      if (!older.length) {
        log.paging = false;
        return { events: [], nextCursor: null };
      }
      merge(log, older);
      return slice(log, cursor);
    },
  };
};
