/**
 * Fake eero node routes: `GET {net}/eeros` and `GET /eeros/:id`. See
 * docs/eero-api/endpoints.md (eeros).
 */

import { fail, ok, type Route } from "../server";

export const routes: Route[] = [
  {
    method: "GET",
    path: "/networks/:net/eeros",
    handle: ({ params, network }) => ok(network(params.net ?? "").eeros),
  },
  {
    method: "GET",
    path: "/eeros/:id",
    handle: ({ params, state }) => {
      for (const net of state.networks.values()) {
        const eero = net.eeros.find((e) => e.url === `/2.2/eeros/${params.id}`);
        if (eero) return ok(eero);
      }
      return fail(404, "error.eero.not.found");
    },
  },
];
