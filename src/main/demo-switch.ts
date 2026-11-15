/**
 * "Try demo mode" and leaving it (`app.demo.set`): relaunches Mesh UI with or
 * without `--demo`. Everything else on the command line is kept as it was,
 * so `--user-data-dir` (and `MESH_UI_USER_DATA_DIR`) still point at the same
 * config dir. Demo reads its settings from memory (`DEMO_SETTINGS` in
 * src/main/index.ts) and never opens the session, so entering and leaving
 * demo writes nothing there: the real settings and session stay as they were.
 *
 * Leaving also drops `MESH_UI_DEMO` from the environment the new process
 * inherits, or it would start in demo again. A packaged AppImage relaunches
 * the `.AppImage` file (`APPIMAGE`), not the binary inside its mount, which
 * goes away when this process exits.
 */

import type { HostActions } from "../core/spec";

/** The slice of Electron's `app` the switch uses, so tests can stub it. */
export type RelaunchApp = {
  relaunch(options: { args: string[]; execPath?: string }): void;
  exit(code?: number): void;
};

export type DemoSwitchDeps = {
  app: RelaunchApp;
  /** `process.argv`: the executable, then its arguments. */
  argv: readonly string[];
  /** `process.env`; the new process inherits it. */
  env: Record<string, string | undefined>;
  /** Runs `exit` a moment later, so the command's answer reaches the window first. */
  defer?: (fn: () => void) => void;
};

export const DEMO_FLAG = "--demo";

/** The arguments for the new process: the current ones without `--demo`, plus it once when entering. */
export function relaunchArgs(argv: readonly string[], enabled: boolean): string[] {
  const args = argv.slice(1).filter((a) => a !== DEMO_FLAG);
  return enabled ? [...args, DEMO_FLAG] : args;
}

export function createDemoSwitch(d: DemoSwitchDeps): NonNullable<HostActions["relaunch"]> {
  const defer = d.defer ?? ((fn) => void setTimeout(fn, 150));
  return {
    demo: async (enabled) => {
      if (!enabled) delete d.env.MESH_UI_DEMO;
      const execPath = d.env.APPIMAGE || undefined;
      d.app.relaunch({ args: relaunchArgs(d.argv, enabled), ...(execPath ? { execPath } : {}) });
      defer(() => d.app.exit(0));
    },
  };
}
