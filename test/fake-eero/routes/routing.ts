/**
 * Fake routing route: `GET {net}/routing`, the one call for reservations,
 * forwards and IPv6 pinholes. Answers the network's `routing` state as is.
 * See docs/eero-api/endpoints.md (10, 12).
 */

import { ok, type Route } from "../server";

export const routes: Route[] = [
  {
    method: "GET",
    path: "/networks/:net/routing",
    handle: ({ params, network }) => ok(network(params.net ?? "").routing),
  },
];
