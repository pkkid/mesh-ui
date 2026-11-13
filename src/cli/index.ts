/**
 * The `mesh-ui` CLI entry. The Electron host calls `runCli(argv, io, host)`
 * for `--cli` (no window) and exits with the code it returns; `cliMain` does
 * that for a whole process. See docs/architecture/cli.md.
 *
 * The host builds the engine: the Electron host owns the SecretStore and
 * config paths (the live backend), while `nodeHost()` serves tests and the
 * dev launcher with the demo backend and the fake eero server only.
 */

import { join } from "node:path";
import { createInterface } from "node:readline";
import { version as packageVersion } from "../../package.json";
import type { Backend, SecretStore } from "../core/backend";
import { createDemoBackend, DEMO_SETTINGS } from "../core/demo";
import { createEeroBackend } from "../core/eero/backend";
import { createEngine, type Engine, fileSettings, memorySettings } from "../core/engine";
import type { ErrorCode } from "../core/errors";
import type { AnyCommand, Surface } from "../core/spec";
import { type CliFlags, type Format, type ParsedArgs, parseArgs, USAGE } from "./args";
import type { Style } from "./format";
import { runCommands, runHelp, runLogin, runLogout, runRun, runStatus } from "./run";

export type CliIo = {
  stdout(text: string): void;
  stderr(text: string): void;
};

export type BackendMode = "live" | "demo" | "fake";

export type EngineRequest = {
  mode: BackendMode;
  surface: Surface;
  /** From --user-data-dir or MESH_UI_USER_DATA_DIR; null: the host default. */
  userDataDir: string | null;
};

/** What differs per runtime. The token never leaves the engine the host builds. */
export interface CliHost {
  version: string;
  /** Dev build: allows --fake. Release builds pass false. */
  dev: boolean;
  /** stdout is a terminal (table output by default). */
  isTTY: boolean;
  env: Record<string, string | undefined>;
  createEngine(req: EngineRequest): Engine | Promise<Engine>;
  readStdin(): Promise<string>;
  /** Asks one question on the terminal; null when input has ended. */
  prompt(question: string): Promise<string | null>;
}

/** What every subcommand gets besides argv. */
export type CliContext = {
  args: ParsedArgs;
  host: CliHost;
  format: Format;
  style: Style;
  /** The engine for this run, built once. */
  engine(surface?: Surface): Promise<Engine>;
};

/** A subcommand gets the full argv (global flags included) and returns an exit code. */
export type Subcommand = (argv: string[], io: CliIo, ctx: CliContext) => Promise<number>;

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

/** The exit code for an engine error code. */
export function exitFor(code: ErrorCode): number {
  switch (code) {
    case "unknown_command":
    case "bad_params":
      return EXIT.usage;
    case "needs_confirm":
      return EXIT.needsConfirm;
    case "not_signed_in":
      return EXIT.notSignedIn;
    case "rate_limited":
      return EXIT.rateLimited;
    default:
      return EXIT.failed;
  }
}

/** Subcommands, one line each, alphabetical: `mcp: runMcp,` */
const subcommands: Record<string, Subcommand> = {
  commands: runCommands,
  help: runHelp,
  login: runLogin,
  logout: runLogout,
  mcp: (argv, io, ctx) => import("./mcp").then((m) => m.runMcp(argv, io, () => ctx.engine("mcp"))),
  run: runRun,
  status: runStatus,
};

/** Subcommands that take only the flags in args.ts; others (mcp) parse their own. */
const STRICT = new Set(["commands", "help", "login", "logout", "run", "status"]);

const defaultIo: CliIo = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};

const isTruthy = (v: string | undefined) => v !== undefined && v !== "" && v !== "0" && v !== "false";

function modeFor(flags: CliFlags, env: CliHost["env"]): BackendMode {
  if (flags.demo || isTruthy(env.MESH_UI_DEMO)) return "demo";
  if (flags.fake) return "fake";
  return "live";
}

