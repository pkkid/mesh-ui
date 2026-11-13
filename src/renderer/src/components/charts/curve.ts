/**
 * Monotone cubic interpolation (Fritsch-Carlson), ported from T3 Code's
 * `monotoneTangents` / `smoothCurve` (apps/web/src/components/usage/
 * UsageProviderChart.tsx). Each segment stays between the y values of its two
 * end points, so a line never overshoots the data or dips below zero.
 */

export type Point = { readonly x: number; readonly y: number };

export type CurveSegment = {
  readonly from: Point;
  readonly c1: Point;
  readonly c2: Point;
  readonly to: Point;
};

export function monotoneTangents(points: ReadonlyArray<Point>): number[] {
  const count = points.length;
  if (count < 2) return [0];

  const slopes: number[] = [];
  for (let i = 0; i < count - 1; i += 1) {
    const dx = (points[i + 1]?.x ?? 0) - (points[i]?.x ?? 0);
    const dy = (points[i + 1]?.y ?? 0) - (points[i]?.y ?? 0);
    slopes.push(dx === 0 ? 0 : dy / dx);
  }

  const tangents: number[] = Array.from({ length: count }, () => 0);
  tangents[0] = slopes[0] ?? 0;
  tangents[count - 1] = slopes[count - 2] ?? 0;
  for (let i = 1; i < count - 1; i += 1) {
    const previous = slopes[i - 1] ?? 0;
    const next = slopes[i] ?? 0;
    // A local peak or valley gets a flat tangent, so the curve turns at the point.
    tangents[i] = previous * next <= 0 ? 0 : (previous + next) / 2;
  }

  for (let i = 0; i < count - 1; i += 1) {
    const slope = slopes[i] ?? 0;
    if (slope === 0) {
      tangents[i] = 0;
      tangents[i + 1] = 0;
      continue;
    }
    const a = (tangents[i] ?? 0) / slope;
    const b = (tangents[i + 1] ?? 0) / slope;
    const magnitude = a * a + b * b;
    if (magnitude > 9) {
      const scale = 3 / Math.sqrt(magnitude);
      tangents[i] = scale * a * slope;
      tangents[i + 1] = scale * b * slope;
    }
  }

  return tangents;
}

export function smoothCurve(points: ReadonlyArray<Point>): CurveSegment[] {
  if (points.length < 2) return [];
  const tangents = monotoneTangents(points);
  const segments: CurveSegment[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const from = points[i];
    const to = points[i + 1];
    if (from === undefined || to === undefined) continue;
    const dx = to.x - from.x;
    segments.push({
      from,
      c1: { x: from.x + dx / 3, y: from.y + ((tangents[i] ?? 0) * dx) / 3 },
      c2: { x: to.x - dx / 3, y: to.y - ((tangents[i + 1] ?? 0) * dx) / 3 },
      to,
    });
  }
  return segments;
}

const f = (n: number) => n.toFixed(2);

/** SVG path data for a smooth line through the points. */
export function linePath(points: ReadonlyArray<Point>): string {
  const first = points[0];
  if (first === undefined) return "";
  if (points.length === 1) return `M${f(first.x)},${f(first.y)}`;
  let path = `M${f(first.x)},${f(first.y)}`;
  for (const s of smoothCurve(points)) {
    path += ` C${f(s.c1.x)},${f(s.c1.y)} ${f(s.c2.x)},${f(s.c2.y)} ${f(s.to.x)},${f(s.to.y)}`;
  }
  return path;
}

/** Closes a line path down to `baseY` for the soft area under it. */
export function areaPath(points: ReadonlyArray<Point>, baseY: number): string {
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined || points.length < 2) return "";
  return `${linePath(points)} L${f(last.x)},${f(baseY)} L${f(first.x)},${f(baseY)} Z`;
}

/** The band between a stacked series' top and the series below it. */
export function bandPath(top: ReadonlyArray<Point>, base: ReadonlyArray<Point>): string {
  if (top.length < 2 || base.length !== top.length) return "";
  const back = linePath([...base].reverse());
  return `${linePath(top)} L${back.slice(1)} Z`;
}

/** A point on a cubic segment at t in [0, 1]. Used by tests and hit testing. */
export function pointAt(s: CurveSegment, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * s.from.x + b * s.c1.x + c * s.c2.x + d * s.to.x,
    y: a * s.from.y + b * s.c1.y + c * s.c2.y + d * s.to.y,
  };
}
