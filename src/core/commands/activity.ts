/**
 * Activity: `events.list`, the network event stream, newest first, and
 * `events.summary`, the totals behind the Activity hero and chart. The
 * backends hand back raw pages; paging across them, every filter, grouping,
 * the per-category counts and CSV are done here. See
 * docs/architecture/commands.md (activity).
 */

import { z } from "zod";
import { CommandError } from "../errors";
import { type CsvColumn, toCsv } from "../format";
import type * as M from "../model";
import { POLL, TTL } from "../poll";
import { dayStart, hourStart } from "../demo/backend";
import { type CommandContext, defineCommand, ref } from "../spec";

export const EVENT_CATEGORIES = [
  "devices",
  "pause_block",
  "schedules",
  "eero_status",
  "speed_tests",
  "firmware",
  "admin",
  "ports_temperature",
  "other",
] as const satisfies readonly M.EventCategory[];

/** Backend pages read at most per call, so a narrow filter cannot walk the whole history. */
export const MAX_PAGES_PER_CALL = 10;

/**
 * Backend pages `events.summary` reads at most: 1,000 events, enough for a
 * busy week on a free account (about 7 days of history). With the summary
 * cached for SUMMARY_TTL seconds that stays far under the request budget.
 */
export const MAX_SUMMARY_PAGES = 20;

/** The most events one CSV export holds (Export CSV asks for the whole filtered range). */
export const MAX_CSV_ROWS = 1000;

/** Seconds a summary is kept; the Activity page polls it with the stream. */
export const SUMMARY_TTL = 120;

/** Events of the same type and title within this long of each other fold into one row. */
export const GROUP_WINDOW_MS = 60 * 60_000;

const HOUR = 3_600_000;

const emptyCounts = (): Record<M.EventCategory, number> => Object.fromEntries(EVENT_CATEGORIES.map((c) => [c, 0])) as Record<M.EventCategory, number>;

/**
 * Folds events of the same type and title that land within GROUP_WINDOW_MS
 * of the previous one into the newest of them, keeping the stream order.
 * The folded events are in `grouped`, newest first.
 */
export function groupEvents(events: ReadonlyArray<M.NetworkEvent>): M.NetworkEvent[] {
  const out: M.NetworkEvent[] = [];
  const open = new Map<string, { row: M.NetworkEvent; last: number }>();
  for (const e of events) {
    const key = `${e.type}\n${e.title}`;
    const at = Date.parse(e.at);
    const g = open.get(key);
    if (g && g.last - at <= GROUP_WINDOW_MS) {
      (g.row.grouped ??= []).push(e);
      g.last = at;
      continue;
    }
    const row = { ...e };
    out.push(row);
    open.set(key, { row, last: at });
  }
  return out;
}

type EntityFilter = { kind: "device" | "eero" | "profile"; id: M.Id; names: string[] };

/** A device, eero or profile filter: its id, and its names for events that carry no refs (the real eero stream). */
async function entityFilter(ctx: CommandContext, kind: EntityFilter["kind"], value: string): Promise<EntityFilter> {
  const id = await ctx.resolve(kind, value);
  const names: (string | null | undefined)[] = [];
  if (kind === "device") {
    const d = (await ctx.backend.device.list(ctx.net)).find((x) => x.id === id);
    names.push(d?.name, d?.nickname);
  } else if (kind === "eero") {
    names.push((await ctx.backend.eero.list(ctx.net)).find((x) => x.id === id)?.location);
  } else {
    names.push((await ctx.backend.profile.list(ctx.net)).find((x) => x.id === id)?.name);
  }
  return { kind, id, names: [...new Set(names.flatMap((n) => (n && n.trim().length > 1 ? [n.trim().toLowerCase()] : [])))] };
}

const REF_KEY = { device: "deviceId", eero: "eeroId", profile: "profileId" } as const;

function matchesEntity(e: M.NetworkEvent, f: EntityFilter): boolean {
  const refId = e.refs[REF_KEY[f.kind]];
  if (refId !== undefined) return refId === f.id;
  // Events with refs say who they are about; only ref-less events fall back to their text.
  if (Object.keys(e.refs).length > 0) return false;
  const text = `${e.title}\n${e.detail ?? ""}`.toLowerCase();
  return f.names.some((n) => text.includes(n));
}

type FilterParams = { type?: M.EventCategory[]; device?: string; eero?: string; profile?: string; search?: string };

