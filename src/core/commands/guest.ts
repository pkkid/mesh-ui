/**
 * Guest network commands: `guest.get` (no password, only `hasPassword`),
 * `guest.share` (sensitive: the password and the `WIFI:` payload for the QR
 * code), and the writes: `guest.enable`, `guest.disable`, `guest.rename` and
 * `guest.password.set` (`null` makes it open). Every write but enable drops
 * the guests, so it is `disruptive`. No write ever returns or logs the
 * password. See docs/architecture/commands.md#guest-commandsguestts and
 * docs/ux/pages/guest.md.
 */

import { z } from "zod";
import { CommandError } from "../errors";
import type * as M from "../model";
import { POLL } from "../poll";
import { type AnyCommand, type CommandContext, defineCommand } from "../spec";

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

// ---------------------------------------------------------------------------
// Password and name rules (shared with the renderer's form and meter)

export const WIFI_PASSWORD = { min: 8, max: 63 } as const;
export const GUEST_NAME_MAX = 32;

/** 8 to 63 printable ASCII characters (space included), eero's rule for WPA passwords. Messages never echo the value. */
export const wifiPasswordSchema = z
  .string()
  .min(WIFI_PASSWORD.min, `Use at least ${WIFI_PASSWORD.min} characters.`)
  .max(WIFI_PASSWORD.max, `Use at most ${WIFI_PASSWORD.max} characters.`)
  .regex(/^[\x20-\x7e]*$/, "Use letters, digits, spaces and the symbols on a standard keyboard only.");

export const guestNameSchema = z
  .string()
  .trim()
  .min(1, "Enter a name.")
  .max(GUEST_NAME_MAX, `Use at most ${GUEST_NAME_MAX} characters.`);

export type PasswordStrength = { score: 0 | 1 | 2 | 3 | 4; label: "Too short" | "Weak" | "Fair" | "Good" | "Strong" };

/**
 * A rough strength from length and character classes (bits = length x
 * log2 of the classes' pool). Pure, for the strength meter; the schema is
 * the rule. A generated 16-character password reads Strong.
 */
export function passwordStrength(password: string): PasswordStrength {
  if (password.length < WIFI_PASSWORD.min) return { score: 0, label: "Too short" };
  let pool = 0;
  if (/[a-z]/.test(password)) pool += 26;
  if (/[A-Z]/.test(password)) pool += 26;
  if (/\d/.test(password)) pool += 10;
  if (/[^a-zA-Z\d]/.test(password)) pool += 33;
  const bits = password.length * Math.log2(Math.max(pool, 2));
  if (bits < 40) return { score: 1, label: "Weak" };
  if (bits < 60) return { score: 2, label: "Fair" };
  if (bits < 80) return { score: 3, label: "Good" };
  return { score: 4, label: "Strong" };
}

/** A guest network name must differ from the main SSID (case-insensitive, so nobody mixes them up). `bad_params` on `name`. */
async function checkName(ctx: CommandContext, name: string): Promise<void> {
  const main = (await ctx.backend.network.get(ctx.net)).name;
  if (main && main.trim().toLowerCase() === name.trim().toLowerCase()) {
    const message = "The guest network name must be different from your main network name.";
    throw new CommandError("bad_params", message, { issues: [{ path: "name", message }] });
  }
}

/** "4 guests are disconnected right away." from the guests online now. */
async function guestsDropped(ctx: CommandContext, then: string): Promise<string> {
  const g = await ctx.backend.guest.get(ctx.net);
  if (!g.enabled || g.online === 0) return g.enabled ? `No guests are online now. ${then}` : then;
  return `${g.online} ${g.online === 1 ? "guest is" : "guests are"} disconnected right away. ${then}`;
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

  defineCommand({
    id: "guest.enable",
    label: "Turn on guest network",
    description: "Turns the guest network on with its current name and password, on every eero.",
    icon: "power",
    params: z.object({}),
    effect: "write",
    invalidates: ["guest", "devices"],
    run: (ctx): Promise<M.GuestNetwork> => ctx.backend.guest.setEnabled(ctx.net, true),
  }),

  defineCommand({
    id: "guest.disable",
    label: "Turn off guest network",
    description: "Turns the guest network off. Every guest is disconnected at once.",
    icon: "power-off",
    params: z.object({}),
    effect: "disruptive",
    invalidates: ["guest", "devices"],
    confirmMessage: (ctx) => guestsDropped(ctx, "Guests cannot join until it is turned back on."),
    run: (ctx): Promise<M.GuestNetwork> => ctx.backend.guest.setEnabled(ctx.net, false),
  }),

  defineCommand({
    id: "guest.rename",
    label: "Rename guest network",
    description: "Changes the guest network's name (SSID). It must differ from the main network name. Guests are disconnected and must join the new name.",
    icon: "pencil",
    params: z.object({ name: guestNameSchema }),
    effect: "disruptive",
    invalidates: ["guest", "devices"],
    async confirmMessage(ctx, { name }) {
      await checkName(ctx, name);
      return guestsDropped(ctx, `Guests join "${name}" from now on.`);
    },
    async run(ctx, { name }): Promise<M.GuestNetwork> {
      await checkName(ctx, name);
      return ctx.backend.guest.rename(ctx.net, name);
    },
  }),

  defineCommand({
    id: "guest.password.set",
    label: "Set guest password",
    description:
      "Changes the guest network's password (8 to 63 printable ASCII characters), or makes it open with `null`, so anyone nearby can join. Guests are disconnected and need the new password. The result never holds the password.",
    icon: "key-round",
    params: z.object({ password: wifiPasswordSchema.nullable() }),
    effect: "disruptive",
    invalidates: ["guest", "devices"],
    confirmMessage: (ctx, { password }) =>
      password === null
        ? guestsDropped(ctx, "With no password the guest network is open: anyone nearby can join.")
        : guestsDropped(ctx, "Guests need the new password to join again."),
    run: (ctx, { password }): Promise<M.GuestNetwork> => ctx.backend.guest.setPassword(ctx.net, password),
  }),
];
