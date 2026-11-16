/**
 * profile commands. `state`, `nextChange`, today's pauses and the
 * Unassigned summary are computed here, in core. Writes: create, rename,
 * pause, resume, devices, delete, and Unassigned pause and resume (eero's
 * `default: true` profile, which is never offered as a profile).
 * Unassigned also has scheduled pauses: `profile.get` and the schedule
 * commands take the ref `unassigned` (UNASSIGNED), which every backend maps
 * to eero's default profile.
 * See docs/architecture/commands.md#profile-commandsprofilets.
 */

import { z } from "zod";
import type * as M from "../model";
import { CommandError } from "../errors";
import { formatHhmm, nameList } from "../format";
import { POLL, type Topic } from "../poll";
import { type AnyCommand, type CommandContext, defineCommand, ref } from "../spec";

const WEEKDAYS: M.Day[] = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const MIN_MS = 60_000;

/** Wall clock in `tz` for an instant, as if it were UTC (epoch ms). */
function wallMs(ms: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(ms);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
}

/** A wall clock time in `tz` (given as UTC fields) to the instant. */
function zonedToUtc(wall: number, tz: string): number {
  const first = wall - (wallMs(wall, tz) - wall);
  const off = wallMs(first, tz) - first;
  return wall - off;
}

const hm = (s: M.Hhmm) => {
  const [h, m] = s.split(":").map(Number);
  return ((h ?? 0) * 60 + (m ?? 0)) * MIN_MS;
};

/**
 * The next scheduled pause or resume after `now`, from enabled schedules in
 * the network time zone. A manual pause lasts until resumed, so it has none.
 */
export function nextChange(profile: Pick<M.Profile, "paused" | "schedules">, now: number, tz: string | null): M.Profile["nextChange"] {
  if (profile.paused || !tz) return null;
  let best: NonNullable<M.Profile["nextChange"]> | null = null;
  let bestAt = Number.POSITIVE_INFINITY;
  const today = wallMs(now, tz);
  const midnight = today - (today % 86_400_000);
  // From yesterday (a pause that wraps past midnight) to a week ahead.
  for (let k = -1; k <= 7; k++) {
    const day = midnight + k * 86_400_000;
    const weekday = WEEKDAYS[new Date(day).getUTCDay()];
    for (const s of profile.schedules) {
      if (!s.enabled || !weekday || !s.days.includes(weekday)) continue;
      const start = hm(s.start);
      const end = hm(s.end);
      const events: [number, "paused" | "active"][] = [
        [day + start, "paused"],
        [day + end + (end <= start ? 86_400_000 : 0), "active"],
      ];
      for (const [wall, to] of events) {
        const at = zonedToUtc(wall, tz);
        if (at > now && at < bestAt) {
          bestAt = at;
          best = { at: new Date(at).toISOString(), to, scheduleId: s.id };
        }
      }
    }
  }
  return best;
}

/**
 * State in core: a manual pause wins, then enabled schedules make a profile
 * "scheduled" (eero's own `state.value` says the same when it has them).
 */
export function stateOf(profile: Pick<M.Profile, "paused" | "state" | "schedules">): M.Profile["state"] {
  if (profile.paused) return "paused";
  return profile.schedules.some((s) => s.enabled) || profile.state === "scheduled" ? "scheduled" : "active";
}

const DAY_MIN = 24 * 60;

/**
 * Today's pauses for one lane, in minutes after midnight in the network time
 * zone: today's schedule spans (an overnight one stops at midnight), the end
 * of yesterday's overnight spans, and a manual pause from now until the next
 * scheduled start (or midnight), since a manual pause lasts until resumed.
 */
