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
      const listed = all.find((e) => e.id === one.id);
      // LAN facts are network-wide; a single read may not know them (the gateway address comes from the gateway eero).
      const lan = { subnet: one.subnet ?? listed?.subnet ?? null, gatewayIp: one.gatewayIp ?? listed?.gatewayIp ?? null };
      const merged = { ...one, ...lan };
      return withTopology([...others, merged]).find((e) => e.id === one.id) ?? merged;
    },
  }),

  defineCommand({
    id: "eero.ports.get",
    label: "Ethernet ports",
    description: "One eero's Ethernet ports: status, negotiated and supported speed (Mbps), PoE, MAC, the device or eero plugged in, and the actions eero allows. Empty list when the eero has no ports.",
    icon: "ethernet-port",
    effect: "query",
    topic: "eero_ports",
    poll: POLL.eeros,
    params: z.object({ eero: ref("eero") }),
    async run(ctx, p): Promise<M.EeroPorts> {
      const r = await ctx.backend.eero.ports(ctx.net, await ctx.resolve("eero", p.eero));
      // One key order for every backend, so tables and JSON read the same.
      const ports = r.ports.map(({ number, name, status, speedMbps, supportedMbps, isWan, poe, mac, attached, actions }): M.EeroPort => ({ number, name, status, speedMbps, supportedMbps, isWan, poe, mac, attached, actions }));
      return { eeroId: r.eeroId, ports: ports.sort((a, b) => a.number - b.number) };
    },
  }),

  defineCommand({
    id: "eero.firmware.history",
    label: "Firmware history",
    description: "Firmware versions one eero has run, newest first, with the running version marked `current`.",
    icon: "history",
    effect: "query",
    topic: "firmware_history",
    params: z.object({ eero: ref("eero"), limit: z.number().int().min(1).max(50).optional().describe("Most entries to return (default 20).") }),
    run: async (ctx, p): Promise<M.FirmwareEntry[]> => ctx.backend.eero.firmwareHistory(ctx.net, await ctx.resolve("eero", p.eero), p.limit ?? 20),
  }),
];
