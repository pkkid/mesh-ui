/**
 * Activity: `events.list`, the network event stream, newest first. The
 * backends hand back raw pages; paging across them, every filter, the
 * per-category counts and CSV are done here. See
 * docs/architecture/commands.md (activity).
 */

import { z } from "zod";
import { CommandError } from "../errors";
import { type CsvColumn, toCsv } from "../format";
import type * as M from "../model";
import { POLL, TTL } from "../poll";
import { defineCommand, ref } from "../spec";

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
    "Network events newest first, a page at a time (pass nextCursor back as cursor). Filters by category, device, eero, profile, text and time; counts are per category for the events on this page. format csv returns the page as CSV.",
  icon: "activity",
  params: z.object({
    cursor: z.string().min(1).optional().describe("nextCursor from the previous page."),
    limit: z.number().int().min(1).max(50).default(50),
    type: z.array(z.enum(EVENT_CATEGORIES)).min(1).optional().describe("Only these categories."),
    device: ref("device").optional(),
    eero: ref("eero").optional(),
    profile: ref("profile").optional(),
    search: z.string().trim().min(1).optional().describe("Case-insensitive text in the title or detail."),
    since: time.optional().describe("Only events at or after this ISO 8601 time."),
    until: time.optional().describe("Only events at or before this ISO 8601 time."),
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
    const deviceId = p.device ? await ctx.resolve("device", p.device) : null;
    const eeroId = p.eero ? await ctx.resolve("eero", p.eero) : null;
    const profileId = p.profile ? await ctx.resolve("profile", p.profile) : null;
    const types = p.type ? new Set<M.EventCategory>(p.type) : null;
    const needle = p.search?.toLowerCase() ?? null;

    const matches = (e: M.NetworkEvent): boolean => {
      const at = Date.parse(e.at);
      if (until !== null && at > until) return false;
      if (types && !types.has(e.category)) return false;
      if (deviceId && e.refs.deviceId !== deviceId) return false;
      if (eeroId && e.refs.eeroId !== eeroId) return false;
      if (profileId && e.refs.profileId !== profileId) return false;
      if (needle && !`${e.title}\n${e.detail ?? ""}`.toLowerCase().includes(needle)) return false;
      return true;
    };

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
        if (out.length === p.limit) {
          next = i + 1 < chunk.events.length ? { c: page, o: i + 1 } : chunk.nextCursor ? { c: chunk.nextCursor, o: 0 } : null;
          done = true;
          break;
        }
      }
      if (done || !chunk.nextCursor) break;
      if (pages >= MAX_PAGES_PER_CALL) {
        next = { c: chunk.nextCursor, o: 0 };
        break;
      }
      page = chunk.nextCursor;
      skip = 0;
    }

    if (p.format === "csv") return toCsv(out, EVENTS_CSV);
    const counts = Object.fromEntries(EVENT_CATEGORIES.map((c) => [c, 0])) as Record<M.EventCategory, number>;
    for (const e of out) counts[e.category]++;
    return { events: out, nextCursor: next ? encodeCursor(next) : null, counts };
  },
});

export const commands = [eventsList];
