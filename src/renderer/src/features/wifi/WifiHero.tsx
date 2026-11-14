/**
 * Wi-Fi hero: the SSID, whether it is broadcasting, wireless clients and
 * bands, and the QR block. The code stays an empty frame until "Show code"
 * runs `wifi.share`; Copy password and Save QR work from then on.
 * docs/ux/pages/wifi.md (Layout 1).
 */
import { Eye, Printer, Wifi } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Metric, PageHeader } from "~/components/ui/hero";
import { ComingSoonButton } from "~/components/ui/page";
import { QrBlock } from "~/components/ui/qr";
import { Status } from "~/components/ui/status";
import { bandLabel } from "~/components/ui/band-badge";
import { cn } from "~/lib/utils";
import { formatCount } from "../../../../core/format";
import type { Network, WifiSettings } from "../../../../core/model";
import type { Reveal } from "./WifiPage";

export function WifiHero({
  wifi,
  network,
  offline,
  reveal,
  fading = false,
}: {
  wifi: WifiSettings | null;
  network: Network | null;
  offline: boolean;
  reveal: Reveal;
  fading?: boolean;
}) {
  const ssid = wifi?.ssid ?? network?.name ?? null;
  const on = (wifi?.bands ?? []).filter((b) => b.on);
  const status = !wifi ? null : offline ? { tone: "destructive" as const, label: "Offline" } : on.length ? { tone: "success" as const, label: "Broadcasting" } : { tone: "muted" as const, label: "Not broadcasting" };
  const scope = !wifi || offline ? null : on.length === 1 && on[0] ? `One name on ${bandLabel(on[0].band)}` : on.length > 1 ? "One name on every band" : null;

  return (
    <PageHeader
      className={cn("transition-opacity", fading && "opacity-40")}
      title={ssid ?? "-"}
      icon={Wifi}
      status={
        <>
          {status && <Status tone={status.tone}>{status.label}</Status>}
          {scope && <span>{scope}</span>}
        </>
      }
      facts={
        <>
          <Metric label="Wireless clients" value={wifi && !offline ? formatCount(wifi.wirelessClients) : null} />
          <Metric label="Bands on" value={wifi && !offline ? `${on.length} of ${wifi.bands.length}` : null} />
        </>
      }
      aside={
        <QrBlock
          value={reveal.share?.qr ?? null}
          ariaLabel={ssid ? `QR code to join ${ssid}` : "Wi-Fi QR code"}
          caption={reveal.error ? <span className="text-destructive-foreground">Couldn't load the code</span> : "Wi-Fi Network"}
          copyLabel="Copy password"
          copyText={async () => (await reveal.load())?.password ?? null}
          fileName={`${ssid ?? "Wi-Fi"} QR.png`}
          actions={
            <>
              {!reveal.share && (
                <Button size="sm" variant="outline" disabled={!wifi || reveal.loading} onClick={() => void reveal.load()}>
                  <Eye />
                  Show code
                </Button>
              )}
              <ComingSoonButton size="sm" variant="outline">
                <Printer />
                Print a card
              </ComingSoonButton>
            </>
          }
        />
      }
    />
  );
}
