/**
 * Activity "Most active" (docs/ux/pages/activity.md, Layout 1): the devices,
 * eeros and profiles the kept events are most about, from `events.summary`
 * {range: "kept"} `top`. A breakdown table: name (with its kind for eeros and
 * profiles) over a 2px bar in its main event type's colour, event count and
 * when its last event was. Picking a row filters the stream to it.
 */
import { cn } from "~/lib/utils";
import { formatCount, formatRelative } from "../../../../core/format";
import type { EventSummary, EventTopEntity } from "../../../../core/model";

import { CATEGORIES } from "./ActivityChart";

export function MostActive({
  summary,
  timeZone,
  loading,
  selected,
  onPick,
}: {
  summary: EventSummary | undefined;
  timeZone: string;
  loading: boolean;
  /** The entity the stream is filtered to, "device:<id>" and so on. */
  selected: string | null;
  onPick: (e: EventTopEntity) => void;
}) {
  const top = summary?.top ?? [];
  const max = Math.max(1, ...top.map((t) => t.count));
  const more = summary?.topMore ?? 0;
  const now = summary ? Date.parse(summary.to) : Date.now();
  return (
    <div className={cn("flex flex-col text-xs transition-opacity", loading && "opacity-40")}>
      <div className="grid grid-cols-[minmax(0,1fr)_4rem_5.5rem] gap-3 pb-1.5 text-muted-foreground">
        <span>Most active</span>
        <span className="text-right">Events</span>
        <span className="text-right">Last</span>
      </div>
      {summary && top.length === 0 ? (
        <p className="border-border/50 border-t py-6 text-center text-muted-foreground">No device, eero or profile named yet.</p>
      ) : (
        top.map((t) => {
          const key = `${t.kind}:${t.id}`;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={selected === key}
              title={selected === key ? "Show every event" : `Show only events about ${t.name}`}
              onClick={() => onPick(t)}
              className={cn(
                "-mx-1.5 grid grid-cols-[minmax(0,1fr)_4rem_5.5rem] items-start gap-3 rounded-md border-border/50 border-t px-1.5 py-1.5 text-left outline-none hover:bg-muted/50 focus-visible:bg-muted/50",
                selected === key && "bg-muted/60",
              )}
            >
              <span className="min-w-0">
                <span className="block truncate">
                  {t.name}
                  {t.kind !== "device" && <span className="ms-1 text-2xs text-muted-foreground">{t.kind}</span>}
                </span>
                <span
                  className="mt-1 block h-0.5 max-w-48 rounded-full"
                  style={{ width: `${(t.count / max) * 100}%`, backgroundColor: CATEGORIES[t.category].color }}
                />
              </span>
              <span className="text-right tabular-nums">{formatCount(t.count)}</span>
              <span className="text-right text-muted-foreground tabular-nums">{formatRelative(t.last, now, timeZone)}</span>
            </button>
          );
        })
      )}
      {more > 0 && (
        <div className="border-border/50 border-t pt-1.5 text-2xs text-muted-foreground">
          + {formatCount(more)} more
        </div>
      )}
    </div>
  );
}
