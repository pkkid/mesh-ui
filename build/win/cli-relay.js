"use strict";
/**
 * Windows CLI relay (docs/platform/build-and-release.md#cli-launcher).
 *
 * `bin\mesh-ui.cmd` runs this file with `Mesh UI.exe` in Node mode
 * (`ELECTRON_RUN_AS_NODE=1`). A GUI-subsystem exe started from a console
 * does not write to it, so the relay starts the app again in headless
 * `--cli` mode with piped stdio, copies stdin, stdout and stderr across,
 * and exits with the app's exit code.
 *
 * `relay()` takes its target so test/packaging/launchers.test.ts can run it
 * from plain Node against a stub. Shipped as `resources\cli-relay.js`.
 */

const { spawn } = require("node:child_process");

/**
 * Spawns `target ...prefix --cli ...args` and resolves its exit code.
 * The child never inherits ELECTRON_RUN_AS_NODE, so it starts as the app.
 */
function relay({ target, prefix = [], args, env = process.env, stdin = process.stdin, stdout = process.stdout, stderr = process.stderr }) {
  const childEnv = { ...env };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  const child = spawn(target, [...prefix, "--cli", ...args], { env: childEnv, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  stdin.pipe(child.stdin);
  // The app may exit before reading all of stdin; that is not an error here.
  child.stdin.on("error", () => {});
  child.stdout.pipe(stdout);
  child.stderr.pipe(stderr);
  return new Promise((resolve) => {
    child.on("error", (err) => {
      stderr.write(`mesh-ui: could not start ${target}: ${err.message}\n`);
      resolve(1);
    });
    // "close" waits for stdout and stderr to drain, unlike "exit".
    child.on("close", (code) => {
      stdin.unpipe(child.stdin);
      resolve(code ?? 1);
    });
  });
}

module.exports = { relay };

if (require.main === module) {
  // In the package this runs inside Mesh UI.exe, so the app is our own binary.
  relay({ target: process.execPath, args: process.argv.slice(2) }).then((code) => {
    process.exitCode = code;
    // stdin may still be open (a console); do not wait for it.
    process.stdin.destroy();
  });
}
