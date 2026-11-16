/**
 * Fake network routes: the account (with its network refs), the `/networks`
 * fallback list, one network with its embedded eeros, speed test history,
 * starting a speed test (`POST {net}/speedtest`, 202; like eero, the result
 * lands about a minute later), permissions and restart (`POST {net}/reboot`,
 * empty JSON), delete (`DELETE {net}`, owner only, M5.3) and the network
 * nickname (`PUT {net}/label?labelType=specialMarket`, form `label`, M6.9;
 * written to `nickname_label` on the network and its account ref, an empty
 * label clears it, over 32 characters is a 400). See
 * docs/eero-api/endpoints.md.
 *
 * `GET /account`, which network.list also reads, lives in ./account.ts.
 */

import { fail, ok, type Route } from "../server";
import { isOwnerRole, type FakeNetwork } from "../state";

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

/** The most tests one `GET {net}/speedtest` returns, whatever `limit` asks (eero caps at 100). */
export const FAKE_SPEEDTEST_PAGE = 100;

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
      return ok(rows.slice(0, Number.isInteger(limit) && limit > 0 ? Math.min(limit, FAKE_SPEEDTEST_PAGE) : FAKE_SPEEDTEST_PAGE));
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
  {
    // M5.3: deleting a network drops it from the account and the list. Owner only, as eero.
    method: "DELETE",
    path: "/networks/:net",
    handle: ({ params, network, state }) => {
      const net = network(params.net ?? "");
      if (!isOwnerRole(net.permissions.role)) return fail(403, "error.network.forbidden");
      state.networks.delete(net.id);
      const refs = state.account.networks;
      if (refs && Array.isArray(refs.data)) {
        refs.data = refs.data.filter((r) => r.url !== net.network.url);
        refs.count = refs.data.length;
      }
      return ok(null);
    },
  },
  {
    method: "PUT",
    path: "/networks/:net/label",
    handle: ({ req, params, network, state }) => {
      const net = network(params.net ?? "");
      if (req.query.get("labelType") !== "specialMarket") return fail(400, "error.label.type");
      if (req.encoding !== "form" || typeof req.body.label !== "string") return fail(400, "error.form.errors");
      const label = req.body.label.trim();
      if (label.length > 32) return fail(400, "error.form.errors");
      const value = label === "" ? null : label;
      net.network.nickname_label = value;
      const refs = state.account.networks;
      if (refs && Array.isArray(refs.data)) for (const r of refs.data) if (r.url === net.network.url) r.nickname_label = value;
      return ok(null);
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
