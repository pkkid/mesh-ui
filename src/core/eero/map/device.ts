/**
 * Raw eero device to the model `Device`. Lenient: a missing or odd field
 * gives null, never a throw. Sources: docs/architecture/data-model.md#devices.
 */

import type * as M from "../../model";
import { type RawDevice, linkUrl } from "../raw";
import { compactMac, idFromUrl } from "../urls";

type RateInfo = { rate_bps?: number; channel_width?: string | number; phy_type?: string };

/** Fields beyond raw.ts that the device mapper reads when eero sends them. */
export type RawDeviceFull = RawDevice & {
  auth?: string | null;
  connectivity?: RawDevice["connectivity"] & {
    rx_rate_info?: RateInfo;
    tx_rate_info?: RateInfo;
    snr?: number;
    packet_stats?: { tx_retries?: number; tx_packets?: number; tx_retry_pct?: number };
    ethernet_status?: { has_carrier?: boolean; interface_number?: number; speed?: string | number; port_name?: string } | null;
  };
};

/** eero `device_type` to the five summary categories. Anything else is "other". */
const CATEGORY: Record<string, M.DeviceCategory> = {
  phone: "phones_tablets",
  tablet: "phones_tablets",
  e_reader: "phones_tablets",
  watch: "phones_tablets",
  laptop_computer: "computers",
  desktop_computer: "computers",
  unknown_computer: "computers",
  hard_drive: "computers",
  printer: "computers",
  television: "entertainment",
  game_console: "entertainment",
  media_streamer: "entertainment",
  cable_box: "entertainment",
  audio: "entertainment",
  remote: "entertainment",
  thermostat: "smart_home",
  plug: "smart_home",
  light: "smart_home",
  security_camera: "smart_home",
  door_bell: "smart_home",
  door_lock: "smart_home",
  digital_assistant: "smart_home",
  hub: "smart_home",
  smoke_detector: "smart_home",
  alarm_system: "smart_home",
  garage_door: "smart_home",
  sprinkler: "smart_home",
  vacuum: "smart_home",
  air_conditioner: "smart_home",
  air_purifier: "smart_home",
  fan: "smart_home",
  refrigerator: "smart_home",
  oven: "smart_home",
  washer_dryer: "smart_home",
  coffee_maker: "smart_home",
  toaster: "smart_home",
  scale: "smart_home",
  bed: "smart_home",
  pet_device: "smart_home",
};

/**
 * eero `device_type` values a person can pick (device.type.set), in the
 * Appearance grid's fixed order, with English labels. "generic" is eero's
 * own "Other". Every entry maps to a category through CATEGORY.
 */
export const DEVICE_TYPES: ReadonlyArray<{ type: string; label: string }> = [
  { type: "phone", label: "Phone" },
  { type: "tablet", label: "Tablet" },
  { type: "watch", label: "Watch" },
  { type: "e_reader", label: "E-reader" },
  { type: "laptop_computer", label: "Laptop" },
  { type: "desktop_computer", label: "Desktop" },
  { type: "hard_drive", label: "Storage" },
  { type: "printer", label: "Printer" },
  { type: "television", label: "TV" },
  { type: "media_streamer", label: "Streamer" },
  { type: "game_console", label: "Game console" },
  { type: "audio", label: "Speaker" },
  { type: "cable_box", label: "Cable box" },
  { type: "remote", label: "Remote" },
  { type: "security_camera", label: "Camera" },
  { type: "door_bell", label: "Doorbell" },
  { type: "door_lock", label: "Lock" },
  { type: "thermostat", label: "Thermostat" },
  { type: "light", label: "Light" },
  { type: "plug", label: "Plug" },
  { type: "hub", label: "Hub" },
  { type: "digital_assistant", label: "Assistant" },
  { type: "smoke_detector", label: "Smoke alarm" },
  { type: "alarm_system", label: "Alarm" },
  { type: "garage_door", label: "Garage" },
  { type: "sprinkler", label: "Sprinkler" },
  { type: "vacuum", label: "Vacuum" },
  { type: "air_purifier", label: "Air purifier" },
  { type: "fan", label: "Fan" },
  { type: "washer_dryer", label: "Washer" },
  { type: "pet_device", label: "Pet" },
  { type: "generic", label: "Other" },
];

export const DEVICE_TYPE_IDS = DEVICE_TYPES.map((t) => t.type) as [string, ...string[]];

