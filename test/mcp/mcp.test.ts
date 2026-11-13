import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { composeBackend } from "../../src/core/backend";
import { createEngine } from "../../src/core/engine";
import type { NetworkSummary } from "../../src/core/model";
import { type AnyCommand, defineCommand } from "../../src/core/spec";
import { createMcpServer, type McpOptions, parseMcpArgs, toolName } from "../../src/cli/mcp";

const network = (id: string, name: string): NetworkSummary => ({
  id,
  name,
  nickname: null,
  role: "owner",
  status: "online",
  eeroCount: 1,
  devicesOnline: 1,
  isp: null,
  updateAvailable: null,
  lastSeen: null,
  selected: false,
});

const ran: { id: string; params: unknown }[] = [];

/** Test commands, one per effect, in a fresh registry. */
const specs: AnyCommand[] = [
  defineCommand({
    id: "thing.list",
    label: "List things",
    description: "Lists the things.",
    params: z.object({ limit: z.number().int().optional() }),
    effect: "query",
    run: async (ctx, p) => {
      ran.push({ id: "thing.list", params: p });
      return { networkId: ctx.networkId, things: ["a", "b"].slice(0, p.limit ?? 2) };
    },
  }),
  defineCommand({
    id: "thing.names",
    label: "Thing names",
    params: z.object({}),
    effect: "query",
    scope: "account",
    run: async () => ["a", "b"],
  }),
  defineCommand({
    id: "thing.rename",
    label: "Rename thing",
    params: z.object({ name: z.string() }),
    effect: "write",
    scope: "account",
    run: async (_ctx, p) => ({ renamed: p.name }),
  }),
  defineCommand({
    id: "thing.restart",
    label: "Restart thing",
    description: "Restarts the thing; clients reconnect.",
    params: z.object({ thing: z.string() }),
    effect: "disruptive",
    scope: "account",
    run: async (_ctx, p) => {
      ran.push({ id: "thing.restart", params: p });
      return { restarted: p.thing };
    },
  }),
  defineCommand({
    id: "thing.remove",
    label: "Remove thing",
    params: z.object({}),
    effect: "destructive",
    scope: "account",
    run: async () => ({ removed: true }),
  }),
  defineCommand({
    id: "wifi.password.get",
    label: "Wi-Fi password",
    params: z.object({}),
    effect: "query",
    scope: "account",
    sensitive: true,
    run: async () => ({ password: "fixture-only" }),
  }),
  defineCommand({ id: "app.info", label: "App info", params: z.object({}), effect: "query", scope: "app", run: async () => ({ v: 1 }) }),
  defineCommand({ id: "auth.login.start", label: "Sign in", params: z.object({ login: z.string() }), effect: "write", scope: "account", run: async () => null }),
  defineCommand({ id: "auth.login.verify", label: "Verify", params: z.object({ code: z.string() }), effect: "write", scope: "account", run: async () => null }),
  defineCommand({ id: "app.cli.install", label: "Install CLI", params: z.object({}), effect: "write", scope: "app", run: async () => null }),
];

function makeEngine() {
  const backend = composeBackend("demo", {
    auth: {
      status: async () => ({ signedIn: true, pending: false, login: null, storage: "memory" }),
      start: async () => {},
      verify: async () => {},
      resend: async () => {},
      logout: async () => {},
    },
    network: {
      list: async () => [network("n1", "Maple Street"), network("n2", "Lake Cabin")],
    } as never,
  });
  return createEngine({ backend, commands: specs, surface: "mcp" });
}

const clients: Client[] = [];

async function connect(opts: McpOptions = {}) {
  const server = createMcpServer(makeEngine(), opts);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  clients.push(client);
  return client;
}

afterEach(async () => {
  ran.length = 0;
  await Promise.all(clients.splice(0).map((c) => c.close()));
});

const text = (res: Awaited<ReturnType<Client["callTool"]>>) => JSON.parse((res.content as { text: string }[])[0]?.text ?? "null");

describe("mcp tools", () => {
  it("lists one tool per command, named from the id, without the sign-in and install commands", async () => {
    const { tools } = await (await connect()).listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["app_info", "thing_list", "thing_names", "thing_remove", "thing_rename", "thing_restart", "wifi_password_get"].sort(),
    );
    expect(toolName("settings.dns.set")).toBe("settings_dns_set");
  });

  it("builds title, description and input schema from the spec", async () => {
    const { tools } = await (await connect()).listTools();
    const list = tools.find((t) => t.name === "thing_list");
    expect(list?.title).toBe("List things");
    expect(list?.description).toContain("Lists the things. Read-only.");
    expect(list?.inputSchema).toMatchObject({
      type: "object",
      properties: { limit: { type: "integer" }, networkId: { type: "string" } },
      additionalProperties: false,
    });
    expect(list?.inputSchema.required).toBeUndefined();

    const restart = tools.find((t) => t.name === "thing_restart");
    expect(restart?.description).toContain("Requires confirm: true.");
    expect(restart?.inputSchema.properties?.confirm).toEqual({
      type: "boolean",
      description: "Set true only after the user has approved this action.",
    });
    expect(restart?.inputSchema.required).toEqual(["thing", "confirm"]);
    expect(tools.find((t) => t.name === "thing_remove")?.inputSchema.required).toEqual(["confirm"]);
    expect(tools.find((t) => t.name === "thing_rename")?.inputSchema.properties?.confirm).toBeUndefined();
    expect(tools.find((t) => t.name === "wifi_password_get")?.description).toContain("The result contains a Wi-Fi password.");
  });

  it("derives annotations from the effect", async () => {
    const { tools } = await (await connect()).listTools();
    const ann = (name: string) => tools.find((t) => t.name === name)?.annotations;
    expect(ann("thing_list")).toMatchObject({ readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: true });
    expect(ann("thing_rename")).toMatchObject({ readOnlyHint: false, idempotentHint: false, destructiveHint: false, openWorldHint: true });
    expect(ann("thing_restart")).toMatchObject({ readOnlyHint: false, idempotentHint: false, destructiveHint: true, openWorldHint: true });
    expect(ann("thing_remove")).toMatchObject({ readOnlyHint: false, idempotentHint: false, destructiveHint: true, openWorldHint: true });
    expect(ann("app_info")).toMatchObject({ readOnlyHint: true, openWorldHint: false });
  });
});

