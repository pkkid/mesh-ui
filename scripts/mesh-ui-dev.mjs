#!/usr/bin/env node
/**
 * Dev launcher for the `mesh-ui` CLI: runs the built app (`pnpm build`)
 * through the local Electron binary in headless `--cli` mode, the same way
 * the packaged launchers do (docs/platform/build-and-release.md#cli-launcher).
 *
 *   pnpm mesh-ui --demo run app.info
 *   node scripts/mesh-ui-dev.mjs --demo commands
 *
 * It never uses the real config dir: unless --user-data-dir or
 * MESH_UI_USER_DATA_DIR is given, it runs with a scratch dir in the system
 * temp folder.
 *
 * The CLI is always headless. On Linux the child gets no DISPLAY or
 * WAYLAND_DISPLAY and runs with `--ozone-platform=headless`, so it cannot
 * reach the display server even if something tried to show UI. The keychain
 * (Secret Service over the D-Bus session bus) does not need a display.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * What to spawn: Electron's argv after the binary and the child env. Pure, so
 * src/main/cli-host.test.ts can check the child never sees a display.
 */
export function launchPlan({ main, args, env, platform, tmp }) {
  const given = args.find((a) => a.startsWith("--user-data-dir"));
  const userDataDir = env.MESH_UI_USER_DATA_DIR || (given ? null : join(tmp, "mesh-ui-dev-cli"));
  const extra = [];
  if (userDataDir) extra.push(`--user-data-dir=${userDataDir}`);
  const childEnv = { ...env, ...(userDataDir ? { MESH_UI_USER_DATA_DIR: userDataDir } : {}) };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  if (platform === "linux") {
    delete childEnv.DISPLAY;
    delete childEnv.WAYLAND_DISPLAY;
    // No GPU either: headless ozone has none, and the GPU process would only log errors.
    extra.push("--ozone-platform=headless", "--disable-gpu");
  }
  return { argv: [main, "--cli", ...extra, ...args], env: childEnv, userDataDir };
}

function launch() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const main = join(root, "out/main/index.js");
  if (!existsSync(main)) {
    process.stderr.write("No build found at out/main/index.js. Run pnpm build first.\n");
    process.exit(2);
  }

  // Without the --cli hand-off, main would open the normal window (with the
  // normal config dir and session), so refuse instead of launching it.
  if (!readFileSync(main, "utf8").includes("runCli")) {
    process.stderr.write("This build has no --cli hand-off in src/main yet. Rebuild once it lands.\n");
    process.exit(2);
  }

  const electron = createRequire(import.meta.url)("electron");
  const plan = launchPlan({ main, args: process.argv.slice(2), env: process.env, platform: process.platform, tmp: tmpdir() });
  if (plan.userDataDir) mkdirSync(plan.userDataDir, { recursive: true });
  const child = spawn(electron, plan.argv, { stdio: "inherit", env: plan.env });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
  child.on("exit", (code, signal) => process.exit(signal === "SIGINT" ? 130 : (code ?? 1)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) launch();
