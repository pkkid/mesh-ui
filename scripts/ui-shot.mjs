#!/usr/bin/env node
/**
 * Invisible UI checks and screenshots (docs/testing.md#screenshots-with-ui-shot).
 * Launches the built app with no window on the desktop, drives it over the
 * DevTools protocol and saves PNGs. This is how agents look at the UI.
 *
 *   pnpm ui:shot --route '#/devices' --theme dark --out devices-dark.png
 *   pnpm ui:shot --shots shots.json --out-dir shots/
 *   pnpm ui:shot --fake --route '#/overview' --out overview-fake.png
 *
 * Options (each also a field of a --shots entry, which override them):
 *   --route <hash>       route to open, e.g. '#/devices' (default '#/overview')
 *   --theme light|dark   appearance (default light)
 *   --theme-id <id>      theme palette id, e.g. gruvbox-hard (default: the app default)
 *   --size <WxH>         viewport size (default 1200x780, the window size)
 *   --scale <n>          device scale factor (default 1)
 *   --scenario <name>    demo scenario for demo.scenario.set (demo only; default "default")
 *   --before <js>        JS run in the page before the shot, awaited (click, open a popover)
 *   --wait <ms>          settle time after load and after --before (default 600)
 *   --out <file.png>     output path (default ui-shot.png)
 * Run options:
 *   --shots <list.json>  several shots in one run: [{ "out", "route", "theme", ... }]
 *   --out-dir <dir>      base folder for relative "out" paths in --shots
 *   --fake               the real eero client against the local fake eero server
 *                        (started by the app; signs in with the fake code unless
 *                        --signed-out), instead of the demo backend
 *   --signed-out         with --fake, stay on the sign-in screen
 *   --build | --no-build force or skip the build (default: build when src/ is newer)
 *   --keep               keep the temp user data dir and print it
 *
 * No window is ever shown: the app runs with MESH_UI_HEADLESS=1, which renders
 * its window offscreen and never shows it, and on Linux also with DISPLAY and
 * WAYLAND_DISPLAY removed and `--ozone-platform=headless`, so it cannot reach
 * the desktop's display server at all. Every run uses a temp user data dir and
 * XDG_CONFIG_HOME (deleted afterwards) and never the real config dir or eero.
 *
 * Exits non-zero when the renderer logs errors or throws, printing them.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const THEME_KEY = "mesh-ui:theme:v1";
const FAKE_CODE = "123456";
const LIMITS_NOTE =
  "Headless shots cannot show the native window controls (Linux and Windows overlay, macOS traffic lights) " +
  "or native popups such as an open <select> list. Capture the in-page equivalent or add a MANUAL line.";

function log(msg) {
  process.stdout.write(`[ui-shot] ${msg}\n`);
}

// ---------------------------------------------------------------------------
// Arguments

const SHOT_KEYS = { route: "route", theme: "theme", "theme-id": "themeId", size: "size", scale: "scale", scenario: "scenario", before: "before", wait: "wait", out: "out" };
const FLAGS = new Set(["fake", "signed-out", "build", "no-build", "keep", "help"]);

function parseArgs(argv) {
  const opts = { shot: {} };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) throw new Error(`Unexpected argument: ${arg}`);
    const [name, inline] = arg.slice(2).split(/=(.*)/s, 2);
    if (FLAGS.has(name)) {
      opts[name] = true;
      continue;
    }
    const value = inline ?? argv[++i];
    if (value === undefined) throw new Error(`--${name} needs a value`);
    if (name in SHOT_KEYS) opts.shot[SHOT_KEYS[name]] = value;
    else if (name === "shots") opts.shots = value;
    else if (name === "out-dir") opts.outDir = value;
    else throw new Error(`Unknown option --${name}`);
  }
  return opts;
}

/** Fills in defaults and checks one shot. */
function normaliseShot(raw, { outDir, fake }) {
  const shot = {
    route: "#/overview",
    theme: "light",
    themeId: null,
    size: "1200x780",
    scale: 1,
    scenario: null,
    before: null,
    wait: 600,
    out: "ui-shot.png",
    ...Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined && v !== null)),
  };
  if (!shot.route.startsWith("#")) shot.route = `#${shot.route.startsWith("/") ? "" : "/"}${shot.route}`;
  if (shot.theme !== "light" && shot.theme !== "dark") throw new Error(`theme must be light or dark, got ${shot.theme}`);
  const m = /^(\d+)x(\d+)$/.exec(String(shot.size));
  if (!m) throw new Error(`size must look like 1200x780, got ${shot.size}`);
  shot.width = Number(m[1]);
  shot.height = Number(m[2]);
  shot.scale = Number(shot.scale);
  shot.wait = Number(shot.wait);
  if (!(shot.scale > 0) || !(shot.wait >= 0)) throw new Error("scale must be > 0 and wait >= 0");
  if (fake && shot.scenario) throw new Error("scenario works only with the demo backend, not --fake");
  shot.out = resolve(outDir ?? process.cwd(), shot.out);
  return shot;
}

