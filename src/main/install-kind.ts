/**
 * How this copy of Mesh UI was installed, which decides whether it updates
 * itself and how the CLI reaches PATH (docs/platform/build-and-release.md,
 * Auto-update and CLI launcher). Pure, with the file system passed in, so
 * src/main/install-kind.test.ts covers every kind on any OS.
 */

import path from "node:path";
import type { InstallKind } from "../core/model";

export type InstallKindInput = {
  /** `app.isPackaged`. */
  packaged: boolean;
  platform: NodeJS.Platform;
  env: Readonly<Record<string, string | undefined>>;
  /** `process.resourcesPath`. */
  resourcesPath: string;
  /** `process.execPath` (the app executable). */
  exePath: string;
  /** Reads a small text file, or null when it is missing. */
  readText(file: string): string | null;
  /** File names in a folder, or [] when it cannot be read. */
  list(dir: string): string[];
};

/**
 * The AppImage this process runs from, or null. APPIMAGE alone is not
 * enough: a program started from another AppImage (a terminal, an editor)
 * inherits its APPIMAGE and APPDIR, so the image's mount (APPDIR) must hold
 * this executable. AppImage is Linux only, so paths are POSIX.
 */
export function ownAppImage(env: Readonly<Record<string, string | undefined>>, exePath: string): string | null {
  const image = env.APPIMAGE;
  const dir = env.APPDIR;
  if (!image || !dir) return null;
  const rel = path.posix.relative(path.posix.resolve(dir), path.posix.resolve(exePath));
  return rel !== "" && rel !== ".." && !rel.startsWith("../") && !path.posix.isAbsolute(rel) ? image : null;
}

/** electron-builder's NSIS uninstaller sits beside the exe: `Uninstall Mesh UI.exe`. */
const NSIS_UNINSTALLER = /^uninstall .+\.exe$/i;

export function detectInstallKind(i: InstallKindInput): InstallKind {
  if (!i.packaged) return "dev";
  if (i.platform === "darwin") return "mac";
  if (i.platform === "win32") {
    const dir = (i.exePath.includes("\\") ? path.win32 : path).dirname(i.exePath);
    return i.list(dir).some((f) => NSIS_UNINSTALLER.test(f)) ? "nsis" : "portable";
  }
  // Linux. The AppImage runtime sets APPIMAGE and mounts the image at APPDIR, which holds the exe.
  if (ownAppImage(i.env, i.exePath)) return "appimage";
  // electron-builder writes `resources/package-type` for deb and rpm.
  const type = i.readText(path.posix.join(i.resourcesPath, "package-type"))?.trim();
  if (type === "deb" || type === "rpm") return type;
  // An unpacked build (`pnpm dist:dir`) or archive: it cannot update itself, like the portable zip.
  return "portable";
}
