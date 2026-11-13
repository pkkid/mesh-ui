# Updates & admins

Firmware updates and the update window, who can manage the network, and handing the network to someone else.

Mockup: [../../mockups/15-updates-admins.html](../../mockups/15-updates-admins.html)

Shared patterns (hero, settings rows, side panel, destructive confirms) are described in [../overview.md](../overview.md).

## Layout

Breadcrumb `Settings / Updates & admins`, subtitle `Checked for updates 2h ago`, titlebar action **Check for updates**.

1. **Update hero.** Title is the target version (`eeroOS 7.13.0`) with `from 7.12.1` in muted mono. Status line: `Update available` (info) and "Released Nov 10, 2026 · gradual rollout, your network is eligible". **What's new** list from the release notes. Action row: **Install now** (primary) with a `Disruptive · all eeros restart` badge. On the right, a card **Installs automatically** ("Tonight, in your preferred update time") with a countdown (`11h 46m to go`), a progress meter toward the window, and a muted line "eero sends reminders 12 hours and 15 minutes before. Turn them on or off in App & account."
2. **Every eero updates together**: a row naming all eeros and when they were last updated.
3. **Preferred update time** ("Average data per hour, last 7 days"). Header select with the window (`2:00 AM to 5:00 AM`). A 24 bar chart of average data per hour with the selected window overlaid and labelled "Update window". Footer legend: selected hours average, busiest hour average, and a success line "Quietest window on your network" when the choice is the quietest.
4. **User permissions** ("2 of 10 admin seats used"). Rows: owner (avatar, name, "(you)", email, `Owner` with crown), admins (avatar, name, email, `Admin`, overflow menu), pending invites (dashed avatar, email, "Invite pending", `Pending` status, **Resend**, **Cancel**). The overflow menu for an admin offers **Nickname** and **Remove admin** (the mockup shows it expanded as "Jamie's menu").
5. Below, two cards side by side:
   - **Invite an admin**: segmented **QR** / **Email**. QR code, **Invitee nickname** field, **Or send to email** field, hint "Scan in the eero app or Mesh UI. Single use, 48 hours." Buttons **New code**, **Copy link**, **Send invite** (primary).
   - **What each role can do**: table of capabilities with Owner and Admin columns (see, change Wi-Fi and advanced networking, install updates and restart, invite or remove admins, Amazon and transfer or delete).
6. **Transfer network** (`Destructive · owner only` badge, "Hand Maple Street to someone else"). Four numbered steps: Review, Confirm (type the name), Share QR or link (single use, 48 hours), Recipient accepts. Danger note: cannot be undone; admins and settings move, subscriptions do not; not on ISP or installer managed networks. Input "Type "Maple Street" to continue" and **Start transfer** (solid danger, disabled until the name matches).

Side panel **During an update**: internet and Wi-Fi drop about 10 minutes, eeros download then restart together, reminders 12 hours and 15 minutes before, devices online right now.

## Data

| Element | Command | Refresh |
| --- | --- | --- |
| Target and current version, status, eligibility, can install now, scheduled time, preferred hour | `updates.get` | on load, every 15 min, on Check for updates |
| What's new | `updates.notes` | on load when an update exists |
| Countdown and meter | `updates.get` (scheduled time) | ticks locally each minute |
| Last updated per eero | `eero.list` (firmware), `eero.firmware.history` | on load |
| Preferred update time chart, quietest window | `usage.quiet_hours` `{range: "week"}` | on load |
| Owner, admins, seat count | `admin.list` | on load, after writes |
| Pending invites | `admin.list` (invites) | on load, after writes |
| Role capability table | static copy, rows gated by `network.permissions` | |
| Transfer availability | `network.permissions`, `network.get` (ISP managed flag) | on load |
| Devices online right now | `network.get` | every 60 s |

## Actions

| Control | Command | Effect | Confirm | Result |
| --- | --- | --- | --- | --- |
| Check for updates | `updates.get` | query | no | Subtitle time resets |
| Install now | `updates.install` | disruptive | dialog with outage length (about 10 minutes, from core) and device count | eeros download and restart; page shows progress until they return |
| Preferred window select | `updates.hour.set` `{hour}` | write | no | Chart overlay moves |
| Admin menu: Nickname | `admin.nickname.set` `{admin, nickname}` (unverified) | write | no | |
| Admin menu: Remove admin | `admin.remove` `{admin}` | destructive | inline confirm naming the person | Row disappears |
| Resend | `admin.invite.create` (same nickname or email) | write | no | Old link cancelled, new one sent |
| Cancel (invite) | `admin.invite.cancel` `{invite}` | write | no | Row disappears |
| QR / Email toggle | none (view state) | | | |
| New code | `admin.invite.create` `{nickname}` | write | no | New QR and link |
| Copy link | none | | | Copies the invite URL |
| Send invite | `admin.invite.create` `{nickname, email?}` | write | no | Pending row appears |
| Type the network name | none (local check) | | | Enables Start transfer |
| Start transfer | `network.transfer` `{name, email, phone?, networkName}` | destructive | the typed name is the confirm, sent with `confirm: true` | Shows the transfer QR and link; status "Waiting for the recipient" |

## States

- **Loading:** hero placeholders; chart keeps its size and fades.
- **Up to date:** hero title is the current version with `Up to date` status and "Last updated Nov 11"; no Install now, no countdown card; What's new shows the current release notes.
- **Required update:** status `Update required` (warning) and the countdown card says it installs at the next window regardless.
- **Installing:** hero shows `Installing` with per eero progress from `eero.list`; Install now hidden.
- **Error:** inline note in the failing section with **Retry**.
- **No permission:** admins see updates and can install (per the roles table) but invite, remove and transfer are hidden; the permissions section shows the list read only.
- **Transfer not available:** ISP or installer managed networks show the section with the reason and no input.
- **Seats full:** at 10 of 10, Invite an admin is disabled with "All admin seats are in use".

## Notes

- `POST {net}/updates` installs now and restarts every eero; only allowed when `can_update_now` is true. Hide Install now otherwise.
- Release notes come from `updates.manifest_resource`, an absolute URL outside the eero API host; fetch it without the session cookie.
- `updates.hour.set` takes one start hour (0 to 23). The window length is eero's (about 3 hours); the select shows start to start plus 3.
- Reminders 12 hours and 15 minutes before are eero notifications, toggled on [App & account](app-account.md). Mesh UI adds no reminder of its own.
- Invites: `POST {net}/invites` returns an `invite_url` for the QR and Copy link. The API takes a nickname, not an email; "Send invite" by email means Mesh UI opening a `mailto:` with the link, unless eero has an email invite endpoint we have not seen (open question).
- Admin nicknames: the API only shows `PUT {net}/invites/{id}` for invite nicknames; whether a member can be renamed is unverified. `admin.nickname.set` is added tentatively.
- Transfer: `{net}/transfer` takes recipient name, email and phone in one client, while the mockup shows a QR or link flow. Confirm the real flow before building it (MANUAL check; never try it on the real network).
- Commands added: `usage.quiet_hours` q, `admin.nickname.set` w (tentative).
