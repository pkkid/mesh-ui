/**
 * Data usage: `usage.get` (one series, or one per eero or profile) and
 * `usage.breakdown` (who used the most). Windows, the 7-day limit, totals,
 * busiest bucket, "today so far", sorting and shares are all decided here,
 * so the demo and eero backends only move bytes. See
 * docs/architecture/commands.md (internet) and docs/ux/pages/overview.md.
 */

import { z } from "zod";
import { dayStart, hourStart, tzOffset } from "../demo/backend";
import { BackendError, CommandError } from "../errors";
import { type CsvColumn, toCsv } from "../format";
import type * as M from "../model";
import { POLL, USAGE_TTL } from "../poll";
import { type CommandContext, defineCommand, ref } from "../spec";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Free eero accounts keep about 7 days of usage; nothing older is asked for or shown. */
export const USAGE_MAX_DAYS = 7;

export type UsageWindow = { from: number; to: number; cadence: M.UsageCadence };

/**
 * The window a range covers, in the network time zone: day is the last 24
 * hours (whole local hours, the current one partial), week the last 7 local
 * days (today partial). `from` is clamped to `USAGE_MAX_DAYS` before `now`,
 * which only bites across a DST change.
 */
export function usageWindow(range: M.UsageRange, cadence: M.UsageCadence | undefined, now: number, tz: string): UsageWindow {
  const aligned = range === "day" ? hourStart(now, tz) - 23 * HOUR : dayStart(now - 6 * DAY, tz);
  return { from: Math.max(aligned, now - USAGE_MAX_DAYS * DAY), to: now, cadence: cadence ?? (range === "day" ? "hourly" : "daily") };
}

const bytesOf = (p: { down: number; up: number }) => p.down + p.up;

/**
 * Keeps the points inside the window (a bucket that starts before a clamped
 * `from` but overlaps it stays) and recomputes total, busiest and today so
 * far from what is left, so every backend answers the same way.
 */
export function finishSeries(s: M.UsageSeries, w: UsageWindow, tz: string): M.UsageSeries {
  const first = w.cadence === "hourly" ? hourStart(w.from, tz) : dayStart(w.from, tz);
  const points = s.points
    .filter((p) => {
      const at = Date.parse(p.at);
      return at >= first && at <= w.to;
    })
    .map((p) => ({ at: p.at, down: p.down, up: p.up }));
  const total = points.reduce((t, p) => ({ down: t.down + p.down, up: t.up + p.up }), { down: 0, up: 0 });
  const busiest = points.reduce<M.UsagePoint | null>((best, p) => (bytesOf(p) > (best ? bytesOf(best) : 0) ? p : best), null);
  const today = dayStart(w.to, tz);
  const todaySoFar = points.length ? points.filter((p) => Date.parse(p.at) >= today).reduce((n, p) => n + bytesOf(p), 0) : null;
  return { scope: s.scope, id: s.id, range: s.range, cadence: w.cadence, points, total, busiest: busiest ? { ...busiest } : null, todaySoFar };
}

/** The network's IANA zone, which every bucket is aligned to. */
async function networkZone(ctx: CommandContext): Promise<string> {
  return (await ctx.backend.network.get(ctx.net)).timezone ?? "UTC";
}

const range = z.enum(["day", "week"]).default("day").describe("day: the last 24 hours. week: the last 7 days (the most eero keeps on free accounts).");

