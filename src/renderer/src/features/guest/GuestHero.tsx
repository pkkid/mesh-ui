/**
 * Guest network hero: ticket tile, the guest network name, its status and
 * how many guests are on, the power button (`guest.enable`, or
 * `guest.disable` behind an inline confirm), and the QR block with Copy
 * password, Save QR, Print a card and Send to a guest.
 * docs/ux/pages/guest.md (Layout 1).
 *
 * The QR payload comes from `guest.share`, which reveals the password. It is
 * run when the hero mounts and again after a name or password change (and
 * for Copy password, Print and Send), held only in this component, never in
 * the shared query cache and never polled.
 */
import { Power, Printer, Send, Ticket } from "lucide-react";
import { useEffect } from "react";

import { useCommand } from "~/app/useCommand";
import { useWrite } from "~/app/useWrite";
import { Button } from "~/components/ui/button";
import { WriteConfirm } from "~/components/ui/confirm";
import { PageHeader } from "~/components/ui/hero";
import { GatedButton, useGate } from "~/components/ui/page";
import { QrBlock, QrCode } from "~/components/ui/qr";
import { copyText } from "~/lib/clipboard";
import { Status } from "~/components/ui/status";
import { cn } from "~/lib/utils";
import { formatCount } from "../../../../core/format";
import type { GuestNetwork, WifiShare } from "../../../../core/model";
import { inviteText, useGuestCardPrint } from "./GuestCard";

export type GuestHeroProps = {
  guest: GuestNetwork | undefined;
  /** Main network name, for the title fallback. */
  networkName: string | null;
  /** The guest network cannot run (bridge mode). */
  unavailable: boolean;
  /** The whole network is not reporting: the settings shown are the last known. */
  offline?: boolean;
  fading?: boolean;
  /** Bumped after a name or password change, so the QR is read again. */
  shareVersion?: number;
};

export function GuestHero({ guest, networkName, unavailable, offline = false, fading = false, shareVersion = 0 }: GuestHeroProps) {
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
      actions={unavailable || !guest ? null : <PowerButton on={on} />}
      aside={unavailable || !guest ? null : on ? <ShareBlock guest={guest} version={shareVersion} /> : <OffQr />}
    />
  );
}

/** Turn on (a plain write with Undo) or off (disruptive: inline confirm with the guests it drops, then a progress toast). */
function PowerButton({ on }: { on: boolean }) {
  const gate = useGate({ area: "settings" });
  const disable = useWrite("guest.disable", {
    confirm: { title: "Turn off guest network?", confirmLabel: "Turn off" },
    progress: "Turning off guest network",
    success: "Guest network off",
    undo: { id: "guest.enable" },
  });
  const enable = useWrite("guest.enable", {
    success: "Guest network on",
    // Undo turns it off again, which asks first like the button does.
    undo: { id: "guest.disable", confirm: { title: "Turn off guest network?", confirmLabel: "Turn off" } },
  });
  const write = on ? disable : enable;
  return (
    <WriteConfirm write={disable.asking ? disable : enable} className="max-w-md">
      <GatedButton gate={gate} size="sm" variant={on ? "destructive" : "default"} disabled={write.running} onClick={() => void write.run()}>
        <Power />
        {on ? "Turn off guest network" : "Turn on guest network"}
      </GatedButton>
    </WriteConfirm>
  );
}

/**
 * The QR block of an on guest network. Re-reads the share when the name or
 * password state changes, or after a password change (`version`).
 */
function ShareBlock({ guest, version }: { guest: GuestNetwork; version: number }) {
  const share = useCommand<Record<string, never>, WifiShare>("guest.share");
  const { run, reset } = share;
  const card = useGuestCardPrint();
  useEffect(() => {
    void run();
    return reset;
  }, [run, reset, guest.name, guest.hasPassword, version]);

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
      actions={
        <>
          <Button
            size="sm"
            variant="outline"
            disabled={!share.result}
            onClick={async () => {
              const res = await run();
              if (res.ok) card.print(res.result);
            }}
          >
            <Printer />
            Print a card
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!share.result}
            title="Copies a short invite with the name and password"
            onClick={async () => {
              const res = await run();
              if (res.ok) await copyText(inviteText(res.result), { toast: "Invite copied" });
            }}
          >
            <Send />
            Send to a guest
          </Button>
          {card.card}
        </>
      }
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
