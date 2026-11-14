/**
 * "Preferred update time": average data per hour of day over the last 7
 * days, with eero's 3-hour update window drawn over the chart, the selected
 * window's average, the busiest hour, and whether the choice is the
 * quietest window. Figures come from `usage.quiet_hours` (built in core).
 * The header select sets the hour with `updates.hour.set` (Undo puts the
 * old one back), and "Use quietest" picks the quietest window core found.
 * docs/ux/pages/updates-admins.md (Layout 3).
 */
import { CircleCheck } from "lucide-react";

import { useQuery } from "~/app/useCommand";
import { useWrite } from "~/app/useWrite";
import { BarChart } from "~/components/charts/BarChart";
import { Button } from "~/components/ui/button";
import { Card, Section } from "~/components/ui/card";
import { SectionError, useGate } from "~/components/ui/page";
import { seriesColors } from "~/lib/chartColors";
import { cn } from "~/lib/utils";
import { formatBytes } from "../../../../core/format";
import type { QuietHours as QuietHoursData } from "../../../../core/model";

/** "2 AM", "12 PM": hour of day labels in network time. */
export const hourLabel = (h: number): string => `${h % 12 === 0 ? 12 : h % 12} ${h % 24 < 12 ? "AM" : "PM"}`;
const clockLabel = (h: number): string => hourLabel(h).replace(" ", ":00 ");

/** Plot left edge: the Y label gutter (w-14) plus the gap-2 beside it. */
const GUTTER = "4rem";

const selectClass =
  "h-7 rounded-[var(--control-radius)] border border-input bg-card px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60";

/** "2:00 AM to 5:00 AM", the window eero installs in. */
export const windowLabel = (start: number, len = 3): string => `${clockLabel(start)} to ${clockLabel((start + len) % 24)}`;

export function QuietHours({ preferredHour, canChange }: { preferredHour: number | null | undefined; canChange: boolean }) {
  const gate = useGate("updates.hour.set");
  const setHour = useWrite<{ hour: number }>("updates.hour.set");
  const start = preferredHour ?? undefined;
  const q = useQuery<QuietHoursData>("usage.quiet_hours", { range: "week", ...(start !== undefined ? { start } : {}) }, { enabled: preferredHour !== undefined });
  const d = q.data;
  const len = d?.windowHours ?? 3;
  const labels = Array.from({ length: 24 }, (_, h) => hourLabel(h));
  const tooltips = Array.from({ length: 24 }, (_, h) => `${hourLabel(h)} to ${hourLabel(h + 1)}`);
  const values = d ? d.hours.map((h) => h.avg ?? 0) : [];
  const isQuietest = d?.quietest && start !== undefined && d.quietest.start === start;
  // The window as one or two bands (it can wrap past midnight).
  const bands = start === undefined ? [] : start + len <= 24 ? [[start, len]] : [[start, 24 - start], [0, start + len - 24]];
  const editable = canChange && gate.allowed && preferredHour !== undefined;

  const choose = (hour: number) => {
    if (hour === start) return;
    const old = start;
    void setHour.run(
      { hour },
      {
        success: `Updates install from ${windowLabel(hour, len)}`,
        undo: old === undefined ? undefined : { id: "updates.hour.set", params: { hour: old }, success: `Updates install from ${windowLabel(old, len)}` },
        failure: "Couldn't change the update time",
      },
    );
  };

  return (
    <Section
      title="Preferred update time"
      subtitle="Average data per hour, last 7 days"
      tools={
        <span className="inline-flex items-center gap-2" title={canChange && !gate.allowed ? (gate.reason ?? undefined) : undefined}>
          {editable && d?.quietest && d.quietest.start !== start && (
            <Button size="xs" variant="ghost" disabled={setHour.running} onClick={() => d.quietest && choose(d.quietest.start)}>
              Use quietest
            </Button>
          )}
          <select
            aria-label="Preferred update time"
            className={selectClass}
            value={start ?? ""}
            disabled={!editable || setHour.running}
            onChange={(e) => choose(Number(e.target.value))}
          >
            {start === undefined && <option value="">Not set</option>}
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {windowLabel(h, len)}
              </option>
            ))}
          </select>
        </span>
      }
    >
      {q.error && !d ? (
        <SectionError what="usage by hour" error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <Card padded>
          <div className="relative">
            <BarChart
              series={[{ id: "traffic", label: "Average", color: seriesColors.download, values }]}
              labels={labels}
              tooltipLabels={tooltips}
              format={formatBytes}
              ariaLabel="Average data per hour of the day over the last 7 days, with the preferred update window"
              total={false}
              loading={q.fading}
              heightClassName="h-40"
            />
            {bands.map(([from, width]) => (
              <div
                key={from}
                aria-hidden
                className="pointer-events-none absolute top-0 rounded-md border border-foreground/25 border-dashed bg-foreground/5"
                style={{
                  left: `calc(${GUTTER} + (100% - ${GUTTER}) * ${(from ?? 0) / 24})`,
                  width: `calc((100% - ${GUTTER}) * ${(width ?? 0) / 24})`,
                  height: "10rem",
                }}
              >
                {from === start && <span className="absolute top-1 left-1.5 whitespace-nowrap text-3xs text-muted-foreground uppercase tracking-wide">Update window</span>}
              </div>
            ))}
          </div>
          <div className={cn("mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-muted-foreground text-xs transition-opacity", q.fading && "opacity-40")}>
            <span>
              Selected hours avg <b className="font-medium text-foreground tabular-nums">{d?.selected?.avg != null ? formatBytes(d.selected.avg) : "-"}</b>
            </span>
            <span>
              Busiest{d?.busiest ? ` ${hourLabel(d.busiest.hour)}` : ""} avg <b className="font-medium text-foreground tabular-nums">{d?.busiest ? formatBytes(d.busiest.avg) : "-"}</b>
            </span>
            {d?.quietest && (
              <span className="ms-auto inline-flex items-center gap-1.5">
                {isQuietest ? (
                  <>
                    <CircleCheck className="size-3.5 text-success-foreground" />
                    <span className="text-foreground/80">Quietest window on your network</span>
                  </>
                ) : (
                  <>
                    Quietest window <b className="font-medium text-foreground">{windowLabel(d.quietest.start, len)}</b>
                  </>
                )}
              </span>
            )}
          </div>
        </Card>
      )}
    </Section>
  );
}