export async function runCli(argv: string[], io: CliIo = defaultIo, host: CliHost = nodeHost()): Promise<number> {
  const args = parseArgs(argv);
  const { flags } = args;
  if (args.error) {
    io.stderr(`${args.error} See mesh-ui --help.\n`);
    return EXIT.usage;
  }
  const name = args.positionals[0];
  if (flags.version && !name) {
    io.stdout(`${host.version}\n`);
    return EXIT.ok;
  }
  if (!name) {
    if (flags.help) {
      io.stdout(USAGE);
      return EXIT.ok;
    }
    io.stderr(USAGE);
    return EXIT.usage;
  }
  const run = subcommands[name];
  if (!run) {
    io.stderr(`Unknown command "${name}". See mesh-ui --help.\n`);
    return EXIT.usage;
  }
  if (STRICT.has(name) && args.unknown.length) {
    io.stderr(`Unknown option ${args.unknown[0]}. See mesh-ui --help.\n`);
    return EXIT.usage;
  }
  if (flags.help && STRICT.has(name) && name !== "help") {
    io.stdout(USAGE);
    return EXIT.ok;
  }
  const mode = modeFor(flags, host.env);
  if (mode === "fake" && !host.dev) {
    io.stderr("--fake is only available in dev builds.\n");
    return EXIT.usage;
  }

  const userDataDir = flags.userDataDir ?? host.env.MESH_UI_USER_DATA_DIR ?? null;
  let engine: Promise<Engine> | null = null;
  const ctx: CliContext = {
    args,
    host,
    format: flags.format ?? (host.isTTY ? "table" : "json"),
    style: { color: host.isTTY && !flags.noColor && !isTruthy(host.env.NO_COLOR) },
    engine: (surface = "cli") => (engine ??= Promise.resolve().then(() => host.createEngine({ mode, surface, userDataDir }))),
  };
  try {
    return await run(argv, io, ctx);
  } catch (err) {
    // Only a host that cannot build the engine gets here (for example
    // --fake with no server); execute itself never throws.
    io.stderr(`${err instanceof Error ? err.message : String(err)}\n`);
    return EXIT.usage;
  }
}

// ---------------------------------------------------------------------------
// Node host: tests and the dev launcher. No live backend: the live session
// belongs to the Electron host and its keychain-backed SecretStore.

function memorySecrets(): SecretStore {
  let token: string | null = null;
  return {
    load: async () => token,
    save: async (t) => {
      token = t;
      return "memory";
    },
    clear: async () => {
      token = null;
    },
    storage: async () => "memory",
  };
}

const LOCAL_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+$/;

export type NodeHostOptions = {
  /** Command specs for the engine; default every registered command. */
  commands?: AnyCommand[];
  /** Demo backend override for tests; default the fixtures in src/core/demo. */
  demoBackend?: () => Backend;
  dev?: boolean;
};

export function nodeHost(opts: NodeHostOptions = {}): CliHost {
  let lines: AsyncIterator<string> | null = null;
  return {
    version: packageVersion,
    dev: opts.dev ?? true,
    isTTY: process.stdout.isTTY === true,
    env: process.env,
    createEngine({ mode, surface, userDataDir }) {
      const initial = mode === "demo" ? DEMO_SETTINGS : {};
      const settings = userDataDir ? fileSettings(join(userDataDir, "settings.json"), initial) : memorySettings(initial);
      const host = { version: packageVersion, configDir: userDataDir };
      if (mode === "demo") {
        return createEngine({ backend: (opts.demoBackend ?? createDemoBackend)(), commands: opts.commands, settings, surface, host });
      }
      if (mode === "fake") {
        const origin = process.env.MESH_UI_FAKE_ORIGIN ?? "";
        if (!LOCAL_ORIGIN.test(origin)) {
          throw new Error("--fake needs MESH_UI_FAKE_ORIGIN set to the local fake eero server, e.g. http://127.0.0.1:4010.");
        }
        const backend = createEeroBackend({ secrets: memorySecrets(), origin });
        return createEngine({ backend, commands: opts.commands, settings, surface, host });
      }
      throw new Error("This build has no live backend. Use --demo, or run mesh-ui through the app.");
    },
    async readStdin() {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
      return Buffer.concat(chunks).toString("utf8");
    },
    async prompt(question) {
      process.stderr.write(question);
      lines ??= createInterface({ input: process.stdin, terminal: false })[Symbol.asyncIterator]();
      const next = await lines.next();
      return next.done ? null : next.value;
    },
  };
}

/**
 * Runs the CLI as a whole process: exit code from runCli, 130 on Ctrl C.
 * Waits for stdout to drain so piped output is never cut short.
 */
export async function cliMain(argv: string[], host?: CliHost): Promise<never> {
  process.on("SIGINT", () => process.exit(EXIT.interrupted));
  const code = await runCli(argv, defaultIo, host);
  const drain = (stream: NodeJS.WriteStream) => new Promise<void>((resolve) => stream.write("", () => resolve()));
  await Promise.all([drain(process.stdout), drain(process.stderr)]);
  process.exit(code);
}