// ---------------------------------------------------------------------------
// Build

function newestMtime(paths) {
  let newest = 0;
  const walk = (p) => {
    if (!existsSync(p)) return;
    const st = statSync(p);
    if (st.isDirectory()) for (const e of readdirSync(p)) walk(join(p, e));
    else newest = Math.max(newest, st.mtimeMs);
  };
  for (const p of paths) walk(p);
  return newest;
}

/**
 * Demo uses the normal build in out/. Fake needs a dev build (the fake
 * server redirect exists only when import.meta.env.DEV), kept out of out/ so
 * it can never be packaged.
 */
async function ensureBuild({ fake, force, skip }) {
  const outDir = fake ? join(root, "node_modules/.cache/mesh-ui-shot") : join(root, "out");
  const main = join(outDir, "main/index.js");
  if (skip) {
    if (!existsSync(main)) throw new Error(`No build at ${main}; drop --no-build.`);
    return outDir;
  }
  const sources = [join(root, "src"), join(root, "electron.vite.config.ts"), join(root, "package.json"), ...(fake ? [join(root, "test/fake-eero")] : [])];
  if (!force && existsSync(main) && statSync(main).mtimeMs >= newestMtime(sources)) {
    log(`reusing build in ${outDir}`);
    return outDir;
  }
  log(`building ${fake ? "dev build for --fake" : "out/"}...`);
  const { build } = await import("electron-vite");
  await build({
    root,
    logLevel: "warn",
    ...(fake ? { build: { outDir }, define: { "import.meta.env.DEV": "true" } } : {}),
  });
  return outDir;
}

// ---------------------------------------------------------------------------
// DevTools protocol

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
  // A crashed renderer closes the socket: fail every pending call so cleanup runs.
  ws.addEventListener("close", () => {
    for (const { reject } of pending.values()) reject(new Error("DevTools connection closed (renderer crashed?)"));
    pending.clear();
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
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`${method} timed out after 30s`));
        }, 30_000);
        const settle = (fn) => (v) => {
          clearTimeout(timer);
          fn(v);
        };
        pending.set(id, { done: settle(done), reject: settle(reject) });
        ws.send(JSON.stringify({ id, method, params }));
      }),
    close: () => ws.close(),
  };
}

