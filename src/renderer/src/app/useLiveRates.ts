/**
 * Live rates for every view that shows them, only while the shared Live
 * switch is on (`useLiveMode`, #319). Those views (Devices, Device detail Now box). While
 * `active`, it asks for `device.rates.refresh` every `POLL.rates` seconds,
 * minimized or hidden windows included (Live is bounded already: it turns
 * off after 10 minutes and when the user leaves those pages), and, once the burst has settled, refetches `device.list` and `device.get`
 * every few seconds while eero keeps the burst's figures live
 * (`burstReadTimes`), like the eero app's live view (#254). eero queues a
 * burst asked for while its last one is still running (its `next_burst` then
 * moves later each minute), so the next ask waits until the last burst's
 * live window is over, and is never sooner than `POLL.rates`.
 * Core keeps bursts to one a minute per network, so views that run at the
 * same time share that one burst instead of doubling it.
 *
 * The figures on screen stay as they are while a burst settles (no fade);
 * the refetch after it shows on the topbar's updating cue. `key` restarts the cycle (pass the network id so a switch asks at once).
 */
import { useEffect } from "react";

import { invalidate, useCommand } from "~/app/useCommand";
import { useLiveMode } from "~/app/useLiveMode";
import type { BurstResult } from "../../../core/model";
import { BURST_LIVE_SEC, burstReadTimes, POLL } from "../../../core/poll";

export function useLiveRates(active: boolean, key = ""): void {
  const { run } = useCommand<Record<string, never>, BurstResult>("device.rates.refresh");
  const [live] = useLiveMode();
  const on = active && live;
  useEffect(() => {
    if (!on) return;
    let cancelled = false;
    let next: ReturnType<typeof setTimeout> | undefined;
    let reads: ReturnType<typeof setTimeout>[] = [];
    const tick = async () => {
      let wait = POLL.rates * 1000;
      const res = await run({});
      if (cancelled) return;
      const due = res.ok ? Date.parse(res.result.nextBurstAt) : Number.NaN;
      if (Number.isFinite(due)) {
        for (const t of reads) clearTimeout(t);
        reads = burstReadTimes(due)
          .map((at) => at - Date.now())
          .filter((ms) => ms > 0)
          .map((ms) => setTimeout(() => invalidate(["device.list", "device.get"]), ms));
        wait = Math.max(wait, due + (BURST_LIVE_SEC + 1) * 1000 - Date.now());
      }
      if (!cancelled) next = setTimeout(tick, wait);
    };
    void tick();
    return () => {
      cancelled = true;
      clearTimeout(next);
      for (const t of reads) clearTimeout(t);
    };
  }, [on, key, run]);
}
