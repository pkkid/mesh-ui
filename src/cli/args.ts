/**
 * Argument parsing for `mesh-ui`. Global flags may appear anywhere on the
 * line (`mesh-ui --demo run x` and `mesh-ui run x --demo` are the same).
 * Flags this file does not know are kept in `unknown` so a subcommand with
 * its own flags (`mcp --read-only`) can read them; the built-in subcommands
 * refuse them as usage errors. See docs/architecture/cli.md#usage.
 */

export type Format = "json" | "table";

export type CliFlags = {
  demo: boolean;
  fake: boolean;
  network: string | null;
  format: Format | null;
  quiet: boolean;
  noColor: boolean;
  version: boolean;
  help: boolean;
  userDataDir: string | null;
  // run options
  params: string | null;
  confirm: boolean;
  reveal: boolean;
  keepGoing: boolean;
};

export type ParsedArgs = {
  flags: CliFlags;
  /** Words that are not flags or flag values: the subcommand and its arguments. */
  positionals: string[];
  /** Flags this parser does not know, as written. */
  unknown: string[];
  /** A malformed known flag (missing value, bad format). */
  error: string | null;
};

type BoolFlag = "demo" | "fake" | "quiet" | "noColor" | "version" | "help" | "confirm" | "reveal" | "keepGoing";
type ValueFlag = "network" | "format" | "params" | "userDataDir";

const BOOL_FLAGS: Record<string, BoolFlag> = {
  "--demo": "demo",
  "--fake": "fake",
  "--quiet": "quiet",
  "--no-color": "noColor",
  "--version": "version",
  "--help": "help",
  "-h": "help",
  "--confirm": "confirm",
  "--reveal": "reveal",
  "--keep-going": "keepGoing",
};

const VALUE_FLAGS: Record<string, ValueFlag> = {
  "--network": "network",
  "--format": "format",
  "--params": "params",
  "--user-data-dir": "userDataDir",
};

/**
 * Switches the Electron launcher may leave on the line (Chromium options and
 * the `--cli` hand-off flag). They are not ours, so they are skipped quietly.
 */
const HOST_SWITCHES = /^--(cli|no-sandbox|enable-logging|disable-gpu|ozone-platform|password-store|inspect(-brk)?)(=.*)?$/;

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const flags: CliFlags = {
    demo: false,
    fake: false,
    network: null,
    format: null,
    quiet: false,
    noColor: false,
    version: false,
    help: false,
    userDataDir: null,
    params: null,
    confirm: false,
    reveal: false,
    keepGoing: false,
  };
  const positionals: string[] = [];
  const unknown: string[] = [];
  let error: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    // A lone "-" is a value (stdin), not a flag.
    if (arg === "-" || !arg.startsWith("-")) {
      positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq > 0 ? arg.slice(0, eq) : arg;
    const bool = BOOL_FLAGS[name];
    if (bool) {
      if (eq > 0) error ??= `${name} takes no value.`;
      flags[bool] = true;
      continue;
    }
    const valued = VALUE_FLAGS[name];
    if (valued) {
      let value: string | undefined;
      if (eq > 0) value = arg.slice(eq + 1);
      else if (i + 1 < argv.length) value = argv[++i];
      if (value === undefined || value === "") {
        error ??= `${name} needs a value.`;
        continue;
      }
      if (valued === "format") {
        if (value !== "json" && value !== "table") {
          error ??= `--format must be json or table, not "${value}".`;
          continue;
        }
        flags.format = value;
      } else {
        flags[valued] = value;
      }
      continue;
    }
    if (HOST_SWITCHES.test(arg)) continue;
    unknown.push(arg);
  }
  return { flags, positionals, unknown, error };
}

export const USAGE = `mesh-ui <command> [options]

Commands
  commands                 List every command (id, label, effect, params schema)
  run <id>                 Run one command
  run <file.jsonl>         Run a script, one command per line (- reads stdin)
  login                    Sign in interactively (email or phone, then code)
  logout                   Sign out and forget the saved session
  status                   Show sign-in state, storage and selected network
  mcp                      Start the MCP server on stdio
  help [command]           Show help

Global options
  --demo                   Use the demo backend (also MESH_UI_DEMO=1)
  --fake                   Dev builds only: use the local fake eero server
  --network <id|name>      Network for this run (default: the selected one)
  --format <json|table>    Output format (default: table on a TTY, json otherwise)
  --quiet                  Print nothing on success; errors still go to stderr
  --no-color               Disable colour (also NO_COLOR=1)
  --version                Print the version
  -h, --help               Help

run options
  --params <json|@file|->  Params as JSON, from a file, or from stdin
  --confirm                Allow a disruptive or destructive command
  --reveal                 Show sensitive values (passwords) in table output
  --keep-going             Scripts: continue after a failed line

On Windows PowerShell, wrap JSON params in single quotes or use --params @file.json.
`;
