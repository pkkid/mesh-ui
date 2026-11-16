# Account & Settings

The signed in eero account, notification choices, the networks on the account, the CLI and MCP hookup, themes, and app info, sign out and account deletion.

Mockup: [../../mockups/17-account-settings.html](../../mockups/17-account-settings.html)

Shared patterns (hero, settings rows, side panel, destructive confirms) are described in [../overview.md](../overview.md).

## Layout

Breadcrumb `Account & Settings`, subtitle "This computer and your eero account". Not a nav item: it opens from the sidebar footer row (gear icon, name and role), the palette, `Ctrl+,` and deep links. Main column on the left, side panel on the right.

1. **Hero.** Avatar with initials at the top left. Title is the account name (`Alex Kim`) with `Signed in`. Under it the email with `Verified` and the mobile number with `Unverified`. Action row: **Edit name**, **Change email**, **Verify mobile** (the third button reads **Change mobile** once the number is verified).
2. **Account** ("Email preferences"): **Stay up to date** switch (product news by email).
3. **Notifications** ("Maple Street alerts · shown in the bell and as desktop notifications"). Header switch **Desktop notifications**. One row per alert with an icon, label, optional detail and a switch: New device joins, Network goes offline (account push setting), An eero goes offline (account push setting), Update scheduled 12 hours before, Update scheduled 15 minutes before, Update installed, Admin permission changes, Weekly activity and data usage report, New eero discovered or auto added (Simple Setup).
4. **Networks on this account.** Table: Network (neutral icon, the nickname or else the name, then a muted line with the Wi-Fi name when a nickname is shown, ISP, "Shared with you" for an admin role and "current" for the selected network), Role (`Owner` or `Admin`), eeros count, Status (`Online`, `Offline 2d`). eero sends no owner name for a shared network, so the mockup's "shared by ..." reads "Shared with you". A row click switches to that network.
5. **Command line and agents** ("Everything in this window is also a command"). Header status "MCP used 5 min ago" (success dot) from the newest MCP line in the audit log, or "MCP not used yet" (muted dot); Mesh UI cannot see whether an agent is connected right now, only when one last ran a command. Left: **Command line** code block (`mesh-ui run device.list`) and **MCP server** code block (`claude mcp add mesh-ui -- mesh-ui mcp`), each with a copy icon. When this copy can put `mesh-ui` on PATH itself (`cli.canInstall`: macOS, or the AppImage) and has not, or the link points at a copy that moved, the left side is instead "Use Mesh UI from a terminal" with **Install CLI** (or **Reinstall**) and, under "Or add it to PATH yourself", the `export PATH=...` line to copy (on macOS this is what to use after declining the admin prompt). When the launcher is installed but its folder is not on PATH (AppImage without `~/.local/bin` on PATH, the Windows portable zip), a "Not on PATH yet" note with that line follows the code blocks. Right: "This week" and "38 commands from the CLI and agents" ("No commands yet"), a sparkline of the 7 days, and the latest 5 commands this week (id in mono, `needs confirm` in warning colour when it was refused, age). Empty: "Commands run with mesh-ui or by an AI agent show here." Footer line: agents never see the session token; restarting or irreversible commands only run with `--confirm`.
6. **Application Theme** ("Pick a light and a dark look · stored on this computer only"). One card per theme (Classic, Rose, Grove, Ocean, Ember, Iris, Gruvbox Hard), each with a light and a dark preview orb; the active light and dark picks are marked with a sun or moon.

Side panel:

1. **About**: the app icon (`AppIcon`, 40px), `Mesh UI`, "Version 0.6.0"; the update status (status dot and line: "Up to date · checked 20 min ago", "Not checked yet", "Automatic updates off", "Checking for updates", "Version 0.6.1 is available" (an unsigned macOS build, which cannot install updates itself: a note saying so and a **Download from GitHub** link to that release), "Downloading 0.6.1 · 42%" with a progress bar, "Version 0.6.1 is ready", or the error line); **Check now** and, when ready, **Restart to update**; **Automatic updates** and **Beta updates** switches; Electron version and platform, Network ID, Support ID (both copyable); links Release notes, eero support articles, Source and issues (open in the browser; no licenses page yet, the repository has them), and **Show eero request log** (`app.log.show`, hidden in demo mode); line "Mesh UI is an independent app and is not made by eero or Amazon." deb, rpm, portable and dev installs hide the update buttons and switches and show why ("Installed with a package manager. Update with apt or dnf."); deb, rpm and portable add a **Release page** link.
2. **Sign out and delete**: text saying where the session is stored ("saved in GNOME Keyring and refreshes on its own") and **Sign out**. Then **Delete account and data** (`Destructive` badge): what it does and what must happen first (transfer or delete owned networks; lose admin access to shared ones), a checkbox "I want to permanently close my account and delete my data", **Delete account** (solid danger, disabled until checked). Delete opens the app's confirm dialog with core's message; type the account email (or name, when there is no email) to enable it. In demo mode the text says so and the panel adds **Leave demo mode**.

**Deep links.** Each section has a stable id; `#/account/<section>` opens
the page scrolled to it (a second `account` route, `/account/:section`, so
the sidebar footer row stays selected). Sections: `profile` (hero),
`email` (Account), `notifications`, `networks`, `cli`, `theme`, `about`,
`sign-out` (`ACCOUNT_SECTIONS` in `AccountPage.tsx`, DOM ids
`account-<section>`). Activity's settings icon opens
`#/account/notifications`; the sidebar's update chip opens `#/account/about`.

## Data

