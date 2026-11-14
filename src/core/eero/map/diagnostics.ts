/**
 * Maps `GET {net}/diagnostics` and `GET {net}/support` (`/2.2/`) to the
 * model. Pure: no requests. A real network that has not run diagnostics
 * sends only `{status}`; the 2.2 support object carries eero's contacts and
 * no ISP. Placement and the `/2.4/` scans are read tolerantly (not
 * captured). Shapes: docs/eero-api/endpoints.md sections 5, 10 and 17.
 */

import type * as M from "../../model";
import { linkUrl, type RawCoverageRoom, type RawCoverageScan, type RawDiagnostics, type RawGenerationScan, type RawLink, type RawPlacementTest, type RawSupport, type RawText } from "../raw";
import { idFromUrl } from "../urls";

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

export function mapDiagnostics(raw: RawDiagnostics | null | undefined): M.DiagnosticsResult {
  const results = Array.isArray(raw?.results) ? raw.results : [];
  return {
    status: str(raw?.status),
    issueArea: str(raw?.issue_area),
    results: results.flatMap((r) => {
      const name = str(r?.name);
      return name ? [{ name, status: str(r.status) ?? "unknown", detail: str(r.detail) }] : [];
    }),
  };
}

/** eero is still running diagnostics (or has not started): keep reading. */
export const diagnosticsPending = (raw: RawDiagnostics | null | undefined): boolean =>
  /^(not_started|running|in_progress|pending|started|queued|scheduled|diagnosing)$/i.test(str(raw?.status) ?? "");

/** eero's 2.2 support object has no ISP contacts, so `isp` is null; core may name the ISP. */
export function mapSupport(raw: RawSupport | null | undefined): Omit<M.SupportInfo, "supportId"> {
  return {
    eero: {
      name: str(raw?.name),
      phone: str(raw?.support_phone),
      email: null,
      helpUrl: str(raw?.help_url),
      contactUrl: str(raw?.contact_url),
      emailFormUrl: str(raw?.email_web_form_url),
    },
    isp: null,
  };
}

// ---------------------------------------------------------------------------
// Placement and coverage (M5.8). Shapes not captured: read every likely field.

const text = (v: RawText | null | undefined): string | null => (typeof v === "string" ? str(v) : v ? (str(v.message) ?? str(v.text) ?? str(v.title)) : null);
const texts = (...lists: (RawText[] | undefined)[]): string[] => lists.flatMap((l) => (Array.isArray(l) ? l : [])).flatMap((t) => text(t) ?? []);
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

/** Link quality 0 to 100 from a score, or from 0 to 5 bars (each worth 20). */
const quality = (r: RawCoverageRoom): number | null => {
  const pct = num(r.quality) ?? num(r.score) ?? num(r.coverage_score);
  const bars = num(r.bars);
  const v = pct ?? (bars === null ? null : bars * 20);
  return v === null ? null : Math.round(Math.max(0, Math.min(100, v)));
};

export function mapCoverageScan(raw: RawCoverageScan | null | undefined): M.CoverageScan {
  const rows = raw?.rooms ?? raw?.eeros ?? raw?.nodes ?? [];
  return {
    scannedAt: str(raw?.scanned_at) ?? str(raw?.timestamp),
    rooms: (Array.isArray(rows) ? rows : []).flatMap((r) => {
      const eeroId = idOf(r?.eero_id, r?.url);
      if (!eeroId) return [];
      const devices = Array.isArray(r.devices) ? r.devices.length : (num(r.device_count) ?? num(r.devices));
      return [{ eeroId, location: str(r.location) ?? "", quality: quality(r), devices, servedBy: idOf(null, r.served_by ?? r.upstream) }];
    }),
    advice: texts(raw?.advice, raw?.recommendations),
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

export function mapGenerationScan(raw: RawGenerationScan | null | undefined): M.UpgradeReport {
  const counts = new Map<Generation, number>();
  const add = (g: unknown, n: unknown) => {
    const gen = generationOf(g);
    const count = num(n);
    if (gen && count !== null) counts.set(gen, (counts.get(gen) ?? 0) + count);
  };
  const gens = raw?.generations;
  if (Array.isArray(gens)) for (const g of gens) add(g?.generation, g?.count ?? g?.devices);
  else if (gens && typeof gens === "object") for (const [g, n] of Object.entries(gens)) add(g, n);
  return {
    byGeneration: [...counts].map(([generation, devices]) => ({ generation, devices })),
    limitingEeros: (raw?.limiting_eeros ?? []).flatMap((e) => {
      const eeroId = idOf(e?.eero_id, e?.url);
      return eeroId ? [{ eeroId, reason: text(e.reason) ?? "Holds some devices back" }] : [];
    }),
    notes: texts(raw?.notes, raw?.insights),
  };
}
