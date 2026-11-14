/**
 * routing commands (read side): DHCP reservations with the LAN map, port
 * forwards and IPv6 pinholes. All three read the one `GET {net}/routing` under the
 * `routing` cache topic, join rows to devices by MAC and IP here in core, and
 * answer empty lists with a reason in bridge or IP passthrough mode, where
 * eero turns routing off. See docs/architecture/commands.md#routing-commandsroutingts.
 *
 * Writes (M5.5): reservations, port forwards and IPv6 pinholes. Every check
 * (address inside the LAN, not the gateway, not reserved or in use by
 * another device; port bounds, ranges and the `port_forward_range`
 * capability; overlap with other forwards or pinholes) lives here, so the
 * sheet, the CLI and MCP get the same answers. `forward.validate` runs the
 * forward checks without writing; `forward.add` and `forward.update` run them
 * again and fail `bad_params` with the same issues. A forward needs a
 * reservation: `forward.add` reserves the device's current address first
 * when it has none. In bridge or IP passthrough mode every write is refused.
 */

import { z } from "zod";
import type { ForwardInput } from "../backend";
import { CommandError } from "../errors";
import type * as M from "../model";
import { type AnyCommand, type CommandContext, defineCommand, ref, type WriteGate } from "../spec";

/**
 * Result of reservation.list. `leases` are the IPv4 addresses counted in
 * `lan.pool.leased`, for the address map. `unavailable` says why the lists
 * are empty (bridge mode); null otherwise.
 */
export type ReservationList = { reservations: M.Reservation[]; lan: M.LanMap | null; leases: string[]; unavailable: string | null };

/** Result of forward.list. */
export type ForwardList = { forwards: M.Forward[]; unavailable: string | null };

/** Result of pinhole.list. */
export type PinholeList = { pinholes: M.Pinhole[]; unavailable: string | null };

/** An IPv4 address as a number, or null. */
const ipNum = (ip: string): number | null => {
  const p = ip.split(".").map(Number);
  return p.length === 4 && p.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? p.reduce((a, n) => a * 256 + n, 0) : null;
};

const compact = (mac: string) => mac.toLowerCase().replace(/[^0-9a-f]/g, "");

/** Whether a device holds a DHCP lease from the pool (`inPool` tests its IPv4). */
function isLeased(d: M.Device, inPool: (ip: string | null) => boolean, reserved: Set<M.Id>): boolean {
  return d.connected && !d.blocked && d.ssid !== "guest" && inPool(d.ipv4) && !reserved.has(d.id);
}

/** Why routing is off for this network, or null when it is on. */
export function routingUnavailable(mode: M.ConnectionMode | null): string | null {
  if (mode === "bridged") return "Reservations and port forwards are off while the network is in bridge mode.";
  if (mode === "ipPassthrough") return "Reservations and port forwards are off while the network is in IP passthrough mode.";
  return null;
}

type Joined = { routing: M.Routing; leases: string[]; unavailable: string | null; devices: M.Device[] };

/**
 * The routing lists joined to devices: a reservation without a device id
 * takes the device with its MAC, a forward without one takes its
 * reservation's device (by IP), and the pool's leased count is the connected,
 * unblocked main-network devices with an IPv4 address inside the pool and no
 * reservation. This is the only place leases are counted; backends report
 * `pool.leased` as 0. `blocked` is the same flag device.list reports. A
 * pinhole takes its device by id or, failing that, by MAC (eero names it by
 * either), and that device's first global IPv6 when eero sent no address.
 */
