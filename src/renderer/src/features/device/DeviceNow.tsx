/**
 * The hero's Now box: this device's live download and upload. While the page
 * is visible and the device is online it asks for `device.rates.refresh`
 * once a minute (the engine shares that one burst per network with every
 * live view, so Devices and this page never double it) and refetches
 * `device.get` once the rates have settled.
 */
import { ArrowDown, ArrowUp } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { invalidate, useCommand } from "~/app/useCommand";
import { StatusDot } from "~/components/ui/status";
import { seriesColors } from "~/lib/chartColors";
import { cn } from "~/lib/utils";
import { mbpsParts } from "../../../../core/format";
import type { BurstResult, Device } from "../../../../core/model";
import { BURST_SETTLE_SEC, POLL } from "../../../../core/poll";

export function DeviceNow({ device: d, muted = false }: { device: Device; muted?: boolean }) {
  const online = d.connected && !d.blocked;
  const pending = useDeviceRates(online && !d.paused);
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

/** One burst a minute while visible and `active`; true while a burst is settling. */
function useDeviceRates(active: boolean): boolean {
  const { run } = useCommand<Record<string, never>, BurstResult>("device.rates.refresh");
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let next: ReturnType<typeof setTimeout> | undefined;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (document.visibilityState === "visible") {
        const res = await run({});
        if (cancelled) return;
        if (res.ok) {
          const wait = Date.parse(res.result.nextBurstAt) + BURST_SETTLE_SEC * 1000 - Date.now();
          if (Number.isFinite(wait) && wait > 0) {
            setPending(true);
            clearTimeout(settle);
            settle = setTimeout(() => {
              setPending(false);
              invalidate(["device.get", "device.list"]);
            }, wait);
          }
        }
      }
      if (!cancelled) next = setTimeout(tick, POLL.rates * 1000);
    };
    void tick();
    return () => {
      cancelled = true;
      clearTimeout(next);
      clearTimeout(settle);
      setPending(false);
    };
  }, [active, run]);
  return pending;
}
