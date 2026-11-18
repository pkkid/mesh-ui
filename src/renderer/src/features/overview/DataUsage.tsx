/**
 * Overview "Data usage": hero figure, Download and Upload totals, the By eero
 * share bar and the per-hour (Day) or per-day (Week) chart.
 * docs/ux/pages/overview.md (Layout 2). Totals, busiest bucket and "so far
 * today" come from `usage.get`; this file only words and draws them.
 */
import { ArrowDown, ArrowUp } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { useQuery } from "~/app/useCommand";
import { AreaChart } from "~/components/charts/AreaChart";
import { ShareBar } from "~/components/charts/ShareBar";
import { Section } from "~/components/ui/card";
import { SectionError } from "~/components/ui/page";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "~/components/ui/select";
import { entityColors, seriesColors } from "~/lib/chartColors";
import { cn } from "~/lib/utils";
import { bytesParts, formatBytes, formatCount, formatPercent, networkClock } from "../../../../core/format";
import type { DeviceList, Eero, Network, UsageRange, UsageSeries } from "../../../../core/model";

const RANGES = [
  { value: "day", label: "Last 24 hours" },
  { value: "week", label: "Last 7 days" },
] as const;

/** Half of the range crossfade: fade out, swap, fade in over the same time. */
const SWITCH_MS = 150;

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

