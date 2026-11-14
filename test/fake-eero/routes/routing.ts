/**
 * Fake routing routes: `GET {net}/routing`, the one call for reservations,
 * forwards and IPv6 pinholes, and their writes (M5.5). See
 * docs/eero-api/endpoints.md (10, 12).
 *
 * Writes keep state in the network's `routing` document, as the next GET
 * shows it, and land in `fake.writes`:
 * - `POST {net}/reservations` JSON `{description, mac, ip}`; `PUT` and
 *   `DELETE {net}/reservations/{id}` (`?delete_forwards=true` also removes
 *   that address's forwards; a PUT that moves the address moves them too).
 *   A bad or outside address is `error.reservation.ip.invalid`, a taken one
 *   `error.assignment.ip.unavailable`, as eero answers.
 * - `POST {net}/forwards` JSON `{ip, gateway_port, client_port, protocol,
 *   description, enabled}`; `PUT` and `DELETE {net}/forwards/{id}`. A forward
 *   needs a reserved address (400 otherwise). Ports are kept as strings, as
 *   `{net}/routing` sends them.
 * - `POST {net}/ipv6/pinholes` JSON `{device: <device url>, protocol, port}`;
 *   `DELETE` on the pinhole's url (`{net}/ipv6/pinholes/{id}`, or the seeded
 *   `{net}/pinholes/{id}`).
 * The 400 codes for forwards and pinholes are this fake's own: eero's are
 * not captured.
 */

import type { RawForward, RawPinhole, RawReservation } from "../../../src/core/eero/raw";
import { fail, ok, type Route, type RouteContext } from "../server";
import type { FakeNetwork } from "../state";

const toInt = (ip: unknown): number | null => {
  if (typeof ip !== "string") return null;
  const p = ip.split(".").map(Number);
  return p.length === 4 && p.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? p.reduce((a, n) => a * 256 + n, 0) : null;
};

/** The LAN the network uses: its custom DHCP subnet, or eero's automatic 192.168.4.0/22. */
function inLan(net: FakeNetwork, ip: unknown): boolean {
  const n = toInt(ip);
  const custom = net.network.dhcp?.mode === "custom" ? net.network.dhcp.custom : undefined;
  const base = toInt(custom?.subnet_ip ?? "192.168.4.0");
  const mask = toInt(custom?.subnet_mask ?? "255.255.252.0");
  if (n === null || base === null || mask === null) return false;
  return (n & mask) >>> 0 === (base & mask) >>> 0;
}

const MAC = /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/i;
const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const urlOf = (ctx: RouteContext, kind: string) => `${ctx.network(ctx.params.net ?? "").network.url}/${kind}/${ctx.params.id}`;

const reservations = (net: FakeNetwork): RawReservation[] => {
  net.routing.reservations ??= { url: `${net.network.url}/reservations`, data: [] };
  net.routing.reservations.data ??= [];
  return net.routing.reservations.data;
};
const forwards = (net: FakeNetwork): RawForward[] => {
  net.routing.forwards ??= { url: `${net.network.url}/forwards`, data: [] };
  net.routing.forwards.data ??= [];
  return net.routing.forwards.data;
};
const pinholes = (net: FakeNetwork): RawPinhole[] => {
  net.routing.pinholes ??= { url: `${net.network.url}/pinholes`, data: [] };
  net.routing.pinholes.data ??= [];
  return net.routing.pinholes.data;
};

/** Checks an address for a reservation; `self` is the row being edited. */
function badAddress(net: FakeNetwork, ip: unknown, self: RawReservation | null) {
  if (!inLan(net, ip)) return fail(400, "error.reservation.ip.invalid");
  if (reservations(net).some((r) => r !== self && r.ip === ip)) return fail(400, "error.assignment.ip.unavailable");
  return null;
}

/** A forward's fields from a body, ports as strings; null when one is missing or odd. */
function forwardFields(body: Record<string, unknown>): Omit<RawForward, "url"> | null {
  const gateway = str(body.gateway_port);
  const protocol = str(body.protocol);
  if (!/^\d{1,5}(-\d{1,5})?$/.test(gateway) || !["tcp", "udp", "both"].includes(protocol)) return null;
  const client = str(body.client_port) || gateway;
  if (!/^\d{1,5}(-\d{1,5})?$/.test(client)) return null;
  return { ip: str(body.ip), gateway_port: gateway, client_port: client, protocol, description: str(body.description), enabled: body.enabled !== false };
}

const pinholeDelete = (kind: string): Route => ({
  method: "DELETE",
  path: `/networks/:net/${kind}/:id`,
  handle: (ctx) => {
    const net = ctx.network(ctx.params.net ?? "");
    const url = urlOf(ctx, kind);
    const list = pinholes(net);
    if (!list.some((p) => p.url === url)) return fail(404, "error.pinhole.not.found");
    net.routing.pinholes = { ...net.routing.pinholes, data: list.filter((p) => p.url !== url) };
    return ok(null);
  },
});

