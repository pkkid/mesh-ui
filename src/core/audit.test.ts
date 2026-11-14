import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { type CliHost, nodeHost, runCli } from "../cli/index";
import { createMcpServer } from "../cli/mcp";
import type { Backend } from "./backend";
import { type AuditEntry, fileAudit, memoryAudit, redactParams } from "./audit";
import { allCommands } from "./registry";
import { createDemoBackend } from "./demo";
import { createEngine } from "./engine";
import { type AnyCommand, defineCommand } from "./spec";

const SECRET = "hunter2-very-secret";

/** Stand-ins for the M4 password writes, so the audit rule is tested before those commands exist. */
const passwordWrites: AnyCommand[] = ["guest.password.set", "wifi.password.set"].map((id) =>
  defineCommand({
    id,
    label: "Set password",
    params: z.object({ password: z.string().nullable() }),
    effect: "disruptive",
    run: async () => ({ ok: true }),
  }),
);

const commands = [...allCommands(), ...passwordWrites];

/** The demo fixtures behind a live-kind backend: only live engines audit by default. */
const liveLike = (): Backend => ({ ...createDemoBackend(), kind: "eero" });

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "mesh-ui-M4.2-audit-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const readLines = async (path: string): Promise<AuditEntry[]> =>
  (await readFile(path, "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as AuditEntry);

describe("redactParams", () => {
  it("removes passwords, codes, tokens and WIFI: payloads, at any depth, and keeps the rest", () => {
    const out = redactParams({
      password: SECRET,
      newPassword: SECRET,
      code: "123456",
      token: SECRET,
      device: "Leo's Switch",
      confirm: true,
      nested: { wifiPassword: SECRET, list: [{ passphrase: SECRET }, `WIFI:T:WPA;S:Home;P:${SECRET};;`] },
      cleared: null,
    });
    expect(out).toEqual({
      password: "[removed]",
      newPassword: "[removed]",
      code: "[removed]",
      token: "[removed]",
      device: "Leo's Switch",
      confirm: true,
      nested: { wifiPassword: "[removed]", list: [{ passphrase: "[removed]" }, "[removed]"] },
      cleared: null,
    });
    expect(JSON.stringify(out)).not.toContain(SECRET);
  });
});

describe("engine audit", () => {
  it("logs one line per CLI command with time, surface, id, effect, outcome and redacted params", async () => {
    const audit = memoryAudit();
    const engine = createEngine({ backend: createDemoBackend(), commands, surface: "cli", audit, clock: () => Date.parse("2026-11-13T10:00:00Z") });
    await engine.execute("network.get");
    await engine.execute("guest.password.set", { password: SECRET });
    await engine.execute("guest.password.set", { password: SECRET, confirm: true });
    await engine.execute("wifi.password.set", { password: 42 });
    await engine.execute("no.such.command", { password: SECRET });
    expect(audit.entries).toEqual([
      { time: "2026-11-13T10:00:00.000Z", surface: "cli", id: "network.get", effect: "query", ok: true, params: {} },
      { time: "2026-11-13T10:00:00.000Z", surface: "cli", id: "guest.password.set", effect: "disruptive", ok: false, code: "needs_confirm", params: { password: "[removed]" } },
      { time: "2026-11-13T10:00:00.000Z", surface: "cli", id: "guest.password.set", effect: "disruptive", ok: true, params: { password: "[removed]", confirm: true } },
      { time: "2026-11-13T10:00:00.000Z", surface: "cli", id: "wifi.password.set", effect: "disruptive", ok: false, code: "bad_params", params: { password: "[removed]" } },
      { time: "2026-11-13T10:00:00.000Z", surface: "cli", id: "no.such.command", effect: null, ok: false, code: "unknown_command", params: { password: "[removed]" } },
    ]);
  });

  it("never logs a result: a revealed Wi-Fi password or WIFI: payload stays out", async () => {
    const audit = memoryAudit();
    const engine = createEngine({ backend: createDemoBackend(), commands, surface: "mcp", audit });
    const reveal = await engine.execute<{ password: string }>("wifi.password.get");
    const share = await engine.execute<{ payload: string }>("wifi.share");
    expect(reveal.ok && share.ok).toBe(true);
    const text = JSON.stringify(audit.entries);
    if (reveal.ok) expect(text).not.toContain(reveal.result.password);
    expect(text).not.toContain("WIFI:");
    expect(audit.entries.map((e) => e.id)).toEqual(["wifi.password.get", "wifi.share"]);
  });

  it("writes audit.jsonl in the config dir for live cli and mcp engines by default; never for the UI, demo or fake", async () => {
    const path = join(dir, "audit.jsonl");
    for (const surface of ["ui", "cli", "mcp"] as const) {
      await createEngine({ backend: createDemoBackend(), commands, surface, host: { configDir: dir } }).execute("network.get");
      await createEngine({ backend: { ...liveLike(), fake: true }, commands, surface, host: { configDir: dir } }).execute("network.get");
    }
    await createEngine({ backend: liveLike(), commands, surface: "ui", host: { configDir: dir } }).execute("network.get");
    await expect(stat(path)).rejects.toThrow();
    await createEngine({ backend: liveLike(), commands, surface: "cli", host: { configDir: dir } }).execute("network.get");
    await createEngine({ backend: liveLike(), commands, surface: "mcp", host: { configDir: dir } }).execute("eero.list");
    expect((await readLines(path)).map((e) => [e.surface, e.id])).toEqual([
      ["cli", "network.get"],
      ["mcp", "eero.list"],
    ]);
    // Without a config dir (the dev CLI's scratch default) nothing is written anywhere.
    expect((await createEngine({ backend: liveLike(), commands, surface: "cli" }).execute("network.get")).ok).toBe(true);
  });
});

describe("CLI and MCP calls", () => {
  it("a CLI run is appended to audit.jsonl (mode 600) with no password", async () => {
    const io = { stdout: () => {}, stderr: () => {} };
    const userDataDir = join(dir, "user-data");
    // The node host with a live-kind backend over the demo fixtures, as the Electron host builds a live engine.
    const host: CliHost = {
      ...nodeHost(),
      createEngine: ({ surface }) => createEngine({ backend: liveLike(), commands, surface, host: { configDir: userDataDir } }),
    };
    expect(await runCli(["--format", "json", "run", "wifi.password.get"], io, host)).toBe(0);
    expect(await runCli(["run", "device.get", "--params", '{"device":"no such device"}'], io, host)).not.toBe(0);
    const path = join(userDataDir, "audit.jsonl");
    const lines = await readLines(path);
    expect(lines.map((l) => [l.surface, l.id, l.ok, l.code ?? null])).toEqual([
      ["cli", "wifi.password.get", true, null],
      ["cli", "device.get", false, "bad_params"],
    ]);
    const demo = await createEngine({ backend: createDemoBackend(), commands }).execute<{ password: string }>("wifi.password.get");
    expect(demo.ok).toBe(true);
    if (demo.ok) expect(await readFile(path, "utf8")).not.toContain(demo.result.password);
    if (process.platform !== "win32") expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("an MCP tool call is logged with surface mcp and its password removed", async () => {
    const audit = memoryAudit();
    const engine = createEngine({ backend: createDemoBackend(), commands, surface: "mcp", audit });
    const server = createMcpServer(engine);
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "1.0.0" });
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
    try {
      await client.callTool({ name: "network_get", arguments: {} });
      await client.callTool({ name: "guest_password_set", arguments: { password: SECRET, confirm: true } });
    } finally {
      await client.close();
    }
    expect(audit.entries.map((e) => [e.surface, e.id, e.ok, e.params])).toEqual([
      ["mcp", "network.get", true, {}],
      ["mcp", "guest.password.set", true, { password: "[removed]", confirm: true }],
    ]);
    expect(JSON.stringify(audit.entries)).not.toContain(SECRET);
  });
});

describe("fileAudit", () => {
  it("keeps the newest lines under the cap", async () => {
    const path = join(dir, "nested", "audit.jsonl");
    const log = fileAudit(path, 10);
    for (let i = 0; i < 40; i++) {
      await log.append({ time: new Date(i).toISOString(), surface: "cli", id: `n.${i}`, effect: "query", ok: true, params: {} });
    }
    const lines = await readLines(path);
    expect(lines.length).toBeGreaterThanOrEqual(10);
    expect(lines.length).toBeLessThanOrEqual(11);
    expect(lines.at(-1)?.id).toBe("n.39");
    // A new log over an existing file counts what is there.
    const again = fileAudit(path, 10);
    for (let i = 40; i < 45; i++) await again.append({ time: new Date(i).toISOString(), surface: "mcp", id: `n.${i}`, effect: "query", ok: true, params: {} });
    expect((await readLines(path)).length).toBeLessThanOrEqual(11);
  });
});
