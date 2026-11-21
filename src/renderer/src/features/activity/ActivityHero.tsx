/**
 * The Activity page header (docs/ux/pages/activity.md, Layout 1): the flat
 * hero every page opens with. Title is the number of kept events, the status
 * line says whether the stream is live, how far back the kept events reach
 * and whether eero has unread notifications. The facts name the busiest
 * type and the most active device, eero or profile. Actions: Export CSV,
 * Mark notifications read (while the flag is set) and Notification
 * settings. The right-hand column is Events over time (ActivityChart.tsx).
 * Every figure comes from `events.summary {range: "kept"}` with no filters,
 * so the header always covers every kept event, as Devices' does.
 */
import type { ReactNode } from "react";

import { Metric, PageHeader } from "~/components/ui/hero";
import { Status } from "~/components/ui/status";
import { cn } from "~/lib/utils";
import { type Clock, formatCount, formatPercent } from "../../../../core/format";
import type { EventSummary } from "../../../../core/model";

import { CATEGORIES, CATEGORY_ORDER, EventsOverTime } from "./ActivityChart";

/** "since 9:41 AM" (with the date on an earlier day): how far back the kept events reach. */
export function sinceLine(s: EventSummary | undefined, clock: Clock): string | null {
  if (!s?.earliest) return null;
  const at = s.earliest;
  return `since ${clock.day(at) === clock.day(s.to) ? clock.time(at) : clock.dateTime(at)}`;
}

const muted = (text: string) => <span className="font-normal text-muted-foreground text-xs"> · {text}</span>;

export function ActivityHero({
  summary: s,
  clock,
  live,
  unread,
  actions,
  fading,
}: {
  /** events.summary {range: "kept"} with no filters. */
  summary: EventSummary | undefined;
  clock: Clock;
  /** The window is visible, so the stream polls. */
  live: boolean;
  /** eero's network-wide `has_unread`. */
  unread: boolean;
  actions: ReactNode;
  fading: boolean;
}) {
  const since = sinceLine(s, clock);
  const busiestType = s && s.total > 0 ? CATEGORY_ORDER.reduce((a, b) => (s.counts[b] > s.counts[a] ? b : a)) : null;
  const top = s?.top?.[0];

  return (
    <PageHeader
      flat
      data-slot="activity-hero"
      // 56px between the facts and Events over time, as Devices and Profiles do beside their charts.
      className={cn("transition-opacity [&>div:first-child]:gap-14", fading && "opacity-40")}
      title={s ? `${formatCount(s.total)} ${s.total === 1 ? "event" : "events"}` : "Activity"}
      status={
        <>
          <Status tone={live ? "success" : "muted"} title={live ? "New events are read every 60s" : "Paused while the window is hidden"}>
            {live ? "Live" : "Paused"}
          </Status>
          {since && <span className="tabular-nums">Kept {since}</span>}
          {unread && (
            <Status tone="info" title="eero says some notifications are unread">
              Unread notifications
            </Status>
          )}
        </>
      }
      facts={
        <>
          <Metric
            label="Busiest type"
            value={s && busiestType ? <>{CATEGORIES[busiestType].label}{muted(formatPercent((s.counts[busiestType] / s.total) * 100))}</> : null}
          />
          <Metric
            label="Most active"
            value={top ? <>{top.name}{muted(`${formatCount(top.count)} ${top.count === 1 ? "event" : "events"}`)}</> : null}
          />
        </>
      }
      actions={actions}
      aside={<EventsOverTime summary={s} clock={clock} loading={!s} />}
    />
  );
}
