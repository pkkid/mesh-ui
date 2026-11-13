// Breakdown table from AGENTS.md (Dashboards and charts) and
// docs/design/design-system.md (Tables): muted header, faint row dividers,
// numbers right-aligned in tabular-nums, and under each name a 2px bar in the
// series colour scaled to the largest row (max-w-48). An optional Others row
// sums everything past `limit` in the neutral series colour.
import { Ellipsis, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Link } from "~/app/router";
import { IconTile } from "~/components/ui/hero";
import { seriesColors } from "~/lib/chartColors";
import { cn } from "~/lib/utils";

export type BreakdownColumn<T> = {
  header: string;
  cell: (row: T) => ReactNode;
  /** Secondary figures (Up beside Down) in muted text. */
  muted?: boolean;
};

type BreakdownTableProps<T> = {
  /** Rows, largest first. `undefined` while loading: placeholder rows keep the height. */
  rows: ReadonlyArray<T> | undefined;
  rowKey: (row: T) => string;
  nameHeader: string;
  name: (row: T) => ReactNode;
  /** The size the bar scales by. */
  size: (row: T) => number;
  /** Figure columns after the name. */
  columns: ReadonlyArray<BreakdownColumn<T>>;
  /** The bar colour, from `chartColors.ts`. */
  color: string | ((row: T) => string);
  icon?: (row: T) => LucideIcon;
  /** Makes the name a link. */
  to?: (row: T) => string | undefined;
  /** A leading "#" column. */
  ranked?: boolean;
  /** Show at most this many rows; with `others`, the rest become one Others row. */
  limit?: number;
  /** Sums the rows past `limit` into one row shown as "Others". */
  others?: (rest: ReadonlyArray<T>) => T;
  placeholderCount?: number;
  /** Fades figures while a refetch is slow. */
  fading?: boolean;
  className?: string;
};

const TD = "px-3 py-2.5";

function BreakdownTable<T>({
  rows,
  rowKey,
  nameHeader,
  name,
  size,
  columns,
  color,
  icon,
  to,
  ranked = false,
  limit,
  others,
  placeholderCount = 5,
  fading = false,
  className,
}: BreakdownTableProps<T>) {
  const shown = rows ? (limit === undefined ? [...rows] : rows.slice(0, limit)) : [];
  const rest = rows && limit !== undefined ? rows.slice(limit) : [];
  const other = others && rest.length > 0 ? others(rest) : undefined;
  const top = Math.max(0, ...shown.map(size), ...(other ? [size(other)] : []));
  const colCount = columns.length + (ranked ? 2 : 1);

  const bar = (row: T, barColor: string) => (
    <div className="mt-1.5 h-0.5 max-w-48">
      <div
        className="h-full min-w-1.5 rounded-full"
        style={{ width: `${top > 0 ? (size(row) / top) * 100 : 0}%`, backgroundColor: barColor }}
      />
    </div>
  );

  const figures = (row: T) =>
    columns.map((c) => (
      <td key={c.header} className={cn("whitespace-nowrap text-right tabular-nums", TD, c.muted && "text-muted-foreground")}>
        {c.cell(row)}
      </td>
    ));

  return (
    <table className={cn("w-full border-collapse text-[13px] transition-opacity", fading && "opacity-40", className)}>
      <thead>
        <tr className="border-b text-left text-muted-foreground text-xs">
          {ranked && <th className="whitespace-nowrap px-3 py-2 font-normal">#</th>}
          <th className="w-full px-3 py-2 font-normal">{nameHeader}</th>
          {columns.map((c) => (
            <th key={c.header} className="whitespace-nowrap px-3 py-2 text-right font-normal">
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows
          ? shown.map((r, i) => {
              const href = to?.(r);
              const body = (
                <>
                  {icon && <IconTile icon={icon(r)} size="sm" />}
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{name(r)}</div>
                    {bar(r, typeof color === "function" ? color(r) : color)}
                  </div>
                </>
              );
              return (
                <tr key={rowKey(r)} className="border-border/50 border-b last:border-b-0 hover:bg-muted/50">
                  {ranked && <td className={cn(TD, "text-muted-foreground text-xs tabular-nums")}>{i + 1}</td>}
                  <td className={TD}>
                    {href ? (
                      <Link to={href} className="flex items-center gap-2.5 outline-none focus-visible:underline">
                        {body}
                      </Link>
                    ) : (
                      <div className="flex items-center gap-2.5">{body}</div>
                    )}
                  </td>
                  {figures(r)}
                </tr>
              );
            })
          : Array.from({ length: placeholderCount }, (_, i) => (
              <tr key={i} className="border-border/50 border-b last:border-b-0">
                <td className="h-[49px]" colSpan={colCount} />
              </tr>
            ))}
        {other && (
          <tr className="border-border/50 border-b last:border-b-0 hover:bg-muted/50">
            {ranked && <td className={TD} />}
            <td className={TD}>
              <div className="flex items-center gap-2.5">
                {icon && <IconTile icon={Ellipsis} size="sm" />}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-muted-foreground">Others ({rest.length})</div>
                  {bar(other, seriesColors.neutral)}
                </div>
              </div>
            </td>
            {figures(other)}
          </tr>
        )}
      </tbody>
    </table>
  );
}

export { BreakdownTable };
