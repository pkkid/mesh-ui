/**
 * Share Wi-Fi: one sheet with the main network's QR code, Copy password and
 * Save QR, opened from the Overview hero and the Devices titlebar
 * (docs/ux/pages/overview.md, devices.md). Opening it is the explicit ask,
 * so it runs the sensitive `wifi.share` then, for the network on screen,
 * and keeps the answer only while it is open: closing it, or a network
 * switch, drops the password.
 */
import { Share2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { execute, useQuery } from "~/app/useCommand";
import { Button, type ButtonProps } from "~/components/ui/button";
import { QrBlock } from "~/components/ui/qr";
import { Sheet } from "~/components/ui/sheet";
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
  // Content only: no footer; the X and Esc close it.
  return (
    <Sheet open={open} onClose={onClose} title="Share Wi-Fi" subtitle={ssid ? `Scan to join ${ssid}, or copy its password` : "Scan to join, or copy the password"} error={state.error}>
      <div className="flex justify-center">
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
    </Sheet>
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
