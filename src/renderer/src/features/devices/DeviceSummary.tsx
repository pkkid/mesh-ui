/**
 * The Devices page header (docs/ux/pages/devices.md, Layout 1): the flat hero
 * every page opens with. Title is the device count, the status line splits it
 * by status, the facts are New this week (a button that filters the table to
 * new devices), On guest, Wired and Busiest eero, and the By type share bar
 * sits under them. Live throughput (LiveThroughput.tsx) is the right-hand column. All of it comes from the `device.list` summary, which
 * always covers the whole network whatever the filters.
 */
import type { ReactNode } from "react";

import { ShareBar } from "~/components/charts/ShareBar";
import { Metric, PageHeader } from "~/components/ui/hero";
import { useNow } from "~/components/ui/page";
import { Status } from "~/components/ui/status";
import { entityColor, seriesColors } from "~/lib/chartColors";
import { cn } from "~/lib/utils";
import { formatCount, formatRelative } from "../../../../core/format";
import type { DeviceCategory, DeviceSummary as Summary } from "../../../../core/model";

import { CATEGORIES, CATEGORY_LABELS } from "./DeviceFilters";

/** Category series colours: entity hues in order, with Other as the neutral series. */
export const categoryColor = (c: DeviceCategory): string =>
  c === "other" ? seriesColors.neutral : entityColor(CATEGORIES.indexOf(c));

type DevicesHeroProps = {
  summary: Summary | undefined;
  eeroName: ReadonlyMap<string, string>;
  guestCount: number | undefined;
  /** The New this week filter is on. */
  newOn: boolean;
  onToggleNew: () => void;
  /** Right-hand column: Live throughput (left out in bridge mode). */
  aside?: ReactNode;
  fading: boolean;
};

const count = (n: number | undefined) => (n === undefined ? "-" : formatCount(n));

export function DevicesHero({ summary: s, eeroName, guestCount, newOn, onToggleNew, aside, fading }: DevicesHeroProps) {
  const now = useNow();
  const busiest = s?.byEero.find((e) => e.eeroId !== null);
  const busiestName = busiest?.eeroId ? eeroName.get(busiest.eeroId) : undefined;

  return (
    <PageHeader
      flat
      data-slot="devices-hero"
      aside={aside}
      // 56px between the facts and Live throughput, twice the usual hero gap, so the By type bar and the chart do not crowd.
      className={cn("transition-opacity [&>div:first-child]:gap-14", fading && "opacity-40")}
      title={s ? `${formatCount(s.total)} ${s.total === 1 ? "device" : "devices"}` : "Devices"}
      status={
        <>
          <Status tone={s && s.online > 0 ? "success" : "muted"}>{count(s?.online)} online</Status>
          <span className="tabular-nums">
            {count(s?.offline)} offline · {count(s?.paused)} paused · {count(s?.blocked)} blocked
          </span>
        </>
      }
      facts={
        <>
          <button
            type="button"
            aria-pressed={newOn}
            title={newOn ? "Show every device" : "Show only devices new this week"}
            onClick={onToggleNew}
            className="-mx-1.5 -my-1 cursor-pointer rounded-md px-1.5 py-1 text-start outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-accent"
          >
            <Metric
              label="New this week"
              value={
                s ? (
                  <>
                    {formatCount(s.newThisWeek.length)}
                    {s.newestAt && (
                      <span className="font-normal text-muted-foreground text-xs"> · latest {formatRelative(s.newestAt, now)}</span>
                    )}
                  </>
                ) : null
              }
            />
          </button>
          <Metric label="On guest" value={guestCount === undefined ? null : formatCount(guestCount)} />
          <Metric label="Wired" value={s ? formatCount(s.byBand.wired) : null} />
          <Metric
            label="Busiest eero"
            value={
              busiest && busiestName ? (
                <>
                  {busiestName}
                  <span className="font-normal text-muted-foreground text-xs"> · {formatCount(busiest.count)}</span>
                </>
              ) : null
            }
          />
          <ShareBar
            className="mt-2 basis-full"
            segments={CATEGORIES.map((c) => ({ label: CATEGORY_LABELS[c], value: s?.byCategory[c] ?? 0, color: categoryColor(c) }))}
            format={(v) => formatCount(v)}
          />
        </>
      }
    />
  );
}
