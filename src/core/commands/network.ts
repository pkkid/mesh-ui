/**
 * Network commands: list and switch networks, read one network, its health
 * and the signed-in user's permissions. See docs/architecture/commands.md
 * (network) and engine.md (Network switching).
 *
 * `network.list` reports the session's selection as it is: the last used
 * network (`lastNetworkId`) once one has been chosen, else every `selected`
 * is false. Sign-in uses it to open the last used network, else the first,
 * before any network-scoped command runs (which would auto-pick the first
 * network).
 */

import { z } from "zod";
import type * as M from "../model";
import { POLL } from "../poll";
import { type AnyCommand, defineCommand, ref } from "../spec";
import { knownDevices } from "./device";

const empty = z.object({});

export const commands: AnyCommand[] = [
  defineCommand({
    id: "network.list",
    label: "Networks",
    description: "Lists the networks on this account with role, status, eero count and devices online. `selected` marks the network the session acts on; all false means none is chosen yet.",
    icon: "network",
    params: empty,
    effect: "query",
    scope: "account",
    topic: "account",
    async run(ctx): Promise<M.NetworkSummary[]> {
      const list = await ctx.backend.network.list();
      return list.map((n) => ({ ...n, selected: n.id === ctx.selectedNetworkId }));
    },
  }),

  defineCommand({
    id: "network.select",
    label: "Switch network",
    description: "Makes a network the selected one for this app and the CLI. Local only: nothing changes on eero.",
    icon: "arrow-left-right",
    params: z.object({ network: ref("network") }),
    effect: "write",
    scope: "account",
    // network.get caches the `selected` flag.
    invalidates: ["network"],
    async run(ctx, p): Promise<{ networkId: M.Id }> {
      const id = await ctx.resolve("network", p.network);
      await ctx.selectNetwork(id);
      return { networkId: id };
    },
  }),

  defineCommand({
    id: "network.get",
    label: "Network",
    description:
      "One network: name, nickname, status, role, counts, capabilities, time zone and banner messages. counts.devices is every known device, the same number as device.list summary.total.",
    icon: "network",
    params: empty,
    effect: "query",
    topic: "network",
    poll: POLL.network,
    async run(ctx): Promise<M.Network> {
      const [n, devices] = await Promise.all([ctx.backend.network.get(ctx.net), ctx.backend.device.list(ctx.net)]);
      // eero's clients.count is connected devices only; the sidebar count is every known device, as device.list counts them.
      const counts = { ...n.counts, devices: knownDevices(devices, ctx.now()).length };
      return { ...n, counts, selected: n.id === ctx.selectedNetworkId };
    },
  }),

  defineCommand({
    id: "network.health",
    label: "Network health",
    description: "Internet and mesh status, each eero's status and mesh bars, weak links, banner messages and issues (weak_link, eero_offline, network_offline with the eero, its upstream and the devices affected).",
    icon: "activity",
    params: empty,
    effect: "query",
    topic: "network",
    poll: POLL.network,
    // issues: derived here from eeros and devices by M2.5.
    run: async (ctx): Promise<M.NetworkHealth> => ({ ...(await ctx.backend.network.health(ctx.net)), issues: [] }),
  }),

  defineCommand({
    id: "network.permissions",
    label: "Permissions",
    description: "Your role on the network and what it may read, create, update and delete, per area.",
    icon: "shield",
    params: empty,
    effect: "query",
    topic: "permissions",
    run: (ctx): Promise<M.Permissions> => ctx.backend.network.permissions(ctx.net),
  }),
];
