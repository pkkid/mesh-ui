/**
 * Wi-Fi hero (docs/ux/pages/wifi.md, Layout 1), laid out like Guest
 * network's: the flat page header with no icon tile. Title is the SSID, the
 * status line says whether it is broadcasting and on which bands (and warns
 * while 2.4 GHz only is on). Facts: Wireless devices, Security (the 2.4 and
 * 5 GHz mode, with how many devices joined with WPA2 only) and Busiest band.
 * One action, an outline hero button with a dim icon: Copy password.
 *
 * The right-hand column is the plain QR code (round dots, rounded corner
 * markers) in a 1px frame with 15px of padding. It stays an empty frame, with
 * a "Show code" button centred in it, until that button is clicked; the
 * payload is read in the background as the page opens (WifiPage), so the
 * button fades out and the code fades in at once.
 * Copy password reads `wifi.password.get`.
 */
import { Copy, Eye } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "~/components/ui/button";
import { Metric, PageHeader } from "~/components/ui/hero";
import { QrCode } from "~/components/ui/qr";
import { Status } from "~/components/ui/status";
import { bandLabel } from "~/components/ui/band-badge";
import { copyText } from "~/lib/clipboard";
import { cn } from "~/lib/utils";
import { formatCount, formatPercent } from "../../../../core/format";
import type { Network, Security, WifiSettings, WifiShare } from "../../../../core/model";
import type { WifiPassword } from "../../../../core/commands/wifi";
import type { Secret } from "./WifiPage";

/** eero's full names for the security modes. */
export const SECURITY_LABEL: Record<Security, string> = {
  WPA2: "Standard (WPA2)",
  WPA2_WPA3: "Hybrid (WPA2 + WPA3)",
  WPA3: "Enhanced (WPA3)",
};


/** Show code's fade out, the same 150ms as a page change's (router.tsx FADE_OUT_MS); the code then fades in over 300ms, as a page does. */
const REVEAL_FADE_MS = 150;

const muted = (text: string) => <span className="font-normal text-muted-foreground text-xs"> · {text}</span>;

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
  const ssid = wifi?.ssid ?? network?.name ?? null;
  const on = (wifi?.bands ?? []).filter((b) => b.on);
  const status = !wifi ? null : offline ? { tone: "destructive" as const, label: "Offline" } : on.length ? { tone: "success" as const, label: "Broadcasting" } : { tone: "muted" as const, label: "Not broadcasting" };
  const scope = !wifi || offline ? null : on.length === 1 && on[0] ? `One name on ${bandLabel(on[0].band)}` : on.length > 1 ? "One name on every band" : null;
  const known = wifi !== null && !offline;

  // Security: the 2.4 and 5 GHz mode (6 GHz is always WPA3), "Mixed" when they differ.
  const modes = wifi ? (["2.4", "5"] as const).map((b) => wifi.security[b]).filter((m): m is Security => m !== null) : [];
  const security = !wifi ? null : !wifi.hasPassword ? "Open, no password" : modes.length && modes.every((m) => m === modes[0]) ? SECURITY_LABEL[modes[0] as Security] : modes.length ? "Mixed" : null;
  const wpa2Only = wifi?.wpa2OnlyDevices.length ?? 0;
  // Busiest band: the one with the most wireless devices, with its share.
  const total = (wifi?.bands ?? []).reduce((n, b) => n + b.clients, 0);
  const busiest = known && total > 0 ? [...(wifi?.bands ?? [])].sort((a, b) => b.clients - a.clients)[0] : undefined;

  // Show code: fade the button out (150ms), then the code in (300ms), like a page change. The payload is
  // usually already read (WifiPage reads it as the page opens); if not, the code fades in once it lands.
  const [revealed, setRevealed] = useState(false);
  const [fadingOut, setFadingOut] = useState(false);
  const shown = revealed && !fadingOut ? share.value : null;
  // A network switch, or a name or password change, drops the payload: hide the code again.
  useEffect(() => {
    if (!share.value && !share.loading) setRevealed(false);
  }, [share.value, share.loading]);
  const reveal = () => {
    setFadingOut(true);
    if (!share.value) void share.load();
    setTimeout(() => {
      setRevealed(true);
      setFadingOut(false);
    }, REVEAL_FADE_MS);
  };

  return (
    <PageHeader
      flat
      data-slot="wifi-hero"
      className={cn("transition-opacity", fading && "opacity-40")}
      title={ssid ?? "-"}
      status={
        <>
          {status && <Status tone={status.tone}>{status.label}</Status>}
          {scope && <span>{scope}</span>}
          {known && wifi?.hide5g.active && <Status tone="warning">2.4 GHz only on</Status>}
        </>
      }
      facts={
        <>
          <Metric label="Wireless devices" value={known ? formatCount(wifi.wirelessClients) : null} />
          <Metric label="Security" value={security ? <>{security}{wpa2Only > 0 ? muted(`${formatCount(wpa2Only)} on WPA2 only`) : null}</> : null} />
          <Metric label="Busiest band" value={busiest ? <>{bandLabel(busiest.band)}{muted(`${formatPercent((busiest.clients / total) * 100)} of devices`)}</> : null} />
        </>
      }
      actions={
        <Button
          variant="outline"
          disabled={!wifi || !wifi.hasPassword || password.loading}
          title={wifi && !wifi.hasPassword ? "This network has no password" : "Copies the Wi-Fi password"}
          onClick={async () => {
            const p = await password.load();
            if (p?.password) await copyText(p.password, { toast: "Copied password" });
          }}
        >
          <Copy />
          Copy password
        </Button>
      }
      aside={
        <div className="flex flex-col items-center gap-1.5">
          {/* A 1px frame with 15px of padding around the plain code, as on Guest network. */}
          <div className="rounded-xl border p-[15px]">
            <QrCode
              // A new element when the code appears, so its starting opacity (0) applies and it fades in.
              key={shown ? "code" : "empty"}
              plain
              size={130}
              value={shown?.qr ?? null}
              // Out over 150ms ease-out, in over 300ms ease-in-out: the same timings as a page change (router.tsx).
              className={cn(
                "transition-opacity",
                shown ? "duration-300 ease-in-out starting:opacity-0" : "duration-150 ease-out",
                !shown && "bg-transparent",
                fadingOut && "opacity-0",
              )}
              ariaLabel={ssid ? `QR code to join ${ssid}` : "Wi-Fi QR code"}
              placeholder={
                <Button
                  size="xs"
                  variant="outline"
                  disabled={!wifi || fadingOut || (revealed && share.loading)}
                  aria-label={ssid ? `Show the QR code to join ${ssid}` : "Show the Wi-Fi QR code"}
                  onClick={reveal}
                >
                  <Eye />
                  Show code
                </Button>
              }
            />
          </div>
          {share.error ? <div className="text-destructive-foreground text-xs">Couldn't load the code</div> : null}
        </div>
      }
    />
  );
}
