/**
 * Wi-Fi hero: the SSID, whether it is broadcasting, wireless clients and
 * bands, and the QR block. The code stays an empty frame, with a "Show code"
 * button centred in it, until that button runs `wifi.share`; Copy password and Save QR work from then on (copy reads
 * `wifi.password.get`). Print a card reads the same share (running
 * `wifi.share` first if the code is not shown yet) and prints the guest
 * card layout titled "Wi-Fi" (M6.9; no new command).
 * docs/ux/pages/wifi.md (Layout 1).
 */
import { Eye, Printer, Wifi } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Metric, PageHeader } from "~/components/ui/hero";
import { QrBlock } from "~/components/ui/qr";
import { Status } from "~/components/ui/status";
import { bandLabel } from "~/components/ui/band-badge";
import { useGuestCardPrint } from "~/features/guest/GuestCard";
import { cn } from "~/lib/utils";
import { formatCount } from "../../../../core/format";
import type { Network, WifiSettings, WifiShare } from "../../../../core/model";
import type { WifiPassword } from "../../../../core/commands/wifi";
import type { Secret } from "./WifiPage";

export function WifiHero({
  wifi,
  network,
  offline,
  share,
  password,
  fading = false,
}: {
  wifi: WifiSettings | null;
  network: Network | null;
  offline: boolean;
  share: Secret<WifiShare>;
  password: Secret<WifiPassword>;
  fading?: boolean;
}) {
  const card = useGuestCardPrint("Wi-Fi");
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
          value={share.value?.qr ?? null}
          ariaLabel={ssid ? `QR code to join ${ssid}` : "Wi-Fi QR code"}
          caption={share.error ? <span className="text-destructive-foreground">Couldn't load the code</span> : "Wi-Fi Network"}
          copyLabel="Copy password"
          copyText={async () => (await password.load())?.password ?? null}
          fileName={`${ssid ?? "Wi-Fi"} QR.png`}
          placeholder={
            <Button
              size="xs"
              variant="outline"
              disabled={!wifi || share.loading}
              aria-label={ssid ? `Show the QR code to join ${ssid}` : "Show the Wi-Fi QR code"}
              onClick={() => void share.load()}
            >
              <Eye />
              Show code
            </Button>
          }
          actions={
            <>
              <Button
                variant="outline"
                disabled={!wifi || share.loading}
                title="Prints the network name, password and QR code"
                onClick={async () => {
                  const s = await share.load();
                  if (s) card.print(s);
                }}
              >
                <Printer />
                Print a card
              </Button>
              {card.card}
            </>
          }
        />
      }
    />
  );
}
