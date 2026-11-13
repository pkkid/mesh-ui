/**
 * profile commands (read side). `nextChange` and the Unassigned summary are
 * computed here, in core. See docs/architecture/commands.md#profile-commandsprofilets.
 */

import { z } from "zod";
import type * as M from "../model";
import { POLL } from "../poll";
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

async function timezone(ctx: CommandContext): Promise<string | null> {
  try {
    return (await ctx.backend.network.get(ctx.net)).timezone;
  } catch {
    // No time zone, no next change; the profile itself still loads.
    return null;
  }
}

const withNext = (p: M.Profile, now: number, tz: string | null): M.Profile => ({ ...p, nextChange: nextChange(p, now, tz) });

export const commands: AnyCommand[] = [
  defineCommand({
    id: "profile.list",
    label: "Profiles",
    description:
      "Lists profiles with state (active, paused, scheduled), devices, schedules and the next scheduled change, plus an Unassigned summary for devices with no profile.",
    icon: "users",
    effect: "query",
    topic: "profiles",
    poll: POLL.profiles,
    params: z.object({}),
    run: async (ctx): Promise<M.ProfileList> => {
      const [profiles, devices, tz] = await Promise.all([ctx.backend.profile.list(ctx.net), ctx.backend.device.list(ctx.net), timezone(ctx)]);
      const now = ctx.now();
      const owned = new Set(profiles.flatMap((p) => p.deviceIds));
      const unassigned = devices.filter((d) => !d.blocked && !d.profileId && !owned.has(d.id));
      return {
        profiles: profiles.map((p) => withNext(p, now, tz)).sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" })),
        unassigned: {
          deviceIds: unassigned.map((d) => d.id),
          devicesOnline: unassigned.filter((d) => d.connected).length,
          paused: unassigned.length > 0 && unassigned.every((d) => d.paused),
        },
      };
    },
  }),

  defineCommand({
    id: "profile.get",
    label: "Profile",
    description: "One profile with its devices, schedules and the next scheduled change.",
    icon: "user",
    effect: "query",
    topic: "profiles",
    poll: POLL.profiles,
    params: z.object({ profile: ref("profile") }),
    run: async (ctx, p): Promise<M.Profile> => {
      const id = await ctx.resolve("profile", p.profile);
      const [profile, tz] = await Promise.all([ctx.backend.profile.get(ctx.net, id), timezone(ctx)]);
      return withNext(profile, ctx.now(), tz);
    },
  }),
];
