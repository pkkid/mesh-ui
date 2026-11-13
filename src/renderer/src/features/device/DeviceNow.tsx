/**
 * The hero's Now box: this device's live download and upload. While the page
 * is visible and the device is online it asks for `device.rates.refresh`
 * through the shared `useLiveRates` hook, which refetches `device.get` once
 * the rates have settled.
 */
import { ArrowDown, ArrowUp } from "lucide-react";
import type { ReactNode } from "react";

import { useLiveRates } from "~/app/useLiveRates";
import { StatusDot } from "~/components/ui/status";
import { seriesColors } from "~/lib/chartColors";
import { cn } from "~/lib/utils";
import { mbpsParts } from "../../../../core/format";
import type { Device } from "../../../../core/model";

export function DeviceNow({ device: d, muted = false }: { device: Device; muted?: boolean }) {
  const online = d.connected && !d.blocked;
  const pending = useLiveRates(online && !d.paused);
  const live = online && !d.paused && d.rates;

  let note = "Current rates while the device is active";
  if (d.blocked) note = "Blocked, no internet";
  else if (!d.connected) note = "Rates appear when the device is online";
  else if (d.paused) note = "Paused, no internet";

  return (
    <div className={cn("w-[260px] rounded-xl border bg-background/60 px-4 py-3.5", muted && "opacity-60")}>
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 font-semibold text-3xs text-muted-foreground uppercase tracking-widest">
          <StatusDot tone={live ? "success" : "muted"} />
          Now
        </span>
        <span className="text-3xs text-muted-foreground">refreshes every minute</span>
      </div>
      <div className={cn("mt-2.5 flex gap-6 transition-opacity", pending && "opacity-40")}>
        <Rate icon={<ArrowDown className="size-[13px]" style={{ color: seriesColors.download }} />} label="Download" mbps={live ? d.rates?.downMbps : null} />
        <Rate icon={<ArrowUp className="size-[13px]" style={{ color: seriesColors.upload }} />} label="Upload" mbps={live ? d.rates?.upMbps : null} />
      </div>
      <div className="mt-2.5 text-3xs text-muted-foreground">{note}</div>
    </div>
  );
}

function Rate({ icon, label, mbps }: { icon: ReactNode; label: string; mbps: number | null | undefined }) {
  const p = mbpsParts(mbps);
  return (
    <div>
      <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 font-semibold text-2xl tabular-nums tracking-tight">
        {p.value}
        {p.unit && <small className="ms-1 font-medium text-muted-foreground text-xs">{p.unit}</small>}
      </div>
    </div>
  );
}
