/**
 * Undo for writes run from the palette (docs/ux/pages/command-palette.md,
 * Running writes). A `write` whose registry has the opposite command
 * (`device.pause` and `device.resume`, `.block` and `.unblock`, `.enable`
 * and `.disable`) toasts with Undo, which runs that command with the same
 * targets. Nothing per command: the pairs come from the ids in the registry.
 *
 * Undo is offered only for a write that changed something: a bulk device
 * result undoes only the devices it changed, and none when it changed none.
 * A disruptive write that has an opposite (pause, block, disable) gets Undo
 * too; when the opposite is itself disruptive, Undo asks first like any
 * other confirm. Destructive commands never get Undo.
 *
 * Pure (no React, no `~`), so it runs in node tests (undo.test.ts).
 */
import type { CommandInfo } from "../../../../core/registry";
import type { WriteRequest } from "../../app/useWrite";
import { paramFields } from "./search";

const OPPOSITE: Readonly<Record<string, string>> = {
  pause: "resume",
  resume: "pause",
  block: "unblock",
  unblock: "block",
  enable: "disable",
  disable: "enable",
};

const undoable = (effect: CommandInfo["effect"]) => effect === "write" || effect === "disruptive";

/** The registered write that undoes `info`, or null. */
export function inverseOf(info: Pick<CommandInfo, "id" | "effect">, commands: ReadonlyArray<CommandInfo>): CommandInfo | null {
  if (!undoable(info.effect)) return null;
  const parts = info.id.split(".");
  const opposite = OPPOSITE[parts.at(-1) ?? ""];
  if (!opposite) return null;
  const id = [...parts.slice(0, -1), opposite].join(".");
  return commands.find((c) => c.id === id && undoable(c.effect)) ?? null;
}

const changedIds = (result: unknown): string[] | null => {
  const devices = (result as { devices?: unknown } | null)?.devices;
  if (!Array.isArray(devices)) return null;
  return devices.flatMap((d) => (typeof (d as { id?: unknown })?.id === "string" ? [(d as { id: string }).id] : []));
};

/**
 * `req` with Undo through the inverse command, when there is one: the same
 * params the inverse accepts, with `devices` narrowed to the devices the
 * write changed. `networkId` (the network on screen) pins both the write and
 * its Undo, so Undo after a network switch still undoes it there.
 */
export function withUndo(req: WriteRequest, info: CommandInfo, commands: ReadonlyArray<CommandInfo>, networkId: string | null): WriteRequest {
  const inverse = inverseOf(info, commands);
  if (!inverse) return req;
  const accepted = new Set([...paramFields(inverse.params).map((f) => f.name), "networkId"]);
  const params = Object.fromEntries(Object.entries(req.params ?? {}).filter(([k]) => accepted.has(k) && k !== "confirm"));
  // The write and its Undo name the same network.
  const pinned = networkId && inverse.scope === "network" && info.scope === "network" ? networkId : null;
  if (pinned) params.networkId ??= pinned;
  return {
    ...req,
    params: pinned ? { networkId: pinned, ...req.params } : req.params,
    undo: (result: unknown) => {
      const changed = "devices" in params ? changedIds(result) : null;
      if (changed !== null && changed.length === 0) return null;
      return {
        id: inverse.id,
        params: changed ? { ...params, devices: changed } : params,
        success: `Undone: ${info.label}`,
        failure: `Couldn't undo ${info.label}`,
      };
    },
  };
}
