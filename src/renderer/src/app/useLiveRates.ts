/**
 * Live rates for every view that shows them (Devices, Internet "Using the
 * most right now", Device detail Now box). While the window is visible and
 * `active`, it asks for `device.rates.refresh` every `POLL.rates` seconds
 * and, once the burst has settled, refetches `device.list` and `device.get`.
 * Core keeps bursts to one a minute per network, so views that run at the
 * same time share that one burst instead of doubling it.
 *
 * Returns true while a burst is settling, so the figures can fade.
 * `key` restarts the cycle (pass the network id so a switch asks at once).
 */
import { useEffect, useState } from "react";

import { invalidate, useCommand } from "~/app/useCommand";
import type { BurstResult } from "../../../core/model";
import { BURST_SETTLE_SEC, POLL } from "../../../core/poll";

export function useLiveRates(active: boolean, key = ""): boolean {
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
              invalidate(["device.list", "device.get"]);
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
  }, [active, key, run]);
  return pending;
}
