/**
 * Smart home integrations: `integrations.get`, each partner feature with
 * `available` and `enabled` (eero leaving a feature out, or a 403 or 404, is
 * "unavailable", not an error), and the writes behind the Integrations card:
 * the eero Built-in switch, Zigbee discovery on a Smart Home Hub and
 * unlinking Amazon (destructive). Frustration-Free Setup is read only: no
 * client has live-tested its write and eero's own app shows no switch (M6.10). A write on an
 * unavailable integration fails with `bad_params` and eero's reason, before
 * anything is sent. Gates use the `{net}/permissions` keys eero sends for
 * these features (`network.proxied_nodes`, `network.smart_home_hub`,
 * `amazon.account`; real capture, 2026-11-14). See docs/architecture/commands.md#integrations-commandsintegrationsts-added.
 */

import { z } from "zod";
import { POLL } from "../poll";
import { CommandError } from "../errors";
import type * as M from "../model";
import { type AnyCommand, type CommandContext, defineCommand } from "../spec";

const NAMES: Record<M.IntegrationId, string> = {
  homekit: "Apple HomeKit",
  amazon: "Amazon Connected Home",
  builtin: "eero Built-in",
  smart_home_hub: "Smart Home Hub",
  ffs: "Frustration-Free Setup",
};

/** The integration, or bad_params with eero's reason when it is not available here. */
async function available(ctx: CommandContext, id: M.IntegrationId): Promise<M.Integration> {
  const it = (await ctx.backend.integrations.get(ctx.net))[id];
  if (!it.available) throw new CommandError("bad_params", `${NAMES[id]} is not available on this network${it.detail ? `: ${it.detail}` : ""}.`);
  return it;
}

/** Amazon must be linked before it can be unlinked. */
async function linkedAmazon(ctx: CommandContext): Promise<void> {
  const amazon = await available(ctx, "amazon");
  if (amazon.enabled !== true) throw new CommandError("bad_params", "This network is not linked to an Amazon account.");
}

const enabledParams = z.object({ enabled: z.boolean().describe("true turns it on, false turns it off.") });

export type ZigbeeDiscovery = { started: true };

export const commands: AnyCommand[] = [
  defineCommand({
    id: "integrations.get",
    label: "Integrations",
    description:
      "Smart home integrations: Apple HomeKit, Amazon Connected Home, eero Built-in, Smart Home Hub and Frustration-Free Setup, each with `available` (eero reports it for this network) and `enabled` (null when unavailable or unknown).",
    icon: "plug",
    params: z.object({}),
    effect: "query",
    topic: "integrations",
    poll: POLL.settings,
    run: (ctx): Promise<M.Integrations> => ctx.backend.integrations.get(ctx.net),
  }),
  defineCommand({
    id: "integrations.builtin.set",
    label: "eero Built-in",
    description:
      "Turns eero Built-in on or off for the whole network: compatible Echo devices extend the mesh. Devices connected through an Echo move to an eero when it is turned off. Not available in bridge mode.",
    icon: "radio-tower",
    params: enabledParams,
    effect: "disruptive",
    gate: { area: "network.proxied_nodes", bridgeOff: true },
    invalidates: ["integrations", "devices"],
    confirmMessage: async (ctx, p) =>
      // An unavailable integration is refused with eero's reason before anything asks.
      (await available(ctx, "builtin"), p.enabled)
        ? "eero Built-in turns on: compatible Echo devices start extending the mesh. Nothing goes offline."
        : "eero Built-in turns off. Devices connected through an Echo drop and reconnect to an eero in range; any out of range stay offline.",
    run: async (ctx, p): Promise<M.Integrations> => {
      await available(ctx, "builtin");
      return ctx.backend.integrations.setBuiltin(ctx.net, p.enabled);
    },
  }),
  defineCommand({
    id: "integrations.zigbee.discover",
    label: "Discover Zigbee devices",
    description: "Starts Zigbee discovery on the network's Smart Home Hub. Put the device in pairing mode first; pairing finishes in the Alexa app.",
    icon: "radar",
    params: z.object({}),
    effect: "write",
    gate: { area: "network.smart_home_hub" },
    invalidates: ["integrations"],
    run: async (ctx): Promise<ZigbeeDiscovery> => {
      await available(ctx, "smart_home_hub");
      await ctx.backend.integrations.discoverZigbee(ctx.net);
      return { started: true };
    },
  }),
  defineCommand({
    id: "integrations.amazon.unlink",
    label: "Unlink Amazon",
    description:
      "Unlinks the Amazon account from this network. Alexa, eero Built-in and Frustration-Free Setup stop working here. Linking again needs Amazon sign-in in the eero app. Owner only.",
    icon: "unlink",
    params: z.object({}),
    effect: "destructive",
    gate: { area: "amazon.account", op: "delete" },
    invalidates: ["integrations", "network"],
    confirmMessage: async (ctx) => {
      await linkedAmazon(ctx);
      return "Alexa, eero Built-in and Frustration-Free Setup stop working on this network. Linking again needs Amazon sign-in in the eero app.";
    },
    run: async (ctx): Promise<M.Integrations> => {
      await linkedAmazon(ctx);
      return ctx.backend.integrations.unlinkAmazon(ctx.net);
    },
  }),
];
