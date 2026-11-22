# Settings

This copy of Mesh UI: the app version and updates, startup and tray, the application theme, keyboard shortcuts, and the CLI and MCP hookup. The eero account (profile, notifications, networks, sign out and deletion) is on the [Account](account.md) page.

Mockup: [../../mockups/17-account-settings.html](../../mockups/17-account-settings.html) (drawn before the split; Settings has its CLI, theme and About sections; About is now the hero)

Shared patterns (flat hero, sections, footnotes) are described in [../overview.md](../overview.md).

## Layout

Breadcrumb `Settings`, nothing after it. The last item in the sidebar Settings group; also opens from the palette, its shortcut (`Ctrl+,` by default) and deep links. One full-width column, sections `gap-14` apart; no side panel (the About panel became the hero on 2026-11-21).

1. **Hero** (the flat page header): this copy of Mesh UI, front and centre.
   - Icon: the app icon (`AppIcon`, 64px). Title: `Mesh UI 0.6.0`.
   - Status line: the update status, then on its own line under it, in the same colour but not bold, "Mesh UI is an independent app and is not made by eero or Amazon." (it was a footnote at the foot of the page until 2026-11-21). The update status (status dot and line: "Up to date · checked 20m ago", "Not checked yet", "Automatic updates off", "Checking for updates", "Version 0.6.1 is available", "Downloading 0.6.1 · 42%", "Version 0.6.1 is ready", the error line, or for deb, rpm, portable and dev installs why it does not update itself: "Installed with a package manager. Update with apt or dnf.", "Development build. Updates are off.").
   - Under the status, one stacked list in one format, every line its icon then the words: **Electron 45.3.1** (atom icon), **Platform Linux x64** (monitor icon), then the links **Release notes** and **Source and issues** (open in the browser). Label and value are one colour, one space apart (no colon); no left and right aligned columns.
   - Actions (outline, dim icons), only where this copy updates itself: **Restart to update** when an update is ready; **Download from GitHub** (an unsigned macOS build, which cannot install updates itself, with a note saying so) when one is available; **Check for updates** otherwise (spinning icon while it checks). A progress bar shows while downloading. Under them the **Automatic updates** ("Check at launch and every 6 hours") and **Beta updates** ("Also get pre-releases") switches.
   - Right-hand column, **eero details** (a section-style title, `text-base font-semibold`), in the same format: **Support ID K4M9QZ** (ID card icon, mono, with a copy icon after it), then **eero support articles** (opens in the browser) and **Show eero request log** (`app.log.show`, hidden in demo mode).
