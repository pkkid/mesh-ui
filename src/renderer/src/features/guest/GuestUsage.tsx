/**
 * Guest network "Guest usage": download and upload of every guest, per hour
 * (Day) or per day (Week), with totals, the busiest bucket and the guests'
 * share of all network traffic. docs/ux/pages/guest.md (Layout 2). Figures
 * come from `usage.get` (guest scope, and network scope for the share).
 */
import { useState } from "react";

import { useQuery } from "~/app/useCommand";
import { AreaChart } from "~/components/charts/AreaChart";
import { Card, Empty, Section } from "~/components/ui/card";
import { SectionError } from "~/components/ui/page";
import { Segmented } from "~/components/ui/segmented";
import { seriesColors } from "~/lib/chartColors";
import { cn } from "~/lib/utils";
import { formatBytes, formatPercent, networkClock } from "../../../../core/format";
import type { UsageRange, UsageSeries } from "../../../../core/model";

const RANGES = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
] as const;

export function GuestUsage({ timezone, off }: { timezone: string | null; off: boolean }) {
  const [range, setRange] = useState<UsageRange>("day");
  const usage = useQuery<UsageSeries>("usage.get", { scope: "guest", range }, { poll: true });
  const network = useQuery<UsageSeries>("usage.get", { scope: "network", range }, { poll: true });

  const day = range === "day";
  const { hour, weekday, longDate, longWeekday } = networkClock(timezone);
  const s = usage.data;
  const points = s?.points ?? [];
  const total = s ? s.total.down + s.total.up : null;
  const hasData = total !== null && total > 0;
  const all = network.data ? network.data.total.down + network.data.total.up : null;
  const share = hasData && all ? (total / all) * 100 : null;
  const labels = points.map((p) => (day ? hour(p.at) : weekday(p.at)));
  const tooltipLabels = points.map((p) => (day ? `${weekday(p.at)} ${hour(p.at)} to ${hour(Date.parse(p.at) + 3_600_000)}` : longDate(p.at)));
  const busiest = hasData && s?.busiest ? s.busiest : null;

  const subtitle = !s
    ? null
    : !hasData
      ? day
        ? "Last 24 hours"
        : "Last 7 days"
      : `${formatBytes(total)} in ${day ? "24 hours" : "7 days"}${share !== null ? `, ${share < 1 ? "under 1%" : formatPercent(share)} of all network traffic` : ""}`;

  return (
    <Section title="Guest usage" subtitle={subtitle} tools={<Segmented aria-label="Range" value={range} onValueChange={setRange} options={RANGES} />}>
      {usage.error && !s ? (
        <SectionError what="guest usage" error={usage.error} onRetry={() => void usage.refetch()} />
      ) : s && !hasData ? (
        <Card>
          <Empty>{off ? "No guest activity in this window. Turn the guest network on to share it." : "No guest activity in this window."}</Empty>
        </Card>
      ) : (
        <Card padded>
          <div className={cn("mb-2.5 flex flex-wrap gap-x-4 gap-y-1.5 text-muted-foreground text-xs transition-opacity", usage.fading && "opacity-40")}>
            <Legend color={seriesColors.download} label="Download" value={hasData ? s?.total.down : null} />
            <Legend color={seriesColors.upload} label="Upload" value={hasData ? s?.total.up : null} />
            {busiest && (
              <span className="ms-auto">
                Busiest {day ? "hour" : "day"} <b className="font-medium text-foreground tabular-nums">{formatBytes(busiest.down + busiest.up)}</b>{" "}
                {day ? `at ${hour(busiest.at)}` : `on ${longWeekday(busiest.at)}`}
              </span>
            )}
          </div>
          <AreaChart
            heightClassName="h-[200px]"
            series={[
              { id: "down", label: "Download", color: seriesColors.download, values: points.map((p) => p.down) },
              { id: "up", label: "Upload", color: seriesColors.upload, values: points.map((p) => p.up) },
            ]}
            labels={labels}
            tooltipLabels={tooltipLabels}
            format={formatBytes}
            total
            loading={usage.loading && (!s || usage.fading)}
            ariaLabel={day ? "Guest network data usage per hour, last 24 hours, download and upload" : "Guest network data usage per day, last 7 days, download and upload"}
          />
        </Card>
      )}
    </Section>
  );
}

function Legend({ color, label, value }: { color: string; label: string; value: number | null | undefined }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <i aria-hidden className="size-2 rounded-[2px]" style={{ background: color }} />
      {label}
      <b className="font-medium text-foreground tabular-nums">{formatBytes(value)}</b>
    </span>
  );
}
