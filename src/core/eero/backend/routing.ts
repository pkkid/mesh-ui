/**
 * routing area of the eero backend: one `GET {net}/routing` (reservations,
 * forwards, IPv6 pinholes) plus the network's `dhcp` settings for the LAN
 * map. Pinned to /2.2/, as FF does. See docs/eero-api/endpoints.md (12).
 *
 * Writes (M5.5, endpoints.md section 12; request shapes from FF and LD):
 * - `POST {net}/reservations` JSON `{description, mac, ip}`, `PUT
 *   {net}/reservations/{id}` with the same full body, `DELETE
 *   {net}/reservations/{id}?delete_forwards=true|false`.
 * - `POST {net}/forwards` JSON `{ip, gateway_port, client_port, protocol,
 *   description, enabled}` (ports as strings, `"8000"` or `"8000-8010"`),
 *   `PUT` and `DELETE {net}/forwards/{id}`.
 * - `POST {net}/ipv6/pinholes` JSON `{device: <device url>, protocol, port}`;
 *   `DELETE` goes to the pinhole's own `url` from routing (no real pinhole
 *   has been captured, so its url form is unknown).
 *
 * A DELETE that eero refuses (404 or its own code) for a row the next fresh
 * read no longer lists succeeds: someone removed it first (the eero app).
 *
 * A PUT sends the whole row: missing fields are read from routing inside the
 * write. Every write then answers the row as the next `get` shows it, read
 * back from routing (eero's write answers are not captured).
 */

import { BackendError } from "../../errors";
import type * as M from "../../model";
import type { ForwardInput } from "../../backend";
import { mapRouting } from "../map/routing";
import type { RawRouting } from "../raw";
import { compactMac, idFromUrl, networkPath } from "../urls";
import type { EeroArea, EeroContext } from "./index";
import { fetchNetwork, networkLinks } from "./network";

/** The raw routing document, from `resources.routing` when eero sent one. */
export async function fetchRouting(ctx: EeroContext, net: M.Id, effect?: "write"): Promise<RawRouting | null> {
  const path = networkLinks(ctx).get(`net:${net}.routing`, networkPath(net, "routing"));
  return (await ctx.client.request<RawRouting | null>({ method: "GET", path, version: "2.2", ...(effect ? { effect, share: false } : {}) })) ?? null;
}

/** The ports eero takes: strings, a single port or `start-end`. */
const forwardBody = (f: ForwardInput) => ({
  ip: f.ip,
  gateway_port: f.externalPort,
  client_port: f.internalPort,
  protocol: f.protocol,
  description: f.description,
  enabled: f.enabled,
});

const missing = (what: string) => new BackendError("eero_error", `That ${what} is not on this network.`, { status: 404 });
const lost = (what: string) => new BackendError("eero_error", `eero did not return the ${what}.`);

/** eero answers a DELETE of a row it no longer has with an error (404 or its own code); the row being gone is what was asked. */
const refusedDelete = (err: unknown) => err instanceof BackendError && (err.code === "eero_error" || err.code === "bad_params");

export const routing: EeroArea<"routing"> = (ctx) => {
  const { client } = ctx;
  /** Routing rows as the model has them, read fresh inside a write (never a shared answer, no retry stall). The LAN map is not needed here. */
  const fresh = async (net: M.Id) => mapRouting(await fetchRouting(ctx, net, "write"), undefined);
  const row = (net: M.Id, kind: "reservations" | "forwards", id: M.Id) => networkPath(net, `${kind}/${encodeURIComponent(id)}`);

  return {
    async get(net) {
      const network = await fetchNetwork(ctx, net);
      if (network.connection?.mode === "bridged") return { reservations: [], forwards: [], pinholes: [], lan: null };
      return mapRouting(await fetchRouting(ctx, net), network.dhcp);
    },

    async addReservation(net, input) {
      await client.request({ method: "POST", path: networkPath(net, "reservations"), body: { description: input.description, mac: input.mac, ip: input.ip } });
      const made = (await fresh(net)).reservations.find((r) => compactMac(r.mac) === compactMac(input.mac));
      if (!made) throw lost("new reservation");
      return made;
    },

    async updateReservation(net, id, input) {
      const current = (await fresh(net)).reservations.find((r) => r.id === id);
      if (!current) throw missing("reservation");
      const body = { description: input.description ?? current.name, mac: current.mac, ip: input.ip ?? current.ip };
      await client.request({ method: "PUT", path: row(net, "reservations", id), body });
      return (await fresh(net)).reservations.find((r) => r.id === id) ?? { ...current, name: body.description, ip: body.ip };
    },

    async removeReservation(net, id, removeForwards) {
      await client.request({ method: "DELETE", path: row(net, "reservations", id), query: { delete_forwards: removeForwards ? "true" : "false" } }).catch(async (err) => {
        if (!refusedDelete(err) || (await fresh(net)).reservations.some((r) => r.id === id)) throw err;
      });
    },

    async addForward(net, input) {
      const before = new Set((await fresh(net)).forwards.map((f) => f.id));
      await client.request({ method: "POST", path: networkPath(net, "forwards"), body: forwardBody(input) });
      const after = (await fresh(net)).forwards;
      const made = after.find((f) => !before.has(f.id) && f.ip === input.ip && f.externalPort === input.externalPort) ?? after.find((f) => f.ip === input.ip && f.externalPort === input.externalPort);
      if (!made) throw lost("new port forward");
      return made;
    },

    async updateForward(net, id, input) {
      const current = (await fresh(net)).forwards.find((f) => f.id === id);
      if (!current) throw missing("port forward");
      const full: ForwardInput = {
        ip: input.ip ?? current.ip,
        externalPort: input.externalPort ?? current.externalPort,
        internalPort: input.internalPort ?? current.internalPort,
        protocol: input.protocol ?? current.protocol,
        description: input.description ?? current.name,
        enabled: input.enabled ?? current.enabled,
      };
      await client.request({ method: "PUT", path: row(net, "forwards", id), body: forwardBody(full) });
      return (await fresh(net)).forwards.find((f) => f.id === id) ?? { ...current, ...full, name: full.description };
    },

    async removeForward(net, id) {
      await client.request({ method: "DELETE", path: row(net, "forwards", id) }).catch(async (err) => {
        if (!refusedDelete(err) || (await fresh(net)).forwards.some((f) => f.id === id)) throw err;
      });
    },

    async addPinhole(net, input) {
      const before = new Set((await fresh(net)).pinholes.map((p) => p.id));
      const device = networkPath(net, `devices/${encodeURIComponent(input.deviceId)}`);
      await client.request({ method: "POST", path: networkPath(net, "ipv6/pinholes"), body: { device, protocol: input.protocol, port: input.port } });
      const made = (await fresh(net)).pinholes.find((p) => !before.has(p.id) && p.port === input.port);
      if (!made) throw lost("new IPv6 rule");
      return made;
    },

    async removePinhole(net, id) {
      // The pinhole's own link, as routing lists it; the documented path when it has none.
      const raw = await fetchRouting(ctx, net, "write");
      const url = (raw?.pinholes?.data ?? []).map((p) => p?.url).find((u): u is string => typeof u === "string" && idFromUrl(u) === id);
      await client.request({ method: "DELETE", path: url ?? networkPath(net, `ipv6/pinholes/${encodeURIComponent(id)}`) }).catch(async (err) => {
        if (!refusedDelete(err) || (await fresh(net)).pinholes.some((p) => p.id === id)) throw err;
      });
    },
  };
};
