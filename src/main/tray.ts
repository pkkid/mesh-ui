/**
 * Keep running in the system tray (`runInTray` in app settings,
 * docs/platform/cross-platform.md#system-tray). With it on and a tray to
 * show, closing the window (and on Windows and Linux minimizing it) hides
 * it instead, so the renderer keeps polling `notifications.list` and
 * desktop alerts keep arriving. Only Quit (tray menu, Cmd+Q, app menu, an
 * update restart) really exits. Off: nothing changes.
 *
 * No Electron values are imported here, so tests drive it with a fake host;
 * src/main/index.ts provides Electron's `Tray`, `Menu` and the window.
 * The tray menu holds no eero data.
 */

/** The window, as much of it as tray mode needs. */
export type TrayWindow = { hide(): void };

/** A tray icon the host created. */
export type TrayIcon = { destroy(): void };

export type TrayDeps = {
  platform: NodeJS.Platform;
  /** Whether this desktop can show a tray icon now (`linuxTrayAvailable` on Linux, always on macOS and Windows). */
  available(): Promise<boolean>;
  /** Creates the icon with its menu: Open Mesh UI and Quit Mesh UI. A click opens the window too. */
  create(menu: { open(): void; quit(): void }): TrayIcon;
  /** Shows, restores and focuses the window, creating it when there is none. */
  open(): void;
  /** Really quits the app. */
  quit(): void;
  /** The one-time "still running" notice, the first time the window hides. */
  notice(): void;
};

export type TrayMode = {
  /** Shows or removes the icon. Resolves true when it is showing. */
  apply(on: boolean): Promise<boolean>;
  /** True while closing or minimizing hides the window. */
  active(): boolean;
  /** A real quit is under way (`before-quit`, an update restart, OS shutdown): closing must close. */
  quitting(): void;
  /** The window's `close`: true when it hid the window, so the caller prevents the close. */
  close(win: TrayWindow): boolean;
  /** The window's `minimize`: true when it hid the window (never on macOS, where minimize goes to the Dock). */
  minimize(win: TrayWindow): boolean;
};

export function createTrayMode(d: TrayDeps): TrayMode {
  let icon: TrayIcon | null = null;
  let wanted = false;
  let quitting = false;
  let noticed = false;
  /** Bumped by every apply, so an older apply that finishes late does nothing. */
  let generation = 0;

  const remove = () => {
    icon?.destroy();
    icon = null;
  };
  const active = () => icon !== null && !quitting;
  const hide = (win: TrayWindow) => {
    win.hide();
    if (noticed) return;
    noticed = true;
    d.notice();
  };

  return {
    async apply(on) {
      wanted = on;
      const mine = ++generation;
      if (!on) {
        remove();
        return false;
      }
      if (icon) return true;
      let ok = false;
      try {
        ok = await d.available();
      } catch {
        ok = false;
      }
      // Never hide the window to a tray that is not there.
      if (mine !== generation || !wanted || !ok || quitting) return icon !== null;
      try {
        icon = d.create({
          open: () => d.open(),
          quit: () => {
            quitting = true;
            d.quit();
          },
        });
      } catch {
        icon = null;
      }
      return icon !== null;
    },
    active,
    quitting() {
      quitting = true;
      remove();
    },
    close(win) {
      if (!active()) return false;
      hide(win);
      return true;
    },
    minimize(win) {
      if (!active() || d.platform === "darwin") return false;
      hide(win);
      return true;
    },
  };
}

/** Runs a command and answers its stdout, or null when it is missing or fails. */
export type RunText = (cmd: string, args: string[]) => Promise<string | null>;

/** The D-Bus names a StatusNotifierItem host takes (KDE, Cinnamon, XFCE, GNOME with AppIndicator). */
const WATCHERS = ["org.kde.StatusNotifierWatcher", "org.freedesktop.StatusNotifierWatcher"];

/**
 * Whether a Linux desktop shows tray icons: some StatusNotifier watcher owns
 * its name on the session bus. GNOME without the AppIndicator extension has
 * none, and the icon would silently not appear, so the window must not hide.
 * Asks with gdbus, then dbus-send; with neither, answers false.
 */
export async function linuxTrayAvailable(run: RunText): Promise<boolean> {
  for (const name of WATCHERS) {
    const gdbus = await run("gdbus", [
      "call",
      "--session",
      "--dest",
      "org.freedesktop.DBus",
      "--object-path",
      "/org/freedesktop/DBus",
      "--method",
      "org.freedesktop.DBus.NameHasOwner",
      name,
    ]);
    if (gdbus !== null) {
      if (/\btrue\b/.test(gdbus)) return true;
      continue;
    }
    const send = await run("dbus-send", ["--session", "--print-reply", "--dest=org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus.NameHasOwner", `string:${name}`]);
    if (send !== null && /boolean true/.test(send)) return true;
  }
  return false;
}