export function pausesToday(lane: Pick<M.Profile, "paused" | "schedules">, now: number, tz: string | null): M.PauseSegment[] {
  const today = wallMs(now, tz ?? "UTC");
  const minute = Math.floor((today % 86_400_000) / MIN_MS);
  const day = WEEKDAYS[new Date(today).getUTCDay()];
  const yesterday = WEEKDAYS[new Date(today - 86_400_000).getUTCDay()];
  const out: M.PauseSegment[] = [];
  for (const s of lane.schedules) {
    if (!s.enabled) continue;
    const start = hm(s.start) / MIN_MS;
    const end = hm(s.end) / MIN_MS;
    const wraps = end <= start;
    const base = { kind: "scheduled" as const, label: s.name, scheduleId: s.id };
    if (day && s.days.includes(day)) out.push({ ...base, start, end: wraps ? DAY_MIN : end });
    if (wraps && end > 0 && yesterday && s.days.includes(yesterday)) out.push({ ...base, start: 0, end });
  }
  out.sort((a, b) => a.start - b.start || a.end - b.end);
  if (lane.paused) {
    const next = out.find((x) => x.start > minute)?.start ?? DAY_MIN;
    out.push({ kind: "manual", label: "Paused until resumed", scheduleId: null, start: minute, end: Math.max(next, minute + 1) });
  }
  return out;
}

/** "YYYY-MM-DD" of an instant in `tz`. */
const dateIn = (now: number, tz: string | null) => new Date(wallMs(now, tz ?? "UTC")).toISOString().slice(0, 10);

async function timezone(ctx: CommandContext): Promise<string | null> {
  try {
    return (await ctx.backend.network.get(ctx.net)).timezone;
  } catch {
    // No time zone, no next change; the profile itself still loads.
    return null;
  }
}

/**
 * The ref (and id) that names Unassigned in `profile.get` and the schedule
 * commands. Backends take it as a profile id: the eero backend writes to the
 * `default: true` profile, the demo keeps the schedules per network.
 */
export const UNASSIGNED = "unassigned";

/** A profile id from a ref; `unassigned` (any case) names eero's default profile. */
const profileOrUnassigned = (ctx: CommandContext, ref: string): Promise<M.Id> =>
  ref.trim().toLowerCase() === UNASSIGNED ? Promise.resolve(UNASSIGNED) : ctx.resolve("profile", ref);

/** Devices with no profile, or in eero's own Unassigned group (a `default` profile the list leaves out). */
function unassignedOf(profiles: M.Profile[], devices: M.Device[]): M.Device[] {
  const owned = new Set(profiles.flatMap((p) => p.deviceIds));
  const listed = new Set(profiles.map((p) => p.id));
  return devices.filter((d) => !d.blocked && !owned.has(d.id) && (!d.profileId || !listed.has(d.profileId)));
}

/** Unassigned's schedules; none when the network has no default profile (eeroOS before 7.12.4) or the read fails. */
async function unassignedSchedules(ctx: CommandContext): Promise<M.Schedule[]> {
  try {
    return (await ctx.backend.profile.get(ctx.net, UNASSIGNED)).schedules;
  } catch {
    return [];
  }
}

/** Unassigned as a profile: the default profile's schedules, and the devices and pause the list shows for it. */
async function unassignedProfile(ctx: CommandContext): Promise<M.Profile> {
  const [base, profiles, devices] = await Promise.all([ctx.backend.profile.get(ctx.net, UNASSIGNED), ctx.backend.profile.list(ctx.net), ctx.backend.device.list(ctx.net)]);
  const unassigned = unassignedOf(profiles, devices);
  return {
    ...base,
    id: UNASSIGNED,
    name: "Unassigned",
    paused: unassigned.length > 0 && unassigned.every((d) => d.paused),
    deviceIds: unassigned.map((d) => d.id),
    devicesOnline: unassigned.filter((d) => d.connected).length,
  };
}

/** Ids of the devices in no profile (Unassigned), as profile.list counts them. */
export async function unassignedIds(ctx: CommandContext): Promise<M.Id[]> {
  const [profiles, devices] = await Promise.all([ctx.backend.profile.list(ctx.net), ctx.backend.device.list(ctx.net)]);
  return unassignedOf(profiles, devices).map((d) => d.id);
}

