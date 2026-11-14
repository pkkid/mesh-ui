/**
 * Wi-Fi commands (read side). `wifi.get` never carries the password; only
 * `wifi.password.get` and `wifi.share` read it, are `sensitive` (never
 * cached, masked by the CLI) and run only on an explicit reveal or share.
 * The `WIFI:` payload comes from `wifiShare` in ./guest.ts, shared with `guest.share`.
 * `wifi.password.generate` makes a password in core and saves nothing.
 *
 * Writes (M4.7): `wifi.name.set`, `wifi.password.set`, `wifi.security.set`
 * and `wifi.hide5g.set` are all disruptive. Their `needs_confirm` message is
 * the `wifi.impact` summary, so every surface reads who drops before saying
 * yes. A new password is a param only: no result carries it, and the audit
 * log removes it.
 * See docs/architecture/commands.md#wifi-commandswifits.
 */

import { z } from "zod";
import type * as M from "../model";
import { POLL } from "../poll";
import { CommandError } from "../errors";
import { type AnyCommand, type CommandContext, defineCommand } from "../spec";
import { WIFI_PASSWORD, wifiPasswordSchema, wifiShare } from "./guest";

export { WIFI_PASSWORD };

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

// ---------------------------------------------------------------------------
// Writes: rules and impact

/** eero allows a 32 byte SSID; count bytes, not characters. */
export const SSID_MAX_BYTES = 32;
export const ssidBytes = (s: string) => new TextEncoder().encode(s).length;


/**
 * Outage estimate when eero restarts the mesh to apply a security change
 * (`wpa3_per_band` is in the restart list of docs/eero-api/endpoints.md).
 * Same copy as a network restart; unverified on a real network (MANUAL).
 */
export const SECURITY_RESTART_ESTIMATE = "about 2 to 3 minutes";

export type WifiChange = "name" | "password" | "security" | "hide5g";
export type SecurityBand = "band24" | "band5";
const BAND_OF: Record<SecurityBand, M.WirelessBand> = { band24: "2.4", band5: "5" };

export type ImpactDevice = { id: M.Id; name: string; band: M.WirelessBand | null; category: M.DeviceCategory };

/** What a Wi-Fi change does to the devices on it. docs/ux/pages/wifi.md (Impact of saving). */
export type WifiImpact = {
  change: WifiChange;
  /** Connected wireless devices that drop and must rejoin. */
  reconnect: ImpactDevice[];
  /** Devices that cannot rejoin afterwards: WPA2 only devices on a band moving to WPA3. */
  drop: ImpactDevice[];
  /** Estimate: of `reconnect`, smart home devices, which usually rejoin from their own app, not a phone's Wi-Fi list. */
  needsSetup: ImpactDevice[];
  guestAffected: boolean;
  wiredAffected: boolean;
  /** Outage estimate when eeros restart to apply the change, else null. */
  restart: string | null;
  /** One or two sentences for the confirm, the impact panel and the CLI. */
  summary: string;
};

const impactDevice = (d: M.Device): ImpactDevice => ({ id: d.id, name: d.name, band: d.band === "wired" ? null : d.band, category: d.category });
const isWireless = (d: M.Device) => d.connected && d.band !== null && d.band !== "wired";
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The bands a security change touches and the mode it moves them to. Bands no eero has are bad_params. */
function securityTarget(wifi: M.WifiSettings, p: { band24?: M.Security; band5?: M.Security }): [M.WirelessBand, M.Security][] {
  const out: [M.WirelessBand, M.Security][] = [];
  for (const key of ["band24", "band5"] as const) {
    const next = p[key];
    if (!next) continue;
    const band = BAND_OF[key];
    if (wifi.security[band] === null) throw new CommandError("bad_params", `This network has no ${band} GHz radio.`);
    out.push([band, next]);
  }
  if (!out.length) throw new CommandError("bad_params", "Give band24, band5 or both.");
  return out;
}