const usageGet = defineCommand({
  id: "usage.get",
  label: "Data usage",
  description:
    "Bytes down and up over the last day or week, per hour or per day, for the network, one eero, device or profile, or the guest network. Without an id, the eero and profile scopes return one series each (profiles add Unassigned).",
  icon: "chart-area",
  params: z.object({
    scope: z.enum(["network", "eero", "device", "profile", "guest"]).default("network"),
    id: ref("eero, device or profile").optional().describe("The eero, device or profile (id or exact name). Leave out for network and guest."),
    range,
    cadence: z.enum(["hourly", "daily"]).optional().describe("Bucket size. Default hourly for day and daily for week; week with hourly feeds the busy-hours heatmap."),
  }),
  effect: "query",
  topic: "usage",
  ttl: (p) => USAGE_TTL[p.range],
  poll: POLL.usage,
  async run(ctx, p): Promise<M.UsageSeries | M.UsageSeries[]> {
    if ((p.scope === "network" || p.scope === "guest") && p.id) throw new CommandError("bad_params", `The ${p.scope} scope takes no id.`);
    if (p.scope === "device" && !p.id) throw new CommandError("bad_params", "The device scope needs an id.");
    const tz = await networkZone(ctx);
    const w = usageWindow(p.range, p.cadence, ctx.now(), tz);
    const query = (scope: M.UsageScope, id: M.Id | null) =>
      ctx.backend.usage
        .series(ctx.net, { scope, id, range: p.range, from: new Date(w.from).toISOString(), to: new Date(w.to).toISOString(), cadence: w.cadence, timezone: tz })
        .then((s) => finishSeries(s, w, tz));

    if (p.scope === "network") return query("network", null);
    if (p.scope === "guest") return guestSeries(ctx, w, tz, p.range);
    if (p.id) {
      const kind = p.scope as "eero" | "device" | "profile";
      return query(kind, await ctx.resolve(kind, p.id));
    }

    // No id: one series per eero, or per profile plus Unassigned.
    if (p.scope === "eero") {
      const eeros = await ctx.backend.eero.list(ctx.net);
      const out: M.UsageSeries[] = [];
      for (const e of eeros) out.push(await query("eero", e.id));
      return out;
    }
    const profiles = await ctx.backend.profile.list(ctx.net);
    const out: M.UsageSeries[] = [];
    for (const pr of profiles) out.push(await query("profile", pr.id));
    out.push(finishSeries(unassigned(await query("network", null), out), w, tz));
    return out;
  },
});

/**
 * The guest network: every device seen on it that was online during the
 * window, added up bucket by bucket. eero has no guest usage endpoint, so
 * both backends answer this the same way, from the per-device series. A
 * guest eero no longer knows (404) adds nothing.
 */
async function guestSeries(ctx: CommandContext, w: UsageWindow, tz: string, range: M.UsageRange): Promise<M.UsageSeries> {
  const devices = await ctx.backend.device.list(ctx.net);
  const guests = devices.filter((d) => d.ssid === "guest" && (d.connected || (d.lastActive !== null && Date.parse(d.lastActive) >= w.from)));
  const sum = new Map<string, { down: number; up: number }>();
  for (const g of guests) {
    let s: M.UsageSeries;
    try {
      s = await ctx.backend.usage.series(ctx.net, { scope: "device", id: g.id, range, from: new Date(w.from).toISOString(), to: new Date(w.to).toISOString(), cadence: w.cadence, timezone: tz });
    } catch (err) {
      if (err instanceof BackendError && err.code === "eero_error" && err.detail?.status === 404) continue;
      throw err;
    }
    for (const p of s.points) {
      const t = sum.get(p.at) ?? { down: 0, up: 0 };
      t.down += p.down;
      t.up += p.up;
      sum.set(p.at, t);
    }
  }
  const points = [...sum.entries()].sort(([a], [b]) => Date.parse(a) - Date.parse(b)).map(([at, t]) => ({ at, ...t }));
  return finishSeries({ scope: "guest", id: null, range, cadence: w.cadence, points, total: { down: 0, up: 0 }, busiest: null, todaySoFar: null }, w, tz);
}

/** The network minus every profile, bucket by bucket: the devices in no profile. */
function unassigned(network: M.UsageSeries, profiles: M.UsageSeries[]): M.UsageSeries {
  const used = new Map<string, { down: number; up: number }>();
  for (const s of profiles) {
    for (const p of s.points) {
      const u = used.get(p.at) ?? { down: 0, up: 0 };
      u.down += p.down;
      u.up += p.up;
      used.set(p.at, u);
    }
  }
  const points = network.points.map((p) => {
    const u = used.get(p.at) ?? { down: 0, up: 0 };
    return { at: p.at, down: Math.max(0, p.down - u.down), up: Math.max(0, p.up - u.up) };
  });
  return { ...network, scope: "profile", id: null, points };
}

// ---------------------------------------------------------------------------
// Breakdown