2. **Startup and tray**, laid out like the Advanced networking groups: one card of settings rows (title, muted description, switch on the right; `Group` and `Row`). Subtitle from the two settings: "Opens only when you start it. Closing the window quits it." ("Opens at login", "Starts in the tray at login"; "Closing the window keeps it running in the tray."). Rows:
   - **Start at login** (`app.startup.set`), read back from the OS (`app.info.startup`), so a change made in system settings shows here too. "Open Mesh UI when you sign in to this computer. With Keep running in the tray on, it starts in the tray without opening the window." A development build cannot register a login item: the switch is disabled and the description says so.
   - **Keep running in the tray** (`app.settings.set {runInTray}`, off by default). "Closing the window keeps Mesh UI running in the system tray (the menu bar on macOS), so desktop alerts keep arriving. Quit from the tray icon." On a Linux desktop with no tray (plain GNOME) the description says so (add the AppIndicator extension) and the switch can only be turned off.
   Each switch writes at once with a toast and Undo. See [cross-platform.md#system-tray](../../platform/cross-platform.md#system-tray) and [#start-at-login](../../platform/cross-platform.md#start-at-login).
3. **Application theme**, subtitle from the picked themes (`Dark mode, Classic`; `System mode, Grove light and Ocean dark`), as in T3 Code. Header tool **Add theme** opens a dialog: a search of Open VSX color themes (search box, Popular / Top rated / Newest, a list of name · publisher, description, theme count, downloads and license, each with **Add**), then "or import a file" to choose, drop or paste VS Code (or Mesh UI / T3 Code) theme files. Adding switches light and dark to the new theme's first light and dark styles. First a row of three tiles, System, Light and Dark, each as wide as one theme card column and centered above the cards (measured from the cards' grid, so they never stretch across the full-width section), each a small wireframe of the window in the picked themes (System splits light and dark down the middle). Then one card per theme or collection (Classic, Rose, Grove, Ocean, Ember, Iris, then added themes), each with a light and a dark preview circle. A circle sets the theme for that mode only; the card's name sets both. The circles in use have a ring and a sun or moon badge. A collection (an added Gruvbox: Hard, Medium, Soft) labels each circle with the picked style and "+2"; hovering a circle fans out the other styles. Each card has small icon buttons after its name: Duplicate (every theme), Edit (added themes), Export (every theme; a collection exports as one file) and Remove (added themes). Duplicate and Edit open the floating theme editor in the bottom right of the window: name, Light / Dark palette, Simple (background and accent) or Advanced colors by area, chart colors, a live preview on the page behind it, a spotlight of where a color is used and Inspect to pick a color from the page; Save or Cancel. See [design-system.md#themes](../../design/design-system.md#themes). Footnote: pick a light and a dark look; themes are stored on this computer only.
4. **Keyboard shortcuts**, subtitle "Saved on this computer.", laid out as T3 Code's keybindings settings. Two cards of three rows side by side (`md:grid-cols-2`, `gap-4`; stacked when narrow), one row per rebindable action. Left: Open command palette (`F1`), Toggle DevTools panel (`F12`), Open Settings (`Ctrl+,`, `⌘,` on macOS). Right: Refresh page data (`F5`), Go back (`Alt ←`, `⌘[` on macOS), Go forward (`Alt →`, `⌘]`). On the right each row shows its one key combination as separate key caps (`Kbd`, no `+` between them), or a muted "Unassigned" once removed, in a borderless pill that looks like a button on hover (`hover:bg-accent`, a faint border). Clicking the pill turns it into a 176px mono field with the placeholder "Press shortcut"; the next combination is saved at once and the pill comes back. `Esc`, `Tab` or clicking away cancels. A refused combination stays in the field (marked invalid) with the reason under the row in warning colour ("F1 is already used by Open command palette.", "Ctrl+C is kept for Copy.", "Add Ctrl or Alt, so typing in a field isn't taken over. F-keys work alone."), and the field keeps recording. Left of the pill, a ghost `⋯` button, shown while the row is hovered or focused (always on touch), opens a menu: **Reset to default** (once the keys differ from the default) and **Remove** (destructive colour, while the action has keys). Header tool **Reset all** (ghost) when any action is changed. Fixed shortcuts (`Ctrl+1` to `7`, `Ctrl+Shift+N`, `[` `]`, `/`, ...) are not listed. Rules and the full list: [overview.md#keyboard-shortcuts](../overview.md#keyboard-shortcuts).
5. **Command line and agents**, subtitle `38 commands this week, MCP used 5m ago` (`No commands this week`, `MCP not used yet`) from the audit log; Mesh UI cannot see whether an agent is connected right now, only when one last ran a command. One card. Left: **Command line** code block (`mesh-ui run device.list`) and **Add MCP server** code blocks, one per agent CLI (`claude mcp add mesh-ui -- mesh-ui mcp`, `codex mcp add mesh-ui -- mesh-ui mcp`, `agy mcp add mesh-ui mesh-ui mcp` for Antigravity), each with a copy icon. When this copy can put `mesh-ui` on PATH itself (`cli.canInstall`: macOS, or the AppImage) and has not, or the link points at a copy that moved, the left side is instead "Use Mesh UI from a terminal" with **Install CLI** (or **Reinstall**) and, under "Or add it to PATH yourself", the `export PATH=...` line to copy (on macOS this is what to use after declining the admin prompt). When the launcher is installed but its folder is not on PATH (AppImage without `~/.local/bin` on PATH, the Windows portable zip), a "Not on PATH yet" note with that line follows the code blocks. Right: "This week" and "38 commands from the CLI and agents" ("No commands yet"), a sparkline of the 7 days, and the latest 5 commands this week (id in mono, `needs confirm` in warning colour when it was refused, age). Empty: "Commands run with mesh-ui or by an AI agent show here." Footnote: everything in this window is also a command; agents never see the session token, and restarting or irreversible commands only run with `--confirm`.



