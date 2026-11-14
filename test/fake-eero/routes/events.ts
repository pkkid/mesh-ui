/**
 * Fake event stream: `GET {net}/app_events?page_size=50&timestamp=`, in the
 * shape a real network sends (`{events: [{hash, timestamp_ms, description,
 * category}]}`, docs/eero-api/endpoints.md section 17). Events come newest
 * first; `timestamp` (ISO 8601 or epoch ms) returns only events before it,
 * the way eero pages.
 */

import { fail, ok, type Route } from "../server";

const MAX_PAGE = 50;

export const routes: Route[] = [
  {
    method: "GET",
    path: "/networks/:net/app_events",
    handle: ({ req, params, network }) => {
      const net = network(params.net ?? "");
      if (req.encoding !== "none") return fail(400, "error.request.body.not.allowed");
      const size = Number(req.query.get("page_size") ?? MAX_PAGE);
      if (!Number.isInteger(size) || size < 1) return fail(400, "error.params.invalid");
      const cursor = req.query.get("timestamp");
      const before = cursor === null ? Number.POSITIVE_INFINITY : /^\d+$/.test(cursor) ? Number(cursor) : Date.parse(cursor);
      if (Number.isNaN(before)) return fail(400, "error.params.invalid");
      const time = (e: { timestamp_ms?: number }) => e.timestamp_ms ?? 0;
      const page = [...net.appEvents]
        .sort((a, b) => time(b) - time(a))
        .filter((e) => time(e) < before)
        .slice(0, Math.min(size, MAX_PAGE));
      return ok({ events: page });
    },
  },
];