async function joined(ctx: CommandContext): Promise<Joined> {
  const network = await ctx.backend.network.get(ctx.net);
  const unavailable = routingUnavailable(network.connectionMode);
  if (unavailable) return { routing: { reservations: [], forwards: [], pinholes: [], lan: null }, leases: [], unavailable, devices: [] };
  const [routing, devices] = await Promise.all([ctx.backend.routing.get(ctx.net), ctx.backend.device.list(ctx.net)]);
  const byMac = new Map(devices.map((d) => [compact(d.mac), d.id]));
  const reservations = routing.reservations.map((r) => ({ ...r, deviceId: r.deviceId ?? byMac.get(compact(r.mac)) ?? null }));
  const byIp = new Map(reservations.map((r) => [r.ip, r]));
  const forwards = routing.forwards.map((f) => ({ ...f, deviceId: f.deviceId ?? byIp.get(f.ip)?.deviceId ?? null }));
  for (const r of reservations) r.forwards = forwards.filter((f) => f.ip === r.ip || (r.deviceId !== null && f.deviceId === r.deviceId)).length;
  const byId = new Map(devices.map((d) => [d.id, d]));
  const pinholes = routing.pinholes.map((p) => {
    const d = p.deviceId === null ? undefined : (byId.get(p.deviceId) ?? byId.get(byMac.get(compact(p.deviceId)) ?? ""));
    return { ...p, deviceId: d?.id ?? p.deviceId, address: p.address ?? d?.ipv6[0] ?? null };
  });
  const reserved = new Set(reservations.map((r) => r.deviceId).filter((id): id is M.Id => id !== null));
  let lan = routing.lan;
  let leases: string[] = [];
  if (lan) {
    const start = ipNum(lan.pool.start);
    const end = ipNum(lan.pool.end);
    // A lease is a main-network address inside the pool; guests use their own subnet, static addresses sit outside it.
    const inPool = (ip: string | null) => {
      const n = ip ? ipNum(ip) : null;
      return n !== null && start !== null && end !== null && n >= start && n <= end;
    };
    leases = devices.flatMap((d) => (d.ipv4 && isLeased(d, inPool, reserved) ? [d.ipv4] : []));
    leases = [...new Set(leases)].sort((a, b) => (ipNum(a) ?? 0) - (ipNum(b) ?? 0));
    lan = { ...lan, pool: { ...lan.pool, leased: leases.length } };
  }
  return { routing: { ...routing, reservations, forwards, pinholes, lan }, leases, unavailable, devices };
}

const byName = <T extends { name: string; id: M.Id }>(a: T, b: T) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || a.id.localeCompare(b.id);

/** By external port, then name: the order the device page lists them. */
const portStart = (p: string) => Number.parseInt(p, 10) || 0;
const byPort = (a: M.Forward, b: M.Forward) => portStart(a.externalPort) - portStart(b.externalPort) || byName(a, b);
const pinholeOrder = (a: M.Pinhole, b: M.Pinhole) => portStart(a.port) - portStart(b.port) || a.id.localeCompare(b.id);

export const commands: AnyCommand[] = [
  defineCommand({
    id: "reservation.list",
    label: "Reservations",
    description:
      "DHCP reservations joined to devices, plus the LAN map (subnet, gateway, static range, DHCP pool and how many addresses are leased). Empty with a reason in bridge mode.",
    icon: "lock",
    effect: "query",
    topic: "routing",
    params: z.object({}),
    run: async (ctx): Promise<ReservationList> => {
      const { routing, leases, unavailable } = await joined(ctx);
      return { reservations: [...routing.reservations].sort(byName), lan: routing.lan, leases, unavailable };
    },
  }),

  defineCommand({
    id: "forward.list",
    label: "Port forwards",
    description: "Port forwards, optionally for one device, with their ports, protocol and whether they are on. Empty with a reason in bridge mode.",
    icon: "arrow-right-left",
    effect: "query",
    topic: "routing",
    params: z.object({ device: ref("device").optional().describe("Only forwards to this device (id, exact name or MAC).") }),
    run: async (ctx, p): Promise<ForwardList> => {
      const deviceId = p.device === undefined ? undefined : await ctx.resolve("device", p.device);
      const { routing, unavailable } = await joined(ctx);
      const forwards = deviceId === undefined ? routing.forwards : routing.forwards.filter((f) => f.deviceId === deviceId);
      return { forwards: [...forwards].sort(byPort), unavailable };
    },
  }),

  defineCommand({
    id: "pinhole.list",
    label: "IPv6 firewall rules",
    description: "IPv6 pinholes: one port or range open to one device, with its IPv6 address and protocol, by port. Empty with a reason in bridge mode.",
    icon: "shield",
    effect: "query",
    topic: "routing",
    params: z.object({}),
    run: async (ctx): Promise<PinholeList> => {
      const { routing, unavailable } = await joined(ctx);
      return { pinholes: [...routing.pinholes].sort(pinholeOrder), unavailable };
    },
  }),
];

// ---------------------------------------------------------------------------
// Writes

/** One problem with a write's input, keyed by the param it is about. */
export type Issue = { field: string; message: string };

/** Result of forward.validate: the same checks forward.add and forward.update run. */
export type ForwardCheck = { ok: boolean; issues: Issue[]; needsReservation: boolean };