export function DataUsage() {
  // `range` is what the figures show; `picked` is the toggle. While they
  // differ the body fades out, then `range` follows and the body fades back
  // in. Background polls never touch either, so they never crossfade.
  const [range, setRange] = useState<UsageRange>("day");
  const [picked, setPicked] = useState<UsageRange>("day");
  const switching = picked !== range;
  useEffect(() => {
    if (!switching) return;
    const t = setTimeout(() => setRange(picked), SWITCH_MS);
    return () => clearTimeout(t);
  }, [switching, picked]);
  const pick = (next: UsageRange) => {
    setPicked(next);
    if (reducedMotion()) setRange(next);
  };
  // Start loading the picked range during the fade-out (no poll: the shown
  // range's queries below poll, and share these entries once it switches).
  useQuery<UsageSeries>("usage.get", { scope: "network", range: picked });
  useQuery<UsageSeries[]>("usage.get", { scope: "eero", range: picked });
  const network = useQuery<Network>("network.get", undefined, { poll: true });
  const usage = useQuery<UsageSeries>("usage.get", { scope: "network", range }, { poll: true });
  const byEero = useQuery<UsageSeries[]>("usage.get", { scope: "eero", range }, { poll: true });
  const eeros = useQuery<Eero[]>("eero.list", undefined, { poll: true });
  const devices = useQuery<DeviceList>("device.list", undefined, { poll: true });
  const deviceCount = devices.data?.devices.length;

  const tz = network.data?.timezone ?? "UTC";
  const s = usage.data;
  const points = s?.points ?? [];
  const total = s ? s.total.down + s.total.up : 0;
  // No bytes at all reads as missing ("-"), like the chart's empty sentence.
  const hasData = total > 0;
  const day = range === "day";

  const { hour, weekday, longWeekday: longDay, longDate } = networkClock(tz);
  const labels = points.map((p) => (day ? hour(p.at) : weekday(p.at)));
  const tooltipLabels = points.map((p) =>
    day
      ? `${weekday(p.at)} ${hour(p.at)} to ${hour(Date.parse(p.at) + 3_600_000)}`
      : longDate(p.at),
  );

  const busiest = s?.busiest
    ? day
      ? `busiest hour ${hour(s.busiest.at)} to ${hour(Date.parse(s.busiest.at) + 3_600_000)}`
      : `busiest day ${longDay(s.busiest.at)}`
    : null;

  const names = new Map((eeros.data ?? []).map((e) => [e.id, e.location]));
  const colors = entityColors((eeros.data ?? []).map((e) => e.id));
  // Wait for eero.list so every segment has its name (ShareBar keys by label).
  const segments = (eeros.data ? (byEero.data ?? []) : []).map((e, i) => ({
    label: names.get(e.id ?? "") ?? `eero ${i + 1}`,
    value: e.total.down + e.total.up,
    color: colors[e.id ?? ""] ?? seriesColors.neutral,
  }));

  const crossfade = cn("transition-opacity duration-150 motion-reduce:transition-none", switching && "opacity-0");
  const fade = usage.fading ? "opacity-40 transition-opacity" : "transition-opacity";
  const hero = bytesParts(hasData ? total : null);

  return (
    <Section
      title="Data usage"
      description={
        // "Last 24 hours, 53 devices": the range leads, then what it covers.
        `${day ? "Last 24 hours" : "Last 7 days"}, ${
          deviceCount === undefined ? "all devices" : `${formatCount(deviceCount)} ${deviceCount === 1 ? "device" : "devices"}`
        }`
      }
      tools={
        <Select items={RANGES} value={picked} onValueChange={(v) => v && pick(v)}>
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
        <div className={cn("grid gap-7 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]", crossfade)}>
          <div className="flex flex-col gap-4">
            <div className={fade}>
              <div className="font-semibold text-4xl tabular-nums tracking-tight">
                {hero.value}
                {hero.unit && <small className="ms-1 font-medium text-base text-muted-foreground">{hero.unit}</small>}
              </div>
              <div className="mt-1 text-muted-foreground text-xs">
                {busiest ? busiest.charAt(0).toUpperCase() + busiest.slice(1) : "-"}
              </div>
              <div className="text-muted-foreground text-xs">{formatBytes(hasData ? s?.todaySoFar : null)} so far today</div>
            </div>
            <div className={cn("flex flex-col gap-2", fade)}>
              <SeriesRow
                icon={<ArrowDown className="size-[15px]" style={{ color: seriesColors.download }} />}
                label="Download"
                value={hasData ? s?.total.down : null}
                share={hasData && total > 0 ? ((s?.total.down ?? 0) / total) * 100 : null}
              />
              <SeriesRow
                icon={<ArrowUp className="size-[15px]" style={{ color: seriesColors.upload }} />}
                label="Upload"
                value={hasData ? s?.total.up : null}
                share={hasData && total > 0 ? ((s?.total.up ?? 0) / total) * 100 : null}
              />
            </div>
            <div className="h-px bg-border" />
            <div className="flex flex-col gap-2">
              <div className="font-medium text-xs">By eero</div>
              {byEero.error && !byEero.data ? (
                <span className="text-muted-foreground text-xs">
                  Couldn't load usage by eero.{" "}
                  <button type="button" className="cursor-pointer underline" onClick={() => void byEero.refetch()}>
                    Retry
                  </button>
                </span>
              ) : (
                <ShareBar segments={segments} format={formatBytes} className={byEero.fading ? "opacity-40" : undefined} />
              )}
            </div>
          </div>
          <AreaChart
            series={[
              { id: "down", label: "Download", color: seriesColors.download, values: points.map((p) => p.down) },
              { id: "up", label: "Upload", color: seriesColors.upload, values: points.map((p) => p.up) },
            ]}
            labels={labels}
            tooltipLabels={tooltipLabels}
            format={formatBytes}
            loading={usage.loading && (!s || usage.fading)}
            ariaLabel={day ? "Data used per hour, last 24 hours, download and upload" : "Data used per day, last 7 days, download and upload"}
          />
        </div>
      )}
    </Section>
  );
}

function SeriesRow({
  icon,
  label,
  value,
  share,
}: {
  icon: ReactNode;
  label: string;
  value: number | null | undefined;
  share: number | null;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-[13px]">
      <span className="flex items-center gap-2">
        {icon}
        {label}
      </span>
      <span className="tabular-nums">
        <span className="font-medium">{formatBytes(value)}</span>
        {share !== null && <span className="ms-1 text-muted-foreground text-xs">({formatPercent(share)})</span>}
      </span>
    </div>
  );
}
