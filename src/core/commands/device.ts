/**
 * device commands (read side and live rates). Filtering, search, sort and
 * the summary are applied here, in core, so the UI, CLI and MCP share one
 * implementation. See docs/architecture/commands.md#device-commandsdevicets
 * and docs/architecture/engine.md#live-device-rates.
 */

import { z } from "zod";
import type { Backend } from "../backend";
import { toCsv } from "../format";
import type * as M from "../model";
import { BURST_COOLDOWN_SEC, BURST_SETTLE_SEC, POLL, RATES_STALE_SEC } from "../poll";
import { type AnyCommand, type CommandContext, defineCommand, ref } from "../spec";
import { usageWindow } from "./usage";

const DAY_MS = 86_400_000;
/** eero drops offline devices after about a week; so does the list. */
const OFFLINE_KEEP_MS = 7 * DAY_MS;

const BANDS = ["2.4", "5", "6", "wired"] as const;
const CATEGORIES = ["phones_tablets", "computers", "entertainment", "smart_home", "other"] as const;

export const deviceListParams = z.object({
  status: z.enum(["online", "offline", "paused", "blocked"]).optional().describe("online: connected (paused included); offline: not connected and not blocked."),
  connected: z.boolean().optional(),
  paused: z.boolean().optional(),
  blocked: z.boolean().optional(),
  ssid: z.enum(["main", "guest"]).optional(),
  eero: ref("eero").optional().describe("Only devices on this eero (id or exact location)."),
  profile: ref("profile").nullable().optional().describe("A profile id or exact name; null lists devices with no profile (Unassigned)."),
  band: z.enum(BANDS).optional(),
  type: z.enum(CATEGORIES).optional().describe("Device category."),
  manufacturer: z.string().trim().min(1).optional().describe("Exact manufacturer, case-insensitive."),
  firstSeenSince: z.iso.datetime({ offset: true }).optional().describe("Only devices first seen at or after this ISO time."),
  search: z.string().trim().max(100).optional().describe("Matches name, hostname, manufacturer, model, MAC (with or without colons) or IP."),
  sort: z.enum(["name", "usage", "rate", "last_seen"]).optional().describe("Default name, A to Z. usage: data used in the last 24 h (the usage.breakdown day window); rate: live rate; last_seen: most recent first."),
  limit: z.number().int().min(1).max(500).optional(),
  format: z.enum(["json", "csv"]).optional(),
});

type ListParams = z.output<typeof deviceListParams>;

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const hex = (s: string) => s.toLowerCase().replace(/[^0-9a-f]/g, "");

/** Rates older than RATES_STALE_SEC read as missing, never as old numbers. */
function fresh(d: M.Device, now: number): M.Device {
  if (!d.rates) return d;
  const at = Date.parse(d.rates.at);
  return Number.isFinite(at) && now - at <= RATES_STALE_SEC * 1000 ? d : { ...d, rates: null };
}

/**
 * Drops offline devices eero would have aged out; blocked ones stay. This is
 * the device.list population, so summary.total and network.get's
 * counts.devices (the sidebar count) are the same number.
 */
