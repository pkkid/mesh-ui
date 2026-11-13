/**
 * Overview "When the network is busy": this week's hourly usage laid out as
 * a 7 x 24 grid (Mon to Sun by hour, network time zone), each cell's
 * intensity its share of the week's peak hour.
 * docs/ux/pages/overview.md (Layout 4).
 */
import { useQuery } from "~/app/useCommand";
import { Heatmap } from "~/components/charts/Heatmap";
import { Card, Empty } from "~/components/ui/card";
import { seriesColors } from "~/lib/chartColors";
import { formatPercent } from "../../../../core/format";
import type { Network, UsageSeries } from "../../../../core/model";

import { OverviewSection, SectionError } from "./OverviewView";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Places each hourly point in its local weekday row and hour column. */
function grid(series: UsageSeries | undefined, tz: string): number[][] {
  const cells = DAYS.map(() => Array.from({ length: 24 }, () => 0));
  if (!series) return cells;
  const f = new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "2-digit", hourCycle: "h23", timeZone: tz });
  for (const p of series.points) {
    const parts = f.formatToParts(Date.parse(p.at));
    const day = DAYS.indexOf(parts.find((x) => x.type === "weekday")?.value ?? "");
    const hour = Number(parts.find((x) => x.type === "hour")?.value);
    const row = cells[day];
    if (row && hour >= 0 && hour < 24) row[hour] = (row[hour] ?? 0) + p.down + p.up;
  }
  return cells;
}

export function BusyHeatmap() {
  const network = useQuery<Network>("network.get", undefined, { poll: true });
  const usage = useQuery<UsageSeries>("usage.get", { scope: "network", range: "week", cadence: "hourly" }, { poll: true });

  const values = grid(usage.data, network.data?.timezone ?? "UTC");
  const peak = Math.max(0, ...values.flat());

  return (
    <OverviewSection title="When the network is busy" subtitle="This week">
      {usage.error && !usage.data ? (
        <SectionError what="busy hours" error={usage.error} onRetry={() => void usage.refetch()} />
      ) : usage.data && peak === 0 ? (
        <Card>
          <Empty>No activity in this window.</Empty>
        </Card>
      ) : (
        <Card padded>
          <Heatmap
            rows={DAYS}
            columns={24}
            values={values}
            color={seriesColors.download}
            format={(v) => (peak > 0 ? formatPercent((v / peak) * 100) : "-")}
            valueLabel="Of the busiest hour"
            cellLabel={(r, c) => `${DAYS[r] ?? ""} ${String(c).padStart(2, "0")}:00`}
            loading={!usage.data || usage.fading}
            ariaLabel="Data used by day of week and hour, this week, as a share of the busiest hour"
          />
        </Card>
      )}
    </OverviewSection>
  );
}
