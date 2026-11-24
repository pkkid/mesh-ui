/**
 * A tiny two-series chart for table rows (Devices, Live chart): the same
 * monotone line and 12% area as AreaChart, every series on one scale from the
 * largest single series, no labels or gridlines. Below two points, or with
 * nothing moving, it draws a 1px baseline.
 */
import { cn } from "~/lib/utils";

import { areaPath, linePath } from "./curve";
import { clean } from "./scale";

const W = 200;
const H = 40;
const TOP = 3;

export type MiniSeries = { id: string; color: string; values: ReadonlyArray<number> };

export function MiniArea({ series, ariaLabel, className }: { series: ReadonlyArray<MiniSeries>; ariaLabel: string; className?: string }) {
  const data = series.map((s) => ({ ...s, values: s.values.map((v) => clean(v)) }));
  const peak = Math.max(0, ...data.flatMap((s) => s.values));
  const count = Math.max(0, ...data.map((s) => s.values.length));
  const drawable = count >= 2 && peak > 0;
  const stepX = count < 2 ? 0 : W / (count - 1);
  const points = (values: ReadonlyArray<number>) => values.map((v, i) => ({ x: i * stepX, y: H - (v / peak) * (H - TOP) }));
  // Largest series first, so a small one sits on top.
  const ordered = [...data].sort((a, b) => Math.max(0, ...b.values) - Math.max(0, ...a.values));

  return (
    <div className={cn("h-6 w-16", className)} role="img" aria-label={ariaLabel}>
      <svg className="h-full w-full overflow-visible" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
        {drawable ? (
          <>
            {ordered.map((s) => (
              <path key={`a-${s.id}`} d={areaPath(points(s.values), H)} fill={s.color} fillOpacity={0.12} />
            ))}
            {ordered.map((s) => (
              <path
                key={`l-${s.id}`}
                d={linePath(points(s.values))}
                fill="none"
                stroke={s.color}
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </>
        ) : (
          <line x1={0} x2={W} y1={H} y2={H} stroke="currentColor" strokeWidth={1} className="text-border" vectorEffect="non-scaling-stroke" />
        )}
      </svg>
    </div>
  );
}
