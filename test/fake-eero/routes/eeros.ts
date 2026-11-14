/**
 * Fake eero node routes: `GET {net}/eeros`, `GET /eeros/:id`, its
 * `connections` (ports) and `firmware_update/history`. See
 * docs/eero-api/endpoints.md (eeros).
 */

import { fail, ok, type Route } from "../server";
import type { FakeNetwork, FakeState } from "../state";

/** The network that owns an eero id, or null. */
function owner(state: FakeState, id: string): FakeNetwork | null {
  for (const net of state.networks.values()) if (net.eeros.some((e) => e.url === `/2.2/eeros/${id}`)) return net;
  return null;
}

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
  {
    method: "GET",
    path: "/eeros/:id/connections",
    handle: ({ params, state }) => {
      const id = params.id ?? "";
      const net = owner(state, id);
      return net ? ok(net.connections[id] ?? { ports: { layout: "none", interfaces: [] } }) : fail(404, "error.eero.not.found");
    },
  },
  {
    method: "GET",
    path: "/eeros/:id/firmware_update/history",
    handle: ({ params, state, req }) => {
      const id = params.id ?? "";
      const net = owner(state, id);
      if (!net) return fail(404, "error.eero.not.found");
      // eero wraps the rows: `{data: [...], meta: {has_more}}`, newest first.
      const offset = Number(req.query.get("offset") ?? 0) || 0;
      const limit = Number(req.query.get("limit") ?? 20) || 20;
      const rows = net.firmwareHistory[id] ?? [];
      return ok({ data: rows.slice(offset, offset + limit), meta: { has_more: offset + limit < rows.length } });
    },
  },
];
