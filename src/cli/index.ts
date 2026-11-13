/**
 * The `mesh-ui` CLI entry. The Electron host calls `runCli(argv)` for
 * `--cli` (no window) and exits with the code it returns. This is the stub
 * that M1.5 fills in; see docs/architecture/cli.md.
 */

export type CliIo = {
  stdout(text: string): void;
  stderr(text: string): void;
};

/** A subcommand gets the full argv (global flags included) and returns an exit code. */
export type Subcommand = (argv: string[], io: CliIo) => Promise<number>;

/** Exit codes from docs/architecture/cli.md#exit-codes. */
export const EXIT = {
  ok: 0,
  failed: 1,
  usage: 2,
  needsConfirm: 3,
  notSignedIn: 4,
  rateLimited: 5,
  scriptFailed: 10,
  interrupted: 130,
} as const;

/** Subcommands, one line each, alphabetical: `mcp: runMcp,` */
const subcommands: Record<string, Subcommand> = {
  mcp: (argv, io) => import("./mcp").then((m) => m.runMcp(argv, io)),
};

const defaultIo: CliIo = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};

export async function runCli(argv: string[], io: CliIo = defaultIo): Promise<number> {
  const name = argv.find((a) => !a.startsWith("-"));
  const run = name ? subcommands[name] : undefined;
  if (!run) {
    const known = Object.keys(subcommands).sort().join(", ") || "none yet";
    io.stderr(`${name ? `Unknown command "${name}". ` : ""}Usage: mesh-ui <command> [options]. Commands: ${known}.\n`);
    return EXIT.usage;
  }
  return run(argv, io);
}