/** Result of forward.add: the forward, and the reservation made for it when the device had none. */
export type ForwardAdded = { forward: M.Forward; reservation: M.Reservation | null };

/** Result of reservation.remove: what was removed, so Undo can add it back. */
export type ReservationRemoved = { reservation: M.Reservation; removedForwards: M.Forward[] };

const GATE: WriteGate = { area: "settings", bridgeOff: true };
const WRITES = ["routing", "devices"] as const;

const protocolParam = z.enum(["tcp", "udp", "both"]).describe("tcp, udp or both.");
/** Checked in core (not zod) so forward.validate can list it as an issue while the person types. */
const portParam = z
  .union([z.string().trim().min(1), z.number().int()])
  .transform(String)
  .describe('A port ("8080") or a range ("27015-27030"), 1 to 65535.');
const ipParam = z.string().trim().min(1).describe("An IPv4 address inside the LAN, e.g. 192.168.4.20.");
const descriptionParam = z.string().trim().max(64).describe("A short name, up to 64 characters.");

const fail = (issues: Issue[]): never => {
  throw new CommandError("bad_params", issues[0]?.message ?? "Check the values.", { issues: issues.map((i) => ({ path: i.field, message: i.message })) });
};

/** `"8080"` or `"27015-27030"` to its bounds, or an error message. */
export function parsePorts(spec: string): { start: number; end: number } | string {
  const m = /^\s*(\d{1,5})\s*(?:-\s*(\d{1,5})\s*)?$/.exec(spec);
  if (!m) return "Enter a port (8080) or a range (27015-27030).";
  const start = Number(m[1]);
  const end = m[2] === undefined ? start : Number(m[2]);
  if (start < 1 || end > 65535 || start > 65535 || end < 1) return "Ports run from 1 to 65535.";
  if (end < start) return "A range starts with the lower port.";
  return { start, end };
}

const portText = (r: { start: number; end: number }) => (r.start === r.end ? String(r.start) : `${r.start}-${r.end}`);
const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start <= b.end && b.start <= a.end;
/** TCP+UDP shares a port with either; TCP and UDP never collide. */
const sharesProtocol = (a: M.Protocol, b: M.Protocol) => a === b || a === "both" || b === "both";

const MAC = /^[0-9a-f]{2}([:-]?)[0-9a-f]{2}(\1[0-9a-f]{2}){4}$/i;
/** `0A-1B-2C...` or `0a1b2c...` to `0a:1b:2c:...`, or null. */
export function normalMac(mac: string): string | null {
  const t = mac.trim();
  if (!MAC.test(t)) return null;
  return compact(t).match(/../g)?.join(":") ?? null;
}

/** Throws when routing is off for this network. */
async function routingOn(ctx: CommandContext): Promise<M.Network> {
  const network = await ctx.backend.network.get(ctx.net);
  const off = routingUnavailable(network.connectionMode);
  if (off) throw new CommandError("eero_error", off);
  return network;
}

/** Routing joined to devices, for a write; refuses in bridge mode. */
async function forWrite(ctx: CommandContext): Promise<Joined & { network: M.Network }> {
  const network = await routingOn(ctx);
  return { ...(await joined(ctx)), network };
}

const deviceName = (j: Joined, id: M.Id | null) => (id === null ? undefined : j.devices.find((d) => d.id === id)?.name);

/**
 * Problems with an address for a reservation: a valid IPv4 inside the LAN,
 * not its network, broadcast or gateway address, not reserved for another
 * device and not in use by another device now. `self` is the reservation
 * being edited and `mac` the device it is for.
 */
function addressIssues(j: Joined, ip: string, mac: string, self: M.Id | null): Issue[] {
  const n = ipNum(ip);
  if (n === null) return [{ field: "ip", message: "Enter an IPv4 address like 192.168.4.20." }];
  const lan = j.routing.lan;
  if (lan) {
    const [base, bits] = lan.subnet.split("/");
    const start = ipNum(base ?? "") ?? 0;
    const size = 2 ** (32 - Number(bits));
    if (n < start || n >= start + size) return [{ field: "ip", message: `That address is outside your network (${lan.subnet}).` }];
    if (n === start || n === start + size - 1) return [{ field: "ip", message: "That address is reserved by the network itself. Pick another one." }];
    if (ip === lan.gateway) return [{ field: "ip", message: "That is the gateway's address. Pick another one." }];
  }
  const taken = j.routing.reservations.find((r) => r.ip === ip && r.id !== self);
  if (taken) return [{ field: "ip", message: `That address is already reserved for ${deviceName(j, taken.deviceId) ?? (taken.name || taken.mac)}.` }];
  const using = j.devices.find((d) => d.connected && d.ipv4 === ip && compact(d.mac) !== compact(mac) && d.ssid !== "guest");
  if (using) return [{ field: "ip", message: `${using.name} is using that address now.` }];
  return [];
}

