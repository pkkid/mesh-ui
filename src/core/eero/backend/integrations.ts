/**
 * eero backend, integrations area: everything comes from the network object
 * (`GET {net}`, shared with other reads). `GET {net}/proxied_nodes` answers
 * 404 on a real network, so eero Built-in is the embedded `proxied_nodes`.
 *
 * Writes (docs/eero-api/endpoints.md): eero Built-in `PUT {net}/proxied_nodes`
 * JSON `{enabled}`; Frustration-Free Setup `PUT {net}/settings` JSON `{ffs}`;
 * Zigbee discovery `POST /2.3/networks/{id}/shh/start_zigbee_discovery` (2.3
 * only); Amazon unlink `POST /2.2/amazon/networks/{id}/account_unlink`. Each
 * returns the next read. See docs/architecture/commands.md (integrations).
 */

import { mapIntegrations } from "../map/settings";
import { networkPath } from "../urls";
import type { EeroArea } from "./index";
import { fetchNetwork } from "./network";

export const integrations: EeroArea<"integrations"> = (ctx) => {
  const { client } = ctx;
  const get = async (id: string) => mapIntegrations(await fetchNetwork(ctx, id));
  // The amazon and shh paths take the bare network id, not the network link.
  const bare = (id: string) => encodeURIComponent(id);

  return {
    get,

    async setBuiltin(id, enabled) {
      await client.request({ method: "PUT", path: networkPath(id, "proxied_nodes"), body: { enabled }, encoding: "json" });
      return get(id);
    },

    async setFfs(id, enabled) {
      await client.request({ method: "PUT", path: networkPath(id, "settings"), body: { ffs: enabled }, encoding: "json" });
      return get(id);
    },

    async discoverZigbee(id) {
      await client.request({ method: "POST", path: `/2.3/networks/${bare(id)}/shh/start_zigbee_discovery` });
    },

    async unlinkAmazon(id) {
      await client.request({ method: "POST", path: `/2.2/amazon/networks/${bare(id)}/account_unlink` });
      return get(id);
    },
  };
};
