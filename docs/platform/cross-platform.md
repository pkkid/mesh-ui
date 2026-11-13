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
| Audit log | `audit.jsonl` | `audit.jsonl` | `audit.jsonl` |
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

- Chromium picks the Linux backend from the desktop environment. Users can
  force one with `--password-store=gnome-libsecret` or `kwallet6`.
- Test the no-keychain path with `--password-store=basic`; App & account must
  say "Your session is kept in memory. You'll sign in again next launch."
- The CLI uses the same binary and so the same backend (see
  [cli.md](../architecture/cli.md#how-the-cli-runs)).

## Window and titlebar

| | macOS | Windows | Linux |
| --- | --- | --- | --- |
| Frame | `titleBarStyle: "hiddenInset"` | `titleBarStyle: "hidden"` + `titleBarOverlay` | Same as Windows |
| Native controls | Traffic lights at `{ x: 16, y: 15 }` | Overlay min, max, close at the right | Overlay at the right |
| CSS inset | `--titlebar-inset-left: 78px` | `--titlebar-inset-right: 140px` | `--titlebar-inset-right: 140px` |
| Overlay colours | n/a | Follow theme via `setTitleBarOverlay` | Same |
| Close last window | App keeps running (dock) | App quits | App quits |

- Titlebar height is 44px (`TITLEBAR_HEIGHT` in main, `--titlebar-height` in
  CSS); keep them equal.
- The top strip of each pane is a `drag-region`; interactive elements in it
  need `no-drag`.
- On Linux under Wayland, the overlay needs Electron's Wayland support
  (`--ozone-platform-hint=auto`, the default in current Electron). If a
  compositor does not support window controls overlay, fall back to a frame
  with native decorations; check GNOME and KDE.
- Minimum window size 760 x 480. Window bounds are restored per display.

## Menus and shortcuts

- macOS gets a standard app menu (About, Settings `Cmd ,`, Hide, Quit), plus
  Edit (needed for copy and paste in inputs) and Window. Windows and Linux get
  no menu bar; the same items are in the sidebar and App & account.
- Modifier: `Cmd` on macOS, `Ctrl` elsewhere. Shortcut definitions use
  `Mod+K` and render per platform (`Cmd K`, `Ctrl K`).
- `Ctrl Q` / `Cmd Q` quits; `Alt F4` on Windows and Linux closes as usual.

## Notifications

Desktop notifications (new device, eero offline, update scheduled) are shown
by main with Electron's `Notification`.

| OS | Needs |
| --- | --- |
| macOS | A signed app; the first notification triggers the system permission prompt |
| Windows | `app.setAppUserModelId("io.github.pkkid.meshui")` before the first notification, and the Start menu shortcut the NSIS installer creates; the portable zip shows none until run once from a shortcut |
| Linux | A notification daemon (most desktops); silently skipped otherwise |

The user can turn them off in App & account (`app.settings.set`).

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
| Launcher | `/usr/local/bin/mesh-ui` symlink, installed from App & account | `mesh-ui.cmd` in `<install dir>\bin`, added to user `PATH` by NSIS | `/usr/bin/mesh-ui` (deb, rpm); `~/.local/bin/mesh-ui` from App & account (AppImage) |
| How it starts | App binary with `--cli` | Node-mode relay spawns the app with `--cli` (console output) | App binary with `--cli` |
| Dock or taskbar icon | Hidden (`app.dock.hide()`) | None (no window) | None |
| No display | n/a | n/a | Launcher adds `--ozone-platform=headless` |

Full detail in [build-and-release.md](build-and-release.md#cli-launcher).

## Line endings and shells

- `.gitattributes` keeps `* text=auto eol=lf`; scripts and fixtures use LF.
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
