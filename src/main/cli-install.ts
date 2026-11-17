/**
 * The `mesh-ui` command on PATH (docs/platform/build-and-release.md#cli-launcher,
 * docs/architecture/cli.md#install), behind `app.cli.install`.
 *
 * - macOS: a symlink `/usr/local/bin/mesh-ui` to the bundle's
 *   `Contents/Resources/bin/mesh-ui`, made through the system admin prompt
 *   (`osascript ... with administrator privileges`). The paths go to osascript
 *   as arguments and reach the shell only through AppleScript's
 *   `quoted form of`, never spliced into a command string.
 * - AppImage: a script `~/.local/bin/mesh-ui` that runs `$APPIMAGE --cli`
 *   with no display, like the deb and rpm launcher.
 * - deb, rpm and nsis: the installer put the launcher there; this only
 *   reports it. portable: reports its `bin` folder. dev: no launcher.
 *
 * "Reinstall" shows when the launcher points at an app that moved. Every file
 * system call and the privileged runner can be injected, so
 * src/main/cli-install.test.ts covers every kind in a temp HOME on any OS.
 */

import { execFile } from "node:child_process";
import { chmodSync, lstatSync, mkdirSync, readFileSync, readlinkSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CommandError } from "../core/errors";
import type { CliStatus, InstallKind } from "../core/model";
import type { HostActions } from "../core/spec";
import { ownAppImage } from "./install-kind";

export type CliFs = {
  /** Whether `file` exists, a dangling symlink included. */
  exists(file: string): boolean;
  /** A symlink's target, or null when `file` is not a symlink. */
  readLink(file: string): string | null;
  /** A text file, or null when it is missing. */
  readText(file: string): string | null;
  mkdirp(dir: string): void;
  /** Writes `file` with mode 755, replacing it in one step. */
  writeExecutable(file: string, text: string): void;
};

/** Runs a program with argv (no shell); rejects with its stderr when it fails. */
export type Runner = (file: string, args: readonly string[]) => Promise<void>;

export type CliInstallDeps = {
  install: InstallKind;
  /** `process.execPath`. */
  exePath: string;
  env: Readonly<Record<string, string | undefined>>;
  /** Default `process.platform`. */
  platform?: NodeJS.Platform;
  home?: string;
  fs?: Partial<CliFs>;
  /** Runs osascript for the macOS admin prompt. */
  runPrivileged?: Runner;
};

/** Where the macOS link goes, and the folders a login shell has on PATH there. */
const MAC_BIN = "/usr/local/bin";
const MAC_ETC_PATHS = "/etc/paths";

/** The Windows kinds: the NSIS installer, and the portable zip when on Windows. */
const isWin = (d: Pick<CliInstallDeps, "install" | "platform">) =>
  d.install === "nsis" || (d.install === "portable" && (d.platform ?? process.platform) === "win32");

/**
 * Where each install kind's launcher lives; null for dev builds and for an
 * unpacked build or archive on Linux or macOS, which ship no launcher of
 * their own (the deb launcher points at /opt).
 */
export function launcherPath(d: Pick<CliInstallDeps, "install" | "exePath" | "home" | "platform">): string | null {
  const home = d.home ?? os.homedir();
  switch (d.install) {
    case "mac":
      return path.posix.join(MAC_BIN, "mesh-ui");
    case "appimage":
      return path.join(home, ".local", "bin", "mesh-ui");
    case "deb":
    case "rpm":
      return "/usr/bin/mesh-ui";
    case "nsis":
    case "portable":
      if (!isWin(d)) return null;
      return path.win32.join(path.win32.dirname(d.exePath), "bin", "mesh-ui.cmd");
    default:
      return null;
  }
}

/** The bundle's launcher script: `<app>/Contents/MacOS/Mesh UI` to `<app>/Contents/Resources/bin/mesh-ui`. */
export function macBundleLauncher(exePath: string): string {
  return path.posix.join(path.posix.dirname(path.posix.dirname(exePath)), "Resources", "bin", "mesh-ui");
}

const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** The `~/.local/bin/mesh-ui` script for an AppImage at `appImage`. */
export function appImageScript(appImage: string): string {
  return [
    "#!/bin/sh",
    "# Mesh UI command line launcher, written by Settings & Account (Install CLI).",
    "# It runs the AppImage headless and never lets it reach a display server.",
    "unset DISPLAY WAYLAND_DISPLAY",
    `exec ${shQuote(appImage)} --cli --ozone-platform=headless --disable-gpu "$@"`,
    "",
  ].join("\n");
}

/** The AppleScript run by osascript: `argv` is the link target, the link, and the link's folder. */
export const MAC_INSTALL_SCRIPT = [
  "on run argv",
  'do shell script "/bin/mkdir -p " & quoted form of (item 3 of argv) & " && /bin/ln -sf " & quoted form of (item 1 of argv) & " " & quoted form of (item 2 of argv) with administrator privileges',
  "end run",
];

