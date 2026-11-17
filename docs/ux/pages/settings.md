# Settings

This copy of Mesh UI: the CLI and MCP hookup, the application theme, and app info and updates. The eero account (profile, notifications, networks, sign out and deletion) is on the [Account](account.md) page.

Mockup: [../../mockups/17-account-settings.html](../../mockups/17-account-settings.html) (drawn before the split; Settings has its CLI, theme and About sections)

Shared patterns (settings rows, side panel) are described in [../overview.md](../overview.md).

## Layout

Breadcrumb `Settings`, nothing after it. The last item in the sidebar Settings group; also opens from the palette, `Ctrl+,` and deep links. Main column on the left, side panel on the right.

1. **Command line and agents** ("Everything in this window is also a command"). Header status "MCP used 5 min ago" (success dot) from the newest MCP line in the audit log, or "MCP not used yet" (muted dot); Mesh UI cannot see whether an agent is connected right now, only when one last ran a command. Left: **Command line** code block (`mesh-ui run device.list`) and **MCP server** code block (`claude mcp add mesh-ui -- mesh-ui mcp`), each with a copy icon. When this copy can put `mesh-ui` on PATH itself (`cli.canInstall`: macOS, or the AppImage) and has not, or the link points at a copy that moved, the left side is instead "Use Mesh UI from a terminal" with **Install CLI** (or **Reinstall**) and, under "Or add it to PATH yourself", the `export PATH=...` line to copy (on macOS this is what to use after declining the admin prompt). When the launcher is installed but its folder is not on PATH (AppImage without `~/.local/bin` on PATH, the Windows portable zip), a "Not on PATH yet" note with that line follows the code blocks. Right: "This week" and "38 commands from the CLI and agents" ("No commands yet"), a sparkline of the 7 days, and the latest 5 commands this week (id in mono, `needs confirm` in warning colour when it was refused, age). Empty: "Commands run with mesh-ui or by an AI agent show here." Footer line: agents never see the session token; restarting or irreversible commands only run with `--confirm`.
2. **Application Theme** ("Pick a light and a dark look · stored on this computer only"), as in T3 Code. Header tool **Add theme** opens a dialog: a search of Open VSX colour themes (search box, Popular / Top rated / Newest, a list of name · publisher, description, theme count, downloads and licence, each with **Add**), then "or import a file" to choose, drop or paste VS Code (or Mesh UI / T3 Code) theme files. Adding switches light and dark to the new theme's first light and dark styles. First a row of three tiles, System, Light and Dark, each a small wireframe of the window in the picked themes (System splits light and dark down the middle). Then one card per theme or collection (Classic, Rose, Grove, Ocean, Ember, Iris, then added themes), each with a light and a dark preview circle. A circle sets the theme for that mode only; the card's name sets both. The circles in use have a ring and a sun or moon badge. A collection (an added Gruvbox: Hard, Medium, Soft) labels each circle with the picked style and "+2"; hovering a circle fans out the other styles. Added themes have a remove button. See [design-system.md#themes](../../design/design-system.md#themes).

Side panel:

1. **About**: the app icon (`AppIcon`, 40px), `Mesh UI`, "Version 0.6.0"; the update status (status dot and line: "Up to date · checked 20 min ago", "Not checked yet", "Automatic updates off", "Checking for updates", "Version 0.6.1 is available" (an unsigned macOS build, which cannot install updates itself: a note saying so and a **Download from GitHub** link to that release), "Downloading 0.6.1 · 42%" with a progress bar, "Version 0.6.1 is ready", or the error line); **Check now** and, when ready, **Restart to update**; **Automatic updates** and **Beta updates** switches; Electron version and platform, Support ID (copyable); links Release notes, eero support articles, Source and issues (open in the browser; no licenses page yet, the repository has them), and **Show eero request log** (`app.log.show`, hidden in demo mode); line "Mesh UI is an independent app and is not made by eero or Amazon." deb, rpm, portable and dev installs hide the update buttons and switches and show why ("Installed with a package manager. Update with apt or dnf."); deb, rpm and portable add a **Release page** link.

**Deep links.** Each section has a stable id; `#/settings/<section>` opens
the page scrolled to it (a second `settings` route, `/settings/:section`,
listed after the other `/settings/*` pages so they match first, and its
sidebar item stays selected). Sections: `cli`, `theme`, `about`
(`SETTINGS_SECTIONS` in `SettingsPage.tsx`, DOM ids `settings-<section>`).
The sidebar's update chip opens `#/settings/about`. Links saved before the
split (`#/account/cli`, `#/account/theme`, `#/account/about`) redirect here.

## Data

| Element | Command | Refresh |
| --- | --- | --- |
| CLI install state, MCP state, command log and counts | `app.info`, `app.audit.list` | on load, every 60 s |
| Themes | renderer local storage (not a command) | |
| Version, update status, Electron, platform | `app.info` | on load, every 60 s, and on `update.changed` |
| Automatic updates, Beta updates switches | `app.settings.get` | on load, after writes |

## Actions

| Control | Command | Effect | Confirm | Result |
| --- | --- | --- | --- | --- |
| Copy CLI or MCP line | none | | | Copies the text |
| Install CLI (shown when the launcher is missing) | `app.cli.install` | write (app local) | OS admin prompt where needed | `mesh-ui` on PATH |
| Theme orb | none (view state) | | | Applies the theme; stored in local storage |
| Check now | `app.update.check` | write (app local) | no | Checks GitHub Releases now, even with automatic updates off |
| Download from GitHub (unsigned macOS, state `available`) | none | | | Opens the release page in the browser |
| Restart to update (About, sidebar chip opens About) | `app.update.install` | write (app local) | no | Mesh UI restarts into the new version; only on this click |
| Automatic updates switch | `app.settings.set` `{autoUpdate}` | write (app local) | no | Scheduled checks stop or resume |
| Beta updates switch | `app.settings.set` `{updateChannel}` | write (app local) | no | `beta` also takes GitHub pre-releases |
| About links | none | | | Open externally |
| Show eero request log (About) | `app.log.show` | write (app local) | no | The file manager opens on `eero-requests.jsonl` |

## States

- **CLI not installed:** the code blocks show **Install CLI** instead of copy (AppImage and macOS); on deb, rpm and Windows installs the launcher is already on PATH.
- **MCP not connected:** header status reads "MCP not used yet" in muted text.
- **No commands this week:** "No commands from the CLI or agents this week."

## Notes

- The command log (`app.audit.list`) reads the audit log the engine writes on every CLI and MCP call, `audit.jsonl` in the config dir. Format, redaction and the 1,000 line cap are in [security.md](../../architecture/security.md#audit-log); it never holds the token or secret params. Window initiated commands are not logged.
- The section header reads "MCP used <age>" (or "MCP not used yet"), from the latest MCP call in the audit log; there is no persistent connection to detect, so it never says "connected" (decided in M6.6).
- Theme and panel state are renderer preferences in local storage, not commands; settings the CLI also needs live in `settings.json`.
- Commands added: `app.audit.list` q.
