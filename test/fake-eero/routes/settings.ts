/**
 * Fake settings reads: `GET {net}/fast_transition`, `GET {net}/power_saving/schedules`,
 * `GET {net}/thread` (secrets included, as eero sends them; 404 on a network
 * without Thread) and `GET {net}/ac_compat`. Everything else, integrations
 * included, is on the network object. `GET {net}/power_saving` and
 * `GET {net}/proxied_nodes` answer 404, as on a real network.
 * Shapes: docs/eero-api/endpoints.md section 17.
 */

import { fail, ok, type Route } from "../server";

export const routes: Route[] = [
  {
    method: "GET",
    path: "/networks/:net/fast_transition",
    handle: ({ params, network }) => ok(network(params.net ?? "").fastTransition),
  },
  {
    method: "GET",
    path: "/networks/:net/power_saving/schedules",
    handle: ({ params, network }) => ok({ schedules: network(params.net ?? "").powerSavingSchedules }),
  },
  {
    method: "GET",
    path: "/networks/:net/power_saving",
    handle: () => fail(404, "error.not_found"),
  },
  {
    method: "GET",
    path: "/networks/:net/thread",
    handle: ({ params, network }) => {
      const thread = network(params.net ?? "").thread;
      return thread ? ok(thread) : fail(404, "error.thread.not_found");
    },
  },
  {
    method: "GET",
    path: "/networks/:net/ac_compat",
    handle: ({ params, network }) => ok(network(params.net ?? "").acCompat),
  },
  {
    method: "GET",
    path: "/networks/:net/proxied_nodes",
    handle: () => fail(404, "error.not_found"),
  },
];
