/**
 * Stacked columns (for example usage per hour by device). Gridlines and
 * labels follow the same rules as AreaChart. Columns are HTML boxes over an
 * SVG grid so their rounded tops stay round when the plot stretches.
 */
import { cn } from "~/lib/utils";

import type { ChartSeries } from "./AreaChart";
import { VIEW_HEIGHT, VIEW_WIDTH, clean, edgeLabels, hasData, seriesScale, slotIndex, valueToY } from "./scale";
import { ChartTooltip, EmptyNote, fadeClass, useChartHover } from "./Tooltip";

export type BarChartProps = {
  series: ReadonlyArray<ChartSeries>;
  labels: ReadonlyArray<string>;
  tooltipLabels?: ReadonlyArray<string>;
  format: (value: number) => string;
  ariaLabel: string;
  total?: boolean;
  loading?: boolean;
  emptyText?: string;
  /** Dim every column but this one. */
  highlight?: number;
  heightClassName?: string;
  hideYLabels?: boolean;
  className?: string;
};

export function BarChart({
  series,
  labels,
  tooltipLabels,
  format,
  ariaLabel,
  total,
  loading,
  emptyText = "No activity in this window.",
  highlight,
  heightClassName = "h-44",
  hideYLabels = false,
  className,
}: BarChartProps) {
  const count = Math.max(labels.length, ...series.map((s) => s.values.length));
  const values = series.map((s) => Array.from({ length: count }, (_, i) => clean(s.values[i])));
  const scale = seriesScale(values, true);
  const empty = !hasData(values);
  const toY = (v: number) => valueToY(v, scale.max);
  // Fraction of the plot height a value fills, measured from the bottom.
  const share = (v: number) => (VIEW_HEIGHT - toY(v)) / VIEW_HEIGHT;
  const totals = Array.from({ length: count }, (_, i) => values.reduce((sum, v) => sum + (v[i] ?? 0), 0));
  const showTotal = total ?? series.length > 1;

  const { plotRef, tooltipRef, hovered, handlers } = useChartHover<number>({
    // Columns fill equal slots, so the slot under the pointer is floor(x / slot).
    pick: (x, _y, width) => (empty || count === 0 ? null : slotIndex(x / width, count)),
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

        <div
          ref={plotRef}
          className={cn("relative min-w-0 flex-1", heightClassName)}
          role="img"
          aria-label={ariaLabel}
          {...handlers}
        >
          <svg
            className="absolute inset-0 h-full w-full"
            viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
            preserveAspectRatio="none"
            aria-hidden
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
          </svg>

          {empty ? null : (
            <div className={cn("absolute inset-0 flex items-end gap-1", fadeClass(loading))}>
              {totals.map((columnTotal, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex min-w-0 flex-1 flex-col-reverse gap-px transition-opacity",
                    highlight !== undefined && highlight !== i && "opacity-55",
                  )}
                  style={{ height: `${share(columnTotal) * 100}%` }}
                >
                  {series.map((s, k) => {
                    const v = values[k]![i] ?? 0;
                    if (v <= 0) return null;
                    return (
                      <div
                        key={s.id}
                        className="min-h-0.5 rounded-[1px] last:rounded-t-[4px]"
                        style={{ flex: `${v} 1 0`, backgroundColor: s.color }}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          )}

          {hovered === null ? null : (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 bg-muted-foreground/10"
              style={{ left: `${(hovered / count) * 100}%`, width: `${100 / count}%` }}
            />
          )}

          {empty && !loading ? <EmptyNote>{emptyText}</EmptyNote> : null}

          {hovered === null ? null : (
            <ChartTooltip
              tooltipRef={tooltipRef}
              title={tipLabels[hovered]}
              rows={series.map((s, k) => ({ label: s.label, color: s.color, icon: s.icon, value: format(values[k]![hovered] ?? 0) }))}
              total={showTotal ? format(totals[hovered] ?? 0) : undefined}
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
