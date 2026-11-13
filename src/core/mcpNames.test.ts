import { describe, expect, it } from "vitest";

import { mcpHints, toolName } from "./mcpNames";

describe("MCP tool names and hints", () => {
  it("replaces every dot in the id with an underscore", () => {
    expect(toolName("device.pause")).toBe("device_pause");
    expect(toolName("settings.dns.set")).toBe("settings_dns_set");
    expect(toolName("app")).toBe("app");
  });

  it("derives hints from the effect, per docs/architecture/mcp.md", () => {
    expect(mcpHints("device.list", "query")).toEqual({ readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: true });
    expect(mcpHints("device.rename", "write")).toEqual({ readOnlyHint: false, idempotentHint: false, destructiveHint: false, openWorldHint: true });
    expect(mcpHints("eero.reboot", "disruptive")).toEqual({ readOnlyHint: false, idempotentHint: false, destructiveHint: true, openWorldHint: true });
    expect(mcpHints("network.delete", "destructive")).toEqual({ readOnlyHint: false, idempotentHint: false, destructiveHint: true, openWorldHint: true });
  });

  it("marks app.* commands as not open world", () => {
    expect(mcpHints("app.info", "query").openWorldHint).toBe(false);
    expect(mcpHints("app.theme.set", "write").openWorldHint).toBe(false);
  });
});
