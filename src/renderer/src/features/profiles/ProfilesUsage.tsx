/**
 * "Usage by profile", the right-hand column of the Profiles hero
 * (docs/ux/pages/profiles.md, Layout 1), built like Devices' Live throughput
 * panel: the title with a range dropdown on its row and the daily (or
 * hourly) average under it, the total as a compact hero figure, small
 * stacked columns with one segment per profile in its colour, and each
 * profile's total as a chip. Profiles only: Unassigned is left out (it is in
 * the hero's devices bar, and its traffic would flatten the profiles here).
 */
import { useState } from "react";

import { useQuery } from "~/app/useCommand";
import { BarChart } from "~/components/charts/BarChart";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "~/components/ui/select";
import { cn } from "~/lib/utils";
import { bytesParts, formatBytes, networkClock } from "../../../../core/format";
import type { ProfileList, UsageRange, UsageSeries } from "../../../../core/model";

import type { ProfileColor } from "./ProfilesPage";

const RANGES = [
  { value: "day", label: "Last 24 hours" },
  { value: "week", label: "Last 7 days" },
] as const;

type Props = { profiles: ProfileList | undefined; colorOf: ProfileColor; timezone: string | null };

export function ProfilesUsage({ profiles, colorOf, timezone }: Props) {
  const [range, setRange] = useState<UsageRange>("week");
  const usage = useQuery<UsageSeries[]>("usage.get", { scope: "profile", range }, { poll: true });

  const day = range === "day";
  const { hour, weekday, longDate } = networkClock(timezone);
  const names = new Map((profiles?.profiles ?? []).map((p) => [p.id, p.name]));
  // Largest first, so the biggest series sits at the bottom of the stack and leads the chips.
  const all = (profiles ? (usage.data ?? []) : [])
    .filter((s) => s.id !== null && names.has(s.id))
    .map((s) => ({ s, total: s.total.down + s.total.up }))
    .sort((a, b) => b.total - a.total);
  const sum = all.reduce((n, x) => n + x.total, 0);
  const points = all[0]?.s.points ?? [];
  const buckets = Math.max(1, points.length);
  const labels = points.map((p) => (day ? hour(p.at) : weekday(p.at)));
  const tooltipLabels = points.map((p) => (day ? `${weekday(p.at)} ${hour(p.at)} to ${hour(Date.parse(p.at) + 3_600_000)}` : longDate(p.at)));
  const hero = bytesParts(sum > 0 ? sum : null);
  const fade = usage.fading ? "opacity-40 transition-opacity" : "transition-opacity";

  return (
    <div data-slot="profiles-usage" className="flex w-[28rem] flex-col gap-2">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="whitespace-nowrap font-semibold text-base text-foreground leading-7">Usage by profile</h2>
          {/* "About 247 GB a day": the average per bucket, so the range reads at a glance. */}
          <p className="truncate text-muted-foreground text-xs">{sum > 0 ? `About ${formatBytes(sum / buckets)} ${day ? "an hour" : "a day"}` : "-"}</p>
        </div>
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
      </div>
      {usage.error && !usage.data ? (
        <div className="flex h-36 items-center text-muted-foreground text-xs">
          Couldn't load usage by profile.{" "}
          <button type="button" className="ms-1 cursor-pointer underline" onClick={() => void usage.refetch()}>
            Retry
          </button>
        </div>
      ) : (
        <>
          {/* The compact hero figure, the same size as Live throughput's. */}
          <div className={cn("flex items-baseline gap-1.5 whitespace-nowrap", fade)}>
            <span className="font-semibold text-2xl tabular-nums tracking-tight">{hero.value}</span>
            <span className="text-muted-foreground text-xs">
              {hero.unit} {day ? "in 24 hours" : "in 7 days"}
            </span>
          </div>
          <BarChart
            heightClassName="h-24"
            hideYLabels
            series={all.map(({ s }) => ({
              id: s.id ?? "unassigned",
              label: names.get(s.id ?? "") ?? "Profile",
              color: colorOf(s.id),
              values: s.points.map((p) => p.down + p.up),
            }))}
            labels={labels}
            tooltipLabels={tooltipLabels}
            format={formatBytes}
            total
            loading={usage.loading && (!usage.data || usage.fading)}
            ariaLabel={day ? "Data used per hour by profile, last 24 hours, stacked" : "Data used per day by profile, last 7 days, stacked"}
          />
          <div className={cn("flex flex-wrap gap-x-3.5 gap-y-1 text-xs", fade)}>
            {all.map(({ s, total }) => (
              <span key={s.id} className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <i aria-hidden className="size-2 rounded-xs" style={{ backgroundColor: colorOf(s.id) }} />
                <span className="text-muted-foreground">{names.get(s.id ?? "")}</span>
                <span className="font-medium tabular-nums">{formatBytes(total)}</span>
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
