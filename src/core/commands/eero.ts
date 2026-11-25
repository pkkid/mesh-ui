/** eero commands: reads, rename, find, status light, nightlight and restart (M4.8), port actions and remove (M5.7). See docs/architecture/commands.md#eero-commandseerots. */

import { z } from "zod";
import { CommandError } from "../errors";
import * as M from "../model";
import { POLL } from "../poll";
import { type AnyCommand, type CommandContext, defineCommand, ref } from "../spec";
import { RESTART_ESTIMATE, type RestartResult } from "./network";

/** Gateway first, then eeros by location, then eero Built-in devices (Echos) by name, as the eero app lists them. */
const byTopology = (a: M.Eero, b: M.Eero) =>
  Number(b.isGateway) - Number(a.isGateway) || Number(a.kind === "builtin") - Number(b.kind === "builtin") || a.location.localeCompare(b.location);

/**
 * eero offers none of its eero actions for an eero Built-in device (an Echo
 * extending the mesh): bad_params before anything is sent or confirmed.
 */
export function builtinRefusal(eero: Pick<M.Eero, "kind" | "location">, what: string): string | null {
  return eero.kind === "builtin" ? `${eero.location} is an eero Built-in device. eero does not offer ${what} for it; use the Alexa app.` : null;
}

/** The eero for a write, refused with bad_params when it is an eero Built-in device. */
async function eeroFor(ctx: CommandContext, eeroRef: string, what: string): Promise<{ id: M.Id; eero: M.Eero | undefined }> {
  const id = await ctx.resolve("eero", eeroRef);
  const eero = (await ctx.backend.eero.list(ctx.net)).find((e) => e.id === id);
  const refused = eero ? builtinRefusal(eero, what) : null;
  if (refused) throw new CommandError("bad_params", refused);
  return { id, eero };
}

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

const PORT_ACTIONS = Object.keys(M.INVERSE_PORT_ACTION) as [M.PortAction, ...M.PortAction[]];

