/**
 * routing commands (read side): DHCP reservations with the LAN map, and port
 * forwards. Both read the backend's one `GET {net}/routing` under the
 * `routing` cache topic, join rows to devices by MAC and IP here in core, and
 * answer empty lists with a reason in bridge or IP passthrough mode, where
 * eero turns routing off. See docs/architecture/commands.md#routing-commandsroutingts.
 */

import { z } from "zod";
import type * as M from "../model";
import { type AnyCommand, type CommandContext, defineCommand, ref } from "../spec";

/** Result of reservation.list. `unavailable` says why the lists are empty (bridge mode); null otherwise. */
export type ReservationList = { reservations: M.Reservation[]; lan: M.LanMap | null; unavailable: string | null };

/** Result of forward.list. */
export type ForwardList = { forwards: M.Forward[]; unavailable: string | null };

/** An IPv4 address as a number, or null. */
const ipNum = (ip: string): number | null => {
  const p = ip.split(".").map(Number);
  return p.length === 4 && p.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? p.reduce((a, n) => a * 256 + n, 0) : null;
};

const compact = (mac: string) => mac.toLowerCase().replace(/[^0-9a-f]/g, "");

/** Why routing is off for this network, or null when it is on. */
/** Whether a device holds a DHCP lease from the pool (`inPool` tests its IPv4). */
function isLeased(d: M.Device, inPool: (ip: string | null) => boolean, reserved: Set<M.Id>): boolean {
  return d.connected && !d.blocked && d.ssid !== "guest" && inPool(d.ipv4) && !reserved.has(d.id);
}

export function routingUnavailable(mode: M.ConnectionMode | null): string | null {
  if (mode === "bridged") return "Reservations and port forwards are off while the network is in bridge mode.";
  if (mode === "ipPassthrough") return "Reservations and port forwards are off while the network is in IP passthrough mode.";
  return null;
}

type Joined = { routing: M.Routing; unavailable: string | null; devices: M.Device[] };

/**
 * The routing lists joined to devices: a reservation without a device id
 * takes the device with its MAC, a forward without one takes its
 * reservation's device (by IP), and the pool's leased count is the connected,
 * unblocked main-network devices with an IPv4 address inside the pool and no
 * reservation. This is the only place leases are counted; backends report
 * `pool.leased` as 0. `blocked` is the same flag device.list reports.
 */
async function joined(ctx: CommandContext): Promise<Joined> {
  const network = await ctx.backend.network.get(ctx.net);
  const unavailable = routingUnavailable(network.connectionMode);
  if (unavailable) return { routing: { reservations: [], forwards: [], pinholes: [], lan: null }, unavailable, devices: [] };
  const [routing, devices] = await Promise.all([ctx.backend.routing.get(ctx.net), ctx.backend.device.list(ctx.net)]);
  const byMac = new Map(devices.map((d) => [compact(d.mac), d.id]));
  const reservations = routing.reservations.map((r) => ({ ...r, deviceId: r.deviceId ?? byMac.get(compact(r.mac)) ?? null }));
  const byIp = new Map(reservations.map((r) => [r.ip, r]));
  const forwards = routing.forwards.map((f) => ({ ...f, deviceId: f.deviceId ?? byIp.get(f.ip)?.deviceId ?? null }));
  for (const r of reservations) r.forwards = forwards.filter((f) => f.ip === r.ip || (r.deviceId !== null && f.deviceId === r.deviceId)).length;
  const reserved = new Set(reservations.map((r) => r.deviceId).filter((id): id is M.Id => id !== null));
  let lan = routing.lan;
  if (lan) {
    const start = ipNum(lan.pool.start);
    const end = ipNum(lan.pool.end);
    // A lease is a main-network address inside the pool; guests use their own subnet, static addresses sit outside it.
    const inPool = (ip: string | null) => {
      const n = ip ? ipNum(ip) : null;
      return n !== null && start !== null && end !== null && n >= start && n <= end;
    };
    const leased = devices.filter((d) => isLeased(d, inPool, reserved)).length;
    lan = { ...lan, pool: { ...lan.pool, leased } };
  }
  return { routing: { ...routing, reservations, forwards, lan }, unavailable, devices };
}

const byName = <T extends { name: string; id: M.Id }>(a: T, b: T) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || a.id.localeCompare(b.id);

/** By external port, then name: the order the device page lists them. */
const portStart = (p: string) => Number.parseInt(p, 10) || 0;
const byPort = (a: M.Forward, b: M.Forward) => portStart(a.externalPort) - portStart(b.externalPort) || byName(a, b);


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
      const { routing, unavailable } = await joined(ctx);
      return { reservations: [...routing.reservations].sort(byName), lan: routing.lan, unavailable };
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
];
