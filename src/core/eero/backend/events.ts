/**
 * eero backend: the network event stream, `GET {net}/app_events`. A real
 * network answers `{events: [{hash, timestamp_ms, description, category}]}`
 * (capture of 2026-11-13, docs/eero-api/endpoints.md section 17), newest
 * first, 50 at a time, paged with `timestamp` (the time of the last event
 * seen). Filters apply in core (src/core/commands/activity.ts). See
 * docs/architecture/data-model.md (Activity and notifications).
 */

import type { EventChunk } from "../../backend";
import type * as M from "../../model";
import { asList, type RawAppEvent } from "../raw";
import { networkPath } from "../urls";
import type { EeroArea } from "./index";

export const EVENT_PAGE_SIZE = 50;

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

export const events: EeroArea<"events"> = ({ client }) => ({
  async list(net, cursor): Promise<EventChunk> {
    const data = await client.request<unknown>({
      method: "GET",
      path: networkPath(net, "app_events"),
      query: { page_size: EVENT_PAGE_SIZE, timestamp: cursor ?? undefined },
    });
    const raw = asList<RawAppEvent>(data, "events");
    let events = raw.map(mapEvent).filter((e): e is M.NetworkEvent => e !== null);
    // Only events strictly older than the cursor, so a page that ignored it cannot loop.
    if (cursor) events = events.filter((e) => e.at < cursor);
    events.sort((a, b) => b.at.localeCompare(a.at));
    const last = events[events.length - 1];
    return { events, nextCursor: raw.length >= EVENT_PAGE_SIZE && last ? last.at : null };
  },
});
