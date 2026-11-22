/**
 * Share Wi-Fi and Share guest: content sheets opened from the Overview hero
 * (docs/ux/pages/overview.md). Each shows one network's QR code, centred, in
 * the same frame as the Wi-Fi and Guest network headers (the plain dotted
 * code, 130px, a 1px rounded border with 15px of padding), and one button
 * under it: Copy password for the main network, Copy invite for the guest
 * network. No footer; the X and Esc close it.
 *
 * Opening one is the explicit ask, so it runs the sensitive `wifi.share` or
 * `guest.share` then, for the network on screen, and keeps the answer only
 * while it is open: closing it, or a network switch, drops the password.
 * Share guest shows only while the guest network is on.
 */
import { Copy, Share2 } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { execute, useQuery } from "~/app/useCommand";
import { Button, type ButtonProps } from "~/components/ui/button";
import { QrCode } from "~/components/ui/qr";
import { Sheet } from "~/components/ui/sheet";
import { inviteText } from "~/features/guest/GuestCard";
import { copyText } from "~/lib/clipboard";
import type { GuestNetwork, Network, WifiShare } from "../../../../core/model";

type ShareState = { value: WifiShare | null; error: string | null };

const DIM_ICON = "[&_svg]:text-muted-foreground";

/** Runs `id` while `open` (and again on a network switch), dropping the answer when it closes. */
function useShare(open: boolean, id: "wifi.share" | "guest.share", networkId: string | null): ShareState {
  const [state, setState] = useState<ShareState>({ value: null, error: null });
  const generation = useRef(0);
  useEffect(() => {
    generation.current += 1;
    setState({ value: null, error: null });
    if (!open || !networkId) return;
    const gen = generation.current;
    void execute<WifiShare>(id, id === "wifi.share" ? { networkId } : {}).then((res) => {
      if (gen !== generation.current) return; // closed or switched network meanwhile
      setState(res.ok ? { value: res.result, error: null } : { value: null, error: res.error.message });
    });
  }, [open, id, networkId]);
  return state;
}

/** The shared layout: the framed code, centred, with one action under it. */
function QrShareSheet({
  open,
  onClose,
  title,
  subtitle,
  ssid,
  state,
  action,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle: string;
  ssid: string | null;
  state: ShareState;
  action: ReactNode;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title} subtitle={subtitle}>
      <div className="flex flex-col items-center gap-4">
        {/* A 1px frame with 15px of padding around the plain code, as on the Wi-Fi and Guest network headers. */}
        <div className="rounded-xl border p-[15px]">
          <QrCode plain size={130} value={state.value?.qr ?? null} ariaLabel={ssid ? `QR code to join ${ssid}` : "Wi-Fi QR code"} />
        </div>
        {state.error ? <div className="text-destructive-foreground text-xs">Couldn't load the code</div> : null}
        {action}
      </div>
    </Sheet>
  );
}

export function ShareWifiSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const network = useQuery<Network>("network.get");
  const state = useShare(open, "wifi.share", network.data?.id ?? null);
  const share = state.value;
  const ssid = share?.ssid ?? network.data?.name ?? null;
  return (
    <QrShareSheet
      open={open}
      onClose={onClose}
      title="Share Wi-Fi"
      subtitle={ssid ? `Scan to join ${ssid}, or copy its password` : "Scan to join, or copy the password"}
      ssid={ssid}
      state={state}
      action={
        <Button
          type="button"
          variant="outline"
          className={DIM_ICON}
          disabled={!share?.password}
          title={share && share.password === null ? "This network has no password" : "Copies the Wi-Fi password"}
          onClick={() => share?.password && void copyText(share.password, { toast: "Copied password" })}
        >
          <Copy />
          Copy password
        </Button>
      }
    />
  );
}

export function ShareGuestSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const network = useQuery<Network>("network.get");
  const guest = useQuery<GuestNetwork>("guest.get");
  const state = useShare(open, "guest.share", network.data?.id ?? null);
  const share = state.value;
  const ssid = share?.ssid ?? guest.data?.name ?? null;
  return (
    <QrShareSheet
      open={open}
      onClose={onClose}
      title="Share guest network"
      subtitle={ssid ? `Scan to join ${ssid}, or copy an invite` : "Scan to join, or copy an invite"}
      ssid={ssid}
      state={state}
      action={
        <Button
          type="button"
          variant="outline"
          className={DIM_ICON}
          disabled={!share}
          title="Copies a short invite with the network name and password"
          onClick={() => share && void copyText(inviteText(share), { toast: "Invite copied" })}
        >
          <Copy />
          Copy invite
        </Button>
      }
    />
  );
}

/** The "Share Wi-Fi" button and its sheet, for a page header. */
export function ShareWifiButton(props: Omit<ButtonProps, "onClick" | "children">) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" {...props} onClick={() => setOpen(true)}>
        <Share2 />
        Share Wi-Fi
      </Button>
      <ShareWifiSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/** The "Share guest" button and its sheet; nothing while the guest network is off (or unknown). */
export function ShareGuestButton(props: Omit<ButtonProps, "onClick" | "children">) {
  const guest = useQuery<GuestNetwork>("guest.get");
  const [open, setOpen] = useState(false);
  if (guest.data?.enabled !== true) return null;
  return (
    <>
      <Button variant="outline" {...props} onClick={() => setOpen(true)}>
        <Share2 />
        Share guest
      </Button>
      <ShareGuestSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}
