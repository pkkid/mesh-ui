/**
 * Maps `GET {net}/diagnostics` and `GET {net}/support` (`/2.2/`) to the
 * model. Pure: no requests. A real network that has not run diagnostics
 * sends only `{status}`; the 2.2 support object carries eero's contacts and
 * no ISP. Placement and the `/2.4/` scans are read tolerantly (not
 * captured). Shapes: docs/eero-api/endpoints.md sections 5, 10 and 17.
 */

import type * as M from "../../model";
import { linkUrl, type RawCoverageScan, type RawDevice, type RawDiagnostics, type RawGenerationScan, type RawLink, type RawPlacementTest, type RawSupport, type RawText } from "../raw";
import { idFromUrl } from "../urls";

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

/**
 * eero's `issue_area` when it found no problem area: a real run of "My
 * connection drops" answered `none` (2026-11-21), so those words mean no area.
 */
const NO_AREA = /^(none|no_?issues?|no_?problems?|null|n\/a|ok|good)$/i;

export function mapDiagnostics(raw: RawDiagnostics | null | undefined): M.DiagnosticsResult {
  const results = Array.isArray(raw?.results) ? raw.results : [];
  const area = str(raw?.issue_area);
  return {
    status: str(raw?.status),
    issueArea: area && !NO_AREA.test(area) ? area : null,
    results: results.flatMap((r) => {
      const name = str(r?.name);
      return name ? [{ name, status: str(r.status) ?? "unknown", detail: str(r.detail) }] : [];
    }),
  };
}

/** eero is still running diagnostics (or has not started): keep reading. */
export const diagnosticsPending = (raw: RawDiagnostics | null | undefined): boolean =>
  /^(not_started|running|in_progress|pending|started|queued|scheduled|diagnosing)$/i.test(str(raw?.status) ?? "");

/** The address in a `mailto:` link ("mailto:help@x.com?subject=..." to "help@x.com"); null for any other link. */
export function mailtoAddress(url: string | null): string | null {
  const m = url ? /^mailto:([^?]+)/i.exec(url) : null;
  return m?.[1] ? decodeURIComponent(m[1]).trim() || null : null;
}

/**
 * eero's 2.2 support object has no ISP contacts, so `isp` is null; core may
 * name the ISP. `email_web_form_url` is a `mailto:` link on real networks
 * (read-only check 2026-11-21), so `email` is its address.
 */
export function mapSupport(raw: RawSupport | null | undefined): Omit<M.SupportInfo, "supportId"> {
  return {
    eero: {
      name: str(raw?.name),
      phone: str(raw?.support_phone),
      email: mailtoAddress(str(raw?.email_web_form_url)),
      helpUrl: str(raw?.help_url),
      contactUrl: str(raw?.contact_url),
      emailFormUrl: str(raw?.email_web_form_url),
    },
    isp: null,
  };
}

// ---------------------------------------------------------------------------
// Placement and coverage (M5.8). The two `/2.4/` scans follow the 2026-11-14
// capture; the placement test shape is still not captured.

