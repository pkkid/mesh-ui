/**
 * Coverage and placement: `coverage.scan` (link quality per room),
 * `coverage.upgrade_report` (devices by Wi-Fi generation) and
 * `eero.placement.test`. They sit in their own file, not `eero.ts`, but the
 * ids are unchanged. The scans are `/2.4/` reads and the placement test is a
 * `/2.3/` write; all three can take a while, so the UI shows progress.
 * See docs/architecture/commands.md (eero) and docs/ux/pages/troubleshooting.md.
 */

import { z } from "zod";
import type * as M from "../model";
import { TTL } from "../poll";
import { type AnyCommand, type CommandContext, defineCommand, ref } from "../spec";
import { CommandError } from "../errors";
import { builtinRefusal } from "./eero";

/** The generations in report order, newest first. */
export const GENERATIONS: M.UpgradeReport["byGeneration"][number]["generation"][] = ["wifi7", "wifi6e", "wifi6", "wifi5", "wifi4"];

/** Every generation once, in order, so the donut and legend never skip one. */
export function fillGenerations(report: M.UpgradeReport): M.UpgradeReport {
  const counts = new Map(report.byGeneration.map((g) => [g.generation, g.devices]));
  return { ...report, byGeneration: GENERATIONS.map((generation) => ({ generation, devices: counts.get(generation) ?? 0 })) };
}

/**
 * Fills what eero's scan leaves out from the current eero list: a room for
 * every eero (eeros with no wireless device have none in the scan), names,
 * the upstream eero, and the read time as scannedAt (the real scan is an
 * instant read with no timestamp). Weakest first.
 */
async function completeScan(ctx: CommandContext, scan: M.CoverageScan): Promise<M.CoverageScan> {
  const eeros = await ctx.backend.eero.list(ctx.net).catch(() => []);
  // An eero Built-in device (an Echo) is not part of eero's scan, so it gets no room.
  const missing = eeros.filter((e) => e.kind !== "builtin" && !scan.rooms.some((r) => r.eeroId === e.id)).map((e) => ({ eeroId: e.id, location: e.location, quality: null, devices: 0, servedBy: null }));
  const rooms = [...scan.rooms, ...missing]
    .map((r) => {
      const eero = eeros.find((e) => e.id === r.eeroId);
      return { ...r, location: r.location || eero?.location || r.eeroId, servedBy: r.servedBy ?? eero?.upstream ?? null };
    })
    .sort((a, b) => (a.quality ?? 101) - (b.quality ?? 101) || a.location.localeCompare(b.location));
  return { ...scan, scannedAt: scan.scannedAt ?? new Date(ctx.now()).toISOString(), rooms };
}

export const commands: AnyCommand[] = [
  defineCommand({
    id: "coverage.scan",
    label: "Coverage scan",
    description:
      "Link quality per room (each eero: the mean 0 to 100 link score of its wireless devices, its device count and the eero it connects through) with advice for weak devices. A /2.4/ read of a few seconds; refresh: true skips the cached result (Scan again).",
    icon: "radar",
    effect: "query",
    topic: "coverage",
    ttl: (p) => (p.refresh ? 0 : TTL.coverage),
    params: z.object({ refresh: z.boolean().optional().describe("Skip the cached scan and ask eero again.") }),
    run: async (ctx): Promise<M.CoverageScan> => completeScan(ctx, await ctx.backend.diagnostics.coverageScan(ctx.net)),
  }),

  defineCommand({
    id: "coverage.upgrade_report",
    label: "Upgrade report",
    description: "Devices counted by Wi-Fi generation (7, 6E, 6, 5, 4 or older), the eeros that hold some devices back, and eero's notes. A /2.4/ read.",
    icon: "chart-pie",
    effect: "query",
    topic: "coverage",
    params: z.object({}),
    run: async (ctx): Promise<M.UpgradeReport> => fillGenerations(await ctx.backend.diagnostics.upgradeReport(ctx.net)),
  }),

  defineCommand({
    id: "eero.placement.test",
    label: "Test placement",
    description: "Asks eero to rate where an eero sits (poor, fair, good or strong) with advice when it should move. A /2.3/ write that can take up to a minute; nothing restarts.",
    icon: "map-pin",
    effect: "write",
    gate: { area: "eeros" },
    invalidates: ["coverage"],
    params: z.object({ eero: ref("eero") }),
    async run(ctx, p): Promise<M.PlacementResult> {
      const id = await ctx.resolve("eero", p.eero);
      const e = (await ctx.backend.eero.list(ctx.net)).find((x) => x.id === id);
      const refused = e ? builtinRefusal(e, "a placement test") : null;
      if (refused) throw new CommandError("bad_params", refused);
      return ctx.backend.eero.placementTest(ctx.net, id);
    },
  }),
];
