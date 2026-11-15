/**
 * The `mesh-ui` command on PATH (docs/platform/build-and-release.md#cli-launcher).
 * Stub until M6.6: it reports where the launcher should be and whether it
 * is there, but installing answers "not available yet".
 */

import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CommandError } from "../core/errors";
import type { CliStatus, InstallKind } from "../core/model";
import type { HostActions } from "../core/spec";

export type CliInstallDeps = {
  install: InstallKind;
  /** `process.execPath`. */
  exePath: string;
  env: Readonly<Record<string, string | undefined>>;
  home?: string;
  exists?(file: string): boolean;
};

/** Where each install kind's launcher lives; null for dev builds. */
export function launcherPath(d: CliInstallDeps): string | null {
  const home = d.home ?? os.homedir();
  switch (d.install) {
    case "mac":
      return "/usr/local/bin/mesh-ui";
    case "appimage":
      return path.join(home, ".local", "bin", "mesh-ui");
    case "deb":
    case "rpm":
      return "/usr/bin/mesh-ui";
    case "nsis":
    case "portable":
      return path.win32.join(path.win32.dirname(d.exePath), "bin", "mesh-ui.cmd");
    default:
      return null;
  }
}

export function createCliInstaller(d: CliInstallDeps): NonNullable<HostActions["cli"]> {
  const exists = d.exists ?? existsSync;
  const status = async (): Promise<CliStatus> => {
    const file = launcherPath(d);
    const installed = file !== null && exists(file);
    const dirs = (d.env.PATH ?? "").split(d.install === "nsis" || d.install === "portable" ? ";" : ":").filter(Boolean);
    const onPath = installed && file !== null && dirs.some((dir) => path.resolve(dir) === path.resolve(path.dirname(file)) || dir === path.win32.dirname(file));
    return { installed, path: file, onPath, canInstall: d.install === "mac" || d.install === "appimage", reinstall: false };
  };
  return {
    status,
    install: async () => {
      throw new CommandError("bad_params", "Installing the command line tool is not available yet.");
    },
  };
}
