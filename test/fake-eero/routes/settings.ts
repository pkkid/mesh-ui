/**
 * Fake settings reads: `GET {net}/fast_transition`, `GET {net}/power_saving/schedules`,
 * `GET {net}/thread` (secrets included, as eero sends them; 404 on a network
 * without Thread) and `GET {net}/ac_compat`. Everything else, integrations
 * included, is on the network object. `GET {net}/power_saving` and
 * `GET {net}/proxied_nodes` answer 404, as on a real network.
 * Shapes: docs/eero-api/endpoints.md section 17.
 *
 * `PUT {net}/settings` (M5.2) takes the JSON keys of docs/eero-api/endpoints.md
 * section 4 and changes the network object in place, so the next `GET {net}`
 * shows them: `dns` (+ `ipv6.name_servers`), `dhcp`, `ipv6_upstream`, `lease`,
 * `pppoe`, `vlan` (string, "" for off), `connection`, `nat_port_randomization`,
 * `upnp`, `sqm`. A bad value answers 400 and changes nothing. A form `name`
 * (the Wi-Fi rename) goes to the route in ./wifi.ts, which owns it. The fake
 * keeps the PPPoE user name only; the password is in `fake.writes`.
 */

import { fail, FakeAnswer, ok, type Route, type RouteContext } from "../server";
import type { FakeNetwork } from "../state";
import { routes as wifiRoutes } from "./wifi";

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const isIp = (v: unknown): v is string => typeof v === "string" && (IPV4.test(v) || (v.includes(":") && /^[0-9a-fA-F:.]+$/.test(v)));
const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const bad = (error: string): never => {
  throw new FakeAnswer(fail(400, error));
};

const SETTINGS_KEYS = new Set(["dns", "ipv6", "dhcp", "ipv6_upstream", "lease", "pppoe", "vlan", "connection", "nat_port_randomization", "upnp", "sqm"]);

