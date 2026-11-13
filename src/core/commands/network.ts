/**
 * Network commands: list and switch networks, read one network, its health
 * and the signed-in user's permissions. See docs/architecture/commands.md
 * (network) and engine.md (Network switching).
 *
 * `network.list` reports the session's selection as it is: when nothing has
 * been chosen yet every `selected` is false, so a UI can offer the chooser
 * before running any network-scoped command (which would auto-pick the first
 * network).
 */

import { z } from "zod";
import type * as M from "../model";
import { POLL } from "../poll";
import { type AnyCommand, defineCommand, ref } from "../spec";

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
    description: "One network: name, nickname, status, role, counts, capabilities, time zone and banner messages.",
    icon: "network",
    params: empty,
    effect: "query",
    topic: "network",
    poll: POLL.network,
    async run(ctx): Promise<M.Network> {
      const n = await ctx.backend.network.get(ctx.net);
      return { ...n, selected: n.id === ctx.selectedNetworkId };
    },
  }),

  defineCommand({
    id: "network.health",
    label: "Network health",
    description: "Internet and mesh status, each eero's status and mesh bars, weak links and banner messages.",
    icon: "activity",
    params: empty,
    effect: "query",
    topic: "network",
    poll: POLL.network,
    run: (ctx): Promise<M.NetworkHealth> => ctx.backend.network.health(ctx.net),
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
