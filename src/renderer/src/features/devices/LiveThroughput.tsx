/**
 * Devices "Live throughput", the right-hand column of the hero
 * (docs/ux/pages/devices.md, Layout 1): while Live is on, the network's
 * current download and upload (the `device.list` summary `rates`), a small
 * chart of every reading since Live was turned on, and the active count with
 * the band insight; a quiet bar after the title fills while the next reading
 * is awaited. With Live off it shows only a dim watermark, a pulse icon and
 * "Live throughput off"; the two cross-fade, and the chart opens and closes,
 * with the Live switch in the topbar.
 *
 * The chart is a view of readings already on screen: each new burst or
 * change in the summary's figures is kept here, timed when it arrived, per
 * network for the session (Live turns
 * itself off after LIVE_AUTO_OFF_MIN, so the buffer stays small) and cleared
 * when Live goes off.
 */
import { Activity } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { LIVE_AUTO_OFF_MIN, useLiveMode } from "~/app/useLiveMode";
import { AreaChart } from "~/components/charts/AreaChart";
import { StatusDot } from "~/components/ui/status";
import { seriesColors } from "~/lib/chartColors";
import { cn } from "~/lib/utils";
import { formatMbps, formatPercent, mbpsParts, networkClock } from "../../../../core/format";
import type { DeviceRateTotals } from "../../../../core/model";

/** What the panel needs from a rate reading: the network summary's totals or one device's rates. */
export type LiveRates = { downMbps: number; upMbps: number; at: string };

/** One point: when it arrived, the burst it came from, and the totals. */
type Reading = { at: string; burstAt: string; down: number; up: number };

/** Readings per panel (a network, or one device), kept while the app runs. */
const readings = new Map<string, Reading[]>();
/** At most one reading every few seconds for the Live window, with room to spare. */
const MAX_READINGS = LIVE_AUTO_OFF_MIN * 20;

function useReadings(netId: string, rates: LiveRates | null, live: boolean): Reading[] {
  const [list, setList] = useState<Reading[]>(() => readings.get(netId) ?? []);
  useEffect(() => {
    if (!live) {
      readings.delete(netId);
      setList([]);
      return;
    }
    const prev = readings.get(netId) ?? [];
    const last = prev.at(-1);
    // Each read in a burst's live window can move the figures, and they all share the burst's time,
    // so a new burst or new figures make a point; a repeat of the held figures does not.
    if (!rates || (last && last.burstAt === rates.at && last.down === rates.downMbps && last.up === rates.upMbps)) {
      setList(prev);
      return;
    }
    const next = [...prev, { at: new Date().toISOString(), burstAt: rates.at, down: rates.downMbps, up: rates.upMbps }].slice(-MAX_READINGS);
    readings.set(netId, next);
    setList(next);
  }, [netId, rates, live]);
  return list;
}

/** The last non-empty rates per panel, kept while Live is on. */
const lastRates = new Map<string, LiveRates>();

function useLastRates<R extends LiveRates>(netId: string, rates: R | null, live: boolean): R | null {
  if (!live) {
    lastRates.delete(netId);
    return null;
  }
  if (rates) lastRates.set(netId, rates);
  return (lastRates.get(netId) as R | undefined) ?? null;
}

type LiveThroughputProps = {
  netId: string;
  rates: DeviceRateTotals | null | undefined;
  timezone: string | null | undefined;
};

/** Devices: the whole network's live rates, with the active count and band insight under the chart. */
export function LiveThroughput({ netId, rates, timezone }: LiveThroughputProps) {
  return (
    <LivePanel
      id={netId}
      rates={rates}
      timezone={timezone}
      ariaLabel="Current download and upload for every device, since Live was turned on"
      footer={(r) => {
        if (!r) return "No live rates yet";
        const band = r.topBand ? r.byBand[r.topBand] : null;
        return (
          <>
            <span className="tabular-nums">{r.active}</span> {r.active === 1 ? "device" : "devices"} active
            {r.topBand && band && (
              <>
                {" "}
                · {r.topBand} GHz carries <span className="tabular-nums">{formatPercent(band.trafficPct)}</span> of traffic
              </>
            )}
          </>
        );
      }}
    />
  );
}

type LivePanelProps<R extends LiveRates> = {
  /** Keys the readings and the held figures: the network id, or the device id. */
  id: string;
  rates: R | null | undefined;
  timezone: string | null | undefined;
  /** What the chart shows, for screen readers. */
  ariaLabel: string;
  /** The muted line under the chart, from the rates on screen. */
  footer: (rates: R | null) => ReactNode;
  /**
   * With Live on, why there can be no live rates here ("Device offline"): the
   * watermark shows these words instead of the readings.
   */
  unavailable?: string | null;
  className?: string;
};

/**
 * The Live throughput column of a hero (Devices, device detail): with Live off
 * a dim watermark, a pulse icon and "Live throughput off"; with Live on the
 * title with the waiting bar, the download and upload figures, a chart of
 * every reading since Live was turned on and a footer line.
 */
