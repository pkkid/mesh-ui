/**
 * Activity hero: the event total for the last 24 hours and how far back the
 * kept events reach ("since 9:41 AM": eero sends only its last ~15 minutes,
 * so older events are the ones read while the app was open), over the type
 * legend that doubles as the type filter (click a row to hide or show
 * that type in the chart and the stream). docs/ux/pages/activity.md (Layout 1).
 */
import { cn } from "~/lib/utils";
import { type Clock, formatCount, formatPercent, MISSING } from "../../../../core/format";
import type { EventCategory, EventSummary } from "../../../../core/model";

import { CATEGORIES, CATEGORY_ORDER } from "./ActivityChart";

/** "Since 9:41 AM" while the kept events start inside the last 24 hours, else "Last 24 hours". */
export function summaryLine(s: EventSummary, clock: Clock): string {
  if (!s.earliest || Date.parse(s.earliest) <= Date.parse(s.from)) return "Last 24 hours";
  const at = s.earliest;
  return `Since ${clock.day(at) === clock.day(s.to) ? clock.time(at) : clock.dateTime(at)}`;
}

export function ActivityHero({
  summary,
  hidden,
  onToggle,
  loading,
  clock,
}: {
  summary: EventSummary | undefined;
  clock: Clock;
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
        <div className="mt-1 text-muted-foreground text-xs">{summary ? summaryLine(summary, clock) : " "}</div>
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
