/**
 * Network settings commands: `settings.get`, every network-wide setting the
 * Advanced networking page shows, with Thread but never its secrets, and
 * `settings.impact`, what a change restarts and who drops, from IMPACT (the
 * one table of restart estimates every confirm, panel and result quotes).
 * The writes themselves land with M5.2 and M5.3. See
 * docs/architecture/commands.md#settings-commandssettingsts and
 * #restart-estimates, and docs/ux/pages/advanced-networking.md.
 */

import { z } from "zod";
import { CommandError } from "../errors";
import type * as M from "../model";
import { type AnyCommand, type CommandContext, defineCommand } from "../spec";
import { RESTART_ESTIMATE } from "./network";

/** Drops anything secret-looking a backend might add to Thread, so the result is safe to cache, log and show. */
function withoutSecrets(s: M.NetworkSettings): M.NetworkSettings {
  if (!s.thread) return s;
  const { enabled, credentialSync, name, channel, panId, xpanId, borderAgent, devices } = s.thread;
  return { ...s, thread: { enabled, credentialSync, name, channel, panId, xpanId, borderAgent, devices } };
}

// ---------------------------------------------------------------------------
// Impact

/** eero rebuilds the mesh after a `PUT {net}/settings` that touches routing (FF field report). */
export const SETTINGS_RESTART_ESTIMATE = "about 8 minutes";
/** A firmware install restarts every eero once it has the image (eero app copy). */
export const UPDATE_RESTART_ESTIMATE = "about 10 minutes";

type ImpactRule = {
  restarts: boolean;
  estimate: string | null;
  /** Upper bound in minutes, to pick the longest of several changes. */
  minutes: number;
  drops: M.ImpactDrops;
  /** What happens, without the device count (added in core). */
  what: string;
};

const restart = (what: string, estimate: string, minutes: number): ImpactRule => ({ restarts: true, estimate, minutes, drops: "all", what });
const quiet = (what: string, drops: M.ImpactDrops = "none"): ImpactRule => ({ restarts: false, estimate: null, minutes: 0, drops, what });

/**
 * Every write whose impact `settings.impact` can tell, by command id
 * (docs/architecture/commands.md#restart-estimates). Wave 2 stories add a row
 * when they add a write; a disruptive write with no row is a test failure.
 */
