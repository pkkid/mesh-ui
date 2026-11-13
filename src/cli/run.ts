/**
 * The built-in subcommands: `run`, `commands`, `help`, `status`, `login` and
 * `logout`. Each one only calls `engine.execute` or `engine.commands`; no
 * logic a command owns lives here. See docs/architecture/cli.md.
 */

import { readFile } from "node:fs/promises";
import type { ExecuteError, ExecuteResult } from "../core/errors";
import type { CommandInfo } from "../core/registry";
import { USAGE } from "./args";
import { errorLine, json, maskSensitive, prettyJson, renderGrid, renderTable } from "./format";
import { type CliContext, type CliIo, EXIT, exitFor } from "./index";
import { runScript } from "./script";

/** A usage problem found before anything ran (bad params JSON, missing file). */
export class UsageError extends Error {}

type Params = Record<string, unknown>;

const isPlainObject = (v: unknown): v is Params => v !== null && typeof v === "object" && !Array.isArray(v);

/** `--params` as inline JSON, `@file` or `-` (stdin). Always an object. */
export async function readParams(source: string | null, ctx: CliContext): Promise<Params> {
  if (source === null) return {};
  let text: string;
  if (source === "-") text = await ctx.host.readStdin();
  else if (source.startsWith("@")) {
    try {
      text = await readFile(source.slice(1), "utf8");
    } catch {
      throw new UsageError(`Cannot read params file ${source.slice(1)}.`);
    }
  } else text = source;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new UsageError("--params is not valid JSON.");
  }
  if (!isPlainObject(value)) throw new UsageError("--params must be a JSON object.");
  return value;
}

/**
 * Adds `--network` as `networkId` unless the params already name one. Only
 * for commands that take a network, so `--network` never breaks an account
 * or app command.
 */
export function withNetwork(params: Params, ctx: CliContext, command: CommandInfo | undefined): Params {
  const network = ctx.args.flags.network;
  const takesNetwork = command !== undefined && "networkId" in ((command.params.properties ?? {}) as object);
  return network && takesNetwork && params.networkId === undefined ? { ...params, networkId: network } : params;
}

/** Prints a usage problem in the chosen format and returns exit 2. */
export function usage(io: CliIo, ctx: CliContext, message: string): number {
  const error: ExecuteError = { code: "bad_params", message };
  if (ctx.format === "json" && !ctx.args.flags.quiet) io.stdout(json({ ok: false, error }));
  else io.stderr(errorLine(error, ctx.style));
  return EXIT.usage;
}

/** Prints one execute result and returns its exit code. */
export function report(result: ExecuteResult, io: CliIo, ctx: CliContext, sensitive = false): number {
  const { quiet, reveal } = ctx.args.flags;
  if (!result.ok) {
    if (ctx.format === "json" && !quiet) io.stdout(json(result));
    else io.stderr(errorLine(result.error, ctx.style));
    return exitFor(result.error.code);
  }
  if (quiet) return EXIT.ok;
  if (ctx.format === "json") io.stdout(json(result));
  else io.stdout(renderTable(sensitive && !reveal ? maskSensitive(result.result) : result.result, ctx.style, Date.now()));
  return EXIT.ok;
}

async function info(ctx: CliContext, id: string): Promise<CommandInfo | undefined> {
  return (await ctx.engine()).commands().find((c) => c.id === id);
}

/** Runs one command id with the CLI's params, network and confirm flags. */
async function runOne(io: CliIo, ctx: CliContext, id: string): Promise<number> {
  let params: Params;
  try {
    params = await readParams(ctx.args.flags.params, ctx);
  } catch (err) {
    if (err instanceof UsageError) return usage(io, ctx, err.message);
    throw err;
  }
  const command = await info(ctx, id);
  params = withNetwork(params, ctx, command);
  if (ctx.args.flags.confirm) params = { ...params, confirm: true };
  const result = await (await ctx.engine()).execute(id, params);
  return report(result, io, ctx, command?.sensitive === true);
}

/** Script targets: a file ending .jsonl, a path, or - for stdin. */
const isScript = (target: string) => target === "-" || target.endsWith(".jsonl") || /[\\/]/.test(target);

