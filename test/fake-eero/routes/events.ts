/**
 * Fake event stream: `GET {net}/app_events?page_size=50&timestamp=`, in the
 * shape a real network sends (`{events: [{hash, timestamp_ms, description,
 * category}]}`, docs/eero-api/endpoints.md section 17). Events come newest
 * first. By default `timestamp` (ISO 8601) returns only events before it,
 * the way the clients document paging; eero refuses epoch numbers with 400
 * `error.form.errors`. With `appEventsWindowMs` set on the network it answers
 * the way a real network does (capture of 2026-11-16, #263): only the events
 * of that last window before now, and `timestamp` ignored, so pages are short
 * and paging never reaches older events.
 */

import { fail, ok, type Route } from "../server";

const MAX_PAGE = 50;

export const routes: Route[] = [
  {
    method: "GET",
    path: "/networks/:net/app_events",
    handle: ({ req, params, network, state }) => {
      const net = network(params.net ?? "");
      if (req.encoding !== "none") return fail(400, "error.request.body.not.allowed");
      const size = Number(req.query.get("page_size") ?? MAX_PAGE);
      if (!Number.isInteger(size) || size < 1) return fail(400, "error.params.invalid");
      const cursor = req.query.get("timestamp");
      const at = cursor === null ? Number.POSITIVE_INFINITY : /^\d+$/.test(cursor) ? Number.NaN : Date.parse(cursor);
      if (Number.isNaN(at)) return fail(400, "error.form.errors");
      const window = net.appEventsWindowMs ?? null;
      const now = state.now();
      const keep = (t: number) => (window === null ? t < at : t <= now && t >= now - window);
      const time = (e: { timestamp_ms?: number }) => e.timestamp_ms ?? 0;
      const page = [...net.appEvents]
        .sort((a, b) => time(b) - time(a))
        .filter((e) => keep(time(e)))
        .slice(0, Math.min(size, MAX_PAGE));
      return ok({ events: page });
    },
  },
];
