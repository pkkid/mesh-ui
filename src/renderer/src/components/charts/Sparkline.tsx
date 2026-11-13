/**
 * A tiny line with no labels, for table rows and eero rows. Same monotone
 * curve and 12% area as AreaChart; the last point gets a dot.
 */
import { cn } from "~/lib/utils";

import { areaPath, linePath } from "./curve";
import { clean } from "./scale";
import { fadeClass } from "./Tooltip";

const W = 200;
const H = 40;
const TOP = 3;

export function Sparkline({
  values,
  color,
  ariaLabel,
  fill = true,
  dot = true,
  loading,
  className,
}: {
  values: ReadonlyArray<number>;
  /** From chartColors.ts. */
  color: string;
  ariaLabel: string;
  fill?: boolean;
  dot?: boolean;
  loading?: boolean;
  /** Size of the box; defaults to full width, 32px tall. */
  className?: string;
}) {
  const data = values.map((v) => clean(v));
  const peak = Math.max(0, ...data);
  const y = (v: number) => (peak <= 0 ? H : H - (v / peak) * (H - TOP));
  const stepX = data.length < 2 ? 0 : W / (data.length - 1);
  const points = data.map((v, i) => ({ x: i * stepX, y: y(v) }));
  const last = points[points.length - 1];
  const drawable = points.length >= 2 && peak > 0;

  return (
    <div className={cn("relative h-8 w-full", className)} role="img" aria-label={ariaLabel}>
      <svg className="h-full w-full overflow-visible" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
        {drawable ? (
          <g className={fadeClass(loading)}>
            {fill ? <path d={areaPath(points, H)} fill={color} fillOpacity={0.12} /> : null}
            <path
              d={linePath(points)}
              fill="none"
              stroke={color}
              strokeWidth={1.75}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        ) : (
          <line
            x1={0}
            x2={W}
            y1={H}
            y2={H}
            stroke="currentColor"
            strokeWidth={1}
            className="text-border"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      {/* An HTML dot stays round while the SVG stretches. */}
      {drawable && dot && last !== undefined ? (
        <span
          aria-hidden
          className={cn("absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full", fadeClass(loading))}
          style={{ left: `${(last.x / W) * 100}%`, top: `${(last.y / H) * 100}%`, backgroundColor: color }}
        />
      ) : null}
    </div>
  );
}
