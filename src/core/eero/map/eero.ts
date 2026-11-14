/**
 * Raw eero node to the model `Eero`. Lenient: a missing or odd field gives
 * null, never a throw. Sources: docs/architecture/data-model.md#eeros.
 */

import type * as M from "../../model";
import { type RawEero, type RawFirmwareHistoryEntry, type RawNetwork, type RawPortConnection, type RawPortInterface, linkUrl } from "../raw";
import { compactMac, idFromUrl } from "../urls";
import { speedMbps } from "./device";
import { toIso } from "./network";
import { mapLan } from "./routing";

type RawRadioStats = { channel?: number; channel_width?: string | number; tx_power?: number; channel_utilization?: number; client_count?: number };

/** Fields beyond raw.ts that the eero mapper reads when eero sends them. */
export type RawEeroFull = RawEero & {
  update_status?: { support_expired?: boolean; support_expiration_date?: string | null } | null;
  ipv6_addresses?: (string | { address?: string })[];
  bssids_with_bands?: { band?: string; ethernet_address?: string }[];
  radio_channel_stats?: Record<string, RawRadioStats | undefined>;
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

/**
 * The parent eero's id. Wired: the EERO neighbour on the uplink port
 * (`isLeafWiredToUpstream` if eero ever sets it, else the `isWanPort` port,
 * else the only EERO neighbour). Wireless: `wireless_upstream_node.url` if
 * sent, else its `name` matched to exactly one peer's `location` (eero sends
 * no url and its node id is not an eero id). Null when it cannot be told.
 */
function upstream(raw: RawEeroFull, wired: boolean, peers: RawEero[]): M.Id | null {
  const self = linkUrl(raw.url);
  const eeroNeighbours = (raw.ethernet_status?.statuses ?? []).filter((s) => s.neighbor?.type?.toUpperCase() === "EERO" && linkUrl(s.neighbor.metadata?.url));
  const wiredUp =
    eeroNeighbours.find((s) => s.isLeafWiredToUpstream === true) ??
    eeroNeighbours.find((s) => s.isWanPort === true && s.hasCarrier !== false) ??
    (eeroNeighbours.length === 1 ? eeroNeighbours[0] : undefined);
  const wiredUrl = linkUrl(wiredUp?.neighbor?.metadata?.url);
  const node = raw.wireless_upstream_node;
  const nodeUrl = linkUrl(node?.url);
  const name = str(node?.name);
  const named = name ? peers.filter((p) => str(p.location) === name && linkUrl(p.url) !== self) : [];
  const wirelessUrl = nodeUrl ?? (named.length === 1 ? linkUrl(named[0]?.url) : null);
  const url = wired ? (wiredUrl ?? wirelessUrl) : (wirelessUrl ?? wiredUrl);
  return url && url !== self ? idFromUrl(url) : null;
}

/** LAN facts every eero shares, from the network object and the gateway eero. */
export type Lan = { subnet: string | null; gatewayIp: string | null };

const NO_LAN: Lan = { subnet: null, gatewayIp: null };

/**
 * Subnet from the network's DHCP settings, the same source as
 * `reservation.list` (`mapLan`: `dhcp.custom`, or eero's automatic
 * 192.168.4.0/22), and the LAN gateway, the gateway eero's own address. In
 * bridge mode eero runs no LAN, so both are null; without the network object
 * the subnet is null.
 */
export function lanOf(net: Pick<RawNetwork, "dhcp" | "connection"> | null, eeros: RawEero[]): Lan {
  const mode = net?.connection?.mode?.toLowerCase();
  const gw = eeros.find((e) => e.gateway === true || e.is_primary_node === true);
  const bridged = mode !== undefined && mode !== "nat";
  return {
    subnet: net && !bridged ? (mapLan(net.dhcp)?.subnet ?? null) : null,
    gatewayIp: bridged ? null : str(gw?.ip_address),
  };
}

/** `peers`: the network's eeros, to name a wireless parent (pass the list; a lone read cannot). */
export function mapEero(raw: RawEeroFull, lan: Lan = NO_LAN, peers: RawEero[] = []): M.Eero {
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
    upstream: isGateway ? null : upstream(raw, wired, peers),
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

/** Real values: "DATA_CONNECTED", "WAN". "DISABLED" is a guess; anything else is down. */
function portStatus(v: unknown): M.EeroPort["status"] {
  const s = typeof v === "string" ? v.toUpperCase() : "";
  if (s === "DISABLED") return "disabled";
  if (s === "UP" || s === "WAN" || s === "ACTIVE" || (/CONNECTED$/.test(s) && !/(DIS|NOT_?)CONNECTED$/.test(s))) return "up";
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

/** One device behind a port, joined to the network's eeros or devices by its url (or MAC, if sent). */
function joinOne(c: RawPortConnection, join: PortJoin): NonNullable<M.EeroPort["attached"]> | null {
  const meta = (c.metadata ?? {}) as NonNullable<RawPortConnection["metadata"]> & { mac?: string };
  const mac = str(meta.mac) ? compactMac(meta.mac as string) : null;
  const url = linkUrl(meta.url);
  const urlId = url ? idFromUrl(url) : null;
  const type = c.type?.toUpperCase() ?? "";
  if (type.startsWith("EERO") || (url?.includes("/eeros/") ?? false)) {
    const e = join.eeros.find((x) => x.id === urlId || (mac && x.mac && compactMac(x.mac) === mac));
    return { deviceId: null, eeroId: e?.id ?? urlId, name: e?.location ?? str(meta.location) };
  }
  const d = join.devices.find((x) => x.id === urlId || (mac && compactMac(x.mac) === mac));
  const deviceId = d?.id ?? urlId ?? mac;
  const name = d?.name ?? str(meta.display_name);
  return deviceId || name ? { deviceId, eeroId: null, name } : null;
}

/** What eero says is behind a port: none, one, or several (behind a switch). WAN_SOURCE is the internet, not a device. */
export function portConnections(p: RawPortInterface): RawPortConnection[] {
  const cs = p.connection_status;
  const type = cs?.type?.toUpperCase() ?? "";
  if (!cs || !type || type === "WAN_SOURCE") return [];
  const many = cs.metadata?.multiple_devices?.connections;
  if (Array.isArray(many)) return many.filter((c) => c && typeof c === "object");
  return cs.metadata?.url ? [{ type: cs.type, metadata: cs.metadata }] : [];
}

/**
 * The one thing the model shows per port: an eero if one is behind it (a
 * wired backhaul matters most), else the only device, else "N devices" with
 * no id (a switch with several).
 */
function attached(p: RawPortInterface, join: PortJoin): M.EeroPort["attached"] {
  const list = portConnections(p);
  const eeroConn = list.find((c) => c.type?.toUpperCase().startsWith("EERO") || linkUrl(c.metadata?.url)?.includes("/eeros/"));
  if (eeroConn) return joinOne(eeroConn, join);
  if (list.length === 1 && list[0]) return joinOne(list[0], join);
  return list.length > 1 ? { deviceId: null, eeroId: null, name: `${list.length} devices` } : null;
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
      // network_type is "UNKNOWN" on the real WAN port; port_status "WAN" and connection_status WAN_SOURCE say it.
      isWan: [p.network_type, p.port_status, p.connection_status?.type].some((v) => /^WAN(_SOURCE)?$/i.test(v ?? "")),
      poe: poe(p.poe_status),
      mac: str(p.ethernet_address),
      attached: attached(p, join),
      actions: (p.actions ?? []).map((a) => a?.type?.toUpperCase()).filter((t): t is M.PortAction => !!t && PORT_ACTIONS.has(t as M.PortAction)),
    };
  });
  return { eeroId, ports: ports.sort((a, b) => a.number - b.number) };
}

