/**
 * Pure signal and channel helpers shared by `wifi.health`, `wifi.insights`,
 * the demo backend and the Signal page (docs/ux/pages/signal.md). No
 * requests, no state.
 */

import type * as M from "./model";

/**
 * Signal quality cut-offs in dBm: excellent at or above -55, good at or above
 * -65, fair at or above -75, weak below. Common rules of thumb (eero does not
 * publish its own); eero's 0 to 5 bars are kept beside them.
 */
export const SIGNAL_DBM = { excellent: -55, good: -65, fair: -75 } as const;

export function signalQuality(dbm: number): M.SignalQuality {
  return dbm >= SIGNAL_DBM.excellent ? "excellent" : dbm >= SIGNAL_DBM.good ? "good" : dbm >= SIGNAL_DBM.fair ? "fair" : "weak";
}

/** A device's Wi-Fi generation from its link's standard ("Wi-Fi 6", 802.11ax HE) and band: Wi-Fi 6 on 6 GHz is 6E. */
export function generationOf(standard: string | null | undefined, band: M.Band | null): M.WifiGeneration {
  const s = (standard ?? "").toLowerCase();
  if (/\b7\b|eht|be\b/.test(s)) return "wifi7";
  if (/6e/.test(s)) return "wifi6e";
  if (/\b6\b|he\b|ax\b/.test(s)) return band === "6" ? "wifi6e" : "wifi6";
  if (/\b5\b|vht|ac\b/.test(s)) return "wifi5";
  if (/\b4\b|ht\b|\bn\b/.test(s)) return "wifi4";
  return "unknown";
}

/** Newest first; unknown last. */
export const GENERATION_ORDER: M.WifiGeneration[] = ["wifi7", "wifi6e", "wifi6", "wifi5", "wifi4", "unknown"];

/** Higher is newer; unknown is 0. */
export const generationRank = (g: M.WifiGeneration): number => ({ wifi7: 5, wifi6e: 4, wifi6: 3, wifi5: 2, wifi4: 1, unknown: 0 })[g];

export function median(values: ReadonlyArray<number>): number | null {
  if (values.length === 0) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? (v[mid] as number) : Math.round(((v[mid - 1] as number) + (v[mid] as number)) / 2);
}

/** Where a band's channels sit, in MHz, for the Signal page's Airwaves. */
export const BAND_SPAN: Record<M.WirelessBand, { lo: number; hi: number; ticks: number[] }> = {
  "2.4": { lo: 2401, hi: 2484, ticks: [1, 6, 11] },
  "5": { lo: 5150, hi: 5895, ticks: [36, 52, 100, 116, 132, 149, 165] },
  "6": { lo: 5925, hi: 7125, ticks: [1, 33, 65, 97, 129, 161, 193, 225] },
};

/** A channel number's centre in MHz on its band. */
export function channelMhz(band: M.WirelessBand, channel: number): number {
  if (band === "2.4") return channel === 14 ? 2484 : 2407 + 5 * channel;
  if (band === "5") return 5000 + 5 * channel;
  return 5950 + 5 * channel;
}

/**
 * The stretch of spectrum a radio uses: its primary channel widened to the
 * block of `widthMhz` it sits in (an 80 MHz radio on 44 uses 36 to 48).
 * 2.4 GHz channels are 20 or 40 MHz around the primary.
 */
export function channelSpan(band: M.WirelessBand, channel: number, widthMhz: number | null): { lo: number; hi: number; center: number } {
  const width = widthMhz && widthMhz > 0 ? widthMhz : 20;
  let center = channelMhz(band, channel);
  if (band !== "2.4" && width > 20) {
    const n = width / 20;
    const base = band === "5" ? (channel >= 149 ? 149 : 36) : 1;
    const start = base + Math.floor((channel - base) / (4 * n)) * 4 * n;
    center = channelMhz(band, start + 2 * (n - 1));
  }
  return { lo: center - width / 2, hi: center + width / 2, center };
}

/** Two spans share airtime when they overlap by more than a sliver. */
export const spansOverlap = (a: { lo: number; hi: number }, b: { lo: number; hi: number }): boolean => Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo) > 2;

/** Top PHY rate per spatial stream in Mbps, by generation and width (highest MCS, short guard interval). */
const PER_STREAM: Partial<Record<M.WifiGeneration, Record<number, number>>> = {
  wifi4: { 20: 72.2, 40: 150 },
  wifi5: { 20: 86.7, 40: 200, 80: 433.3, 160: 866.7 },
  wifi6: { 20: 143.4, 40: 286.8, 80: 600.5, 160: 1201 },
  wifi6e: { 20: 143.4, 40: 286.8, 80: 600.5, 160: 1201 },
  wifi7: { 20: 172.1, 40: 344.1, 80: 720.6, 160: 1441.2, 320: 2882.4 },
};

/** The top rate a link's generation, width and streams allow; null when one is unknown. */
export function maxRateMbps(generation: M.WifiGeneration, widthMhz: number | null, streams: number | null): number | null {
  const table = PER_STREAM[generation];
  if (!table || !widthMhz || !streams || streams < 1) return null;
  const perStream = table[widthMhz];
  return perStream === undefined ? null : Math.round(perStream * streams);
}
