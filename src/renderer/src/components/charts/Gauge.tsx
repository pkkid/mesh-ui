/**
 * A 240 degree arc for a speed test result: a muted track, the value arc in
 * the series colour, quiet ticks, and the figure in the middle.
 */
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";

import { fadeClass } from "./Tooltip";

const START = 150;
const SWEEP = 240;
const TICKS = 12;

export function Gauge({
  value,
  max,
  color,
  label,
  text,
  unit,
  ariaLabel,
  size = 180,
  thickness = 12,
  loading,
  className,
}: {
  /** Null shows an empty track and "-". */
  value: number | null;
  max: number;
  /** From chartColors.ts. */
  color: string;
  label?: ReactNode;
  /** The formatted figure; defaults to the value. */
  text?: ReactNode;
  unit?: ReactNode;
  ariaLabel: string;
  size?: number;
  thickness?: number;
  loading?: boolean;
  className?: string;
}) {
  const r = (size - thickness) / 2 - 2;
  const cx = size / 2;
  const cy = size / 2;
  const fraction = value === null || max <= 0 ? 0 : Math.min(1, Math.max(0, value / max));
  const at = (deg: number, radius = r) => {
    const rad = (deg * Math.PI) / 180;
    return [cx + radius * Math.cos(rad), cy + radius * Math.sin(rad)] as const;
  };
  const arc = (from: number, to: number) => {
    const [x1, y1] = at(from);
    const [x2, y2] = at(to);
    return `M${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2.toFixed(2)},${y2.toFixed(2)}`;
  };

  const ticks = Array.from({ length: TICKS + 1 }, (_, k) => {
    const deg = START + (SWEEP * k) / TICKS;
    const major = k % 3 === 0;
    const [x1, y1] = at(deg, r - thickness / 2 - 6);
    const [x2, y2] = at(deg, r - thickness / 2 - (major ? 12 : 9));
    return { k, x1, y1, x2, y2, major };
  });

  return (
    <div
      className={cn("relative shrink-0", className)}
      style={{ width: size, height: size * 0.86 }}
      role="img"
      aria-label={ariaLabel}
    >
      <svg width={size} height={size} className="overflow-visible" aria-hidden>
        <path
          d={arc(START, START + SWEEP)}
          fill="none"
          stroke="currentColor"
          strokeWidth={thickness}
          strokeLinecap="round"
          className="text-muted-foreground/15"
        />
        {fraction > 0 ? (
          <path
            d={arc(START, START + SWEEP * fraction)}
            fill="none"
            stroke={color}
            strokeWidth={thickness}
            strokeLinecap="round"
            className={fadeClass(loading)}
          />
        ) : null}
        <g className="text-muted-foreground/60">
          {ticks.map((t) => (
            <line
              key={t.k}
              x1={t.x1}
              y1={t.y1}
              x2={t.x2}
              y2={t.y2}
              stroke="currentColor"
              strokeWidth={t.major ? 1.5 : 1}
            />
          ))}
        </g>
      </svg>
      <div className={cn("absolute inset-x-0 text-center", fadeClass(loading))} style={{ top: size * 0.3 }}>
        {label === undefined ? null : (
          <div className="text-3xs font-semibold tracking-widest text-muted-foreground/70 uppercase">{label}</div>
        )}
        <div
          className="font-semibold tracking-tighter tabular-nums"
          style={{ fontSize: size * 0.19, lineHeight: 1.1 }}
        >
          {value === null ? "-" : (text ?? value)}
        </div>
        {unit === undefined ? null : <div className="text-xs text-muted-foreground">{unit}</div>}
      </div>
    </div>
  );
}
