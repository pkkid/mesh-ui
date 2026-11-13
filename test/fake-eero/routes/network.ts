/**
 * Fake network routes: the account (with its network refs), the `/networks`
 * fallback list, one network with its embedded eeros, speed test history and
 * permissions. See docs/eero-api/endpoints.md.
 *
 * `GET /account`, which network.list also reads, lives in ./account.ts.
 */

import { ok, type Route } from "../server";
import type { FakeNetwork } from "../state";

const networkBody = (net: FakeNetwork) => ({ ...net.network, eeros: { count: net.eeros.length, data: net.eeros } });

const time = (v: string | null): number | null => {
  if (!v) return null;
  const ms = Date.parse(v.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isFinite(ms) ? ms : null;
};

export const routes: Route[] = [
  {
    method: "GET",
    path: "/networks",
    handle: ({ state }) => ok([...state.networks.values()].map((n) => ({ url: n.network.url, name: n.network.name, created: n.network.created }))),
  },
  { method: "GET", path: "/networks/:net", handle: ({ params, network }) => ok(networkBody(network(params.net ?? ""))) },
  {
    method: "GET",
    path: "/networks/:net/speedtest",
    handle: ({ req, params, network }) => {
      const net = network(params.net ?? "");
      const start = time(req.query.get("startTime"));
      const end = time(req.query.get("endTime"));
      const limit = Number(req.query.get("limit") ?? "");
      const rows = net.speedtests.filter((t) => {
        const at = time(t.date ?? null);
        return at !== null && (start === null || at >= start) && (end === null || at <= end);
      });
      return ok(Number.isInteger(limit) && limit > 0 ? rows.slice(0, limit) : rows);
    },
  },
  { method: "GET", path: "/networks/:net/permissions", handle: ({ params, network }) => ok(network(params.net ?? "").permissions) },
];
