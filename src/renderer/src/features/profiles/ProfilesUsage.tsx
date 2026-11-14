/**
 * "Usage by profile": a hero total and one row per profile (and Unassigned)
 * beside stacked columns, one segment per profile in its colour, per hour
 * (Day) or per day (Week). Profiles / Profiles + Unassigned only hides the
 * Unassigned series. docs/ux/pages/profiles.md (Layout 3).
 */
import { useState } from "react";

import { useQuery } from "~/app/useCommand";
import { BarChart } from "~/components/charts/BarChart";
import { Card, Section } from "~/components/ui/card";
import { SectionError } from "~/components/ui/page";
import { Segmented } from "~/components/ui/segmented";
import { cn } from "~/lib/utils";
import { bytesParts, formatBytes, formatPercent, networkClock } from "../../../../core/format";
import type { ProfileList, UsageRange, UsageSeries } from "../../../../core/model";

import type { ProfileColor } from "./ProfilesPage";

const RANGES = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
] as const;

const SCOPES = [
  { value: "profiles", label: "Profiles" },
  { value: "all", label: "Profiles + Unassigned" },
] as const;

type Props = { profiles: ProfileList | undefined; colorOf: ProfileColor; timezone: string | null };

export function ProfilesUsage({ profiles, colorOf, timezone }: Props) {
  const [range, setRange] = useState<UsageRange>("week");
  const [scope, setScope] = useState<"profiles" | "all">("all");
  const usage = useQuery<UsageSeries[]>("usage.get", { scope: "profile", range }, { poll: true });

  const day = range === "day";
  const { hour, weekday, longDate } = networkClock(timezone);
  const names = new Map((profiles?.profiles ?? []).map((p) => [p.id, p.name]));
  const nameOf = (id: string | null) => (id === null ? "Unassigned" : (names.get(id) ?? "Profile"));
  // Largest first, so the biggest series sits at the bottom of the stack and the top of the list.
  const all = (profiles ? (usage.data ?? []) : [])
    .filter((s) => scope === "all" || s.id !== null)
    .map((s) => ({ s, total: s.total.down + s.total.up }))
    .sort((a, b) => b.total - a.total);
  const sum = all.reduce((n, x) => n + x.total, 0);
  const points = all[0]?.s.points ?? [];
  const labels = points.map((p) => (day ? hour(p.at) : weekday(p.at)));
  const tooltipLabels = points.map((p) => (day ? `${weekday(p.at)} ${hour(p.at)} to ${hour(Date.parse(p.at) + 3_600_000)}` : longDate(p.at)));
  const hero = bytesParts(sum > 0 ? sum : null);
  const fade = usage.fading ? "opacity-40 transition-opacity" : "transition-opacity";
  const buckets = Math.max(1, points.length);

  return (
    <Section
      title="Usage by profile"
      subtitle={day ? "Data used per hour, last 24 hours" : "Data used per day, last 7 days"}
      tools={
        <>
          <Segmented aria-label="Series" value={scope} onValueChange={setScope} options={SCOPES} />
          <Segmented aria-label="Range" value={range} onValueChange={setRange} options={RANGES} />
        </>
      }
    >
      {usage.error && !usage.data ? (
        <SectionError what="usage by profile" error={usage.error} onRetry={() => void usage.refetch()} />
      ) : (
        <div className="grid gap-7 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
          <div className="flex flex-col gap-4">
            <div className={fade}>
              <div className="font-semibold text-4xl tabular-nums tracking-tight">
                {hero.value}
                {hero.unit && <small className="ms-1 font-medium text-base text-muted-foreground">{hero.unit}</small>}
              </div>
              <div className="mt-1 text-muted-foreground text-xs">{day ? "in 24 hours" : "in 7 days"}</div>
            </div>
            <div className={cn("flex flex-col gap-3", fade)}>
              {all.map(({ s, total }) => (
                <div key={s.id ?? "unassigned"}>
                  <div className="flex items-center justify-between gap-2 text-[13px]">
                    <span className="flex min-w-0 items-center gap-2">
                      <i aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: colorOf(s.id) }} />
                      <span className="truncate">{nameOf(s.id)}</span>
                    </span>
                    <span className="font-medium tabular-nums">{formatBytes(sum > 0 ? total : null)}</span>
                  </div>
                  {sum > 0 && (
                    <div className="mt-0.5 ps-4 text-muted-foreground text-xs">
                      {formatPercent((total / sum) * 100)} of traffic · {formatBytes(total / buckets)} {day ? "an hour" : "a day"}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
          <Card padded>
            <BarChart
              heightClassName="h-56"
              series={[...all].map(({ s }) => ({
                id: s.id ?? "unassigned",
                label: nameOf(s.id),
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
          </Card>
        </div>
      )}
    </Section>
  );
}
