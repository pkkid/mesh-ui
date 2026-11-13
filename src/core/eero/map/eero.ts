/**
 * Raw eero node to the model `Eero`. Lenient: a missing or odd field gives
 * null, never a throw. Sources: docs/architecture/data-model.md#eeros.
 */

import type * as M from "../../model";
import { type RawEero, type RawFirmwareHistoryEntry, type RawNetwork, type RawPortInterface, linkUrl } from "../raw";
import { compactMac, idFromUrl } from "../urls";
import { speedMbps } from "./device";

type RawRadioStats = { channel?: number; channel_width?: string | number; tx_power?: number; channel_utilization?: number; client_count?: number };

/** Fields beyond raw.ts that the eero mapper reads when eero sends them. */
export type RawEeroFull = RawEero & {
  update_status?: { support_expired?: boolean; support_expiration_date?: string | null } | null;
  ipv6_addresses?: (string | { address?: string })[];
  bssids_with_bands?: { band?: string; ethernet_address?: string }[];
  radio_channel_stats?: Record<string, RawRadioStats | undefined>;
  ethernet_status?: {
    statuses?: { isLeafWiredToUpstream?: boolean; neighbor?: { type?: string; metadata?: { url?: string; location?: string } } }[];
  } | null;
  power_info?: { power_source?: string } | null;
};

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** eero band keys ("band_2_4GHz", "band_5GHz_low", "5", "2.4GHz") to a model band. */
export function bandOf(key: string | null | undefined): M.WirelessBand | null {
  if (!key) return null;
  const k = key.toLowerCase();
  if (k.includes("2_4") || k.includes("2.4")) return "2.4";
  if (/(^|_)6(ghz|$)/.test(k) || k === "6") return "6";
  if (/(^|_)5(ghz|$)/.test(k) || k === "5") return "5";
  return null;
}

export function eeroStatus(raw: Pick<RawEero, "status" | "state" | "heartbeat_ok">): M.Status {
  if (raw.heartbeat_ok === false) return "offline";
  const state = raw.state?.toUpperCase();
  if (state === "UPDATING" || state === "REBOOTING") return "updating";
  switch (raw.status?.toLowerCase()) {
    case "green":
      return "online";
    case "yellow":
      return "degraded";
    case "red":
      return "offline";
    default:
      return state === "ONLINE" ? "online" : state === "OFFLINE" ? "offline" : "unknown";
  }
}

const unique = <T>(xs: T[]): T[] => [...new Set(xs)];

function radios(raw: RawEeroFull): M.Radio[] {
  const out = new Map<M.Band, M.Radio>();
  for (const [key, s] of Object.entries(raw.radio_channel_stats ?? {})) {
    const band = bandOf(key);
    if (!band || !s) continue;
    const prev = out.get(band);
    const clients = num(s.client_count);
    // 5 GHz low and high are one band in the model; client counts add up.
    if (prev) {
      prev.clients = prev.clients === null && clients === null ? null : (prev.clients ?? 0) + (clients ?? 0);
      continue;
    }
    out.set(band, {
      band,
      channel: num(s.channel),
      widthMhz: speedMbps(s.channel_width),
      utilization: num(s.channel_utilization),
      clients,
      txPowerDbm: num(s.tx_power),
      // radio_channel_stats has no auto flag; null until a source is seen (MANUAL, M2.6).
      autoChannel: null,
    });
  }
  return [...out.values()];
}

function nightlight(raw: RawEero): M.Nightlight | null {
  const n = raw.nightlight;
  if (!n) return null;
  const mode: M.Nightlight["mode"] = n.enabled === false ? "off" : n.schedule?.enabled ? "schedule" : "ambient";
  return { mode, brightness: num(n.brightness_percentage), on: str(n.schedule?.on), off: str(n.schedule?.off) };
}

function upstream(raw: RawEeroFull, wired: boolean): M.Id | null {
  const wireless = linkUrl(raw.wireless_upstream_node?.url);
  if (!wired && wireless) return idFromUrl(wireless);
  const leaf = raw.ethernet_status?.statuses?.find((s) => s.isLeafWiredToUpstream && s.neighbor?.type?.toUpperCase() === "EERO");
  const url = linkUrl(leaf?.neighbor?.metadata?.url);
  return url ? idFromUrl(url) : wireless ? idFromUrl(wireless) : null;
}

/** LAN facts every eero shares, from the network object and the gateway eero. */
export type Lan = { subnet: string | null; gatewayIp: string | null };

const NO_LAN: Lan = { subnet: null, gatewayIp: null };

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function ipv4Int(ip: string | null): number | null {
  const m = ip ? IPV4.exec(ip) : null;
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((n) => n <= 255) ? parts.reduce((a, n) => a * 256 + n, 0) : null;
}

