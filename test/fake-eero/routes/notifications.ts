/**
 * Fake notifications: `GET {net}/notifications_history?limit=50&timestamp=`
 * (newest first; `timestamp` returns only rows created before it),
 * `GET {net}/notifications/has_unread` and `GET {net}/notifications`, in the
 * captured shapes. See docs/eero-api/endpoints.md section 15.
 */

import { fail, ok, type Route } from "../server";

const MAX_PAGE = 50;

export const routes: Route[] = [
  {
    method: "GET",
    path: "/networks/:net/notifications_history",
    handle: ({ req, params, network }) => {
      const net = network(params.net ?? "");
      const limit = Number(req.query.get("limit") ?? MAX_PAGE);
      if (!Number.isInteger(limit) || limit < 1) return fail(400, "error.params.invalid");
      const cursor = req.query.get("timestamp");
      const before = cursor ? Date.parse(cursor) : Number.POSITIVE_INFINITY;
      if (Number.isNaN(before)) return fail(400, "error.params.invalid");
      const time = (n: { created_at?: string }) => Date.parse(n.created_at ?? "");
      const page = [...net.notificationsHistory]
        .sort((a, b) => time(b) - time(a))
        .filter((n) => time(n) < before)
        .slice(0, Math.min(limit, MAX_PAGE));
      return ok({ notifications: page });
    },
  },
  {
    method: "GET",
    path: "/networks/:net/notifications/has_unread",
    handle: ({ params, network }) => ok({ has_unread: network(params.net ?? "").hasUnread }),
  },
  {
    method: "GET",
    path: "/networks/:net/notifications",
    handle: ({ params, network }) => ok(network(params.net ?? "").notificationSettings),
  },
];
