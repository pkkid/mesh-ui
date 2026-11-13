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
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
const args = process.argv.slice(2);

const given = args.find((a) => a.startsWith("--user-data-dir"));
const userDataDir = process.env.MESH_UI_USER_DATA_DIR || (given ? null : join(tmpdir(), "mesh-ui-dev-cli"));
const extra = [];
if (userDataDir) {
  mkdirSync(userDataDir, { recursive: true });
  extra.push(`--user-data-dir=${userDataDir}`);
}
// Headless Linux with no display server (docs/architecture/cli.md).
if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
  extra.push("--ozone-platform=headless");
}

const env = { ...process.env, ...(userDataDir ? { MESH_UI_USER_DATA_DIR: userDataDir } : {}) };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [main, "--cli", ...extra, ...args], { stdio: "inherit", env });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code, signal) => process.exit(signal === "SIGINT" ? 130 : (code ?? 1)));
