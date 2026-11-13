/**
 * Data usage: `usage.get` (one series, or one per eero or profile) and
 * `usage.breakdown` (who used the most). Windows, the 7-day limit, totals,
 * busiest bucket, "today so far", sorting and shares are all decided here,
 * so the demo and eero backends only move bytes. See
 * docs/architecture/commands.md (internet) and docs/ux/pages/overview.md.
 */

import { z } from "zod";
import { dayStart, hourStart } from "../demo/backend";
import { CommandError } from "../errors";
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

    if (p.scope === "network" || p.scope === "guest") return query(p.scope, null);
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

const usageBreakdown = defineCommand({
  id: "usage.breakdown",
  label: "Usage breakdown",
  description: "Who used the most data over the last day or week: rows per device, profile (plus Unassigned) or eero, largest first, with each row's share of the network total.",
  icon: "list-ordered",
  params: z.object({
    range,
    by: z.enum(["device", "profile", "eero"]).default("device"),
    profile: ref("profile").optional().describe("With by device: only that profile's devices."),
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
    return p.format === "csv" ? toCsv(result.rows, BREAKDOWN_CSV) : result;
  },
});

export const commands = [usageGet, usageBreakdown];
