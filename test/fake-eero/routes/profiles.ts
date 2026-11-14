/**
 * Fake profile routes: `GET {net}/profiles` and `GET {profile}`. Like the
 * real API, `GET {profile}/schedules` is a 404 (docs/eero-api/endpoints.md
 * section 17); schedules live on the profile's own `schedule[]`.
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
    handle: () => fail(404, "error.not.found"),
  },
];