/** Pure: the impact of one change, from wifi.get and the device list. */
export function wifiImpact(
  wifi: M.WifiSettings,
  devices: M.Device[],
  change: WifiChange,
  security: [M.WirelessBand, M.Security][] = [],
): WifiImpact {
  const wireless = devices.filter(isWireless);
  const main = wireless.filter((d) => d.ssid !== "guest");
  const wpa2Only = new Set(wifi.wpa2OnlyDevices);
  let reconnect: M.Device[] = [];
  let drop: M.Device[] = [];
  let guestAffected = false;
  let wiredAffected = false;
  let restart: string | null = null;
  let summary: string;

  if (change === "name" || change === "password") {
    reconnect = main;
    summary = `${plural(reconnect.length, "wireless device")} ${reconnect.length === 1 ? "drops" : "drop"} and must rejoin with the new ${change}.`;
  } else if (change === "hide5g") {
    reconnect = wireless.filter((d) => d.band === "5" || d.band === "6");
    guestAffected = reconnect.some((d) => d.ssid === "guest");
    summary = `${plural(reconnect.length, "device")} on 5 and 6 GHz ${reconnect.length === 1 ? "moves" : "move"} to 2.4 GHz until it turns off.`;
  } else {
    const changed = security.filter(([band, mode]) => wifi.security[band] !== mode);
    const toWpa3 = new Set(changed.filter(([, mode]) => mode === "WPA3").map(([band]) => band));
    if (changed.length) {
      // eero restarts the mesh to apply it: every client drops for a while.
      reconnect = wireless;
      guestAffected = true;
      wiredAffected = true;
      restart = SECURITY_RESTART_ESTIMATE;
      drop = main.filter((d) => wpa2Only.has(d.id) && d.band !== null && d.band !== "wired" && toWpa3.has(d.band));
    }
    summary = !changed.length
      ? "Nothing changes."
      : `Every device drops while eeros restart to apply it, ${restart}.${drop.length ? ` ${plural(drop.length, "device")} only ${drop.length === 1 ? "speaks" : "speak"} WPA2 and will not rejoin.` : ""}`;
  }

  const needsSetup = change === "name" || change === "password" ? reconnect.filter((d) => d.category === "smart_home") : [];
  if (needsSetup.length) summary += ` ${plural(needsSetup.length, "smart home device")} may need ${needsSetup.length === 1 ? "its" : "their"} own app to rejoin.`;
  if (change === "name" || change === "password") summary += " Wired devices and the guest network are not affected.";
  return {
    change,
    reconnect: reconnect.map(impactDevice),
    drop: drop.map(impactDevice),
    needsSetup: needsSetup.map(impactDevice),
    guestAffected,
    wiredAffected,
    restart,
    summary,
  };
}

async function impactFor(ctx: CommandContext, change: WifiChange, security?: { band24?: M.Security; band5?: M.Security }): Promise<WifiImpact> {
  const [wifi, devices] = await Promise.all([ctx.backend.wifi.get(ctx.net), ctx.backend.device.list(ctx.net)]);
  return wifiImpact(wifi, devices, change, security ? securityTarget(wifi, security) : []);
}

/** The main SSID must differ from the guest network's, or devices could not tell them apart. */
async function checkName(ctx: CommandContext, name: string): Promise<void> {
  const guest = await ctx.backend.guest.get(ctx.net);
  if (guest.name !== null && guest.name === name) throw new CommandError("bad_params", "The Wi-Fi name must differ from the guest network's name.");
}

const securityEnum = z.enum(["WPA2", "WPA2_WPA3", "WPA3"]);

const nameParams = z.object({
  name: z
    .string()
    .refine((s) => s.trim().length > 0, "The Wi-Fi name can not be empty.")
    .refine((s) => ssidBytes(s) <= SSID_MAX_BYTES, `The Wi-Fi name is ${SSID_MAX_BYTES} bytes at most (some characters take more than one).`)
    .describe(`The new network name (SSID), 1 to ${SSID_MAX_BYTES} bytes in UTF-8.`),
});

const passwordParams = z.object({
  // Same rule and messages as guest.password.set (commands/guest.ts).
  password: wifiPasswordSchema.describe(`The new password, ${WIFI_PASSWORD.min} to ${WIFI_PASSWORD.max} printable ASCII characters.`),
});

const securityParams = z.object({
  band24: securityEnum.optional().describe("2.4 GHz mode: WPA2, WPA2_WPA3 (hybrid) or WPA3."),
  band5: securityEnum.optional().describe("5 GHz mode: WPA2, WPA2_WPA3 (hybrid) or WPA3."),
  band6: z.literal("WPA3", { error: "6 GHz always uses WPA3." }).optional().describe("6 GHz is always WPA3; only WPA3 is accepted, and nothing is sent."),
});

