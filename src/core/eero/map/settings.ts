/**
 * Raw eero network settings to the model. Most fields are on the network
 * object (`GET {net}`); fast roaming, power saving schedules, Thread and
 * legacy mode have their own reads. Thread secrets (`master_key`,
 * `commissioning_credential`, any dataset) are read only by
 * `threadCredentials`; `mapSettings` never touches them. Integrations are
 * all on the network object too (`GET {net}/proxied_nodes` is a 404 on a
 * real network). Shapes: docs/eero-api/endpoints.md section 17.
 */

import type * as M from "../../model";
import type { RawAcCompat, RawFastTransition, RawNetwork, RawPowerSavingSchedule, RawThread } from "../raw";
import { mapLan } from "./routing";

const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && s.trim() !== "") : []);

/** "255.255.252.0" for a /22. */
export function prefixMask(bits: number): string {
  const n = bits <= 0 ? 0 : (0xffffffff << (32 - Math.min(32, bits))) >>> 0;
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
}

export function connectionMode(v: unknown): M.ConnectionMode | null {
  if (v === "nat" || v === "bridged" || v === "ipPassthrough") return v;
  if (typeof v !== "string") return null;
  const s = v.toLowerCase().replace(/[^a-z]/g, "");
  if (s === "bridge" || s === "bridged") return "bridged";
  if (s === "ippassthrough" || s === "passthrough") return "ipPassthrough";
  if (s === "nat" || s === "router") return "nat";
  return null;
}

/** eero sends `mlo_mode` only on Wi-Fi 7 networks; anything unknown reads as not supported. */
export function mloMode(v: unknown): M.NetworkSettings["mlo"] {
  if (typeof v !== "string") return null;
  const s = v.toLowerCase();
  if (s.includes("disable") || s === "off" || s === "none") return "disabled";
  if (s.includes("multi")) return "multi";
  if (s.includes("single")) return "single";
  return null;
}

/** `auto_setup_mode` is a string; eero's values are not documented, so only clear on and off words count. */
export function simpleSetup(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v !== "string") return null;
  const s = v.toLowerCase().replace(/[^a-z]/g, "");
  if (s.includes("disab") || s === "off" || s === "false" || s === "manual" || s === "none") return false;
  if (s.includes("enab") || s === "on" || s === "true" || s.startsWith("auto") || s === "wired") return true;
  return null;
}

const DAYS: readonly M.Day[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const DAY_WORDS: Record<string, M.Day> = { monday: "MON", tuesday: "TUE", wednesday: "WED", thursday: "THU", friday: "FRI", saturday: "SAT", sunday: "SUN" };

function day(v: unknown): M.Day | null {
  if (typeof v !== "string") return null;
  const up = v.trim().toUpperCase().slice(0, 3) as M.Day;
  return DAYS.includes(up) ? up : (DAY_WORDS[v.trim().toLowerCase()] ?? null);
}

/** "1:00", "01:00:00" or "01:00" to "01:00"; anything else is null. */
export function hhmm(v: unknown): M.Hhmm | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59) return null;
  return `${String(h % 24).padStart(2, "0")}:${m[2]}`;
}

/** One power saving schedule, or null when eero sent no usable times. */
export function mapPowerSavingSchedule(raw: RawPowerSavingSchedule, index: number): M.Schedule | null {
  const start = hhmm(raw.start_time);
  const end = hhmm(raw.end_time);
  if (!start || !end) return null;
  const fromUrl = typeof raw.url === "string" ? raw.url.split("/").filter(Boolean).pop() : undefined;
  const id = raw.id !== undefined && raw.id !== null ? String(raw.id) : (fromUrl ?? String(index + 1));
  const days = [...new Set((Array.isArray(raw.days) ? raw.days : []).map(day).filter((d): d is M.Day => d !== null))];
  days.sort((a, b) => DAYS.indexOf(a) - DAYS.indexOf(b));
  return { id, name: str(raw.name) ?? "Power saving", days, start, end, enabled: raw.enabled !== false };
}

/** Thread without its secrets. null: this network has no Thread (the read answered 403 or 404). */
export function mapThread(raw: RawThread | null, networkFlag: unknown): M.NetworkSettings["thread"] {
  if (!raw || typeof raw !== "object") return null;
  const ip = str(raw.border_agent?.ip);
  const port = raw.border_agent?.port;
  return {
    enabled: bool(raw.enabled) ?? bool(networkFlag) ?? false,
    credentialSync: bool(raw.enable_credential_syncing),
    name: str(raw.name),
    channel: typeof raw.channel === "number" ? raw.channel : null,
    panId: str(raw.pan_id),
    xpanId: str(raw.xpan_id),
    borderAgent: ip ? (typeof port === "number" ? `${ip}:${port}` : ip) : null,
    // eero does not say how many accessories use Thread.
    devices: null,
  };
}

/** Sensitive: the Thread secrets. Only `settings.thread.credentials` may call this. */
export function mapThreadCredentials(raw: RawThread | null): M.ThreadCredentials | null {
  const key = str(raw?.master_key);
  if (!raw || !key) return null;
  return { networkKey: key, pskc: str(raw.commissioning_credential), dataset: str(raw.active_operational_dataset) };
}

export type SettingsReads = {
  fastTransition: RawFastTransition | null;
  schedules: RawPowerSavingSchedule[];
  thread: RawThread | null;
  acCompat: RawAcCompat | null;
};