/**
 * The address to reserve when none is given: the device's current IPv4 when
 * it is free, else the first free address in the static range.
 */
function suggestAddress(j: Joined, mac: string, current: string | null): string | null {
  if (current && addressIssues(j, current, mac, null).length === 0) return current;
  const lan = j.routing.lan;
  if (!lan) return null;
  const end = ipNum(lan.staticRange.end) ?? 0;
  for (let n = ipNum(lan.staticRange.start) ?? 0; n <= end && n > 0; n++) {
    const ip = [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
    if (addressIssues(j, ip, mac, null).length === 0) return ip;
  }
  return null;
}

/** A reservation by id, MAC, IP, description or its device's name. */
function findReservation(ctx: CommandContext, j: Joined, refText: string): M.Reservation {
  const id = ctx.match(
    refText,
    j.routing.reservations.map((r) => ({ id: r.id, names: [r.name, r.mac, r.ip, deviceName(j, r.deviceId)] })),
    "reservation",
  );
  return j.routing.reservations.find((r) => r.id === id) as M.Reservation;
}

function findForward(ctx: CommandContext, j: Joined, refText: string): M.Forward {
  const id = ctx.match(
    refText,
    j.routing.forwards.map((f) => ({ id: f.id, names: [f.name] })),
    "forward",
  );
  return j.routing.forwards.find((f) => f.id === id) as M.Forward;
}

function findPinhole(ctx: CommandContext, j: Joined, refText: string): M.Pinhole {
  const id = ctx.match(
    refText,
    j.routing.pinholes.map((p) => ({ id: p.id, names: [`${deviceName(j, p.deviceId) ?? ""}:${p.port}`] })),
    "pinhole",
  );
  return j.routing.pinholes.find((p) => p.id === id) as M.Pinhole;
}

type ForwardDraft = { deviceId: M.Id; externalPort: string; internalPort: string; protocol: M.Protocol };

/**
 * Every forward check: port bounds, matching range lengths, the range
 * capability, overlap with other forwards (same protocol, overlapping
 * external ports; `self` is excluded) and that the device has, or can get, a
 * reservation. Returns the address the forward goes to (null when a new
 * reservation is needed).
 */
function checkForward(j: Joined & { network: M.Network }, draft: ForwardDraft, self: M.Id | null): ForwardCheck & { ip: string | null; device: M.Device | undefined } {
  const issues: Issue[] = [];
  const device = j.devices.find((d) => d.id === draft.deviceId);
  const ext = parsePorts(draft.externalPort);
  const int = parsePorts(draft.internalPort);
  if (typeof ext === "string") issues.push({ field: "externalPort", message: ext });
  // An internal port left out is the external one: one message, under the external field.
  if (typeof int === "string" && draft.internalPort !== draft.externalPort) issues.push({ field: "internalPort", message: int });
  if (typeof ext !== "string" && typeof int !== "string") {
    const ranged = ext.end > ext.start || int.end > int.start;
    if (ranged && j.network.capabilities.port_forward_range !== true) {
      issues.push({ field: ext.end > ext.start ? "externalPort" : "internalPort", message: "This network takes single ports only, not ranges." });
    } else if (int.start !== int.end && int.end - int.start !== ext.end - ext.start) {
      issues.push({ field: "internalPort", message: "The internal range must be as long as the external range." });
    } else if (ext.start !== ext.end && int.start === int.end && int.start !== ext.start) {
      issues.push({ field: "internalPort", message: "A range forwards to the same range, or a range as long." });
    }
    for (const f of j.routing.forwards) {
      if (f.id === self || !sharesProtocol(f.protocol, draft.protocol)) continue;
      const other = parsePorts(f.externalPort);
      if (typeof other !== "string" && overlaps(ext, other)) {
        const to = deviceName(j, f.deviceId) ?? f.ip;
        issues.push({ field: "externalPort", message: `Port ${portText(other)} is already forwarded${to ? ` to ${to}` : ""}${f.name ? ` (${f.name})` : ""}.` });
        break;
      }
    }
  }
  const reservation = j.routing.reservations.find((r) => r.deviceId === draft.deviceId || (device && compact(r.mac) === compact(device.mac)));
  let needsReservation = false;
  if (!device) issues.push({ field: "device", message: "That device is not on this network." });
  else if (!reservation) {
    needsReservation = true;
    if (device.ssid === "guest") issues.push({ field: "device", message: `${device.name} is on the guest network, which has no port forwards.` });
    else if (!device.ipv4) issues.push({ field: "device", message: `${device.name} has no IPv4 address to reserve. Reserve one first.` });
    else {
      const bad = addressIssues(j, device.ipv4, device.mac, null)[0];
      if (bad) issues.push({ field: "device", message: `Can't reserve ${device.ipv4} for ${device.name}: ${bad.message}` });
    }
  }
  return { ok: issues.length === 0, issues, needsReservation, ip: reservation?.ip ?? null, device };
}

/** Reserves the device's current address for a forward, when it has no reservation. */
async function reserveFor(ctx: CommandContext, device: M.Device): Promise<M.Reservation> {
  const made = await ctx.backend.routing.addReservation(ctx.net, { mac: device.mac, ip: device.ipv4 ?? "", description: device.name });
  return { ...made, deviceId: made.deviceId ?? device.id };
}

const forwardFields = {
  externalPort: portParam,
  internalPort: portParam.optional().describe("Default: the same as externalPort."),
  protocol: protocolParam,
};

commands.push(
  defineCommand({
    id: "reservation.add",
    label: "Add a reservation",
    description:
      "Gives a device the same IPv4 address every time. Name the device or its MAC; without an address, its current one (when free) or the first free address in the static range.",
    icon: "bookmark-plus",
    effect: "write",
    gate: GATE,
    invalidates: [...WRITES],
    params: z.object({
      device: ref("device").optional().describe("The device to reserve for (id, exact name or MAC). Give this or mac."),
      mac: z.string().trim().min(1).optional().describe("A MAC address, for a device eero has not seen. Give this or device."),
      ip: ipParam.optional(),
      description: descriptionParam.optional(),
    }),
    run: async (ctx, p): Promise<M.Reservation> => {
      if ((p.device === undefined) === (p.mac === undefined)) fail([{ field: "device", message: "Give a device or a MAC address, not both." }]);
      const j = await forWrite(ctx);
      let device: M.Device | undefined;
      let mac: string;
      if (p.device !== undefined) {
        const id = await ctx.resolve("device", p.device);
        device = j.devices.find((d) => d.id === id);
        mac = normalMac(device?.mac ?? "") ?? device?.mac ?? "";
      } else {
        mac = normalMac(p.mac ?? "") ?? fail([{ field: "mac", message: "Enter a MAC address like 0a:1b:2c:3d:4e:5f." }]);
        device = j.devices.find((d) => compact(d.mac) === compact(mac));
      }
      const field = p.device !== undefined ? "device" : "mac";
      const existing = j.routing.reservations.find((r) => compact(r.mac) === compact(mac));
      if (existing) fail([{ field, message: `${device?.name ?? mac} already has a reservation (${existing.ip}). Edit that one instead.` }]);
      if (device?.ssid === "guest") fail([{ field, message: `${device.name} is on the guest network, which has no reservations.` }]);
      const ip = p.ip ?? suggestAddress(j, mac, device?.ipv4 ?? null) ?? fail([{ field: "ip", message: "No free address in the static range. Enter one." }]);
      const issues = addressIssues(j, ip, mac, null);
      if (issues.length) fail(issues);
      const made = await ctx.backend.routing.addReservation(ctx.net, { mac, ip, description: p.description ?? device?.name ?? "" });
      return { ...made, deviceId: made.deviceId ?? device?.id ?? null };
    },
  }),

  defineCommand({
    id: "reservation.update",
    label: "Edit reservation",
    description: "Changes a reservation's address or description. Port forwards on the old address follow it.",
    icon: "pencil",
    effect: "write",
    gate: GATE,
    invalidates: [...WRITES],
    params: z.object({
      reservation: ref("reservation").describe("The reservation: id, MAC, IP, description or its device's name."),
      ip: ipParam.optional(),
      description: descriptionParam.optional(),
    }),
    run: async (ctx, p): Promise<M.Reservation> => {
      const j = await forWrite(ctx);
      const r = findReservation(ctx, j, p.reservation);
      if (p.ip !== undefined && p.ip !== r.ip) {
        const issues = addressIssues(j, p.ip, r.mac, r.id);
        if (issues.length) fail(issues);
      }
      const saved = await ctx.backend.routing.updateReservation(ctx.net, r.id, {
        ...(p.ip !== undefined ? { ip: p.ip } : {}),
        ...(p.description !== undefined ? { description: p.description } : {}),
      });
      return { ...saved, deviceId: saved.deviceId ?? r.deviceId };
    },
  }),

  defineCommand({
    id: "reservation.remove",
    label: "Remove reservation",
    description: "Removes a reservation; the device takes a DHCP address next time it joins. With removeForwards, also removes the port forwards on that address.",
    icon: "trash",
    effect: "write",
    gate: GATE,
    invalidates: [...WRITES],
    params: z.object({
      reservation: ref("reservation").describe("The reservation: id, MAC, IP, description or its device's name."),
      removeForwards: z.boolean().optional().describe("Also remove the port forwards on this address. Default false."),
    }),
    run: async (ctx, p): Promise<ReservationRemoved> => {
      const j = await forWrite(ctx);
      const r = findReservation(ctx, j, p.reservation);
      const removeForwards = p.removeForwards === true;
      await ctx.backend.routing.removeReservation(ctx.net, r.id, removeForwards);
      const removedForwards = removeForwards ? j.routing.forwards.filter((f) => f.ip === r.ip) : [];
      return { reservation: r, removedForwards };
    },
  }),

  defineCommand({
    id: "forward.validate",
    label: "Check port forward",
    description:
      "Runs the checks forward.add and forward.update run, without saving: port bounds, ranges, overlap with other forwards and whether the device needs a reservation. Pass forward when editing one.",
    icon: "check",
    effect: "query",
    topic: "routing",
    params: z.object({
      device: ref("device"),
      ...forwardFields,
      forward: ref("forward").optional().describe("The forward being edited, left out of the overlap check."),
    }),
    run: async (ctx, p): Promise<ForwardCheck> => {
      const j = await forWrite(ctx);
      const deviceId = await ctx.resolve("device", p.device);
      const self = p.forward === undefined ? null : findForward(ctx, j, p.forward).id;
      const { ok, issues, needsReservation } = checkForward(j, { deviceId, externalPort: p.externalPort, internalPort: p.internalPort ?? p.externalPort, protocol: p.protocol }, self);
      return { ok, issues, needsReservation };
    },
  }),

  defineCommand({
    id: "forward.add",
    label: "Add port forward",
    description:
      "Opens a port or range on the internet side to one device. Reserves the device's current address first when it has no reservation. Ranges need the port_forward_range capability.",
    icon: "plus",
    effect: "write",
    gate: GATE,
    invalidates: [...WRITES],
    params: z.object({
      device: ref("device"),
      ...forwardFields,
      description: descriptionParam.min(1, "Give the forward a name."),
      enabled: z.boolean().optional().describe("Default true."),
    }),
    run: async (ctx, p): Promise<ForwardAdded> => {
      const j = await forWrite(ctx);
      const deviceId = await ctx.resolve("device", p.device);
      const internalPort = p.internalPort ?? p.externalPort;
      const check = checkForward(j, { deviceId, externalPort: p.externalPort, internalPort, protocol: p.protocol }, null);
      if (!check.ok) fail(check.issues);
      const reservation = check.needsReservation && check.device ? await reserveFor(ctx, check.device) : null;
      const ip = reservation?.ip ?? check.ip ?? "";
      const input: ForwardInput = { ip, externalPort: p.externalPort, internalPort, protocol: p.protocol, description: p.description, enabled: p.enabled ?? true };
      const forward = await ctx.backend.routing.addForward(ctx.net, input);
      return { forward: { ...forward, deviceId: forward.deviceId ?? deviceId }, reservation };
    },
  }),

  defineCommand({
    id: "forward.update",
    label: "Edit port forward",
    description: "Changes a port forward: its device, ports, protocol, name, or turns it on or off. Runs the same checks as forward.add.",
    icon: "pencil",
    effect: "write",
    gate: GATE,
    invalidates: [...WRITES],
    params: z.object({
      forward: ref("forward").describe("The forward: id or exact name."),
      device: ref("device").optional(),
      externalPort: portParam.optional(),
      internalPort: portParam.optional(),
      protocol: protocolParam.optional(),
      description: descriptionParam.min(1, "Give the forward a name.").optional(),
      enabled: z.boolean().optional(),
    }),
    run: async (ctx, p): Promise<M.Forward> => {
      const j = await forWrite(ctx);
      const f = findForward(ctx, j, p.forward);
      const deviceId = p.device === undefined ? f.deviceId : await ctx.resolve("device", p.device);
      const externalPort = p.externalPort ?? f.externalPort;
      // A new external port without an internal one keeps them equal when they were.
      const internalPort = p.internalPort ?? (p.externalPort !== undefined && f.internalPort === f.externalPort ? p.externalPort : f.internalPort);
      const protocol = p.protocol ?? f.protocol;
      const routed = p.device !== undefined || p.externalPort !== undefined || p.internalPort !== undefined || p.protocol !== undefined;
      let ip = f.ip;
      if (routed) {
        if (deviceId === null) fail([{ field: "device", message: "This forward has no device. Pick one." }]);
        const check = checkForward(j, { deviceId: deviceId as M.Id, externalPort, internalPort, protocol }, f.id);
        if (!check.ok) fail(check.issues);
        const reservation = check.needsReservation && check.device ? await reserveFor(ctx, check.device) : null;
        ip = reservation?.ip ?? check.ip ?? f.ip;
      }
      const input: ForwardInput = { ip, externalPort, internalPort, protocol, description: p.description ?? f.name, enabled: p.enabled ?? f.enabled };
      const saved = await ctx.backend.routing.updateForward(ctx.net, f.id, input);
      return { ...saved, deviceId: saved.deviceId ?? deviceId };
    },
  }),

  defineCommand({
    id: "forward.remove",
    label: "Remove port forward",
    description: "Closes a port forward. The device keeps its reservation.",
    icon: "trash",
    effect: "write",
    gate: GATE,
    invalidates: [...WRITES],
    params: z.object({ forward: ref("forward").describe("The forward: id or exact name.") }),
    run: async (ctx, p): Promise<M.Forward> => {
      const j = await forWrite(ctx);
      const f = findForward(ctx, j, p.forward);
      await ctx.backend.routing.removeForward(ctx.net, f.id);
      return f;
    },
  }),

  defineCommand({
    id: "pinhole.add",
    label: "Add IPv6 rule",
    description: "Opens a port or range through the IPv6 firewall to one device.",
    icon: "shield-plus",
    effect: "write",
    gate: GATE,
    invalidates: [...WRITES],
    params: z.object({ device: ref("device"), protocol: protocolParam, port: portParam }),
    run: async (ctx, p): Promise<M.Pinhole> => {
      const j = await forWrite(ctx);
      const deviceId = await ctx.resolve("device", p.device);
      const device = j.devices.find((d) => d.id === deviceId);
      const ports = parsePorts(p.port);
      if (typeof ports === "string") fail([{ field: "port", message: ports }]);
      if (device?.ssid === "guest") fail([{ field: "device", message: `${device.name} is on the guest network, which has no IPv6 rules.` }]);
      const range = ports as { start: number; end: number };
      const same = j.routing.pinholes.find((x) => {
        const other = parsePorts(x.port);
        return x.deviceId === deviceId && sharesProtocol(x.protocol, p.protocol) && typeof other !== "string" && overlaps(range, other);
      });
      if (same) fail([{ field: "port", message: `Port ${same.port} is already open to ${device?.name ?? "this device"}.` }]);
      return ctx.backend.routing.addPinhole(ctx.net, { deviceId, protocol: p.protocol, port: portText(range) });
    },
  }),

  defineCommand({
    id: "pinhole.remove",
    label: "Remove IPv6 rule",
    description: "Closes an IPv6 pinhole.",
    icon: "trash",
    effect: "write",
    gate: GATE,
    invalidates: [...WRITES],
    params: z.object({ pinhole: ref("pinhole").describe("The rule: its id, or device name and port (TV:443).") }),
    run: async (ctx, p): Promise<M.Pinhole> => {
      const j = await forWrite(ctx);
      const ph = findPinhole(ctx, j, p.pinhole);
      await ctx.backend.routing.removePinhole(ctx.net, ph.id);
      return ph;
    },
  }),
);
