/**
 * Where the app keeps its files, per OS (docs/platform/cross-platform.md#paths).
 * The config dir is `<appData>/mesh-ui` (lowercase on every OS) unless a
 * throwaway dir is given with `--user-data-dir` or `MESH_UI_USER_DATA_DIR`,
 * which every automated run and screenshot uses.
 */

import path from "node:path";

export type PathInputs = {
  /** Electron's `app.getPath("appData")`. */
  appData: string;
  /** Value of the `--user-data-dir` switch, or "" when absent. */
  userDataSwitch: string;
  env: NodeJS.ProcessEnv;
};

export function resolveConfigDir({ appData, userDataSwitch, env }: PathInputs): string {
  const override = userDataSwitch || env.MESH_UI_USER_DATA_DIR || "";
  return override ? path.resolve(override) : path.join(appData, "mesh-ui");
}

/** Files inside the config dir. */
export function configPaths(configDir: string) {
  return {
    configDir,
    session: path.join(configDir, "session.json"),
    settings: path.join(configDir, "settings.json"),
    audit: path.join(configDir, "audit.jsonl"),
    logs: path.join(configDir, "logs"),
    /** Chromium profile data for the headless CLI, so it never fights the app's. */
    cliSessionData: path.join(configDir, "cli"),
  };
}

export type ConfigPaths = ReturnType<typeof configPaths>;
