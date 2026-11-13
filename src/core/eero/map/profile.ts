/**
 * Raw eero profile and schedules to the model `Profile`. `nextChange` is
 * computed in core (commands/profile.ts), so it is null here. Sources:
 * docs/architecture/data-model.md#profiles.
 */

import type * as M from "../../model";
import { type RawProfile, type RawSchedule, linkUrl } from "../raw";
import { compactMac, idFromUrl } from "../urls";

/** Schedules may also come as `{day: "monday", start, end}` (fixtures). */
export type RawScheduleFull = RawSchedule & { id?: string | number; day?: string };

const DAYS: Record<string, M.Day> = {
  mon: "MON",
  tue: "TUE",
  wed: "WED",
  thu: "THU",
  fri: "FRI",
  sat: "SAT",
  sun: "SUN",
};

/** "MON", "monday", "Mon" to "MON". Unknown values are dropped. */
export function dayOf(v: unknown): M.Day | null {
  return typeof v === "string" ? (DAYS[v.trim().slice(0, 3).toLowerCase()] ?? null) : null;
}

const ORDER: M.Day[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

/** "21:00", "9:00", "21:00:00" to "HH:MM". */
function hhmm(v: unknown): M.Hhmm | null {
  const m = typeof v === "string" ? /^(\d{1,2}):(\d{2})/.exec(v.trim()) : null;
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? `${String(h).padStart(2, "0")}:${m[2]}` : null;
}

export function mapSchedule(raw: RawScheduleFull, index: number): M.Schedule | null {
  const start = hhmm(raw.start);
  const end = hhmm(raw.end);
  if (!start || !end) return null;
  const days = new Set([...(raw.days ?? []), raw.day].map(dayOf).filter((d): d is M.Day => d !== null));
  const url = linkUrl(raw.url);
  return {
    id: url ? idFromUrl(url) : raw.id !== undefined ? String(raw.id) : String(index + 1),
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : "Scheduled pause",
    days: ORDER.filter((d) => days.has(d)),
    start,
    end,
    enabled: raw.enabled !== false,
  };
}

/** Maps a profile. `schedules` from `{profile}/schedules` wins over the profile's own `schedule[]`. */
export function mapProfile(raw: RawProfile, schedules?: RawScheduleFull[] | null): M.Profile {
  const url = linkUrl(raw.url);
  const devices = raw.devices ?? [];
  const list = (schedules ?? (raw.schedule as RawScheduleFull[] | undefined) ?? []).map(mapSchedule).filter((s): s is M.Schedule => s !== null);
  const paused = raw.paused === true;
  const value = raw.state?.value?.toLowerCase();
  const state: M.Profile["state"] = paused || value === "paused" ? "paused" : value === "schedule" || value === "scheduled" ? "scheduled" : "active";
  return {
    id: url ? idFromUrl(url) : "",
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : "Profile",
    state,
    paused,
    deviceIds: devices.map((d) => {
      const u = linkUrl(d.url);
      return u ? idFromUrl(u) : compactMac(d.mac ?? "");
    }).filter((id) => id.length > 0),
    devicesOnline: devices.filter((d) => d.connected === true).length,
    schedules: list,
    nextChange: null,
  };
}