/** "192.168.4.0" and "255.255.252.0" to "192.168.4.0/22"; null for a bad or non-contiguous mask. */
export function cidr(ip: string | null, mask: string | null): string | null {
  const a = ipv4Int(ip);
  const m = ipv4Int(mask);
  if (a === null || m === null) return null;
  const bits = m.toString(2).padStart(32, "0");
  if (!/^1*0*$/.test(bits)) return null;
  const prefix = bits.indexOf("0") === -1 ? 32 : bits.indexOf("0");
  const base = prefix === 0 ? 0 : (a - (a % 2 ** (32 - prefix)));
  return `${[24, 16, 8, 0].map((s) => Math.floor(base / 2 ** s) % 256).join(".")}/${prefix}`;
}

/**
 * Subnet from the network's custom DHCP settings (null in automatic mode:
 * eero does not send the range it picked), and the LAN gateway, the gateway
 * eero's own address. In bridge mode eero is not the gateway, so null.
 */
export function lanOf(net: Pick<RawNetwork, "dhcp" | "connection"> | null, eeros: RawEero[]): Lan {
  const mode = net?.connection?.mode?.toLowerCase();
  const gw = eeros.find((e) => e.gateway === true || e.is_primary_node === true);
  const custom = net?.dhcp?.mode?.toLowerCase() === "custom" ? net.dhcp.custom : undefined;
  return {
    subnet: custom ? cidr(str(custom.subnet_ip), str(custom.subnet_mask)) : null,
    gatewayIp: mode && mode !== "nat" ? null : str(gw?.ip_address),
  };
}

export function mapEero(raw: RawEeroFull, lan: Lan = NO_LAN): M.Eero {
  const url = linkUrl(raw.url);
  const isGateway = raw.gateway === true || raw.is_primary_node === true;
  const wired = raw.wired === true || raw.connection_type?.toUpperCase() === "WIRED";
  const backhaul: M.Eero["backhaul"] = raw.wired === undefined && !raw.connection_type ? null : wired ? "wired" : "wireless";
  const bars = num(raw.mesh_quality_bars);
  const eol = raw.update_status;
  return {
    id: url ? idFromUrl(url) : (str(raw.serial) ?? ""),
    serial: str(raw.serial),
    location: str(raw.location) ?? str(raw.serial) ?? "eero",
    model: str(raw.model),
    modelNumber: str(raw.model_number),
    isGateway,
    status: eeroStatus(raw),
    firmware: str(raw.os_version),
    updateAvailable: typeof raw.update_available === "boolean" ? raw.update_available : null,
    endOfLife: eol && (eol.support_expired !== undefined || eol.support_expiration_date) ? { expired: eol.support_expired === true, date: str(eol.support_expiration_date) } : null,
    backhaul,
    meshBars: backhaul === "wireless" && bars !== null ? Math.max(1, Math.min(5, bars)) : null,
    upstream: isGateway ? null : upstream(raw, wired),
    // Derived in core (eero.list, eero.get).
    hop: null,
    meshQuality: null,
    clients: {
      total: num(raw.connected_clients_count),
      wired: num(raw.connected_wired_clients_count),
      wireless: num(raw.connected_wireless_clients_count),
    },
    bands: unique((raw.bands ?? []).map(bandOf).filter((b): b is M.WirelessBand => b !== null)),
    radios: radios(raw),
    led: { on: typeof raw.led_on === "boolean" ? raw.led_on : null, brightness: num(raw.led_brightness) },
    nightlight: nightlight(raw),
    ipv4: str(raw.ip_address),
    ipv6: (raw.ipv6_addresses ?? []).map((a) => (typeof a === "string" ? a : a?.address)).filter((a): a is string => typeof a === "string" && a.length > 0),
    subnet: lan.subnet,
    gatewayIp: lan.gatewayIp,
    mac: str(raw.mac_address),
    bssids: (raw.bssids_with_bands ?? []).flatMap((b) => {
      const band = bandOf(b.band);
      const mac = str(b.ethernet_address);
      return band && mac ? [{ band, mac }] : [];
    }),
    joined: str(raw.joined),
    uptimeSec: num(raw.uptime?.since_last_reboot_s),
    lastHeartbeat: str(raw.last_heartbeat),
    powerSource: str(raw.power_info?.power_source),
    messages: (raw.messages ?? []).map((m) => (typeof m === "string" ? m : str((m as { message?: unknown; title?: unknown })?.message) ?? str((m as { title?: unknown })?.title))).filter((m): m is string => !!m),
  };
}

// ---------------------------------------------------------------------------
// Ports (`GET resources.connections`)

