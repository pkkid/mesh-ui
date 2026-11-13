/**
 * routing area of the eero backend: one `GET {net}/routing` (reservations,
 * forwards, IPv6 pinholes) plus the network's `dhcp` settings for the LAN
 * map. Pinned to /2.2/, as FF does. See docs/eero-api/endpoints.md (12).
 */

import type * as M from "../../model";
import { mapRouting } from "../map/routing";
import type { RawRouting } from "../raw";
import { networkPath } from "../urls";
import type { EeroArea, EeroContext } from "./index";
import { fetchNetwork, networkLinks } from "./network";

/** The raw routing document, from `resources.routing` when eero sent one. */
export async function fetchRouting(ctx: EeroContext, net: M.Id): Promise<RawRouting | null> {
  const path = networkLinks(ctx).get(`net:${net}.routing`, networkPath(net, "routing"));
  return (await ctx.client.request<RawRouting | null>({ method: "GET", path, version: "2.2" })) ?? null;
}

export const routing: EeroArea<"routing"> = (ctx) => ({
  async get(net) {
    const network = await fetchNetwork(ctx, net);
    if (network.connection?.mode === "bridged") return { reservations: [], forwards: [], pinholes: [], lan: null };
    return mapRouting(await fetchRouting(ctx, net), network.dhcp);
  },
});