async function evaluate(session, expression) {
  const { result, exceptionDetails } = await session.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  return result.value;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Waits until the page has rendered the app and the bridge is there. */
async function waitForApp(session) {
  const deadline = Date.now() + 20_000;
  let state = null;
  while (Date.now() < deadline) {
    state = await evaluate(
      session,
      `({ ready: document.readyState, rendered: (document.getElementById("root")?.childElementCount ?? 0) > 0, bridge: typeof window.mesh?.execute === "function" })`,
    ).catch(() => null);
    if (state?.ready === "complete" && state.rendered && state.bridge) {
      await evaluate(session, `document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))`);
      return;
    }
    await sleep(100);
  }
  throw new Error(`The app did not render: ${JSON.stringify(state)}`);
}

async function execute(session, id, params) {
  const res = await evaluate(session, `window.mesh.execute(${JSON.stringify(id)}, ${JSON.stringify(params)})`);
  if (!res?.ok) throw new Error(`${id} failed: ${JSON.stringify(res?.error)}`);
  return res.result;
}

// ---------------------------------------------------------------------------
// App

/** The child env: never a display server, never the real config. */
function childEnv({ userData, xdg, fake }) {
  const env = { ...process.env, MESH_UI_HEADLESS: "1", MESH_UI_USER_DATA_DIR: userData, XDG_CONFIG_HOME: xdg };
  for (const k of ["ELECTRON_RUN_AS_NODE", "ELECTRON_RENDERER_URL", "MESH_UI_FAKE", "MESH_UI_FAKE_ORIGIN", "MESH_UI_DEMO"]) delete env[k];
  if (process.platform === "linux") {
    delete env.DISPLAY;
    delete env.WAYLAND_DISPLAY;
  }
  if (fake) env.MESH_UI_FAKE = "1";
  else env.MESH_UI_DEMO = "1";
  return env;
}

function launch({ outDir, userData, env, fake }) {
  const electron = createRequire(import.meta.url)("electron");
  const args = [join(outDir, "main/index.js"), `--user-data-dir=${userData}`, "--remote-debugging-port=0", ...(fake ? [] : ["--demo"])];
  if (process.platform === "linux") {
    // Headless ozone has a 1x1 screen unless told otherwise, and no GPU.
    args.push("--ozone-platform=headless", "--ozone-override-screen-size=3840,2160", "--disable-gpu");
  }
  const child = spawn(electron, args, { env, stdio: ["ignore", "pipe", "pipe"] });
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
    child.on("exit", (code, signal) => reject(new Error(`App exited early (${signal ?? code})\n${output}`)));
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
    await sleep(250);
  }
  throw new Error("The window never loaded the app page.");
}

/** On Linux, read the running app's env back to prove it has no display. */
function displayCheck(pid) {
  if (process.platform !== "linux") return "offscreen window, never shown";
  try {
    const env = readFileSync(`/proc/${pid}/environ`, "utf8").split("\0");
    const leaked = env.filter((e) => /^(DISPLAY|WAYLAND_DISPLAY)=/.test(e));
    if (leaked.length) throw new Error(`The app has a display in its env: ${leaked.join(", ")}`);
    return "app env has no DISPLAY or WAYLAND_DISPLAY, ozone headless, offscreen window, never shown";
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("The app has")) throw err;
    return "offscreen window, never shown (could not read /proc env)";
  }
}

function stop(child) {
  return new Promise((done) => {
    if (child.exitCode !== null || child.signalCode !== null) return done();
    const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
    child.on("exit", () => {
      clearTimeout(timer);
      done();
    });
    child.kill();
  });
}