/** osascript's argv for the macOS install. */
export function macInstallArgs(target: string, link: string): string[] {
  return [...MAC_INSTALL_SCRIPT.flatMap((line) => ["-e", line]), target, link, path.posix.dirname(link)];
}

/** A line to paste into a shell (or PowerShell on Windows) that adds `dir` to PATH. */
export function pathLine(dir: string, windows: boolean): string {
  if (windows) {
    const ps = dir.replace(/[`$"]/g, (c) => `\`${c}`);
    return `[Environment]::SetEnvironmentVariable("Path", [Environment]::GetEnvironmentVariable("Path", "User") + ";${ps}", "User")`;
  }
  return `export PATH="${dir.replace(/[\\"$`]/g, (c) => `\\${c}`)}:$PATH"`;
}

const realFs: CliFs = {
  // lstat, so a link left dangling by a moved app still counts (and asks for Reinstall).
  exists: (file) => {
    try {
      lstatSync(file);
      return true;
    } catch {
      return false;
    }
  },
  readLink: (file) => {
    try {
      return readlinkSync(file);
    } catch {
      return null;
    }
  },
  readText: (file) => {
    try {
      return readFileSync(file, "utf8");
    } catch {
      return null;
    }
  },
  mkdirp: (dir) => void mkdirSync(dir, { recursive: true }),
  writeExecutable: (file, text) => {
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, text, { mode: 0o755 });
    chmodSync(tmp, 0o755);
    renameSync(tmp, file);
  },
};

const execRunner: Runner = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(file, [...args], { timeout: 5 * 60_000 }, (err, _stdout, stderr) => {
      if (err) reject(new Error(String(stderr || err.message).trim()));
      else resolve();
    });
  });

/** osascript's answer when the person closes the admin prompt (error -128). */
const CANCELLED = /-128|user cancel/i;

export function createCliInstaller(d: CliInstallDeps): NonNullable<HostActions["cli"]> {
  const fs: CliFs = { ...realFs, ...d.fs };
  const run = d.runPrivileged ?? execRunner;
  const win = isWin(d);

  /** What the launcher should point at (macOS link target, AppImage path), or null. */
  const target = (): string | null => {
    if (d.install === "mac") return macBundleLauncher(d.exePath);
    if (d.install === "appimage") return ownAppImage(d.env, d.exePath);
    return null;
  };

  /** The folders a new terminal has on PATH. */
  const pathDirs = (): string[] => {
    const dirs = (d.env.PATH ?? "").split(win ? ";" : ":");
    // An app opened from the macOS Finder gets a short PATH; terminals add /etc/paths.
    if (d.install === "mac") dirs.push(...(fs.readText(MAC_ETC_PATHS) ?? "").split("\n"));
    return dirs.map((s) => s.trim()).filter(Boolean);
  };

  const sameDir = (a: string, b: string) =>
    win
      ? path.win32.resolve(a).toLowerCase() === path.win32.resolve(b).toLowerCase()
      : path.posix.resolve(a) === path.posix.resolve(b);

  const status = async (): Promise<CliStatus> => {
    const file = launcherPath(d);
    const installed = file !== null && fs.exists(file);
    const dir = file === null ? null : win ? path.win32.dirname(file) : path.posix.dirname(file);
    const onPath = installed && dir !== null && pathDirs().some((p) => sameDir(p, dir));
    let reinstall = false;
    const want = target();
    if (installed && file && want) {
      if (d.install === "mac") reinstall = fs.readLink(file) !== want;
      if (d.install === "appimage") reinstall = fs.readText(file) !== appImageScript(want);
    }
    // The folder to add by hand: the bundle's bin folder on macOS (no admin needed), else the launcher's.
    const manual = d.install === "mac" ? path.posix.dirname(macBundleLauncher(d.exePath)) : dir;
    return {
      installed,
      path: file,
      onPath,
      canInstall: d.install === "mac" || (d.install === "appimage" && want !== null),
      reinstall,
      pathLine: (onPath && !reinstall) || manual === null ? null : pathLine(manual, win),
    };
  };

  const install = async (): Promise<CliStatus> => {
    const file = launcherPath(d);
    const want = target();
    if (d.install === "appimage") {
      if (!file || !want) throw new CommandError("bad_params", "Mesh UI is not running from its own AppImage (APPIMAGE or APPDIR does not match), so it cannot install the launcher.");
      fs.mkdirp(path.dirname(file));
      fs.writeExecutable(file, appImageScript(want));
    } else if (d.install === "mac") {
      if (!file || !want) throw new CommandError("bad_params", "The command line tool cannot be installed from here.");
      try {
        await run("/usr/bin/osascript", macInstallArgs(want, file));
      } catch (err) {
        // Declining the admin prompt is not an error: the panel shows the PATH line instead.
        if (!CANCELLED.test(err instanceof Error ? err.message : String(err))) {
          throw new CommandError("bad_params", "Could not install the command line tool. Add it to PATH by hand instead.");
        }
      }
    }
    // deb, rpm, nsis and portable: the installer (or the person) put it there; report it.
    return status();
  };

  return { status, install };
}
