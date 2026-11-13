/**
 * `mesh-ui run file.jsonl`: one `{ "id", "params" }` per line, run in order
 * through the same `engine.execute`. Stops at the first failed line (exit 10)
 * unless `--keep-going`. Confirmation is per line: a global `--confirm` is
 * refused so one flag cannot approve a file nobody read.
 * See docs/architecture/cli.md#scripts.
 */

import { readFile } from "node:fs/promises";
import type { ExecuteResult } from "../core/errors";
import { errorLine, json, maskSensitive, renderTable } from "./format";
import { type CliContext, type CliIo, EXIT } from "./index";
import { usage, withNetwork } from "./run";

type Line = { line: number; id: string | null; result: ExecuteResult };

const isPlainObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/** Parses one script line into an id and params, or a bad_params result. */
function parseLine(text: string): { id: string; params: Record<string, unknown> } | { id: string | null; error: string } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { id: null, error: "Line is not valid JSON." };
  }
  if (!isPlainObject(value) || typeof value.id !== "string") return { id: null, error: 'Line needs an "id" string.' };
  if (value.params !== undefined && !isPlainObject(value.params)) return { id: value.id, error: '"params" must be an object.' };
  return { id: value.id, params: (value.params as Record<string, unknown> | undefined) ?? {} };
}

export async function runScript(io: CliIo, ctx: CliContext, target: string): Promise<number> {
  const { confirm, params, keepGoing, quiet, reveal } = ctx.args.flags;
  if (confirm) {
    return usage(io, ctx, 'A global --confirm is refused for scripts. Add "confirm": true to each line that needs it.');
  }
  if (params !== null) return usage(io, ctx, "--params does not apply to scripts; put params on each line.");

  let text: string;
  if (target === "-") text = await ctx.host.readStdin();
  else {
    try {
      text = await readFile(target, "utf8");
    } catch {
      return usage(io, ctx, `Cannot read script ${target}.`);
    }
  }

  const engine = await ctx.engine();
  const infos = new Map(engine.commands().map((c) => [c.id, c]));
  const print = ({ line, id, result }: Line) => {
    if (!result.ok) {
      if (ctx.format === "json" && !quiet) io.stdout(json({ line, id, ...result }));
      else io.stderr(errorLine({ ...result.error, message: `line ${line}: ${result.error.message}` }, ctx.style));
      return;
    }
    if (quiet) return;
    if (ctx.format === "json") io.stdout(json({ line, id, ...result }));
    else {
      const shown = id && infos.get(id)?.sensitive && !reveal ? maskSensitive(result.result) : result.result;
      io.stdout(`# line ${line}: ${id}\n${renderTable(shown, ctx.style, Date.now())}`);
    }
  };

  let failed = false;
  const lines = text.split(/\r?\n/);
  for (const [i, raw] of lines.entries()) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parsed = parseLine(trimmed);
    const line = i + 1;
    const result: ExecuteResult =
      "error" in parsed
        ? { ok: false, error: { code: "bad_params", message: parsed.error } }
        : await engine.execute(parsed.id, withNetwork(parsed.params, ctx, infos.get(parsed.id)));
    print({ line, id: parsed.id, result });
    if (!result.ok) {
      failed = true;
      if (!keepGoing) break;
    }
  }
  return failed ? EXIT.scriptFailed : EXIT.ok;
}