export const routes: Route[] = [
  {
    method: "GET",
    path: "/networks/:net/routing",
    handle: ({ params, network }) => ok(network(params.net ?? "").routing),
  },

  // Reservations
  {
    method: "POST",
    path: "/networks/:net/reservations",
    handle: ({ req, params, network, state }) => {
      const net = network(params.net ?? "");
      const { description, mac, ip } = req.body;
      if (typeof mac !== "string" || !MAC.test(mac)) return fail(400, "error.reservation.mac.invalid");
      const bad = badAddress(net, ip, null);
      if (bad) return bad;
      if (reservations(net).some((r) => r.mac?.toLowerCase() === mac.toLowerCase())) return fail(400, "error.reservation.mac.exists");
      const row: RawReservation = { url: `${net.network.url}/reservations/${state.nextId()}`, description: str(description), mac, ip: ip as string, public_static_ip: null };
      reservations(net).push(row);
      return ok(row);
    },
  },
  {
    method: "PUT",
    path: "/networks/:net/reservations/:id",
    handle: (ctx) => {
      const net = ctx.network(ctx.params.net ?? "");
      const r = reservations(net).find((x) => x.url === urlOf(ctx, "reservations"));
      if (!r) return fail(404, "error.reservation.not.found");
      const { description, ip } = ctx.req.body;
      if (ip !== undefined && ip !== r.ip) {
        const bad = badAddress(net, ip, r);
        if (bad) return bad;
        // Forwards follow their reservation's address.
        for (const f of forwards(net)) if (f.ip === r.ip) f.ip = ip as string;
        r.ip = ip as string;
      }
      if (description !== undefined) r.description = str(description);
      return ok(r);
    },
  },
  {
    method: "DELETE",
    path: "/networks/:net/reservations/:id",
    handle: (ctx) => {
      const net = ctx.network(ctx.params.net ?? "");
      const url = urlOf(ctx, "reservations");
      const r = reservations(net).find((x) => x.url === url);
      if (!r) return fail(404, "error.reservation.not.found");
      net.routing.reservations = { ...net.routing.reservations, data: reservations(net).filter((x) => x !== r) };
      if (ctx.req.query.get("delete_forwards") === "true") net.routing.forwards = { ...net.routing.forwards, data: forwards(net).filter((f) => f.ip !== r.ip) };
      return ok(null);
    },
  },

  // Port forwards
  {
    method: "POST",
    path: "/networks/:net/forwards",
    handle: ({ req, params, network, state }) => {
      const net = network(params.net ?? "");
      const fields = forwardFields(req.body);
      if (!fields) return fail(400, "error.forward.invalid");
      const r = reservations(net).find((x) => x.ip === fields.ip);
      if (!r) return fail(400, "error.forward.reservation.required");
      const row: RawForward = { url: `${net.network.url}/forwards/${state.nextId()}`, ...fields, ...(r.url ? { reservation: r.url } : {}) };
      forwards(net).push(row);
      return ok(row);
    },
  },
  {
    method: "PUT",
    path: "/networks/:net/forwards/:id",
    handle: (ctx) => {
      const net = ctx.network(ctx.params.net ?? "");
      const f = forwards(net).find((x) => x.url === urlOf(ctx, "forwards"));
      if (!f) return fail(404, "error.forward.not.found");
      const fields = forwardFields({ ...f, ...ctx.req.body });
      if (!fields) return fail(400, "error.forward.invalid");
      const r = reservations(net).find((x) => x.ip === fields.ip);
      if (!r) return fail(400, "error.forward.reservation.required");
      Object.assign(f, fields, r.url ? { reservation: r.url } : {});
      return ok(f);
    },
  },
  {
    method: "DELETE",
    path: "/networks/:net/forwards/:id",
    handle: (ctx) => {
      const net = ctx.network(ctx.params.net ?? "");
      const url = urlOf(ctx, "forwards");
      if (!forwards(net).some((f) => f.url === url)) return fail(404, "error.forward.not.found");
      net.routing.forwards = { ...net.routing.forwards, data: forwards(net).filter((f) => f.url !== url) };
      return ok(null);
    },
  },

  // IPv6 pinholes
  {
    method: "POST",
    path: "/networks/:net/ipv6/pinholes",
    handle: ({ req, params, network, state }) => {
      const net = network(params.net ?? "");
      const { device, protocol, port } = req.body;
      const d = net.devices.find((x) => x.url === device);
      if (!d) return fail(400, "error.device.not.found");
      if (!/^\d{1,5}(-\d{1,5})?$/.test(str(port)) || !["tcp", "udp", "both"].includes(str(protocol))) return fail(400, "error.pinhole.invalid");
      const v6 = (d.ipv6_addresses ?? []).map((a) => (typeof a === "string" ? a : a?.address)).find((a) => typeof a === "string" && !a.toLowerCase().startsWith("fe80"));
      const row: RawPinhole = { url: `${net.network.url}/ipv6/pinholes/${state.nextId()}`, device: { url: d.url, mac: d.mac }, ip: v6 ?? undefined, protocol: str(protocol), port: str(port) };
      pinholes(net).push(row);
      return ok(row);
    },
  },
  pinholeDelete("ipv6/pinholes"),
  pinholeDelete("pinholes"),
];
