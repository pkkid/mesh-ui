/**
 * Activity "Events by type" chart: stacked columns per day (or per hour) by
 * event category, from `events.summary`. Also home to the category labels,
 * icons and colours every part of the page shares (legend, chart, rows).
 * docs/ux/pages/activity.md (Layout 1).
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

import type { ChartSeries } from "~/components/charts/AreaChart";
import { BarChart } from "~/components/charts/BarChart";
import { hue, seriesColors } from "~/lib/chartColors";
import { formatCount, networkClock } from "../../../../core/format";
import type { EventCategory, EventSummary } from "../../../../core/model";

export type CategoryMeta = { label: string; icon: LucideIcon; color: string };

/**
 * One colour per event category, the same in legend, chart and share. Kept
 * here because only Activity charts categories; the hues come from the theme
 * series palette through chartColors.ts.
 */
export const CATEGORIES: Readonly<Record<EventCategory, CategoryMeta>> = {
  devices: { label: "Devices joined / left", icon: Smartphone, color: hue("blue") },
  pause_block: { label: "Paused / blocked", icon: PauseCircle, color: hue("orange") },
  schedules: { label: "Schedules", icon: CalendarClock, color: hue("red") },
  eero_status: { label: "eero status", icon: Router, color: hue("yellow") },
  speed_tests: { label: "Speed tests", icon: Gauge, color: hue("aqua") },
  firmware: { label: "Firmware", icon: Download, color: hue("gray") },
  admin: { label: "Admin actions", icon: ShieldCheck, color: hue("purple") },
  ports_temperature: { label: "Ports & temperature", icon: Cable, color: hue("green") },
  other: { label: "Other", icon: Bell, color: seriesColors.neutral },
};

export const CATEGORY_ORDER = Object.keys(CATEGORIES) as EventCategory[];

export function ActivityChart({
  summary,
  hidden,
  timeZone,
  loading,
}: {
  summary: EventSummary | undefined;
  hidden: ReadonlySet<EventCategory>;
  timeZone: string;
  loading: boolean;
}) {
  const clock = networkClock(timeZone);
  const hourly = summary?.bucket === "hour";
  const { series, labels, tips } = useMemo(() => {
    const buckets = summary?.buckets ?? [];
    // Largest series first, so small ones sit on top of the stack.
    const shown = CATEGORY_ORDER.filter((c) => !hidden.has(c) && (summary?.counts[c] ?? 0) > 0).sort(
      (a, b) => (summary?.counts[b] ?? 0) - (summary?.counts[a] ?? 0),
    );
    const series: ChartSeries[] = shown.map((c) => ({
      id: c,
      label: CATEGORIES[c].label,
      color: CATEGORIES[c].color,
      values: buckets.map((b) => b.counts[c]),
    }));
    const labels = buckets.map((b) => (hourly ? clock.hour(b.at) : clock.weekday(b.at)));
    const tips = buckets.map((b) => (hourly ? `${clock.day(b.at)}, ${clock.hour(b.at)}` : clock.day(b.at)));
    return { series, labels, tips };
  }, [summary, hidden, hourly, clock]);

  return (
    <BarChart
      series={series}
      labels={labels}
      tooltipLabels={tips}
      format={(v) => formatCount(Math.round(v))}
      ariaLabel={hourly ? "Events per hour by type, last 24 hours" : "Events per day by type, last 7 days"}
      total
      loading={loading}
      heightClassName="h-56"
    />
  );
}
