/**
 * Print a card and Send to a guest (docs/ux/pages/guest.md, Actions).
 *
 * The card is print-only: while a print is pending it is portalled to the
 * end of `<body>`, hidden on screen, and the print stylesheet hides
 * everything else, so the window's own print (Electron's print dialog)
 * prints just the card: name, password and the QR code. It goes away on
 * `afterprint`. The password lives only in this component's state for that
 * moment, never in the query cache.
 *
 * Paper is white whatever the theme, so the card uses black on white like
 * the QR tile does, not the theme tokens.
 */
import { Ticket } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { QrCode } from "~/components/ui/qr";
import type { WifiShare } from "../../../../core/model";

export const PRINT_CARD_ID = "guest-print-card";

/** Everything but the card disappears from the printout. */
const PRINT_CSS = `@media print { body > :not(#${PRINT_CARD_ID}) { display: none !important; } @page { margin: 16mm; } }`;

/** The short invite Send to a guest copies: name and password, or that no password is needed. */
export function inviteText(share: Pick<WifiShare, "ssid" | "password">): string {
  return share.password
    ? `Join our guest Wi-Fi.\nNetwork: ${share.ssid}\nPassword: ${share.password}`
    : `Join our guest Wi-Fi.\nNetwork: ${share.ssid}\nNo password needed.`;
}

/** `print(share)` renders the card and opens the print dialog; render `card` anywhere. */
export function useGuestCardPrint(): { print: (share: WifiShare) => void; card: ReactNode } {
  const [share, setShare] = useState<WifiShare | null>(null);

  useEffect(() => {
    if (!share) return;
    const done = () => setShare(null);
    window.addEventListener("afterprint", done, { once: true });
    // One frame so the card is in the DOM before the dialog snapshots the page.
    const frame = requestAnimationFrame(() => window.print());
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("afterprint", done);
    };
  }, [share]);

  const print = useCallback((next: WifiShare) => setShare(next), []);
  return { print, card: share ? createPortal(<GuestCard share={share} />, document.body) : null };
}

export function GuestCard({ share }: { share: WifiShare }) {
  return (
    <div id={PRINT_CARD_ID} className="hidden print:block" data-slot="guest-print-card">
      <style>{PRINT_CSS}</style>
      <div className="mx-auto flex w-[22rem] flex-col items-center gap-5 rounded-2xl border-2 border-black bg-white p-8 text-center text-black">
        <div className="flex items-center gap-2 font-semibold text-base uppercase tracking-widest">
          <Ticket className="size-5" />
          Guest Wi-Fi
        </div>
        <QrCode value={share.qr} ariaLabel={`QR code to join ${share.ssid}`} size={200} className="rounded-none border-0" />
        <div className="text-sm">Scan with your phone camera to join.</div>
        <dl className="flex w-full flex-col gap-3 text-left">
          <div>
            <dt className="text-xs uppercase tracking-widest">Network</dt>
            <dd className="break-words font-semibold text-xl">{share.ssid}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-widest">Password</dt>
            <dd className="break-all font-mono font-semibold text-xl">{share.password ?? "No password needed"}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