export function knownDevices(devices: M.Device[], now: number): M.Device[] {
  return devices.filter((d) => {
    if (d.connected || d.blocked || !d.lastActive) return true;
    const at = Date.parse(d.lastActive);
    return !Number.isFinite(at) || now - at <= OFFLINE_KEEP_MS;
  });
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Counts per key, largest first, then by key with null last; every device counted once. */
function countBy<K extends string | null>(devices: M.Device[], key: (d: M.Device) => K): { key: K; count: number }[] {
  const counts = new Map<K, number>();
  for (const d of devices) counts.set(key(d), (counts.get(key(d)) ?? 0) + 1);
  return [...counts]
    .map(([k, count]) => ({ key: k, count }))
    .sort((a, b) => b.count - a.count || (a.key === null ? 1 : b.key === null ? -1 : a.key.localeCompare(b.key)));
}

export function summarize(devices: M.Device[], now: number): M.DeviceSummary {
  const byBand = Object.fromEntries(BANDS.map((b) => [b, 0])) as Record<M.Band, number>;
  const byCategory = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<M.DeviceCategory, number>;
  const bandRates = Object.fromEntries(BANDS.map((b) => [b, { down: 0, up: 0 }])) as Record<M.Band, { down: number; up: number }>;
  let down = 0;
  let up = 0;
  let active = 0;
  let latest: number | null = null;
  for (const d of devices) {
    byCategory[d.category] = (byCategory[d.category] ?? 0) + 1;
    if (d.connected && d.band) byBand[d.band] += 1;
    if (d.rates) {
      down += d.rates.downMbps;
      up += d.rates.upMbps;
      if (d.connected && d.band) {
        bandRates[d.band].down += d.rates.downMbps;
        bandRates[d.band].up += d.rates.upMbps;
      }
      if (d.rates.downMbps + d.rates.upMbps > 0) active++;
      const at = Date.parse(d.rates.at);
      if (Number.isFinite(at)) latest = Math.max(latest ?? at, at);
    }
  }
  const newThisWeek = devices
    .filter((d) => d.firstSeen && now - Date.parse(d.firstSeen) <= 7 * DAY_MS)
    .sort((a, b) => Date.parse(b.firstSeen ?? "") - Date.parse(a.firstSeen ?? ""))
    .map((d) => d.id);
  return {
    total: devices.length,
    online: devices.filter((d) => d.connected).length,
    offline: devices.filter((d) => !d.connected && !d.blocked).length,
    paused: devices.filter((d) => d.paused).length,
    blocked: devices.filter((d) => d.blocked).length,
    byBand,
    byCategory,
    byEero: countBy(devices, (d) => d.eeroId).map(({ key, count }) => ({ eeroId: key, count })),
    byProfile: countBy(devices, (d) => d.profileId).map(({ key, count }) => ({ profileId: key, count })),
    byManufacturer: countBy(devices, (d) => d.manufacturer?.trim() || null).map(({ key, count }) => ({ manufacturer: key, count })),
    newThisWeek,
    rates: latest === null ? null : { downMbps: round1(down), upMbps: round1(up), active, at: new Date(latest).toISOString(), ...bandShares(byBand, bandRates) },
  };
}

/**
 * Per-band rate totals and shares of all traffic and of connected devices,
 * plus the Wi-Fi band carrying the most traffic (wired is left out of the
 * pick: the insight line is about how Wi-Fi bands share the load).
 */
function bandShares(counts: Record<M.Band, number>, rates: Record<M.Band, { down: number; up: number }>): Pick<M.DeviceRateTotals, "byBand" | "topBand"> {
  const traffic = BANDS.reduce((s, b) => s + rates[b].down + rates[b].up, 0);
  const connected = BANDS.reduce((s, b) => s + counts[b], 0);
  const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 1000) / 10 : null);
  let topBand: M.DeviceRateTotals["topBand"] = null;
  for (const b of BANDS) {
    if (b === "wired") continue;
    const t = rates[b].down + rates[b].up;
    if (t > 0 && (topBand === null || t > rates[topBand].down + rates[topBand].up)) topBand = b;
  }
  const byBand = Object.fromEntries(
    BANDS.map((b) => [b, { downMbps: round1(rates[b].down), upMbps: round1(rates[b].up), trafficPct: pct(rates[b].down + rates[b].up, traffic), devicePct: pct(counts[b], connected) }]),
  ) as M.DeviceRateTotals["byBand"];
  return { byBand, topBand };
}

function matchesSearch(d: M.Device, q: string): boolean {
  const want = norm(q);
  if (!want) return true;
  if ([d.name, d.nickname, d.hostname, d.manufacturer, d.model, d.mac, d.ipv4, ...d.ipv6].some((v) => norm(v).includes(want))) return true;
  // A MAC typed with other separators, or none: "0a1b2c", "0a-1b-2c".
  return /^[0-9a-f:\-.]+$/.test(want) && hex(want).length >= 4 && hex(d.mac).includes(hex(want));
}

