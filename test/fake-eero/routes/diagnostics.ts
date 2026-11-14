/**
 * Fake diagnostics reads: `GET {net}/diagnostics` (only `status` until a run,
 * as on a real network) and `GET {net}/support` in its `/2.2/` shape.
 * Shapes: docs/eero-api/endpoints.md sections 10 and 17.
 */

import { ok, type Route } from "../server";

export const routes: Route[] = [
  {
    method: "GET",
    path: "/networks/:net/diagnostics",
    handle: ({ params, network }) => ok(network(params.net ?? "").diagnostics),
  },
  {
    method: "GET",
    path: "/networks/:net/support",
    // 2.3 answers a `contacts` list instead; the client pins this read to 2.2.
    versions: ["2.2"],
    handle: ({ params, network }) => ok(network(params.net ?? "").support),
  },
];
