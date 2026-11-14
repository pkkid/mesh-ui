/**
 * Guest network hero: ticket tile, the guest network name, its status and
 * how many guests are on, the (disabled for now) power button, and the QR
 * block with Copy password and Save QR. docs/ux/pages/guest.md (Layout 1).
 *
 * The QR payload comes from `guest.share`, which reveals the password. It is
 * run once when the hero mounts (and again for Copy password), held only in
 * this component, never in the shared query cache and never polled.
 */
import { Power, Ticket } from "lucide-react";
import { useEffect } from "react";

import { useCommand } from "~/app/useCommand";
import { PageHeader } from "~/components/ui/hero";
import { ComingSoonButton } from "~/components/ui/page";
import { QrBlock, QrCode } from "~/components/ui/qr";
import { Status } from "~/components/ui/status";
import { cn } from "~/lib/utils";
import { formatCount } from "../../../../core/format";
import type { GuestNetwork, WifiShare } from "../../../../core/model";

export type GuestHeroProps = {
  guest: GuestNetwork | undefined;
  /** Main network name, for the title fallback. */
  networkName: string | null;
  /** The guest network cannot run (bridge mode). */
  unavailable: boolean;
  /** The whole network is not reporting: the settings shown are the last known. */
  offline?: boolean;
  fading?: boolean;
};

export function GuestHero({ guest, networkName, unavailable, offline = false, fading = false }: GuestHeroProps) {
  const on = guest?.enabled === true && !unavailable;
  const title = guest ? (guest.name ?? (networkName ? `${networkName} Guest` : "Guest network")) : "-";
  const guests = guest?.online ?? 0;

  return (
    <PageHeader
      className={cn("transition-opacity", fading && "opacity-40")}
      title={title}
      icon={Ticket}
      status={
        guest ? (
          <>
            <Status tone={on ? "success" : "muted"}>{on ? "On" : "Off"}</Status>
            <span>
              {unavailable
                ? "Not available in bridge mode"
                : offline
                  ? "Network offline, showing the last known settings"
                  : on
                  ? `Broadcast on all eeros · ${guests === 0 ? "No guests online" : `${formatCount(guests)} ${guests === 1 ? "guest" : "guests"} online`}`
                  : "Guests cannot join while it is off"}
            </span>
            {on && !guest.hasPassword && <Status tone="warning">Open, no password</Status>}
          </>
        ) : null
      }
      actions={
        unavailable || !guest ? null : (
          <ComingSoonButton size="sm" variant={on ? "destructive" : "default"}>
            <Power />
            {on ? "Turn off guest network" : "Turn on guest network"}
          </ComingSoonButton>
        )
      }
      aside={unavailable || !guest ? null : on ? <ShareBlock guest={guest} /> : <OffQr />}
    />
  );
}

/** The QR block of an on guest network. Re-reads the share when the name or password state changes. */
function ShareBlock({ guest }: { guest: GuestNetwork }) {
  const share = useCommand<Record<string, never>, WifiShare>("guest.share");
  const { run, reset } = share;
  useEffect(() => {
    void run();
    return reset;
  }, [run, reset, guest.name, guest.hasPassword]);

  const ssid = share.result?.ssid ?? guest.name ?? "the guest network";
  // Copy reads the password again on click, so it is never kept longer than needed.
  const copyPassword = async () => {
    const res = await run();
    return res.ok ? res.result.password : null;
  };

  return (
    <QrBlock
      value={share.result?.qr}
      ariaLabel={`QR code to join ${ssid}`}
      caption={share.error ? "Couldn't load the code" : "Guest Network"}
      copyLabel={guest.hasPassword ? "Copy password" : undefined}
      copyText={copyPassword}
      fileName={`${fileSafe(ssid)} QR.png`}
    />
  );
}

/** An empty frame and one line while the guest network is off. */
function OffQr() {
  return (
    <div className="flex max-w-[11rem] flex-col items-center gap-1.5 text-center">
      <QrCode value={null} ariaLabel="QR code to join the guest network" className="opacity-60" />
      <div className="text-muted-foreground text-xs">Turn the guest network on to share it.</div>
    </div>
  );
}

/** A file name from a network name: no path separators or characters some systems refuse. */
export function fileSafe(name: string): string {
  const s = name.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  return s || "Guest network";
}
