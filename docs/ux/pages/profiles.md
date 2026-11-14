# Profiles

People on the network: each profile groups one person's devices so they can
be paused together, put on schedules and compared by usage. Also the place to
sort out unassigned devices.

Mockup: [../../mockups/07-profiles.html](../../mockups/07-profiles.html)

Shell, confirmations, states and refresh rules: [../overview.md](../overview.md).
Topbar: title "Profiles", page action **+ Add a profile** (primary). Sidebar
count: number of profiles, not counting Unassigned.

## Layout

1. **Profiles** section. Sub "Group devices by person to pause them together
   and see their usage". Tools: **Pause all** and a Cards / List toggle.
   A 4-column grid of profile cards. Each card:
   - Avatar initial in the profile colour, name, "6 devices · 6 online".
   - A stacked row of device-type icons (offline devices greyed) and the
     status (Active, Scheduled, Paused).
   - "Today" with the usage figure ("96 GB") and a 24 h sparkline in the
     profile colour.
   - A full-width **Pause** button (or primary **Resume** when paused) and a
     `...` menu button.
   - List view: one row per profile with the same fields in columns.
2. **Today's pauses** section. Sub "Thursday, Nov 12 · scheduled and manual,
   network time zone (Pacific)". Legend on the right: Scheduled (muted
   fill), Manual pause (warning fill), Upcoming (hatched). Card with one lane
   per profile plus Unassigned, 12 AM to 12 AM:
   - Segments with a label ("Bedtime", "Homework", "Paused until resumed").
     Past scheduled segments are solid muted, upcoming ones hatched, a manual
     pause is warning-filled.
   - A vertical now line across all lanes with the time above the first lane
     ("2:05 PM").
   - Empty lanes say "No pauses today".
   - Tick labels: 12 AM, 6 AM, 12 PM, 6 PM, 12 AM.
3. **Usage by profile** section. Sub "Data used per day, last 7 days". Tools:
   segmented Profiles / Profiles + Unassigned, and Day / Week.
   - Side column: hero figure "2.71 TB" "in 7 days", then one row per
     profile: colour dot, name, total on the right, and "57% of traffic ·
     220 GB a day" under it.
   - Main: stacked columns per day, one segment per profile in its colour,
     tooltip per day with each profile and a Total.
4. **Unassigned devices** section. Sub "20 devices not in a profile · click an
   avatar to assign". Tool: **Pause unassigned**.
   - Info note: "New devices and devices with private (randomized) MAC
     addresses land here. Pausing Unassigned asks for confirmation, since it
     includes the TV, printer and smart home gear."
   - A 4-column grid of device tiles: icon, name, "Online · 142 GB today",
     "Offline · 3 days ago" or "Blocked" (destructive text); offline tiles at
     reduced opacity. On the right of each tile, a row of faint profile
     avatars (A, J, M, L) that brighten on hover; clicking one assigns the
     device to that profile.
   - Last tile, dashed: **New profile from selection**.

## Data

| Element | Command | Refresh |
| --- | --- | --- |
| Profile cards (name, colour, device counts, online, status, next schedule) | `profile.list` | 60 s |
| Device type icons on cards | `device.list` (all devices, shared with Unassigned) | 30 s |
| Today's usage per profile and sparklines | `usage.get {scope: "profile", range: "day"}` (no `id`: one series per profile) | 5 min |
| Today's pauses lanes | `profile.list` (`today` segments per profile, computed in core from schedules and manual pause state, in the network time zone) | 60 s; the now line moves every minute |
| Usage by profile (totals, shares, per day bars) | `usage.get {scope: "profile", range}` (includes the Unassigned series; the toggle hides it in the view) | 5 min |
| Unassigned device tiles | `device.list` (devices with no profile, blocked ones included, guests left out) | 30 s |
| "142 GB in 24h" on a tile (the breakdown's day is the last 24 hours, so the mockup's "today" would overstate it) | `usage.breakdown {range: "day", by: "device"}` | 5 min |
| Avatar row on tiles | `profile.list` | 60 s |

## Actions

