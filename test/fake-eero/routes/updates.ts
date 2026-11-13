/**
 * Fake software update routes: `GET {net}/updates`, the same object the
 * network embeds as `updates`. See docs/eero-api/endpoints.md (updates).
 */

import { ok, type Route } from "../server";

export const routes: Route[] = [
  {
    method: "GET",
    path: "/networks/:net/updates",
    handle: ({ params, network }) => ok(network(params.net ?? "").updates),
  },
];
