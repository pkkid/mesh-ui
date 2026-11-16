/**
 * A ring split into segments (for example devices by band), with free
 * content in the middle. Fixed pixel size, so circles stay circles.
 * Segments have straight (butt) ends with a small gap between them.
 *
 * The centre stays put (a total). Hovering a segment dims the others and
 * shows its name, value and share in a tooltip that follows the pointer. Pass `active` and `onActiveChange` to drive the same highlight
 * from a legend (see `DonutLegendRow`).
 */
import { type ReactNode, useState } from "react";

import { formatCount, formatPercent } from "../../../../core/format";
import { cn } from "~/lib/utils";

import type { ShareSegment } from "./ShareBar";
import { fadeClass, FloatingTooltip } from "./Tooltip";

/** Ring thickness as a share of the size, so every donut has the same weight (13px at 96px). */
export const DONUT_THICKNESS = 0.135;

/** Room kept between the centre content and the inside of the ring, in px. */
const CENTRE_PADDING = 8;

export function Donut({
  segments,
  ariaLabel,
  size = 132,
  thickness: thicknessProp,
  gap = 3,
  format,
  active,
  onActiveChange,
  children,
  loading,
  className,
}: {
  segments: ReadonlyArray<ShareSegment>;
  ariaLabel: string;
  size?: number;
  /** Ring width in px. Leave it out: the default keeps every donut the same weight. */
  thickness?: number;
  /** Gap between segments along the ring, in px. */
  gap?: number;
  /** Formats a value for the tooltip ("12 devices"). Defaults to the plain count. */
  format?: (value: number) => string;
  /** Label of the highlighted segment, when a caller (its legend) controls it. */
  active?: string | null;
  /** Called with a segment's label when the pointer enters it, and null when it leaves. */
  onActiveChange?: (label: string | null) => void;
  /** Centre content: the total, always shown. Kept inside the hole. */
  children?: ReactNode;
  loading?: boolean;
  className?: string;
}) {
  const [ownActive, setOwnActive] = useState<string | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const thickness = thicknessProp ?? Math.round(size * DONUT_THICKNESS);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const visible = segments.filter((s) => Number.isFinite(s.value) && s.value > 0);
  const total = visible.reduce((sum, s) => sum + s.value, 0);
  const segmentGap = visible.length > 1 ? gap : 0;
  const hole = Math.max(0, size - 2 * thickness - CENTRE_PADDING);

  const activeLabel = active === undefined ? ownActive : active;
  const current = visible.find((s) => s.label === activeLabel);
  const setActive = (label: string | null) => {
    setOwnActive(label);
    onActiveChange?.(label);
  };

  let offset = 0;
  const arcs = visible.map((s) => {
    const length = (s.value / total) * c;
    const dash = Math.max(0.01, length - segmentGap);
    const arc = { segment: s, dash, offset };
    offset += length;
    return arc;
  });

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
              className={cn("transition-opacity", current !== undefined && current !== a.segment && "opacity-50")}
              onPointerEnter={(e) => {
                setPointer({ x: e.clientX, y: e.clientY });
                setActive(a.segment.label);
              }}
              onPointerMove={(e) => setPointer({ x: e.clientX, y: e.clientY })}
              onPointerLeave={() => {
                setPointer(null);
                setActive(null);
              }}
            />
          ))}
        </g>
      </svg>
      <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
        <div className="flex min-w-0 flex-col items-center overflow-hidden" style={{ maxWidth: hole }}>
          {children}
        </div>
      </div>
      {current !== undefined && pointer !== null && (
        <FloatingTooltip at={{ pointer }} className="whitespace-nowrap">
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: current.color }} />
              {current.label}
            </span>
            <span className="tabular-nums">
              {format ? format(current.value) : formatCount(current.value)} · {formatPercent((current.value / total) * 100)}
            </span>
          </span>
        </FloatingTooltip>
      )}
    </div>
  );
}

/**
 * A legend row beside a donut: colour square, muted label and a value on the
 * right. Hovering it highlights its segment; while a segment is highlighted
 * its row gets a faint fill and the other rows dim.
 */
export function DonutLegendRow({
  label,
  color,
  active,
  onActiveChange,
  className,
  children,
}: {
  label: string;
  color: string;
  /** Label of the highlighted segment, or null. */
  active: string | null;
  onActiveChange: (label: string | null) => void;
  className?: string;
  /** The value(s) on the right. */
  children: ReactNode;
}) {
  const on = active === label;
  return (
    <div
      className={cn(
        "-mx-1 flex items-center justify-between gap-2 rounded-sm px-1 transition-opacity",
        on && "bg-muted-foreground/12",
        active !== null && !on && "opacity-50",
        className,
      )}
      onPointerEnter={() => onActiveChange(label)}
      onPointerLeave={() => onActiveChange(null)}
    >
      <span className={cn("flex min-w-0 items-center gap-1.5", on ? "text-foreground" : "text-muted-foreground")}>
        <span aria-hidden className="size-2 shrink-0 rounded-[2px]" style={{ background: color }} />
        <span className="truncate">{label}</span>
      </span>
      {children}
    </div>
  );
}
