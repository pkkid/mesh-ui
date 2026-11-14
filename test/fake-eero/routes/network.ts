/**
 * Fake network routes: the account (with its network refs), the `/networks`
 * fallback list, one network with its embedded eeros, speed test history,
 * starting a speed test (`POST {net}/speedtest`, 202; like eero, the result
 * lands about a minute later), permissions and restart (`POST {net}/reboot`,
 * empty JSON). See docs/eero-api/endpoints.md.
 *
 * `GET /account`, which network.list also reads, lives in ./account.ts.
 */

import { ok, type Route } from "../server";
import type { FakeNetwork } from "../state";

/**
 * `lease` as eero sends it on a DHCP WAN: the address, mask and router, and
 * no lease or renew time (real capture, 2026-11-13). A seeded `lease` wins.
 */
function leaseOf(net: FakeNetwork) {
  const raw = net.network as FakeNetwork["network"] & { lease?: unknown };
  if (raw.lease !== undefined) return raw.lease;
  if (String(raw.wan_type ?? "").toLowerCase() !== "dhcp") return undefined;
  return {
    mode: "dhcp",
    dhcp: { ip: raw.wan_ip, mask: "255.255.255.0", router: raw.gateway_ip },
    static: null,
  };
}

const time = (v: string | null): number | null => {
  if (!v) return null;
  const ms = Date.parse(v.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isFinite(ms) ? ms : null;
};

/** How long after `POST {net}/speedtest` its result shows (eero: about a minute). */
export const FAKE_SPEEDTEST_MS = 60_000;

/** Speed tests that have finished by `now`; a started one is dated when its result lands. */
const landed = (net: FakeNetwork, now: number) =>
  net.speedtests.filter((t) => {
    const at = time(t.date ?? null);
    return at !== null && at <= now;
  });

/** `speed` follows the newest finished test once one is newer than the seeded value. */
function speedOf(net: FakeNetwork, now: number) {
  const seeded = net.network.speed as { date?: string } | undefined;
  const newest = landed(net, now).reduce<(typeof net.speedtests)[number] | null>((a, t) => ((time(t.date ?? null) ?? 0) > (time(a?.date ?? null) ?? 0) ? t : a), null);
  if (!newest || (time(newest.date ?? null) ?? 0) <= (time(seeded?.date ?? null) ?? 0)) return seeded;
  return { status: "success", date: newest.date, down: { value: newest.down_mbps, units: "Mbps" }, up: { value: newest.up_mbps, units: "Mbps" } };
}

const networkBody = (net: FakeNetwork, now: number) => ({
  ...net.network,
  speed: speedOf(net, now),
  lease: leaseOf(net),
  eeros: { count: net.eeros.length, data: net.eeros },
});

export const routes: Route[] = [
  {
    method: "GET",
    path: "/networks",
    handle: ({ state }) => ok([...state.networks.values()].map((n) => ({ url: n.network.url, name: n.network.name, created: n.network.created }))),
  },
  { method: "GET", path: "/networks/:net", handle: ({ params, network, state }) => ok(networkBody(network(params.net ?? ""), state.now())) },
  {
    method: "GET",
    path: "/networks/:net/speedtest",
    handle: ({ req, params, network, state }) => {
      const net = network(params.net ?? "");
      const start = time(req.query.get("startTime"));
      const end = time(req.query.get("endTime"));
      const limit = Number(req.query.get("limit") ?? "");
      const rows = landed(net, state.now()).filter((t) => {
        const at = time(t.date ?? null);
        return at !== null && (start === null || at >= start) && (end === null || at <= end);
      });
      return ok(Number.isInteger(limit) && limit > 0 ? rows.slice(0, limit) : rows);
    },
  },
  {
    method: "POST",
    path: "/networks/:net/speedtest",
    handle: ({ params, network, state }) => {
      const net = network(params.net ?? "");
      // Near the last result, newest first; hidden from reads until it lands.
      const last = net.speedtests[0];
      const at = new Date(state.now() + FAKE_SPEEDTEST_MS).toISOString();
      const r = (n: number) => Math.round(n * 10) / 10;
      net.speedtests.unshift({ date: at, down_mbps: r((last?.down_mbps ?? 500) - 3.1), up_mbps: r((last?.up_mbps ?? 50) + 0.6) });
      return ok(null, 202);
    },
  },
  { method: "GET", path: "/networks/:net/permissions", handle: ({ params, network }) => ok(network(params.net ?? "").permissions) },
  {
    method: "POST",
    path: "/networks/:net/reboot",
    handle: ({ params, network, state }) => {
      const net = network(params.net ?? "");
      const at = new Date(state.now()).toISOString();
      for (const e of net.eeros) if (e.status !== "red") e.last_reboot = at;
      return ok(null);
    },
  },
];
