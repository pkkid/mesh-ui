/**
 * Guest network hero: the flat page header (no icon tile, like the other
 * list pages) with the guest network name, its status, and while on three facts (Online now, Recently
 * left, Data in 24 hours). Actions: Turn on
 * (`guest.enable`, the filled primary button) or Turn off… (`guest.disable`,
 * outline, behind the confirm dialog), then Copy invite while it is on (its
 * place, after Turn off, is the maintainer's choice over the disruptive-last
 * rule). While it is on, the plain QR code is the right-hand column.
 * docs/ux/pages/guest.md (Layout 1).
 *
 * The QR payload comes from `guest.share`, which reveals the password. It is
 * run when the hero mounts and again after a name or password change (and
 * for Copy invite), held only in this component, never in
 * the shared query cache and never polled.
 */
import { Copy, Power } from "lucide-react";
import { useEffect } from "react";

import { useCommand, useQuery } from "~/app/useCommand";
import { useWrite } from "~/app/useWrite";
import { Metric, PageHeader } from "~/components/ui/hero";
import { GatedButton, useGate, useNow } from "~/components/ui/page";
import { Button } from "~/components/ui/button";
import { QrCode } from "~/components/ui/qr";
import { copyText } from "~/lib/clipboard";
import { Status } from "~/components/ui/status";
import { cn } from "~/lib/utils";
import { formatBytes, formatCount, formatPercent, formatRelative } from "../../../../core/format";
import type { DeviceList, GuestNetwork, UsageSeries, WifiShare } from "../../../../core/model";
import { inviteText } from "./GuestCard";

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
  /** Network time zone, for "3d ago". */
  timezone?: string | null;
};

export function GuestHero({ guest, networkName, unavailable, offline = false, fading = false, shareVersion = 0, timezone = null }: GuestHeroProps) {
  const on = guest?.enabled === true && !unavailable;
  const title = guest ? (guest.name ?? (networkName ? `${networkName} Guest` : "Guest network")) : "-";

  return (
    <PageHeader
      flat
      data-slot="guest-hero"
      className={cn("transition-opacity", fading && "opacity-40")}
      title={title}
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
                  ? "Broadcast on all eeros"
                  : "Guests cannot join while it is off"}
            </span>
            {on && !guest.hasPassword && <Status tone="warning">Open, no password</Status>}
          </>
        ) : null
      }
      facts={on ? <GuestFacts timezone={timezone} /> : undefined}
      actions={
        guest && !unavailable ? (
          <>
            <PowerButton on={on} />
            {on && <CopyInviteButton />}
          </>
        ) : null
      }
      aside={on && guest ? <ShareBlock guest={guest} version={shareVersion} /> : null}
    />
  );
}

/**
 * The hero facts while the guest network is on: Online now, Recently left
 * (guests seen this week who are gone, with when the latest left) and Data in
 * 24 hours (with its share of all traffic). The same queries as Guest devices
 * and Guest usage, so they share the cache and make no extra eero calls.
 */
function GuestFacts({ timezone }: { timezone: string | null }) {
  const devices = useQuery<DeviceList>("device.list", { ssid: "guest" }, { poll: true });
  const usage = useQuery<UsageSeries>("usage.get", { scope: "guest", range: "day" }, { poll: true });
  const network = useQuery<UsageSeries>("usage.get", { scope: "network", range: "day" }, { poll: true });
  const now = useNow();

  const all = devices.data?.devices;
  const online = all?.filter((d) => d.connected).length;
  const left = all?.filter((d) => !d.connected) ?? [];
  const latestLeft = left.map((d) => d.lastActive).filter((a): a is string => !!a).sort().at(-1);
  const total = usage.data ? usage.data.total.down + usage.data.total.up : null;
  const all24 = network.data ? network.data.total.down + network.data.total.up : null;
  const share = total !== null && total > 0 && all24 ? (total / all24) * 100 : null;
  const muted = (text: string) => <span className="font-normal text-muted-foreground text-xs"> · {text}</span>;

  return (
    <>
      <Metric label="Online now" value={online === undefined ? null : formatCount(online)} />
      <Metric
        label="Recently left"
        value={all === undefined ? null : <>{formatCount(left.length)}{latestLeft ? muted(`latest ${formatRelative(latestLeft, now, timezone ?? "UTC")}`) : null}</>}
      />
      <Metric
        label="Data in 24 hours"
        value={total === null ? null : <>{formatBytes(total)}{share !== null ? muted(`${share < 1 ? "under 1%" : formatPercent(share)} of all traffic`) : null}</>}
      />
    </>
  );
}

/**
 * Copy invite: reads `guest.share` on click (so the password is never kept)
 * and copies a short invite with the name and password, or that none is
 * needed. An outline hero button with a dim icon, after Turn off.
 */
function CopyInviteButton() {
  const share = useCommand<Record<string, never>, WifiShare>("guest.share");
  return (
    <Button
      variant="outline"
      disabled={share.running}
      title="Copies a short invite with the network name and password"
      onClick={async () => {
        const res = await share.run();
        if (res.ok) await copyText(inviteText(res.result), { toast: "Invite copied" });
      }}
    >
      <Copy />
      Copy invite
    </Button>
  );
}

/** Turn on (a plain write with Undo) or off (disruptive, so it ends in an ellipsis: the confirm dialog with the guests it drops, then a progress toast). */
export function PowerButton({ on }: { on: boolean }) {
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
    // Turning it on is the one bold step on an off page, so it is the filled primary button (design-system.md, Buttons).
    <GatedButton
      gate={gate}
      variant={on ? "outline" : "default"}
      disabled={write.running}
      onClick={() => void write.run()}
    >
      <Power />
      {on ? "Turn off guest network\u2026" : "Turn on guest network"}
    </GatedButton>
  );
}

/**
 * The plain QR code of an on guest network, 130px, in a 1px rounded frame
 * with 15px of padding, with no caption (only "Couldn't load the code" when
 * the share fails).
 * Re-reads the share when the name or password state changes, or
 * after a password change (`version`).
 */
function ShareBlock({ guest, version }: { guest: GuestNetwork; version: number }) {
  const share = useCommand<Record<string, never>, WifiShare>("guest.share");
  const { run, reset } = share;
  useEffect(() => {
    void run();
    return reset;
  }, [run, reset, guest.name, guest.hasPassword, version]);

  const ssid = share.result?.ssid ?? guest.name ?? "the guest network";

  return (
    <div className="flex flex-col items-center gap-1.5">
      {/* A 1px frame with 15px of padding around the plain code. */}
      <div className="rounded-xl border p-[15px]">
        <QrCode plain size={130} value={share.result?.qr} ariaLabel={`QR code to join ${ssid}`} />
      </div>
      {share.error ? <div className="text-muted-foreground text-xs">Couldn't load the code</div> : null}
    </div>
  );
}
