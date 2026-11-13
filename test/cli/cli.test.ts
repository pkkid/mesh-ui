/**
 * CLI tests: build the CLI into a temp dir, spawn it as a real process with
 * `--demo` and a temp user data dir, and check formats, exit codes, params
 * sources and the script rules from docs/architecture/cli.md. The built
 * entry registers the test-only commands below (the real registry has
 * none yet in M1), so these tests do not move when areas land.
 */

import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { version } from "../../package.json";

const ROOT = resolve(__dirname, "../..");
const ENTRY = "virtual:mesh-ui-cli-test";

/** Test-only commands, one per effect and error the CLI must handle. */
const ENTRY_SOURCE = `
import { z } from "zod";
import { cliMain, nodeHost } from ${JSON.stringify(join(ROOT, "src/cli/index.ts"))};
import { BackendError } from ${JSON.stringify(join(ROOT, "src/core/errors.ts"))};
import { defineCommand } from ${JSON.stringify(join(ROOT, "src/core/spec.ts"))};
import { composeBackend } from ${JSON.stringify(join(ROOT, "src/core/backend.ts"))};

// Two invented networks so --network resolves through the engine.
const network = (id, name) => ({ id, name, nickname: null, role: "owner", status: "online", eeroCount: 1,
  devicesOnline: 1, isp: null, updateAvailable: null, lastSeen: null, selected: false });
const demoBackend = () => composeBackend("demo", {
  auth: { status: async () => ({ signedIn: true, pending: false, login: null, storage: "memory" }) },
  network: { list: async () => [network("net_1", "Test Home"), network("net_2", "Test Cabin")] },
});

const rows = [
  { id: "aa0000000001", name: "Test Tablet", connected: true, downMbps: 4.25, usageBytes: 41200000000, tags: ["a", "b"] },
  { id: "aa0000000002", name: "Test Printer", connected: false, downMbps: null, usageBytes: 0, tags: [] },
];
const app = { scope: "app" };
const fail = (code) => async () => { throw new BackendError(code, "Test failure " + code + ".", code === "rate_limited" ? { retryAfterSec: 30 } : undefined); };

export const commands = [
  defineCommand({ ...app, id: "test.list", label: "List test rows", effect: "query", params: z.object({}), run: async () => rows }),
  defineCommand({ id: "test.echo", label: "Echo params", effect: "query",
    params: z.object({ value: z.string().optional() }), run: async (c, p) => ({ ...p, networkId: c.networkId }) }),
  defineCommand({ ...app, id: "test.secret", label: "Show secret", effect: "query", sensitive: true,
    params: z.object({}), run: async () => ({ ssid: "Test Net", password: "hunter22" }) }),
  defineCommand({ ...app, id: "test.rename", label: "Rename test row", effect: "write",
    params: z.object({ name: z.string().min(1) }), run: async (_c, p) => ({ renamed: p.name }) }),
  defineCommand({ ...app, id: "test.restart", label: "Restart test eero", description: "Drops every client for a minute.",
    effect: "disruptive", params: z.object({ eero: z.string() }), run: async (_c, p) => ({ restarted: p.eero }) }),
  defineCommand({ ...app, id: "test.signed_out", label: "Needs session", effect: "query", params: z.object({}), run: fail("not_signed_in") }),
  defineCommand({ ...app, id: "test.limited", label: "Rate limited", effect: "query", params: z.object({}), run: fail("rate_limited") }),
  defineCommand({ ...app, id: "test.eero_down", label: "eero error", effect: "query", params: z.object({}), run: fail("eero_error") }),
  defineCommand({ ...app, id: "test.offline", label: "Network error", effect: "query", params: z.object({}), run: fail("network_error") }),
];

await cliMain(process.argv.slice(2), nodeHost({ commands, demoBackend, dev: process.env.TEST_RELEASE_HOST !== "1" }));
`;

let dir: string;
let cli: string;
let userDataDir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "mesh-ui-cli-test-"));
  userDataDir = join(dir, "user-data");
  await build({
    configFile: false,
    root: ROOT,
    logLevel: "silent",
    plugins: [
      {
        name: "cli-test-entry",
        enforce: "pre",
        resolveId: (id) => (id === ENTRY ? `\0${ENTRY}` : null),
        load: (id) => (id === `\0${ENTRY}` ? ENTRY_SOURCE : null),
      },
    ],
    ssr: { noExternal: true },
    build: {
      ssr: true,
      outDir: join(dir, "out"),
      emptyOutDir: true,
      minify: false,
      rollupOptions: { input: ENTRY, output: { format: "esm", entryFileNames: "cli.mjs" } },
    },
  });
  cli = join(dir, "out/cli.mjs");
}, 60_000);

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

