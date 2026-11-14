/**
 * Keeps the `--cli` host headless (docs/architecture/cli.md#how-the-cli-runs).
 *
 * The CLI and MCP surfaces never show UI. By default Electron shows a native
 * "A JavaScript error occurred in the main process" box for an uncaught
 * exception in main, and anything may call `dialog.showErrorBox`. In CLI mode
 * both go to stderr instead and the process exits non-zero.
 *
 * Only the error's first message line is printed, never a stack or the
 * error's other fields, so no token or network data can ride along.
 */

/** The bits of Electron's `dialog` this touches. */
export type ErrorBoxDialog = { showErrorBox(title: string, content: string): void };

/** The bits of `process` this touches. */
export type GuardedProcess = {
  on(event: "uncaughtException" | "unhandledRejection", listener: (reason: unknown) => void): unknown;
};

export type CliGuardDeps = {
  dialog: ErrorBoxDialog;
  process: GuardedProcess;
  stderr(text: string): void;
  exit(code: number): void;
};

/** Exit code for a crash in the CLI host (EXIT.failed in src/cli). */
export const CLI_CRASH_EXIT = 1;

const MAX_MESSAGE = 300;

/** One short line for an error: the first line of its message, capped. */
export function crashLine(reason: unknown): string {
  const raw = reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "unexpected error";
  const first = (raw.split("\n")[0] ?? "").trim() || "unexpected error";
  return first.length > MAX_MESSAGE ? `${first.slice(0, MAX_MESSAGE)}...` : first;
}

/** Routes every error box and uncaught error in the CLI host to stderr. */
export function guardCliHost(deps: CliGuardDeps): void {
  let exiting = false;
  deps.dialog.showErrorBox = (title, content) => {
    deps.stderr(`mesh-ui: ${crashLine(title)}${content ? `: ${crashLine(content)}` : ""}\n`);
  };
  const crash = (reason: unknown) => {
    if (exiting) return;
    exiting = true;
    deps.stderr(`mesh-ui: internal error: ${crashLine(reason)}\n`);
    deps.exit(CLI_CRASH_EXIT);
  };
  deps.process.on("uncaughtException", crash);
  deps.process.on("unhandledRejection", crash);
}
