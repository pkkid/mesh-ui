/**
 * Wi-Fi commands (read side). `wifi.get` never carries the password; only
 * `wifi.password.get` and `wifi.share` read it, are `sensitive` (never
 * cached, masked by the CLI) and run only on an explicit reveal or share.
 * The `WIFI:` payload comes from `wifiShare` in ./guest.ts, shared with `guest.share`.
 * See docs/architecture/commands.md#wifi-commandswifits.
 */

import { z } from "zod";
import type * as M from "../model";
import { POLL } from "../poll";
import { type AnyCommand, defineCommand } from "../spec";
import { wifiShare } from "./guest";

export type WifiPassword = { ssid: string; password: string | null };

export const commands: AnyCommand[] = [
  defineCommand({
    id: "wifi.get",
    label: "Wi-Fi",
    description: "The main Wi-Fi network: name, security per band, each band with its clients, widths and channels, and the 2.4 GHz only flag with its expiry. No password.",
    icon: "wifi",
    params: z.object({}),
    effect: "query",
    topic: "settings",
    poll: POLL.network,
    run: (ctx): Promise<M.WifiSettings> => ctx.backend.wifi.get(ctx.net),
  }),
  defineCommand({
    id: "wifi.password.get",
    label: "Reveal Wi-Fi password",
    description: "The main Wi-Fi network's password, in the clear. Run only when the person asks to see or copy it.",
    icon: "key-round",
    params: z.object({}),
    effect: "query",
    sensitive: true,
    run: async (ctx): Promise<WifiPassword> => {
      const { ssid, password } = await ctx.backend.wifi.credentials(ctx.net);
      return { ssid, password };
    },
  }),
  defineCommand({
    id: "wifi.share",
    label: "Share Wi-Fi",
    description: "The main Wi-Fi network's name, password and the `WIFI:` QR payload phones join from. Run only when the person asks to share it.",
    icon: "qr-code",
    params: z.object({}),
    effect: "query",
    sensitive: true,
    run: async (ctx): Promise<M.WifiShare> => {
      const { ssid, password } = await ctx.backend.wifi.credentials(ctx.net);
      return wifiShare(ssid, password);
    },
  }),
];