const BREAKDOWN_CSV: CsvColumn<M.UsageBreakdownRow>[] = [
  { header: "Name", value: (r) => r.name },
  { header: "ID", value: (r) => r.id },
  { header: "Download (bytes)", value: (r) => r.down },
  { header: "Upload (bytes)", value: (r) => r.up },
  { header: "Total (bytes)", value: (r) => r.down + r.up },
  { header: "Share (%)", value: (r) => r.share },
];

/**
 * The first `top` rows, then one "Others (n)" row summing the rest that used
 * any data (n counts those); no Others row when none did.
 */
export function foldOthers(rows: M.UsageBreakdownRow[], top: number, all: number): M.UsageBreakdownRow[] {
  const rest = rows.slice(top).filter((r) => r.down + r.up > 0);
  if (rest.length === 0) return rows.slice(0, top);
  const down = rest.reduce((n, r) => n + r.down, 0);
  const up = rest.reduce((n, r) => n + r.up, 0);
  const share = all > 0 ? Math.round(((down + up) / all) * 1000) / 10 : 0;
  return [...rows.slice(0, top), { id: null, name: `Others (${rest.length})`, down, up, share }];
}

/**
 * By profile, every row is a person's profile or Unassigned: a row whose id
 * is not in `profile.list` (eero's default profile, a deleted profile, or no
 * id at all) folds into one Unassigned row with a null id, the same rule as
 * device.list (docs/architecture/data-model.md, default profile).
 */
export function foldUnassigned(rows: M.UsageBreakdownRow[], profileIds: ReadonlySet<string>): M.UsageBreakdownRow[] {
  const known = rows.filter((r) => r.id !== null && profileIds.has(r.id));
  const rest = rows.filter((r) => !(r.id !== null && profileIds.has(r.id)));
  if (rest.length === 0) return known;
  const down = rest.reduce((n, r) => n + r.down, 0);
  const up = rest.reduce((n, r) => n + r.up, 0);
  return [...known, { id: null, name: "Unassigned", down, up, share: 0 }];
}

const usageBreakdown = defineCommand({
  id: "usage.breakdown",
  label: "Usage breakdown",
  description: "Who used the most data over the last day or week: rows per device, profile (plus Unassigned) or eero, largest first, with each row's share of the network total. `top` folds the smaller rows into one Others row.",
  icon: "list-ordered",
  params: z.object({
    range,
    by: z.enum(["device", "profile", "eero"]).default("device"),
    profile: ref("profile").optional().describe("With by device: only that profile's devices."),
    top: z.number().int().min(1).max(100).optional().describe('Keep the largest `top` rows and fold the rest into one last row, "Others (n)", with a null id.'),
    format: z.enum(["json", "csv"]).default("json"),
  }),
  effect: "query",
  topic: "usage",
  ttl: (p) => USAGE_TTL[p.range],
  poll: POLL.usage,
  async run(ctx, p): Promise<M.UsageBreakdown | string> {
    if (p.profile && p.by !== "device") throw new CommandError("bad_params", "profile only works with by device.");
    const tz = await networkZone(ctx);
    const w = usageWindow(p.range, "daily", ctx.now(), tz);
    const raw = await ctx.backend.usage.breakdown(ctx.net, { by: p.by, range: p.range, from: new Date(w.from).toISOString(), to: new Date(w.to).toISOString() });
    let rows = raw.rows;
    if (p.by === "profile") {
      const profiles = await ctx.backend.profile.list(ctx.net);
      rows = foldUnassigned(rows, new Set(profiles.map((pr) => pr.id)));
    }
    if (p.profile) {
      const profile = await ctx.backend.profile.get(ctx.net, await ctx.resolve("profile", p.profile));
      const ids = new Set(profile.deviceIds);
      rows = rows.filter((r) => r.id !== null && ids.has(r.id));
    }
    const all = bytesOf(raw.total);
    const result: M.UsageBreakdown = {
      range: p.range,
      by: p.by,
      rows: rows
        .map((r) => ({ id: r.id, name: r.name, down: r.down, up: r.up, share: all > 0 ? Math.round((bytesOf(r) / all) * 1000) / 10 : 0 }))
        .sort((a, b) => bytesOf(b) - bytesOf(a) || a.name.localeCompare(b.name)),
      total: { down: raw.total.down, up: raw.total.up },
    };
    if (p.top !== undefined) result.rows = foldOthers(result.rows, p.top, all);
    return p.format === "csv" ? toCsv(result.rows, BREAKDOWN_CSV) : result;
  },
});

