/**
 * A ring split into segments (for example devices by band), with free
 * content in the middle. Fixed pixel size, so circles stay circles.
 * Segments have straight (butt) ends with a small gap between them.
 */
import { type ReactNode, useState } from "react";

import { formatPercent } from "../../../../core/format";
import { cn } from "~/lib/utils";

import type { ShareSegment } from "./ShareBar";
import { fadeClass } from "./Tooltip";

export function Donut({
  segments,
  ariaLabel,
  size = 132,
  thickness = 14,
  gap = 3,
  format,
  children,
  loading,
  className,
}: {
  segments: ReadonlyArray<ShareSegment>;
  ariaLabel: string;
  size?: number;
  thickness?: number;
  /** Gap between segments along the ring, in px. */
  gap?: number;
  /** Formats values for the hover line under the centre content. */
  format?: (value: number) => string;
  /** Centre content, e.g. a total. */
  children?: ReactNode;
  loading?: boolean;
  className?: string;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const visible = segments.filter((s) => Number.isFinite(s.value) && s.value > 0);
  const total = visible.reduce((sum, s) => sum + s.value, 0);
  const segmentGap = visible.length > 1 ? gap : 0;

  let offset = 0;
  const arcs = visible.map((s, i) => {
    const length = (s.value / total) * c;
    const dash = Math.max(0.01, length - segmentGap);
    const arc = { segment: s, index: i, dash, offset };
    offset += length;
    return arc;
  });
  const active = hovered === null ? undefined : visible[hovered];

  return (
    <div
      className={cn("relative shrink-0", className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={ariaLabel}
    >
      <svg width={size} height={size} aria-hidden className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={thickness}
          className="text-muted-foreground/15"
        />
        <g className={fadeClass(loading)}>
          {arcs.map((a) => (
            <circle
              key={a.segment.label}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={a.segment.color}
              strokeWidth={thickness}
              strokeLinecap="butt"
              strokeDasharray={`${a.dash} ${c}`}
              strokeDashoffset={-(a.offset + segmentGap / 2)}
              className={cn("transition-opacity", hovered !== null && hovered !== a.index && "opacity-50")}
              onPointerEnter={() => setHovered(a.index)}
              onPointerLeave={() => setHovered(null)}
            />
          ))}
        </g>
      </svg>
      <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
        {active !== undefined && format !== undefined ? (
          <div className="flex flex-col items-center">
            <span className="text-3xs font-semibold tracking-widest text-muted-foreground/70 uppercase">
              {active.label}
            </span>
            <span className="text-base font-medium tabular-nums">{format(active.value)}</span>
            <span className="text-3xs text-muted-foreground tabular-nums">
              {formatPercent((active.value / total) * 100)}
            </span>
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
