// The "Impact of saving" box shown in sheets before a change is saved
// (design-system.md#impact-of-saving): a muted box, a title in the field
// label style, a row of small figures (count over a muted label, the count in
// the warning or destructive colour when above zero), and core's summary in
// muted text. Used by the Advanced networking and time zone sheets
// (ImpactPanel) and the Wi-Fi sheets (WifiImpact); every figure and sentence
// comes from core.
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import { formatCount, MISSING } from "../../../../core/format";

export function ImpactBox({ title = "Impact of saving", fading = false, className, children }: { title?: string; fading?: boolean; className?: string; children: ReactNode }) {
  return (
    <div aria-label={title} className={cn("flex flex-col gap-2.5 rounded-xl border bg-muted/40 px-3.5 py-3 transition-opacity", fading && "opacity-40", className)}>
      <div className="font-medium text-xs">{title}</div>
      {children}
    </div>
  );
}

/** A row of figures, two to a line. */
export function ImpactFigures({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3">{children}</div>;
}

/** One count: "0" over "devices lose internet". Null shows "-" while it loads. */
export function ImpactFigure({ label, value, tone = "warning" }: { label: string; value: number | null; tone?: "warning" | "destructive" | "plain" }) {
  const hot = value !== null && value > 0;
  return (
    <div className="min-w-0">
      <div
        className={cn(
          "font-semibold text-base tabular-nums",
          hot && tone === "warning" && "text-warning-foreground",
          hot && tone === "destructive" && "text-destructive-foreground",
        )}
      >
        {value === null ? MISSING : formatCount(value)}
      </div>
      <div className="text-muted-foreground text-xs">{label}</div>
    </div>
  );
}

/** Core's summary sentence, muted. */
export function ImpactSummary({ children }: { children: ReactNode }) {
  return <p className="text-muted-foreground text-xs">{children}</p>;
}