describe("mcp calls", () => {
  it("runs a query and returns structured content plus the same JSON as text", async () => {
    const res = await (await connect()).callTool({ name: "thing_list", arguments: { limit: 1 } });
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toEqual({ networkId: "n1", things: ["a"] });
    expect(text(res)).toEqual(res.structuredContent);
  });

  it("wraps non-object results for structured content", async () => {
    const res = await (await connect()).callTool({ name: "thing_names", arguments: {} });
    expect(res.structuredContent).toEqual({ result: ["a", "b"] });
    expect(text(res)).toEqual(["a", "b"]);
  });

  it("refuses a disruptive tool without confirm and runs it with confirm", async () => {
    const client = await connect();
    const without = await client.callTool({ name: "thing_restart", arguments: { thing: "x" } });
    expect(without.isError).toBe(true);
    expect(text(without)).toMatchObject({ code: "needs_confirm" });
    const falsy = await client.callTool({ name: "thing_restart", arguments: { thing: "x", confirm: false } });
    expect(text(falsy)).toMatchObject({ code: "needs_confirm" });
    expect(ran).toEqual([]);

    const withConfirm = await client.callTool({ name: "thing_restart", arguments: { thing: "x", confirm: true } });
    expect(withConfirm.isError).toBeFalsy();
    expect(withConfirm.structuredContent).toEqual({ restarted: "x" });
    expect(ran).toEqual([{ id: "thing.restart", params: { thing: "x" } }]);
  });

  it("refuses a destructive tool without confirm", async () => {
    const res = await (await connect()).callTool({ name: "thing_remove", arguments: {} });
    expect(text(res)).toMatchObject({ code: "needs_confirm" });
  });

  it("returns engine errors as tool errors, not protocol errors", async () => {
    const client = await connect();
    const bad = await client.callTool({ name: "thing_list", arguments: { limit: "two" } });
    expect(bad.isError).toBe(true);
    expect(text(bad)).toMatchObject({ code: "bad_params" });
    const unknown = await client.callTool({ name: "auth_login_start", arguments: { login: "x" } });
    expect(text(unknown)).toMatchObject({ code: "unknown_command" });
  });
});

describe("mcp options", () => {
  it("--read-only lists only query tools and refuses the rest", async () => {
    const client = await connect({ readOnly: true });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["app_info", "thing_list", "thing_names", "wifi_password_get"]);
    expect(tools.every((t) => t.annotations?.readOnlyHint)).toBe(true);
    const res = await client.callTool({ name: "thing_restart", arguments: { thing: "x", confirm: true } });
    expect(text(res)).toMatchObject({ code: "unknown_command" });
    expect(ran).toEqual([]);
  });

  it("--allow exposes only matching ids", async () => {
    const { tools } = await (await connect({ allow: ["thing.*", "app.info"] })).listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["app_info", "thing_list", "thing_names", "thing_remove", "thing_rename", "thing_restart"]);
    const narrow = await (await connect({ allow: ["thing.re*"] })).listTools();
    expect(narrow.tools.map((t) => t.name).sort()).toEqual(["thing_remove", "thing_rename", "thing_restart"]);
  });

  it("--network is the default networkId for network tools, and an explicit one wins", async () => {
    const client = await connect({ network: "Lake Cabin" });
    expect((await client.callTool({ name: "thing_list", arguments: {} })).structuredContent).toMatchObject({ networkId: "n2" });
    expect((await client.callTool({ name: "thing_list", arguments: { networkId: "n1" } })).structuredContent).toMatchObject({ networkId: "n1" });
  });

  it("parses the flags", () => {
    expect(parseMcpArgs(["mcp", "--read-only", "--allow", "device.*,profile.*", "--network=Home"], {})).toEqual({
      demo: false,
      readOnly: true,
      allow: ["device.*", "profile.*"],
      network: "Home",
    });
    expect(parseMcpArgs(["--demo", "mcp"], {}).demo).toBe(true);
    expect(parseMcpArgs(["mcp"], { MESH_UI_DEMO: "1" }).demo).toBe(true);
    expect(() => parseMcpArgs(["mcp", "--network"], {})).toThrow("--network needs a value.");
  });
});
