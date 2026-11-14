/**
 * CLI `--confirm` and MCP `confirm: true` behave the same (M4 done-when).
 * Each surface runs on its own demo backend with a fixed clock; a fresh
 * reference engine on that backend gives the engine's own needs_confirm
 * message and a snapshot of the state, so "changes nothing" is checked
 * against what the surface left behind.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import type { Backend } from "../core/backend";
import { createDemoBackend } from "../core/demo";
import { createEngine } from "../core/engine";
import { toolName } from "../core/mcpNames";
import type * as M from "../core/model";
import { EXIT, nodeHost, runCli } from "./index";
import { createMcpServer, toTool } from "./mcp";

const NOW = Date.parse("2026-11-12T22:41:00Z");
const fresh = (): Backend => createDemoBackend({ clock: () => NOW });

type Case = { id: string; params: Record<string, unknown>; effect: M.Effect };

/** One disruptive, one destructive and one write command. */
const CASES: Case[] = [
  { id: "network.restart", params: {}, effect: "disruptive" },
  { id: "profile.delete", params: { profile: "Leo" }, effect: "destructive" },
];
const WRITE: Case = { id: "device.pause", params: { devices: "Alex's MacBook Pro" }, effect: "write" };

/** A new engine each time, so no query cache hides a change. */
const reference = (backend: Backend) => createEngine({ backend, surface: "cli", clock: () => NOW });

/** What the three commands touch: network status, profiles, devices' paused flags. */
async function snapshot(backend: Backend): Promise<unknown> {
  const engine = reference(backend);
  const read = async (id: string) => {
    const r = await engine.execute(id, {});
    if (!r.ok) throw new Error(`${id}: ${r.error.code}`);
    return r.result;
  };
  const network = (await read("network.get")) as M.Network;
  const { devices } = (await read("device.list")) as M.DeviceList;
  return {
    network: { status: network.status, lastReboot: network.lastReboot },
    profiles: await read("profile.list"),
    paused: devices.map((d) => [d.id, d.paused]),
  };
}

/** The message the engine itself gives for a call without confirm. */
async function engineMessage(backend: Backend, c: Case): Promise<string> {
  const r = await reference(backend).execute(c.id, c.params);
  if (r.ok || r.error.code !== "needs_confirm") throw new Error(`${c.id} did not ask for confirm`);
  return r.error.message;
}

async function cli(backend: Backend, c: Case, confirm: boolean) {
  let stdout = "";
  let stderr = "";
  const argv = ["--demo", "--format", "json", "run", c.id, "--params", JSON.stringify(c.params), ...(confirm ? ["--confirm"] : [])];
  const code = await runCli(
    argv,
    { stdout: (s) => void (stdout += s), stderr: (s) => void (stderr += s) },
    nodeHost({ demoBackend: () => backend }),
  );
  return { code, out: JSON.parse(stdout) as { ok: boolean; result?: unknown; error?: { code: string; message: string } }, stderr };
}

async function mcp(backend: Backend, c: Case, confirm: boolean): Promise<CallToolResult> {
  const engine = createEngine({ backend, surface: "mcp", clock: () => NOW });
  const server = createMcpServer(engine);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "M4.R-fix-confirm", version: "1.0.0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  try {
    return (await client.callTool({ name: toolName(c.id), arguments: { ...c.params, ...(confirm ? { confirm: true } : {}) } })) as CallToolResult;
  } finally {
    await client.close();
  }
}

const mcpError = (r: CallToolResult) => JSON.parse((r.content[0] as { text: string }).text) as { code: string; message: string };

describe.each(CASES)("$id ($effect): CLI and MCP confirm parity", (c) => {
  it("CLI without --confirm exits needs_confirm with the engine's message and changes nothing; with --confirm it runs", async () => {
    const backend = fresh();
    const message = await engineMessage(backend, c);
    const before = await snapshot(backend);

    const ask = await cli(backend, c, false);
    expect(ask.code).toBe(EXIT.needsConfirm);
    expect(ask.out).toEqual({ ok: false, error: { code: "needs_confirm", message } });
    expect(await snapshot(backend)).toEqual(before);

    const run = await cli(backend, c, true);
    expect(run.code).toBe(EXIT.ok);
    expect(run.out.ok).toBe(true);
    expect(await snapshot(backend)).not.toEqual(before);
  });

  it("MCP without confirm returns the same needs_confirm code and message and changes nothing; with confirm: true it runs", async () => {
    const backend = fresh();
    const message = await engineMessage(backend, c);
    const before = await snapshot(backend);

    const ask = await mcp(backend, c, false);
    expect(ask.isError).toBe(true);
    expect(mcpError(ask)).toEqual({ code: "needs_confirm", message });
    expect(await snapshot(backend)).toEqual(before);

    const run = await mcp(backend, c, true);
    expect(run.isError).toBeFalsy();
    expect(await snapshot(backend)).not.toEqual(before);
  });

  it("both surfaces give the same message and the same result", async () => {
    const [a, b] = [fresh(), fresh()];
    const viaCli = await cli(a, c, false);
    const viaMcp = mcpError(await mcp(b, c, false));
    expect(viaCli.out.error).toEqual(viaMcp);

    const ranCli = await cli(a, c, true);
    const ranMcp = await mcp(b, c, true);
    expect(ranMcp.structuredContent).toEqual(ranCli.out.result);
    expect(await snapshot(a)).toEqual(await snapshot(b));
  });
});

describe(`${WRITE.id} (write) needs no confirm on either surface`, () => {
  it("runs from the CLI without --confirm", async () => {
    const backend = fresh();
    const before = await snapshot(backend);
    const run = await cli(backend, WRITE, false);
    expect(run.code).toBe(EXIT.ok);
    expect(run.out.ok).toBe(true);
    expect(await snapshot(backend)).not.toEqual(before);
  });

  it("runs from MCP without confirm, and its tool does not require one", async () => {
    const backend = fresh();
    const before = await snapshot(backend);
    const run = await mcp(backend, WRITE, false);
    expect(run.isError).toBeFalsy();
    expect(await snapshot(backend)).not.toEqual(before);

    const info = reference(fresh()).commands().find((x) => x.id === WRITE.id);
    if (!info) throw new Error("no device.pause");
    const schema = toTool(info).inputSchema;
    expect(schema.properties).not.toHaveProperty("confirm");
    expect(schema.required ?? []).not.toContain("confirm");

    const [a, b] = [fresh(), fresh()];
    expect((await mcp(b, WRITE, false)).structuredContent).toEqual((await cli(a, WRITE, false)).out.result);
  });
});
