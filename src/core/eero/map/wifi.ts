/**
 * Maps the main Wi-Fi network to `WifiSettings`. Pure: no requests. Sources:
 * the network's `name`, `wpa3` and `temporary_flags`, `GET {net}/wpa3_per_band`,
 * every eero's radios and the devices. Never reads the network's `password`;
 * only `wifi.password.get` and `wifi.share` see it, through the backend's
 * `credentials`. docs/architecture/data-model.md (Guest and Wi-Fi).
 */

import type * as M from "../../model";
import type { RawNetwork, RawWpa3PerBand } from "../raw";
import { speedMbps } from "./device";
import { bandOf, eeroStatus, type RawEeroFull } from "./eero";
import { toIso } from "./network";

const BANDS: readonly M.WirelessBand[] = ["2.4", "5", "6"];

/** `WPA2`, `wpa2_wpa3`, `WPA2/WPA3` ... to the model, or null when unknown. */
export function mapSecurity(v: unknown): M.Security | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toUpperCase().replace(/[\s/+-]+/g, "_");
  if (s === "WPA2" || s === "WPA2_PERSONAL") return "WPA2";
  if (s === "WPA3" || s === "WPA3_PERSONAL" || s === "SAE") return "WPA3";
  if (s === "WPA2_WPA3" || s === "WPA3_WPA2" || s === "WPA2_WPA3_PERSONAL" || s === "TRANSITION" || s === "MIXED") return "WPA2_WPA3";
  return null;
}

/** `temporary_flags.hide_5g` as `{value, expires_on}` or a bare bool. An expired flag is off. */
export function mapHide5g(raw: RawNetwork["temporary_flags"], now = Date.now()): M.WifiSettings["hide5g"] {
  const flag = raw?.hide_5g;
  const value = typeof flag === "object" && flag !== null ? flag.value === true : flag === true;
  const expiresAt = typeof flag === "object" && flag !== null ? toIso(flag.expires_on) : null;
  if (!value || (expiresAt !== null && Date.parse(expiresAt) <= now)) return { active: false, expiresAt: null };
  return { active: true, expiresAt };
}

/** A device whose link used WPA2 while its band also offered WPA3: it most likely cannot do WPA3. */
function onlyWpa2(device: M.Device, security: Record<M.WirelessBand, M.Security | null>): boolean {
  if (!device.connected || device.band === null || device.band === "wired" || device.ssid === "guest") return false;
  if (security[device.band] !== "WPA2_WPA3") return false;
  const auth = device.security?.toUpperCase() ?? "";
  return auth.includes("WPA2") && !auth.includes("WPA3") && !auth.includes("SAE");
}

const uniqueSorted = (xs: (number | null)[]): number[] =>
  [...new Set(xs.filter((x): x is number => typeof x === "number" && x > 0))].sort((a, b) => a - b);

type BandRadio = { band: M.WirelessBand; online: boolean; channel: number | null; widthMhz: number | null };

/**
 * Every eero's radios, one row per band an eero offers (`bands`), plus one per
 * `radio_channel_stats` entry, so 5 GHz low and high keep both channels.
 */
function bandRadios(eeros: RawEeroFull[]): BandRadio[] {
  return eeros.flatMap((e) => {
    const online = eeroStatus(e) !== "offline";
    const stats = Object.entries(e.radio_channel_stats ?? {}).flatMap(([key, st]) => {
      const band = bandOf(key);
      if (!band || !st) return [];
      return [{ band, online, channel: typeof st.channel === "number" ? st.channel : null, widthMhz: speedMbps(st.channel_width) }];
    });
    const offered = (e.bands ?? []).map(bandOf).filter((b): b is M.WirelessBand => b !== null && !stats.some((r) => r.band === b));
    return [...stats, ...[...new Set(offered)].map((band) => ({ band, online, channel: null, widthMhz: null }))];
  });
}

export function mapWifi(net: RawNetwork, wpa3: RawWpa3PerBand | null, eeros: RawEeroFull[], devices: M.Device[], now = Date.now()): M.WifiSettings {
  const radios = bandRadios(eeros);
  const has = (band: M.WirelessBand) => radios.some((r) => r.band === band);
  // Older firmware has no per band endpoint: the network's `wpa3` switch means transition mode on 2.4 and 5 GHz.
  const fallback: M.Security | null = typeof net.wpa3 === "boolean" ? (net.wpa3 ? "WPA2_WPA3" : "WPA2") : null;
  const security: Record<M.WirelessBand, M.Security | null> = {
    "2.4": has("2.4") ? (mapSecurity(wpa3?.band_2_4_ghz) ?? fallback) : null,
    "5": has("5") ? (mapSecurity(wpa3?.band_5_ghz) ?? fallback) : null,
    // 6 GHz is always WPA3; eero sends no key for it.
    "6": has("6") ? "WPA3" : null,
  };
  const wireless = devices.filter((d) => d.connected && d.band !== null && d.band !== "wired");
  const bands = BANDS.flatMap((band) => {
    const on = radios.filter((r) => r.band === band);
    if (!on.length) return [];
    return [{
      band,
      // On while any online eero offers it.
      on: on.some((r) => r.online),
      clients: wireless.filter((d) => d.band === band).length,
      widthsMhz: uniqueSorted(on.map((r) => r.widthMhz)),
      channels: uniqueSorted(on.map((r) => r.channel)),
    }];
  });
  return {
    ssid: typeof net.name === "string" ? net.name : "",
    // The main network can not be open; a missing field is not proof that it is.
    hasPassword: net.password === undefined ? true : typeof net.password === "string" && net.password !== "",
    security,
    wpa2OnlyDevices: devices.filter((d) => onlyWpa2(d, security)).map((d) => d.id),
    bands,
    hide5g: mapHide5g(net.temporary_flags, now),
    wirelessClients: wireless.length,
  };
}
