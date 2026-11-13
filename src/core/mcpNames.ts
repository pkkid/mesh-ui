/**
 * How `mesh-ui mcp` names a command's tool and derives its annotations from
 * the effect (docs/architecture/mcp.md#tools). Plain TypeScript with no Node
 * imports: the MCP server (src/cli/mcp.ts) and the command palette preview
 * both use it, so the name an agent sees and the one the UI shows are one.
 */
import type { Effect } from "./model";
import { needsConfirm } from "./spec";

/** `device.pause` to `device_pause`. */
export const toolName = (id: string): string => id.replaceAll(".", "_");

export type McpHints = { readOnlyHint: boolean; idempotentHint: boolean; destructiveHint: boolean; openWorldHint: boolean };

/** Tool annotations from the effect. `app.*` commands only touch local settings, so they are not open world. */
export function mcpHints(id: string, effect: Effect): McpHints {
  return {
    readOnlyHint: effect === "query",
    idempotentHint: effect === "query",
    destructiveHint: needsConfirm(effect),
    openWorldHint: !id.startsWith("app."),
  };
}
