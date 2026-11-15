/**
 * The packaged CLI launchers (docs/platform/build-and-release.md#cli-launcher):
 * build/mac/mesh-ui, build/linux/mesh-ui and build/win/cli-relay.js, each
 * pointed at a stub app that reports what it was given. The shell launchers
 * need /bin/sh, so they are checked on macOS and Linux; the relay is plain
 * Node and runs everywhere.
 */
import { spawn } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");
const posix = process.platform !== "win32";

/** A shell stub that prints one JSON line: its argv and the display vars. */
const SH_STUB = `#!/bin/sh
d=false; [ -n "\${DISPLAY+x}" ] && d=true
w=false; [ -n "\${WAYLAND_DISPLAY+x}" ] && w=true
printf '{"displaySet":%s,"waylandSet":%s}\\n' "$d" "$w"
for a in "$@"; do printf '%s\\n' "$a"; done
`;

type Ran = { code: number | null; stdout: string; stderr: string };

function run(cmd: string, args: string[], opts: { env?: NodeJS.ProcessEnv; input?: string } = {}): Promise<Ran> {
  return new Promise((done, reject) => {
    const child = spawn(cmd, args, { env: opts.env ?? process.env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => done({ code, stdout, stderr }));
    // A stub may exit before reading stdin; that EPIPE is not a failure.
    child.stdin.on("error", () => {});
    child.stdin.end(opts.input ?? "");
  });
}

/** The stub's report: the env line, then one argument per line. */
function report(stdout: string) {
  const [first, ...args] = stdout.replace(/\n$/, "").split("\n");
  return { env: JSON.parse(first ?? "{}") as { displaySet: boolean; waylandSet: boolean }, args };
}

let scratch: string;
beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "mesh-ui-M6.2-launchers-"));
});
afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const tricky = ["run", "app.info", "--params", '{"a": "b c"}', "two  spaces", "", "quote's", "$HOME", "*", "--confirm"];

describe.runIf(posix)("macOS launcher (build/mac/mesh-ui)", () => {
  /** A bundle layout with spaces in every path, like /Applications/Mesh UI.app. */
  function bundle() {
    const app = join(scratch, "Apps dir", "Mesh UI.app", "Contents");
    mkdirSync(join(app, "MacOS"), { recursive: true });
    mkdirSync(join(app, "Resources", "bin"), { recursive: true });
    const binary = join(app, "MacOS", "Mesh UI");
    writeFileSync(binary, SH_STUB);
    chmodSync(binary, 0o755);
    const launcher = join(app, "Resources", "bin", "mesh-ui");
    copyFileSync(join(root, "build/mac/mesh-ui"), launcher);
    chmodSync(launcher, 0o755);
    return launcher;
  }

  it("runs the app binary with --cli first and every argument unchanged", async () => {
    const launcher = bundle();
    const res = await run(launcher, tricky);
    expect(res.code).toBe(0);
    expect(report(res.stdout).args).toEqual(["--cli", ...tricky]);
  });

  it("resolves its own symlink, as /usr/local/bin/mesh-ui points at it", async () => {
    const launcher = bundle();
    const binDir = join(scratch, "usr local", "bin");
    mkdirSync(binDir, { recursive: true });
    const link = join(binDir, "mesh-ui");
    symlinkSync(launcher, link);
    // A relative link through a second hop as well.
    const hop = join(scratch, "hop to mesh-ui");
    symlinkSync(join("usr local", "bin", "mesh-ui"), hop);
    for (const via of [link, hop]) {
      const res = await run(via, tricky);
      expect(res.stderr).toBe("");
      expect(res.code).toBe(0);
      expect(report(res.stdout).args).toEqual(["--cli", ...tricky]);
    }
  });

  it("follows the links by hand where realpath is missing (macOS before 13)", async () => {
    bundle();
    const link = join(scratch, "usr local bin mesh-ui");
    symlinkSync(join("Apps dir", "Mesh UI.app", "Contents", "Resources", "bin", "mesh-ui"), link);
    // A PATH with only readlink and dirname, so `command -v realpath` fails.
    const tools = join(scratch, "tools");
    mkdirSync(tools);
    for (const tool of ["readlink", "dirname"]) {
      const found = (await run("/bin/sh", ["-c", `command -v ${tool}`])).stdout.trim();
      symlinkSync(found, join(tools, tool));
    }
    const res = await run("/bin/sh", [link, ...tricky], { env: { PATH: tools } });
    expect(res.stderr).toBe("");
    expect(report(res.stdout).args).toEqual(["--cli", ...tricky]);
  });

  it("passes the app's exit code through", async () => {
    const launcher = bundle();
    writeFileSync(join(scratch, "Apps dir", "Mesh UI.app", "Contents", "MacOS", "Mesh UI"), "#!/bin/sh\nexit 4\n");
    expect((await run(launcher, [])).code).toBe(4);
  });
});

