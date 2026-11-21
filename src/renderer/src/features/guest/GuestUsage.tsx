/**
 * Guest network "Guest usage": download and upload of every guest, per hour
 * (Last 24 hours) or per day (Last 7 days, both picked in a header dropdown),
 * drawn like the Internet page's Per hour card (shared Legend and Stat), with totals, the busiest bucket and the guests'
 * share of all network traffic. docs/ux/pages/guest.md (Layout 2). Figures
 * come from `usage.get` (guest scope, and network scope for the share).
 */
import { ChartArea } from "lucide-react";
import { useState } from "react";

import { useQuery } from "~/app/useCommand";
import { AreaChart } from "~/components/charts/AreaChart";
import { Card, Section } from "~/components/ui/card";
import { Legend, Stat } from "~/features/internet/InternetUsage";
import { SectionError } from "~/components/ui/page";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "~/components/ui/select";
import { seriesColors } from "~/lib/chartColors";
import { cn } from "~/lib/utils";
import { formatBytes, formatPercent, networkClock } from "../../../../core/format";
import type { UsageRange, UsageSeries } from "../../../../core/model";

const RANGES = [
  { value: "day", label: "Last 24 hours" },
  { value: "week", label: "Last 7 days" },
] as const;

export function GuestUsage({ timezone }: { timezone: string | null }) {
  const [range, setRange] = useState<UsageRange>("day");
  const usage = useQuery<UsageSeries>("usage.get", { scope: "guest", range }, { poll: true });
  const network = useQuery<UsageSeries>("usage.get", { scope: "network", range }, { poll: true });

  const day = range === "day";
  const { hour, weekday, longDate } = networkClock(timezone);
  const s = usage.data;
  const points = s?.points ?? [];
  const total = s ? s.total.down + s.total.up : null;
  const hasData = total !== null && total > 0;
  const all = network.data ? network.data.total.down + network.data.total.up : null;
  const share = hasData && all ? (total / all) * 100 : null;
  const labels = points.map((p) => (day ? hour(p.at) : weekday(p.at)));
  const tooltipLabels = points.map((p) => (day ? `${weekday(p.at)} ${hour(p.at)} to ${hour(Date.parse(p.at) + 3_600_000)}` : longDate(p.at)));
  const busiest = hasData && s?.busiest ? s.busiest : null;
  // The largest hour (or day) each way, like the Internet page's Per hour stats.
  const maxDown = hasData ? Math.max(...points.map((p) => p.down)) : null;
  const maxUp = hasData ? Math.max(...points.map((p) => p.up)) : null;

  // "24 hours, 2.9 GB, under 1% of all traffic": the window bare, then what changes.
  const span = day ? "24 hours" : "7 days";
  const description = !s
    ? span
    : !hasData
      ? `${span}, no guest traffic`
      : [span, formatBytes(total), share !== null && `${share < 1 ? "under 1%" : formatPercent(share)} of all traffic`].filter(Boolean).join(", ");

  return (
    <Section
      title="Guest usage"
      description={description}
      className="gap-[15px]"
      tools={
        <Select items={RANGES} value={range} onValueChange={(v) => v && setRange(v as UsageRange)}>
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
        <SectionError what="guest usage" error={usage.error} onRetry={() => void usage.refetch()} />
      ) : s && !hasData ? (
        // No guest traffic: the card keeps the chart card's height (the same legend, chart and stats rows, hidden), with
        // the dim watermark Devices shows while Live throughput is off centred over it.
        <Card padded className="relative flex flex-1 flex-col gap-3" data-empty>
          <div aria-hidden className="invisible flex flex-1 flex-col gap-3">
            <Legend down={null} up={null} />
            <div className="min-h-40 flex-1" />
            <div className="h-px" />
            <div className="flex gap-[50px]">
              <Stat label="Busiest hour" bytes={null} />
            </div>
          </div>
          <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center gap-3.5">
            <ChartArea className="size-12 text-foreground/7" strokeWidth={1.6} />
            <span className="whitespace-nowrap font-semibold text-foreground/13 text-xl">No guest network activity</span>
          </div>
          <span className="sr-only">No guest network activity in this window.</span>
        </Card>
      ) : (
        // The Internet page's Per hour card: legend with bold totals, the chart filling the card, stats under a rule.
        <Card padded className="flex flex-1 flex-col gap-3">
          <div className={cn("transition-opacity", usage.fading && "opacity-40")}>
            <Legend down={hasData ? (s?.total.down ?? null) : null} up={hasData ? (s?.total.up ?? null) : null} />
          </div>
          <AreaChart
            series={[
              { id: "down", label: "Download", color: seriesColors.download, values: points.map((p) => p.down) },
              { id: "up", label: "Upload", color: seriesColors.upload, values: points.map((p) => p.up) },
            ]}
            labels={labels}
            tooltipLabels={tooltipLabels}
            format={formatBytes}
            total
            loading={usage.loading && (!s || usage.fading)}
            // Fill the space above the stats; the card stretches to Isolation & security's height.
            className="min-h-0 flex-1"
            heightClassName="h-full min-h-40"
            ariaLabel={day ? "Guest network data usage per hour, last 24 hours, download and upload" : "Guest network data usage per day, last 7 days, download and upload"}
          />
          <div className="h-px bg-border" />
          <div className={cn("flex gap-[50px] transition-opacity", usage.fading && "opacity-40")}>
            <Stat label={day ? "Busiest hour" : "Busiest day"} bytes={busiest ? busiest.down + busiest.up : null} prefix={busiest ? (day ? hour(busiest.at) : weekday(busiest.at)) : undefined} />
            <Stat label="Max down" bytes={maxDown} />
            <Stat label="Max up" bytes={maxUp} />
          </div>
        </Card>
      )}
    </Section>
  );
}
