/**
 * Smart home integrations (read side): `integrations.get`, each partner
 * feature with `available` and `enabled`. eero leaving a feature out (or a
 * 403 or 404) is "unavailable", not an error. Unlinking Amazon and the
 * switches come later. See docs/architecture/commands.md#integrations-commandsintegrationsts-added.
 */

import { z } from "zod";
import type * as M from "../model";
import { type AnyCommand, defineCommand } from "../spec";

export const commands: AnyCommand[] = [
  defineCommand({
    id: "integrations.get",
    label: "Integrations",
    description:
      "Smart home integrations: Apple HomeKit, Amazon Connected Home, eero Built-in, Smart Home Hub and Frustration-Free Setup, each with `available` (eero reports it for this network) and `enabled` (null when unavailable or unknown).",
    icon: "plug",
    params: z.object({}),
    effect: "query",
    topic: "settings",
    run: (ctx): Promise<M.Integrations> => ctx.backend.integrations.get(ctx.net),
  }),
];
