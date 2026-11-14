/**
 * Network settings commands (read side): `settings.get`, every network-wide
 * setting the Advanced networking page shows, with Thread but never its
 * secrets. Writes (DNS, DHCP, WAN, toggles, schedules) come later with
 * `settings.impact`. See docs/architecture/commands.md#settings-commandssettingsts
 * and docs/ux/pages/advanced-networking.md.
 */

import { z } from "zod";
import type * as M from "../model";
import { type AnyCommand, defineCommand } from "../spec";

/** Drops anything secret-looking a backend might add to Thread, so the result is safe to cache, log and show. */
function withoutSecrets(s: M.NetworkSettings): M.NetworkSettings {
  if (!s.thread) return s;
  const { enabled, credentialSync, name, channel, panId, xpanId, borderAgent, devices } = s.thread;
  return { ...s, thread: { enabled, credentialSync, name, channel, panId, xpanId, borderAgent, devices } };
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
];
