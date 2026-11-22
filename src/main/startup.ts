/**
 * Start at login (`app.startup.set`, docs/platform/cross-platform.md#start-at-login):
 * the window's `startup` host action. The OS keeps the truth, so the switch
 * follows changes made in system settings too:
 *
 * - macOS: a login item (`app.setLoginItemSettings`); a launch at login is
 *   seen with `wasOpenedAtLogin`.
 * - Windows: the Run key entry Electron writes, with `--hidden`.
 * - Linux: `~/.config/autostart/mesh-ui.desktop` (XDG autostart; KDE, GNOME,
 *   Cinnamon and XFCE all read it), `Exec` the AppImage or the installed
 *   binary, with `--hidden`.
 *
 * A login launch (`--hidden`, or `wasOpenedAtLogin`) starts in the tray
 * without showing the window, but only while Keep running in the tray is on
 * and a tray is showing; otherwise the window opens as usual.
 *
 * Development builds are not supported: they would register the bare
 * Electron binary. No Electron values are imported, so tests use fakes.
 */

import type { InstallKind, StartupStatus } from "../core/model";
import type { HostActions } from "../core/spec";

/** The argument a login launch carries on Windows and Linux. */
export const HIDDEN_FLAG = "--hidden";

/** Electron's login item calls, as much as this needs. */
export type LoginItems = {
  get(options?: { path?: string; args?: string[] }): { openAtLogin: boolean; wasOpenedAtLogin?: boolean };
  set(settings: { openAtLogin: boolean; path?: string; args?: string[] }): void;
};

export type StartupDeps = {
  platform: NodeJS.Platform;
  install: InstallKind;
  exePath: string;
  env: Readonly<Record<string, string | undefined>>;
  home: string;
  login: LoginItems;
  fs: {
    exists(path: string): boolean;
    read(path: string): string;
    write(path: string, text: string): void;
    remove(path: string): void;
  };
};

/** Where the Linux autostart entry lives: `$XDG_CONFIG_HOME/autostart`, else `~/.config/autostart`. */
export function autostartFile(env: StartupDeps["env"], home: string): string {
  const base = env.XDG_CONFIG_HOME?.startsWith("/") ? env.XDG_CONFIG_HOME : `${home}/.config`;
  return `${base}/autostart/mesh-ui.desktop`;
}

/** Quotes a path for a desktop entry's Exec key. */
const quoteExec = (p: string) => `"${p.replace(/(["`$\\])/g, "\\$1")}"`;

/** The Linux autostart entry. The AppImage starts from its own file, not the mounted copy. */
export function autostartEntry(d: Pick<StartupDeps, "install" | "exePath" | "env">): string {
  const exe = d.install === "appimage" && d.env.APPIMAGE ? d.env.APPIMAGE : d.exePath;
  return ["[Desktop Entry]", "Type=Application", "Name=Mesh UI", "Comment=Manage eero mesh networks", `Exec=${quoteExec(exe)} ${HIDDEN_FLAG}`, "Icon=mesh-ui", "Terminal=false", "X-GNOME-Autostart-enabled=true", ""].join("\n");
}

/** An entry turned off in the desktop's startup settings counts as off. */
const entryEnabled = (text: string) => !/^Hidden\s*=\s*true\s*$/im.test(text) && !/^X-GNOME-Autostart-enabled\s*=\s*false\s*$/im.test(text);

export function createStartup(d: StartupDeps): NonNullable<HostActions["startup"]> {
  const supported = d.install !== "dev";
  const file = autostartFile(d.env, d.home);
  const winItem = { path: d.exePath, args: [HIDDEN_FLAG] };

  const enabled = (): boolean => {
    if (!supported) return false;
    if (d.platform === "linux") return d.fs.exists(file) && entryEnabled(d.fs.read(file));
    if (d.platform === "win32") return d.login.get(winItem).openAtLogin;
    return d.login.get().openAtLogin;
  };

  return {
    status: async (): Promise<StartupStatus> => ({ supported, enabled: enabled() }),
    async set(on) {
      if (supported) {
        if (d.platform === "linux") {
          if (on) d.fs.write(file, autostartEntry(d));
          else if (d.fs.exists(file)) d.fs.remove(file);
        } else if (d.platform === "win32") {
          d.login.set({ openAtLogin: on, ...winItem });
        } else {
          d.login.set({ openAtLogin: on });
        }
      }
      return { supported, enabled: enabled() };
    },
  };
}

/** Whether this launch came from the login item: `--hidden` (Windows, Linux) or macOS's `wasOpenedAtLogin`. */
export function openedAtLogin(platform: NodeJS.Platform, argv: readonly string[], login: Pick<LoginItems, "get">): boolean {
  if (argv.includes(HIDDEN_FLAG)) return true;
  if (platform !== "darwin") return false;
  try {
    return login.get().wasOpenedAtLogin === true;
  } catch {
    return false;
  }
}
