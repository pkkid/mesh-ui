/**
 * Activity "Events over time": the right-hand column of the hero
 * (docs/ux/pages/activity.md, Layout 1). Plain columns of every kept event, in
 * the neutral series colour so they inform without competing with the title,
 * from `events.summary {range: "kept"}`: about 12 bars whose step fits the span
 * of kept events (1 minute to 2 hours), so even eero's first 15 minutes draw a
 * full row of slots. Also home to the category labels, icons and colours the
 * stream rows and the type filter share.
 */
import {
  Bell,
  CalendarClock,
  Cable,
  Download,
  Gauge,
  type LucideIcon,
  PauseCircle,
  Router,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import { useMemo } from "react";

import { BarChart } from "~/components/charts/BarChart";
import { eventCategoryColors, seriesColors } from "~/lib/chartColors";
import { type Clock, formatCount } from "../../../../core/format";
import type { EventCategory, EventSummary } from "../../../../core/model";

export type CategoryMeta = { label: string; icon: LucideIcon; color: string };

/** Label, icon and colour per event category; colours come from chartColors.ts. */
export const CATEGORIES: Readonly<Record<EventCategory, CategoryMeta>> = {
  devices: { label: "Devices", icon: Smartphone, color: eventCategoryColors.devices },
  pause_block: { label: "Paused / blocked", icon: PauseCircle, color: eventCategoryColors.pause_block },
  schedules: { label: "Schedules", icon: CalendarClock, color: eventCategoryColors.schedules },
  eero_status: { label: "eero status", icon: Router, color: eventCategoryColors.eero_status },
  speed_tests: { label: "Speed tests", icon: Gauge, color: eventCategoryColors.speed_tests },
  firmware: { label: "Firmware", icon: Download, color: eventCategoryColors.firmware },
  admin: { label: "Admin actions", icon: ShieldCheck, color: eventCategoryColors.admin },
  ports_temperature: { label: "Ports & temp", icon: Cable, color: eventCategoryColors.ports_temperature },
  other: { label: "Other", icon: Bell, color: eventCategoryColors.other },
};

export const CATEGORY_ORDER = Object.keys(CATEGORIES) as EventCategory[];

/** "5m", "1h", "2h": the bucket step as a formatted duration. */
export function stepShort(step: number): string {
  return step % 60 === 0 ? `${step / 60}h` : `${step}m`;
}

/** The bucket with the most events: "10 AM to 12 PM", or null with no events. */
export function busiestSlot(s: EventSummary | undefined, clock: Clock): string | null {
  const top = (s?.buckets ?? []).reduce<EventSummary["buckets"][number] | null>((best, b) => (b.total > (best?.total ?? 0) ? b : best), null);
  if (!s || !top) return null;
  const end = Date.parse(top.at) + s.step * 60_000;
  return s.step % 60 === 0 ? `${clock.hour(top.at)} to ${clock.hour(end)}` : `${clock.time(top.at)} to ${clock.time(end)}`;
}

/** The hero's right-hand column: title, "2h bars, busiest 8 AM to 10 AM", and the columns. */
export function EventsOverTime({ summary: s, clock, loading }: { summary: EventSummary | undefined; clock: Clock; loading: boolean }) {
  const hourly = (s?.step ?? 0) % 60 === 0;
  const stepMs = (s?.step ?? 1) * 60_000;
  const { labels, tips, values } = useMemo(() => {
    const buckets = s?.buckets ?? [];
    return {
      values: buckets.map((b) => b.total),
      labels: buckets.map((b) => (hourly ? clock.hour(b.at) : clock.time(b.at))),
      tips: buckets.map((b) => {
        const end = Date.parse(b.at) + stepMs;
        return hourly ? `${clock.hour(b.at)} to ${clock.hour(end)}` : `${clock.time(b.at)} to ${clock.time(end)}`;
      }),
    };
  }, [s, hourly, stepMs, clock]);
  const slot = busiestSlot(s, clock);
  const line = !s ? "-" : [`${stepShort(s.step)} bars`, slot && `busiest ${slot}`].filter(Boolean).join(", ");

  return (
    <div data-slot="events-over-time" className="flex w-[28rem] flex-col gap-2">
      <div className="min-w-0">
        <h2 className="whitespace-nowrap font-semibold text-base text-foreground leading-7">Events over time</h2>
        <p className="truncate text-muted-foreground text-xs">{line}</p>
      </div>
      <BarChart
        className="mt-1"
        heightClassName="h-28"
        hideYLabels
        hideGrid
        zeroStubs
        series={[{ id: "events", label: "Events", color: seriesColors.neutral, values }]}
        labels={labels}
        tooltipLabels={tips}
        format={(v) => formatCount(Math.round(v))}
        total={false}
        ariaLabel={s ? `Events every ${stepLabel(s.step)}, since ${clock.time(s.earliest ?? s.from)}` : "Events over time"}
        loading={loading}
        emptyText="No events yet."
      />
    </div>
  );
}

/** "5 minutes", "1 hour", "2 hours": the bucket step in words, for the chart's label. */
export function stepLabel(step: number): string {
  if (step % 60 === 0) return step === 60 ? "1 hour" : `${step / 60} hours`;
  return step === 1 ? "1 minute" : `${step} minutes`;
}