/** Applies one JSON settings write to a copy of the network, then swaps it in, so a 400 changes nothing. */
function applySettings(net: FakeNetwork, body: Record<string, unknown>): Record<string, unknown> {
  const keys = Object.keys(body);
  if (keys.length === 0 || keys.some((k) => !SETTINGS_KEYS.has(k))) bad("error.settings.invalid");
  const n = structuredClone(net.network);
  const routed = n.connection?.mode === "nat" || n.connection?.mode === undefined;

  if ("dns" in body) {
    const dns = obj(body.dns) ?? bad("error.dns.invalid");
    if (dns.mode !== "automatic" && dns.mode !== "custom") bad("error.dns.mode.invalid");
    const ips = obj(dns.custom)?.ips ?? [];
    if (!Array.isArray(ips) || ips.length > 4 || !ips.every(isIp)) bad("error.dns.custom.invalid");
    if (dns.mode === "custom" && (ips as string[]).length === 0) bad("error.dns.custom.required");
    if (dns.caching !== undefined && !isBool(dns.caching)) bad("error.dns.caching.invalid");
    n.dns = { ...n.dns, mode: dns.mode as string, custom: { ips: ips as string[] }, ...(isBool(dns.caching) ? { caching: dns.caching } : {}) };
  }
  if ("ipv6" in body) {
    const ns = obj(obj(body.ipv6)?.name_servers) ?? bad("error.ipv6.invalid");
    const custom = ns.custom ?? [];
    if ((ns.mode !== "automatic" && ns.mode !== "custom") || !Array.isArray(custom) || !custom.every(isIp)) bad("error.ipv6.name_servers.invalid");
    n.ipv6 = { name_servers: { mode: ns.mode as string, custom: custom as string[] } };
  }
  if ("dhcp" in body) {
    if (!routed) bad("error.network.bridged");
    const dhcp = obj(body.dhcp) ?? bad("error.dhcp.invalid");
    if (dhcp.mode === "automatic") n.dhcp = { mode: "automatic" };
    else if (dhcp.mode === "custom") {
      const c = obj(dhcp.custom) ?? bad("error.dhcp.custom.required");
      const fields = ["subnet_ip", "subnet_mask", "start_ip", "end_ip"] as const;
      if (!fields.every((f) => typeof c[f] === "string" && IPV4.test(c[f] as string))) bad("error.dhcp.custom.invalid");
      n.dhcp = { mode: "custom", custom: { subnet_ip: c.subnet_ip as string, subnet_mask: c.subnet_mask as string, start_ip: c.start_ip as string, end_ip: c.end_ip as string } };
    } else bad("error.dhcp.mode.invalid");
  }
  if ("ipv6_upstream" in body) {
    if (!isBool(body.ipv6_upstream)) bad("error.ipv6_upstream.invalid");
    n.ipv6_upstream = body.ipv6_upstream as boolean;
  }
  if ("lease" in body) {
    const lease = obj(body.lease) ?? bad("error.lease.invalid");
    if (lease.mode === "static") {
      const st = obj(lease.static) ?? bad("error.lease.static.required");
      if (![st.ip, st.mask, st.router].every((v) => typeof v === "string" && IPV4.test(v))) bad("error.lease.static.invalid");
      n.lease = { ...n.lease, mode: "static", static: { ip: st.ip, mask: st.mask, router: st.router } };
      n.wan_type = "Static";
    } else if (lease.mode === "dhcp") {
      n.lease = { ...n.lease, mode: "dhcp", static: null };
      n.wan_type = "DHCP";
    } else bad("error.lease.mode.invalid");
  }
  if ("pppoe" in body) {
    const pppoe = obj(body.pppoe) ?? bad("error.pppoe.invalid");
    if (!isBool(pppoe.enabled)) bad("error.pppoe.invalid");
    if (pppoe.enabled) {
      const cred = obj(pppoe.credentials) ?? bad("error.pppoe.credentials.required");
      if (typeof cred.username !== "string" || cred.username === "" || typeof cred.password !== "string" || cred.password === "") bad("error.pppoe.credentials.invalid");
      n.pppoe_enabled = true;
      n.pppoe_username = cred.username as string;
      n.wan_type = "PPPoE";
    } else {
      n.pppoe_enabled = false;
      n.pppoe_username = null;
    }
  }
  if ("vlan" in body) {
    const v = body.vlan;
    if (v === "" || v === null) n.vlan = null;
    else if (typeof v === "string" && /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 4094) n.vlan = Number(v);
    else bad("error.vlan.invalid");
  }
  if ("connection" in body) {
    const mode = obj(body.connection)?.mode;
    if (mode !== "nat" && mode !== "bridged" && mode !== "ipPassthrough") bad("error.connection.mode.invalid");
    n.connection = { mode: mode as string };
  }
  for (const key of ["nat_port_randomization", "upnp", "sqm"] as const) {
    if (!(key in body)) continue;
    if (!isBool(body[key])) bad(`error.${key}.invalid`);
    if (key !== "sqm" && !routed) bad("error.network.bridged");
    n[key] = body[key] as boolean;
  }
  net.network = n;
  return body;
}

const renameRoute = wifiRoutes.find((r) => r.method === "PUT" && r.path === "/networks/:net/settings");

export const routes: Route[] = [
  {
    method: "PUT",
    path: "/networks/:net/settings",
    handle: (ctx: RouteContext) => {
      const { req, params, network } = ctx;
      if ("name" in req.body) {
        if (!renameRoute) return fail(404, "error.not.found");
        return renameRoute.handle(ctx);
      }
      if (req.encoding !== "json") return fail(400, "error.settings.encoding");
      // The PPPoE password is write-only, as in eero: the answer never echoes it.
      const applied = applySettings(network(params.net ?? ""), req.body);
      const { pppoe: _p, ...rest } = applied;
      return ok(rest);
    },
  },
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
