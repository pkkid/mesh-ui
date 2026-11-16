/**
 * The hero at the top of Devices (docs/ux/pages/devices.md, Layout 1): three
 * cells at hero weight, each led by a key figure: devices (with status counts
 * and the By type donut), current throughput, and devices new this week. All of
 * it comes from the `device.list` summary, which always covers the whole
 * network whatever the filters.
 */
import { Activity, type LucideIcon, MonitorSmartphone, Sparkles } from "lucide-react";
import { type ReactNode, useState } from "react";

import { Donut, DonutLegendRow } from "~/components/charts/Donut";
import { IconTile } from "~/components/ui/hero";
import { entityColor, seriesColors } from "~/lib/chartColors";
import { deviceIcon } from "~/lib/deviceIcons";
import { cn } from "~/lib/utils";
import { formatCount, formatMbps, formatPercent, formatRelative, mbpsParts } from "../../../../core/format";
import type { Device, DeviceCategory, DeviceSummary as Summary } from "../../../../core/model";

import { CATEGORIES, CATEGORY_LABELS } from "./DeviceFilters";

/** Category series colours: entity hues in order, with Other as the neutral series. */
export const categoryColor = (c: DeviceCategory): string =>
  c === "other" ? seriesColors.neutral : entityColor(CATEGORIES.indexOf(c));

type DeviceSummaryProps = {
  summary: Summary | undefined;
  /** Every device on the network, to show the new ones by id. */
  devices: ReadonlyArray<Device> | undefined;
  eeroName: ReadonlyMap<string, string>;
  fading: boolean;
};