/** The enabled schedule pausing right now in `tz`, or null. */
export function scheduleNow(schedules: ReadonlyArray<M.Schedule>, now: number, tz: string | null): M.Schedule | null {
  if (!tz) return null;
  const today = wallMs(now, tz);
  const minute = Math.floor((today % 86_400_000) / MIN_MS);
  const on = pausesToday({ paused: false, schedules: [...schedules] }, now, tz).find((x) => x.start <= minute && minute < x.end);
  return on ? (schedules.find((s) => s.id === on.scheduleId) ?? null) : null;
}

/** Why a profile keeps its devices offline right now: "Mia is paused" (until resumed) or its scheduled pause. */
export type OfflineReason = { reason: string; until: string };

/**
 * Whether devices in a profile (or Unassigned) are offline right now: a
 * manual pause, or an enabled schedule whose window covers now in the
 * network time zone. null when they are online. Used by the writes that
 * move devices or change schedules to ask before taking devices offline.
 */
export async function offlineIn(ctx: CommandContext, id: M.Id): Promise<OfflineReason | null> {
  // Unassigned's pause comes from its devices and its schedules from eero's default profile (unassignedProfile).
  const p = await (id === UNASSIGNED ? unassignedProfile(ctx) : ctx.backend.profile.get(ctx.net, id)).catch(() => null);
  if (!p) return null;
  const name = p.name;
  if (p.paused) return { reason: `${name} is paused`, until: "until it is resumed" };
  const s = scheduleNow(p.schedules, ctx.now(), await timezone(ctx));
  return s ? { reason: `${name}'s ${s.name} pause is on now`, until: `until ${formatHhmm(s.end)}` } : null;
}

/** The online devices in a profile (or Unassigned) that a pause starting now would take offline. */
async function onlineIn(ctx: CommandContext, id: M.Id): Promise<M.Device[]> {
  const devices = await ctx.backend.device.list(ctx.net);
  const ids = new Set(id === UNASSIGNED ? await unassignedIds(ctx) : (await ctx.backend.profile.get(ctx.net, id)).deviceIds);
  return devices.filter((d) => ids.has(d.id) && !d.paused && !d.blocked);
}

const lose = (devices: ReadonlyArray<Pick<M.Device, "name">>) => `${nameList(devices.map((d) => d.name))} ${devices.length === 1 ? "loses" : "lose"} internet`;

/**
 * A schedule add or edit that pauses devices straight away: the new window
 * covers now and nothing already keeps them offline. null otherwise.
 */
async function scheduleConfirm(ctx: CommandContext, id: M.Id, input: M.ScheduleInput, replacing: M.Schedule | null): Promise<string | null> {
  const profile = await ctx.backend.profile.get(ctx.net, id);
  // bad_params (an end equal to the start, a taken name) before anything asks.
  checkSchedule(profile, input, replacing);
  if (!input.enabled) return null;
  const others = profile.schedules.filter((s) => s.id !== replacing?.id);
  const tz = await timezone(ctx);
  const now = ctx.now();
  if (profile.paused || scheduleNow(others, now, tz)) return null;
  // The edited schedule already pausing now: nothing new goes offline.
  if (replacing && scheduleNow([replacing], now, tz)) return null;
  if (!scheduleNow([{ ...input, id: "new" }], now, tz)) return null;
  const online = await onlineIn(ctx, id);
  if (online.length === 0) return null;
  return `${input.name} covers right now, so ${lose(online)} until ${formatHhmm(input.end)}.`;
}

/**
 * A time zone change that starts a scheduled pause straight away: a
 * schedule not pausing now in `from` but pausing now in `to`. Names the
 * profiles and the online devices that go offline; null when none do.
 */
