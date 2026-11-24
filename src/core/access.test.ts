import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { allows, denial } from "./access";
import { createDemoBackend } from "./demo";
import { createEngine, fileSettings, memorySettings } from "./engine";
import type { AccessLevel, AppSettings } from "./model";
import type { Surface } from "./spec";

const engineFor = (surface: Surface, settings: Partial<AppSettings>, enforceAccess = true) =>
  createEngine({ backend: createDemoBackend(), surface, settings: memorySettings(settings), enforceAccess });

/** The error code for a call, or "ran" when the access check let it through (it may still fail on params). */
async function outcome(engine: ReturnType<typeof engineFor>, id: string, params: unknown = {}): Promise<string> {
  const res = await engine.execute(id, params);
  return !res.ok && res.error.code === "access_denied" ? "access_denied" : "ran";
}

describe("allows", () => {
  it("maps each level to the effects it lets through", () => {
    const table: Record<AccessLevel, [boolean, boolean, boolean, boolean, boolean]> = {
      // query, sensitive query, write, disruptive, destructive
      off: [false, false, false, false, false],
      read: [true, false, false, false, false],
      changes: [true, true, true, true, false],
      full: [true, true, true, true, true],
    };
    for (const [level, want] of Object.entries(table) as [AccessLevel, boolean[]][]) {
      expect([
        allows(level, "query"),
        allows(level, "query", true),
        allows(level, "write"),
        allows(level, "disruptive"),
        allows(level, "destructive"),
      ]).toEqual(want);
    }
  });

  it("says why and where to change it", () => {
    expect(denial("cli", "off", { id: "device.list", effect: "query" })).toBe("The command line is turned off. Change it in Mesh UI, Settings, Command line and agents.");
    expect(denial("mcp", "changes", { id: "eero.remove", effect: "destructive" })).toBe(
      "eero.remove cannot be undone, and the MCP server is set to Changes. Change it in Mesh UI, Settings, Command line and agents.",
    );
    expect(denial("mcp", "read", { id: "wifi.password.get", effect: "query", sensitive: true })).toMatch(/^wifi.password.get shows a Wi-Fi password, and the MCP server is set to Read only\./);
    expect(denial("mcp", "full", { id: "eero.remove", effect: "destructive" })).toBeNull();
  });
});

describe("engine access levels", () => {
  it("off refuses every command, even app ones", async () => {
    const engine = engineFor("cli", { cliAccess: "off" });
    expect(await engine.execute("app.info")).toMatchObject({ ok: false, error: { code: "access_denied" } });
    expect(await outcome(engine, "auth.status")).toBe("access_denied");
  });

  it("read only allows queries but not passwords or writes", async () => {
    const engine = engineFor("mcp", { mcpAccess: "read" });
    expect(await engine.execute("device.list")).toMatchObject({ ok: true });
    expect(await outcome(engine, "wifi.password.get")).toBe("access_denied");
    expect(await outcome(engine, "device.rename", {})).toBe("access_denied");
  });

  it("changes allows writes and disruptive commands, never destructive ones", async () => {
    const engine = engineFor("mcp", { mcpAccess: "changes" });
    expect(await outcome(engine, "wifi.password.get")).toBe("ran");
    expect(await outcome(engine, "device.rename", {})).toBe("ran");
    // Still needs confirm: the level does not replace it.
    expect(await engine.execute("eero.restart", { eero: "x" })).toMatchObject({ ok: false });
    expect(await outcome(engine, "eero.restart", { eero: "x" })).toBe("ran");
    expect(await outcome(engine, "eero.remove", { eero: "x", confirm: true })).toBe("access_denied");
  });

  it("uses the defaults: full for the CLI, changes for MCP", async () => {
    expect(await outcome(engineFor("cli", {}), "eero.remove", { eero: "x" })).toBe("ran");
    expect(await outcome(engineFor("mcp", {}), "eero.remove", { eero: "x" })).toBe("access_denied");
  });

  it("never limits the window, or demo runs unless asked", async () => {
    expect(await engineFor("ui", { cliAccess: "off", mcpAccess: "off" }).access()).toBe("full");
    const demo = createEngine({ backend: createDemoBackend(), surface: "mcp", settings: memorySettings({ mcpAccess: "off" }) });
    expect(await demo.access()).toBe("full");
    expect(await demo.execute("device.list")).toMatchObject({ ok: true });
  });

  it("treats an unknown level in settings.json as the default", async () => {
    const engine = engineFor("mcp", { mcpAccess: "everything" as AccessLevel });
    expect(await engine.access()).toBe("changes");
  });

  it("sees a level the window changed while it runs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mesh-ui-access-test-"));
    try {
      const path = join(dir, "settings.json");
      await writeFile(path, JSON.stringify({ mcpAccess: "full" }));
      const mine = fileSettings(path);
      const engine = createEngine({ backend: createDemoBackend(), surface: "mcp", settings: mine, enforceAccess: true });
      expect(await engine.execute("device.list")).toMatchObject({ ok: true });
      // The window writes the file from another process.
      await fileSettings(path).update({ mcpAccess: "off" });
      expect(await engine.execute("device.list")).toMatchObject({ ok: false, error: { code: "access_denied" } });
      // A later write from this process keeps the window's change.
      await fileSettings(path).update({ mcpAccess: "read" });
      await mine.update({ lastNetworkId: "net_1" });
      expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ mcpAccess: "read", lastNetworkId: "net_1" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("app.access.set", () => {
  it("sets either level from the window", async () => {
    const engine = engineFor("ui", {});
    expect(await engine.execute<AppSettings>("app.access.set", { mcp: "read" })).toMatchObject({ ok: true, result: { cliAccess: "full", mcpAccess: "read" } });
    expect(await engine.execute<AppSettings>("app.access.set", { cli: "off", mcp: "full" })).toMatchObject({ ok: true, result: { cliAccess: "off", mcpAccess: "full" } });
  });

  it("rejects bad params", async () => {
    const engine = engineFor("ui", {});
    expect(await engine.execute("app.access.set", {})).toMatchObject({ ok: false, error: { code: "bad_params" } });
    expect(await engine.execute("app.access.set", { mcp: "admin" })).toMatchObject({ ok: false, error: { code: "bad_params" } });
  });

  it("is refused from the CLI and MCP, even at full access", async () => {
    for (const surface of ["cli", "mcp"] as const) {
      const engine = engineFor(surface, { cliAccess: "full", mcpAccess: "full" });
      expect(await engine.execute("app.access.set", { [surface]: "full" })).toMatchObject({ ok: false, error: { code: "bad_params", message: "Only in the Mesh UI window." } });
    }
  });
});
