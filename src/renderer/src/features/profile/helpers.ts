/**
 * Pure helpers for the profile detail page: wording, schedule layout input
 * and table rows, kept free of React and the `~` alias so they can be unit
 * tested (helpers.test.ts). State and the next scheduled change come from
 * `profile.get` (computed in core); nothing here recomputes them.
 * docs/ux/pages/profile-detail.md.
 */
import { formatMinute } from "../../components/ui/timeline";
import { formatRelative, networkClock } from "../../../../core/format";
import type { Day, Device, Profile, Schedule, UsageBreakdownRow, UsagePoint } from "../../../../core/model";

const DAY_MIN = 24 * 60;

/** Lane order of the week timeline: index 0 is Monday. */
const MON_FIRST: ReadonlyArray<Day> = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

/** Chip order of a schedule row, as in the eero app: Sunday first. */
const SUN_FIRST: ReadonlyArray<Day> = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/** "16:00" to 960 minutes after midnight. */
export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Minutes paused per day by one schedule. An end at or before the start wraps past midnight; equal means 24 h. */
export function spanMinutes(s: Pick<Schedule, "start" | "end">): number {
  const start = minutesOf(s.start);
  const end = minutesOf(s.end);
  return end > start ? end - start : end + DAY_MIN - start;
}

/** Hours a week the enabled schedules pause the profile (overlaps counted once per schedule). */
export function scheduledHoursPerWeek(schedules: ReadonlyArray<Schedule>): number {
  const minutes = schedules.filter((s) => s.enabled).reduce((sum, s) => sum + spanMinutes(s) * new Set(s.days).size, 0);
  return Math.round((minutes / 60) * 10) / 10;
}

/** "60 h / week", or null when nothing is scheduled. */
export function hoursLine(schedules: ReadonlyArray<Schedule>): string | null {
  const h = scheduledHoursPerWeek(schedules);
  return h > 0 ? `${h} h / week` : null;
}

/** "9:00 PM to 7:00 AM". */
export const timeRange = (s: Pick<Schedule, "start" | "end">) => `${formatMinute(minutesOf(s.start))} to ${formatMinute(minutesOf(s.end))}`;

/** Icon key from keywords in the name (eero stores no icon). */
export function scheduleIcon(name: string): "moon" | "book" | "utensils" | "calendar-clock" {
  if (/bed|night|sleep|lights/i.test(name)) return "moon";
  if (/home\s*work|study|school/i.test(name)) return "book";
  if (/dinner|meal|lunch|breakfast/i.test(name)) return "utensils";
  return "calendar-clock";
}

/** Input for the shared week timeline (days as lane indexes, Monday 0); the page adds colour and icon. */
export function weekInput(s: Schedule) {
  return {
    id: s.id,
    label: s.name,
    days: s.days.map((d) => MON_FIRST.indexOf(d)).filter((i) => i >= 0),
    start: minutesOf(s.start),
    end: minutesOf(s.end),
    enabled: s.enabled,
  };
}

/** Seven day chips, Sunday first. */
export function dayChips(days: ReadonlyArray<Day>): { day: Day; letter: string; on: boolean }[] {
  return SUN_FIRST.map((day) => ({ day, letter: day.slice(0, 1), on: days.includes(day) }));
}

