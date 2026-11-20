/**
 * Profile detail "Data usage" (docs/ux/pages/profile-detail.md, Layout 3):
 * all of the profile's devices per hour (Day, the last 24 hours) or per day
 * (Week), with dashed markers where a scheduled pause started or ended, the
 * total and busiest bucket, and the top devices for the same window. From
 * `usage.get {scope: profile}` and `usage.breakdown {by: device, profile}`.
 * Laid out like device detail's Data usage: a range dropdown, the subtitle
 * built from the data under the title, and the chart on the section
 * background at the main chart height.
 */
import { useState } from "react";

import { pathFor } from "~/app/router";
import { useQuery } from "~/app/useCommand";
import { AreaChart } from "~/components/charts/AreaChart";
import { BreakdownTable } from "~/components/ui/breakdown-table";
import { Card, Empty, Section } from "~/components/ui/card";
import { SectionError } from "~/components/ui/page";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "~/components/ui/select";
import { seriesColors } from "~/lib/chartColors";
import { cn } from "~/lib/utils";
import { bytesParts, formatBytes, formatCount, formatPercent, networkClock } from "../../../../core/format";
import type { Profile, UsageBreakdown, UsageBreakdownRow, UsageRange, UsageSeries } from "../../../../core/model";

import { usageMarkers } from "./helpers";
import { scheduleColors } from "./ProfileSchedules";

const RANGES = [
  { value: "day", label: "Last 24 hours" },
  { value: "week", label: "Last 7 days" },
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
  const lead = day ? "24 hours" : "7 days";
  // "24 hours, busiest hour 7 PM, 3.1 GB": the bare window, then its busiest bucket (design-system.md, Subtitles carry data).
  const description = [lead, busiest ? `busiest ${day ? `hour ${hour(busiest.at)}` : `day ${longWeekday(busiest.at)}`}` : null, busiest ? formatBytes(busiest.down + busiest.up) : null]
    .filter(Boolean)
    .join(", ");
  const active = top.data?.rows.filter((r) => r.down + r.up > 0) ?? [];
  const topShare = hasData && total && active[0] ? (active[0].down + active[0].up) / total : null;
  // "24 hours, 4 devices, 65% from Mia's iPad".
  const topDescription = top.data
    ? [lead, `${formatCount(active.length)} ${active.length === 1 ? "device" : "devices"}`, topShare !== null ? `${formatPercent(topShare * 100)} from ${active[0]?.name}` : null]
        .filter(Boolean)
        .join(", ")
    : lead;
  const hero = bytesParts(hasData ? total : null);
  const fade = usage.fading ? "opacity-40" : undefined;

  return (
    <div className="grid gap-7 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
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
          <div>
            <div className={cn("mb-3 flex flex-wrap items-end gap-x-7 gap-y-2 transition-opacity", fade)}>
              <div className="font-semibold text-4xl tabular-nums tracking-tight">
                {hero.value}
                {hero.unit && <small className="ms-1 font-medium text-base text-muted-foreground">{hero.unit}</small>}
              </div>
              <div className="ms-auto flex flex-wrap gap-4 text-xs">
                <Legend color={seriesColors.download} label="Download" value={hasData ? s?.total.down : null} share={hasData && total ? (s?.total.down ?? 0) / total : null} />
                <Legend color={seriesColors.upload} label="Upload" value={hasData ? s?.total.up : null} share={hasData && total ? (s?.total.up ?? 0) / total : null} />
              </div>
            </div>
            <AreaChart
              heightClassName="h-56"
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
              ariaLabel={`Data usage of ${name}'s devices per ${day ? "hour" : "day"}, ${span}, download and upload${markers.length ? ", with markers where scheduled pauses start and end" : ""}`}
            />
          </div>
        )}
      </Section>

      <Section title="Top devices" description={topDescription} className="gap-[15px]">
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

/** "Download 14.3 GB (94%)": colour square, muted label, value, and its share of the total in muted text. */
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
