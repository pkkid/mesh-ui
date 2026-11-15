/**
 * Fake integrations writes (M5.4), changing the network object in place so
 * the next `GET {net}` shows them. Requests as in docs/eero-api/endpoints.md
 * and src/core/eero/backend/integrations.ts. Frustration-Free Setup has no
 * route: the write has no live-tested source (M6.10).
 *
 * - `PUT {net}/proxied_nodes` JSON `{enabled}`: eero Built-in. 404 when the
 *   network has no `proxied_nodes`, 400 in bridge mode.
 * - `POST /2.3/networks/{id}/shh/start_zigbee_discovery`: 2.3 only; 404
 *   without a `smart_home_hub` or `zigbee` capability. Counts the starts in
 *   `zigbeeDiscoveries` on the network object (fake only).
 * - `POST /2.2/amazon/networks/{id}/account_unlink`: clears
 *   `amazon_account_linked`; 400 when nothing is linked.
 */

import { fail, ok, type Route } from "../server";

export const routes: Route[] = [
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
