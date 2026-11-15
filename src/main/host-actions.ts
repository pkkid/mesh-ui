/**
 * The host actions the window's engine gets (`HostInfo.actions` in
 * src/core/spec.ts): the updater, the CLI installer, relaunching into
 * demo mode and showing the eero request log. Only the window has them; the CLI and MCP hosts get none, so
 * those commands answer "Only in the Mesh UI window." there.
 */

import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { BrowserWindow, Shell } from "electron";
import type { AppSettings, InstallKind, UpdateStatus } from "../core/model";
import type { HostActions } from "../core/spec";
import { createAmazonSignIn } from "./amazon-native-signin";
import { createCliInstaller } from "./cli-install";
import { createDemoSwitch, type DemoSwitchDeps } from "./demo-switch";
import { createUpdater, loadElectronUpdater, macSignedForUpdates, type UpdaterDeps } from "./updater";

export type HostActionDeps = {
  install: InstallKind;
  exePath: string;
  env: Readonly<Record<string, string | undefined>>;
  settings(): Promise<AppSettings>;
  /** The updater's status changed (the host broadcasts `update.changed`). */
  onUpdate(status: UpdateStatus): void;
  /** A fixed update status for headless screenshots (`previewUpdate`). */
  updatePreview?: UpdaterDeps["preview"];
  /** Electron's `app`, `process.argv` and `process.env` for the demo relaunch. */
  demoSwitch: DemoSwitchDeps;
  /** The eero request log's path and Electron's `shell`, to show it in the file manager. */
  requestLog: { path: string; shell: Pick<Shell, "showItemInFolder" | "openPath"> };
  /** Mesh UI version for the Amazon token-exchange User-Agent. */
  appVersion: string;
  platform: NodeJS.Platform;
  /**
   * Demo (and tests): resolve Amazon sign-in immediately with this token,
   * without opening a browser window.
   */
  amazonInstantToken?: string;
  /** Parent window for the Amazon sign-in modal. */
  amazonParent?: () => BrowserWindow | null;
};

export function createHostActions(d: HostActionDeps): HostActions {
  return {
    update: createUpdater({
      install: d.install,
      settings: d.settings,
      onChange: d.onUpdate,
      load: loadElectronUpdater,
      // Squirrel.Mac only installs a build signed like the running one: unsigned macOS builds check only.
      ...(d.install === "mac" ? { selfInstall: () => macSignedForUpdates(d.exePath) } : {}),
      preview: d.updatePreview ?? null,
    }),
    cli: createCliInstaller({ install: d.install, exePath: d.exePath, env: d.env }),
    relaunch: createDemoSwitch(d.demoSwitch),
    logs: {
      async showRequestLog() {
        const { path, shell } = d.requestLog;
        const exists = existsSync(path);
        if (exists) shell.showItemInFolder(path);
        else {
          mkdirSync(dirname(path), { recursive: true });
          await shell.openPath(dirname(path));
        }
        return { path, exists };
      },
    },
    amazon: createAmazonSignIn({
      appVersion: d.appVersion,
      platform: d.platform,
      ...(d.amazonInstantToken !== undefined ? { instantToken: d.amazonInstantToken } : {}),
      ...(d.amazonParent ? { parent: d.amazonParent } : {}),
    }),
  };
}
