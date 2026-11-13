/**
 * Fake profile routes: `GET {net}/profiles`, `GET {profile}` and
 * `GET {profile}/schedules`. See docs/eero-api/endpoints.md (profiles).
 */

import { fail, ok, type Route, type RouteContext } from "../server";

const find = ({ params, network }: RouteContext) => {
  const net = network(params.net ?? "");
  return net.profiles.find((p) => p.url === `${net.network.url}/profiles/${params.id}`) ?? null;
};

export const routes: Route[] = [
  {
    method: "GET",
    path: "/networks/:net/profiles",
    handle: ({ params, network }) => ok(network(params.net ?? "").profiles),
  },
  {
    method: "GET",
    path: "/networks/:net/profiles/:id",
    handle: (ctx) => {
      const p = find(ctx);
      return p ? ok(p) : fail(404, "error.profile.not.found");
    },
  },
  {
    method: "GET",
    path: "/networks/:net/profiles/:id/schedules",
    handle: (ctx) => {
      const p = find(ctx);
      return p ? ok(p.schedule ?? []) : fail(404, "error.profile.not.found");
    },
  },
];
