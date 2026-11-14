/**
 * Fake integrations writes (M5.4), changing the network object in place so
 * the next `GET {net}` shows them. Requests as in docs/eero-api/endpoints.md
 * and src/core/eero/backend/integrations.ts:
 *
 * - `PUT {net}/proxied_nodes` JSON `{enabled}`: eero Built-in. 404 when the
 *   network has no `proxied_nodes`, 400 in bridge mode.
 * - `PUT {net}/settings` JSON `{ffs}`: Frustration-Free Setup. A body without
 *   `ffs` is passed on to the next route with this path (the Wi-Fi rename
 *   and other settings writes share it).
 * - `POST /2.3/networks/{id}/shh/start_zigbee_discovery`: 2.3 only; 404
 *   without a `smart_home_hub` or `zigbee` capability. Counts the starts in
 *   `zigbeeDiscoveries` on the network object (fake only).
 * - `POST /2.2/amazon/networks/{id}/account_unlink`: clears
 *   `amazon_account_linked`; 400 when nothing is linked.
 */

import * as areas from "./index";
import { fail, ok, type Route, type RouteContext } from "../server";

const SETTINGS = "/networks/:net/settings";

/** The next registered `PUT {net}/settings` route after this file's, for bodies that are not ours. */
function passOn(ctx: RouteContext) {
  const all = Object.values(areas as Record<string, Route[]>).flat();
  const next = all.slice(all.indexOf(ffsRoute) + 1).find((r) => r.method === "PUT" && r.path === SETTINGS);
  return next ? next.handle(ctx) : fail(404, "error.not.found");
}

const ffsRoute: Route = {
  method: "PUT",
  path: SETTINGS,
  handle: (ctx) => {
    if (!("ffs" in ctx.req.body)) return passOn(ctx);
    const net = ctx.network(ctx.params.net ?? "").network;
    const ffs = ctx.req.body.ffs;
    if (typeof ffs !== "boolean") return fail(400, "error.network.ffs.invalid");
    if (typeof net.ffs !== "boolean") return fail(404, "error.not.found");
    net.ffs = ffs;
    return ok({ ffs });
  },
};

export const routes: Route[] = [
  ffsRoute,
  {
    method: "PUT",
    path: "/networks/:net/proxied_nodes",
    handle: ({ req, params, network }) => {
      const net = network(params.net ?? "").network;
      const nodes = net.proxied_nodes;
      if (!nodes) return fail(404, "error.not.found");
      if (net.connection?.mode === "bridged") return fail(400, "error.proxied_nodes.bridge_mode");
      if (typeof req.body.enabled !== "boolean") return fail(400, "error.proxied_nodes.invalid");
      nodes.enabled = req.body.enabled;
      return ok({ enabled: nodes.enabled });
    },
  },
  {
    method: "POST",
    path: "/networks/:net/shh/start_zigbee_discovery",
    versions: ["2.3"],
    handle: ({ params, network }) => {
      const net = network(params.net ?? "").network as { capabilities?: Record<string, { capable?: boolean }>; zigbeeDiscoveries?: number };
      const caps = net.capabilities ?? {};
      if (caps.smart_home_hub?.capable !== true && caps.zigbee?.capable !== true) return fail(404, "error.not.found");
      net.zigbeeDiscoveries = (net.zigbeeDiscoveries ?? 0) + 1;
      return ok(null);
    },
  },
  {
    method: "POST",
    path: "/amazon/networks/:net/account_unlink",
    versions: ["2.2"],
    handle: ({ params, network }) => {
      const net = network(params.net ?? "").network;
      if (net.amazon_account_linked !== true) return fail(400, "error.amazon.not_linked");
      net.amazon_account_linked = false;
      return ok(null);
    },
  },
];