export function deviceCategory(type: string | null | undefined): M.DeviceCategory {
  return (type && CATEGORY[type]) || "other";
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The display name chain: nickname, display name, hostname, manufacturer, MAC. */
export function deviceName(raw: Pick<RawDevice, "nickname" | "display_name" | "hostname" | "manufacturer" | "mac">, fallback = "Unknown device"): string {
  return str(raw.nickname) ?? str(raw.display_name) ?? str(raw.hostname) ?? str(raw.manufacturer) ?? str(raw.mac) ?? fallback;
}

/** "-52 dBm" to -52. */
function dbm(signal: unknown): number | null {
  if (typeof signal === "number") return signal;
  const m = typeof signal === "string" ? /-?\d+(\.\d+)?/.exec(signal) : null;
  return m ? Number(m[0]) : null;
}

/** "P2500", "1000", 1000 to 1000-style Mbps. */
export function speedMbps(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const m = typeof v === "string" ? /\d+/.exec(v) : null;
  return m ? Number(m[0]) : null;
}

function band(raw: RawDevice): M.Band | null {
  if (raw.wireless === false || raw.connection_type?.toLowerCase() === "wired") return "wired";
  const f = raw.interface?.frequency ?? (typeof raw.connectivity?.frequency === "number" ? String(raw.connectivity.frequency) : undefined);
  if (!f) return null;
  if (f.startsWith("2.4") || f.startsWith("24")) return "2.4";
  if (f.startsWith("5")) return "5";
  if (f.startsWith("6")) return "6";
  return null;
}

const PHY: Record<string, string> = { eht: "Wi-Fi 7", he: "Wi-Fi 6", vht: "Wi-Fi 5", ht: "Wi-Fi 4" };

function link(raw: RawDeviceFull): M.Device["link"] {
  const c = raw.connectivity;
  if (!c || raw.wireless === false) return null;
  const rx = c.rx_rate_info;
  const tx = c.tx_rate_info;
  const mbps = (i: RateInfo | undefined) => (num(i?.rate_bps) === null ? null : Math.round((i?.rate_bps as number) / 1e5) / 10);
  const width = speedMbps(rx?.channel_width ?? tx?.channel_width);
  const phy = str(rx?.phy_type ?? tx?.phy_type)?.toLowerCase();
  const out = {
    rxMbps: mbps(rx) ?? speedMbps(c.rx_bitrate),
    txMbps: mbps(tx),
    widthMhz: width,
    standard: phy ? (PHY[phy] ?? phy.toUpperCase()) : null,
    snr: num(c.snr),
    retryPct: num(c.packet_stats?.tx_retry_pct),
  };
  return Object.values(out).every((v) => v === null) ? null : out;
}

const ipv6All = (list: RawDevice["ipv6_addresses"]): string[] =>
  (list ?? []).map((a) => (typeof a === "string" ? a : a?.address)).filter((a): a is string => typeof a === "string" && a.trim().length > 0).map((a) => a.trim());
const isLinkLocal = (a: string) => /^fe[89ab][0-9a-f]:/i.test(a);

/**
 * Maps one device. `rates` is the stamp for live rates: when eero sends
 * `usage` and a burst is known, rates carry that time; otherwise null.
 */
export function mapDevice(raw: RawDeviceFull, opts: { blocked?: boolean; ratesAt?: string | null } = {}): M.Device {
  const mac = str(raw.mac) ?? "";
  const url = linkUrl(raw.url);
  const id = url ? idFromUrl(url) : compactMac(mac);
  const b = band(raw);
  const blocked = opts.blocked === true || raw.blocked === true || raw.blacklisted === true;
  const connected = !blocked && raw.connected === true;
  const sourceUrl = linkUrl(raw.source?.url);
  const eth = raw.connectivity?.ethernet_status;
  const barsRaw = num(raw.connectivity?.score_bars);
  const signalDbm = dbm(raw.connectivity?.signal);
  const usage = raw.usage;
  const ratesAt = opts.ratesAt ?? null;
  const profileUrl = linkUrl(raw.profile?.url);
  const kind = str(raw.subnet_kind)?.toLowerCase();
  return {
    id,
    name: deviceName(raw),
    nickname: str(raw.nickname),
    hostname: str(raw.hostname),
    manufacturer: str(raw.manufacturer),
    model: str(raw.model_name),
    type: str(raw.device_type) ?? "generic",
    category: deviceCategory(str(raw.device_type)),
    mac,
    privateMac: raw.is_private === true,
    ipv4: str(raw.ipv4) ?? str(raw.ip) ?? str(raw.ips?.[0]),
    // eero lists the fe80:: address among the others; it gets its own field.
    ipv6: ipv6All(raw.ipv6_addresses).filter((a) => !isLinkLocal(a)),
    ipv6LinkLocal: ipv6All(raw.ipv6_addresses).find(isLinkLocal) ?? null,
    connected,
    lastActive: str(raw.last_active),
    firstSeen: str(raw.first_active),
    ssid: blocked && raw.is_guest === undefined && !kind ? null : raw.is_guest === true || kind === "guest" ? "guest" : "main",
    eeroId: sourceUrl ? idFromUrl(sourceUrl) : null,
    band: connected ? b : null,
    channel: connected ? num(raw.channel) : null,
    signal: connected && b !== "wired" && (signalDbm !== null || barsRaw !== null) ? { dbm: signalDbm, bars: barsRaw === null ? null : Math.max(0, Math.min(5, barsRaw)) } : null,
    link: connected ? link(raw) : null,
    wiredPort:
      connected && b === "wired" && sourceUrl && num(eth?.interface_number) !== null
        ? { eeroId: idFromUrl(sourceUrl), port: eth?.interface_number as number, speedMbps: speedMbps(eth?.speed) }
        : null,
    security: str(raw.auth),
    paused: raw.paused === true,
    blocked,
    profileId: profileUrl ? idFromUrl(profileUrl) : null,
    rates:
      connected && ratesAt && usage && num(usage.down_mbps) !== null && num(usage.up_mbps) !== null
        ? { downMbps: usage.down_mbps as number, upMbps: usage.up_mbps as number, at: ratesAt }
        : null,
    reservation: null,
  };
}
