/**
 * Live rates for every view that shows them (Devices, Internet "Using the
 * most right now", Device detail Now box). While the window is visible and
 * `active`, it asks for `device.rates.refresh` every `POLL.rates` seconds
 * and, once the burst has settled, refetches `device.list` and `device.get`
 * every few seconds while eero keeps the burst's figures live
 * (`burstReadTimes`), like the eero app's live view (#254).
 * Core keeps bursts to one a minute per network, so views that run at the
 * same time share that one burst instead of doubling it.
 *
 * The figures on screen stay as they are while a burst settles (no fade);
 * the refetch after it shows on the topbar's updating cue. `key` restarts the cycle (pass the network id so a switch asks at once).
 */
import { useEffect } from "react";

import { invalidate, useCommand } from "~/app/useCommand";
import type { BurstResult } from "../../../core/model";
import { burstReadTimes, POLL } from "../../../core/poll";

export function useLiveRates(active: boolean, key = ""): void {
  const { run } = useCommand<Record<string, never>, BurstResult>("device.rates.refresh");
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let next: ReturnType<typeof setTimeout> | undefined;
    let reads: ReturnType<typeof setTimeout>[] = [];
    const tick = async () => {
      if (document.visibilityState === "visible") {
        const res = await run({});
        if (cancelled) return;
        const due = res.ok ? Date.parse(res.result.nextBurstAt) : Number.NaN;
        if (Number.isFinite(due)) {
          for (const t of reads) clearTimeout(t);
          reads = burstReadTimes(due)
            .map((at) => at - Date.now())
            .filter((wait) => wait > 0)
            .map((wait) => setTimeout(() => invalidate(["device.list", "device.get"]), wait));
        }
      }
      if (!cancelled) next = setTimeout(tick, POLL.rates * 1000);
    };
    void tick();
    return () => {
      cancelled = true;
      clearTimeout(next);
      for (const t of reads) clearTimeout(t);
    };
  }, [active, key, run]);
}