// ---------------------------------------------------------------------------
// Firmware history (`GET /2.2/eeros/{id}/firmware_update/history`)

/** "v7.10.1-12+20261101-...prod" to "v7.10.1-12": the build tail dropped, so it compares with the eero's `os_version`. */
const baseVersion = (v: unknown): string | null => str(typeof v === "string" ? v.split("+")[0] : null);

const FAILED = /fail|error|cancel|abort/i;

/**
 * Newest first, `current` on the newest entry matching the running version.
 * Rows come as `firmware_version` with `finished_at` (else `timestamp`);
 * rows without a version, and failed updates, are dropped.
 */
export function mapFirmwareHistory(rows: RawFirmwareHistoryEntry[], running: string | null): M.FirmwareEntry[] {
  const list = rows
    .filter((r) => r && !FAILED.test(`${r.outcome ?? ""} ${r.status ?? ""} ${r.update_status ?? ""}`))
    .map((r) => ({ version: baseVersion(r.firmware_version), installedAt: toIso(r.finished_at) ?? toIso(r.timestamp) }))
    .filter((r): r is { version: string; installedAt: string | null } => r.version !== null);
  const time = (t: string | null) => (t ? Date.parse(t) : Number.NaN);
  list.sort((a, b) => {
    const ta = time(a.installedAt);
    const tb = time(b.installedAt);
    if (Number.isNaN(ta) || Number.isNaN(tb)) return Number.isNaN(ta) ? (Number.isNaN(tb) ? 0 : 1) : -1;
    return tb - ta;
  });
  const run = baseVersion(running);
  const cur = run ? list.findIndex((r) => r.version === run) : -1;
  return list.map((r, i) => ({ ...r, current: i === cur }));
}
