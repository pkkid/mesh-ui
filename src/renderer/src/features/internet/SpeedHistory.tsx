/**
 * Internet "Speed test history": Week / Month / All toggle (the page holds
 * it, Earlier tests and Export CSV follow it), 7-day averages against the
 * plan, the gateway-to-ISP note and one dotted point per test.
 * docs/ux/pages/internet.md (Layout 3). Tests, ratings and averages come
 * from `speedtest.history`.
 */
import { ArrowDown, ArrowUp, Info } from "lucide-react";
import type { ReactNode } from "react";

import { useQuery } from "~/app/useCommand";
import { AreaChart } from "~/components/charts/AreaChart";
import { Section } from "~/components/ui/card";
import { Meter } from "~/components/ui/meter";
import { SectionError } from "~/components/ui/page";
import { Segmented } from "~/components/ui/segmented";
import { seriesColors } from "~/lib/chartColors";
import { cn } from "~/lib/utils";
import { formatCount, formatMbps, formatPercent, networkClock } from "../../../../core/format";
import type { Internet, Network, SpeedHistory as History } from "../../../../core/model";

const RANGES = [
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "all", label: "All" },
] as const;

export type HistoryRange = (typeof RANGES)[number]["value"];

/** Subtitle and screen reader wording per range. eero keeps about a year of tests, at most 100 per read. */
const RANGE_TEXT: Record<HistoryRange, string> = { week: "Last 7 days", month: "Last 30 days", all: "All eero returns" };

/**
 * `speedtest.history` params for a range, shared by the chart and Earlier
 * tests so they read one cache entry. Week uses the defaults, the hero's entry.
 */
export function historyParams(range: HistoryRange): { range: HistoryRange; limit: number } | undefined {
  return range === "week" ? undefined : { range, limit: 200 };
}

export function SpeedHistory({ id, range, onRangeChange }: { id?: string; range: HistoryRange; onRangeChange: (range: HistoryRange) => void }) {
  const history = useQuery<History>("speedtest.history", historyParams(range), { poll: true });
  const internet = useQuery<Internet>("internet.get", undefined, { poll: true });
  const network = useQuery<Network>("network.get", undefined, { poll: true });

  const clock = networkClock(network.data?.timezone);
  // Oldest first; a test missing either direction is left off the chart rather than drawn as 0.
  const tests = (history.data?.tests ?? []).filter((t) => t.downMbps !== null && t.upMbps !== null).reverse();
  const plan = internet.data?.planMbps ?? null;
  const avg = history.data?.avg7d;
  const isp = internet.data?.isp.name ?? "your ISP";
  const count = history.data ? `${formatCount(history.data.tests.length)} ${history.data.tests.length === 1 ? "test" : "tests"}` : null;
  const oldest = history.data?.tests.at(-1)?.at;
  const span = range === "all" && oldest ? `Since ${clock.day(oldest)}` : RANGE_TEXT[range];
  const subtitle = [span, count, "automatic test every 1 to 3 days"].filter(Boolean).join(" · ");
  const fade = history.fading ? "opacity-40" : undefined;

  return (
    <Section id={id} title="Speed test history" subtitle={subtitle} tools={<Segmented aria-label="Range" value={range} onValueChange={onRangeChange} options={RANGES} />}>
      {history.error && !history.data ? (
        <SectionError what="speed tests" error={history.error} onRetry={() => void history.refetch()} />
      ) : (
        <div className="grid gap-7 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
          <div className="flex flex-col gap-4">
            <div className={cn("flex flex-col gap-3 transition-opacity", fade)}>
              <Average
                icon={<ArrowDown className="size-[15px]" style={{ color: seriesColors.download }} />}
                label="Download, 7-day average"
                color={seriesColors.download}
                value={avg?.downMbps ?? null}
                plan={plan?.down ?? null}
              />
              <Average
                icon={<ArrowUp className="size-[15px]" style={{ color: seriesColors.upload }} />}
                label="Upload, 7-day average"
                color={seriesColors.upload}
                value={avg?.upMbps ?? null}
                plan={plan?.up ?? null}
              />
            </div>
            <div className="h-px bg-border" />
            <div className="flex gap-2 text-muted-foreground text-xs">
              <Info className="mt-px size-3.5 shrink-0" />
              <span>
                Tests run from the gateway to your ISP, so they show what {isp} delivers, not Wi-Fi speed in a room.
              </span>
            </div>
          </div>
          <AreaChart
            series={[
              { id: "down", label: "Download", color: seriesColors.download, values: tests.map((t) => t.downMbps as number) },
              { id: "up", label: "Upload", color: seriesColors.upload, values: tests.map((t) => t.upMbps as number) },
            ]}
            labels={tests.map((t) => clock.day(t.at))}
            tooltipLabels={tests.map((t) => clock.dateTime(t.at))}
            format={(v) => formatMbps(v)}
            max={plan ? Math.max(plan.down, plan.up) : null}
            total={false}
            loading={history.loading && (!history.data || history.fading)}
            emptyText="No speed tests in this window."
            dots={tests.length <= 40}
            ariaLabel={`Speed test results, ${RANGE_TEXT[range].toLowerCase()}, download and upload`}
          />
        </div>
      )}
    </Section>
  );
}

function Average({ icon, label, color, value, plan }: { icon: ReactNode; label: string; color: string; value: number | null; plan: number | null }) {
  const share = value !== null && plan ? (value / plan) * 100 : null;
  return (
    <div>
      <div className="flex items-center justify-between gap-3 text-[13px]">
        <span className="flex items-center gap-2">
          {icon}
          {label}
        </span>
        <span className="font-medium tabular-nums">{formatMbps(value)}</span>
      </div>
      <Meter className="mt-2" value={plan ? value : null} max={plan ?? 100} color={color} label={`${label}, share of plan`} />
      <div className="mt-1 text-muted-foreground text-xs">{share === null ? (plan ? "-" : "No plan set") : `${formatPercent(share)} of plan`}</div>
    </div>
  );
}
