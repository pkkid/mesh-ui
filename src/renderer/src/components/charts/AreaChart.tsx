/**
 * The main time-series chart: each series is a 2px monotone line with the
 * area under it in the same colour at 12% opacity. Ported from T3 Code's
 * UsageProviderChart. Rules: AGENTS.md "Charts", docs/design/design-system.md.
 */
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";

import { areaPath, bandPath, linePath, type Point } from "./curve";
import { PLOT_TOP, VIEW_HEIGHT, VIEW_WIDTH, clean, edgeLabels, hasData, nearestIndex, seriesScale, valueToY } from "./scale";
import { ChartTooltip, EmptyNote, fadeClass, useChartHover } from "./Tooltip";

export type ChartSeries = {
  id: string;
  label: string;
  /** From chartColors.ts. Never pick a colour inline. */
  color: string;
  values: ReadonlyArray<number>;
  icon?: ReactNode;
};

export type ChartMarker = { index: number; label: string; color?: string };

export type AreaChartProps = {
  series: ReadonlyArray<ChartSeries>;
  /** One label per point, for the x axis (start, middle, end). */
  labels: ReadonlyArray<string>;
  /** Longer labels for the tooltip; defaults to `labels`. */
  tooltipLabels?: ReadonlyArray<string>;
  /** Formats values for the y gutter and the tooltip (shared formatters). */
  format: (value: number) => string;
  /** What the chart shows, for screen readers. */
  ariaLabel: string;
  /** Stack series on top of each other instead of overlapping them. */
  stacked?: boolean;
  /** Add a Total row to the tooltip. Defaults to on for two or more series. */
  total?: boolean;
  loading?: boolean;
  emptyText?: string;
  /** Dashed vertical markers (for example scheduled pauses). */
  markers?: ReadonlyArray<ChartMarker>;
  /** Plot height class; `h-56` for a main chart. */
  heightClassName?: string;
  /** Hide the y gutter (small charts). */
  hideYLabels?: boolean;
  className?: string;
};

type Drawn = { series: ChartSeries; line: string; area: string };

export function AreaChart({
  series,
  labels,
  tooltipLabels,
  format,
  ariaLabel,
  stacked = false,
  total,
  loading,
  emptyText = "No activity in this window.",
  markers = [],
  heightClassName = "h-56",
  hideYLabels = false,
  className,
}: AreaChartProps) {
  const count = Math.max(labels.length, ...series.map((s) => s.values.length));
  const values = series.map((s) => Array.from({ length: count }, (_, i) => clean(s.values[i])));
  const scale = seriesScale(values, stacked);
  const empty = !hasData(values);
  const stepX = count < 2 ? 0 : VIEW_WIDTH / (count - 1);
  const toY = (v: number) => valueToY(v, scale.max);
  const showTotal = total ?? series.length > 1;

  const drawn: Drawn[] = [];
  if (!empty) {
    const base = Array.from({ length: count }, () => 0);
    const layers = series.map((s, k) => {
      const bottom = base.slice();
      const top = values[k]!.map((v, i) => (stacked ? (base[i]! += v) : v));
      const topPts: Point[] = top.map((v, i) => ({ x: i * stepX, y: toY(v) }));
      const basePts: Point[] = bottom.map((v, i) => ({ x: i * stepX, y: toY(v) }));
      return {
        series: s,
        sum: values[k]!.reduce((a, b) => a + b, 0),
        line: linePath(topPts),
        area: stacked ? bandPath(topPts, basePts) : areaPath(topPts, VIEW_HEIGHT),
      };
    });
    // Largest series first so small ones sit on top. Stacks keep their order.
    const ordered = stacked ? layers : [...layers].sort((a, b) => b.sum - a.sum);
    drawn.push(...ordered);
  }

  const { plotRef, tooltipRef, hovered, handlers } = useChartHover<number>({
    pick: (x, _y, width) => (empty || count === 0 ? null : nearestIndex(x / width, count)),
  });

  const [start, middle, end] = edgeLabels(labels);
  const tipLabels = tooltipLabels ?? labels;

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex gap-2">
        {hideYLabels ? null : (
          <div className={cn("relative w-14 shrink-0", heightClassName)} aria-hidden>
            {scale.labeled
              ? scale.ticks.map((tick) => (
                  <span
                    key={tick}
                    className="absolute right-0 -translate-y-1/2 text-3xs whitespace-nowrap text-muted-foreground tabular-nums"
                    style={{ top: `${(toY(tick) / VIEW_HEIGHT) * 100}%` }}
                  >
                    {tick === 0 ? "0" : format(tick)}
                  </span>
                ))
              : null}
          </div>
        )}

        <div ref={plotRef} className={cn("relative min-w-0 flex-1", heightClassName)} {...handlers}>
          <svg
            className="h-full w-full overflow-visible"
            viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={ariaLabel}
          >
            {scale.ticks.map((tick) => (
              <line
                key={tick}
                x1={0}
                x2={VIEW_WIDTH}
                y1={toY(tick)}
                y2={toY(tick)}
                stroke="currentColor"
                strokeWidth={1}
                className="text-border"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {empty
              ? null
              : markers.map((m) => (
                  <line
                    key={`${m.index}-${m.label}`}
                    x1={m.index * stepX}
                    x2={m.index * stepX}
                    y1={PLOT_TOP}
                    y2={VIEW_HEIGHT}
                    stroke={m.color ?? "currentColor"}
                    strokeWidth={1}
                    strokeDasharray="3 4"
                    className="text-muted-foreground/70"
                    vectorEffect="non-scaling-stroke"
                  >
                    <title>{m.label}</title>
                  </line>
                ))}
            <g className={fadeClass(loading)}>
              {drawn.map((d) => (
                <path key={d.series.id} d={d.area} fill={d.series.color} fillOpacity={0.12} />
              ))}
              {drawn.map((d) => (
                <path
                  key={d.series.id}
                  d={d.line}
                  fill="none"
                  stroke={d.series.color}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </g>
            {hovered === null ? null : (
              <line
                x1={hovered * stepX}
                x2={hovered * stepX}
                y1={PLOT_TOP}
                y2={VIEW_HEIGHT}
                stroke="currentColor"
                strokeWidth={1}
                className="text-muted-foreground"
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>

          {empty && !loading ? <EmptyNote>{emptyText}</EmptyNote> : null}

          {hovered === null ? null : (
            <ChartTooltip
              tooltipRef={tooltipRef}
              title={tipLabels[hovered]}
              rows={series.map((s, k) => ({
                label: s.label,
                color: s.color,
                icon: s.icon,
                value: format(values[k]![hovered] ?? 0),
              }))}
              total={showTotal ? format(values.reduce((sum, v) => sum + (v[hovered] ?? 0), 0)) : undefined}
            />
          )}
        </div>
      </div>

      {labels.length === 0 ? null : (
        <div
          className={cn("flex justify-between text-3xs text-muted-foreground uppercase", !hideYLabels && "pl-16")}
          aria-hidden
        >
          <span>{start}</span>
          <span>{middle}</span>
          <span>{end}</span>
        </div>
      )}
    </div>
  );
}
