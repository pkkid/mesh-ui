/**
 * Guest network commands (read side): `guest.get` (no password, only
 * `hasPassword`) and `guest.share` (sensitive: the password and the `WIFI:`
 * payload for the QR code). Turning the guest network on or off, renaming it
 * and changing its password come later. See
 * docs/architecture/commands.md#guest-commandsguestts and
 * docs/ux/pages/guest.md.
 */

import { z } from "zod";
import { CommandError } from "../errors";
import type * as M from "../model";
import { POLL } from "../poll";
import { type AnyCommand, defineCommand } from "../spec";

/** Escapes one `WIFI:` field: `\`, `;`, `,`, `:` and `"` take a backslash (the ZXing format every phone camera reads). */
export function wifiEscape(s: string): string {
  return s.replace(/[\\;,:"]/g, (c) => `\\${c}`);
}

/** The `WIFI:` string a phone camera joins from: WPA with a password, `nopass` for an open network. */
export function wifiPayload(ssid: string, password: string | null): string {
  return password ? `WIFI:T:WPA;S:${wifiEscape(ssid)};P:${wifiEscape(password)};;` : `WIFI:T:nopass;S:${wifiEscape(ssid)};;`;
}

/** A `WifiShare` from a name and password. Shared with the Wi-Fi page's `wifi.share`. */
export function wifiShare(ssid: string, password: string | null): M.WifiShare {
  return { ssid, password, security: password ? "WPA" : "nopass", qr: wifiPayload(ssid, password) };
}

export const commands: AnyCommand[] = [
  defineCommand({
    id: "guest.get",
    label: "Guest network",
    description:
      "The guest network: on or off, its name, whether it has a password (never the password itself), security per band (the main network's), guests online now and every device seen on it in the last 7 days.",
    icon: "ticket",
    params: z.object({}),
    effect: "query",
    topic: "guest",
    poll: POLL.devices,
    run: (ctx): Promise<M.GuestNetwork> => ctx.backend.guest.get(ctx.net),
  }),

  defineCommand({
    id: "guest.share",
    label: "Share guest Wi-Fi",
    description:
      "The guest network's name and password (null when open), with the `WIFI:` string a phone camera joins from, for a QR code. Reveals the password: run it only when someone asks to share or copy it, never on a poll.",
    icon: "qr-code",
    params: z.object({}),
    effect: "query",
    sensitive: true,
    async run(ctx): Promise<M.WifiShare> {
      const { ssid, password } = await ctx.backend.guest.credentials(ctx.net);
      if (!ssid) throw new CommandError("eero_error", "The guest network has no name yet, so there is nothing to share.");
      return wifiShare(ssid, password);
    },
  }),
];
