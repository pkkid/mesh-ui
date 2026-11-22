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
import { ImpactBox, ImpactFigure, ImpactFigures, ImpactSummary } from "~/components/ui/impact";
import { formatCount } from "../../../../core/format";
import type { ImpactDevice, WifiImpact as Impact } from "../../../../core/commands/wifi";

export type ImpactParams = { change: Impact["change"]; band24?: string; band5?: string };

/** "A, B, C and 4 more". */
function names(devices: ImpactDevice[], max = 5): string {
  const shown = devices.slice(0, max).map((d) => d.name);
  const rest = devices.length - shown.length;
  if (rest > 0) return `${shown.join(", ")} and ${formatCount(rest)} more`;
  return shown.length <= 1 ? (shown[0] ?? "") : `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}`;
}

/** Reads `wifi.impact` for `params`; null params (nothing changed) shows nothing. */
export function WifiImpact({ params, className }: { params: ImpactParams | null; className?: string }) {
  const q = useQuery<Impact>("wifi.impact", params ?? { change: "name" }, { enabled: params !== null });
  const impact = params ? (q.data ?? null) : null;

  if (!params) return null;

  const security = params.change === "security";
  const fine = impact
    ? [
        !impact.guestAffected && "The guest network is not affected",
        !impact.wiredAffected && "Wired devices stay online",
        impact.restart === null && "eeros do not restart",
      ].filter((x): x is string => typeof x === "string")
    : [];

  return (
    <ImpactBox fading={q.fading} className={className}>
      {q.error && !impact ? (
        <div className="text-destructive-foreground text-xs">{q.error.message}</div>
      ) : (
        <>
          <ImpactFigures>
            <ImpactFigure label="devices disconnect" value={impact ? impact.reconnect.length : null} />
            {security ? (
              <ImpactFigure label="can't rejoin (WPA2 only)" value={impact ? impact.drop.length : null} tone="destructive" />
            ) : params.change !== "hide5g" ? (
              <ImpactFigure label="may need their own app" value={impact ? impact.needsSetup.length : null} tone="plain" />
            ) : null}
          </ImpactFigures>
          {impact && (
            <ImpactSummary>
              {impact.summary}
              {impact.drop.length > 0 && <> {names(impact.drop)}.</>}
              {!security && impact.needsSetup.length > 0 && <> {names(impact.needsSetup)}.</>}
            </ImpactSummary>
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
    </ImpactBox>
  );
}
