/**
 * An h-2 bar split into segments, each as wide as its share, with a legend
 * of colour squares. Ported from T3 Code's UsageShareBar.
 */
import { type ReactNode, useState } from "react";

import { formatPercent } from "../../../../core/format";
import { cn } from "~/lib/utils";

export type ShareSegment = {
  label: string;
  value: number;
  /** From chartColors.ts. */
  color: string;
};

const percent = (fraction: number) => formatPercent(fraction * 100);

export function ShareBar({
  label,
  segments,
  format,
  aside,
  hideLegend = false,
  className,
}: {
  /** Heading above the bar; leave out when the section already has one. */
  label?: string;
  segments: ReadonlyArray<ShareSegment>;
  format: (value: number) => string;
  aside?: ReactNode;
  hideLegend?: boolean;
  className?: string;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const visible = segments.filter((s) => Number.isFinite(s.value) && s.value > 0);
  const total = visible.reduce((sum, s) => sum + s.value, 0);
  const ariaLabel = `${label ?? "Share"}: ${visible.map((s) => `${s.label} ${format(s.value)}`).join(", ")}`;

  // Left edge of the hovered segment, as a share of the bar, for the tooltip.
  let hoverLeft = 0;
  if (hovered !== null) for (let i = 0; i < hovered; i += 1) hoverLeft += (visible[i]?.value ?? 0) / total;
  const hoveredSegment = hovered === null ? undefined : visible[hovered];

  return (
    <div className={cn("flex min-w-0 flex-col gap-2.5", className)}>
      {label === undefined && aside === undefined ? null : (
        <div className="flex items-baseline justify-between gap-3">
          {label === undefined ? <span /> : <h3 className="text-sm font-medium text-foreground">{label}</h3>}
          {aside}
        </div>
      )}
      <div className="relative">
        <div role="img" aria-label={ariaLabel} className="flex h-2 gap-0.5">
          {total <= 0 ? (
            <div className="h-full flex-1 rounded-full bg-muted-foreground/15" />
          ) : (
            visible.map((s, i) => (
              <div
                key={s.label}
                className="h-full min-w-1 rounded-xs first:rounded-l-full last:rounded-r-full"
                style={{ flex: `${s.value} 1 0`, backgroundColor: s.color }}
                onPointerEnter={() => setHovered(i)}
                onPointerLeave={() => setHovered(null)}
              />
            ))
          )}
        </div>
        {hoveredSegment === undefined ? null : (
          <div
            role="presentation"
            className="pointer-events-none absolute bottom-full z-10 mb-2 rounded-xl border border-border/50 bg-popover/85 px-2.5 py-1.5 text-xs whitespace-nowrap text-popover-foreground shadow-lg backdrop-blur-md"
            style={{ left: `${Math.min(hoverLeft * 100, 70)}%` }}
          >
            {hoveredSegment.label} · <span className="tabular-nums">{format(hoveredSegment.value)}</span> ·{" "}
            <span className="tabular-nums">{percent(hoveredSegment.value / total)}</span>
          </div>
        )}
      </div>
      {hideLegend ? null : (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {visible.map((s) => (
            <span key={s.label} className="flex items-center gap-1.5">
              <span aria-hidden className="size-2 rounded-xs" style={{ backgroundColor: s.color }} />
              <span className="text-muted-foreground">{s.label}</span>
              <span className="text-foreground tabular-nums">{format(s.value)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
