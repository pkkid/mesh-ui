/**
 * Overview "When the network is busy": this week's hourly usage summed into
 * a 7 x 12 grid (Mon to Sun by two-hour block, network time zone), each
 * cell's intensity its share of the week's peak block.
 * docs/ux/pages/overview.md (Layout 4).
 */
import { useQuery } from "~/app/useCommand";
import { Heatmap, hourLabel as columnHour } from "~/components/charts/Heatmap";
import { Card, Empty, Section } from "~/components/ui/card";
import { SectionError } from "~/components/ui/page";
import { seriesColors } from "~/lib/chartColors";
import { formatPercent, networkClock } from "../../../../core/format";
import type { Network, UsageSeries } from "../../../../core/model";

/** Row labels, Monday first like `Clock.parts`. */
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const LONG_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** "8 to 10 PM" for the block starting at hour 20; "10 PM to 12 AM" when it crosses noon or midnight. */
function blockLabel(start: number): string {
  const end = (start + 2) % 24;
  const num = (h: number) => (h % 12 === 0 ? 12 : h % 12);
  const half = (h: number) => (h < 12 ? "AM" : "PM");
  return half(start) === half(end) ? `${num(start)} to ${num(end)} ${half(end)}` : `${num(start)} ${half(start)} to ${num(end)} ${half(end)}`;
}

/** Places each hourly point in its local weekday row and hour column. */
function grid(series: UsageSeries | undefined, tz: string): number[][] {
  const cells = DAYS.map(() => Array.from({ length: 24 }, () => 0));
  if (!series) return cells;
  const clock = networkClock(tz);
  for (const p of series.points) {
    const { weekday: day, hour } = clock.parts(p.at);
    const row = cells[day];
    if (row && hour >= 0 && hour < 24) row[hour] = (row[hour] ?? 0) + p.down + p.up;
  }
  return cells;
}

export function BusyHeatmap() {
  const network = useQuery<Network>("network.get", undefined, { poll: true });
  const usage = useQuery<UsageSeries>("usage.get", { scope: "network", range: "week", cadence: "hourly" }, { poll: true });

  const values = grid(usage.data, network.data?.timezone ?? "UTC");
  // Two-hour blocks (12 columns), each the sum of its two hours: square cells that read as a grid in a third-width column.
  const blocks = values.map((row) => Array.from({ length: 12 }, (_, c) => (row[c * 2] ?? 0) + (row[c * 2 + 1] ?? 0)));
  const peak = Math.max(0, ...blocks.flat());
  // "Busiest Thursday, 4 to 6 PM": the peak block (the week is obvious from the grid), the one every other cell is a share of.
  const peakDay = blocks.findIndex((row) => row.includes(peak));
  const peakBlock = peakDay >= 0 ? (blocks[peakDay] ?? []).indexOf(peak) : -1;
  const description =
    usage.data && peak > 0 && peakDay >= 0 ? `Busiest ${LONG_DAYS[peakDay]}, ${blockLabel(peakBlock * 2)}` : "-";

  return (
    <Section title="When the network is busy" description={description} className="gap-[15px]">
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
            columns={12}
            values={blocks}
            columnLabel={(c) => columnHour(c * 2)}
            color={seriesColors.download}
            format={(v) => (peak > 0 ? formatPercent((v / peak) * 100) : "-")}
            valueLabel="Of the busiest block"
            cellLabel={(r, c) => `${DAYS[r] ?? ""} ${String(c * 2).padStart(2, "0")}:00 to ${String(c * 2 + 2).padStart(2, "0")}:00`}
            loading={!usage.data || usage.fading}
            ariaLabel="Data used by day of week in two-hour blocks, this week, as a share of the busiest block"
          />
        </Card>
      )}
    </Section>
  );
}