export async function timezoneConfirm(ctx: CommandContext, from: string | null, to: string): Promise<string | null> {
  const now = ctx.now();
  const [profiles, devices, unassigned] = await Promise.all([ctx.backend.profile.list(ctx.net), ctx.backend.device.list(ctx.net), unassignedProfile(ctx).catch(() => null)]);
  const hits: { name: string; schedule: M.Schedule; online: M.Device[] }[] = [];
  for (const lane of unassigned ? [...profiles, unassigned] : profiles) {
    if (lane.paused || scheduleNow(lane.schedules, now, from)) continue;
    const schedule = scheduleNow(lane.schedules, now, to);
    if (!schedule) continue;
    const ids = new Set(lane.deviceIds);
    const online = devices.filter((d) => ids.has(d.id) && !d.paused && !d.blocked);
    if (online.length) hits.push({ name: lane.name, schedule, online });
  }
  const [first] = hits;
  if (!first) return null;
  const pauses = hits.map((h) => `${h.name}'s ${h.schedule.name} pause`);
  const until = hits.length === 1 ? `until ${formatHhmm(first.schedule.end)}` : "until those pauses end";
  return `In ${to}, ${nameList(pauses)} ${hits.length === 1 ? "is" : "are"} on now, so ${lose(hits.flatMap((h) => h.online))} ${until}.`;
}

const withNext = (p: M.Profile, now: number, tz: string | null): M.Profile => ({ ...p, state: stateOf(p), nextChange: nextChange(p, now, tz) });

/** Every profile write changes profiles, device chips and pauses, and the network's profile count. */
const WRITES: Topic[] = ["profiles", "devices", "network"];

/** eero's app allows short names; 32 matches it and keeps cards tidy. */
const profileName = z.string().trim().min(1, "Enter a name.").max(32, "Use 32 characters or fewer.").describe("Profile name, 1 to 32 characters.");

/** Names are refs, so two profiles cannot share one (case-insensitive). */
async function uniqueName(ctx: CommandContext, name: string, self: M.Id | null): Promise<void> {
  // `unassigned` is the ref for devices in no profile, so no profile can take the name.
  if (name.trim().toLowerCase() === UNASSIGNED) throw new CommandError("bad_params", "Unassigned is the group for devices in no profile.", { issues: [{ path: "name", message: "Unassigned is the group for devices in no profile." }] });
  const taken = (await ctx.backend.profile.list(ctx.net)).some((p) => p.id !== self && p.name.toLowerCase() === name.toLowerCase());
  if (taken) throw new CommandError("bad_params", `A profile named ${name} already exists.`, { issues: [{ path: "name", message: `A profile named ${name} already exists.` }] });
}