async function filter(ctx: CommandContext, devices: M.Device[], p: ListParams): Promise<M.Device[]> {
  const eeroId = p.eero === undefined ? undefined : await ctx.resolve("eero", p.eero);
  const profileId = p.profile === undefined ? undefined : p.profile === null ? null : await ctx.resolve("profile", p.profile);
  const since = p.firstSeenSince ? Date.parse(p.firstSeenSince) : null;
  return devices.filter((d) => {
    if (p.status === "online" && !d.connected) return false;
    if (p.status === "offline" && (d.connected || d.blocked)) return false;
    if (p.status === "paused" && !d.paused) return false;
    if (p.status === "blocked" && !d.blocked) return false;
    if (p.connected !== undefined && d.connected !== p.connected) return false;
    if (p.paused !== undefined && d.paused !== p.paused) return false;
    if (p.blocked !== undefined && d.blocked !== p.blocked) return false;
    if (p.ssid && d.ssid !== p.ssid) return false;
    if (eeroId !== undefined && d.eeroId !== eeroId) return false;
    if (profileId !== undefined && d.profileId !== profileId) return false;
    if (p.band && d.band !== p.band) return false;
    if (p.type && d.category !== p.type) return false;
    if (p.manufacturer && norm(d.manufacturer) !== norm(p.manufacturer)) return false;
    if (since !== null && !(d.firstSeen && Date.parse(d.firstSeen) >= since)) return false;
    if (p.search && !matchesSearch(d, p.search)) return false;
    return true;
  });
}

const byName = (a: M.Device, b: M.Device) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || a.id.localeCompare(b.id);

/** Bytes per device over the same day window as usage.breakdown, for sort "usage". */
async function usageByDevice(ctx: CommandContext): Promise<Map<M.Id, number>> {
  const tz = (await ctx.backend.network.get(ctx.net)).timezone ?? "UTC";
  const w = usageWindow("day", undefined, ctx.now(), tz);
  const b = await ctx.backend.usage.breakdown(ctx.net, { by: "device", range: "day", from: new Date(w.from).toISOString(), to: new Date(w.to).toISOString() });
  return new Map(b.rows.flatMap((r) => (r.id ? [[r.id, r.down + r.up] as const] : [])));
}

async function sort(ctx: CommandContext, devices: M.Device[], by: ListParams["sort"]): Promise<M.Device[]> {
  const out = [...devices];
  switch (by) {
    case "rate": {
      const rate = (d: M.Device) => (d.rates ? d.rates.downMbps + d.rates.upMbps : -1);
      return out.sort((a, b) => rate(b) - rate(a) || byName(a, b));
    }
    case "last_seen": {
      const seen = (d: M.Device) => (d.connected ? Number.POSITIVE_INFINITY : d.lastActive ? Date.parse(d.lastActive) : Number.NEGATIVE_INFINITY);
      return out.sort((a, b) => seen(b) - seen(a) || byName(a, b));
    }
    case "usage": {
      const used = await usageByDevice(ctx);
      return out.sort((a, b) => (used.get(b.id) ?? 0) - (used.get(a.id) ?? 0) || byName(a, b));
    }
    default:
      return out.sort(byName);
  }
}

/**
 * eero's own Unassigned group is a profile flagged `default` that the
 * backend's profile list leaves out (eero/backend/profile.ts). On a real
 * network every device without a person's profile points at it, so a
 * profile id the list does not have means Unassigned: `profileId: null`.
 * The same rule as profile.list's Unassigned summary. No profiles readable
 * (bridge mode, an error): the devices are returned as they are.
 */
async function withUnassigned<T extends Pick<M.Device, "profileId">>(ctx: CommandContext, devices: T[]): Promise<T[]> {
  if (!devices.some((d) => d.profileId)) return devices;
  let listed: Set<M.Id>;
  try {
    listed = new Set((await ctx.backend.profile.list(ctx.net)).map((p) => p.id));
  } catch {
    return devices;
  }
  return devices.map((d) => (d.profileId && !listed.has(d.profileId) ? { ...d, profileId: null } : d));
}

const statusLabel = (d: M.Device) => (d.blocked ? "Blocked" : d.paused ? "Paused" : d.connected ? "Online" : "Offline");
const bandLabel = (b: M.Band | null) => (b === null ? null : b === "wired" ? "Wired" : `${b} GHz`);

