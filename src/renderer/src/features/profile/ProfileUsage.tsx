/**
 * Profile detail "Data usage" (docs/ux/pages/profile-detail.md, Layout 3):
 * all of the profile's devices per hour (Day, the last 24 hours) or per day
 * (Week), with dashed markers where a scheduled pause started or ended, the
 * total and busiest bucket, and the top devices for the same window. From
 * `usage.get {scope: profile}` and `usage.breakdown {by: device, profile}`.
 */
import { useState } from "react";

import { pathFor } from "~/app/router";
import { useQuery } from "~/app/useCommand";
import { AreaChart } from "~/components/charts/AreaChart";
import { BreakdownTable } from "~/components/ui/breakdown-table";
import { Card, Empty, Section } from "~/components/ui/card";
import { SectionError } from "~/components/ui/page";
import { Segmented } from "~/components/ui/segmented";
import { seriesColors } from "~/lib/chartColors";
import { cn } from "~/lib/utils";
import { formatBytes, networkClock } from "../../../../core/format";
import type { Profile, UsageBreakdown, UsageBreakdownRow, UsageRange, UsageSeries } from "../../../../core/model";

import { usageMarkers } from "./helpers";
import { scheduleColors } from "./ProfileSchedules";

const RANGES = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
] as const;

type Props = { profileId: string; profile: Profile | null; timezone: string | null };

export function ProfileUsage({ profileId, profile, timezone }: Props) {
  const [range, setRange] = useState<UsageRange>("day");
  const usage = useQuery<UsageSeries>("usage.get", { scope: "profile", id: profileId, range }, { poll: true });
  const top = useQuery<UsageBreakdown>("usage.breakdown", { range, by: "device", profile: profileId }, { poll: true });

  const day = range === "day";
  const { hour, weekday, longDate, longWeekday } = networkClock(timezone);
  const s = usage.data;
  const points = s?.points ?? [];
  const total = s ? s.total.down + s.total.up : null;
  const hasData = total !== null && total > 0;
  const labels = points.map((p) => (day ? hour(p.at) : weekday(p.at)));
  const tooltipLabels = points.map((p) => (day ? `${weekday(p.at)} ${hour(p.at)} to ${hour(Date.parse(p.at) + 3_600_000)}` : longDate(p.at)));
  const busiest = hasData && s?.busiest ? s.busiest : null;
  const schedules = profile?.schedules ?? [];
  const colors = scheduleColors(schedules);
  const markers = day ? usageMarkers(points, schedules, timezone).map((m) => ({ index: m.index, label: m.label, color: colors[m.scheduleId] })) : [];
  const name = profile?.name ?? "this profile";
  const rows = top.data?.rows.filter((r) => r.down + r.up > 0).slice(0, 5);
  const span = day ? "last 24 hours" : "last 7 days";

  return (
    <div className="grid gap-7 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <Section
        title="Data usage"
        subtitle={day ? `All of ${name}'s devices, per hour, ${span}${markers.length ? " · markers show scheduled pauses" : ""}` : `All of ${name}'s devices, per day, ${span}`}
        tools={<Segmented aria-label="Range" value={range} onValueChange={setRange} options={RANGES} />}
      >
        {usage.error && !s ? (
          <SectionError what="data usage" error={usage.error} onRetry={() => void usage.refetch()} />
        ) : s && !hasData ? (
          <Card>
            <Empty>No activity in this window.</Empty>
          </Card>
        ) : (
          <Card padded>
            <div className={cn("mb-3 flex flex-wrap items-end gap-x-6 gap-y-2 transition-opacity", usage.fading && "opacity-40")}>
              <div>
                <div className="font-semibold text-4xl tabular-nums">{formatBytes(hasData ? total : null)}</div>
                <div className="text-muted-foreground text-xs">
                  {busiest ? `Busiest ${day ? `hour ${hour(busiest.at)}` : `day ${longWeekday(busiest.at)}`}` : `In the ${span}`}
                </div>
              </div>
              <div className="ms-auto flex flex-wrap gap-x-4 gap-y-1.5 text-muted-foreground text-xs">
                <Legend color={seriesColors.download} label="Download" value={hasData ? s?.total.down : null} />
                <Legend color={seriesColors.upload} label="Upload" value={hasData ? s?.total.up : null} />
              </div>
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
              markers={markers}
              loading={usage.loading && (!s || usage.fading)}
              ariaLabel={`Data usage of ${name}'s devices per ${day ? "hour" : "day"}, ${span}, download and upload`}
            />
          </Card>
        )}
      </Section>

      <Section title="Top devices" subtitle={day ? "Last 24 hours" : "Last 7 days"}>
        {top.error && !top.data ? (
          <SectionError what="top devices" error={top.error} onRetry={() => void top.refetch()} />
        ) : rows && rows.length === 0 ? (
          <Card>
            <Empty>No activity in this window.</Empty>
          </Card>
        ) : (
          <Card>
            <BreakdownTable<UsageBreakdownRow>
              rows={rows}
              rowKey={(r) => r.id ?? r.name}
              nameHeader="Device"
              name={(r) => r.name}
              to={(r) => (r.id ? pathFor("device", { deviceId: r.id }) : undefined)}
              size={(r) => r.down + r.up}
              color={seriesColors.download}
              ranked
              fading={top.fading}
              placeholderCount={3}
              columns={[{ header: "Data", cell: (r) => formatBytes(r.down + r.up) }]}
            />
          </Card>
        )}
      </Section>
    </div>
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