const PORT_ACTIONS = new Set<M.PortAction>(["ENABLE_PORT", "DISABLE_PORT", "ENABLE_DATA", "DISABLE_DATA", "ENABLE_POE", "DISABLE_POE", "RESTART_POWER"]);

/** eero link speeds: "P2500" 2500, "P1000" 1000, "P10G" 10000, a number as is. Null when absent or unreadable. */
export function portSpeed(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : null;
  const m = typeof v === "string" ? /(\d+(?:\.\d+)?)\s*(g)?/i.exec(v) : null;
  if (!m) return null;
  const n = Number(m[1]) * (m[2] ? 1000 : 1);
  return n > 0 ? n : null;
}

function portStatus(v: unknown): M.EeroPort["status"] {
  const s = typeof v === "string" ? v.toUpperCase() : "";
  if (s === "UP" || s === "CONNECTED" || s === "ACTIVE") return "up";
  if (s === "DISABLED") return "disabled";
  return "down";
}

function poe(v: unknown): M.EeroPort["poe"] {
  const s = typeof v === "string" ? v.toUpperCase() : "";
  if (["ON", "ENABLED", "ACTIVE", "POWERED"].includes(s)) return "on";
  if (["OFF", "DISABLED", "INACTIVE"].includes(s)) return "off";
  return null;
}

/** What the ports can join against: the network's devices and eeros. */
export type PortJoin = { devices: Pick<M.Device, "id" | "mac" | "name">[]; eeros: Pick<M.Eero, "id" | "mac" | "location">[] };

function attached(n: RawPortInterface["neighbor"], join: PortJoin): M.EeroPort["attached"] {
  if (!n) return null;
  const meta = n.metadata ?? {};
  const mac = str(meta.mac) ? compactMac(meta.mac as string) : null;
  const url = linkUrl(meta.url);
  const urlId = url ? idFromUrl(url) : null;
  const isEero = n.type?.toUpperCase() === "EERO" || (url?.includes("/eeros/") ?? false);
  if (isEero) {
    const e = join.eeros.find((x) => (mac && x.mac && compactMac(x.mac) === mac) || x.id === urlId);
    const name = e?.location ?? str(meta.location) ?? str(meta.display_name);
    return { deviceId: null, eeroId: e?.id ?? urlId, name };
  }
  const d = join.devices.find((x) => (mac && compactMac(x.mac) === mac) || x.id === urlId);
  const deviceId = d?.id ?? urlId ?? mac;
  const name = d?.name ?? str(meta.display_name);
  return deviceId || name ? { deviceId, eeroId: null, name } : null;
}

export function mapPorts(eeroId: M.Id, raw: { ports?: { interfaces?: RawPortInterface[] } } | null | undefined, join: PortJoin): M.EeroPorts {
  const ports = (raw?.ports?.interfaces ?? []).map((p, i): M.EeroPort => {
    const status = portStatus(p.port_status);
    return {
      number: num(p.interface_number) ?? i + 1,
      name: str(p.name),
      status,
      speedMbps: status === "up" ? portSpeed(p.negotiated_speed) : null,
      supportedMbps: portSpeed(p.supported_speed),
      isWan: p.network_type?.toUpperCase() === "WAN",
      poe: poe(p.poe_status),
      mac: str(p.ethernet_address),
      attached: attached(p.neighbor, join),
      actions: (p.actions ?? []).map((a) => a?.type?.toUpperCase()).filter((t): t is M.PortAction => !!t && PORT_ACTIONS.has(t as M.PortAction)),
    };
  });
  return { eeroId, ports: ports.sort((a, b) => a.number - b.number) };
}

// ---------------------------------------------------------------------------
// Firmware history (`GET /2.2/eeros/{id}/firmware_update/history`)

/** Newest first, `current` on the newest entry matching the running version. Entries without a version are dropped. */
export function mapFirmwareHistory(rows: RawFirmwareHistoryEntry[], running: string | null): M.FirmwareEntry[] {
  const list = rows
    .map((r) => ({ version: str(r.os_version) ?? str(r.version), installedAt: str(r.installed_at) ?? str(r.installed) ?? str(r.created) }))
    .filter((r): r is { version: string; installedAt: string | null } => r.version !== null);
  const time = (t: string | null) => (t ? Date.parse(t) : Number.NaN);
  list.sort((a, b) => {
    const ta = time(a.installedAt);
    const tb = time(b.installedAt);
    if (Number.isNaN(ta) || Number.isNaN(tb)) return Number.isNaN(ta) ? (Number.isNaN(tb) ? 0 : 1) : -1;
    return tb - ta;
  });
  const cur = running ? list.findIndex((r) => r.version === running) : -1;
  return list.map((r, i) => ({ ...r, current: i === cur }));
}