export async function runRun(_argv: string[], io: CliIo, ctx: CliContext): Promise<number> {
  const [, target, extra] = ctx.args.positionals;
  if (!target) return usage(io, ctx, "run needs a command id or a script file.");
  if (extra) return usage(io, ctx, `Unexpected argument "${extra}".`);
  if (isScript(target)) return runScript(io, ctx, target);
  return runOne(io, ctx, target);
}

export async function runCommands(_argv: string[], io: CliIo, ctx: CliContext): Promise<number> {
  if (ctx.args.positionals.length > 1) return usage(io, ctx, "commands takes no arguments.");
  const list = (await ctx.engine()).commands();
  if (ctx.args.flags.quiet) return EXIT.ok;
  if (ctx.format === "json") io.stdout(json(list));
  else if (list.length === 0) io.stdout("No commands.\n");
  else io.stdout(renderGrid(["ID", "EFFECT", "LABEL"], list.map((c) => [c.id, c.effect, c.label]), ctx.style));
  return EXIT.ok;
}

/** An example params object from a JSON Schema: required keys with placeholder values. */
function example(schema: Record<string, unknown>): Params {
  const props = (schema.properties ?? {}) as Record<string, { type?: string; enum?: unknown[] }>;
  const required = new Set((schema.required ?? []) as string[]);
  const out: Params = {};
  for (const [key, prop] of Object.entries(props)) {
    if (!required.has(key)) continue;
    if (prop.enum?.length) out[key] = prop.enum[0];
    else if (prop.type === "boolean") out[key] = true;
    else if (prop.type === "number" || prop.type === "integer") out[key] = 1;
    else out[key] = `<${key}>`;
  }
  return out;
}

export async function runHelp(_argv: string[], io: CliIo, ctx: CliContext): Promise<number> {
  const topic = ctx.args.positionals[1];
  if (!topic || topic in { commands: 1, run: 1, login: 1, logout: 1, status: 1, mcp: 1, help: 1 }) {
    io.stdout(USAGE);
    return EXIT.ok;
  }
  const command = await info(ctx, topic);
  if (!command) {
    io.stderr(`No command "${topic}". Run mesh-ui commands for the list.\n`);
    return EXIT.usage;
  }
  if (ctx.format === "json") {
    io.stdout(json(command));
    return EXIT.ok;
  }
  const params = example(command.params);
  const quoted = Object.keys(params).length ? ` --params '${JSON.stringify(params)}'` : "";
  const confirm = command.effect === "disruptive" || command.effect === "destructive" ? " --confirm" : "";
  const lines = [`${command.id}  ${command.label}`];
  if (command.description) lines.push(command.description);
  lines.push(`Effect: ${command.effect}`, "", "Params (JSON Schema):", prettyJson(command.params).trimEnd(), "");
  lines.push("Example:", `  mesh-ui run ${command.id}${quoted}${confirm}`, "");
  io.stdout(lines.join("\n"));
  return EXIT.ok;
}

/** `status`: auth.status plus the selected network. */
export async function runStatus(_argv: string[], io: CliIo, ctx: CliContext): Promise<number> {
  const engine = await ctx.engine();
  const result = await engine.execute("auth.status", {});
  if (!result.ok) return report(result, io, ctx);
  const status = isPlainObject(result.result) ? result.result : { status: result.result };
  return report({ ok: true, result: { ...status, networkId: engine.selectedNetworkId() } }, io, ctx);
}

export async function runLogout(_argv: string[], io: CliIo, ctx: CliContext): Promise<number> {
  return report(await (await ctx.engine()).execute("auth.logout", {}), io, ctx);
}

const MAX_CODE_TRIES = 3;

/** `login`: asks for the email or phone, sends the code, then asks for the code. */
export async function runLogin(_argv: string[], io: CliIo, ctx: CliContext): Promise<number> {
  const engine = await ctx.engine();
  const login = (await ctx.host.prompt("Email or phone: "))?.trim();
  if (!login) return usage(io, ctx, "No email or phone given.");
  const started = await engine.execute("auth.login.start", { login });
  if (!started.ok) return report(started, io, ctx);
  for (let attempt = 1; ; attempt++) {
    const code = (await ctx.host.prompt("Code: "))?.trim();
    if (!code) return usage(io, ctx, "No code given.");
    const verified = await engine.execute("auth.login.verify", { code });
    if (verified.ok || verified.error.code !== "eero_error" || attempt >= MAX_CODE_TRIES) return report(verified, io, ctx);
    io.stderr(errorLine(verified.error, ctx.style));
  }
}