export function LivePanel<R extends LiveRates>({ id: netId, rates: summaryRates, timezone, ariaLabel, footer, unavailable, className }: LivePanelProps<R>) {
  const [liveOn] = useLiveMode();
  // A device that is offline, paused or blocked has no live rates: show the watermark with the reason.
  const live = liveOn && !unavailable;
  // Live off (#319): no rates on screen, even ones core still holds from the last burst.
  const fresh = live ? (summaryRates ?? null) : null;
  const list = useReadings(netId, fresh, live);
  // While Live is on, a read with no rates (they went stale between bursts, or eero sent none)
  // keeps the last figures on screen instead of turning them back to "-".
  const rates = useLastRates(netId, fresh, live);
  const { time, timeSeconds } = networkClock(timezone ?? "UTC");
  // A line needs two readings; until then the chart shows its waiting sentence.
  const plotted = list.length >= 2 ? list : [];

  return (
    // Two layers in one grid cell that cross-fade with Live: the readings, and the dim "off" watermark.
    <div data-slot="live-throughput" className={cn("grid w-[28rem]", className)}>
      <div
        aria-hidden={live}
        className={cn(
          "pointer-events-none flex h-40 items-center justify-center gap-3.5 transition-opacity duration-300 [grid-area:1/1] motion-reduce:transition-none",
          live ? "opacity-0" : "opacity-100",
        )}
      >
        <Activity aria-hidden className="size-12 text-foreground/7" strokeWidth={1.6} />
        <span className="whitespace-nowrap font-semibold text-foreground/13 text-xl">{liveOn && unavailable ? unavailable : "Live throughput off"}</span>
      </div>
      <div
        aria-hidden={!live}
        className={cn(
          "flex flex-col gap-2 transition-opacity duration-300 [grid-area:1/1] motion-reduce:transition-none",
          live ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        <div className="flex min-h-7 items-center gap-2">
          <h2 className="whitespace-nowrap font-semibold text-base text-foreground leading-7">Live throughput</h2>
          {live && <StatusDot tone="success" />}
          {live && <WaitBar restart={list.at(-1)?.at ?? "start"} />}
        </div>
        <div className="flex items-baseline gap-6">
          <Figure value={rates?.downMbps} label="down" color={seriesColors.download} />
          <Figure value={rates?.upMbps} label="up" color={seriesColors.upload} />
        </div>
        {/* The chart opens and closes with Live: rows from 0fr to 1fr plus a fade, none with reduced motion. */}
        <div
          aria-hidden={!live}
          className={cn(
            "grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none",
            live ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
          )}
        >
          <div className="flex min-h-0 flex-col gap-2 overflow-hidden">
            {/* min height: the chart plus its x labels, so the waiting state takes the same room. */}
            <div className="relative min-h-[118px]">
              <AreaChart
                series={[
                  { id: "down", label: "Download", color: seriesColors.download, values: plotted.map((r) => r.down) },
                  { id: "up", label: "Upload", color: seriesColors.upload, values: plotted.map((r) => r.up) },
                ]}
                labels={plotted.map((r) => time(r.at))}
                tooltipLabels={plotted.map((r) => timeSeconds(r.at))}
                format={formatMbps}
                total={false}
                hideYLabels
                heightClassName="h-24"
                emptyText=""
                ariaLabel={ariaLabel}
              />
              {/* The chart's own empty sentence sits on a gridline at this height; this one masks it. */}
              {plotted.length === 0 && (
                <div className="pointer-events-none absolute inset-x-0 top-0 grid h-24 place-items-center">
                  <span className="bg-background px-2 text-muted-foreground text-xs">Waiting for live readings.</span>
                </div>
              )}
            </div>
            <div className="truncate text-muted-foreground text-xs">{footer(rates)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** "164 Mbps down": the compact hero figure (text-2xl) after its series square. */
function Figure({ value, label, color }: { value: number | null | undefined; label: string; color: string }) {
  const parts = mbpsParts(value);
  return (
    <div className="flex items-baseline gap-1.5 whitespace-nowrap">
      <span aria-hidden className="size-2 self-center rounded-xs" style={{ backgroundColor: color }} />
      <span className="font-semibold text-2xl tabular-nums tracking-tight">{parts.value}</span>
      <span className="text-muted-foreground text-xs">
        {parts.unit || "Mbps"} {label}
      </span>
    </div>
  );
}

/** The bar is half full after this many seconds, three quarters after twice that, and so on. */
const WAIT_HALF_SEC = 6;
/** How long the fill animation runs; it is 99.9% full by then and stays there. */
const WAIT_SPAN_SEC = 60;
/**
 * `1 - 2^(-t / WAIT_HALF_SEC)` as a CSS `linear()` easing, one stop a second:
 * a smooth curve that slows the whole way (6 s to 50%, 12 s to 75%, 18 s to
 * 87.5%), never a constant speed.
 */
const WAIT_EASING = `linear(${Array.from({ length: WAIT_SPAN_SEC + 1 }, (_, t) => {
  const p = 1 - 2 ** (-t / WAIT_HALF_SEC);
  return `${p.toFixed(4)} ${((t / WAIT_SPAN_SEC) * 100).toFixed(2)}%`;
}).join(", ")})`;

/**
 * A quiet bar after the title that fills while we wait for the next live
 * reading (one comes about every 12 s on average while a burst is live). It
 * is not a real countdown: it starts over from empty whenever a new reading
 * arrives (`restart` changes). Hidden from screen readers; static and empty
 * with reduced motion.
 */
function WaitBar({ restart }: { restart: string }) {
  return (
    <span aria-hidden className="ms-1 h-0.5 flex-1 overflow-hidden rounded-full bg-muted-foreground/10">
      <span
        key={restart}
        className="block h-full origin-left rounded-full bg-muted-foreground/35 motion-reduce:hidden"
        style={{ animation: `live-wait ${WAIT_SPAN_SEC}s ${WAIT_EASING} forwards` }}
      />
    </span>
  );
}
