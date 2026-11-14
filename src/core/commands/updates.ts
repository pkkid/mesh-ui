/** Software update commands (read side). See docs/architecture/commands.md#updates-commandsupdatests. */

import { z } from "zod";
import type * as M from "../model";
import { POLL } from "../poll";
import { type AnyCommand, defineCommand } from "../spec";

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
];
