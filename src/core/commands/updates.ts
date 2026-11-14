/**
 * Software update commands: `updates.get` and `updates.notes` (reads),
 * `updates.install` (disruptive: every eero restarts) and `updates.hour.set`
 * (the preferred update hour). See
 * docs/architecture/commands.md#updates-commandsupdatests.
 */

import { z } from "zod";
import { CommandError } from "../errors";
import type * as M from "../model";
import { POLL } from "../poll";
import { type AnyCommand, type CommandContext, defineCommand } from "../spec";
import { impactOf } from "./settings";

/** How long after an install the eeros are expected back; cached update and eero reads go stale again then. */
export const INSTALL_SETTLE_MS = 10 * 60_000;

/** The update state, or bad_params when there is nothing eero will install now. */
async function installable(ctx: CommandContext): Promise<M.Updates> {
  const u = await ctx.backend.updates.get(ctx.net);
  if (!u.canUpdateNow || !u.target || u.status === "up_to_date") throw new CommandError("bad_params", "There is no update to install now.");
  if (u.status === "installing") throw new CommandError("bad_params", "The update is already installing.");
  return u;
}

export const commands: AnyCommand[] = [
  defineCommand({
    id: "updates.get",
    label: "Software updates",
    description: "eeroOS update state: current and target version, whether it can update now, the scheduled time, the preferred hour and each eero's version.",
    icon: "download",
    params: z.object({}),
    effect: "query",
    topic: "updates",
    poll: POLL.updates,
    run: (ctx): Promise<M.Updates> => ctx.backend.updates.get(ctx.net),
  }),
  defineCommand({
    id: "updates.notes",
    label: "Release notes",
    description:
      "What's new in the eeroOS version the network is updating to (or runs now): version, release date, title and feature lines. Null when eero names no release notes. Read from eero's public manifest without the session.",
    icon: "scroll-text",
    params: z.object({}),
    effect: "query",
    topic: "release_notes",
    run: (ctx): Promise<M.ReleaseNotes | null> => ctx.backend.updates.notes(ctx.net),
  }),
  defineCommand({
    id: "updates.install",
    label: "Install update now",
    description:
      "Installs the eeroOS update now instead of waiting for the update window. Every eero downloads it and restarts together: internet and Wi-Fi drop for about 10 minutes. Only when eero says it can update now. Returns the update state right after the install starts.",
    icon: "download",
    params: z.object({}),
    effect: "disruptive",
    gate: { area: "eeros" },
    invalidates: ["updates", "eeros", "network", "release_notes"],
    async confirmMessage(ctx) {
      const u = await installable(ctx);
      const impact = await impactOf(ctx, "updates.install");
      return `eeroOS ${u.target?.replace(/^v/i, "")} installs now. ${impact.summary}`;
    },
    async run(ctx): Promise<M.Updates> {
      await installable(ctx);
      await ctx.backend.updates.install(ctx.net);
      // Read again when the eeros should be back, so pages see them return.
      ctx.invalidate(["updates", "eeros", "network"], ctx.now() + INSTALL_SETTLE_MS);
      return ctx.backend.updates.get(ctx.net);
    },
  }),
  defineCommand({
    id: "updates.hour.set",
    label: "Set preferred update time",
    description:
      "Sets the hour (0 to 23, network time) when eero installs updates automatically. eero's window is about 3 hours from that hour. Nothing restarts now. Returns the update state.",
    icon: "clock",
    params: z.object({ hour: z.number().int().min(0).max(23).describe("Start of the update window, 0 to 23, network time.") }),
    effect: "write",
    gate: { area: "eeros" },
    invalidates: ["updates"],
    run: (ctx, { hour }): Promise<M.Updates> => ctx.backend.updates.setPreferredHour(ctx.net, hour),
  }),
];
