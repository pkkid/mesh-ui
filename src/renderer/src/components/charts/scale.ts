/**
 * Shared geometry for the chart kit: the fixed viewBox, nice ticks and the
 * value-to-y mapping. Ported from T3 Code's usage chart
 * (apps/web/src/components/usage/UsageProviderChart.tsx). Pure functions, no
 * React, so they are unit tested in charts.test.ts.
 */

/** Every main chart draws into this viewBox and stretches to its box. */
export const VIEW_WIDTH = 960;
export const VIEW_HEIGHT = 260;
/** Headroom above the top tick so a 2px line at the max is not clipped. */
export const PLOT_TOP = 8;
/** About this many steps between zero and the top tick. */
export const TICK_COUNT = 4;

export type Scale = {
  /** Value at the top tick. Zero when there is nothing to show. */
  max: number;
  ticks: readonly number[];
  /** False for placeholder gridlines (loading or empty), which have no labels. */
  labeled: boolean;
};

/**
 * Ticks at 0, step, 2 * step ... covering `peak`, where step is 1, 2 or 5
 * times a power of ten, giving about `count` steps.
 */
export function niceScale(peak: number, count = TICK_COUNT): { max: number; ticks: readonly number[] } {
  if (!Number.isFinite(peak) || peak <= 0) return { max: 0, ticks: [0] };

  const rawStep = peak / count;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const step = (normalized > 5 ? 10 : normalized > 2 ? 5 : normalized > 1 ? 2 : 1) * magnitude;

  const max = Math.ceil(peak / step - 1e-9) * step;
  const ticks: number[] = [];
  // Multiply instead of accumulating so 0.1 + 0.2 style drift never shows.
  for (let i = 0; i * step <= max + step * 1e-6; i += 1) ticks.push(roundTick(i * step, step));
  return { max: roundTick(max, step), ticks };
}

function roundTick(value: number, step: number): number {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  return Number(value.toFixed(decimals));
}

/** Evenly spaced unlabelled gridlines for loading and empty states. */
export const PLACEHOLDER_SCALE: Scale = {
  max: TICK_COUNT,
  ticks: Array.from({ length: TICK_COUNT + 1 }, (_, i) => i),
  labeled: false,
};

/**
 * Scale for series drawn on one plot. Overlapping series each start at zero,
 * so the peak is the largest single value, not the sum. Stacked series use
 * the largest column total. A `fixedMax` (for example the internet plan)
 * sets the top of the scale; values above it still fit, so nothing is
 * clipped. With no data the placeholder gridlines show either way.
 */
export function seriesScale(series: ReadonlyArray<ReadonlyArray<number>>, stacked = false, fixedMax?: number | null): Scale {
  let peak = 0;
  const length = Math.max(0, ...series.map((s) => s.length));
  for (let i = 0; i < length; i += 1) {
    let sum = 0;
    for (const values of series) {
      const v = clean(values[i]);
      sum += v;
      if (!stacked) peak = Math.max(peak, v);
    }
    if (stacked) peak = Math.max(peak, sum);
  }
  if (peak <= 0) return PLACEHOLDER_SCALE;
  const top = fixedMax !== undefined && fixedMax !== null && Number.isFinite(fixedMax) && fixedMax > 0 ? Math.max(fixedMax, peak) : peak;
  return { ...niceScale(top), labeled: true };
}

/** A finite, non-negative number; anything else counts as zero. */
export function clean(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/** True when there is at least one positive value to draw. */
export function hasData(series: ReadonlyArray<ReadonlyArray<number>>): boolean {
  return series.some((values) => values.some((v) => clean(v) > 0));
}

/** y in viewBox units for a value; zero sits on the bottom edge. */
export function valueToY(value: number, max: number, height = VIEW_HEIGHT, top = PLOT_TOP): number {
  if (max <= 0) return height;
  return height - (Math.min(Math.max(value, 0), max) / max) * (height - top);
}

/** The point index nearest a horizontal fraction (0 to 1) of the plot. */
export function nearestIndex(fraction: number, count: number): number {
  if (count <= 1) return 0;
  const index = Math.round(Math.min(1, Math.max(0, fraction)) * (count - 1));
  return Math.min(count - 1, Math.max(0, index));
}

/** The equal-width slot (bar column, heatmap cell) under a fraction (0 to 1). */
export function slotIndex(fraction: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(count - 1, Math.max(0, Math.floor(fraction * count)));
}

/** Start, middle and end labels for the x axis. */
export function edgeLabels(labels: ReadonlyArray<string>): [string, string, string] {
  if (labels.length === 0) return ["", "", ""];
  return [labels[0] ?? "", labels[Math.floor(labels.length / 2)] ?? "", labels[labels.length - 1] ?? ""];
}

/** Heatmap colour strength for a value share (0 to 1): 8% to 96% of the series colour. */
export function heatStrength(fraction: number): number {
  return Math.round(8 + Math.min(1, Math.max(0, fraction)) * 88);
}
