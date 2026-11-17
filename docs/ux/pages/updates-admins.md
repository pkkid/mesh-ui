# Updates & admins

Firmware updates and the update window, who can manage the network, and handing the network to someone else.

Mockup: [../../mockups/15-updates-admins.html](../../mockups/15-updates-admins.html)

Shared patterns (hero, settings rows, side panel, destructive confirms) are described in [../overview.md](../overview.md).

## Layout

Breadcrumb `Settings / Updates & admins`, titlebar action **Check for updates**. When the updates were last read ("Checked 2 h ago") ends the hero's status line.

1. **Update hero.** Title is the target version (`eeroOS 7.13.0`) with `from 7.12.1` in muted mono. Status line: `Update available` (info) and "Released Nov 10, 2026 · gradual rollout, your network is eligible". **What's new** list from the release notes. Action row: **Install now** (primary) with a `Disruptive · all eeros restart` badge. On the right, a card **Installs automatically** ("Tonight, in your preferred update time") with a countdown (`11h 46m to go`), a progress meter toward the window, and a muted line "eero sends reminders 12 hours and 15 minutes before. Turn them on or off in Account."
2. **Every eero updates together**: a row naming all eeros and when they were last updated.
3. **Preferred update time** ("Average data per hour, last 7 days"). Header select with the window (`2:00 AM to 5:00 AM`). A 24 bar chart of average data per hour with the selected window overlaid and labelled "Update window". Footer legend: selected hours average, busiest hour average, and a success line "Quietest window on your network" when the choice is the quietest.
4. **User permissions** ("2 of 10 admin seats used"). Rows: owner (avatar, name, "(you)", "Owner of this network", `Owner` with crown), admins (avatar, name, "Can manage the network", `Admin`, **Remove**), pending invites (dashed avatar, nickname, "Invite pending" with the expiry, `Pending` status, **Resend**, **Cancel**). eero sends no email for members or invites, so none is shown. The mockup's admin overflow menu ("Jamie's menu") had **Nickname** and **Remove admin**; eero has no member nickname endpoint, so only Remove is left and it is a plain button.
5. Below, two cards side by side:
   - **Invite an admin**: a short note and **Create invite**, which opens the invite sheet: **Invitee nickname**, **Create invite**, then the QR code with **Copy link** and **New code** (the old link is cancelled, then a new one made). No email: eero has no email invite endpoint and the window may not open a `mailto:` link (navigation lockdown), so the link is shared by hand.
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
| Preferred update time chart, quietest window, selected window average | `usage.quiet_hours` `{range: "week", start: preferredHour}` | on load |
| Owner, admins, seat count, who "you" are (owner or admin view) | `admin.list` | on load, after writes |
| Pending invites | `admin.list` (invites) | on load, after writes |
| Role capability table | static copy, rows gated by `network.permissions` | |
| Transfer availability | `network.permissions`, `network.get` (ISP managed flag) | on load |
| Devices online right now | `network.get` | every 60 s |

## Actions

| Control | Command | Effect | Confirm | Result |
| --- | --- | --- | --- | --- |
| Check for updates | `updates.get`, fetched with `{ fresh: true }` | query | no | Skips the engine cache; subtitle time resets |
| Install now | `updates.install` | disruptive | dialog with outage length (about 10 minutes, from core) and device count | eeros download and restart; page shows progress until they return |
| Preferred window select | `updates.hour.set` `{hour}` | write | no | Chart overlay moves; toast with Undo |
| Use quietest | `updates.hour.set` `{hour: quietest.start}` | write | no | Shown when the quietest window is not the chosen one |
| Remove (admin row) | `admin.remove` `{admin}` | destructive | dialog naming the person; type their name | Row disappears |
| Resend | `admin.invite.cancel` on the old one, then `admin.invite.create` (same nickname) | write | no | Old link cancelled first (it frees its seat), new one shown in the invite sheet |
| Cancel (invite) | `admin.invite.cancel` `{invite}` | write | no | Row disappears |
| Create invite (sheet) | `admin.invite.create` `{nickname?}` | write | no | QR and link; pending row appears |
| New code (sheet) | `admin.invite.cancel` on the old one, then `admin.invite.create` | write | no | New QR and link |
| Copy link | none | | | Copies the invite URL |
| Type the network name | none (local check) | | | Enables Start transfer |
| Start transfer | opens the transfer dialog | | | |
| Start transfer (dialog) | `network.transfer` `{name, email or phone, networkName}` | destructive | the typed name is the confirm, sent with `confirm: true` | Status "Waiting for the recipient" with where it was sent |

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
- Reminders 12 hours and 15 minutes before are eero notifications, toggled on [Account](account.md). Mesh UI adds no reminder of its own.
- Invites: `POST {net}/invites` returns an `invite_url` for the QR and Copy link. The API takes a nickname, not an email; "Send invite" by email means Mesh UI opening a `mailto:` with the link, unless eero has an email invite endpoint we have not seen (open question).
- Admin nicknames: eero only renames pending invites (`PUT {net}/invites/{id}`); no member nickname endpoint exists in the clients or the M5.1 capture, so `admin.nickname.set` was dropped in M5.6.
- Transfer: `POST {net}/transfer` takes a form with the recipient's name and one of email or phone (the LD client); eero sends it there and the recipient accepts in their app. The mockup's QR or link step does not exist in the API, so the dialog asks for the contact instead. Never tried on the real network.
- Commands added: `usage.quiet_hours` q.

## Built in M3.13 (read view)

- Built: the hero with What's new, Every eero updates together, Preferred update time with the quiet-hours chart, User permissions, Invite an admin (owner only) and the roles table. Install now, the preferred window select, invite, resend, cancel and the admin menu are disabled "Coming soon" until their commands land (M5). Transfer network is not shown yet (M5).
- Owner or admin view comes from `admin.list` (the row marked "you"). An admin sees the list read only: no invites (eero answers 403), no menu, no invite card, no Install now.
- Admin test networks: the demo's admin network is **Mom's House** (Kim Home; owner Rose Kim, invites empty), the fake eero server's is **Lake Cabin** (`100002`, invites answer 403). They differ because each sandbox keeps its own network set: the demo has three networks and Lake Cabin there is an owned, up-to-date network; the fake server has two and its second one is the admin case. Both show the same admin view.
- With `--fake` What's new reads "No release notes from eero for this version": the fake networks name no manifest, since the fake server only answers enveloped JSON. The manifest path is tested in `updates.test.ts` with a raw-body scenario.


## Built in M5.6 (writes)

- Install now runs `updates.install` with core's confirm in the dialog (the impact summary: every eero restarts, devices online lose internet for about 10 minutes). After it a progress toast and an "Installing on every eero" panel (each eero Restarting or Back online, from `eero.list`) stay until eero reports the install done and every eero is back; the hero status reads `Installing`. Hidden for admins (the roles table) and when eero says it cannot update now.
- Preferred update time is a select of 24 start hours (the window is eero's 3 hours) plus **Use quietest**; each change toasts with Undo. Admins see the select disabled.
- Owner only: invite sheet, Resend, Cancel, Remove (type the name) and Transfer network. Gates come from each command's spec (`useGate(id)`): `network.admin_invites`, `network.standard_admins`, `network.ownership_transfer` plus the `ownership_transfer` capability, as the real permissions name them. eero (and the demo) answer 403 for an admin's invite, remove or transfer.
- In demo the transfer applies at once (the recipient becomes owner, you an admin) so the change is visible; on eero and the fake server it is pending until the recipient accepts.
