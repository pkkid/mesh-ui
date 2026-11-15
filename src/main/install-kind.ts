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

/** electron-builder's NSIS uninstaller sits beside the exe: `Uninstall Mesh UI.exe`. */
const NSIS_UNINSTALLER = /^uninstall .+\.exe$/i;

export function detectInstallKind(i: InstallKindInput): InstallKind {
  if (!i.packaged) return "dev";
  if (i.platform === "darwin") return "mac";
  if (i.platform === "win32") {
    const dir = (i.exePath.includes("\\") ? path.win32 : path).dirname(i.exePath);
    return i.list(dir).some((f) => NSIS_UNINSTALLER.test(f)) ? "nsis" : "portable";
  }
  // Linux. The AppImage runtime sets APPIMAGE to the image's path.
  if (i.env.APPIMAGE) return "appimage";
  // electron-builder writes `resources/package-type` for deb and rpm.
  const type = i.readText(path.join(i.resourcesPath, "package-type"))?.trim();
  if (type === "deb" || type === "rpm") return type;
  // An unpacked build (`pnpm dist:dir`) or archive: it cannot update itself, like the portable zip.
  return "portable";
}