describe.runIf(posix)("Linux launcher (build/linux/mesh-ui)", () => {
  const APP = '"/opt/Mesh UI/mesh-ui"';

  /** The launcher with its /opt target swapped for a stub in a path with spaces. */
  function launcher() {
    const src = readFileSync(join(root, "build/linux/mesh-ui"), "utf8");
    expect(src.split(APP)).toHaveLength(2);
    const dir = join(scratch, "opt dir", "Mesh UI");
    mkdirSync(dir, { recursive: true });
    const stub = join(dir, "mesh-ui");
    writeFileSync(stub, SH_STUB);
    chmodSync(stub, 0o755);
    const out = join(scratch, "mesh-ui");
    writeFileSync(out, src.replace(APP, JSON.stringify(stub)));
    chmodSync(out, 0o755);
    return out;
  }

  it("targets the deb and rpm install path", () => {
    expect(readFileSync(join(root, "build/linux/mesh-ui"), "utf8")).toContain(`exec ${APP} --cli`);
  });

  it("drops DISPLAY and WAYLAND_DISPLAY and runs headless", async () => {
    const res = await run(launcher(), tricky, { env: { ...process.env, DISPLAY: ":0", WAYLAND_DISPLAY: "wayland-0" } });
    expect(res.code).toBe(0);
    const { env, args } = report(res.stdout);
    expect(env.displaySet).toBe(false);
    expect(env.waylandSet).toBe(false);
    expect(args).toEqual(["--cli", "--ozone-platform=headless", "--disable-gpu", ...tricky]);
  });

  it("passes the app's exit code through", async () => {
    const out = launcher();
    writeFileSync(join(scratch, "opt dir", "Mesh UI", "mesh-ui"), "#!/bin/sh\nexit 3\n");
    expect((await run(out, ["x"])).code).toBe(3);
  });
});

describe("Windows relay (build/win/cli-relay.js)", () => {
  /**
   * A stub app in plain Node: echoes its argv and env to stderr as JSON,
   * copies stdin to stdout, and exits with the code after "--exit".
   */
  function stub() {
    const file = join(scratch, "stub app.cjs");
    writeFileSync(
      file,
      `const args = process.argv.slice(2);
process.stderr.write(JSON.stringify({ args, runAsNode: process.env.ELECTRON_RUN_AS_NODE ?? null }) + "\\n");
process.stdin.pipe(process.stdout);
process.stdin.on("end", () => { const i = args.indexOf("--exit"); process.exitCode = i === -1 ? 0 : Number(args[i + 1]); });
`,
    );
    return file;
  }

  /** Runs the relay from plain Node with the stub as its injected target. */
  function relay(args: string[], input: string) {
    const harness = join(scratch, "harness.cjs");
    writeFileSync(
      harness,
      `const { relay } = require(${JSON.stringify(join(root, "build/win/cli-relay.js"))});
relay({ target: process.execPath, prefix: [${JSON.stringify(stub())}], args: process.argv.slice(2) }).then((code) => { process.exitCode = code; });
`,
    );
    return run(process.execPath, [harness, ...args], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, input });
  }

  it("forwards stdin, stdout, stderr and arguments, with --cli first", async () => {
    const input = '{"id":"app.info","params":{}}\nline two\n';
    const res = await relay(tricky, input);
    expect(res.code).toBe(0);
    expect(res.stdout).toBe(input);
    const seen = JSON.parse(res.stderr.trim()) as { args: string[]; runAsNode: string | null };
    expect(seen.args).toEqual(["--cli", ...tricky]);
    // The app must start as the app, not in Node mode.
    expect(seen.runAsNode).toBeNull();
  });

  it("passes the exit code through", async () => {
    expect((await relay(["--exit", "7"], "")).code).toBe(7);
    expect((await relay(["--exit", "0"], "")).code).toBe(0);
  });

  it("fails cleanly when the app cannot start", async () => {
    const harness = join(scratch, "missing.cjs");
    writeFileSync(
      harness,
      `const { relay } = require(${JSON.stringify(join(root, "build/win/cli-relay.js"))});
relay({ target: ${JSON.stringify(join(scratch, "no such app"))}, args: [] }).then((code) => { process.exitCode = code; });
`,
    );
    const res = await run(process.execPath, [harness]);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain("could not start");
  });
});
