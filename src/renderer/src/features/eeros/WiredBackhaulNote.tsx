import { Info } from "lucide-react";

import type { Eero } from "../../../../core/model";

/**
 * Shown only when an eero other than the gateway has a wired backhaul and
 * eero reports wired devices (not eeros) on the gateway, the ones that may
 * really be plugged into that other eero: eero
 * reports wired devices plugged into it as wired to the gateway, because the
 * eero passes its spare Ethernet ports straight through to the backhaul cable
 * (docs/eero-api/data-model.md, Device). Mesh UI shows it as eero reports it.
 */
export function WiredBackhaulNote({ eeros, wiredOnGateway }: { eeros: ReadonlyArray<Eero>; wiredOnGateway: number }) {
  if (wiredOnGateway === 0 || !eeros.some((e) => !e.isGateway && e.backhaul === "wired")) return null;
  return (
    <div className="flex gap-2 px-1 text-muted-foreground/50 text-xs">
      <Info className="mt-px size-3.5 shrink-0" />
      <span>
        Devices plugged into an eero with a wired backhaul may show as wired to the gateway. That eero passes its Ethernet
        ports straight through to the cable, so eero sees them arrive at the gateway's port.
      </span>
    </div>
  );
}
