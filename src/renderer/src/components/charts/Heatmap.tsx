/**
 * "When the network is busy": rows (days) by columns (hours), one series
 * colour at an opacity that follows each cell's value.
 */
import { cn } from "~/lib/utils";

import { clean, heatStrength, slotIndex } from "./scale";
import { ChartTooltip, fadeClass, useChartHover } from "./Tooltip";

/** Default column labels for 24 hours: 12a, 6a, 12p, 6p. */
export const hourLabel = (hour: number) =>
  hour % 6 !== 0 ? "" : hour === 0 ? "12a" : hour === 12 ? "12p" : hour < 12 ? `${hour}a` : `${hour - 12}p`;

export function Heatmap({
  rows,
  columns,
  values,
  color,
  format,
  ariaLabel,
  columnLabel = hourLabel,
  cellLabel,
  valueLabel = "Usage",
  loading,
  className,
}: {
  /** Row labels, e.g. Mon to Sun. */
  rows: ReadonlyArray<string>;
  /** Number of columns, e.g. 24 hours. */
  columns: number;
  /** rows x columns values in any unit; colour scales to the largest. */
  values: ReadonlyArray<ReadonlyArray<number>>;
  /** From chartColors.ts. */
  color: string;
  format: (value: number) => string;
  ariaLabel: string;
  columnLabel?: (column: number) => string;
  /** Tooltip title for a cell; defaults to "Row column". */
  cellLabel?: (row: number, column: number) => string;
  /** Tooltip row label for the value. */
  valueLabel?: string;
  loading?: boolean;
  className?: string;
}) {
  const peak = Math.max(0, ...values.flatMap((row) => row.map(clean)));
  const { plotRef, tooltipRef, hovered, handlers } = useChartHover<number>({
    pick: (x, y, width, height) => {
      if (rows.length === 0 || columns === 0) return null;
      return slotIndex(y / height, rows.length) * columns + slotIndex(x / width, columns);
    },
  });
  const hoverRow = hovered === null ? 0 : Math.floor(hovered / columns);
  const hoverCol = hovered === null ? 0 : hovered % columns;
  const hoverValue = clean(values[hoverRow]?.[hoverCol]);

  return (
    <div className={cn("grid grid-cols-[2.25rem_1fr] gap-x-1 gap-y-1", className)}>
      <div className="grid gap-[3px]" aria-hidden style={{ gridTemplateRows: `repeat(${rows.length}, 1fr)` }}>
        {rows.map((label) => (
          <div key={label} className="flex items-center text-3xs text-muted-foreground uppercase">
            {label}
          </div>
        ))}
      </div>
      <div ref={plotRef} className="relative" role="img" aria-label={ariaLabel} {...handlers}>
        <div
          className={cn("grid gap-[3px]", fadeClass(loading))}
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {rows.map((rowLabel, r) =>
            Array.from({ length: columns }, (_, c) => {
              const v = clean(values[r]?.[c]);
              const strength = peak > 0 ? heatStrength(v / peak) : 0;
              return (
                <div
                  key={`${rowLabel}-${c}`}
                  className={cn("h-3.5 rounded-[3px]", hovered === r * columns + c && "ring-1 ring-foreground/40")}
                  style={{
                    backgroundColor:
                      strength === 0
                        ? "color-mix(in srgb, var(--color-muted-foreground) 10%, transparent)"
                        : `color-mix(in srgb, ${color} ${strength}%, color-mix(in srgb, var(--color-muted-foreground) 10%, transparent))`,
                  }}
                />
              );
            }),
          )}
        </div>
        {hovered === null ? null : (
          <ChartTooltip
            tooltipRef={tooltipRef}
            title={cellLabel?.(hoverRow, hoverCol) ?? `${rows[hoverRow] ?? ""} ${hoverCol}:00`}
            rows={[{ label: valueLabel, color, value: format(hoverValue) }]}
          />
        )}
      </div>
      <div />
      <div
        className="grid text-center text-3xs text-muted-foreground/70"
        aria-hidden
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: columns }, (_, c) => (
          <span key={c}>{columnLabel(c)}</span>
        ))}
      </div>
    </div>
  );
}
