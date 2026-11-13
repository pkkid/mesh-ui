import { describe, expect, it } from "vitest";

import { areaPath, linePath, pointAt, smoothCurve, type Point } from "./curve";
import {
  PLACEHOLDER_SCALE,
  VIEW_HEIGHT,
  edgeLabels,
  hasData,
  heatStrength,
  nearestIndex,
  niceScale,
  seriesScale,
  slotIndex,
  valueToY,
} from "./scale";

/** Every tick step must be 1, 2 or 5 times a power of ten. */
function isNiceStep(step: number): boolean {
  const magnitude = 10 ** Math.floor(Math.log10(step));
  const normalized = Math.round((step / magnitude) * 1e6) / 1e6;
  return [1, 2, 5, 10].includes(normalized);
}

/** Deterministic pseudo-random values for property-style tests. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe("niceScale", () => {
  it("picks 1, 2 or 5 steps with about four ticks", () => {
    expect(niceScale(100)).toEqual({ max: 100, ticks: [0, 50, 100] });
  });

  it.each([
    [1, 1, [0, 0.5, 1]],
    [7, 8, [0, 2, 4, 6, 8]],
    [9.5, 10, [0, 5, 10]],
    [18, 20, [0, 5, 10, 15, 20]],
    [43, 60, [0, 20, 40, 60]],
    [380, 400, [0, 100, 200, 300, 400]],
    [0.03, 0.03, [0, 0.01, 0.02, 0.03]],
    [1234, 1500, [0, 500, 1000, 1500]],
  ])("peak %s -> max %s", (peak, max, ticks) => {
    expect(niceScale(peak)).toEqual({ max, ticks });
  });

  it("covers the peak with nice, evenly spaced ticks for any input", () => {
    const next = rng(7);
    for (let i = 0; i < 2000; i += 1) {
      const peak = 10 ** (next() * 12 - 4) * (1 + next());
      const { max, ticks } = niceScale(peak);
      expect(max).toBeGreaterThanOrEqual(peak * (1 - 1e-9));
      expect(ticks[0]).toBe(0);
      expect(ticks[ticks.length - 1]).toBeCloseTo(max, 9);
      expect(ticks.length).toBeGreaterThanOrEqual(3);
      expect(ticks.length).toBeLessThanOrEqual(6);
      const step = (ticks[1] ?? 0) - (ticks[0] ?? 0);
      expect(isNiceStep(step)).toBe(true);
      for (let k = 1; k < ticks.length; k += 1) {
        expect((ticks[k] ?? 0) - (ticks[k - 1] ?? 0)).toBeCloseTo(step, 9);
      }
      // The top tick is never more than one step above the peak.
      expect(max - peak).toBeLessThan(step + step * 1e-9);
    }
  });

  it("has no floating point noise in tick values", () => {
    expect(niceScale(0.7).ticks).toEqual([0, 0.2, 0.4, 0.6, 0.8]);
    expect(niceScale(0.29).ticks).toEqual([0, 0.1, 0.2, 0.3]);
  });

  it("returns a single zero tick for no data", () => {
    expect(niceScale(0)).toEqual({ max: 0, ticks: [0] });
    expect(niceScale(-5)).toEqual({ max: 0, ticks: [0] });
    expect(niceScale(Number.NaN)).toEqual({ max: 0, ticks: [0] });
  });
});

describe("seriesScale", () => {
  it("scales overlapping series to the largest single series, not the sum", () => {
    const scale = seriesScale([
      [10, 40, 20],
      [30, 35, 10],
    ]);
    expect(scale.max).toBe(40);
    expect(scale.labeled).toBe(true);
  });

  it("scales stacked series to the largest column total", () => {
    expect(seriesScale([[10, 40, 20], [30, 35, 10]], true).max).toBe(80);
  });

  it("falls back to unlabelled placeholder gridlines with no data", () => {
    expect(seriesScale([])).toBe(PLACEHOLDER_SCALE);
    expect(seriesScale([[0, 0, 0]])).toBe(PLACEHOLDER_SCALE);
    expect(PLACEHOLDER_SCALE.labeled).toBe(false);
    expect(hasData([[0, Number.NaN, -1]])).toBe(false);
  });
});

describe("valueToY", () => {
  it("puts zero on the bottom edge and clamps out of range values", () => {
    expect(valueToY(0, 100)).toBe(VIEW_HEIGHT);
    expect(valueToY(-10, 100)).toBe(VIEW_HEIGHT);
    expect(valueToY(500, 100)).toBe(valueToY(100, 100));
    expect(valueToY(5, 0)).toBe(VIEW_HEIGHT);
  });
});

describe("monotone curve", () => {
  const toPoints = (values: number[], max: number): Point[] =>
    values.map((v, i) => ({ x: i * 40, y: valueToY(v, max) }));

  /**
   * Samples every segment and returns the first sample that leaves its end
   * points' y range, dips below zero or folds back in x; null when none does.
   * Plain comparisons, one expect per series: an expect per sample made the
   * random-data test take seconds.
   */
  function firstOvershoot(values: number[]): string | null {
    const max = Math.max(...values, 1);
    const points = toPoints(values, max);
    const segments = smoothCurve(points);
    if (segments.length !== points.length - 1) return `expected ${points.length - 1} segments, got ${segments.length}`;
    const eps = 1e-9;
    for (const [i, s] of segments.entries()) {
      const lo = Math.min(s.from.y, s.to.y) - eps;
      const hi = Math.max(s.from.y, s.to.y) + eps;
      for (let t = 0; t <= 1; t += 1 / 64) {
        const p = pointAt(s, t);
        // y outside the end points overshoots; past VIEW_HEIGHT is below zero;
        // x outside the segment means the line folds back on itself.
        if (p.y < lo || p.y > hi || p.y > VIEW_HEIGHT + eps || p.x < s.from.x - eps || p.x > s.to.x + eps) {
          return `segment ${i} at t=${t.toFixed(3)}: (${p.x}, ${p.y}) outside y ${lo}..${hi} in [${values.join(", ")}]`;
        }
      }
    }
    return null;
  }

  const expectNoOvershoot = (values: number[]) => expect(firstOvershoot(values)).toBeNull();

  it("does not overshoot a spike or dip below zero after it", () => {
    // The classic Catmull-Rom failure: zeros around a spike swing negative.
    expectNoOvershoot([0, 0, 0, 100, 0, 0, 0]);
    expectNoOvershoot([0, 100, 0, 100, 0]);
    expectNoOvershoot([5, 0, 80, 79, 0, 3]);
  });

  it("stays flat across flat runs", () => {
    const segments = smoothCurve(toPoints([0, 0, 0, 0], 10));
    for (const s of segments) for (let t = 0; t <= 1; t += 0.25) expect(pointAt(s, t).y).toBe(VIEW_HEIGHT);
  });

  it("never overshoots on random data", () => {
    const next = rng(42);
    for (let run = 0; run < 300; run += 1) {
      const length = 2 + Math.floor(next() * 40);
      const values = Array.from({ length }, () => (next() < 0.3 ? 0 : next() * 1000));
      expectNoOvershoot(values);
    }
  });

  it("passes through every data point", () => {
    const points = toPoints([3, 9, 4, 12], 12);
    const segments = smoothCurve(points);
    segments.forEach((s, i) => {
      expect(pointAt(s, 0)).toEqual(points[i]);
      const end = pointAt(s, 1);
      expect(end.x).toBeCloseTo(points[i + 1]!.x, 9);
      expect(end.y).toBeCloseTo(points[i + 1]!.y, 9);
    });
  });

  it("builds SVG paths and closes the area to the baseline", () => {
    const points = toPoints([1, 2], 2);
    expect(linePath(points)).toMatch(/^M0\.00,\d+\.\d\d C/);
    expect(areaPath(points, VIEW_HEIGHT)).toMatch(/L40\.00,260\.00 L0\.00,260\.00 Z$/);
    expect(linePath([])).toBe("");
    expect(areaPath(points.slice(0, 1), VIEW_HEIGHT)).toBe("");
  });
});

describe("axis helpers", () => {
  it("labels only start, middle and end", () => {
    expect(edgeLabels(["a", "b", "c", "d", "e"])).toEqual(["a", "c", "e"]);
    expect(edgeLabels([])).toEqual(["", "", ""]);
  });

  it("maps pointer fractions to the nearest point or slot", () => {
    expect(nearestIndex(0, 5)).toBe(0);
    expect(nearestIndex(0.49, 5)).toBe(2);
    expect(nearestIndex(1.2, 5)).toBe(4);
    expect(nearestIndex(0.5, 1)).toBe(0);
    expect(slotIndex(0.99, 4)).toBe(3);
    expect(slotIndex(1, 4)).toBe(3);
    expect(slotIndex(0.26, 4)).toBe(1);
  });

  it("keeps heatmap strength between 8% and 96%", () => {
    expect(heatStrength(0)).toBe(8);
    expect(heatStrength(1)).toBe(96);
    expect(heatStrength(2)).toBe(96);
  });
});
