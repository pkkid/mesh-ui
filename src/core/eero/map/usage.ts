/**
 * Raw eero data usage to the model: `{series: [{type, sum, values}]}` charts
 * and the per-device, per-profile and per-eero breakdown rows. Shapes are in
 * docs/eero-api/data-model.md (Charts) and docs/architecture/data-model.md
 * (Internet, speed and usage). Totals, busiest bucket and "today so far" are
 * computed in core (src/core/commands/usage.ts), not here.
 */

import type * as M from "../../model";
import type { RawBreakdownRow, RawUsage, RawUsageSeries } from "../raw";
import { compactMac, idFromUrl } from "../urls";

/** A byte count from eero: whole, finite and not negative, else 0. */
export function bytes(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
}

/** Zips the `download` and `upload` series by `time` into points, oldest first. */
export function mapUsagePoints(raw: RawUsage | null | undefined): M.UsagePoint[] {
  const byTime = new Map<number, { down: number; up: number }>();
  for (const s of raw?.series ?? []) {
    const key = s.type === "download" ? "down" : s.type === "upload" ? "up" : null;
    if (!key) continue;
    for (const v of s.values ?? []) {
      const t = typeof v.time === "string" ? Date.parse(v.time) : Number.NaN;
      if (!Number.isFinite(t)) continue;
      const p = byTime.get(t) ?? { down: 0, up: 0 };
      p[key] += bytes(v.value);
      byTime.set(t, p);
    }
  }
  return [...byTime.entries()].sort(([a], [b]) => a - b).map(([t, p]) => ({ at: new Date(t).toISOString(), ...p }));
}

/** Down and up totals of a chart: each series' `sum`, or its values added up when `sum` is missing. */
export function usageTotals(raw: RawUsage | null | undefined): { down: number; up: number } {
  const total = { down: 0, up: 0 };
  for (const s of raw?.series ?? []) {
    const key = s.type === "download" ? "down" : s.type === "upload" ? "up" : null;
    if (key) total[key] += seriesSum(s);
  }
  return total;
}

function seriesSum(s: RawUsageSeries): number {
  if (typeof s.sum === "number") return bytes(s.sum);
  return (s.values ?? []).reduce((n, v) => n + bytes(v.value), 0);
}

/** A breakdown row as eero may send it: flat totals, or a chart of its own. */
export type RawUsageRow = RawBreakdownRow & { location?: string; series?: RawUsageSeries[] };

const text = (...vs: unknown[]): string | null => {
  for (const v of vs) if (typeof v === "string" && v.trim()) return v.trim();
  return null;
};

const FALLBACK_NAME: Record<M.UsageBreakdown["by"], string> = { device: "Unknown device", profile: "Unnamed profile", eero: "eero" };

/** One breakdown row; `share` is left 0 for core to fill in. */
export function mapBreakdownRow(row: RawUsageRow, by: M.UsageBreakdown["by"]): M.UsageBreakdownRow {
  const urlId = typeof row.url === "string" ? idFromUrl(row.url) : null;
  const id =
    by === "device"
      ? typeof row.mac === "string" && row.mac
        ? compactMac(row.mac)
        : urlId
      : (urlId ?? (row.id !== undefined && row.id !== null ? String(row.id) : null));
  const name =
    by === "device"
      ? text(row.nickname, row.display_name, row.name, row.hostname, row.mac)
      : by === "eero"
        ? text(row.location, row.name, row.display_name)
        : text(row.name, row.display_name);
  const fromSeries = row.series ? usageTotals({ series: row.series }) : null;
  return {
    id: id || null,
    name: name ?? FALLBACK_NAME[by],
    down: row.download !== undefined ? bytes(row.download) : (fromSeries?.down ?? 0),
    up: row.upload !== undefined ? bytes(row.upload) : (fromSeries?.up ?? 0),
    share: 0,
  };
}
