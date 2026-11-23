# Cross-platform

macOS, Windows and Linux are all first-class. A feature is not done until it
works on all three, and the security rules in
[security.md](../architecture/security.md) hold on each. This page lists what
differs per OS and how the code handles it.

## Where the differences live

- `src/core` has no platform code. Anything that differs per OS is provided by
  the host (`src/main/host.ts`): the `SecretStore`, the config dir, the logs
  dir, desktop notifications.
- The renderer reads `window.mesh.platform` once and sets `data-platform` on
  `<html>`. CSS and shortcut labels key off it.
- Platform branches use `process.platform` and stay in `src/main` or
  `src/cli`.

## Paths

`app.setPath("userData", <appData>/mesh-ui)` runs before the app is ready, so
the folder is lowercase on every OS.

| | macOS | Windows | Linux |
| --- | --- | --- | --- |
| Config dir | `~/Library/Application Support/mesh-ui/` | `%APPDATA%\mesh-ui\` | `~/.config/mesh-ui/` (honours `XDG_CONFIG_HOME`) |
| Session | `session.json` | `session.json` | `session.json` |
| Settings (shared with the CLI) | `settings.json` | `settings.json` | `settings.json` |
| Window size and position | `window-state.json` | `window-state.json` | `window-state.json` |
| Audit log | `audit.jsonl` | `audit.jsonl` | `audit.jsonl` |
| eero request log | `eero-requests.jsonl` (+ `.1`) | `eero-requests.jsonl` (+ `.1`) | `eero-requests.jsonl` (+ `.1`) |
| Logs | `logs/main.log` | `logs\main.log` | `logs/main.log` |
| CLI Chromium data | `cli/` | `cli\` | `cli/` |

UI preferences (theme, panel state) live in renderer localStorage inside the
same folder.

Never hard-code a separator; use `path.join`.

## Secret storage

| OS | `safeStorage` backend | Counts as a keychain | Notes |
| --- | --- | --- | --- |
| macOS | Keychain item "Mesh UI Safe Storage" | Yes | Item is tied to the signed app; an unsigned dev build gets its own item, so dev sessions do not mix with release ones |
| Windows | DPAPI (key kept encrypted in `Local State` in the config dir) | Yes | Per user; roaming profiles carry it |
| Linux | `gnome_libsecret`, `kwallet`, `kwallet5`, `kwallet6` | Yes | Needs a Secret Service or KWallet on the session D-Bus |
| Linux | `basic_text`, `unknown` | **No** | Session stays in memory; sign in each launch |

- Availability comes from `safeStorage.isAsyncEncryptionAvailable()` (the
  async API, see [security.md](../architecture/security.md#session-storage));
  the Linux backend name still comes from `getSelectedStorageBackend()`.
- Chromium picks the Linux backend from the desktop environment. Users can
  force one with `--password-store=gnome-libsecret` or `kwallet6`.
- Test the no-keychain path with `--password-store=basic`; Account must
  say "Your session is kept in memory. You'll sign in again next launch."
- The CLI uses the same binary and so the same backend (see
  [cli.md](../architecture/cli.md#how-the-cli-runs)).

## Window and titlebar

| | macOS | Windows | Linux |
| --- | --- | --- | --- |
| Frame | `titleBarStyle: "hiddenInset"` | `titleBarStyle: "hidden"` + `titleBarOverlay` | Same as Windows |
| Native controls | Traffic lights at `{ x: 16, y: 15 }` | Overlay min, max, close at the right | Overlay at the right |
| CSS inset | `--titlebar-inset-left: 78px` | `--titlebar-inset-right` measured from the overlay (140px fallback) | Same as Windows |
| Overlay colours | n/a | Follow theme via `setTitleBarOverlay` | Same |
| Close last window | App keeps running (dock) | App quits | App quits |

- Titlebar height is 44px (`TITLEBAR_HEIGHT` in main, `--titlebar-height` in
  CSS); keep them equal.
- On Windows and Linux the controls overlay is `TITLEBAR_HEIGHT - 1` (43px,
  `OVERLAY_HEIGHT` in main), so the top bar's 1px bottom border, the last row
  of the 44px strip, still shows under the window controls.
- The top strip of each pane is a `drag-region`; interactive elements in it
  need `no-drag`.
- On Linux under Wayland, the overlay needs Electron's Wayland support
  (`--ozone-platform-hint=auto`, the default in current Electron). If a
  compositor does not support window controls overlay, fall back to a frame
  with native decorations; check GNOME and KDE.
- Default window size 1200 x 780, minimum 760 x 480.
- The window reopens at its last size, position and maximized state
  (`src/main/window-state.ts`, saved to `window-state.json` on close and
  shortly after each move or resize). On launch the saved bounds are fitted
  to the displays present: a size bigger than the display's work area
  shrinks to it, and if the titlebar would not be on any display the window
  centres on the primary one instead. Minimized and full screen states are
  not saved. Headless runs (`ui:shot`) ignore the file and always use the
  default size.

## Menus and shortcuts

- macOS gets a standard app menu (About, Settings `Cmd ,`, Hide, Quit), plus
  Edit (needed for copy and paste in inputs) and Window. Windows and Linux get
  no menu bar; the same items are in the sidebar and Settings.
- Modifier: `Cmd` on macOS, `Ctrl` elsewhere. Rebindable shortcuts
  (`lib/shortcuts.ts`) have a default per platform and render per platform
  (`⌘,`, `Ctrl+,`).
- `Ctrl Q` / `Cmd Q` quits; `Alt F4` on Windows and Linux closes as usual.

## Notifications

Desktop notifications (new device, eero offline, update scheduled) are shown
by main with Electron's `Notification`.

| OS | Needs |
| --- | --- |
| macOS | A signed app; the first notification triggers the system permission prompt |
| Windows | `app.setAppUserModelId("io.github.pkkid.meshui")` before the first notification, and the Start menu shortcut the NSIS installer creates; the portable zip shows none until run once from a shortcut |
| Linux | A notification daemon (most desktops); silently skipped otherwise |

The user can turn them off on the Application page (`app.settings.set`).

## System tray

**Keep running in the tray** (Settings, Application settings; `app.settings.set {runInTray}`,
off by default; `src/main/tray.ts`) keeps Mesh UI running after its window
is closed, so desktop alerts keep arriving.

- **On:** closing the window (X, `Alt F4`, `Cmd W`) hides it; on Windows and
  Linux minimizing hides it too (macOS keeps its normal minimize to the
  Dock). The first hide in a run shows one notice, "Mesh UI is still
  running". Only Quit really exits: the tray menu's **Quit Mesh UI**,
  `Cmd Q`, the app menu, an update restart, or the OS logging off or
  shutting down.
- **Tray icon:** clicking it (Windows and Linux) or its menu's **Open Mesh
  UI** shows and focuses the window. The menu holds no eero data. The icon
  is always the monochrome mesh glyph (`build/tray/mesh-ui-tray-*.svg`): a
  template image in the macOS menu bar (`mesh-ui-trayTemplate.png`, which
  macOS tints), and on Windows and Linux white on a dark taskbar or panel and
  black on a light one (`build/tray/png/`), swapped when the OS theme changes
  (Windows reads the taskbar's own theme, `shouldUseDarkColorsForSystemIntegratedUI`).
- **One copy:** while the setting is on Mesh UI holds Electron's
  single-instance lock, so launching it again shows the running copy instead
  of opening a second one (two copies would poll, and alert, twice).
- **Alerts while hidden:** the hidden window's renderer keeps polling
  `notifications.list` every 5 minutes (`backgroundThrottling: false`), well
  under the eero rate budget. See [engine.md](../architecture/engine.md#events-to-the-ui).
- **Off:** nothing changes: closing quits on Windows and Linux, and macOS
  stays in the Dock as usual.

| OS | Tray |
| --- | --- |
| macOS | Menu bar icon; click opens the menu |
| Windows | Notification area icon; click opens the window |
| Linux | StatusNotifier icon (KDE, Cinnamon, XFCE, GNOME with the AppIndicator extension). Mesh UI asks D-Bus for a `StatusNotifierWatcher` (gdbus, else dbus-send); with none (plain GNOME) the switch is disabled with "This desktop shows no tray icons" and closing quits as usual, so the window never hides to a tray that is not there |

Headless runs (ui:shot), the CLI and tests never create a tray; tests drive
`createTrayMode` with a fake host.

## Start at login

**Start at login** (Settings, Application settings; `app.startup.set`,
`src/main/startup.ts`) asks the OS to open Mesh UI when the user signs in.
The OS keeps the truth, so turning it off in system settings shows in Mesh UI.

| OS | How |
| --- | --- |
| macOS | A login item (`app.setLoginItemSettings`); a login launch is seen with `wasOpenedAtLogin` |
| Windows | The Run key entry Electron writes for this exe, with `--hidden` (NSIS and the portable zip) |
| Linux | `~/.config/autostart/mesh-ui.desktop` (or under `$XDG_CONFIG_HOME`), `Exec` the AppImage file or the installed binary with `--hidden`; an entry the desktop turned off (`Hidden=true`, `X-GNOME-Autostart-enabled=false`) reads as off |

- With Keep running in the tray on, a login launch always starts hidden in
  the tray. On Linux the panel's tray host can start after Mesh UI, so a
  login launch retries for up to 20 s before giving up; only a desktop with
  no tray at all then shows the window. With the tray setting off the
  window opens as usual, and the Start at login row says so. The demo
  relaunch drops `--hidden`.
- Development builds cannot register one (it would start the bare Electron
  binary): the switch is disabled.
- Headless runs keep it in memory, so a screenshot never adds a real login item.

## Fonts and rendering

- Inter Variable is bundled (`@fontsource-variable/inter`), so text looks the
  same everywhere. Mono falls back through `ui-monospace`, SF Mono, Menlo,
  Consolas, Liberation Mono.
- Check charts on a non-HiDPI Windows display: 1px gridlines with
  `vector-effect="non-scaling-stroke"` must stay sharp.
- Scrollbars are thin and custom on all OSes (6px).

## CLI

| | macOS | Windows | Linux |
| --- | --- | --- | --- |
| Launcher | `/usr/local/bin/mesh-ui` symlink, installed from Settings | `mesh-ui.cmd` in `<install dir>\bin`, added to user `PATH` by NSIS | `/usr/bin/mesh-ui` (deb, rpm); `~/.local/bin/mesh-ui` from Settings (AppImage) |
| How it starts | App binary with `--cli` | Node-mode relay spawns the app with `--cli` (console output) | App binary with `--cli` |
| Dock or taskbar icon | Hidden (`app.dock.hide()`) | None (no window) | None |
| No display | n/a | n/a | Launcher always drops `DISPLAY` and `WAYLAND_DISPLAY` and adds `--ozone-platform=headless --disable-gpu` |

Full detail in [build-and-release.md](build-and-release.md#cli-launcher).

## Line endings and shells

- `.gitattributes` keeps `* text=auto eol=lf`; scripts and fixtures use LF.
  The exception is Windows batch files (`*.cmd`, `*.bat`), checked out with
  CRLF so `cmd.exe` runs them reliably. Images are marked binary.
- Docs give CLI examples for POSIX shells. On Windows PowerShell, JSON params
  need single quotes around the whole value or `--params @file.json`; the
  CLI help says so.

## Checking each platform

- CI runs typecheck, unit, command, client, CLI and MCP tests on macOS,
  Windows and Linux (see [testing.md](../testing.md)).
- UI screenshots in demo mode are taken on Linux in CI; the milestone review
  adds macOS and Windows screenshots when a change touches the titlebar,
  menus or notifications.
- Packaging is smoke-tested per OS in the release workflow: install, launch
  with `--demo`, run `mesh-ui --demo run app.info`, uninstall.