/** "A", "A and B", "A, B and C". */
const listNames = (names: string[]) => (names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/** Who is behind a port, for confirm copy: "Living Room TV and Hue Bridge", or null when nothing is. */
const behind = (p: Pick<M.EeroPort, "attachments">) => {
  const names = p.attachments.map((a) => a.name ?? "an unnamed device");
  return names.length ? listNames(names) : null;
};

/**
 * What a port action does, for the confirm (engine's needs_confirm message).
 * Names what is plugged in and, for an eero behind the port, that it may go offline.
 */
export function portActionMessage(eero: Pick<M.Eero, "location">, port: Pick<M.EeroPort, "number" | "attachments">, action: M.PortAction): string {
  const where = `port ${port.number} on ${eero.location}`;
  const who = behind(port);
  const plural = port.attachments.length > 1;
  const eeros = port.attachments.filter((a) => a.eeroId !== null).map((a) => a.name ?? "an eero");
  const meshNote = eeros.length ? ` ${listNames(eeros)} ${eeros.length > 1 ? "connect" : "connects"} through this port and may go offline.` : "";
  const lose = (what: string) => (who ? ` ${who} ${plural ? "lose" : "loses"} ${what}.` : " Nothing is plugged in.");
  switch (action) {
    case "DISABLE_PORT":
      return `Turns off ${where}.${lose(plural ? "their wired connection" : "its wired connection")}${meshNote}`;
    case "ENABLE_PORT":
      return `Turns ${where} back on. Wired devices on it reconnect.`;
    case "DISABLE_DATA":
      return `Stops data on ${where}; PoE power stays on.${lose("its network connection")}${meshNote}`;
    case "ENABLE_DATA":
      return `Turns data on ${where} back on.`;
    case "DISABLE_POE":
      return `Cuts PoE power on ${where}.${lose("power")}${meshNote}`;
    case "ENABLE_POE":
      return `Turns PoE power on ${where} back on.`;
    case "RESTART_POWER":
      return `Power-cycles PoE on ${where}.${who ? ` ${who} ${plural ? "drop" : "drops"} until ${plural ? "they restart" : "it restarts"}.` : " Nothing is plugged in."}${meshNote}`;
  }
}

/** The port and eero for a port action, or bad_params when the port does not exist or does not list the action. */
async function portFor(ctx: CommandContext, eeroRef: string, number: number, action: M.PortAction) {
  const { id } = await eeroFor(ctx, eeroRef, "Ethernet ports");
  const [eero, ports] = await Promise.all([ctx.backend.eero.get(ctx.net, id), ctx.backend.eero.ports(ctx.net, id)]);
  const port = ports.ports.find((p) => p.number === number);
  if (!port) {
    const have = ports.ports.map((p) => p.number);
    throw new CommandError("bad_params", have.length ? `${eero.location} has no port ${number}. Ports: ${have.join(", ")}.` : `${eero.location} has no Ethernet ports.`);
  }
  if (!port.actions.includes(action)) {
    const allowed = port.actions.length ? `It allows ${port.actions.join(", ")}.` : "eero lists no actions for it.";
    throw new CommandError("bad_params", `Port ${number} on ${eero.location} does not allow ${action}. ${allowed}`);
  }
  return { id, eero, port };
}

/** Why an eero cannot be removed, or null. The gateway can only go when it is the only eero. */
export function removeRefusal(eero: Pick<M.Eero, "location" | "isGateway">, eeroCount: number): string | null {
  if (!eero.isGateway || eeroCount <= 1) return null;
  return `${eero.location} is the gateway. Remove the other eeros first, or replace the gateway in the eero app.`;
}

/** What removing an eero does, for the confirm. */
export function removeMessage(eero: Pick<M.Eero, "id" | "location" | "isGateway">, eeros: ReadonlyArray<Pick<M.Eero, "id" | "location" | "upstream">>, networkName: string): string {
  if (eero.isGateway) return `Removes ${eero.location} from ${networkName} and resets it. It is the only eero, so ${networkName} goes offline. This cannot be undone; adding it back needs the eero app.`;
  const below = eeros.filter((e) => e.upstream === eero.id).map((e) => e.location);
  const also = below.length ? ` ${listNames(below)} ${below.length === 1 ? "loses its" : "lose their"} uplink and may go offline until ${below.length === 1 ? "it finds" : "they find"} another path.` : "";
  return `Removes ${eero.location} from ${networkName} and resets it. Its devices move to other eeros if in range.${also} This cannot be undone; adding it back needs the eero app.`;
}

/** One key order and port order for every backend, so tables and JSON read the same; `attached` always from `portSummary`. */
function normalisePorts(r: M.EeroPorts): M.EeroPorts {
  const ports = r.ports.map(({ number, name, status, speedMbps, supportedMbps, isWan, poe, mac, attachments, actions }): M.EeroPort => ({ number, name, status, speedMbps, supportedMbps, isWan, poe, mac, attached: M.portSummary(attachments), attachments, actions }));
  return { eeroId: r.eeroId, ports: ports.sort((a, b) => a.number - b.number) };
}

const networkName = async (ctx: CommandContext) => (await ctx.backend.network.get(ctx.net).catch(() => null))?.name ?? "the network";

const writeCommands: AnyCommand[] = [
  defineCommand({
    id: "eero.rename",
    label: "Rename eero",
    description: "Sets an eero's room name (`location`), as the eero app shows it.",
    icon: "pencil",
    effect: "write",
    gate: { area: "eeros" },
    invalidates: ["eeros", "network", "eero_ports"],
    params: z.object({ eero: ref("eero"), location: z.string().trim().min(1, "Enter a name.").max(32, "32 characters at most.").describe("New room name, 1 to 32 characters.") }),
    run: async (ctx, p): Promise<M.Eero> => ctx.backend.eero.rename(ctx.net, (await eeroFor(ctx, p.eero, "renaming")).id, p.location),
  }),

  defineCommand({
    id: "eero.find",
    label: "Blink light",
    description: "Blinks an eero's status light blue and white so you can find it. Harmless. There is no stop yet: it ends by itself.",
    icon: "lightbulb",
    effect: "write",
    gate: { area: "eeros" },
    invalidates: [],
    params: z.object({ eero: ref("eero"), seconds: z.number().int().min(10).max(60).optional().describe(`How long to blink, 10 to 60 seconds (default ${FIND_SECONDS}).`) }),
    async run(ctx, p): Promise<{ eeroId: M.Id; seconds: number }> {
      const { id } = await eeroFor(ctx, p.eero, "Blink light");
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
    gate: { area: "eeros", capability: "led_action" },
    invalidates: ["eeros"],
    params: z.object({ eero: ref("eero"), on: z.boolean().optional().describe("Light on or off."), brightness: z.number().int().min(0).max(100).optional().describe("Brightness, 0 to 100.") }),
    async run(ctx, p): Promise<M.Eero> {
      if (p.on === undefined && p.brightness === undefined) throw new CommandError("bad_params", "Give on, brightness or both.");
      return ctx.backend.eero.setLed(ctx.net, (await eeroFor(ctx, p.eero, "a status light")).id, { on: p.on, brightness: p.brightness });
    },
  }),

  defineCommand({
    id: "eero.nightlight.set",
    label: "Nightlight",
    description: "eero Beacon nightlight: off, ambient (follows the room light) or on a schedule (`on` and `off` as HH:MM), with brightness 0 to 100. Other eeros have no nightlight and fail bad_params.",
    icon: "moon",
    effect: "write",
    gate: { area: "eeros" },
    invalidates: ["eeros"],
    params: z.object({
      eero: ref("eero"),
      mode: z.enum(["off", "ambient", "schedule"]).describe("off, ambient or schedule."),
      brightness: z.number().int().min(0).max(100).optional().describe("Brightness, 0 to 100. Default: the current one."),
      on: hhmm.optional().describe("Schedule start, HH:MM. Default: the current one."),
      off: hhmm.optional().describe("Schedule end, HH:MM. Default: the current one."),
    }),
    async run(ctx, p): Promise<M.Eero> {
      const { id } = await eeroFor(ctx, p.eero, "a nightlight");
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
    gate: { area: "eeros" },
    invalidates: ["eeros", "network"],
    params: z.object({ eero: ref("eero") }),
    async confirmMessage(ctx, p) {
      const { id } = await eeroFor(ctx, p.eero, "restarts");
      const [eeros, name] = await Promise.all([ctx.backend.eero.list(ctx.net), networkName(ctx)]);
      const e = eeros.find((x) => x.id === id);
      return e ? eeroRestartMessage(e, eeros, name) : `Restarts this eero. Its devices drop for ${RESTART_ESTIMATE.eero}.`;
    },
    async run(ctx, p): Promise<RestartResult> {
      const { id } = await eeroFor(ctx, p.eero, "restarts");
      const eeros = await ctx.backend.eero.list(ctx.net);
      const e = eeros.find((x) => x.id === id);
      await ctx.backend.eero.restart(ctx.net, id);
      // An offline eero cannot take the restart, and an eero Built-in device (an Echo) does not restart with the mesh.
      const offline = new Set(eeros.filter((x) => x.status === "offline" || x.kind === "builtin").map((x) => x.id));
      const down = (e ? restartedBy(e, eeros) : [id]).filter((x) => !offline.has(x));
      return { networkId: ctx.net, eeroIds: down, estimate: e?.isGateway ? RESTART_ESTIMATE.network : RESTART_ESTIMATE.eero };
    },
  }),

  defineCommand({
    id: "eero.port.action",
    label: "Port action",
    description:
      "Runs one action on one Ethernet port: ENABLE_PORT, DISABLE_PORT, ENABLE_DATA, DISABLE_DATA, ENABLE_POE, DISABLE_POE or RESTART_POWER. Only an action listed in that port's `actions` (eero.ports.get) is accepted; others fail bad_params. Can cut data or power to wired gear. Returns the ports as the next read shows them.",
    icon: "ethernet-port",
    effect: "disruptive",
    gate: { area: "eeros" },
    invalidates: ["eero_ports", "eeros", "devices", "network"],
    params: z.object({
      eero: ref("eero"),
      port: z.number().int().min(1).max(64).describe("Port number, as eero.ports.get lists it."),
      action: z.enum(PORT_ACTIONS).describe("One of the port's `actions`."),
    }),
    async confirmMessage(ctx, p) {
      const { eero, port } = await portFor(ctx, p.eero, p.port, p.action);
      return portActionMessage(eero, port, p.action);
    },
    async run(ctx, p): Promise<M.EeroPorts> {
      const { id } = await portFor(ctx, p.eero, p.port, p.action);
      return normalisePorts(await ctx.backend.eero.portAction(ctx.net, id, p.port, p.action));
    },
  }),

  defineCommand({
    id: "eero.remove",
    label: "Remove eero",
    description:
      "Removes an eero from the network and resets it. Cannot be undone; adding it back needs the eero app. Refuses the gateway unless it is the only eero. Owner only.",
    icon: "trash-2",
    effect: "destructive",
    gate: { area: "eeros", op: "delete" },
    invalidates: ["eeros", "network", "eero_ports", "devices", "usage"],
    params: z.object({ eero: ref("eero") }),
    async confirmMessage(ctx, p) {
      const { id } = await eeroFor(ctx, p.eero, "removing it from the network here");
      const [eeros, name] = await Promise.all([ctx.backend.eero.list(ctx.net), networkName(ctx)]);
      const e = eeros.find((x) => x.id === id);
      if (!e) return `Removes this eero from ${name} and resets it. This cannot be undone.`;
      const refused = removeRefusal(e, eeros.length);
      if (refused) throw new CommandError("bad_params", refused);
      return removeMessage(e, eeros, name);
    },
    async run(ctx, p): Promise<{ networkId: M.Id; eeroId: M.Id; location: string }> {
      const { id } = await eeroFor(ctx, p.eero, "removing it from the network here");
      const eeros = await ctx.backend.eero.list(ctx.net);
      const e = eeros.find((x) => x.id === id);
      if (!e) throw new CommandError("bad_params", "That eero is not on this network.");
      const refused = removeRefusal(e, eeros.length);
      if (refused) throw new CommandError("bad_params", refused);
      await ctx.backend.eero.remove(ctx.net, id);
      return { networkId: ctx.net, eeroId: id, location: e.location };
    },
  }),
];

export const commands: AnyCommand[] = [
  defineCommand({
    id: "eero.list",
    label: "eeros",
    description:
      "Lists the eeros on the network with status, topology (upstream eero, mesh bars), clients and bands. Gateway first. eero Built-in devices (Amazon Echos extending the mesh) are listed after the eeros with `kind: \"builtin\"`: eero sends no radios, firmware, uptime, ports or upstream for them, and eero actions refuse them.",
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
    description: "One eero's Ethernet ports: status, negotiated and supported speed (Mbps), PoE, MAC, everything plugged in (`attachments`, several behind a switch; `attached` sums them up), and the actions eero allows. Empty list when the eero has no ports.",
    icon: "ethernet-port",
    effect: "query",
    topic: "eero_ports",
    poll: POLL.eeros,
    params: z.object({ eero: ref("eero") }),
    async run(ctx, p): Promise<M.EeroPorts> {
      const id = await ctx.resolve("eero", p.eero);
      // An eero Built-in device reports no ports: an empty list, as for an eero without any.
      if ((await ctx.backend.eero.list(ctx.net)).find((e) => e.id === id)?.kind === "builtin") return { eeroId: id, ports: [] };
      return normalisePorts(await ctx.backend.eero.ports(ctx.net, id));
    },
  }),

  defineCommand({
    id: "eero.firmware.history",
    label: "Firmware history",
    description: "Firmware versions one eero has run, newest first, with the running version marked `current`.",
    icon: "history",
    effect: "query",
    topic: "firmware_history",
    params: z.object({ eero: ref("eero"), limit: z.number().int().min(1).max(200).optional().describe("Most entries to return, 1 to 200 (default 20).") }),
    async run(ctx, p): Promise<M.FirmwareEntry[]> {
      const id = await ctx.resolve("eero", p.eero);
      // eero keeps no eeroOS history for an eero Built-in device.
      if ((await ctx.backend.eero.list(ctx.net)).find((e) => e.id === id)?.kind === "builtin") return [];
      return ctx.backend.eero.firmwareHistory(ctx.net, id, p.limit ?? 20);
    },
  }),
  ...writeCommands,
];
