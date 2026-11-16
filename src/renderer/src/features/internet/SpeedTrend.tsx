/**
 * The speed test trend in the Internet hero (#240): 7-day averages against
 * the plan, a Month / All toggle, one dotted point per test on a
 * plan-scaled chart, the plan line that opens the plan sheet and the
 * gateway-to-ISP note. Overview keeps the gauges for the latest result;
 * this shows how tests have gone, so the two pages do not repeat.
 * docs/ux/pages/internet.md (Layout 1). Tests and averages come from
 * `speedtest.history`.
 */
import { useState } from "react";

import { useQuery } from "~/app/useCommand";
import { AreaChart } from "~/components/charts/AreaChart";
import { SectionError } from "~/components/ui/page";
import { Segmented } from "~/components/ui/segmented";
import { TextLink } from "~/components/ui/text-link";
import { seriesColors } from "~/lib/chartColors";
import { cn } from "~/lib/utils";
import { formatCount, formatMbps, formatPlanShare, networkClock } from "../../../../core/format";
import type { SpeedHistory as History, Internet, Network } from "../../../../core/model";
import { openPlanSheet } from "./PlanSheet";

const RANGES = [
  { value: "month", label: "Month" },
  { value: "all", label: "All" },
] as const;

type HistoryRange = (typeof RANGES)[number]["value"];

/** Count line and screen reader wording per range. eero keeps about a year of tests, at most 100 per read. */
const RANGE_TEXT: Record<HistoryRange, string> = { month: "Last 30 days", all: "All eero returns" };

/**
 * `speedtest.history` params for a range. No Week: eero tests every 1 to 3
 * days, so a week holds only 2 to 5 points (the 7-day averages still read it).
 */
function historyParams(range: HistoryRange): { range: HistoryRange; limit: number } {
  return { range, limit: 200 };
}

export function SpeedTrend({ testing }: { testing: boolean }) {
  const [range, setRange] = useState<HistoryRange>("all");
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
  const span = range === "all" && oldest ? `since ${clock.day(oldest)}` : RANGE_TEXT[range].toLowerCase();
  // The figures fade while a test runs and fill in with its result.
  const fade = history.fading || testing ? "opacity-40" : undefined;

  if (history.error && !history.data) {
    return <SectionError what="speed tests" error={history.error} onRetry={() => void history.refetch()} />;
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className={cn("flex flex-wrap gap-x-[22px] gap-y-2 transition-opacity", fade)}>
          <Average label="Download, 7-day avg" color={seriesColors.download} value={avg?.downMbps ?? null} plan={plan?.down ?? null} />
          <Average label="Upload, 7-day avg" color={seriesColors.upload} value={avg?.upMbps ?? null} plan={plan?.up ?? null} />
        </div>
        <Segmented aria-label="Speed test range" value={range} onValueChange={setRange} options={RANGES} />
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
        loading={(history.loading && (!history.data || history.fading)) || testing}
        heightClassName="h-28"
        emptyText="No speed tests in this window."
        dots={tests.length <= 40}
        ariaLabel={`Speed test results, ${RANGE_TEXT[range].toLowerCase()}, download and upload`}
      />
      {internet.data && (
        <div className="text-3xs text-muted-foreground">
          {count && `${count} ${span} · `}
          {plan ? `Plan ${plan.label ? `${plan.label}, ` : ""}${formatMbps(plan.down)} down, ${formatMbps(plan.up)} up` : "No plan set: the chart scales to your results"}
          {" · "}
          <TextLink onClick={openPlanSheet}>{plan ? "Edit plan" : "Set plan"}</TextLink>
        </div>
      )}
      <div className="text-3xs text-muted-foreground">
        Tests run from the gateway to your ISP, so they show what {isp} delivers, not Wi-Fi speed in a room.
      </div>
    </div>
  );
}

/** Colour dot and label over the average, with its share of the plan beside it. */
function Average({ label, color, value, plan }: { label: string; color: string; value: number | null; plan: number | null }) {
  const share = formatPlanShare(value, plan);
  return (
    <div className="whitespace-nowrap">
      <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
        <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        {label}
      </div>
      <div className="flex items-baseline gap-2 pl-3.5">
        <span className="font-medium text-base tabular-nums">{formatMbps(value)}</span>
        {share && <span className="text-muted-foreground text-xs">{share.text}</span>}
      </div>
    </div>
  );
}