export function DeviceSummary({ summary: s, devices, eeroName, fading }: DeviceSummaryProps) {
  const byId = new Map((devices ?? []).map((d) => [d.id, d]));
  const fresh = (s?.newThisWeek ?? []).flatMap((id) => byId.get(id) ?? []);
  const down = mbpsParts(s?.rates?.downMbps);
  const now = Date.now();
  const categoryTotal = s ? CATEGORIES.reduce((n, c) => n + s.byCategory[c], 0) : 0;
  /** The category highlighted from the donut or the legend. */
  const [active, setActive] = useState<string | null>(null);

  // Container queries, so the sidebar width counts: one column when narrow; Devices
  // beside Throughput over New this week at the default window size; three columns when wide.
  return (
    <div data-slot="devices-hero" className="@container rounded-(--hero-radius) border bg-card">
      <div className="grid grid-cols-1 @3xl:grid-cols-[auto_minmax(0,1fr)] @6xl:grid-cols-[auto_minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <Cell className={cn("@3xl:row-span-2 @3xl:flex @3xl:flex-col @3xl:justify-center @6xl:row-span-1 @6xl:block", fading && "opacity-40")}>
          <Label icon={MonitorSmartphone}>Devices</Label>
          <div className="mt-2 flex items-center gap-5">
            <div className="shrink-0">
              <Figure>{s ? formatCount(s.total) : "-"}</Figure>
              <div className="mt-1 whitespace-nowrap text-muted-foreground text-xs tabular-nums">
                {s ? (
                  <>
                    <div>{formatCount(s.online)} online</div>
                    <div>
                      {formatCount(s.paused)} paused · {formatCount(s.blocked)} blocked
                    </div>
                  </>
                ) : (
                  "-"
                )}
              </div>
            </div>
            <Donut
              size={96}
              ariaLabel="Devices by type"
              format={(v) => `${formatCount(v)} ${v === 1 ? "device" : "devices"}`}
              active={active}
              onActiveChange={setActive}
              segments={CATEGORIES.map((c) => ({ label: CATEGORY_LABELS[c], value: s?.byCategory[c] ?? 0, color: categoryColor(c) }))}
            >
              <span className="font-semibold text-xl tabular-nums">{s ? formatCount(categoryTotal) : "-"}</span>
              <span className="text-2xs text-muted-foreground">{categoryTotal === 1 ? "device" : "devices"}</span>
            </Donut>
            <div className="flex w-44 min-w-0 flex-col gap-1 text-[11.5px]">
              {CATEGORIES.map((c) => (
                <DonutLegendRow key={c} label={CATEGORY_LABELS[c]} color={categoryColor(c)} active={active} onActiveChange={setActive}>
                  <span className="shrink-0 whitespace-nowrap tabular-nums">
                    {s ? (
                      <>
                        <span className="font-medium">{formatCount(s.byCategory[c])}</span>
                        <span className="text-muted-foreground"> · {categoryTotal > 0 ? formatPercent((s.byCategory[c] / categoryTotal) * 100) : "-"}</span>
                      </>
                    ) : (
                      "-"
                    )}
                  </span>
                </DonutLegendRow>
              ))}
            </div>
          </div>
        </Cell>

        <Cell className={cn("border-t transition-opacity @3xl:border-t-0 @3xl:border-l", fading && "opacity-40")}>
          <Label icon={Activity}>Current throughput</Label>
          <div className="mt-2 whitespace-nowrap">
            <Figure>{down.value}</Figure>
            {down.unit && <span className="text-muted-foreground text-sm"> {down.unit} down</span>}
          </div>
          <div className="mt-1 text-muted-foreground text-xs">
            {s?.rates ? (
              <>
                <span className="font-medium text-foreground/80 tabular-nums">{formatMbps(s.rates.upMbps)}</span> up ·{" "}
                {s.rates.active} {s.rates.active === 1 ? "device" : "devices"} active
              </>
            ) : (
              "No live rates yet"
            )}
          </div>
          <BandInsight rates={s?.rates ?? null} />
          <div className={cn("text-2xs text-muted-foreground/70", !s?.rates?.topBand && "mt-2")}>Sum of current device rates, refreshed every minute</div>
        </Cell>

        <Cell className={cn("border-t @3xl:border-l @6xl:border-t-0", fading && "opacity-40")}>
          <Label icon={Sparkles}>New this week</Label>
          <div className="mt-2 flex items-start gap-3.5">
            <Figure>{s ? formatCount(s.newThisWeek.length) : "-"}</Figure>
            <div className="mt-1 flex min-w-0 flex-1 flex-col gap-2">
              {s && fresh.length === 0 && <div className="text-muted-foreground text-xs">No new devices this week.</div>}
              {fresh.slice(0, 3).map((d) => (
                <div key={d.id} className="flex items-center gap-2 text-xs">
                  <IconTile icon={deviceIcon(d)} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{d.name}</div>
                    <div className={cn("truncate text-2xs", d.blocked ? "text-destructive-foreground" : "text-muted-foreground")}>
                      {formatRelative(d.firstSeen, now)} ·{" "}
                      {d.blocked ? "blocked" : (d.eeroId && eeroName.get(d.eeroId)) || (d.connected ? "Online" : "Offline")}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Cell>
      </div>
    </div>
  );
}

/** "6 GHz carries 41% of traffic with 19% of devices": the busiest Wi-Fi band, from the summary. */
function BandInsight({ rates }: { rates: Summary["rates"] }) {
  const band = rates?.topBand;
  if (!rates || !band) return null;
  const { trafficPct, devicePct } = rates.byBand[band];
  return (
    <div className="mt-2 text-2xs text-muted-foreground/70">
      {band} GHz carries <span className="tabular-nums">{formatPercent(trafficPct)}</span> of traffic with{" "}
      <span className="tabular-nums">{formatPercent(devicePct)}</span> of devices
    </div>
  );
}

function Cell({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("min-w-0 px-6 py-[22px]", className)}>{children}</div>;
}

/** The cell's key figure, at hero weight. */
function Figure({ children }: { children: ReactNode }) {
  return <span className="font-semibold text-4xl tabular-nums tracking-tight">{children}</span>;
}

function Label({ icon: Icon, className, children }: { icon: LucideIcon; className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 font-semibold text-3xs text-muted-foreground uppercase tracking-widest [&_svg]:size-[13px]",
        className,
      )}
    >
      <Icon />
      {children}
    </div>
  );
}