// ---------------------------------------------------------------------------
// Quiet hours

/** eero's update window is about 3 hours; the preferred hour is its start. */
export const UPDATE_WINDOW_HOURS = 3;

/**
 * Average bytes per hour of day (network time) from hourly points, leaving
 * out the hour in progress at `now` since it is partial. An hour with no
 * point is null.
 */
export function hourlyAverages(points: M.UsagePoint[], now: number, tz: string): (number | null)[] {
  const current = hourStart(now, tz);
  const sums = Array.from({ length: 24 }, () => ({ bytes: 0, n: 0 }));
  for (const p of points) {
    const at = Date.parse(p.at);
    if (!Number.isFinite(at) || at >= current) continue;
    const hour = new Date(at + tzOffset(at, tz)).getUTCHours();
    const slot = sums[hour];
    if (!slot) continue;
    slot.bytes += bytesOf(p);
    slot.n++;
  }
  return sums.map((s) => (s.n > 0 ? s.bytes / s.n : null));
}

/** Mean of `len` hours from `start`, wrapping past midnight; null when any of them has no data. */
export function windowAverage(avgs: (number | null)[], start: number, len = UPDATE_WINDOW_HOURS): number | null {
  let sum = 0;
  for (let i = 0; i < len; i++) {
    const v = avgs[(start + i) % 24];
    if (v === null || v === undefined) return null;
    sum += v;
  }
  return sum / len;
}

/** The quietest window (lowest mean, earliest start on a tie) and the busiest hour; none of them when there was no traffic. */
export function quietHours(avgs: (number | null)[], range: M.UsageRange, selected?: number): M.QuietHours {
  // No traffic at all (an offline network): nothing is quietest or busiest.
  if (!avgs.some((v) => v !== null && v > 0)) {
    const out: M.QuietHours = { range, hours: avgs.map((avg, hour) => ({ hour, avg })), windowHours: UPDATE_WINDOW_HOURS, quietest: null, busiest: null };
    if (selected !== undefined) out.selected = { start: selected, avg: null };
    return out;
  }
  let quietest: M.QuietHours["quietest"] = null;
  for (let start = 0; start < 24; start++) {
    const avg = windowAverage(avgs, start);
    if (avg !== null && (quietest === null || avg < quietest.avg)) quietest = { start, avg };
  }
  let busiest: M.QuietHours["busiest"] = null;
  for (let hour = 0; hour < 24; hour++) {
    const avg = avgs[hour] ?? null;
    if (avg !== null && (busiest === null || avg > busiest.avg)) busiest = { hour, avg };
  }
  const out: M.QuietHours = { range, hours: avgs.map((avg, hour) => ({ hour, avg })), windowHours: UPDATE_WINDOW_HOURS, quietest, busiest };
  if (selected !== undefined) out.selected = { start: selected, avg: windowAverage(avgs, selected) };
  return out;
}

const usageQuietHours = defineCommand({
  id: "usage.quiet_hours",
  label: "Quietest hours",
  description:
    "Average network traffic for each hour of the day (network time) over the last day or week, the quietest 3-hour window, and the busiest hour. Pass `start` to also get the average of the window that starts at that hour (the preferred update time).",
  icon: "moon",
  params: z.object({
    range: z.enum(["day", "week"]).default("week").describe("day: the last 24 hours. week: the last 7 days."),
    start: z.number().int().min(0).max(23).optional().describe("Start hour (0 to 23) of a window to average, such as the preferred update hour."),
  }),
  effect: "query",
  topic: "usage",
  ttl: (p) => USAGE_TTL[p.range],
  async run(ctx, p): Promise<M.QuietHours> {
    const tz = await networkZone(ctx);
    const now = ctx.now();
    const w = usageWindow(p.range, "hourly", now, tz);
    const s = await ctx.backend.usage.series(ctx.net, { scope: "network", id: null, range: p.range, from: new Date(w.from).toISOString(), to: new Date(w.to).toISOString(), cadence: "hourly", timezone: tz });
    return quietHours(hourlyAverages(finishSeries(s, w, tz).points, now, tz), p.range, p.start);
  },
});

export const commands = [usageGet, usageBreakdown, usageQuietHours];
