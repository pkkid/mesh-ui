/**
 * Raw eero node to the model `Eero`. Lenient: a missing or odd field gives
 * null, never a throw. Sources: docs/architecture/data-model.md#eeros.
 */

import type * as M from "../../model";
import { type RawEero, linkUrl } from "../raw";
import { idFromUrl } from "../urls";
import { speedMbps } from "./device";

type RawRadioStats = { channel?: number; channel_width?: string | number; channel_utilization?: number; client_count?: number };

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

export function mapEero(raw: RawEeroFull): M.Eero {
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