/** One predicate for every filter both commands share. */
async function eventFilter(ctx: CommandContext, p: FilterParams): Promise<(e: M.NetworkEvent) => boolean> {
  const entities = await Promise.all(
    (["device", "eero", "profile"] as const).flatMap((k) => (p[k] ? [entityFilter(ctx, k, p[k] as string)] : [])),
  );
  const types = p.type ? new Set<M.EventCategory>(p.type) : null;
  const needle = p.search?.toLowerCase() ?? null;
  return (e) => {
    if (types && !types.has(e.category)) return false;
    if (!entities.every((f) => matchesEntity(e, f))) return false;
    if (needle && !`${e.title}\n${e.detail ?? ""}`.toLowerCase().includes(needle)) return false;
    return true;
  };
}

/** Where the next page starts: a backend page cursor and how many events of that page were already handed out. */
type Cursor = { c: string | null; o: number };

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

function decodeCursor(s: string): Cursor {
  try {
    const v: unknown = JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
    if (v && typeof v === "object") {
      const { c, o } = v as Record<string, unknown>;
      if ((c === null || typeof c === "string") && typeof o === "number" && Number.isInteger(o) && o >= 0) return { c, o };
    }
  } catch {
    // Falls through to the error below.
  }
  throw new CommandError("bad_params", "That events cursor is not valid. Use the nextCursor of the previous page.");
}

const EVENTS_CSV: CsvColumn<M.NetworkEvent>[] = [
  { header: "Time", value: (e) => e.at },
  { header: "Category", value: (e) => e.category },
  { header: "Type", value: (e) => e.type },
  { header: "Title", value: (e) => e.title },
  { header: "Detail", value: (e) => e.detail },
];

const time = z.iso.datetime({ offset: true });

const eventsList = defineCommand({
  id: "events.list",
  label: "Event stream",
  description:
    "Network events newest first, a page at a time (pass nextCursor back as cursor). Filters by category, device, eero, profile, text and time; counts are per category for the events on this page. grouped folds repeats into one row. format csv returns the page as CSV (never grouped).",
  icon: "activity",
  params: z.object({
    cursor: z.string().min(1).optional().describe("nextCursor from the previous page."),
    limit: z.number().int().min(1).max(MAX_CSV_ROWS).optional().describe(`Events per page, 1 to 50 (default 50); up to ${MAX_CSV_ROWS} with format csv.`),
    type: z.array(z.enum(EVENT_CATEGORIES)).min(1).optional().describe("Only these categories."),
    device: ref("device").optional(),
    eero: ref("eero").optional(),
    profile: ref("profile").optional(),
    search: z.string().trim().min(1).optional().describe("Case-insensitive text in the title or detail."),
    since: time.optional().describe("Only events at or after this ISO 8601 time."),
    until: time.optional().describe("Only events at or before this ISO 8601 time."),
    grouped: z.boolean().default(false).describe("Fold repeats of the same event within an hour into one row (see grouped on each event)."),
    format: z.enum(["json", "csv"]).default("json"),
  }),
  effect: "query",
  topic: "events",
  // Only the first page is cached; later pages are read fresh.
  ttl: (p) => (p.cursor ? 0 : TTL.events),
  poll: POLL.events,
  async run(ctx, p): Promise<M.EventPage | string> {
    const since = p.since ? Date.parse(p.since) : null;
    const until = p.until ? Date.parse(p.until) : null;
    if (since !== null && until !== null && since > until) throw new CommandError("bad_params", "since must be before until.");
    const limit = p.limit ?? 50;
    if (p.format === "json" && limit > 50) throw new CommandError("bad_params", `limit is 1 to 50; up to ${MAX_CSV_ROWS} only with format csv.`);
    const pageBudget = p.format === "csv" ? MAX_SUMMARY_PAGES : MAX_PAGES_PER_CALL;
    const filter = await eventFilter(ctx, p);
    const matches = (e: M.NetworkEvent): boolean => (until === null || Date.parse(e.at) <= until) && filter(e);

    const start = p.cursor ? decodeCursor(p.cursor) : { c: null, o: 0 };
    const out: M.NetworkEvent[] = [];
    let next: Cursor | null = null;
    let page = start.c;
    let skip = start.o;
    for (let pages = 1; ; pages++) {
      const chunk = await ctx.backend.events.list(ctx.net, page);
      let done = false;
      for (let i = skip; i < chunk.events.length; i++) {
        const e = chunk.events[i] as M.NetworkEvent;
        // Newest first: once past `since`, nothing older can match.
        if (since !== null && Date.parse(e.at) < since) {
          done = true;
          break;
        }
        if (!matches(e)) continue;
        out.push(e);
        if (out.length === limit) {
          next = i + 1 < chunk.events.length ? { c: page, o: i + 1 } : chunk.nextCursor ? { c: chunk.nextCursor, o: 0 } : null;
          done = true;
          break;
        }
      }
      if (done || !chunk.nextCursor) break;
      if (pages >= pageBudget) {
        next = { c: chunk.nextCursor, o: 0 };
        break;
      }
      page = chunk.nextCursor;
      skip = 0;
    }

    if (p.format === "csv") return toCsv(out, EVENTS_CSV);
    const counts = emptyCounts();
    for (const e of out) counts[e.category]++;
    return { events: p.grouped ? groupEvents(out) : out, nextCursor: next ? encodeCursor(next) : null, counts };
  },
});

