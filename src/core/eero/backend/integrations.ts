/**
 * eero backend, integrations area: everything comes from the network object
 * (`GET {net}`, shared with other reads). `GET {net}/proxied_nodes` answers
 * 404 on a real network, so eero Built-in is the embedded `proxied_nodes`.
 * See docs/architecture/commands.md (integrations).
 */

import { mapIntegrations } from "../map/settings";
import type { EeroArea } from "./index";
import { fetchNetwork } from "./network";

export const integrations: EeroArea<"integrations"> = (ctx) => ({
  async get(id) {
    return mapIntegrations(await fetchNetwork(ctx, id));
  },
});
