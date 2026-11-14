/** eero commands: reads, and rename, find, status light, nightlight and restart (M4.8). See docs/architecture/commands.md#eero-commandseerots. */

import { z } from "zod";
import { CommandError } from "../errors";
import type * as M from "../model";
import { POLL } from "../poll";
import { type AnyCommand, type CommandContext, defineCommand, ref } from "../spec";
import { RESTART_ESTIMATE, type RestartResult } from "./network";

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

// ---------------------------------------------------------------------------
// Writes (M4.8)

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const hhmm = z.string().regex(HHMM, "Use 24-hour HH:MM, like 20:00.");

/** Default blink length, seconds. */
export const FIND_SECONDS = 30;

/**
 * Who a restart drops and for how long (commands.md#restart-estimates).
 * The gateway takes the whole network down; a leaf drops its own devices
 * and any eero that connects through it.
 */
export function eeroRestartMessage(eero: Pick<M.Eero, "id" | "location" | "isGateway">, eeros: ReadonlyArray<Pick<M.Eero, "id" | "location" | "upstream">>, networkName: string): string {
  if (eero.isGateway) return `${eero.location} is the gateway: restarting it takes ${networkName} offline. Every device loses internet for ${RESTART_ESTIMATE.network}.`;
  const below = eeros.filter((e) => e.upstream === eero.id).map((e) => e.location);
  const also = below.length > 0 ? ` ${below.join(", ")} ${below.length === 1 ? "connects" : "connect"} through it and ${below.length === 1 ? "drops" : "drop"} too.` : "";
  return `Restarts ${eero.location}. Its devices drop for ${RESTART_ESTIMATE.eero}.${also}`;
}

/** The eeros a restart takes down: all of them for the gateway, else this one and those that connect through it. */
export function restartedBy(eero: Pick<M.Eero, "id" | "isGateway">, eeros: ReadonlyArray<Pick<M.Eero, "id" | "upstream">>): M.Id[] {
  if (eero.isGateway) return eeros.map((e) => e.id);
  const out = new Set<M.Id>([eero.id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const e of eeros) if (e.upstream && out.has(e.upstream) && !out.has(e.id)) (out.add(e.id), (grew = true));
  }
  return [...out];
}

const networkName = async (ctx: CommandContext) => (await ctx.backend.network.get(ctx.net).catch(() => null))?.name ?? "the network";

const writeCommands: AnyCommand[] = [
  defineCommand({
    id: "eero.rename",
    label: "Rename eero",
    description: "Sets an eero's room name (`location`), as the eero app shows it.",
    icon: "pencil",
    effect: "write",
    invalidates: ["eeros", "network", "eero_ports"],
    params: z.object({ eero: ref("eero"), location: z.string().trim().min(1, "Enter a name.").max(32, "32 characters at most.").describe("New room name, 1 to 32 characters.") }),
    run: async (ctx, p): Promise<M.Eero> => ctx.backend.eero.rename(ctx.net, await ctx.resolve("eero", p.eero), p.location),
  }),

  defineCommand({
    id: "eero.find",
    label: "Blink light",
    description: "Blinks an eero's status light blue and white so you can find it. Harmless. There is no stop yet: it ends by itself.",
    icon: "lightbulb",
    effect: "write",
    invalidates: [],
    params: z.object({ eero: ref("eero"), seconds: z.number().int().min(10).max(60).optional().describe(`How long to blink, 10 to 60 seconds (default ${FIND_SECONDS}).`) }),
    async run(ctx, p): Promise<{ eeroId: M.Id; seconds: number }> {
      const id = await ctx.resolve("eero", p.eero);
      const seconds = p.seconds ?? FIND_SECONDS;
      await ctx.backend.eero.find(ctx.net, id, seconds);
      return { eeroId: id, seconds };
    },
  }),

  defineCommand({
    id: "eero.led.set",
    label: "Status light",
    description: "Turns an eero's status light on or off and sets its brightness (0 to 100).",
    icon: "lightbulb",
    effect: "write",
    invalidates: ["eeros"],
    params: z.object({ eero: ref("eero"), on: z.boolean().optional().describe("Light on or off."), brightness: z.number().int().min(0).max(100).optional().describe("Brightness, 0 to 100.") }),
    async run(ctx, p): Promise<M.Eero> {
      if (p.on === undefined && p.brightness === undefined) throw new CommandError("bad_params", "Give on, brightness or both.");
      return ctx.backend.eero.setLed(ctx.net, await ctx.resolve("eero", p.eero), { on: p.on, brightness: p.brightness });
    },
  }),

  defineCommand({
    id: "eero.nightlight.set",
    label: "Nightlight",
    description: "eero Beacon nightlight: off, ambient (follows the room light) or on a schedule (`on` and `off` as HH:MM), with brightness 0 to 100. Other eeros have no nightlight and fail bad_params.",
    icon: "moon",
    effect: "write",
    invalidates: ["eeros"],
    params: z.object({
      eero: ref("eero"),
      mode: z.enum(["off", "ambient", "schedule"]).describe("off, ambient or schedule."),
      brightness: z.number().int().min(0).max(100).optional().describe("Brightness, 0 to 100. Default: the current one."),
      on: hhmm.optional().describe("Schedule start, HH:MM. Default: the current one."),
      off: hhmm.optional().describe("Schedule end, HH:MM. Default: the current one."),
    }),
    async run(ctx, p): Promise<M.Eero> {
      const id = await ctx.resolve("eero", p.eero);
      const current = await ctx.backend.eero.get(ctx.net, id);
      // Capability check: only a Beacon reports a nightlight.
      if (!current.nightlight) throw new CommandError("bad_params", `${current.location} has no nightlight. Only eero Beacon has one.`);
      const was = current.nightlight;
      const on = p.on ?? was.on ?? "20:00";
      const off = p.off ?? was.off ?? "07:00";
      return ctx.backend.eero.setNightlight(ctx.net, id, { mode: p.mode, brightness: p.brightness ?? was.brightness ?? 50, on, off });
    },
  }),

  defineCommand({
    id: "eero.restart",
    label: "Restart eero",
    description: `Restarts one eero. A leaf eero's devices (and eeros that connect through it) drop for ${RESTART_ESTIMATE.eero}; restarting the gateway takes the whole network down for ${RESTART_ESTIMATE.network}. Returns the eeros that restart.`,
    icon: "rotate-ccw",
    effect: "disruptive",
    invalidates: ["eeros", "network"],
    params: z.object({ eero: ref("eero") }),
    async confirmMessage(ctx, p) {
      const id = await ctx.resolve("eero", p.eero);
      const [eeros, name] = await Promise.all([ctx.backend.eero.list(ctx.net), networkName(ctx)]);
      const e = eeros.find((x) => x.id === id);
      return e ? eeroRestartMessage(e, eeros, name) : `Restarts this eero. Its devices drop for ${RESTART_ESTIMATE.eero}.`;
    },
    async run(ctx, p): Promise<RestartResult> {
      const id = await ctx.resolve("eero", p.eero);
      const eeros = await ctx.backend.eero.list(ctx.net);
      const e = eeros.find((x) => x.id === id);
      await ctx.backend.eero.restart(ctx.net, id);
      // An offline eero cannot take the restart, so it is not waited for.
      const offline = new Set(eeros.filter((x) => x.status === "offline").map((x) => x.id));
      const down = (e ? restartedBy(e, eeros) : [id]).filter((x) => !offline.has(x));
      return { eeroIds: down, estimate: e?.isGateway ? RESTART_ESTIMATE.network : RESTART_ESTIMATE.eero };
    },
  }),
];

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
  ...writeCommands,
];