type Run = { code: number; stdout: string; stderr: string };

/** Spawns the built CLI with the temp user data dir, and --demo unless demo is false. */
function mesh(args: string[], opts: { stdin?: string; env?: Record<string, string>; demo?: boolean } = {}): Promise<Run> {
  return new Promise((done, fail) => {
    const env: Record<string, string | undefined> = { ...process.env, NO_COLOR: undefined, MESH_UI_DEMO: undefined, ...opts.env };
    const demo = opts.demo === false ? [] : ["--demo"];
    const child = spawn(process.execPath, [cli, ...demo, "--user-data-dir", userDataDir, ...args], { env, cwd: dir });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", fail);
    child.on("close", (code) => done({ code: code ?? -1, stdout, stderr }));
    child.stdin.end(opts.stdin ?? "");
  });
}

const parse = (text: string) => JSON.parse(text) as Record<string, unknown>;
const jsonLines = (text: string) => text.trim().split("\n").map(parse);

describe("basics", () => {
  it("prints the version", async () => {
    const r = await mesh(["--version"]);
    expect(r).toMatchObject({ code: 0, stdout: `${version}\n` });
  });

  it("prints help with exit 0, and usage with exit 2 when no command is given", async () => {
    const help = await mesh(["--help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("run <file.jsonl>");
    expect((await mesh(["help"])).stdout).toContain("Global options");
    const none = await mesh([]);
    expect(none.code).toBe(2);
    expect(none.stderr).toContain("mesh-ui <command>");
  });

  it("exits 2 for an unknown subcommand, unknown flag or bad --format", async () => {
    expect((await mesh(["frobnicate"])).code).toBe(2);
    const flag = await mesh(["run", "test.list", "--bogus"]);
    expect(flag.code).toBe(2);
    expect(flag.stderr).toContain("--bogus");
    expect((await mesh(["run", "test.list", "--format", "yaml"])).code).toBe(2);
  });

  it("help <id> shows the schema and an example", async () => {
    const r = await mesh(["help", "test.restart", "--format", "table"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Drops every client");
    expect(r.stdout).toContain(`mesh-ui run test.restart --params '{"eero":"<eero>"}' --confirm`);
    expect((await mesh(["help", "nope.nope"])).code).toBe(2);
  });

  it("refuses --fake in a release host, and without a local fake server", async () => {
    const release = await mesh(["--fake", "run", "test.list"], { demo: false, env: { TEST_RELEASE_HOST: "1" } });
    expect(release.code).toBe(2);
    expect(release.stderr).toContain("only available in dev builds");
    const remote = await mesh(["--fake", "run", "test.list"], { demo: false, env: { MESH_UI_FAKE_ORIGIN: "https://api-user.e2ro.com" } });
    expect(remote.code).toBe(2);
    expect(remote.stderr).toContain("MESH_UI_FAKE_ORIGIN");
  });
});

describe("mcp", () => {
  it("serves the host's engine, so mcp gets the same backend as run", async () => {
    // stdin closes at once, so the server lists its tools and exits.
    const r = await mesh(["mcp"]);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain("serving 9 tools on stdio");
  });
});

describe("commands", () => {
  it("prints the registry as JSON when piped", async () => {
    const r = await mesh(["commands"]);
    expect(r.code).toBe(0);
    const list = JSON.parse(r.stdout) as { id: string; effect: string; params: { properties?: Record<string, unknown> } }[];
    expect(list.map((c) => c.id)).toEqual([
      "test.list",
      "test.echo",
      "test.secret",
      "test.rename",
      "test.restart",
      "test.signed_out",
      "test.limited",
      "test.eero_down",
      "test.offline",
    ]);
    const restart = list.find((c) => c.id === "test.restart");
    expect(restart?.effect).toBe("disruptive");
    expect(restart?.params.properties).toHaveProperty("confirm");
  });

  it("prints a table with --format table", async () => {
    const r = await mesh(["commands", "--format", "table"]);
    expect(r.stdout.split("\n")[0]).toMatch(/^ID\s+EFFECT\s+LABEL$/);
    expect(r.stdout).toMatch(/test\.restart\s+disruptive\s+Restart test eero/);
  });
});

describe("run output", () => {
  it("json is exactly the execute envelope", async () => {
    const r = await mesh(["run", "test.rename", "--params", '{"name":"Den"}']);
    expect(r.code).toBe(0);
    expect(parse(r.stdout)).toEqual({ ok: true, result: { renamed: "Den" } });
    expect(r.stderr).toBe("");
  });

  it("table renders arrays as columns with shared formatters and - for missing", async () => {
    const r = await mesh(["run", "test.list", "--format", "table"]);
    expect(r.code).toBe(0);
    const lines = r.stdout.trimEnd().split("\n");
    expect(lines[0]).toMatch(/^ID\s+NAME\s+CONNECTED\s+DOWN MBPS\s+USAGE BYTES$/);
    expect(lines[1]).toContain("4.3 Mbps");
    expect(lines[1]).toContain("41.2 GB");
    expect(lines[2]).toMatch(/Test Printer\s+false\s+-\s+0 B/);
  });

  it("table renders objects as key value rows and masks sensitive fields unless --reveal", async () => {
    const masked = await mesh(["run", "test.secret", "--format", "table"]);
    expect(masked.stdout).toMatch(/ssid\s+Test Net/);
    expect(masked.stdout).toMatch(/password\s+\*{8}/);
    expect(masked.stdout).not.toContain("hunter22");
    const revealed = await mesh(["run", "test.secret", "--format", "table", "--reveal"]);
    expect(revealed.stdout).toContain("hunter22");
  });

  it("--quiet prints nothing on success and the error on stderr", async () => {
    const ok = await mesh(["run", "test.list", "--quiet"]);
    expect(ok).toMatchObject({ code: 0, stdout: "" });
    const bad = await mesh(["run", "test.restart", "--params", '{"eero":"Garage"}', "--quiet"]);
    expect(bad.code).toBe(3);
    expect(bad.stdout).toBe("");
    expect(bad.stderr).toMatch(/^error needs_confirm: /);
  });

  it("table errors go to stderr as one line", async () => {
    const r = await mesh(["run", "test.eero_down", "--format", "table"]);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe("error eero_error: Test failure eero_error.\n");
  });

  it("--network becomes networkId", async () => {
    const r = await mesh(["run", "test.echo", "--network", "Test Cabin"]);
    expect(parse(r.stdout)).toEqual({ ok: true, result: { networkId: "net_2" } });
  });

  it("--network is left off commands that take no network", async () => {
    const r = await mesh(["run", "test.list", "--network", "Test Cabin"]);
    expect(r.code).toBe(0);
  });

  it("MESH_UI_DEMO=1 works like --demo", async () => {
    const r = await mesh(["run", "test.list"], { demo: false, env: { MESH_UI_DEMO: "1" } });
    expect(r.code).toBe(0);
    expect(parse(r.stdout).ok).toBe(true);
  });
});

describe("params sources", () => {
  it("reads --params @file", async () => {
    const file = join(dir, "params.json");
    await writeFile(file, '{"value":"from file"}');
    const r = await mesh(["run", "test.echo", "--params", `@${file}`]);
    expect(parse(r.stdout)).toEqual({ ok: true, result: { value: "from file", networkId: "net_1" } });
  });

  it("reads --params - from stdin", async () => {
    const r = await mesh(["run", "test.echo", "--params", "-"], { stdin: '{"value":"from stdin"}' });
    expect(parse(r.stdout)).toEqual({ ok: true, result: { value: "from stdin", networkId: "net_1" } });
  });

  it("exits 2 for bad JSON, a non-object or an unreadable file", async () => {
    for (const params of ["{nope", "[1]", `@${join(dir, "missing.json")}`]) {
      const r = await mesh(["run", "test.echo", "--params", params]);
      expect(r.code).toBe(2);
      expect(parse(r.stdout)).toMatchObject({ ok: false, error: { code: "bad_params" } });
    }
  });
});

describe("exit codes", () => {
  const cases: [string, string[], number, string][] = [
    ["success", ["run", "test.list"], 0, ""],
    ["unknown_command", ["run", "nope.nope"], 2, "unknown_command"],
    ["bad_params", ["run", "test.rename", "--params", '{"name":""}'], 2, "bad_params"],
    ["needs_confirm", ["run", "test.restart", "--params", '{"eero":"Garage"}'], 3, "needs_confirm"],
    ["not_signed_in", ["run", "test.signed_out"], 4, "not_signed_in"],
    ["rate_limited", ["run", "test.limited"], 5, "rate_limited"],
    ["eero_error", ["run", "test.eero_down"], 1, "eero_error"],
    ["network_error", ["run", "test.offline"], 1, "network_error"],
  ];
  for (const [name, args, code, errorCode] of cases) {
    it(`${name} exits ${code}`, async () => {
      const r = await mesh(args);
      expect(r.code).toBe(code);
      const out = parse(r.stdout);
      if (errorCode) expect(out).toMatchObject({ ok: false, error: { code: errorCode } });
      else expect(out.ok).toBe(true);
    });
  }

  it("--confirm lets a disruptive command run", async () => {
    const r = await mesh(["run", "test.restart", "--params", '{"eero":"Garage"}', "--confirm"]);
    expect(r.code).toBe(0);
    expect(parse(r.stdout)).toEqual({ ok: true, result: { restarted: "Garage" } });
  });

  it("rate_limited carries retryAfterSec", async () => {
    const r = await mesh(["run", "test.limited"]);
    expect(parse(r.stdout)).toMatchObject({ error: { detail: { retryAfterSec: 30 } } });
  });

  it("status, login and logout surface the missing auth commands as unknown_command", async () => {
    // auth.* lands in M1.9; until then these shortcuts report it cleanly.
    for (const sub of ["status", "logout"]) {
      const r = await mesh([sub]);
      expect(r.code).toBe(2);
      expect(parse(r.stdout)).toMatchObject({ ok: false, error: { code: "unknown_command" } });
    }
    const login = await mesh(["login"], { stdin: "someone@example.com\n" });
    expect(login.code).toBe(2);
    expect(login.stderr).toContain("Email or phone: ");
  });

  it("the live backend is refused under the Node host", async () => {
    const r = await mesh(["run", "test.list"], { demo: false });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("no live backend");
  });
});

describe("scripts", () => {
  async function script(name: string, lines: string[]): Promise<string> {
    const file = join(dir, name);
    await writeFile(file, `${lines.join("\n")}\n`);
    return file;
  }

  it("runs every line, skips blanks and comments, and prints one JSON line each", async () => {
    const file = await script("ok.jsonl", [
      "# a comment",
      '{"id": "test.echo", "params": {"value": "one"}}',
      "",
      '{"id": "test.restart", "params": {"eero": "Garage", "confirm": true}}',
    ]);
    const r = await mesh(["run", file]);
    expect(r.code).toBe(0);
    expect(jsonLines(r.stdout)).toEqual([
      { line: 2, id: "test.echo", ok: true, result: { value: "one", networkId: "net_1" } },
      { line: 4, id: "test.restart", ok: true, result: { restarted: "Garage" } },
    ]);
  });

  it("stops at the first failed line and exits 10", async () => {
    const file = await script("stop.jsonl", [
      '{"id": "test.echo", "params": {"value": "one"}}',
      '{"id": "test.restart", "params": {"eero": "Garage"}}',
      '{"id": "test.echo", "params": {"value": "three"}}',
    ]);
    const r = await mesh(["run", file]);
    expect(r.code).toBe(10);
    const out = jsonLines(r.stdout);
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({ line: 2, id: "test.restart", ok: false, error: { code: "needs_confirm" } });
  });

  it("--keep-going runs every line and still exits 10", async () => {
    const file = await script("keep.jsonl", [
      "not json",
      '{"id": "test.restart", "params": {"eero": "Garage"}}',
      '{"id": "test.echo", "params": {"value": "three"}}',
    ]);
    const r = await mesh(["run", file, "--keep-going"]);
    expect(r.code).toBe(10);
    const out = jsonLines(r.stdout);
    expect(out.map((l) => l.ok)).toEqual([false, false, true]);
    expect(out[0]).toMatchObject({ line: 1, id: null, error: { code: "bad_params" } });
  });

  it("confirm is per line: a global --confirm is refused", async () => {
    const file = await script("confirm.jsonl", ['{"id": "test.restart", "params": {"eero": "Garage"}}']);
    const r = await mesh(["run", file, "--confirm"]);
    expect(r.code).toBe(2);
    expect(parse(r.stdout)).toMatchObject({ ok: false, error: { code: "bad_params" } });
    expect(JSON.stringify(parse(r.stdout))).toContain('"confirm\\": true');
  });

  it("reads a script from stdin with -", async () => {
    const r = await mesh(["run", "-"], { stdin: '{"id": "test.echo", "params": {"value": "piped"}}\n' });
    expect(r.code).toBe(0);
    expect(jsonLines(r.stdout)).toEqual([{ line: 1, id: "test.echo", ok: true, result: { value: "piped", networkId: "net_1" } }]);
  });

  it("applies --network to lines without their own networkId", async () => {
    const file = await script("net.jsonl", [
      '{"id": "test.echo"}',
      '{"id": "test.echo", "params": {"networkId": "net_1"}}',
    ]);
    const r = await mesh(["run", file, "--network", "Test Cabin"]);
    expect(jsonLines(r.stdout).map((l) => l.result)).toEqual([{ networkId: "net_2" }, { networkId: "net_1" }]);
  });

  it("an unreadable script exits 2", async () => {
    expect((await mesh(["run", join(dir, "missing.jsonl")])).code).toBe(2);
  });
});