async function resolveDevices(ctx: CommandContext, refs: string[]): Promise<M.Id[]> {
  const ids: M.Id[] = [];
  for (const r of refs) {
    const id = await ctx.resolve("device", r);
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

async function setPaused(ctx: CommandContext, ref: string, paused: boolean): Promise<M.Profile> {
  const id = await ctx.resolve("profile", ref);
  return withNext(await ctx.backend.profile.setPaused(ctx.net, id, paused), ctx.now(), await timezone(ctx));
}


// ---------------------------------------------------------------------------
// Scheduled pauses

const DAY_ORDER: M.Day[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const daysParam = z
  .array(z.enum(DAY_ORDER))
  .min(1, "Pick at least one day.")
  .max(14)
  .transform((days) => DAY_ORDER.filter((d) => days.includes(d)))
  .describe("Days the pause starts on, MON to SUN. Order and repeats do not matter.");
const hhmmParam = z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour HH:MM, 00:00 to 23:59.");
const scheduleName = z.string().trim().min(1, "Enter a name.").max(32, "Use 32 characters or fewer.").describe("Schedule name, 1 to 32 characters.");
const scheduleFields = {
  name: scheduleName,
  days: daysParam,
  start: hhmmParam.describe("When the pause starts, HH:MM in the network time zone."),
  end: hhmmParam.describe("When the pause ends, HH:MM. Before start wraps past midnight (into the next day)."),
};

const fieldError = (path: string, message: string) => new CommandError("bad_params", message, { issues: [{ path, message }] });

/** A schedule on the profile by id, or by exact name (case-insensitive). */
function findSchedule(profile: M.Profile, ref: string): M.Schedule {
  const r = ref.trim();
  const byId = profile.schedules.find((s) => s.id === r);
  if (byId) return byId;
  const named = profile.schedules.filter((s) => s.name.toLowerCase() === r.toLowerCase());
  if (named.length === 1 && named[0]) return named[0];
  if (named.length > 1) throw fieldError("schedule", `${profile.name} has ${named.length} schedules named ${r}; use the id.`);
  throw fieldError("schedule", `${profile.name} has no schedule ${r}.`);
}

/** Start and end must differ (eero has no 24 h pause; pause the profile instead), and names are unique per profile. */
function checkSchedule(profile: M.Profile, input: M.ScheduleInput, self: M.Schedule | null): void {
  if (input.start === input.end) throw fieldError("end", "End must differ from start.");
  // Only a new or changed name is checked, so schedules eero already has under one name can still be edited.
  if (self && self.name.toLowerCase() === input.name.toLowerCase()) return;
  const taken = profile.schedules.some((s) => s.id !== self?.id && s.name.toLowerCase() === input.name.toLowerCase());
  if (taken) throw fieldError("name", `${profile.name} already has a schedule named ${input.name}.`);
}

export const commands: AnyCommand[] = [
  defineCommand({
    id: "profile.list",
    label: "Profiles",
    description:
      "Lists profiles with state (active, paused, scheduled), devices, schedules and the next scheduled change, an Unassigned summary for devices with no profile, and today's pauses per profile in the network time zone.",
    icon: "users",
    effect: "query",
    topic: "profiles",
    poll: POLL.profiles,
    params: z.object({}),
    run: async (ctx): Promise<M.ProfileList> => {
      const [profiles, devices, tz, schedules] = await Promise.all([
        ctx.backend.profile.list(ctx.net),
        ctx.backend.device.list(ctx.net),
        timezone(ctx),
        unassignedSchedules(ctx),
      ]);
      const now = ctx.now();
      const unassigned = unassignedOf(profiles, devices);
      const sorted = profiles.map((p) => withNext(p, now, tz)).sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
      const unassignedPaused = unassigned.length > 0 && unassigned.every((d) => d.paused);
      const today = wallMs(now, tz ?? "UTC");
      return {
        profiles: sorted,
        unassigned: {
          deviceIds: unassigned.map((d) => d.id),
          devicesOnline: unassigned.filter((d) => d.connected).length,
          paused: unassignedPaused,
          schedules,
        },
        today: {
          date: dateIn(now, tz),
          timezone: tz,
          now: Math.floor((today % 86_400_000) / MIN_MS),
          lanes: [
            ...sorted.map((p) => ({ profileId: p.id, segments: pausesToday(p, now, tz) })),
            // Unassigned's schedules come from eero's default profile.
            { profileId: null, segments: pausesToday({ paused: unassignedPaused, schedules }, now, tz) },
          ],
        },
      };
    },
  }),

  defineCommand({
    id: "profile.get",
    label: "Profile",
    description:
      "One profile with its devices, schedules and the next scheduled change. `unassigned` gives Unassigned (devices in no profile) with its scheduled pauses, as id `unassigned`.",
    icon: "user",
    effect: "query",
    topic: "profiles",
    poll: POLL.profiles,
    params: z.object({ profile: ref("profile") }),
    run: async (ctx, p): Promise<M.ProfileDetail> => {
      const id = await profileOrUnassigned(ctx, p.profile);
      const [profile, tz] = await Promise.all([id === UNASSIGNED ? unassignedProfile(ctx) : ctx.backend.profile.get(ctx.net, id), timezone(ctx)]);
      const now = ctx.now();
      const today = wallMs(now, tz ?? "UTC");
      return {
        ...withNext(profile, now, tz),
        today: { date: dateIn(now, tz), timezone: tz, now: Math.floor((today % 86_400_000) / MIN_MS), segments: pausesToday(profile, now, tz) },
      };
    },
  }),

  defineCommand({
    id: "profile.create",
    label: "Add a profile",
    description: "Adds a profile with a name and, optionally, devices (moved out of their old profiles).",
    icon: "user-plus",
    effect: "write",
    gate: { area: "profiles", op: "create", bridgeOff: true },
    invalidates: WRITES,
    params: z.object({ name: profileName, devices: z.array(ref("device")).max(200).optional() }),
    run: async (ctx, p): Promise<M.Profile> => {
      await uniqueName(ctx, p.name, null);
      const deviceIds = await resolveDevices(ctx, p.devices ?? []);
      return withNext(await ctx.backend.profile.create(ctx.net, { name: p.name, deviceIds }), ctx.now(), await timezone(ctx));
    },
  }),

  defineCommand({
    id: "profile.rename",
    label: "Rename profile",
    icon: "pencil",
    effect: "write",
    gate: { area: "profiles", bridgeOff: true },
    invalidates: WRITES,
    params: z.object({ profile: ref("profile"), name: profileName }),
    run: async (ctx, p): Promise<M.Profile> => {
      const id = await ctx.resolve("profile", p.profile);
      await uniqueName(ctx, p.name, id);
      return withNext(await ctx.backend.profile.rename(ctx.net, id, p.name), ctx.now(), await timezone(ctx));
    },
  }),

  defineCommand({
    id: "profile.pause",
    label: "Pause profile",
    description: "Pauses internet on every device in the profile until resumed. eero has no timed pause.",
    icon: "pause",
    effect: "disruptive",
    gate: { area: "profiles", bridgeOff: true },
    invalidates: WRITES,
    params: z.object({ profile: ref("profile") }),
    confirmMessage: async (ctx, p) => {
      const profile = await ctx.backend.profile.get(ctx.net, await ctx.resolve("profile", p.profile));
      const n = profile.deviceIds.length;
      return n === 0
        ? `${profile.name} has no devices yet; any that join stay paused until resumed.`
        : `${n === 1 ? `${profile.name}'s device loses` : `All ${n} of ${profile.name}'s devices lose`} internet until resumed.`;
    },
    run: async (ctx, p): Promise<M.Profile> => setPaused(ctx, p.profile, true),
  }),

  defineCommand({
    id: "profile.resume",
    label: "Resume profile",
    description: "Resumes internet on every device in the profile. During a scheduled pause, eero keeps it online until the next schedule.",
    icon: "play",
    effect: "write",
    gate: { area: "profiles", bridgeOff: true },
    invalidates: WRITES,
    params: z.object({ profile: ref("profile") }),
    run: async (ctx, p): Promise<M.Profile> => setPaused(ctx, p.profile, false),
  }),

  defineCommand({
    id: "profile.devices.set",
    label: "Profile devices",
    description: "Sets exactly which devices are in the profile. Listed devices move in; others leave to Unassigned.",
    icon: "users",
    effect: "write",
    gate: { area: "profiles", bridgeOff: true },
    invalidates: WRITES,
    params: z.object({ profile: ref("profile"), devices: z.array(ref("device")).max(200) }),
    // Devices joining a paused profile, or leaving to a paused Unassigned, go offline.
    async confirmWhen(ctx, p) {
      const id = await ctx.resolve("profile", p.profile);
      const listed = new Set(await resolveDevices(ctx, p.devices));
      const [profile, devices, into] = await Promise.all([ctx.backend.profile.get(ctx.net, id), ctx.backend.device.list(ctx.net), offlineIn(ctx, id)]);
      const current = new Set(profile.deviceIds);
      const online = (d: M.Device) => !d.paused && !d.blocked;
      const joining = into ? devices.filter((d) => listed.has(d.id) && !current.has(d.id) && online(d)) : [];
      // Devices that leave were online only if this profile is not keeping them offline.
      const out = into ? null : await offlineIn(ctx, UNASSIGNED);
      const leaving = out ? devices.filter((d) => current.has(d.id) && !listed.has(d.id) && online(d)) : [];
      const parts = [
        into && joining.length ? `${into.reason}, so ${lose(joining)} ${into.until}` : null,
        out && leaving.length ? `${out.reason}, so ${lose(leaving)} ${out.until}` : null,
      ].filter(Boolean);
      return parts.length ? `${parts.join(". ")}.` : null;
    },
    run: async (ctx, p): Promise<M.Profile> => {
      const id = await ctx.resolve("profile", p.profile);
      const deviceIds = await resolveDevices(ctx, p.devices);
      return withNext(await ctx.backend.profile.setDevices(ctx.net, id, deviceIds), ctx.now(), await timezone(ctx));
    },
  }),

  defineCommand({
    id: "profile.delete",
    label: "Delete profile",
    description: "Deletes the profile. Its devices move to Unassigned, its schedules are removed and any pause is lifted. Cannot be undone.",
    icon: "trash-2",
    effect: "destructive",
    gate: { area: "profiles", op: "delete", bridgeOff: true },
    invalidates: WRITES,
    params: z.object({ profile: ref("profile") }),
    confirmMessage: async (ctx, p) => {
      const id = await ctx.resolve("profile", p.profile);
      const profile = await ctx.backend.profile.get(ctx.net, id);
      const n = profile.deviceIds.length;
      const devices = n === 0 ? `${profile.name} has no devices;` : `${profile.name}'s ${n} device${n === 1 ? " moves" : "s move"} to Unassigned,`;
      return `${devices} its schedules are removed and any pause is lifted. This cannot be undone.`;
    },
    run: async (ctx, p): Promise<{ deleted: M.Id; name: string }> => {
      const id = await ctx.resolve("profile", p.profile);
      const profile = await ctx.backend.profile.get(ctx.net, id);
      await ctx.backend.profile.remove(ctx.net, id);
      return { deleted: id, name: profile.name };
    },
  }),

  defineCommand({
    id: "profile.unassigned.pause",
    label: "Pause unassigned devices",
    description: "Pauses internet on every device with no profile (eero's Unassigned group), until resumed. Includes TVs and smart home gear.",
    icon: "pause",
    effect: "disruptive",
    gate: { area: "profiles", bridgeOff: true },
    invalidates: WRITES,
    params: z.object({}),
    confirmMessage: async (ctx) => {
      const n = (await ctx.backend.device.list(ctx.net)).filter((d) => d.profileId === null).length;
      const who = n === 1 ? "The 1 device with no profile loses" : `All ${n} devices with no profile lose`;
      return `${who} internet until resumed, including TVs, printers and smart home gear.`;
    },
    run: async (ctx): Promise<{ paused: boolean }> => (await ctx.backend.profile.setUnassignedPaused(ctx.net, true), { paused: true }),
  }),

  defineCommand({
    id: "profile.unassigned.resume",
    label: "Resume unassigned devices",
    description: "Resumes internet on every device with no profile (eero's Unassigned group).",
    icon: "play",
    effect: "write",
    gate: { area: "profiles", bridgeOff: true },
    invalidates: WRITES,
    params: z.object({}),
    run: async (ctx): Promise<{ paused: boolean }> => (await ctx.backend.profile.setUnassignedPaused(ctx.net, false), { paused: false }),
  }),
  defineCommand({
    id: "profile.schedule.add",
    label: "Add a scheduled pause",
    description:
      "Adds a scheduled pause to a profile (or `unassigned`, devices in no profile): its devices pause from start to end on the chosen days, in the network time zone. An end before the start wraps past midnight.",
    icon: "calendar-plus",
    effect: "write",
    gate: { area: "profiles", op: "create", bridgeOff: true },
    invalidates: WRITES,
    params: z.object({ profile: ref("profile"), ...scheduleFields, enabled: z.boolean().optional().describe("Default true. Off keeps the schedule without pausing.") }),
    // A schedule whose window covers now pauses its devices straight away.
    confirmWhen: async (ctx, p) =>
      scheduleConfirm(ctx, await profileOrUnassigned(ctx, p.profile), { name: p.name, days: p.days, start: p.start, end: p.end, enabled: p.enabled ?? true }, null),
    run: async (ctx, p): Promise<M.Schedule> => {
      const id = await profileOrUnassigned(ctx, p.profile);
      const input: M.ScheduleInput = { name: p.name, days: p.days, start: p.start, end: p.end, enabled: p.enabled ?? true };
      checkSchedule(await ctx.backend.profile.get(ctx.net, id), input, null);
      return ctx.backend.profile.addSchedule(ctx.net, id, input);
    },
  }),

  defineCommand({
    id: "profile.schedule.update",
    label: "Edit schedule",
    description: "Changes a scheduled pause. Fields left out keep their value; enabled: false keeps it without pausing.",
    icon: "calendar-clock",
    effect: "write",
    gate: { area: "profiles", bridgeOff: true },
    invalidates: WRITES,
    params: z.object({
      profile: ref("profile"),
      schedule: ref("schedule"),
      name: scheduleFields.name.optional(),
      days: scheduleFields.days.optional(),
      start: scheduleFields.start.optional(),
      end: scheduleFields.end.optional(),
      enabled: z.boolean().optional(),
    }),
    // An edit that moves the window over now (or turns it on during it) pauses its devices straight away.
    async confirmWhen(ctx, p) {
      const id = await profileOrUnassigned(ctx, p.profile);
      const s = findSchedule(await ctx.backend.profile.get(ctx.net, id), p.schedule);
      const input: M.ScheduleInput = { name: p.name ?? s.name, days: p.days ?? s.days, start: p.start ?? s.start, end: p.end ?? s.end, enabled: p.enabled ?? s.enabled };
      return scheduleConfirm(ctx, id, input, s);
    },
    run: async (ctx, p): Promise<M.Schedule> => {
      const id = await profileOrUnassigned(ctx, p.profile);
      const profile = await ctx.backend.profile.get(ctx.net, id);
      const s = findSchedule(profile, p.schedule);
      const input: M.ScheduleInput = {
        name: p.name ?? s.name,
        days: p.days ?? s.days,
        start: p.start ?? s.start,
        end: p.end ?? s.end,
        enabled: p.enabled ?? s.enabled,
      };
      checkSchedule(profile, input, s);
      return ctx.backend.profile.updateSchedule(ctx.net, id, s.id, input);
    },
  }),

  defineCommand({
    id: "profile.schedule.remove",
    label: "Delete schedule",
    description: "Removes a scheduled pause from a profile. The result holds the removed schedule, so it can be added back.",
    icon: "calendar-x",
    effect: "write",
    gate: { area: "profiles", op: "delete", bridgeOff: true },
    invalidates: WRITES,
    params: z.object({ profile: ref("profile"), schedule: ref("schedule") }),
    run: async (ctx, p): Promise<{ removed: M.Id; schedule: M.Schedule }> => {
      const id = await profileOrUnassigned(ctx, p.profile);
      const s = findSchedule(await ctx.backend.profile.get(ctx.net, id), p.schedule);
      await ctx.backend.profile.removeSchedule(ctx.net, id, s.id);
      return { removed: s.id, schedule: s };
    },
  }),
];
