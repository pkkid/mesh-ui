#!/usr/bin/env node
/**
 * Local smoke tests for built apps (docs/testing.md, docs/platform/build-and-release.md).
 * Not run in CI.
 *
 *   pnpm dist:dir && pnpm dist:smoke     # the packaged app in dist/<os>-unpacked
 *   pnpm test:keychainless               # Linux: out/ build with --password-store=basic
 *
 * Packaged smoke: runs the packaged CLI (`--cli --version`, `--cli --demo
 * commands`), then opens the window with `--demo` and checks over the
 * DevTools protocol that the renderer loaded, `window.mesh` is there and no
 * errors were logged. `--screenshot <file.png>` saves the window.
 *
 * Keychainless: proves that with `--password-store=basic` Electron picks the
 * `basic_text` backend and the session is never written to disk. Once the
 * auth commands exist it signs in to the fake eero server through the CLI
 * and checks `auth.status` reports `memory` and no session.json appears.
 *
 * Every run uses a throwaway user data dir and XDG_CONFIG_HOME in the system
 * temp folder, the demo backend or the local fake eero server, and never
 * the real config dir or eero's API.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const keychainless = argv.includes("--keychainless");
const shotIndex = argv.indexOf("--screenshot");
const screenshot = shotIndex === -1 ? null : resolve(argv[shotIndex + 1] ?? "dist-smoke.png");
const keep = argv.includes("--keep");

const scratch = mkdtempSync(join(tmpdir(), "mesh-ui-smoke-"));
const userData = join(scratch, "user-data");
const xdg = join(scratch, "xdg-config");
mkdirSync(userData, { recursive: true });
mkdirSync(xdg, { recursive: true });

const env = { ...process.env, MESH_UI_USER_DATA_DIR: userData, XDG_CONFIG_HOME: xdg };
delete env.ELECTRON_RUN_AS_NODE;
delete env.MESH_UI_FAKE;
delete env.MESH_UI_FAKE_ORIGIN;

const headless = process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;
const hostSwitches = [`--user-data-dir=${userData}`, ...(headless ? ["--ozone-platform=headless"] : [])];

function log(msg) {
  process.stdout.write(`[dist-smoke] ${msg}\n`);
}

function fail(msg) {
  throw new Error(msg);
}

/** Runs a process to completion and returns its exit code and output. */
function run(cmd, args, { timeoutMs = 60_000, extraEnv = {} } = {}) {
  return new Promise((done, reject) => {
    const child = spawn(cmd, args, { env: { ...env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${args.join(" ")} timed out\n${stderr}`));
    }, timeoutMs);
    child.on("error", reject);
    child.on("exit", (code) => {
      clearTimeout(timer);
      done({ code, stdout, stderr });
    });
  });
}

/** The unpacked app's executable in dist/. */
function packagedBinary() {
  const dist = join(root, "dist");
  if (!existsSync(dist)) fail("No dist/ folder. Run pnpm dist:dir first.");
  const dirs = readdirSync(dist).filter((d) => /-unpacked$|^mac(-arm64|-universal)?$/.test(d));
  for (const d of dirs) {
    const candidates = {
      linux: join(dist, d, "mesh-ui"),
      win32: join(dist, d, "Mesh UI.exe"),
      darwin: join(dist, d, "Mesh UI.app", "Contents", "MacOS", "Mesh UI"),
    };
    const bin = candidates[process.platform];
    if (bin && existsSync(bin)) return bin;
  }
  fail(`No unpacked app for ${process.platform} in dist/. Run pnpm dist:dir first.`);
}

// ---------------------------------------------------------------------------
// DevTools protocol, just enough to read the window.

/** Starts the app with remote debugging and resolves its browser endpoint. */
function launchWindow(bin, args, extraEnv = {}) {
  const child = spawn(bin, [...args, "--remote-debugging-port=0"], { env: { ...env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  const endpoint = new Promise((done, reject) => {
    const timer = setTimeout(() => reject(new Error(`No DevTools endpoint after 30s\n${output}`)), 30_000);
    const onData = (d) => {
      output += d;
      const m = /DevTools listening on (ws:\/\/[^\s]+)/.exec(output);
      if (m) {
        clearTimeout(timer);
        done(m[1]);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (code) => reject(new Error(`App exited early (${code})\n${output}`)));
  });
  return { child, endpoint, output: () => output };
}

async function pageTarget(browserWs) {
  const http = browserWs.replace(/^ws:\/\/([^/]+)\/.*$/, "http://$1");
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const targets = await (await fetch(`${http}/json/list`)).json();
    const page = targets.find((t) => t.type === "page" && t.url.startsWith("file:"));
    if (page) return page;
    await new Promise((r) => setTimeout(r, 250));
  }
  fail("The window never loaded the app page.");
}

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let next = 1;
  const pending = new Map();
  const listeners = [];
  ws.addEventListener("message", (e) => {
    const msg = JSON.parse(String(e.data));
    if (msg.id && pending.has(msg.id)) {
      const { done, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else done(msg.result);
    } else if (msg.method) {
      for (const l of listeners) l(msg);
    }
  });
  const open = new Promise((done, reject) => {
    ws.addEventListener("open", () => done());
    ws.addEventListener("error", () => reject(new Error("DevTools connection failed")));
  });
  return {
    open,
    on: (l) => listeners.push(l),
    send: (method, params = {}) =>
      new Promise((done, reject) => {
        const id = next++;
        pending.set(id, { done, reject });
        ws.send(JSON.stringify({ id, method, params }));
      }),
    close: () => ws.close(),
  };
}

async function evaluate(session, expression) {
  const { result, exceptionDetails } = await session.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (exceptionDetails) fail(`Evaluate failed: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
  return result.value;
}

function stop(child) {
  return new Promise((done) => {
    if (child.exitCode !== null) return done();
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, 5_000);
    child.on("exit", () => {
      clearTimeout(timer);
      done();
    });
    child.kill();
  });
}

// ---------------------------------------------------------------------------
// Packaged smoke

async function packagedSmoke() {
  const bin = packagedBinary();
  log(`app: ${bin}`);
  const { version } = createRequire(import.meta.url)(join(root, "package.json"));

  const ver = await run(bin, ["--cli", ...hostSwitches, "--version"]);
  if (ver.code !== 0 || !ver.stdout.includes(version)) fail(`--cli --version: exit ${ver.code}\n${ver.stdout}${ver.stderr}`);
  log(`cli --version: ${ver.stdout.trim()}`);

  const cmds = await run(bin, ["--cli", ...hostSwitches, "--demo", "commands"], { extraEnv: { MESH_UI_DEMO: "1" } });
  if (cmds.code !== 0) fail(`--cli --demo commands: exit ${cmds.code}\n${cmds.stderr}`);
  const list = JSON.parse(cmds.stdout);
  if (!Array.isArray(list)) fail("commands did not print a JSON array");
  log(`cli --demo commands: ${list.length} commands`);

  const app = launchWindow(bin, ["--demo", ...hostSwitches], { MESH_UI_DEMO: "1" });
  try {
    const page = await pageTarget(await app.endpoint);
    const session = cdp(page.webSocketDebuggerUrl);
    await session.open;
    const errors = [];
    session.on((msg) => {
      if (msg.method === "Runtime.exceptionThrown") errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
      if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
        errors.push(msg.params.args.map((a) => a.value ?? a.description).join(" "));
      }
    });
    await session.send("Runtime.enable");
    await session.send("Page.enable");
    // Reload with the listeners on, so errors during startup are caught.
    await session.send("Page.reload");
    const deadline = Date.now() + 20_000;
    let state = null;
    while (Date.now() < deadline) {
      state = await evaluate(
        session,
        `(async () => ({
          ready: document.readyState,
          title: document.title,
          rendered: (document.getElementById("root")?.childElementCount ?? 0) > 0,
          text: document.body.innerText.slice(0, 200),
          bridge: typeof window.mesh?.execute === "function",
          commands: typeof window.mesh?.commands === "function" ? (await window.mesh.commands()).length : null,
          networks: typeof window.mesh?.execute === "function" ? await window.mesh.execute("network.list", {}) : null,
        }))()`,
      ).catch(() => null);
      if (state?.ready === "complete" && state.rendered && state.bridge) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!state?.rendered) fail(`The renderer did not render: ${JSON.stringify(state)}`);
    if (!state.bridge) fail("window.mesh is missing in the renderer");
    // Demo fixtures answer network.list; a live engine would say not_signed_in.
    if (!state.networks?.ok || !state.networks.result.length) fail(`network.list did not answer from demo fixtures: ${JSON.stringify(state.networks)}`);
    // Give late startup work a moment to log errors.
    await new Promise((r) => setTimeout(r, 1_000));
    log(`window: title "${state.title}", ${state.commands} commands over IPC, ${state.networks.result.length} demo networks, text "${state.text.replace(/\s+/g, " ").trim().slice(0, 80)}"`);
    if (errors.length) fail(`Renderer errors:\n${errors.join("\n")}`);
    if (screenshot) {
      const { data } = await session.send("Page.captureScreenshot", { format: "png" });
      writeFileSync(screenshot, Buffer.from(data, "base64"));
      log(`screenshot: ${screenshot}`);
    }
    session.close();
  } finally {
    await stop(app.child);
  }
  if (existsSync(join(userData, "session.json"))) fail("Demo mode wrote session.json");
  log("ok");
}

// ---------------------------------------------------------------------------
// Keychainless (Linux)

async function keychainlessSmoke() {
  if (process.platform !== "linux") {
    log("--keychainless is a Linux check (--password-store=basic); skipped on this OS.");
    return;
  }
  const main = join(root, "out/main/index.js");
  if (!existsSync(main)) fail("No build found at out/main/index.js. Run pnpm build first.");
  const electron = createRequire(import.meta.url)("electron");
  const basic = ["--password-store=basic", ...hostSwitches];

  // 1. Electron's own view: which safeStorage backend does the switch select?
  const probeDir = join(scratch, "probe");
  mkdirSync(probeDir);
  writeFileSync(join(probeDir, "package.json"), JSON.stringify({ name: "mesh-ui-keychain-probe", main: "main.cjs" }));
  writeFileSync(
    join(probeDir, "main.cjs"),
    `const { app, safeStorage } = require("electron");
app.whenReady().then(() => {
  process.stdout.write(JSON.stringify({ backend: safeStorage.getSelectedStorageBackend() }) + "\\n");
  app.quit();
});`,
  );
  const probe = await run(electron, [probeDir, ...basic]);
  const backend = /\{.*\}/.exec(probe.stdout)?.[0];
  if (probe.code !== 0 || !backend) fail(`safeStorage probe failed (${probe.code})\n${probe.stderr}`);
  const selected = JSON.parse(backend).backend;
  if (selected !== "basic_text") fail(`Expected the basic_text backend, got ${selected}`);
  log(`safeStorage backend with --password-store=basic: ${selected}`);

  // 2. The app's CLI against the fake eero server.
  const { runnerImport } = await import("vite");
  const { module: fakeServer } = await runnerImport(join(root, "test/fake-eero/server.ts"), { configFile: false, root, logLevel: "silent" });
  const fake = fakeServer.createFakeEero();
  const origin = await fake.listen();
  const fakeEnv = { MESH_UI_FAKE_ORIGIN: origin };
  try {
    const cmds = await run(electron, [main, "--cli", ...basic, "--fake", "commands"], { extraEnv: fakeEnv });
    if (cmds.code !== 0) fail(`--cli --fake commands: exit ${cmds.code}\n${cmds.stderr}`);
    const ids = JSON.parse(cmds.stdout).map((c) => c.id);
    if (!ids.includes("auth.login.start") || !ids.includes("auth.status")) {
      log("auth commands are not registered yet (M1.9); sign-in check skipped.");
    } else {
      const script = join(scratch, "sign-in.jsonl");
      writeFileSync(
        script,
        [
          { id: "auth.login.start", params: { login: "smoke@example.invalid" } },
          { id: "auth.login.verify", params: { code: "123456" } },
          { id: "auth.status", params: {} },
        ]
          .map((l) => JSON.stringify(l))
          .join("\n") + "\n",
      );
      const res = await run(electron, [main, "--cli", ...basic, "--fake", "run", script], { extraEnv: fakeEnv });
      const lines = res.stdout.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
      if (res.code !== 0) fail(`sign-in script failed (${res.code})\n${res.stdout}\n${res.stderr}`);
      const status = lines.at(-1)?.result;
      if (!status?.signedIn) fail(`Not signed in after verify: ${JSON.stringify(status)}`);
      if (status.storage !== "memory") fail(`Expected storage "memory", got ${status.storage}`);
      log(`signed in to the fake server: storage ${status.storage}`);
    }
  } finally {
    await fake.close?.();
  }
  if (existsSync(join(userData, "session.json"))) fail("session.json was written without a keychain");
  log("no session.json written");
  log("ok");
}

try {
  await (keychainless ? keychainlessSmoke() : packagedSmoke());
} catch (err) {
  process.stderr.write(`[dist-smoke] FAILED: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
} finally {
  if (!keep) rmSync(scratch, { recursive: true, force: true });
  else log(`scratch kept: ${scratch}`);
}
