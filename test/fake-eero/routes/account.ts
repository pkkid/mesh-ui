/**
 * Fake account route: `GET /2.2/account` answers the seeded account
 * (state.account), with its network list. See docs/eero-api/endpoints.md.
 */

import { ok, type Route } from "../server";

export const routes: Route[] = [
  {
    method: "GET",
    path: "/account",
    handle: ({ state }) => ok(state.account),
  },
];
