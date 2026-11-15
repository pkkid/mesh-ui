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

/**
 * How long a Windows CLI run stays up after `ready` before it may exit.
 *
 * Exiting Electron within a few milliseconds of `ready` races Chromium's own
 * startup work (the network service, disk caches and GPU host that touching
 * `session.defaultSession` sets going). On Windows that race faults in the
 * main process with 0xC0000005 in about a third of `--cli --version` runs,
 * after the output is written, so the real exit code is lost. A stock
 * Electron 45 app that touches the session and exits at once crashed 5 of
 * 12 times on windows-latest; the same app waiting 300 ms first, 0 of 12.
 * macOS and Linux do not crash and exit at once.
 */
export const WIN_EXIT_SETTLE_MS = 500;

/** Milliseconds to wait before exiting: what is left of the settle time on Windows, else 0. */
export function cliExitDelay(platform: NodeJS.Platform, readyAt: number | null, now: number): number {
  if (platform !== "win32" || readyAt === null) return 0;
  return Math.max(0, readyAt + WIN_EXIT_SETTLE_MS - now);
}
