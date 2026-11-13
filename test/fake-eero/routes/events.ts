/**
 * Fake event stream: `GET {net}/app_events?page_size=50&timestamp=`. Events
 * come newest first; `timestamp` returns only events created before it, the
 * way eero pages. See docs/eero-api/endpoints.md section 9.
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
      const before = cursor ? Date.parse(cursor) : Number.POSITIVE_INFINITY;
      if (Number.isNaN(before)) return fail(400, "error.params.invalid");
      const time = (e: { created?: string }) => Date.parse(e.created ?? "");
      const page = [...net.events]
        .sort((a, b) => time(b) - time(a))
        .filter((e) => time(e) < before)
        .slice(0, Math.min(size, MAX_PAGE));
      return ok(page);
    },
  },
];