const hide5gParams = z.object({
  enabled: z.boolean().describe("true hides 5 and 6 GHz so 2.4 GHz only devices can join; eero turns it off on its own. false turns it off now."),
});

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
  defineCommand({
    id: "wifi.impact",
    label: "Impact of a Wi-Fi change",
    description:
      "Who a Wi-Fi change affects before it is saved: wireless devices that must rejoin, WPA2 only devices that would drop on a move to WPA3, smart home devices that may need their own app, and the restart estimate. Changes nothing.",
    icon: "triangle-alert",
    params: z.object({
      change: z.enum(["name", "password", "security", "hide5g"]).describe("The change to assess."),
      band24: securityEnum.optional().describe("Security only: the mode 2.4 GHz moves to."),
      band5: securityEnum.optional().describe("Security only: the mode 5 GHz moves to."),
    }),
    effect: "query",
    topic: "settings",
    run: async (ctx, p): Promise<WifiImpact> => {
      if (p.change !== "security") {
        if (p.band24 || p.band5) throw new CommandError("bad_params", "band24 and band5 apply to a security change only.");
        return impactFor(ctx, p.change);
      }
      return impactFor(ctx, "security", p);
    },
  }),
  defineCommand({
    id: "wifi.name.set",
    label: "Rename Wi-Fi",
    description: "Renames the main Wi-Fi network (SSID). Every wireless device drops and must rejoin under the new name; wired devices and the guest network stay up.",
    icon: "pencil",
    params: nameParams,
    effect: "disruptive",
    invalidates: ["settings", "network"],
    confirmMessage: async (ctx, p) => {
      await checkName(ctx, p.name);
      return `The Wi-Fi becomes "${p.name}". ${(await impactFor(ctx, "name")).summary}`;
    },
    run: async (ctx, p): Promise<M.WifiSettings> => {
      await checkName(ctx, p.name);
      return ctx.backend.wifi.setName(ctx.net, p.name);
    },
  }),
  defineCommand({
    id: "wifi.password.set",
    label: "Change Wi-Fi password",
    description:
      "Sets a new password on the main Wi-Fi network. Every wireless device drops and must rejoin with it. The main network can not be made open. The result never holds the password.",
    icon: "key-round",
    params: passwordParams,
    effect: "disruptive",
    invalidates: ["settings"],
    confirmMessage: async (ctx) => (await impactFor(ctx, "password")).summary,
    run: (ctx, p): Promise<M.WifiSettings> => ctx.backend.wifi.setPassword(ctx.net, p.password),
  }),
  defineCommand({
    id: "wifi.security.set",
    label: "Change Wi-Fi security",
    description:
      "Sets WPA2, hybrid (WPA2 + WPA3) or WPA3 on 2.4 and 5 GHz; 6 GHz is always WPA3. eero restarts to apply it, so every device drops for a few minutes, and WPA2 only devices can not rejoin a WPA3 band.",
    icon: "shield-check",
    params: securityParams,
    effect: "disruptive",
    invalidates: ["settings", "guest"],
    confirmMessage: async (ctx, p) => (await impactFor(ctx, "security", p)).summary,
    run: async (ctx, p): Promise<M.WifiSettings> => {
      const wifi = await ctx.backend.wifi.get(ctx.net);
      const target = securityTarget(wifi, p);
      return ctx.backend.wifi.setSecurity(ctx.net, Object.fromEntries(target));
    },
  }),
  defineCommand({
    id: "wifi.hide5g.set",
    label: "Connect 2.4 GHz only devices",
    description:
      "Hides 5 and 6 GHz for a while so a device that only speaks 2.4 GHz can join; devices on 5 and 6 GHz move to 2.4 GHz meanwhile. eero turns it off on its own (hide5g.expiresAt); enabled false turns it off now.",
    icon: "radio",
    params: hide5gParams,
    effect: "disruptive",
    invalidates: ["settings", "devices"],
    confirmMessage: async (ctx, p) =>
      p.enabled ? `5 and 6 GHz are hidden for a while. ${(await impactFor(ctx, "hide5g")).summary}` : "5 and 6 GHz come back, and devices move back to them on their own.",
    run: (ctx, p): Promise<M.WifiSettings> => ctx.backend.wifi.setHide5g(ctx.net, p.enabled),
  }),
];
