/** eero commands (read side). See docs/architecture/commands.md#eero-commandseerots. */

import { z } from "zod";
import type * as M from "../model";
import { POLL } from "../poll";
import { type AnyCommand, defineCommand, ref } from "../spec";

/** Gateway first, then by location. */
const byTopology = (a: M.Eero, b: M.Eero) => Number(b.isGateway) - Number(a.isGateway) || a.location.localeCompare(b.location);

export const commands: AnyCommand[] = [
  defineCommand({
    id: "eero.list",
    label: "eeros",
    description: "Lists the eeros on the network with status, topology (upstream eero, mesh bars), clients and bands. Gateway first.",
    icon: "router",
    effect: "query",
    topic: "eeros",
    poll: POLL.eeros,
    params: z.object({}),
    run: async (ctx): Promise<M.Eero[]> => (await ctx.backend.eero.list(ctx.net)).sort(byTopology),
  }),

  defineCommand({
    id: "eero.get",
    label: "eero",
    description: "One eero with its radios, BSSIDs, firmware, LED and uptime.",
    icon: "router",
    effect: "query",
    topic: "eeros",
    poll: POLL.eeros,
    params: z.object({ eero: ref("eero") }),
    run: async (ctx, p): Promise<M.Eero> => ctx.backend.eero.get(ctx.net, await ctx.resolve("eero", p.eero)),
  }),
];
