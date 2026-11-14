/**
 * Activity hero: the week's event total, daily average and change, over the
 * type legend that doubles as the type filter (click a row to hide or show
 * that type in the chart and the stream). docs/ux/pages/activity.md (Layout 1).
 */
import { cn } from "~/lib/utils";
import { formatCount, formatPercent, MISSING } from "../../../../core/format";
import type { EventCategory, EventSummary } from "../../../../core/model";

import { CATEGORIES, CATEGORY_ORDER } from "./ActivityChart";

/** "59 a day on average · +12% vs prior week". */
export function summaryLine(s: EventSummary): string {
  // Under 10 a day, one decimal so a quiet network does not read "0 a day".
  const n = s.dailyAverage > 0 && s.dailyAverage < 10 ? s.dailyAverage.toFixed(1).replace(/\.0$/, "") : formatCount(s.dailyAverage);
  const avg = `${n} a day on average`;
  if (s.change === null) return avg;
  const pct = Math.round(s.change * 100);
  return `${avg} · ${pct > 0 ? "+" : ""}${formatPercent(pct)} vs prior ${s.range === "week" ? "week" : "day"}`;
}

export function ActivityHero({
  summary,
  hidden,
  onToggle,
  loading,
}: {
  summary: EventSummary | undefined;
  hidden: ReadonlySet<EventCategory>;
  onToggle: (c: EventCategory) => void;
  loading: boolean;
}) {
  const total = summary?.total ?? null;
  // Every type with events, plus any the user hid, so a hidden row can be shown again.
  const rows = CATEGORY_ORDER.filter((c) => (summary?.counts[c] ?? 0) > 0 || hidden.has(c) || (c !== "other" && !summary));
  return (
    <div className={cn("flex flex-col gap-4 transition-opacity", loading && "opacity-40")}>
      <div>
        <div className="flex items-baseline gap-2">
          <span className="font-semibold text-4xl tabular-nums">{total === null ? MISSING : formatCount(total)}</span>
          <span className="text-muted-foreground text-sm">{total === 1 ? "event" : "events"}</span>
        </div>
        <div className="mt-1 text-muted-foreground text-xs">{summary ? summaryLine(summary) : " "}</div>
      </div>
      <div className="flex flex-col" role="group" aria-label="Event types shown">
        {rows.map((c) => {
          const meta = CATEGORIES[c];
          const Icon = meta.icon;
          const count = summary?.counts[c] ?? null;
          const off = hidden.has(c);
          return (
            <button
              key={c}
              type="button"
              aria-pressed={!off}
              title={off ? `Show ${meta.label}` : `Hide ${meta.label}`}
              onClick={() => onToggle(c)}
              className={cn(
                "-mx-1.5 grid grid-cols-[12px_16px_minmax(0,1fr)_auto_40px] items-center gap-2 rounded-md px-1.5 py-1 text-left text-[12.5px] outline-none hover:bg-muted/50 focus-visible:bg-muted/50",
                off && "opacity-45",
              )}
            >
              <span className="size-2 rounded-[2px]" style={{ backgroundColor: meta.color }} />
              <Icon className="size-3.5 text-muted-foreground" />
              <span className={cn("truncate", off && "line-through")}>{meta.label}</span>
              <span className="font-medium tabular-nums">{count === null ? MISSING : formatCount(count)}</span>
              <span className="text-right text-muted-foreground text-xs tabular-nums">
                {count === null || !total ? MISSING : formatPercent(Math.round((count / total) * 100))}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