export const IMPACT: Readonly<Record<string, ImpactRule>> = {
  "settings.dns.set": restart("Every eero restarts to apply the new DNS", SETTINGS_RESTART_ESTIMATE, 8),
  "settings.dhcp.set": restart("Every eero restarts to apply the new DHCP range, and devices get new addresses", SETTINGS_RESTART_ESTIMATE, 8),
  "settings.ipv6.set": restart("Every eero restarts to apply the IPv6 change", SETTINGS_RESTART_ESTIMATE, 8),
  "settings.wan.set": restart("Every eero restarts to reconnect to your ISP; wrong values keep the network offline", SETTINGS_RESTART_ESTIMATE, 8),
  "settings.connection_mode.set": restart("Every eero restarts in the new connection mode", SETTINGS_RESTART_ESTIMATE, 8),
  "settings.nat_randomization.set": restart("Every eero restarts to apply the NAT port mode", SETTINGS_RESTART_ESTIMATE, 8),
  "settings.mlo.set": restart("Every eero restarts to apply multi-link operation", RESTART_ESTIMATE.network, 3),
  "settings.legacy_mode.set": restart("Every eero restarts to apply legacy device mode", RESTART_ESTIMATE.network, 3),
  "wifi.security.set": restart("Every eero restarts to apply the new Wi-Fi security", RESTART_ESTIMATE.network, 3),
  "network.restart": restart("Every eero restarts", RESTART_ESTIMATE.network, 3),
  "updates.install": restart("Every eero installs the update and restarts", UPDATE_RESTART_ESTIMATE, 10),
  "wifi.name.set": quiet("Wireless devices drop and must rejoin with the new name", "wireless"),
  "wifi.password.set": quiet("Wireless devices drop and must rejoin with the new password", "wireless"),
  "settings.thread.reset": quiet("Every Thread accessory must be paired again", "thread"),
  "settings.thread.set": quiet("Thread accessories lose their border router while Thread is off", "thread"),
  "eero.port.action": quiet("The device on that port loses its connection or power", "port"),
  "settings.upnp.set": quiet("Nothing restarts"),
  "settings.sqm.set": quiet("Nothing restarts"),
  "settings.band_steering.set": quiet("Nothing restarts; some devices may roam to another band"),
  "settings.fast_transition.set": quiet("Nothing restarts"),
  "settings.power_saving.set": quiet("Nothing restarts"),
  "settings.timezone.set": quiet("Nothing restarts; schedules follow the new time zone"),
  "settings.simple_setup.set": quiet("Nothing restarts"),
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const isWireless = (d: M.Device) => d.band !== null && d.band !== "wired";

/** Pure: the impact of `ids` on a network whose devices are `devices`. Unknown ids are bad_params. */
export function settingsImpact(ids: string[], devices: M.Device[]): M.SettingsImpact {
  const online = devices.filter((d) => d.connected && !d.blocked);
  const changes = ids.map((id): M.ChangeImpact => {
    const rule = IMPACT[id];
    if (!rule) throw new CommandError("bad_params", `No impact is known for "${id}".`);
    const drop = rule.drops === "all" ? online : rule.drops === "wireless" ? online.filter((d) => isWireless(d) && d.ssid !== "guest") : [];
    const who =
      rule.drops === "all"
        ? `${plural(drop.length, "device")} online ${drop.length === 1 ? "loses" : "lose"} internet`
        : rule.drops === "wireless"
          ? `${plural(drop.length, "wireless device")} ${drop.length === 1 ? "drops" : "drop"}`
          : null;
    const summary = rule.restarts ? `${rule.what}: ${who} for ${rule.estimate}.` : `${rule.what}.`;
    return { id, restarts: rule.restarts, estimate: rule.estimate, drops: rule.drops, deviceIds: drop.map((d) => d.id), summary };
  });
  const longest = ids.map((id) => IMPACT[id]!).filter((r) => r.restarts).sort((a, b) => b.minutes - a.minutes)[0];
  return {
    changes,
    restarts: changes.some((c) => c.restarts),
    estimate: longest?.estimate ?? null,
    devicesOnline: online.length,
    deviceIds: [...new Set(changes.flatMap((c) => c.deviceIds))],
    summary: changes.map((c) => c.summary).join(" "),
  };
}

/** The impact of one write on the network in `ctx`, for its `needs_confirm` message. */
export async function impactOf(ctx: CommandContext, id: string): Promise<M.SettingsImpact> {
  return settingsImpact([id], await ctx.backend.device.list(ctx.net));
}

export const commands: AnyCommand[] = [
  defineCommand({
    id: "settings.get",
    label: "Network settings",
    description:
      "Every network-wide setting: DNS, DHCP and NAT, IPv6, ISP (WAN) settings, connection mode, UPnP, SQM, client steering, fast roaming, multi-link operation, power saving with its schedules, legacy device mode, eero Simple Setup and Thread. Thread secrets (network key, PSKc) are never included. null means eero did not report the setting for this network.",
    icon: "sliders-horizontal",
    params: z.object({}),
    effect: "query",
    topic: "settings",
    run: async (ctx): Promise<M.NetworkSettings> => withoutSecrets(await ctx.backend.settings.get(ctx.net)),
  }),
  defineCommand({
    id: "settings.impact",
    label: "Impact of a settings change",
    description:
      "What one or more changes do before they are confirmed: whether every eero restarts, the outage estimate, and the online devices that drop. `summary` is each disruptive write's confirm message. Changes are command ids (`settings.dns.set`); params are accepted for later use and do not change the estimate yet.",
    icon: "triangle-alert",
    params: z.object({
      changes: z
        .array(z.object({ id: z.string().trim().min(1), params: z.record(z.string(), z.unknown()).optional() }).strict())
        .min(1)
        .max(20)
        .describe("The writes to estimate, by command id."),
    }),
    effect: "query",
    topic: "settings",
    // Device counts change by the minute; a stale estimate is still the right copy, but keep it short.
    ttl: 30,
    run: async (ctx, p): Promise<M.SettingsImpact> => settingsImpact(p.changes.map((c) => c.id), await ctx.backend.device.list(ctx.net)),
  }),
];