async function takeShot(session, shot, { fake, errors }) {
  const mark = errors.length;
  await session.send("Emulation.setDeviceMetricsOverride", { width: shot.width, height: shot.height, deviceScaleFactor: shot.scale, mobile: false });
  await session.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: shot.theme }] });
  // Demo: start every shot from the named scenario and the first network, so
  // earlier shots or --before writes do not leak into it.
  if (!fake) {
    await execute(session, "demo.scenario.set", { scenario: shot.scenario ?? "default" });
    const first = await evaluate(session, `window.mesh.execute("network.list", {})`);
    if (first?.ok && first.result.length) await execute(session, "network.select", { network: first.result[0].id });
  }
  // View state (theme, columns, last route) starts fresh for every shot too.
  const theme = { mode: shot.theme, ...(shot.themeId ? { themeId: shot.themeId } : {}) };
  await evaluate(session, `localStorage.clear(); localStorage.setItem(${JSON.stringify(THEME_KEY)}, ${JSON.stringify(JSON.stringify(theme))}); location.hash = ${JSON.stringify(shot.route)}`);
  await session.send("Page.reload");
  await sleep(100);
  await waitForApp(session);
  // The router sends unknown paths to the last route, which would silently shoot the wrong page.
  const landed = await evaluate(session, "location.hash");
  if (landed !== shot.route) errors.push(`route ${shot.route} is not a page; the app went to ${landed}`);
  await sleep(shot.wait);
  if (shot.before) {
    try {
      await evaluate(session, `(async () => { ${shot.before}\n})()`);
    } catch (err) {
      errors.push(`--before failed for ${shot.out}: ${err instanceof Error ? err.message : String(err)}`);
    }
    await sleep(shot.wait);
  }
  const { data } = await session.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  mkdirSync(dirname(shot.out), { recursive: true });
  writeFileSync(shot.out, Buffer.from(data, "base64"));
  const failed = errors.length > mark ? ` (${errors.length - mark} error(s))` : "";
  log(`saved ${shot.out} [${shot.route} ${shot.theme}${shot.themeId ? ` ${shot.themeId}` : ""} ${shot.width}x${shot.height}${shot.scenario ? ` ${shot.scenario}` : ""}]${failed}`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    const src = readFileSync(fileURLToPath(import.meta.url), "utf8");
    process.stdout.write(`${/\/\*\*([\s\S]*?)\*\//.exec(src)[1].replace(/^ \* ?/gm, "")}\n`);
    return 0;
  }
  const fake = Boolean(opts.fake);
  const list = opts.shots ? JSON.parse(readFileSync(resolve(opts.shots), "utf8")) : [{}];
  if (!Array.isArray(list) || !list.length) throw new Error("--shots must be a non-empty JSON array");
  const shots = list.map((s) => normaliseShot({ ...opts.shot, ...s }, { outDir: opts.outDir, fake }));
  const outDir = await ensureBuild({ fake, force: opts.build, skip: opts["no-build"] });

  const scratch = mkdtempSync(join(tmpdir(), "mesh-ui-shot-"));
  const userData = join(scratch, "user-data");
  const xdg = join(scratch, "xdg-config");
  mkdirSync(userData, { recursive: true });
  mkdirSync(xdg, { recursive: true });
  const env = childEnv({ userData, xdg, fake });
  const app = launch({ outDir, userData, env, fake });
  const errors = [];
  try {
    const page = await pageTarget(await app.endpoint);
    log(`invisible: ${displayCheck(app.child.pid)}`);
    const session = cdp(page.webSocketDebuggerUrl);
    await session.open;
    session.on((msg) => {
      if (msg.method === "Runtime.exceptionThrown") errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
      if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") errors.push(msg.params.args.map((a) => a.value ?? a.description).join(" "));
      if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") errors.push(`${msg.params.entry.text}${msg.params.entry.url ? ` (${msg.params.entry.url})` : ""}`);
    });
    await session.send("Runtime.enable");
    await session.send("Log.enable");
    await session.send("Page.enable");
    // Reload with the listeners on, so errors during startup are caught.
    await session.send("Page.reload");
    await sleep(100);
    await waitForApp(session);
    if (fake) {
      const origin = /fake eero server at (http:\/\/[^\s,]+)/.exec(app.output())?.[1];
      log(`fake eero server at ${origin ?? "(unknown)"}`);
      if (!opts["signed-out"]) {
        await execute(session, "auth.login.start", { login: "shots@example.invalid" });
        await execute(session, "auth.login.verify", { code: FAKE_CODE });
        log("signed in to the fake eero server");
      }
    }
    for (const shot of shots) await takeShot(session, shot, { fake, errors });
    session.close();
  } finally {
    await stop(app.child);
    if (opts.keep) log(`scratch kept: ${scratch}`);
    else rmSync(scratch, { recursive: true, force: true });
  }
  log(`note: ${LIMITS_NOTE}`);
  if (errors.length) {
    process.stderr.write(`[ui-shot] renderer errors:\n${errors.map((e) => `  ${e}`).join("\n")}\n`);
    return 1;
  }
  log("ok");
  return 0;
}

try {
  process.exitCode = await main();
} catch (err) {
  process.stderr.write(`[ui-shot] FAILED: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
}