| Element | Command | Refresh |
| --- | --- | --- |
| Name, email, phone, verification, consents, push settings, Support ID | `account.get` | on load, every 5 min, after writes |
| Network alert toggles | `notifications.settings.get` | on load |
| Network offline, eero offline toggles | `account.get` (push settings) | on load |
| "12 device events this week" detail | `events.summary` `{type: ["devices"], range: "week"}` | on load |
| Desktop notifications switch | `app.settings.get` | on load |
| Networks table | `network.list` | on load, every 60 s (shares the sidebar switcher's poll, no extra request) |
| CLI install state, MCP state, command log and counts | `app.info`, `app.audit.list` | on load, every 60 s |
| Themes | renderer local storage (not a command) | |
| Version, update status, Electron, platform | `app.info` | on load, every 60 s, and on `update.changed` |
| Automatic updates, Beta updates switches | `app.settings.get` | on load, after writes |
| Network ID | `network.get` | on load |
| Session storage description (keychain name or memory only) | `auth.status`, `app.info` (`keychainName`) | on load |
| Owned and shared networks for Delete account | `network.list` | with the table |

## Actions

| Control | Command | Effect | Confirm | Result |
| --- | --- | --- | --- | --- |
| Edit name | `account.name.set` `{name}` | write | no | Dialog with one field |
| Change email | `account.email.set` `{email}`, then `account.email.verify` `{code}` | write | no | Dialog: new address, then 6 digit code |
| Verify mobile | `account.phone.verify` `{code}` (after a code is sent by `account.phone.set`) | write | no | Dialog with code field; status becomes `Verified` |
| Stay up to date | `account.consents.set` `{marketingEmails}` | write | no | |
| Desktop notifications | `app.settings.set` `{desktopNotifications}` | write (app local) | no | Asks the OS for permission the first time |
| Alert switches (network) | `notifications.settings.set` `{eero: {[key]: enabled}}` | write | no | |
| Network offline, eero offline switches | `account.push.set` `{networkOffline?, nodeOffline?}` | write | no | |
| Network row | `network.select` `{network}` | write (app local) | no | Switches the current network |
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
| Sign out | `auth.logout` | write | no | Session removed from the keychain; app returns to sign in |
| Delete account | `account.delete` `{acknowledge: true}` | destructive | checkbox, then dialog with type the email; sends `confirm: true` | Account closed; app returns to sign in |
| Leave demo mode (demo only) | `app.demo.set` `{enabled: false}` | write (app local) | no | Relaunches Mesh UI without `--demo` |

## States

- **Loading:** hero placeholders; switches show their last known value faded.
- **Unverified email or phone:** `Unverified` status and the hero button reads **Verify ...**.
- **No keychain:** the sign out text says "Your session is kept in memory only on this computer; you will sign in again next time" (Linux `basic_text`, see [../overview.md](../overview.md)).
- **CLI not installed:** the code blocks show **Install CLI** instead of copy (AppImage and macOS); on deb, rpm and Windows installs the launcher is already on PATH.
- **MCP not connected:** header status reads "MCP not used yet" in muted text.
- **No commands this week:** "No commands from the CLI or agents this week."
- **Owns networks:** Delete account and its checkbox stay disabled with the reason ("You own 2 networks. Transfer or delete them first.") until owned networks are transferred or deleted. A network with no known role counts as owned, as core's refusal does. The `admin` demo scenario owns none, to show the enabled path.
- **Demo mode:** the sign out text reads "You are in demo mode: invented networks, and nothing you change reaches eero." with **Leave demo mode** beside **Sign out**.
- **Error:** inline note per section with **Retry**; verification code errors show under the field.
- **Offline (computer):** account data shows from the last fetch with a muted "Offline" note; writes are disabled.

## Notes

- Push settings (`networkOffline`, `nodeOffline`) live on the account; other toggles are a per network map on `{net}/notifications` that must be sent whole with one key changed. Core hides that detail behind `notifications.settings.set`.
- The weekly report row is not built (M6.7): `{net}/data_usage/report_settings` was never captured (endpoints.md section 20), so there is no known key. When eero sends its own `network.dataUsageReport` notifications key, it shows like any other alert key, as "Data usage report". The Simple Setup row is an integrations setting, not an alert, and stays on Advanced networking.
- Account writes (name, email, mobile, Stay up to date, push switches) work in demo and against the fake eero server. Against the real eero API they answer "not available yet" (no live-tested request, endpoints.md section 20) and the toast says so.
- Notifications section rows: New device joins, then the two account push switches, then every other alert key eero sends for the network, in the bell sheet's order, each with Undo. The New device joins detail is this week's device events from `events.summary` `{type: ["devices"], range: "week"}` ("12 device events this week"): the summary has no narrower join category, so it counts every device event, and says so.
- The hero's code dialog (`CodeDialog.tsx`) takes the new address or number, then the 6 digit code; a wrong code shows under the field and keeps the change pending. An unverified address or number opens it at the code step (the button reads Verify email or Verify mobile; Add mobile when there is none). Edit name has Undo; email and mobile changes do not (they need a code).
- Desktop notifications are raised by the main process from the same `notifications.list` poll that feeds the bell; one poll, both surfaces.
- Mesh UI does not offer **Switch to Amazon login** (it is permanent and needs Amazon sign in), so the Account section has no login row.
- The command log (`app.audit.list`) reads the audit log the engine writes on every CLI and MCP call, `audit.jsonl` in the config dir. Format, redaction and the 1,000 line cap are in [security.md](../../architecture/security.md#audit-log); it never holds the token or secret params. Window initiated commands are not logged.
- The section header reads "MCP used <age>" (or "MCP not used yet"), from the latest MCP call in the audit log; there is no persistent connection to detect, so it never says "connected" (decided in M6.6).
- Support ID is the account `log_id`. Network ID is the id in the network URL.
- Theme and panel state are renderer preferences in local storage, not commands; settings the CLI also needs live in `settings.json`.
- Commands added: `app.audit.list` q.
