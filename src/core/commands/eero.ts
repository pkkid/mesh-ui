/** eero commands (read side). See docs/architecture/commands.md#eero-commandseerots. */

import { z } from "zod";
import type * as M from "../model";
import { POLL } from "../poll";
import { type AnyCommand, defineCommand, ref } from "../spec";

/** Gateway first, then by location. */
const byTopology = (a: M.Eero, b: M.Eero) => Number(b.isGateway) - Number(a.isGateway) || a.location.localeCompare(b.location);

/** Mesh link quality from bars: 4 to 5 excellent, 3 good, 2 weak, 0 to 1 poor. Null for a wired eero or no bars. */
export function meshQuality(e: Pick<M.Eero, "backhaul" | "meshBars">): M.MeshQuality | null {
  if (e.backhaul !== "wireless" || e.meshBars === null) return null;
  if (e.meshBars >= 4) return "excellent";
  if (e.meshBars === 3) return "good";
  if (e.meshBars === 2) return "weak";
  return "poor";
}

/**
 * Fills `hop` and `meshQuality`. Hop is links from the gateway along
 * `upstream`: 0 for the gateway, parent plus 1 otherwise. A non-gateway eero
 * with no known upstream counts as hanging off the gateway (hop 1); a broken
 * chain (an unknown parent, a loop, no gateway) gives null.
 */
export function withTopology(eeros: M.Eero[]): M.Eero[] {
  const byId = new Map(eeros.map((e) => [e.id, e]));
  const hasGateway = eeros.some((e) => e.isGateway);
  const memo = new Map<M.Id, number | null>();
  const hopOf = (e: M.Eero, seen: Set<M.Id>): number | null => {
    if (memo.has(e.id)) return memo.get(e.id) ?? null;
    let hop: number | null;
    if (e.isGateway) hop = 0;
    else if (!hasGateway) hop = null;
    else if (e.upstream === null) hop = 1;
    else {
      const parent = byId.get(e.upstream);
      const up = !parent || seen.has(parent.id) ? null : hopOf(parent, new Set(seen).add(e.id));
      hop = up === null ? null : up + 1;
    }
    memo.set(e.id, hop);
    return hop;
  };
  return eeros.map((e) => ({ ...e, hop: hopOf(e, new Set([e.id])), meshQuality: meshQuality(e) }));
}

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
    run: async (ctx): Promise<M.Eero[]> => withTopology(await ctx.backend.eero.list(ctx.net)).sort(byTopology),
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
    async run(ctx, p): Promise<M.Eero> {
      const id = await ctx.resolve("eero", p.eero);
      const [one, all] = await Promise.all([ctx.backend.eero.get(ctx.net, id), ctx.backend.eero.list(ctx.net)]);
      // Hop needs the whole mesh; the fresh single read wins for every other field.
      const others = all.filter((e) => e.id !== one.id);
      return withTopology([...others, one]).find((e) => e.id === one.id) ?? one;
    },
  }),
];
