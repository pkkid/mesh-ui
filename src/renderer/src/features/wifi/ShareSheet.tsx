/**
 * Share Wi-Fi: one sheet with the main network's QR code, Copy password and
 * Save QR, opened from the Overview hero and the Devices titlebar
 * (docs/ux/pages/overview.md, devices.md). Opening it is the explicit ask,
 * so it runs the sensitive `wifi.share` then, for the network on screen,
 * and keeps the answer only while it is open: closing it, or a network
 * switch, drops the password.
 */
import { Share2, Wifi, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { execute, useQuery } from "~/app/useCommand";
import { Button, type ButtonProps } from "~/components/ui/button";
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from "~/components/ui/dialog";
import { QrBlock } from "~/components/ui/qr";
import type { Network, WifiShare } from "../../../../core/model";

type ShareState = { value: WifiShare | null; error: string | null };

export function ShareWifiSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const network = useQuery<Network>("network.get");
  const networkId = network.data?.id ?? null;
  const [state, setState] = useState<ShareState>({ value: null, error: null });
  const generation = useRef(0);

  useEffect(() => {
    generation.current += 1;
    setState({ value: null, error: null });
    if (!open || !networkId) return;
    const gen = generation.current;
    void execute<WifiShare>("wifi.share", { networkId }).then((res) => {
      if (gen !== generation.current) return; // closed or switched network meanwhile
      setState(res.ok ? { value: res.result, error: null } : { value: null, error: res.error.message });
    });
  }, [open, networkId]);

  const share = state.value;
  const ssid = share?.ssid ?? network.data?.name ?? null;
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogPopup showCloseButton={false} className="w-full max-w-[440px] rounded-[18px]" data-slot="sheet">
        <div className="flex items-start gap-3 border-b px-5 py-4">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted text-muted-foreground [&_svg]:size-4">
            <Wifi />
          </span>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-base">Share Wi-Fi</DialogTitle>
            <DialogDescription className="text-xs">
              {ssid ? `Scan to join ${ssid}, or copy its password` : "Scan to join, or copy the password"}
            </DialogDescription>
          </div>
          <Button type="button" size="icon-sm" variant="ghost-muted" aria-label="Close" onClick={onClose}>
            <XIcon />
          </Button>
        </div>
        <div className="flex justify-center px-5 py-5">
          <QrBlock
            value={share?.qr ?? null}
            size={156}
            ariaLabel={ssid ? `QR code to join ${ssid}` : "Wi-Fi QR code"}
            caption={state.error ? <span className="text-destructive-foreground">Couldn't load the code</span> : (ssid ?? "Wi-Fi Network")}
            copyLabel={share?.password === null ? undefined : "Copy password"}
            copyText={share?.password ?? ""}
            fileName={`${ssid ?? "Wi-Fi"} QR.png`}
          />
        </div>
        {state.error && <div className="px-5 pb-4 text-destructive-foreground text-xs">{state.error}</div>}
      </DialogPopup>
    </Dialog>
  );
}

/** The "Share Wi-Fi" button and its sheet, for a page header or the titlebar. */
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