async function toDeviceCsv(ctx: CommandContext, devices: M.Device[]): Promise<string> {
  const [eeros, profiles] = await Promise.all([ctx.backend.eero.list(ctx.net), ctx.backend.profile.list(ctx.net)]);
  const eeroName = new Map(eeros.map((e) => [e.id, e.location]));
  const profileName = new Map(profiles.map((p) => [p.id, p.name]));
  return toCsv(devices, [
    { header: "Name", value: (d) => d.name },
    { header: "Status", value: statusLabel },
    { header: "Connected to", value: (d) => (d.eeroId ? (eeroName.get(d.eeroId) ?? d.eeroId) : null) },
    { header: "Band", value: (d) => bandLabel(d.band) },
    { header: "Network", value: (d) => d.ssid },
    { header: "IP", value: (d) => d.ipv4 },
    { header: "MAC", value: (d) => d.mac },
    { header: "Profile", value: (d) => (d.profileId ? (profileName.get(d.profileId) ?? d.profileId) : "Unassigned") },
    { header: "Manufacturer", value: (d) => d.manufacturer },
    { header: "Model", value: (d) => d.model },
    { header: "Category", value: (d) => d.category },
    { header: "Down Mbps", value: (d) => d.rates?.downMbps },
    { header: "Up Mbps", value: (d) => d.rates?.upMbps },
    { header: "Last active", value: (d) => d.lastActive },
    { header: "First seen", value: (d) => d.firstSeen },
  ]);
}

// ---------------------------------------------------------------------------
// Burst reporter: once a minute per network, remembered per backend.

type Burst = { requestedAt: number; nextBurstAt: M.Iso };
const bursts = new WeakMap<Backend, Map<M.Id, Burst>>();

async function refreshRates(ctx: CommandContext): Promise<M.BurstResult> {
  let perNet = bursts.get(ctx.backend);
  if (!perNet) bursts.set(ctx.backend, (perNet = new Map()));
  const now = ctx.now();
  const last = perNet.get(ctx.net);
  // eero allows one burst per minute; inside it, answer the pending one without calling eero.
  if (last && now - last.requestedAt < BURST_COOLDOWN_SEC * 1000) return { nextBurstAt: last.nextBurstAt };
  const result = await ctx.backend.device.requestBurst(ctx.net);
  perNet.set(ctx.net, { requestedAt: now, nextBurstAt: result.nextBurstAt });
  const due = Date.parse(result.nextBurstAt);
  // Cached device reads go stale once the fresh rates are in.
  ctx.invalidate(["devices"], (Number.isFinite(due) ? due : now) + BURST_SETTLE_SEC * 1000);
  return { nextBurstAt: result.nextBurstAt };
}

// ---------------------------------------------------------------------------

export const commands: AnyCommand[] = [
  defineCommand({
    id: "device.list",
    label: "Devices",
    description:
      "Lists devices with filters, search and sort, plus a summary of the whole network (counts by status, band and category, devices new this week, live rate totals). Offline devices older than 7 days are left out.",
    icon: "laptop",
    effect: "query",
    topic: "devices",
    poll: POLL.devices,
    params: deviceListParams,
    run: async (ctx, p): Promise<M.DeviceList | string> => {
      const now = ctx.now();
      const all = (await withUnassigned(ctx, knownDevices(await ctx.backend.device.list(ctx.net), now))).map((d) => fresh(d, now));
      let devices = await sort(ctx, await filter(ctx, all, p), p.sort);
      if (p.limit) devices = devices.slice(0, p.limit);
      if (p.format === "csv") return toDeviceCsv(ctx, devices);
      return { devices, summary: summarize(all, now) };
    },
  }),

  defineCommand({
    id: "device.get",
    label: "Device",
    description: "One device with connection details (eero, band, signal, link rates), its profile and its IP reservation.",
    icon: "laptop",
    effect: "query",
    topic: "devices",
    poll: POLL.devices,
    params: z.object({ device: ref("device") }),
    run: async (ctx, p): Promise<M.Device> => {
      const [d] = await withUnassigned(ctx, [await ctx.backend.device.get(ctx.net, await ctx.resolve("device", p.device))]);
      return fresh(d as M.Device, ctx.now());
    },
  }),

  defineCommand({
    id: "device.rates.refresh",
    label: "Refresh live rates",
    description:
      "Asks eero for fresh per-device rates (about 12 s later device.list has them). At most once a minute per network; a second call inside the minute returns the pending time without calling eero.",
    icon: "activity",
    effect: "write",
    poll: POLL.rates,
    params: z.object({}),
    run: (ctx): Promise<M.BurstResult> => refreshRates(ctx),
  }),
];