const eventsSummary = defineCommand({
  id: "events.summary",
  label: "Event summary",
  description:
    "Event totals for the last day or week: total, daily average, change against the same length of time before it (null when history does not reach that far), counts per category and per hour or day bucket in the network time zone.",
  icon: "activity",
  params: z.object({
    range: z.enum(["day", "week"]).describe("day: the last 24 hours; week: the last 7 days, today included."),
    bucket: z.enum(["hour", "day"]).optional().describe("Bucket size. Default hour for day, day for week."),
    type: z.array(z.enum(EVENT_CATEGORIES)).min(1).optional().describe("Only these categories."),
    device: ref("device").optional(),
    eero: ref("eero").optional(),
    profile: ref("profile").optional(),
  }),
  effect: "query",
  topic: "events",
  ttl: SUMMARY_TTL,
  poll: POLL.events,
  async run(ctx, p): Promise<M.EventSummary> {
    const bucket: M.EventBucket = p.bucket ?? (p.range === "day" ? "hour" : "day");
    const tz = (await ctx.backend.network.get(ctx.net)).timezone ?? "UTC";
    const filter = await eventFilter(ctx, p);
    const to = ctx.now();
    const from = p.range === "day" ? hourStart(to, tz) - 23 * HOUR : dayStart(to - 6 * 24 * HOUR, tz);
    const priorFrom = from - (to - from);

    // Bucket starts, oldest first. Days step past the next midnight and floor, so DST days stay whole.
    const starts: number[] = [];
    for (let t = bucket === "hour" ? hourStart(from, tz) : dayStart(from, tz); t <= to; ) {
      starts.push(t);
      t = bucket === "hour" ? t + HOUR : dayStart(t + 26 * HOUR, tz);
    }
    const buckets = starts.map((t) => ({ at: new Date(t).toISOString(), total: 0, counts: emptyCounts() }));
    const counts = emptyCounts();
    let total = 0;
    let prior = 0;
    let reachedPrior = false;
    let partial = false;

    let cursor: string | null = null;
    scan: for (let pages = 1; ; pages++) {
      const chunk = await ctx.backend.events.list(ctx.net, cursor);
      for (const e of chunk.events) {
        const at = Date.parse(e.at);
        if (at > to) continue;
        // Newest first: once past the prior period, nothing older counts.
        if (at < priorFrom) {
          reachedPrior = true;
          break scan;
        }
        if (!filter(e)) continue;
        if (at < from) {
          prior++;
          continue;
        }
        total++;
        counts[e.category]++;
        let i = starts.length - 1;
        while (i > 0 && (starts[i] as number) > at) i--;
        const b = buckets[i];
        if (b) {
          b.total++;
          b.counts[e.category]++;
        }
      }
      if (!chunk.nextCursor) break;
      if (pages >= MAX_SUMMARY_PAGES) {
        partial = true;
        break;
      }
      cursor = chunk.nextCursor;
    }

    const known = reachedPrior && !partial;
    return {
      range: p.range,
      bucket,
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      total,
      dailyAverage: total / (p.range === "day" ? 1 : 7),
      prior: known ? prior : null,
      change: known && prior > 0 ? (total - prior) / prior : null,
      counts,
      buckets,
      partial,
    };
  },
});

export const commands = [eventsList, eventsSummary];
