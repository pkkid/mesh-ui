/**
 * Impact of saving a Wi-Fi change, from `wifi.impact`: devices that drop and
 * must rejoin (warning colour), smart home devices that may need their own
 * app or WPA2 only devices that cannot rejoin, the summary from core (with
 * any restart estimate), the names, and what stays fine. Shown in the name
 * and password sheet, under a staged security change and before 2.4 GHz only. Every figure and sentence
 * comes from core. docs/ux/pages/wifi.md (Side panel 1).
 */
import { Check } from "lucide-react";

import { useQuery } from "~/app/useCommand";
import { cn } from "~/lib/utils";
import { formatCount, MISSING } from "../../../../core/format";
import type { ImpactDevice, WifiImpact as Impact } from "../../../../core/commands/wifi";

export type ImpactParams = { change: Impact["change"]; band24?: string; band5?: string };

/** "A, B, C and 4 more". */
function names(devices: ImpactDevice[], max = 5): string {
  const shown = devices.slice(0, max).map((d) => d.name);
  const rest = devices.length - shown.length;
  if (rest > 0) return `${shown.join(", ")} and ${formatCount(rest)} more`;
  return shown.length <= 1 ? (shown[0] ?? "") : `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}`;
}

function Figure({ label, value, tone }: { label: string; value: number | null; tone?: "warning" | "destructive" }) {
  return (
    <div className="min-w-0">
      <div
        className={cn(
          "font-semibold text-2xl tabular-nums tracking-tight",
          value !== null && value > 0 && tone === "warning" && "text-warning-foreground",
          value !== null && value > 0 && tone === "destructive" && "text-destructive-foreground",
        )}
      >
        {value === null ? MISSING : formatCount(value)}
      </div>
      <div className="text-muted-foreground text-xs">{label}</div>
    </div>
  );
}

/** Reads `wifi.impact` for `params`; null params shows "Nothing to save". */
export function WifiImpact({ params, className }: { params: ImpactParams | null; className?: string }) {
  const q = useQuery<Impact>("wifi.impact", params ?? { change: "name" }, { enabled: params !== null });
  const impact = params ? (q.data ?? null) : null;

  if (!params) {
    return <div className={cn("rounded-xl border bg-muted/40 px-3.5 py-3 text-muted-foreground text-xs", className)}>Nothing to save.</div>;
  }

  const security = params.change === "security";
  const fine = impact
    ? [
        !impact.guestAffected && "The guest network is not affected",
        !impact.wiredAffected && "Wired devices stay online",
        impact.restart === null && "eeros do not restart",
      ].filter((x): x is string => typeof x === "string")
    : [];

  return (
    <div
      aria-label="Impact of saving"
      className={cn("flex flex-col gap-3 rounded-xl border bg-muted/40 px-3.5 py-3 transition-opacity", q.fading && "opacity-40", className)}
    >
      <div className="font-semibold text-3xs text-muted-foreground/70 uppercase tracking-widest">Impact of saving</div>
      {q.error && !impact ? (
        <div className="text-destructive-foreground text-xs">{q.error.message}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Figure label="Devices disconnect" value={impact ? impact.reconnect.length : null} tone="warning" />
            {security ? (
              <Figure label="Can't rejoin (WPA2 only)" value={impact ? impact.drop.length : null} tone="destructive" />
            ) : params.change !== "hide5g" ? (
              <Figure label="May need their own app" value={impact ? impact.needsSetup.length : null} />
            ) : null}
          </div>
          {impact && (
            <p className="text-foreground/80 text-xs">
              {impact.summary}
              {impact.drop.length > 0 && <span className="text-muted-foreground"> {names(impact.drop)}.</span>}
              {!security && impact.needsSetup.length > 0 && <span className="text-muted-foreground"> {names(impact.needsSetup)}.</span>}
            </p>
          )}
          {fine.length > 0 && (
            <ul className="flex flex-col gap-1 text-muted-foreground text-xs">
              {fine.map((f) => (
                <li key={f} className="flex items-center gap-1.5">
                  <Check aria-hidden className="size-3.5 shrink-0" />
                  {f}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