**Deep links.** Each section has a stable id; `#/settings/<section>` opens
the page scrolled to it (a second `settings` route, `/settings/:section`,
listed after the other `/settings/*` pages so they match first, and its
sidebar item stays selected). Sections: `about` (the hero), `startup`, `theme`, `shortcuts`, `cli`
(`SETTINGS_SECTIONS` in `SettingsPage.tsx`, DOM ids `settings-<section>`).
The sidebar's update chip opens `#/settings/about`. Links saved before the
split (`#/account/cli`, `#/account/theme`, `#/account/about`) redirect here.

## Data

| Element | Command | Refresh |
| --- | --- | --- |
| CLI install state, MCP state, command log and counts | `app.info`, `app.audit.list` | on load, every 60 s |
| Themes | renderer local storage (not a command) | |
| Keyboard shortcuts | renderer local storage `mesh-ui:shortcuts`, overrides over the defaults (not a command) | |
| Version, update status, Electron, platform | `app.info` | on load, every 60 s, and on `update.changed` |
| Automatic updates, Beta updates, Keep running in the tray switches | `app.settings.get` | on load, after writes |
| Start at login, whether this desktop has a tray | `app.info` (`startup`, `tray`) | on load, every 60 s, after writes |

## Actions

| Control | Command | Effect | Confirm | Result |
| --- | --- | --- | --- | --- |
| Copy CLI or MCP line | none | | | Copies the text |
| Install CLI (shown when the launcher is missing) | `app.cli.install` | write (app local) | OS admin prompt where needed | `mesh-ui` on PATH |
| Theme orb | none (view state) | | | Applies the theme; stored in local storage |
| Shortcut pill, Reset to default, Remove, Reset all (Keyboard shortcuts) | none (view state) | | | Rebinds the action at once; stored in local storage |
| Check for updates | `app.update.check` | write (app local) | no | Checks GitHub Releases now, even with automatic updates off |
| Download from GitHub (unsigned macOS, state `available`) | none | | | Opens the release page in the browser |
| Restart to update (hero; the sidebar chip opens `#/settings/about`, the hero) | `app.update.install` | write (app local) | no | Mesh UI restarts into the new version; only on this click |
| Automatic updates switch | `app.settings.set` `{autoUpdate}` | write (app local) | no | Scheduled checks stop or resume |
| Beta updates switch | `app.settings.set` `{updateChannel}` | write (app local) | no | `beta` also takes GitHub pre-releases |
| Start at login switch | `app.startup.set` `{enabled}` | write (app local) | no | Adds or removes the OS login item; toast with Undo |
| Keep running in the tray switch | `app.settings.set` `{runInTray}` | write (app local) | no | The tray icon appears or goes at once; with it on, closing the window hides it to the tray; toast with Undo |
| Hero links (Release notes, eero support articles, Source and issues) | none | | | Open externally |
| Show eero request log (hero) | `app.log.show` | write (app local) | no | The file manager opens on `eero-requests.jsonl` |

## States

- **CLI not installed:** the code blocks show **Install CLI** instead of copy (AppImage and macOS); on deb, rpm and Windows installs the launcher is already on PATH.
- **MCP not connected:** the subtitle ends "MCP not used yet".
- **No commands this week:** "No commands from the CLI or agents this week."

## Notes

- The command log (`app.audit.list`) reads the audit log the engine writes on every CLI and MCP call, `audit.jsonl` in the config dir. Format, redaction and the 1,000 line cap are in [security.md](../../architecture/security.md#audit-log); it never holds the token or secret params. Window initiated commands are not logged.
- The section subtitle ends "MCP used <age>" (or "MCP not used yet"), from the latest MCP call in the audit log; there is no persistent connection to detect, so it never says "connected" (decided in M6.6).
- Theme and panel state are renderer preferences in local storage, not commands; settings the CLI also needs live in `settings.json`.
- Commands added: `app.audit.list` q.
