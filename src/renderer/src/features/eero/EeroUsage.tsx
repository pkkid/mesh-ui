/**
 * eero detail "Data usage": download and upload for every client on this
 * eero, per hour (Day) or per day (Week), with totals in the legend.
 * docs/ux/pages/eero-detail.md (Layout 2). Figures come from `usage.get`.
 */
import { useState } from "react";

import { useQuery } from "~/app/useCommand";
import { AreaChart } from "~/components/charts/AreaChart";
import { Card, Section } from "~/components/ui/card";
import { SectionError } from "~/components/ui/page";
import { Segmented } from "~/components/ui/segmented";
import { seriesColors } from "~/lib/chartColors";
import { cn } from "~/lib/utils";
import { formatBytes, networkClock } from "../../../../core/format";
import type { UsageRange, UsageSeries } from "../../../../core/model";

const RANGES = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
] as const;

export function EeroUsage({ eeroId, name, timezone }: { eeroId: string; name: string; timezone: string | null }) {
  const [range, setRange] = useState<UsageRange>("day");
  const usage = useQuery<UsageSeries>("usage.get", { scope: "eero", id: eeroId, range }, { poll: true, enabled: eeroId !== "" });

  const day = range === "day";
  const { hour, weekday, longDate } = networkClock(timezone);
  const s = usage.data;
  const points = s?.points ?? [];
  const hasData = s ? s.total.down + s.total.up > 0 : false;
  const labels = points.map((p) => (day ? hour(p.at) : weekday(p.at)));
  const tooltipLabels = points.map((p) => (day ? `${weekday(p.at)} ${hour(p.at)} to ${hour(Date.parse(p.at) + 3_600_000)}` : longDate(p.at)));

  return (
    <Section
      title="Data usage"
      subtitle={day ? `All clients on ${name}, per hour` : `All clients on ${name}, per day`}
      tools={<Segmented aria-label="Range" value={range} onValueChange={setRange} options={RANGES} />}
    >
      {usage.error && !s ? (
        <SectionError what="data usage" error={usage.error} onRetry={() => void usage.refetch()} />
      ) : (
        <Card padded>
          <div className={cn("mb-2.5 flex flex-wrap gap-x-4 gap-y-1.5 text-muted-foreground text-xs transition-opacity", usage.fading && "opacity-40")}>
            <Legend color={seriesColors.download} label="Download" value={hasData ? s?.total.down : null} />
            <Legend color={seriesColors.upload} label="Upload" value={hasData ? s?.total.up : null} />
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
            ariaLabel={day ? `${name} data usage per hour, last 24 hours, download and upload` : `${name} data usage per day, last 7 days, download and upload`}
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
