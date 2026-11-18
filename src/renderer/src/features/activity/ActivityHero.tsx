/**
 * Activity hero (docs/ux/pages/activity.md, Layout 1): a compact event total
 * with how far back the kept events reach, a share bar of the types, and the
 * type legend as wrapping chips that double as the type filter (click one to
 * hide or show that type in the chart and the stream). Kept small so the
 * chart under it gets the card's height.
 */
import { ShareBar } from "~/components/charts/ShareBar";
import { cn } from "~/lib/utils";
import { type Clock, formatCount, MISSING } from "../../../../core/format";
import type { EventCategory, EventSummary } from "../../../../core/model";

import { CATEGORIES, CATEGORY_ORDER } from "./ActivityChart";

/** "last 58m", "last 3h 10m": how far back the kept events reach. */
export function keptSpan(s: EventSummary): string {
  const from = s.earliest ? Date.parse(s.earliest) : Date.parse(s.to);
  const min = Math.max(1, Math.round((Date.parse(s.to) - from) / 60_000));
  if (min < 60) return `last ${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `last ${h} h${m ? ` ${m} min` : ""}`;
}

/** "Since 9:41 AM" (with the date on an earlier day): the section's sub line. */
export function sinceLine(s: EventSummary | undefined, clock: Clock): string | null {
  if (!s?.earliest) return null;
  const at = s.earliest;
  return `Since ${clock.day(at) === clock.day(s.to) ? clock.time(at) : clock.dateTime(at)}`;
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
  // Every type with events, plus any the user hid, so a hidden chip can be shown again.
  const rows = CATEGORY_ORDER.filter((c) => (summary?.counts[c] ?? 0) > 0 || hidden.has(c));
  return (
    <div className={cn("flex flex-col gap-2 transition-opacity", loading && "opacity-40")}>
      <div className="flex items-center gap-3">
        <div className="flex shrink-0 items-baseline gap-1.5">
          <span className="font-semibold text-2xl tabular-nums leading-none">{total === null ? MISSING : formatCount(total)}</span>
          <span className="text-muted-foreground text-xs">
            {total === 1 ? "event" : "events"}
            {summary ? ` · ${keptSpan(summary)}` : ""}
          </span>
        </div>
        <ShareBar
          className="min-w-16 flex-1"
          hideLegend
          format={formatCount}
          segments={CATEGORY_ORDER.filter((c) => !hidden.has(c)).map((c) => ({
            label: CATEGORIES[c].label,
            value: summary?.counts[c] ?? 0,
            color: CATEGORIES[c].color,
          }))}
        />
      </div>
      {rows.length > 0 && (
        <div className="flex flex-wrap gap-x-2.5 gap-y-0.5" role="group" aria-label="Event types shown">
          {rows.map((c) => {
            const meta = CATEGORIES[c];
            const off = hidden.has(c);
            return (
              <button
                key={c}
                type="button"
                aria-pressed={!off}
                title={off ? `Show ${meta.label}` : `Hide ${meta.label}`}
                onClick={() => onToggle(c)}
                className={cn(
                  "-mx-1 inline-flex items-center gap-1 rounded px-1 text-2xs outline-none hover:bg-muted/50 focus-visible:bg-muted/50",
                  off && "line-through opacity-45",
                )}
              >
                <span className="size-2 rounded-[2px]" style={{ backgroundColor: meta.color }} />
                <span className="text-muted-foreground">{meta.label}</span>
                <span className="font-medium tabular-nums">{formatCount(summary?.counts[c] ?? 0)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
