// Band badge: the small neutral box for a connection's band ("2.4 GHz",
// "5 GHz", "6 GHz", "Wired"). Neutral on purpose: band colours are for chart
// series only (docs/design/design-system.md, Components).
import { Cable } from "lucide-react";

import { cn } from "~/lib/utils";
import type { Band } from "../../../../core/model";

/** "2.4 GHz", "5 GHz", "6 GHz", "Wired". */
export function bandLabel(band: Band): string {
  return band === "wired" ? "Wired" : `${band} GHz`;
}

function BandBadge({ band, className }: { band: Band; className?: string }) {
  return (
    <span
      data-slot="band-badge"
      className={cn(
        "inline-flex h-[19px] items-center gap-1 whitespace-nowrap rounded-[5px] border bg-muted px-1.5 font-medium text-[11px] text-foreground/80 tabular-nums [&_svg]:size-[11px]",
        className,
      )}
    >
      {band === "wired" && <Cable aria-hidden />}
      {bandLabel(band)}
    </span>
  );
}

export { BandBadge };
