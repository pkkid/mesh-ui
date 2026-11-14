/**
 * Wi-Fi commands (read side). `wifi.get` never carries the password; only
 * `wifi.password.get` and `wifi.share` read it, are `sensitive` (never
 * cached, masked by the CLI) and run only on an explicit reveal or share.
 * The `WIFI:` payload comes from `wifiShare` in ./guest.ts, shared with `guest.share`.
 * `wifi.password.generate` makes a password in core and saves nothing.
 * See docs/architecture/commands.md#wifi-commandswifits.
 */

import { z } from "zod";
import type * as M from "../model";
import { POLL } from "../poll";
import { type AnyCommand, defineCommand } from "../spec";
import { wifiShare } from "./guest";

export type WifiPassword = { ssid: string; password: string | null };
export type GeneratedPassword = { password: string };

/** Letters and digits without look-alikes (0 O o, 1 I l i): easy to read off a card and type on a TV. */
export const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
export const PASSWORD_LENGTH = { min: 12, max: 63, default: 16 } as const;

/** One unbiased index in [0, n) from the crypto RNG (rejection sampling). */
function randomIndex(n: number): number {
  const limit = Math.floor(0x1_0000_0000 / n) * n;
  const buf = new Uint32Array(1);
  for (;;) {
    globalThis.crypto.getRandomValues(buf);
    const x = buf[0] ?? 0;
    if (x < limit) return x % n;
  }
}

/**
 * A random Wi-Fi password from PASSWORD_ALPHABET with at least one upper
 * case letter, one lower case letter and one digit. Pure core, no eero call.
 */
export function generatePassword(length: number = PASSWORD_LENGTH.default): string {
  for (;;) {
    let out = "";
    for (let i = 0; i < length; i++) out += PASSWORD_ALPHABET[randomIndex(PASSWORD_ALPHABET.length)];
    if (/[A-Z]/.test(out) && /[a-z]/.test(out) && /\d/.test(out)) return out;
  }
}

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
  defineCommand({
    id: "wifi.password.generate",
    label: "Generate password",
    description: `A random password (letters and digits, no look-alike characters), ${PASSWORD_LENGTH.default} characters unless \`length\` says otherwise. Saves nothing: set it with wifi.password.set or guest.password.set.`,
    icon: "dices",
    params: z.object({
      length: z.number().int().min(PASSWORD_LENGTH.min).max(PASSWORD_LENGTH.max).optional().describe(`Characters, ${PASSWORD_LENGTH.min} to ${PASSWORD_LENGTH.max}. Default ${PASSWORD_LENGTH.default}.`),
    }),
    effect: "query",
    scope: "app",
    run: async (_ctx, { length }): Promise<GeneratedPassword> => ({ password: generatePassword(length) }),
  }),
];
