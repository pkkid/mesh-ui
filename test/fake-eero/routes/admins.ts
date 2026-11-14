/**
 * Fake admin reads: `GET {net}/members` answers `{members: [...]}` and
 * `GET {net}/invites` a bare array, or 403 on a network where the fake
 * account is an admin (Lake Cabin), as eero does. Shapes:
 * docs/eero-api/endpoints.md section 17.
 */

import { fail, ok, type Route } from "../server";

export const routes: Route[] = [
  {
    method: "GET",
    path: "/networks/:net/members",
    handle: ({ params, network }) => ok({ members: network(params.net ?? "").members }),
  },
  {
    method: "GET",
    path: "/networks/:net/invites",
    handle: ({ params, network }) => {
      const invites = network(params.net ?? "").invites;
      return invites ? ok(invites) : fail(403, "error.network.forbidden");
    },
  },
];
