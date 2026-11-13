/**
 * eero backend: the network event stream, `GET {net}/app_events`. eero pages
 * by `timestamp` (the `created` of the last event seen), 50 at a time. Filters
 * apply in core (src/core/commands/activity.ts). See
 * docs/architecture/data-model.md (Activity and notifications).
 */

import type { EventChunk } from "../../backend";
import type * as M from "../../model";
import { asList, type RawEvent } from "../raw";
import { compactMac, idFromUrl, networkPath } from "../urls";
import type { EeroArea } from "./index";

export const EVENT_PAGE_SIZE = 50;

/**
 * `event_type` to category, first match wins. eero documents no list of
 * types, so this starts from what the clients log and the demo stream;
 * anything unknown is `other`.
 */
const CATEGORY_RULES: [RegExp, M.EventCategory][] = [
  [/^(device|profile)_(paused|unpaused|resumed|blocked|unblocked)|^(pause|resume|block|unblock)/, "pause_block"],
  [/^(profile_)?schedule/, "schedules"],
  [/^(eero_temperature|temperature|ethernet|port_)/, "ports_temperature"],
  [/^speed_?test/, "speed_tests"],
  [/^(firmware|update|os_update)/, "firmware"],
  [/^(device|client)/, "devices"],
  [/^(eero|node|mesh|network_(online|offline|down|up))/, "eero_status"],
  [/^(admin|guest|invite|member|setting)/, "admin"],
];

export function eventCategory(type: string): M.EventCategory {
  const t = type.trim().toLowerCase().replace(/[.\-\s]+/g, "_");
  return CATEGORY_RULES.find(([re]) => re.test(t))?.[1] ?? "other";
}

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** One raw event to the model, or null when it has no usable time. */
export function mapEvent(raw: RawEvent): M.NetworkEvent | null {
  const when = text(raw.created) ?? text(raw.timestamp);
  const ms = when ? Date.parse(when) : Number.NaN;
  if (!Number.isFinite(ms)) return null;
  const at = new Date(ms).toISOString();
  const type = text(raw.event_type) ?? "unknown";
  const title = text(raw.title) ?? text(raw.message) ?? type;
  const message = text(raw.message);
  const refs: M.NetworkEvent["refs"] = {};
  const deviceMac = text(raw.device?.mac);
  const deviceUrl = text(raw.device?.url);
  if (deviceMac) refs.deviceId = compactMac(deviceMac);
  else if (deviceUrl) refs.deviceId = idFromUrl(deviceUrl);
  const eeroUrl = text(raw.eero?.url);
  if (eeroUrl) refs.eeroId = idFromUrl(eeroUrl);
  const profileUrl = text(raw.profile?.url);
  if (profileUrl) refs.profileId = idFromUrl(profileUrl);
  return {
    id: raw.id !== undefined && raw.id !== null && String(raw.id) ? String(raw.id) : `${type}@${at}`,
    at,
    category: eventCategory(type),
    type,
    title,
    detail: message && message !== title ? message : null,
    refs,
  };
}

export const events: EeroArea<"events"> = ({ client }) => ({
  async list(net, cursor): Promise<EventChunk> {
    const data = await client.request<unknown>({
      method: "GET",
      path: networkPath(net, "app_events"),
      query: { page_size: EVENT_PAGE_SIZE, timestamp: cursor ?? undefined },
    });
    const raw = asList<RawEvent>(data, "events");
    const last = raw[raw.length - 1];
    const lastTime = last ? (text(last.created) ?? text(last.timestamp)) : null;
    const events = raw.map(mapEvent).filter((e): e is M.NetworkEvent => e !== null);
    events.sort((a, b) => b.at.localeCompare(a.at));
    return { events, nextCursor: raw.length >= EVENT_PAGE_SIZE && lastTime ? lastTime : null };
  },
});
