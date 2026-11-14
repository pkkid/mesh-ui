/**
 * Raw eero guest network to the model. `GET {net}/guestnetwork` sends the
 * password in the clear; only `guestCredentials` reads it, for the sensitive
 * `guest.share`. Guests are the devices with `is_guest` (eero has no guest
 * device list: `{net}/guestnetwork/devices` is a 404). Security per band is
 * the main network's (`GET {net}/wpa3_per_band`). Shapes:
 * docs/eero-api/endpoints.md section 17, docs/architecture/data-model.md
 * (Guest and Wi-Fi).
 */

import type { WifiCredentials } from "../../backend";
import type * as M from "../../model";
import type { RawDevice, RawGuestNetwork, RawWpa3PerBand } from "../raw";
import { compactMac } from "../urls";

/** `WPA2`, `wpa2_wpa3`, `WPA3` (case and separators vary) to the model; anything else is null. */
export function securityOf(v: unknown): M.Security | null {
  if (typeof v !== "string") return null;
  const s = v.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  if (s === "WPA2" || s === "WPA3") return s;
  if (s === "WPA2_WPA3" || s === "WPA3_WPA2" || s === "WPA2_WPA3_MIXED" || s === "MIXED") return "WPA2_WPA3";
  return null;
}

/**
 * Security per band. An open network has none. 6 GHz is always WPA3 when the
 * network has a 6 GHz radio (a real network sends no 6 GHz key), else null.
 */
export function guestSecurity(perBand: RawWpa3PerBand | null, open: boolean, has6: boolean): Record<M.WirelessBand, M.Security | null> {
  if (open) return { "2.4": null, "5": null, "6": null };
  return {
    "2.4": securityOf(perBand?.band_2_4_ghz),
    "5": securityOf(perBand?.band_5_ghz),
    "6": has6 ? (securityOf(perBand?.band_6_ghz) ?? "WPA3") : null,
  };
}

const hasPassword = (raw: RawGuestNetwork | null): boolean => typeof raw?.password === "string" && raw.password.length > 0;

/** `GuestNetwork` without the password. Online guests count only while the guest network is on. */
export function mapGuestNetwork(raw: RawGuestNetwork | null, devices: RawDevice[], security: Record<M.WirelessBand, M.Security | null>): M.GuestNetwork {
  const guests = devices.filter((d) => d.is_guest === true && typeof d.mac === "string" && d.mac !== "");
  const enabled = raw?.enabled === true;
  const name = typeof raw?.name === "string" && raw.name.trim() ? raw.name : null;
  return {
    enabled,
    name,
    hasPassword: hasPassword(raw),
    online: enabled ? guests.filter((d) => d.connected === true).length : 0,
    deviceIds: guests.map((d) => compactMac(d.mac ?? "")),
    security,
  };
}

/** Sensitive: the guest SSID and password (null: open). An unnamed network gives an empty SSID; core refuses to share it. */
export function guestCredentials(raw: RawGuestNetwork | null): WifiCredentials {
  return { ssid: typeof raw?.name === "string" ? raw.name : "", password: hasPassword(raw) ? (raw?.password as string) : null };
}
