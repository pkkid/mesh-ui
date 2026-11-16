/**
 * The glass tooltip every chart shows on hover, and the hook that keeps it
 * 12px from the pointer and inside the plot. Ported from T3 Code's
 * UsageChartTooltip and UsageChartPlot positioning.
 */
import { type ReactNode, type RefObject, useCallback, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

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
/** Room kept between a floating tooltip and the window edge. */
const EDGE = 6;

/**
 * The one tooltip surface: the page background (one step darker than cards
 * and popovers), a 1px border and a soft shadow. Chart tooltips, the share
 * bar, the donut and every `title` tooltip (TitleTooltips) use it.
 */
export const tooltipSurface =
  "rounded-md border border-border bg-tooltip/95 text-xs text-tooltip-foreground shadow-lg backdrop-blur-md";

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
        "pointer-events-none absolute z-10 min-w-36 max-w-full px-2.5 py-2",
        tooltipSurface,
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
 * Where a floating tooltip goes: 12px below and right of the pointer
 * (flipped when it would leave the window), or centred above an element
 * (below when there is no room above).
 */
export type FloatAt = { pointer: { x: number; y: number } } | { anchor: { left: number; top: number; width: number; height: number } };

/** Top-left corner for a `width` x `height` tooltip at `at`, kept inside a `vw` x `vh` window. */
export function placeFloating(at: FloatAt, width: number, height: number, vw: number, vh: number): { left: number; top: number } {
  let left: number;
  let top: number;
  if ("pointer" in at) {
    const { x, y } = at.pointer;
    left = x + GAP + width <= vw - EDGE ? x + GAP : x - GAP - width;
    top = y + GAP + height <= vh - EDGE ? y + GAP : y - GAP - height;
  } else {
    const a = at.anchor;
    left = a.left + a.width / 2 - width / 2;
    top = a.top - 6 - height >= EDGE ? a.top - 6 - height : a.top + a.height + 6;
  }
  return {
    left: Math.round(Math.min(Math.max(EDGE, left), Math.max(EDGE, vw - EDGE - width))),
    top: Math.round(Math.min(Math.max(EDGE, top), Math.max(EDGE, vh - EDGE - height))),
  };
}

/**
 * A tooltip rendered on <body> with fixed positioning, so it can leave a
 * small chart (a donut) or a clipping card. Placed by `placeFloating`.
 */
export function FloatingTooltip({ at, className, children }: { at: FloatAt; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const { left, top } = placeFloating(at, el.offsetWidth, el.offsetHeight, window.innerWidth, window.innerHeight);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.visibility = "visible";
  });
  return createPortal(
    <div
      ref={ref}
      role="presentation"
      className={cn("pointer-events-none fixed z-[140] px-2.5 py-1.5", tooltipSurface, className)}
      style={{ left: 0, top: 0, visibility: "hidden" }}
    >
      {children}
    </div>,
    document.body,
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
