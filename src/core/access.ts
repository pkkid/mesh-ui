/**
 * Access levels: how much the command line and MCP agents may run, set by
 * the user in the window (Settings, Command line and agents). The engine
 * checks the level before every CLI or MCP command on the live backend; the
 * window is never limited. See docs/architecture/security.md#access-levels.
 */

import type { AccessLevel, Effect } from "./model";
import type { Surface } from "./spec";

export const ACCESS_LEVELS: readonly AccessLevel[] = ["off", "read", "changes", "full"];

/** The settings field that holds each limited surface's level. */
export const ACCESS_SETTING = { cli: "cliAccess", mcp: "mcpAccess" } as const;

/** The names the refusal uses, as in the window. */
const SURFACE_NAME = { cli: "The command line", mcp: "The MCP server" } as const;
const LEVEL_NAME: Record<AccessLevel, string> = { off: "Off", read: "Read only", changes: "Changes", full: "Full access" };
const WHERE = "Change it in Mesh UI, Settings, Command line and agents.";

/** Whether a level allows a command with this effect; `sensitive` results (Wi-Fi passwords) need more than Read only. */
export function allows(level: AccessLevel, effect: Effect, sensitive = false): boolean {
  switch (level) {
    case "off":
      return false;
    case "read":
      return effect === "query" && !sensitive;
    case "changes":
      return effect !== "destructive";
    case "full":
      return true;
  }
}

/** The access_denied message for a refused command, or null when the level allows it. */
export function denial(
  surface: Exclude<Surface, "ui">,
  level: AccessLevel,
  cmd: { id: string; effect: Effect; sensitive?: boolean },
): string | null {
  if (allows(level, cmd.effect, cmd.sensitive === true)) return null;
  const who = SURFACE_NAME[surface];
  if (level === "off") return `${who} is turned off. ${WHERE}`;
  const what = cmd.effect === "destructive" ? "cannot be undone" : cmd.effect === "query" ? "shows a Wi-Fi password" : "changes the network";
  return `${cmd.id} ${what}, and ${who.charAt(0).toLowerCase()}${who.slice(1)} is set to ${LEVEL_NAME[level]}. ${WHERE}`;
}

/** A level read from settings.json, falling back to the default for anything unknown. */
export function levelOf(value: unknown, fallback: AccessLevel): AccessLevel {
  return (ACCESS_LEVELS as readonly unknown[]).includes(value) ? (value as AccessLevel) : fallback;
}
