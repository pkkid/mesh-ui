/**
 * Access levels: how much the command line and MCP agents may run, set by
 * the user in the window (Settings, Command line and agents). The engine
 * checks the level before every CLI or MCP command on the live backend; the
 * window is never limited. Secrets (Wi-Fi and guest passwords, Thread
 * credentials) are a separate switch that holds at every level. See
 * docs/architecture/security.md#access-levels.
 */

import type { AccessLevel, Effect } from "./model";
import type { Surface } from "./spec";

export const ACCESS_LEVELS: readonly AccessLevel[] = ["off", "read", "changes", "full"];

/** The settings field that holds each limited surface's level. */
export const ACCESS_SETTING = { cli: "cliAccess", mcp: "mcpAccess" } as const;

/** What a limited surface may run: its level, and the one Reveal secrets switch shared by the CLI and MCP. */
export type Grant = { level: AccessLevel; secrets: boolean };

/** What the check needs from a command spec or its info. */
export type Gated = { effect: Effect; sensitive?: boolean; access?: "full" | null };

/** The names the refusal uses, as in the window. */
const SURFACE_NAME = { cli: "The command line", mcp: "The MCP server" } as const;
const LEVEL_NAME: Record<AccessLevel, string> = { off: "Off", read: "Read only", changes: "Changes", full: "Full access" };
const WHERE = "Change it in Mesh UI, Settings, Command line and agents.";

/** A sensitive query: its whole result is a secret (a password, a QR payload, Thread credentials), so it needs Reveal secrets. */
export const isSecret = (cmd: Gated): boolean => cmd.sensitive === true && cmd.effect === "query";

/** Whether a level allows a command by its effect; `access: "full"` needs Full access whatever the effect. */
function levelAllows(level: AccessLevel, cmd: Gated): boolean {
  if (cmd.access === "full") return level === "full";
  switch (level) {
    case "off":
      return false;
    case "read":
      return cmd.effect === "query";
    case "changes":
      return cmd.effect !== "destructive";
    case "full":
      return true;
  }
}

/** Whether a grant allows a command: the level decides by effect, and a secret also needs Reveal secrets on. */
export function allows(grant: Grant, cmd: Gated): boolean {
  return levelAllows(grant.level, cmd) && (grant.secrets || !isSecret(cmd));
}

/** The access_denied message for a refused command, or null when the grant allows it. */
export function denial(surface: Exclude<Surface, "ui">, grant: Grant, cmd: Gated & { id: string }): string | null {
  if (allows(grant, cmd)) return null;
  const who = SURFACE_NAME[surface];
  if (grant.level === "off") return `${who} is turned off. ${WHERE}`;
  if (levelAllows(grant.level, cmd)) return `${cmd.id} shows a secret, and Reveal secrets is off for the command line and agents. ${WHERE}`;
  const what = cmd.access === "full" ? "needs Full access" : cmd.effect === "destructive" ? "cannot be undone" : "changes the network";
  return `${cmd.id} ${what}, and ${who.charAt(0).toLowerCase()}${who.slice(1)} is set to ${LEVEL_NAME[grant.level]}. ${WHERE}`;
}

/** A level read from settings.json, falling back to the default for anything unknown. */
export function levelOf(value: unknown, fallback: AccessLevel): AccessLevel {
  return (ACCESS_LEVELS as readonly unknown[]).includes(value) ? (value as AccessLevel) : fallback;
}

/** Everything allowed: the window, and demo or fake runs. */
export const FULL_GRANT: Grant = { level: "full", secrets: true };
