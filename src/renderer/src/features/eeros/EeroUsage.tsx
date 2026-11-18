/**
 * "Data usage by eero": download plus upload per eero, stacked, per hour
 * (Day) or per day (Week). Legend items show each eero's total in its series
 * colour and hide or show that series. docs/ux/pages/eeros.md (Layout 3).
 */
import { useState } from "react";

import { useQuery } from "~/app/useCommand";
import { AreaChart } from "~/components/charts/AreaChart";
import { Card, Section } from "~/components/ui/card";
import { SectionError } from "~/components/ui/page";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "~/components/ui/select";
import { entityColors, seriesColors } from "~/lib/chartColors";
import { cn } from "~/lib/utils";
import { formatBytes, formatPercent, networkClock } from "../../../../core/format";
import type { Eero, UsageRange, UsageSeries } from "../../../../core/model";

const RANGES = [
  { value: "day", label: "Last 24 hours" },
  { value: "week", label: "Last 7 days" },
] as const;

export function EeroUsage({ eeros, timezone }: { eeros: ReadonlyArray<Eero> | undefined; timezone: string | null }) {
  const [range, setRange] = useState<UsageRange>("day");
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const usage = useQuery<UsageSeries[]>("usage.get", { scope: "eero", range }, { poll: true });

  const day = range === "day";
  const { hour, weekday, longDate } = networkClock(timezone);
  const names = new Map((eeros ?? []).map((e) => [e.id, e.location]));
  const colors = entityColors((eeros ?? []).map((e) => e.id));
  // Largest first, so the biggest series sits at the bottom of the stack.
  const all = (eeros ? (usage.data ?? []) : [])
    .map((s, i) => ({ s, id: s.id ?? `eero-${i}`, total: s.total.down + s.total.up }))
    .sort((a, b) => b.total - a.total);
  const points = all[0]?.s.points ?? [];
  const labels = points.map((p) => (day ? hour(p.at) : weekday(p.at)));
  const tooltipLabels = points.map((p) => (day ? `${weekday(p.at)} ${hour(p.at)} to ${hour(Date.parse(p.at) + 3_600_000)}` : longDate(p.at)));
  const shown = all.filter((x) => !hidden.has(x.id));
  // "24 hours, Basement carried 91%": the window, then the busiest eero's share.
  const sum = all.reduce((n, x) => n + x.total, 0);
  const top = all[0];
  const window = day ? "24 hours" : "7 days";
  const description = usage.data && top && sum > 0 ? `${window}, ${names.get(top.id) ?? "eero"} carried ${formatPercent((top.total / sum) * 100)}` : window;

  const toggle = (id: string) =>
    setHidden((h) => {
      const next = new Set(h);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <Section
      title="Data usage by eero"
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
      {usage.error && !usage.data ? (
        <SectionError what="usage by eero" error={usage.error} onRetry={() => void usage.refetch()} />
      ) : (
        <Card padded>
          <div className={cn("mb-2.5 flex flex-wrap gap-x-4 gap-y-1.5 text-xs transition-opacity", usage.fading && "opacity-40")}>
            {all.length === 0 && <span className="text-muted-foreground">-</span>}
            {all.map(({ id, total }) => {
              const off = hidden.has(id);
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={!off}
                  title={off ? "Show" : "Hide"}
                  onClick={() => toggle(id)}
                  className={cn(
                    "inline-flex cursor-pointer items-center gap-1.5 rounded-sm text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    off && "opacity-50",
                  )}
                >
                  <i aria-hidden className="size-2 rounded-[2px]" style={{ background: off ? seriesColors.neutral : (colors[id] ?? seriesColors.neutral) }} />
                  {names.get(id) ?? "eero"}
                  <b className="font-medium text-foreground tabular-nums">{formatBytes(total)}</b>
                </button>
              );
            })}
          </div>
          <AreaChart
            stacked
            total
            heightClassName="h-[200px]"
            series={shown.map(({ s, id }) => ({
              id,
              label: names.get(id) ?? "eero",
              color: colors[id] ?? seriesColors.neutral,
              values: s.points.map((p) => p.down + p.up),
            }))}
            labels={labels}
            tooltipLabels={tooltipLabels}
            format={formatBytes}
            loading={usage.loading && (!usage.data || usage.fading)}
            ariaLabel={day ? "Data used by each eero per hour, last 24 hours, stacked" : "Data used by each eero per day, last 7 days, stacked"}
          />
        </Card>
      )}
    </Section>
  );
}