/** "1h 55m", "12m", "2d 3h". */
export function untilText(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return min % 60 ? `${h}h ${min % 60}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}

/**
 * The hero's line from the profile's state and `nextChange` (both from core):
 * "Paused until resumed", "Bedtime until 7:00 AM" (in a scheduled pause),
 * "Homework pause starts at 4:00 PM, in 1h 55m", "No scheduled pauses".
 */
export function heroLine(p: Profile, timezone: string | null, now: number): string | null {
  if (p.paused) return "Paused until resumed";
  const next = p.nextChange;
  if (!next) return p.schedules.some((s) => s.enabled) ? null : "No scheduled pauses";
  const clock = networkClock(timezone);
  const at = Date.parse(next.at);
  const when = clock.day(at) === clock.day(now) ? clock.time(at) : `${clock.weekday(at)} ${clock.time(at)}`;
  const name = p.schedules.find((s) => s.id === next.scheduleId)?.name ?? "Scheduled pause";
  if (next.to === "active") return `${name} until ${when}`;
  return `${name} pause starts ${clock.day(at) === clock.day(now) ? "at " : ""}${when}, in ${untilText(at - now)}`;
}

/** True while a schedule is pausing the profile now: core's next change is the resume. */
export const inScheduledPause = (p: Profile) => !p.paused && p.nextChange?.to === "active";

/** Today's lane (Monday 0) and minutes after midnight, in the network time zone. */
export function todayIn(now: number, timezone: string | null): { lane: number; minute: number } {
  const { weekday } = networkClock(timezone).parts(now);
  let minute = 0;
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone ?? "UTC", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(now);
    const get = (t: string) => Number(parts.find((x) => x.type === t)?.value ?? 0);
    minute = get("hour") * 60 + get("minute");
  } catch {
    minute = Math.floor((now % 86_400_000) / 60_000);
  }
  return { lane: weekday, minute };
}

/**
 * Dashed markers on the hourly usage chart where an enabled schedule started
 * or ended, in the network time zone. Daily points (Week) get none.
 */
export function usageMarkers(
  points: ReadonlyArray<UsagePoint>,
  schedules: ReadonlyArray<Schedule>,
  timezone: string | null,
): { index: number; label: string; scheduleId: string }[] {
  const clock = networkClock(timezone);
  const out: { index: number; label: string; scheduleId: string }[] = [];
  points.forEach((p, index) => {
    const { weekday, hour } = clock.parts(p.at);
    if (weekday < 0) return;
    const today = MON_FIRST[weekday] as Day;
    const yesterday = MON_FIRST[(weekday + 6) % 7] as Day;
    for (const s of schedules) {
      if (!s.enabled) continue;
      const start = minutesOf(s.start);
      const end = minutesOf(s.end);
      const wraps = end <= start;
      if (s.days.includes(today) && Math.floor(start / 60) === hour) out.push({ index, label: `${s.name} starts`, scheduleId: s.id });
      const endDay = wraps ? yesterday : today;
      if (s.days.includes(endDay) && Math.floor((end % DAY_MIN) / 60) === hour) out.push({ index, label: `${s.name} ends`, scheduleId: s.id });
    }
  });
  return out;
}

export type DeviceRow = { device: Device; down: number | null; up: number | null; share: number | null };

/**
 * Devices table rows: the profile's devices with their data in the last 24
 * hours and their share of the profile's total. Online first, then by data.
 */
export function deviceRows(devices: ReadonlyArray<Device>, usage: ReadonlyArray<UsageBreakdownRow> | undefined): DeviceRow[] {
  const used = new Map((usage ?? []).flatMap((r) => (r.id ? [[r.id, r] as const] : [])));
  const total = devices.reduce((sum, d) => sum + (used.get(d.id)?.down ?? 0) + (used.get(d.id)?.up ?? 0), 0);
  return devices
    .map((device) => {
      const u = used.get(device.id);
      const bytes = u ? u.down + u.up : null;
      return { device, down: u ? u.down : null, up: u ? u.up : null, share: bytes !== null && total > 0 ? (bytes / total) * 100 : null };
    })
    .sort(
      (a, b) =>
        Number(b.device.connected) - Number(a.device.connected) ||
        (b.down ?? 0) + (b.up ?? 0) - ((a.down ?? 0) + (a.up ?? 0)) ||
        a.device.name.localeCompare(b.device.name),
    );
}

/** "Upstairs Hall · 5 GHz", "Office · Wired", "Offline · last seen 2 h ago on Upstairs Hall". Paused shows in the status column. */
export function connectionLine(d: Device, eeroName: string | null, now: number, timezone: string | null): string {
  const where = eeroName ?? null;
  if (!d.connected) {
    const seen = d.lastActive ? `last seen ${formatRelative(d.lastActive, now, timezone ?? "UTC")}` : null;
    return ["Offline", [seen, seen && where ? `on ${where}` : null].filter(Boolean).join(" ") || null].filter(Boolean).join(" · ");
  }
  const band = d.band === "wired" ? "Wired" : d.band ? `${d.band} GHz` : null;
  return [where, band].filter(Boolean).join(" · ") || "Online";
}

/** The previous (`[`) or next (`]`) profile id, wrapping, in list order; null with fewer than two. */
export function neighbour(ids: ReadonlyArray<string>, id: string, dir: 1 | -1): string | null {
  const at = ids.indexOf(id);
  if (at < 0 || ids.length < 2) return null;
  return ids[(at + dir + ids.length) % ids.length] ?? null;
}

/** "Pacific Time", from the zone's generic name; "UTC" when the network has none. */
export function zoneName(timezone: string | null, now = Date.now()): string {
  if (!timezone) return "UTC";
  try {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "longGeneric" }).formatToParts(now);
    return p.find((x) => x.type === "timeZoneName")?.value ?? timezone;
  } catch {
    return timezone;
  }
}

// ---------------------------------------------------------------------------
// Writes (M4.5): picker order and confirm copy.

/** "Alex", "Alex and Jamie", "Alex, Jamie and Mia". */
export function nameList(names: ReadonlyArray<string>): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

const devicesWord = (n: number) => `${n} device${n === 1 ? "" : "s"}`;

export type PickerRow = { id: string; name: string; note: string | null; device: Device };

/**
 * Devices for a profile's picker: unassigned first, then the rest by their
 * profile, each by name. `note` says where a device is now ("Moves from
 * Alex"); this profile's own devices say nothing. Guests and blocked devices
 * are left out (they are not the household's, or cannot connect).
 */
export function pickerRows(devices: ReadonlyArray<Device>, profiles: ReadonlyArray<Pick<Profile, "id" | "name">>, self: string | null): PickerRow[] {
  const nameOf = new Map(profiles.map((p) => [p.id, p.name]));
  const owner = (d: Device) => (d.profileId && nameOf.has(d.profileId) ? d.profileId : null);
  const rank = (d: Device) => (owner(d) === self ? 0 : owner(d) === null ? 1 : 2);
  return devices
    .filter((d) => !d.blocked && d.ssid !== "guest")
    .sort((a, b) => rank(a) - rank(b) || (nameOf.get(owner(a) ?? "") ?? "").localeCompare(nameOf.get(owner(b) ?? "") ?? "") || a.name.localeCompare(b.name))
    .map((d) => {
      const from = owner(d);
      return { id: d.id, name: d.name, device: d, note: from === null ? (self === null ? null : "Unassigned") : from === self ? null : `Moves from ${nameOf.get(from)}` };
    });
}

/** Pause all's confirm: "Pause Alex, Jamie and Mia? 15 devices lose internet until you resume them." */
export function pauseAllMessage(profiles: ReadonlyArray<Pick<Profile, "name" | "deviceIds">>): { title: string; message: string } {
  const n = profiles.reduce((sum, p) => sum + p.deviceIds.length, 0);
  return {
    title: `Pause ${nameList(profiles.map((p) => p.name))}?`,
    message: `${devicesWord(n)} ${n === 1 ? "loses" : "lose"} internet until you resume ${profiles.length === 1 ? "it" : "them"}.`,
  };
}

/** Pause unassigned's confirm, naming up to three devices (online first). */
export function unassignedPauseMessage(devices: ReadonlyArray<Pick<Device, "name" | "connected">>): { title: string; message: string } {
  const named = [...devices].sort((a, b) => Number(b.connected) - Number(a.connected)).slice(0, 3).map((d) => d.name);
  const rest = devices.length - named.length;
  return {
    title: `Pause ${devicesWord(devices.length).replace("device", "unassigned device")}?`,
    message: named.length
      ? `This includes ${rest > 0 ? `${named.join(", ")} and ${rest} more` : nameList(named)}. They lose internet until you resume them.`
      : "They lose internet until you resume them.",
  };
}
