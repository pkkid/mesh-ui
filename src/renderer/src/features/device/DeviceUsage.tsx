/**
 * Device detail "Data usage" (docs/ux/pages/device-detail.md, Layout 2):
 * Day / Week toggle, the hero total with the busiest bucket and this
 * device's rank on the network, the Download / Upload legend and the area
 * chart. Totals and the busiest bucket come from `usage.get` (device scope);
 * the rank from `usage.breakdown` by device, skipped outside the top 50.
 */
import { useState } from "react";

import { useQuery } from "~/app/useCommand";
import { AreaChart } from "~/components/charts/AreaChart";
import { Card, Section } from "~/components/ui/card";
import { SectionError } from "~/components/ui/page";
import { Segmented } from "~/components/ui/segmented";
import { seriesColors } from "~/lib/chartColors";
import { cn } from "~/lib/utils";
import { bytesParts, formatBytes, networkClock } from "../../../../core/format";
import type { UsageBreakdown, UsageRange, UsageSeries } from "../../../../core/model";

import type { DeviceView } from "./DevicePage";

const RANGES = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
] as const;

const RANK_LIMIT = 50;
const HOUR_MS = 3_600_000;

export function DeviceUsage({ view, id }: { view: DeviceView; id: string }) {
  const [range, setRange] = useState<UsageRange>("day");
  const usage = useQuery<UsageSeries>("usage.get", { scope: "device", id, range }, { poll: true });
  const breakdown = useQuery<UsageBreakdown>("usage.breakdown", { range, by: "device" }, { poll: true });

  const day = range === "day";
  const s = usage.data;
  const points = s?.points ?? [];
  const total = s ? s.total.down + s.total.up : 0;
  const hasData = total > 0;
  const { hour, weekday, longWeekday, longDate } = networkClock(view.network?.timezone);

  const labels = points.map((p) => (day ? hour(p.at) : weekday(p.at)));
  const tooltipLabels = points.map((p) => (day ? `${weekday(p.at)} ${hour(p.at)} to ${hour(Date.parse(p.at) + HOUR_MS)}` : longDate(p.at)));

  const rows = [...(breakdown.data?.rows ?? [])].sort((a, b) => b.down + b.up - (a.down + a.up));
  const rank = rows.findIndex((r) => r.id === id) + 1;
  const busiest = s?.busiest && hasData ? s.busiest : null;
  const line = [
    busiest ? `busiest ${day ? `hour ${hour(busiest.at)}` : `day ${longWeekday(busiest.at)}`} · ${formatBytes(busiest.down + busiest.up)}` : null,
    rank > 0 && rank <= RANK_LIMIT && hasData ? `#${rank} on the network` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const hero = bytesParts(hasData ? total : null);
  const muted = view.device?.blocked === true;
  const fade = usage.fading ? "opacity-40" : undefined;

  return (
    <Section
      title="Data usage"
      subtitle={day ? "Per hour, last 24 hours" : "Per day, last 7 days"}
      tools={<Segmented aria-label="Range" value={range} onValueChange={setRange} options={RANGES} />}
    >
      {usage.error && !s ? (
        <SectionError what="data usage" error={usage.error} onRetry={() => void usage.refetch()} />
      ) : (
        <Card padded className={cn(muted && "opacity-60")}>
          <div className={cn("mb-3 flex flex-wrap items-end gap-x-7 gap-y-2 transition-opacity", fade)}>
            <div>
              <div className="font-semibold text-4xl tabular-nums tracking-tight">
                {hero.value}
                {hero.unit && <small className="ms-1 font-medium text-base text-muted-foreground">{hero.unit}</small>}
              </div>
              <div className="mt-1 text-muted-foreground text-xs">{line || (day ? "used in 24h" : "used in 7 days")}</div>
            </div>
            <div className="ms-auto flex gap-4 text-xs">
              <Legend color={seriesColors.download} label="Download" value={hasData ? s?.total.down : null} />
              <Legend color={seriesColors.upload} label="Upload" value={hasData ? s?.total.up : null} />
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
            ariaLabel={`${view.device?.name ?? "Device"} data used ${day ? "per hour, last 24 hours" : "per day, last 7 days"}, download and upload`}
          />
        </Card>
      )}
    </Section>
  );
}

function Legend({ color, label, value }: { color: string; label: string; value: number | null | undefined }) {
  return (
    <span className="flex items-center gap-1.5 text-muted-foreground">
      <span aria-hidden className="size-2 rounded-[2px]" style={{ background: color }} />
      {label}
      <span className="font-medium text-foreground tabular-nums">{formatBytes(value)}</span>
    </span>
  );
}
