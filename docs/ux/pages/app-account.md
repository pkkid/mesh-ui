# App & account

The signed in eero account, notification choices, the networks on the account, the CLI and MCP hookup, themes, and app info, sign out and account deletion.

Mockup: [../../mockups/17-account-settings.html](../../mockups/17-account-settings.html)

Shared patterns (hero, settings rows, side panel, destructive confirms) are described in [../overview.md](../overview.md).

## Layout

Breadcrumb `Settings / App & account`, subtitle "This computer and your eero account". Main column on the left, side panel on the right.

1. **Hero.** Avatar with initials at the top left. Title is the account name (`Alex Kim`) with `Signed in`. Under it the email with `Verified` and the mobile number with `Unverified`. Action row: **Edit name**, **Change email**, **Verify mobile** (the third button reads **Change mobile** once the number is verified).
2. **Account** ("Email preferences"): **Stay up to date** switch (product news by email).
3. **Notifications** ("Maple Street alerts · shown in the bell and as desktop notifications"). Header switch **Desktop notifications**. One row per alert with an icon, label, optional detail and a switch: New device joins, Network goes offline (account push setting), An eero goes offline (account push setting), Update scheduled 12 hours before, Update scheduled 15 minutes before, Update installed, Admin permission changes, Weekly activity and data usage report, New eero discovered or auto added (Simple Setup).
4. **Networks on this account.** Table: Network (icon, name, nickname, "current" or "shared by ..."), Role (`Owner` or `Admin`), eeros count, Status (`Online`, `Offline 2d`).
5. **Command line and agents** ("Everything in this window is also a command"). Header status `MCP connected`. Left: **Command line** code block (`mesh-ui run device.list`) and **MCP server** code block (`claude mcp add mesh-ui -- mesh-ui mcp`), each with a copy icon. Right: "This week · 38 commands from the CLI and agents", a sparkline per day, and the latest commands (id and target, `needs confirm` in warning colour when one was refused, age). Footer line: agents never see the session token; restarting or irreversible commands only run with `--confirm`.
6. **Application Theme** ("Pick a light and a dark look · stored on this computer only"). One card per theme (Classic, Rose, Grove, Ocean, Ember, Iris, Gruvbox Hard), each with a light and a dark preview orb; the active light and dark picks are marked with a sun or moon.

Side panel:

1. **About**: app logo, `Mesh UI`, "Version 0.1.0 · up to date"; Electron version and platform, Network ID, Support ID; links Release notes, Open source licenses, eero support articles, Source and issues; line "Mesh UI is an independent app and is not made by eero or Amazon."
2. **Sign out and delete**: text saying where the session is stored ("saved in GNOME Keyring and refreshes on its own") and **Sign out**. Then **Delete account and data** (`Destructive` badge): what it does and what must happen first (transfer or delete owned networks; lose admin access to shared ones), a checkbox "I want to permanently close my account and delete my data", **Delete account** (solid danger, disabled until checked).

## Data

| Element | Command | Refresh |
| --- | --- | --- |
| Name, email, phone, verification, consents, push settings, Support ID | `account.get` | on load, after writes |
| Network alert toggles | `notifications.settings.get` | on load |
| Network offline, eero offline toggles | `account.get` (push settings) | on load |
| "3 this week" detail | `events.summary` `{type: ["device_joined"], range: "week"}` | on load |
| Desktop notifications switch | `app.settings.get` | on load |
| Networks table | `network.list` | on load, every 5 min |
| CLI install state, MCP state, command log and counts | `app.info`, `app.audit.list` | on load, every 60 s |
| Themes | renderer local storage (not a command) | |
| Version, update status, Electron, platform | `app.info` | on load |
| Network ID | `network.get` | on load |
| Session storage description (keychain name or memory only) | `auth.status` | on load |

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
| About links | none | | | Open externally |
| Sign out | `auth.logout` | write | no | Session removed from the keychain; app returns to sign in |
| Delete account | `account.delete` | destructive | checkbox, then dialog; sends `confirm: true` | Account closed; app returns to sign in |

## States

- **Loading:** hero placeholders; switches show their last known value faded.
- **Unverified email or phone:** `Unverified` status and the hero button reads **Verify ...**.
- **No keychain:** the sign out text says "Your session is kept in memory only on this computer; you will sign in again next time" (Linux `basic_text`, see [../overview.md](../overview.md)).
- **CLI not installed:** the code blocks show **Install CLI** instead of copy (AppImage and macOS); on deb, rpm and Windows installs the launcher is already on PATH.
- **MCP not connected:** header status reads "MCP not used yet" in muted text.
- **No commands this week:** "No commands from the CLI or agents this week."
- **Owns networks:** Delete account stays disabled with the reason until owned networks are transferred or deleted.
- **Error:** inline note per section with **Retry**; verification code errors show under the field.
- **Offline (computer):** account data shows from the last fetch with a muted "Offline" note; writes are disabled.

## Notes

- Push settings (`networkOffline`, `nodeOffline`) live on the account; other toggles are a per network map on `{net}/notifications` that must be sent whole with one key changed. Core hides that detail behind `notifications.settings.set`.
- The weekly report toggle maps to `{net}/data_usage/report_settings` or a notifications key; confirm which (open question).
- Desktop notifications are raised by the main process from the same `notifications.list` poll that feeds the bell; one poll, both surfaces.
- Mesh UI does not offer **Switch to Amazon login** (it is permanent and needs Amazon sign in), so the Account section has no login row.
- The command log (`app.audit.list`) reads the audit log the engine writes on every CLI and MCP call, `audit.jsonl` in the config dir. Format, redaction and the 1,000 line cap are in [security.md](../../architecture/security.md#audit-log); it never holds the token or secret params. Window initiated commands are not logged.
- "MCP connected" means an MCP client called `mesh-ui mcp` recently; there is no persistent connection to detect. Base it on the log (open question on wording).
- Support ID is the account `log_id`. Network ID is the id in the network URL.
- Theme and panel state are renderer preferences in local storage, not commands; settings the CLI also needs live in `settings.json`.
- Commands added: `app.audit.list` q.