| Control | Command | Effect | Confirm | Result |
| --- | --- | --- | --- | --- |
| + Add a profile | `profile.create {name, devices}` | write | No | Sheet: name, device picker (unassigned first, then others with their current profile shown); Save creates and opens the profile |
| Pause all | `profile.pause {profile}` once per profile (Unassigned not included) | write | Yes, UI dialog ("Pause Alex, Jamie, Mia and Leo? 18 devices lose internet until you resume them.") | All cards Paused; toast with Undo |
| Cards / List | - (view state) | - | No | Layout |
| Card (click outside buttons) | - | - | No | Profile detail |
| Pause (card) | `profile.pause {profile}` | write | No | Card Paused, button becomes Resume; a manual segment appears in Today's pauses; toast with Undo |
| Resume (card) | `profile.resume {profile}` | write | No | Card Active (or Scheduled); during a scheduled pause, stays online until the next scheduled start |
| `...` menu: Rename | `profile.rename {profile, name}` | write | No | Inline edit of the card name |
| `...` menu: Add a scheduled pause | `profile.schedule.add {profile, ...}` | write | No | Opens the schedule sheet from [profile-detail.md](profile-detail.md) |
| `...` menu: Delete profile... | `profile.delete {profile, confirm: true}` | destructive | Yes, type-to-confirm dialog | Devices move to Unassigned |
| Lane segment | - | - | No | Tooltip "Bedtime · 9:00 PM to 7:00 AM"; click opens the profile |
| Profiles / Profiles + Unassigned, Day / Week | - (re-queries `usage.get`) | - | No | Chart and list update |
| Avatar on an unassigned tile | `device.profile.set {devices: [device], profile}` | write | No | Tile leaves the grid; toast "Moved Living Room TV to Alex" with Undo |
| Tile click | - (view state: toggles selection) | - | No | Selected tiles get the selected surface; enables New profile from selection |
| Tile double-click | - | - | No | Device detail |
| New profile from selection | `profile.create {name, devices}` | write | No | Name sheet prefilled with the selection |
| Pause unassigned | `profile.unassigned.pause {}` | write | Yes, UI inline ("Pause 20 unassigned devices? This includes Living Room TV, HP LaserJet and smart home gear like Ring Doorbell.") | Unassigned lane shows a manual pause; button becomes Resume unassigned |

Until the profile writes land, every control in this table that runs a
`write` command shows disabled with a "Coming soon" tooltip: Add a profile,
Pause all, Pause and Resume, the `...` menu, avatars on unassigned tiles, New
profile from selection and Pause unassigned. Card clicks, lane segments and
tile double-clicks navigate as described.

## States

- **Loading.** Cards at normal size with `-`; one empty lane without the now
  line until the network time zone is known; chart gridlines; tile grid blank.
- **Empty: no profiles.** The Profiles section shows "No profiles yet. Group
  devices by person to pause them together." with **Add a profile**. Today's
  pauses shows only the Unassigned lane. Usage by profile shows Unassigned
  only (or the empty sentence when Profiles is selected).
- **Empty: no unassigned devices.** "Every device is in a profile." and the
  section tools hide.
- **Error.** Per section note with Retry.
- **Offline (this computer).** Shell banner; pause, resume and assignment
  disabled.
- **Network offline.** Writes disabled ("Maple Street is offline"); history
  and cards stay with last values.
- **No permission.** Admins can manage profiles and schedules. Denied
  `profiles` permissions disable the controls with the reason.
- **Capability missing.** Firmware before the Unassigned profile (eeroOS
  7.12.4): the Unassigned lane and Pause unassigned are hidden; Unassigned
  devices still list.
- **Bridge mode.** Page not reachable: the sidebar item is hidden and a
  direct link shows the bridge note with a link to Advanced networking.

## Notes

- `profile.pause` takes one `profile` (an id or exact name) and lasts until
  resumed; there are no timed pauses. Pause all calls it per profile.
  Unassigned devices have their own commands, `profile.unassigned.pause` and
  `profile.unassigned.resume`; there is no "unassigned" profile id.
- Unassigned schedules are left out: the eero app can schedule pauses for
  Unassigned (eeroOS 7.12.4+), but no client we studied shows the endpoint.
- Manual pause start time ("Paused 25 min ago", the manual segment start)
  comes from the latest pause event in `events.list` when eero does not
  return a start time.
- `profile.devices.set` replaces the full list; `device.profile.set` is the
  per-device path. Assigning from a tile uses `device.profile.set`.
- Profile colours are assigned once in `lib/chartColors.ts` order by profile
  creation and kept stable per profile id (stored in renderer preferences);
  Unassigned is always the neutral series colour.
- Schedules follow the network time zone; the section says which.
- MANUAL: pause and resume one profile from a card | Profiles, Pause on a
  test profile with one device, then Resume | the device loses and regains
  internet; the eero app shows the profile paused | risk: brief outage for
  that profile's devices.