function mapDhcp(raw: RawNetwork, bridged: boolean): M.NetworkSettings["dhcp"] {
  if (bridged) return { mode: "bridged", subnetIp: null, subnetMask: null, gateway: null, startIp: null, endIp: null };
  const mode = raw.dhcp?.mode === "custom" ? "custom" : "automatic";
  const lan = mapLan(raw.dhcp);
  if (!lan) return { mode, subnetIp: null, subnetMask: null, gateway: null, startIp: null, endIp: null };
  const [subnetIp, bits] = lan.subnet.split("/");
  return { mode, subnetIp: subnetIp ?? null, subnetMask: bits ? prefixMask(Number(bits)) : null, gateway: lan.gateway, startIp: lan.pool.start, endIp: lan.pool.end };
}

function mapWan(raw: RawNetwork): M.NetworkSettings["wan"] {
  const lease = raw.lease?.mode?.toLowerCase();
  const wanType = typeof raw.wan_type === "string" ? raw.wan_type.toLowerCase() : "";
  const mode: M.NetworkSettings["wan"]["mode"] = raw.pppoe_enabled === true || wanType === "pppoe" ? "pppoe" : lease === "static" || wanType === "static" ? "static" : "dhcp";
  const s = raw.lease?.static as { ip?: unknown; mask?: unknown; subnet_mask?: unknown; router?: unknown; gateway?: unknown } | null | undefined;
  const ip = str(s?.ip);
  const mask = str(s?.mask) ?? str(s?.subnet_mask);
  const router = str(s?.router) ?? str(s?.gateway);
  return {
    mode,
    static: mode === "static" && ip && mask && router ? { ip, mask, router } : null,
    pppoeUsername: mode === "pppoe" ? str(raw.pppoe_username) : null,
    vlan: typeof raw.vlan === "number" && raw.vlan >= 1 && raw.vlan <= 4094 ? raw.vlan : null,
  };
}

/** `NetworkSettings` from the network object and the separate reads. Never reads a Thread secret or the Wi-Fi password. */
export function mapSettings(raw: RawNetwork, reads: SettingsReads): M.NetworkSettings {
  const mode = connectionMode(raw.connection?.mode);
  const bridged = mode === "bridged";
  const dnsCustom = raw.dns?.mode === "custom";
  const v6Custom = raw.ipv6?.name_servers?.mode === "custom";
  return {
    dns: {
      mode: dnsCustom ? "custom" : "automatic",
      servers: dnsCustom ? strings(raw.dns?.custom?.ips) : [],
      ipv6Servers: v6Custom ? strings(raw.ipv6?.name_servers?.custom) : [],
      caching: bool(raw.dns?.caching),
      ispServers: strings(raw.dns?.parent?.ips),
    },
    dhcp: mapDhcp(raw, bridged),
    ipv6: { enabled: bool(raw.ipv6_upstream) },
    wan: mapWan(raw),
    connectionMode: mode,
    natRandomization: bool(raw.nat_port_randomization),
    upnp: bool(raw.upnp),
    sqm: bool(raw.sqm),
    bandSteering: bool(raw.band_steering),
    fastTransition: bool(reads.fastTransition?.fast_transition),
    mlo: mloMode(raw.mlo_mode),
    legacyMode: bool(reads.acCompat?.enabled),
    simpleSetup: simpleSetup(raw.auto_setup_mode),
    powerSaving: {
      enabled: bool(raw.power_saving),
      scheduleEnabled: bool(raw.power_saving_schedule_enabled),
      schedules: reads.schedules.map(mapPowerSavingSchedule).filter((s): s is M.Schedule => s !== null),
    },
    thread: mapThread(reads.thread, raw.thread),
    timezone: str(raw.timezone?.value),
  };
}

// ---------------------------------------------------------------------------
// Integrations

const integration = (available: boolean, enabled: boolean | null, detail: string | null = null): M.Integration => ({
  available,
  enabled: available ? enabled : null,
  detail,
});

const capable = (raw: RawNetwork, ...keys: string[]): boolean | null => {
  for (const k of keys) {
    const c = raw.capabilities?.[k] as { capable?: unknown } | undefined;
    if (typeof c?.capable === "boolean") return c.capable;
  }
  return null;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Each partner feature with `available` and `enabled`, all from `GET {net}`.
 * A field eero leaves out (or sends as null) means unavailable, not an error.
 */
export function mapIntegrations(raw: RawNetwork): M.Integrations {
  const bridged = connectionMode(raw.connection?.mode) === "bridged";
  // eero sends `homekit: null` when it reports no HomeKit here (a real Max 7 network did): unavailable, not an error.
  const homekit =
    raw.homekit && typeof raw.homekit === "object"
      ? integration(true, bool(raw.homekit.enabled))
      : integration(false, null, bridged ? "Not available in bridge mode" : "Not reported for this network's eeros");

  const linked = bool(raw.amazon_account_linked);
  const amazon = linked === null ? integration(false, null) : integration(true, linked, linked ? "Linked to an Amazon account" : "Link in the eero app");

  const nodes = raw.proxied_nodes;
  const devices = Array.isArray(nodes?.devices) ? nodes.devices.length : 0;
  const builtin =
    bridged
      ? integration(false, null, "Not available in bridge mode")
      : nodes && typeof nodes === "object"
        ? integration(true, bool(nodes.enabled), devices > 0 ? `${plural(devices, "Echo extends", "Echos extend")} your network` : null)
        : integration(false, null);

  const hub = capable(raw, "smart_home_hub", "zigbee");
  const smartHomeHub = hub === true ? integration(true, null) : integration(false, null, "Needs an eero with a Zigbee radio");

  const ffs = bool(raw.ffs);
  return {
    homekit,
    amazon,
    builtin,
    smart_home_hub: smartHomeHub,
    ffs: ffs === null ? integration(false, null) : integration(true, ffs),
  };
}
