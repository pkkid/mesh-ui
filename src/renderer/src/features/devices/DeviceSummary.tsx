/**
 * The summary strip at the top of Devices (docs/ux/pages/devices.md, Layout
 * 1): devices by type, throughput now, and devices new this week. All of it
 * comes from the `device.list` summary, which always covers the whole
 * network whatever the filters.
 */
import { Activity, type LucideIcon, Shapes, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

import { Donut } from "~/components/charts/Donut";
import { Card } from "~/components/ui/card";
import { IconTile } from "~/components/ui/hero";
import { entityColor, seriesColors } from "~/lib/chartColors";
import { cn } from "~/lib/utils";
import { formatCount, formatRelative, mbpsParts } from "../../../../core/format";
import type { Device, DeviceCategory, DeviceSummary as Summary } from "../../../../core/model";

import { CATEGORIES, CATEGORY_LABELS } from "./DeviceFilters";
import { deviceIcon } from "./DeviceTable";

/** Category series colours: entity hues in order, with Other as the neutral series. */
export const categoryColor = (c: DeviceCategory): string =>
  c === "other" ? seriesColors.neutral : entityColor(CATEGORIES.indexOf(c));

type DeviceSummaryProps = {
  summary: Summary | undefined;
  /** Every device on the network, to show the new ones by id. */
  devices: ReadonlyArray<Device> | undefined;
  eeroName: ReadonlyMap<string, string>;
  /** A rates burst is pending: fade the throughput figures. */
  ratesPending: boolean;
  fading: boolean;
};

export function DeviceSummary({ summary: s, devices, eeroName, ratesPending, fading }: DeviceSummaryProps) {
  const byId = new Map((devices ?? []).map((d) => [d.id, d]));
  const fresh = (s?.newThisWeek ?? []).flatMap((id) => byId.get(id) ?? []);
  const down = mbpsParts(s?.rates?.downMbps);
  const now = Date.now();

  return (
    <Card className="grid grid-cols-1 md:grid-cols-[1.2fr_1fr_1.2fr] [&>*+*]:border-t md:[&>*+*]:border-t-0 md:[&>*+*]:border-l">
      <Cell className={cn("flex items-center gap-4", fading && "opacity-40")}>
        <Donut
          size={84}
          thickness={9}
          ariaLabel="Devices by type"
          format={(v) => `${formatCount(v)} ${v === 1 ? "device" : "devices"}`}
          segments={CATEGORIES.map((c) => ({ label: CATEGORY_LABELS[c], value: s?.byCategory[c] ?? 0, color: categoryColor(c) }))}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1 text-[11.5px]">
          <Label icon={Shapes} className="mb-1">
            By type
          </Label>
          {CATEGORIES.map((c) => (
            <div key={c} className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                <span aria-hidden className="size-2 shrink-0 rounded-[2px]" style={{ background: categoryColor(c) }} />
                <span className="truncate">{CATEGORY_LABELS[c]}</span>
              </span>
              <span className="font-medium tabular-nums">{s ? s.byCategory[c] : "-"}</span>
            </div>
          ))}
        </div>
      </Cell>

      <Cell className={cn("transition-opacity", (ratesPending || fading) && "opacity-40")}>
        <Label icon={Activity}>Throughput now</Label>
        <div className="mt-2">
          <span className="font-semibold text-2xl tabular-nums tracking-tight">{down.value}</span>
          {down.unit && <span className="text-muted-foreground text-xs"> {down.unit} down</span>}
        </div>
        <div className="text-muted-foreground text-xs">
          {s?.rates ? (
            <>
              <span className="font-medium text-foreground/80 tabular-nums">{mbpsParts(s.rates.upMbps).value} Mbps</span> up ·{" "}
              {s.rates.active} {s.rates.active === 1 ? "device" : "devices"} active
            </>
          ) : (
            "No live rates yet"
          )}
        </div>
        <div className="mt-2 text-2xs text-muted-foreground/70">Sum of current device rates, refreshed every minute</div>
      </Cell>

      <Cell className={cn(fading && "opacity-40")}>
        <Label icon={Sparkles}>
          New this week
          <span className="ms-auto text-foreground text-xs tabular-nums normal-case tracking-normal">
            {s ? s.newThisWeek.length : "-"}
          </span>
        </Label>
        <div className="mt-3 flex flex-col gap-2">
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
      </Cell>
    </Card>
  );
}

function Cell({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("min-w-0 px-[18px] py-4", className)}>{children}</div>;
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
