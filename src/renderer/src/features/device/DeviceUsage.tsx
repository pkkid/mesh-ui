/**
 * Device detail "Data usage" (docs/ux/pages/device-detail.md, Layout 2), in
 * the shape of Overview's: the range dropdown (Last 24 hours, Last 7 days,
 * This month: the calendar month from the 1st, like the eero app) in
 * the header with the range and the busiest bucket under the title, then the
 * hero total beside the Download / Upload legend with each one's share, and
 * the area chart, on the page (no card). Totals and the busiest bucket come
 * from `usage.get` (device scope).
 */
import { useState } from "react";

import { useQuery } from "~/app/useCommand";
import { AreaChart } from "~/components/charts/AreaChart";
import { Section } from "~/components/ui/card";
import { SectionError } from "~/components/ui/page";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "~/components/ui/select";
import { seriesColors } from "~/lib/chartColors";
import { cn } from "~/lib/utils";
import { bytesParts, formatBytes, formatPercent, networkClock } from "../../../../core/format";
import type { UsageRange, UsageSeries } from "../../../../core/model";

import type { DeviceView } from "./DevicePage";

const RANGES = [
  { value: "day", label: "Last 24 hours" },
  { value: "week", label: "Last 7 days" },
  { value: "month", label: "This month" },
] as const;

/** The range in the description and the chart's label. */
const RANGE_TEXT: Record<UsageRange, { lead: string; aria: string }> = {
  day: { lead: "Last 24 hours", aria: "per hour, last 24 hours" },
  week: { lead: "Last 7 days", aria: "per day, last 7 days" },
  month: { lead: "This month", aria: "per day, this month" },
};

const HOUR_MS = 3_600_000;

export function DeviceUsage({ view, id }: { view: DeviceView; id: string }) {
  const [range, setRange] = useState<UsageRange>("day");
  const usage = useQuery<UsageSeries>("usage.get", { scope: "device", id, range }, { poll: true });

  const day = range === "day";
  const s = usage.data;
  const points = s?.points ?? [];
  const total = s ? s.total.down + s.total.up : 0;
  const hasData = total > 0;
  const month = range === "month";
  const { hour, weekday, longWeekday, longDate, day: dayLabel } = networkClock(view.network?.timezone);

  // Month axis labels carry the date ("Sat Nov 8"); a weekday alone repeats across weeks.
  const labels = points.map((p) => (day ? hour(p.at) : month ? dayLabel(p.at) : weekday(p.at)));
  const tooltipLabels = points.map((p) => (day ? `${weekday(p.at)} ${hour(p.at)} to ${hour(Date.parse(p.at) + HOUR_MS)}` : longDate(p.at)));

  const busiest = s?.busiest && hasData ? s.busiest : null;
  // "Last 24 hours, busiest hour 7 AM · 39.7 MB": the range, then its busiest bucket.
  const description = [
    RANGE_TEXT[range].lead,
    busiest
      ? `busiest ${day ? `hour ${hour(busiest.at)}` : month ? `day ${dayLabel(busiest.at)}` : `day ${longWeekday(busiest.at)}`} · ${formatBytes(busiest.down + busiest.up)}`
      : null,
  ]
    .filter(Boolean)
    .join(", ");

  const hero = bytesParts(hasData ? total : null);
  const muted = view.device?.blocked === true;
  const fade = usage.fading ? "opacity-40" : undefined;

  return (
    <Section
      title="Data usage"
      description={description}
      className="gap-[15px]"
      tools={
        // A dropdown, not a Segmented toggle (design-system.md, Dropdowns, not pill toggles).
        <Select items={RANGES} value={range} onValueChange={(v) => v && setRange(v)}>
          <SelectTrigger size="tool" aria-label="Range">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            {RANGES.map((r) => (
              <SelectItem key={r.value} value={r.value}>
                {r.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    >
      {usage.error && !s ? (
        <SectionError what="data usage" error={usage.error} onRetry={() => void usage.refetch()} />
      ) : (
        <div className={cn(muted && "opacity-60")}>
          <div className={cn("mb-3 flex flex-wrap items-end gap-x-7 gap-y-2 transition-opacity", fade)}>
            <div className="font-semibold text-4xl tabular-nums tracking-tight">
              {hero.value}
              {hero.unit && <small className="ms-1 font-medium text-base text-muted-foreground">{hero.unit}</small>}
            </div>
            <div className="ms-auto flex gap-4 text-xs">
              <Legend color={seriesColors.download} label="Download" value={hasData ? s?.total.down : null} share={hasData ? (s?.total.down ?? 0) / total : null} />
              <Legend color={seriesColors.upload} label="Upload" value={hasData ? s?.total.up : null} share={hasData ? (s?.total.up ?? 0) / total : null} />
            </div>
          </div>
          <AreaChart
            series={[
              { id: "down", label: "Download", color: seriesColors.download, values: points.map((p) => p.down) },
              { id: "up", label: "Upload", color: seriesColors.upload, values: points.map((p) => p.up) },
            ]}
            labels={labels}
            tooltipLabels={tooltipLabels}
            format={formatBytes}
            loading={usage.loading && (!s || usage.fading)}
            heightClassName="h-52"
            ariaLabel={`${view.device?.name ?? "Device"} data used ${RANGE_TEXT[range].aria}, download and upload`}
          />
        </div>
      )}
    </Section>
  );
}

/** "Download 16.0 MB (68%)": colour square, muted label, value, and its share of the total in muted text. */
function Legend({ color, label, value, share }: { color: string; label: string; value: number | null | undefined; share: number | null }) {
  return (
    <span className="flex items-center gap-1.5 text-muted-foreground">
      <span aria-hidden className="size-2 rounded-[2px]" style={{ background: color }} />
      {label}
      <span className="font-medium text-foreground tabular-nums">{formatBytes(value)}</span>
      {share !== null && <span className="tabular-nums">({formatPercent(share * 100)})</span>}
    </span>
  );
}
