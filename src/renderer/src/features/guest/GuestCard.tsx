/**
 * The short invite Copy invite puts on the clipboard (docs/ux/pages/guest.md,
 * Actions). The printed card that used to live here was dropped with the
 * Print a card buttons on Guest network and Wi-Fi network (2026-11-20).
 */
import type { WifiShare } from "../../../../core/model";

/** The short invite Copy invite copies: name and password, or that no password is needed. */
export function inviteText(share: Pick<WifiShare, "ssid" | "password">): string {
  return share.password
    ? `Join our guest Wi-Fi.\nNetwork: ${share.ssid}\nPassword: ${share.password}`
    : `Join our guest Wi-Fi.\nNetwork: ${share.ssid}\nNo password needed.`;
}
