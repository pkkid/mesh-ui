/**
 * The glass tooltip every chart shows on hover, and the hook that keeps it
 * 12px from the pointer and inside the plot. Ported from T3 Code's
 * UsageChartTooltip and UsageChartPlot positioning.
 */
import { type ReactNode, type RefObject, useCallback, useLayoutEffect, useRef, useState } from "react";

import { cn } from "~/lib/utils";

export type TooltipRow = {
  label: ReactNode;
  value: ReactNode;
  /** Series colour for the dot. Leave out for rows without a series. */
  color?: string;
  /** Icon shown instead of the dot. */
  icon?: ReactNode;
};

const GAP = 12;

export function ChartTooltip({
  tooltipRef,
  title,
  rows,
  total,
  className,
  style,
}: {
  tooltipRef?: RefObject<HTMLDivElement | null>;
  title?: ReactNode;
  rows: ReadonlyArray<TooltipRow>;
  /** Shown as a Total row under a top border when totals make sense. */
  total?: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      ref={tooltipRef}
      role="presentation"
      className={cn(
        "pointer-events-none absolute z-10 min-w-36 max-w-full rounded-xl border border-border/50 bg-popover/85 px-2.5 py-2 text-xs text-popover-foreground shadow-lg backdrop-blur-md",
        className,
      )}
      style={{ left: "var(--chart-tooltip-left, 0px)", top: "var(--chart-tooltip-top, 0px)", ...style }}
    >
      {title === undefined ? null : <div className="mb-1 text-muted-foreground">{title}</div>}
      {rows.map((row, i) => (
        <div key={i} className="flex items-center justify-between gap-3">
          <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
            {row.icon ??
              (row.color === undefined ? null : (
                <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: row.color }} />
              ))}
            <span className="truncate">{row.label}</span>
          </span>
          <span className="text-foreground tabular-nums">{row.value}</span>
        </div>
      ))}
      {total === undefined ? null : (
        <div className="mt-1 flex items-center justify-between gap-3 border-t border-border pt-1">
          <span className="text-muted-foreground">Total</span>
          <span className="text-foreground tabular-nums">{total}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Follows the pointer inside `plotRef`. Returns the pointer position (null
 * when outside), a ref for the tooltip, and handlers for the plot. The
 * tooltip position is written as CSS variables on the plot, so moving the
 * pointer does not re-render the chart; only `onPointer` decides that.
 */
export function useChartHover<T>({
  pick,
}: {
  /** Maps a pointer position (px inside the plot) to the hovered item. */
  pick: (x: number, y: number, width: number, height: number) => T | null;
}) {
  const plotRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const [hovered, setHovered] = useState<T | null>(null);

  const position = useCallback(() => {
    const plot = plotRef.current;
    const tooltip = tooltipRef.current;
    const at = pointer.current;
    if (plot === null || tooltip === null || at === null) return;
    const width = tooltip.offsetWidth;
    const height = tooltip.offsetHeight;
    const plotWidth = plot.clientWidth;
    const plotHeight = plot.clientHeight;
    const preferredLeft = at.x + GAP + width <= plotWidth ? at.x + GAP : at.x - GAP - width;
    const preferredTop = at.y + GAP + height <= plotHeight ? at.y + GAP : at.y - GAP - height;
    const left = Math.min(Math.max(0, preferredLeft), Math.max(0, plotWidth - width));
    const top = Math.min(Math.max(0, preferredTop), Math.max(0, plotHeight - height));
    plot.style.setProperty("--chart-tooltip-left", `${left}px`);
    plot.style.setProperty("--chart-tooltip-top", `${top}px`);
  }, []);

  useLayoutEffect(() => {
    if (hovered === null) return;
    position();
    const plot = plotRef.current;
    const tooltip = tooltipRef.current;
    if (plot === null || tooltip === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(position);
    observer.observe(plot);
    observer.observe(tooltip);
    return () => observer.disconnect();
  }, [hovered, position]);

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const plot = plotRef.current;
    if (plot === null) return;
    const bounds = plot.getBoundingClientRect();
    if (bounds.width === 0) return;
    const x = Math.min(bounds.width, Math.max(0, event.clientX - bounds.left));
    const y = Math.min(bounds.height, Math.max(0, event.clientY - bounds.top));
    pointer.current = { x, y };
    position();
    const next = pick(x, y, bounds.width, bounds.height);
    setHovered((prev) => (Object.is(prev, next) ? prev : next));
  };

  const onPointerLeave = () => {
    pointer.current = null;
    setHovered(null);
  };

  return { plotRef, tooltipRef, hovered, handlers: { onPointerMove, onPointerLeave } };
}

/**
 * Loading fade: figures drop to 40% after a 150ms delay, so quick refreshes
 * never flash. Only opacity transitions, no load animations.
 */
export function fadeClass(loading: boolean | undefined): string {
  return cn("transition-opacity", loading && "opacity-40 delay-150");
}

/** The centred muted sentence an empty range shows. */
export function EmptyNote({ children }: { children: ReactNode }) {
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center text-xs text-muted-foreground">
      {children}
    </div>
  );
}