const text = (v: RawText | null | undefined): string | null => (typeof v === "string" ? str(v) : v ? (str(v.message) ?? str(v.text) ?? str(v.title)) : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const idOf = (id: unknown, link: RawLink | null | undefined): M.Id | null => {
  if (typeof id === "number" || (typeof id === "string" && id)) return String(id);
  const url = linkUrl(link);
  return url ? idFromUrl(url) : null;
};

const RATINGS = ["poor", "fair", "good", "strong"] as const;

/** A rating word (`"GOOD"`, `"excellent"`) or a 1 to 5 / 0 to 100 number to poor, fair, good or strong. */
export function placementRating(v: string | number | null | undefined): M.PlacementResult["rating"] {
  if (typeof v === "number" && Number.isFinite(v)) {
    const pct = v <= 5 ? v * 20 : v;
    return pct >= 80 ? "strong" : pct >= 60 ? "good" : pct >= 40 ? "fair" : "poor";
  }
  const w = str(v)?.toLowerCase();
  if (!w) return null;
  if (w === "excellent" || w === "great") return "strong";
  if (w === "bad" || w === "weak") return "poor";
  return (RATINGS as readonly string[]).includes(w) ? (w as M.PlacementResult["rating"]) : null;
}

/** Still running: eero has not answered with a rating yet. */
export const placementPending = (raw: RawPlacementTest | null | undefined): boolean => /^(running|in_progress|pending|started|queued|testing)$/i.test(str(raw?.status) ?? "");

export function mapPlacement(eeroId: M.Id, raw: RawPlacementTest | null | undefined): M.PlacementResult {
  return {
    eeroId,
    rating: placementRating(raw?.rating ?? raw?.placement_rating ?? raw?.result?.rating),
    advice: text(raw?.advice) ?? text(raw?.recommendation) ?? text(raw?.result?.recommendation),
  };
}

/** A device's link score 0 to 100 from `connectivity.score` (0 to 1), or from `score_bars` (0 to 5, each worth 20). */
const deviceQuality = (d: RawDevice): number | null => {
  const score = num(d.connectivity?.score);
  const bars = num(d.connectivity?.score_bars);
  const v = score !== null ? score * 100 : bars !== null ? bars * 20 : null;
  return v === null ? null : Math.max(0, Math.min(100, v));
};

const deviceName = (d: RawDevice): string => str(d.display_name) ?? str(d.nickname) ?? str(d.hostname) ?? "A device";

/**
 * The real scan lists devices, not rooms (captured 2026-11-14): each room is
 * an eero (`source.url`) with its devices, its quality the mean of their link
 * scores. Weak (unhealthy) devices become the advice. eero sends no time and
 * no upstream; core fills both (scannedAt from the read, servedBy from the
 * eero list).
 */
export function mapCoverageScan(raw: RawCoverageScan | null | undefined): M.CoverageScan {
  const list = (v: RawDevice[] | null | undefined) => (Array.isArray(v) ? v : []);
  const healthy = list(raw?.healthy_devices);
  const unhealthy = list(raw?.unhealthy_devices);
  const rooms = new Map<M.Id, { location: string; scores: number[]; devices: number }>();
  for (const d of [...healthy, ...unhealthy]) {
    const eeroId = idOf(null, d?.source?.url);
    if (!eeroId) continue;
    const room = rooms.get(eeroId) ?? { location: str(d.source?.location) ?? "", scores: [], devices: 0 };
    room.devices += 1;
    const q = deviceQuality(d);
    if (q !== null) room.scores.push(q);
    rooms.set(eeroId, room);
  }
  return {
    scannedAt: null,
    rooms: [...rooms].map(([eeroId, r]) => ({
      eeroId,
      location: r.location,
      quality: r.scores.length ? Math.round(r.scores.reduce((a, b) => a + b, 0) / r.scores.length) : null,
      devices: r.devices,
      servedBy: null,
    })),
    advice: unhealthy.map((d) => {
      const where = str(d.source?.location);
      return `${deviceName(d)} has a weak Wi-Fi link${where ? ` to ${where}` : ""}. Moving it or the eero closer can help.`;
    }),
  };
}

type Generation = M.UpgradeReport["byGeneration"][number]["generation"];

/** `"WIFI_6E"`, `"wifi6e"`, `"6E"`, `"ax"`, `7` to the model's generation; legacy a/b/g/n count as wifi4. */
export function generationOf(v: unknown): Generation | null {
  const w = String(v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").replace(/^(wifi|80211)/, "");
  if (w === "7" || w === "be") return "wifi7";
  if (w === "6e") return "wifi6e";
  if (w === "6" || w === "ax") return "wifi6";
  if (w === "5" || w === "ac") return "wifi5";
  if (["4", "n", "3", "2", "1", "a", "b", "g", "legacy", "older"].includes(w)) return "wifi4";
  return null;
}

/** eero says Wi-Fi 6 for 6E too; a Wi-Fi 6 device on the 6 GHz band is 6E. */
const deviceGeneration = (version: unknown, d: RawDevice): Generation | null => {
  const gen = generationOf(version);
  return gen === "wifi6" && String(d?.interface?.frequency ?? "").startsWith("6") ? "wifi6e" : gen;
};

const GEN_WORD: Record<Generation, string> = { wifi7: "Wi-Fi 7", wifi6e: "Wi-Fi 6E", wifi6: "Wi-Fi 6", wifi5: "Wi-Fi 5", wifi4: "Wi-Fi 4" };

/**
 * The real scan groups full device rows under a numeric `wifi_version`
 * (captured 2026-11-14). eero names no eero that holds devices back, so
 * `limitingEeros` stays empty; when devices support a newer version than the
 * eeros (`network_wifi_version`), one note says how many.
 */
export function mapGenerationScan(raw: RawGenerationScan | null | undefined): M.UpgradeReport {
  const counts = new Map<Generation, number>();
  const network = num(raw?.network_wifi_version);
  let newer = 0;
  for (const g of Array.isArray(raw?.devices_per_wifi_version) ? raw.devices_per_wifi_version : []) {
    const devices = Array.isArray(g?.devices) ? g.devices : [];
    const version = num(g?.wifi_version);
    for (const d of devices) {
      const gen = deviceGeneration(version, d);
      if (gen) counts.set(gen, (counts.get(gen) ?? 0) + 1);
    }
    if (network !== null && version !== null && version > network) newer += devices.length;
  }
  const word = network === null ? null : generationOf(network);
  return {
    byGeneration: [...counts].map(([generation, devices]) => ({ generation, devices })),
    limitingEeros: [],
    notes: newer && word ? [`${newer} ${newer === 1 ? "device supports" : "devices support"} a newer Wi-Fi generation than your eeros (${GEN_WORD[word]}).`] : [],
  };
}
