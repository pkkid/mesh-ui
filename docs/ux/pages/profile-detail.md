# Profile detail

One person's profile: pause now, the weekly schedule of pauses, usage, the
devices in it, recent activity, and delete.

Mockup: [../../mockups/08-profile-detail.html](../../mockups/08-profile-detail.html)
(shows "Mia"; open the schedule sheet with `?sheet=1`).

Shell, confirmations, states and refresh rules: [../overview.md](../overview.md).
Topbar: crumbs "Profiles / Mia", page action **Rename**. Sidebar item
Profiles stays active.

## Layout

1. **Hero** (card), three columns:
   - Left: 88 px avatar with the initial in the profile colour.
   - Middle: name with a small dashed pencil button; status line with Active
     and Scheduled and the next event ("Homework pause starts at 4:00 PM, in
     1h 55m"); metrics: Last 7 days ("104 GB"), Scheduled off-time ("60 h /
     week").
   - Right: a large **Pause profile** button ("Stops internet on Mia's 4
     devices now") and under it "Resuming during a scheduled pause keeps Mia
     online until the next scheduled pause."
2. Two columns:
   - **Scheduled pauses**. Sub "This week · network time zone (Pacific)".
     Legend: one colour per schedule (Bedtime, Homework) and a dashed "Off"
     swatch. Card with a lane per day, Mon to Sun:
     - Hour gridlines inside each lane; segments in the schedule's colour
       with its icon and name when wide enough; disabled schedules as dashed
       outlines ("Lights out (off)").
     - Overnight schedules split across two days (Bedtime 9 PM to 12 AM, then
       12 AM to 7 AM next day).
     - Today's label and lane are emphasised; a "Now" line marks the time.
     - Tick labels 12 AM, 6 AM, 12 PM, 6 PM, 12 AM.
   - **Schedules**. Tool: **+ Add a scheduled pause**. One row per schedule:
     icon, name, time range ("9:00 PM to 7:00 AM", with a note for disabled
     ones: "off, kept for summer"), seven day chips (S M T W T F S, active
     ones highlighted), an enable switch and a pencil. Disabled rows at
     reduced opacity. Clicking a row opens the editor.
3. Two columns:
   - Left:
     - **Data usage**. Sub "All of Mia's devices, per hour · markers show
       scheduled pauses". Day / Week toggle. Hero figure "18 GB", "busiest
       hour 7 PM · near zero during Bedtime", legend with totals, and an area
       chart with dashed vertical markers in each schedule's colour where a
       pause started or ended.
     - **Devices**, sub "Data today", tool **+ Add a device**. Table: Device
       (icon, name, status dot, connection line with bars, eero and band, or
       "Offline · last seen 2h ago on Upstairs Hall", and a 2px bar in the
       profile colour), Down, Up, Share, 7 days sparkline, and a remove (x)
       button "Remove from profile".
   - Right:
     - **Recent activity**, link "All →". Events with icon, text and a muted
       line: "Bedtime ended, Mia back online · Today, 7:00 AM · scheduled",
       "Mia resumed during Homework · overrides until Bedtime", "Mia's
       Chromebook added to Mia".
     - **Delete profile** (heading in destructive colour). Card: "Mia's 4
       devices move to Unassigned, her 3 schedules are removed and any pause
       is lifted. Usage history stays with the devices." Input `Type "Mia" to
       confirm` and a **Delete profile** danger button.
4. **Schedule sheet** ("Edit schedule", or "Add a scheduled pause" when new;
   "Mia · pauses all 4 devices automatically"):
   - **Schedule on** switch ("Turn off to keep it without pausing").
   - Schedule name input.
   - Start time and End time pickers (hour : minute, AM or PM); End shows
     "next day" when it wraps past midnight.
   - **Repeats on**: seven day toggles (Sun to Sat) and preset chips (School
     nights, Weekdays, Weekends, Every day).
   - **Each day** preview: a 24 h bar with the paused span(s), "10h paused ·
     50h a week", and tick labels.
   - Footer: **Delete schedule** (danger, left; reveals an inline confirm),
     **Cancel**, **Save**.

## Data

| Element | Command | Refresh |
| --- | --- | --- |
| Hero (name, colour, status, device count) | `profile.get {profile}` | 60 s |
| Next event line, scheduled off-time per week | `profile.get` (`nextEvent`, `scheduledHoursPerWeek`, computed in core in the network time zone) | 60 s; countdown ticks every minute |
| Last 7 days figure | `usage.get {scope: "profile", id: profile, range: "week"}` | 5 min |
| Weekly lanes | `profile.get` (`week` segments derived from schedules, split at midnight) | 60 s |
| Schedules list | `profile.get` (`schedules`) | 60 s |
| Data usage chart and markers | `usage.get {scope: "profile", id: profile, range}` + schedule boundaries from `profile.get` | 5 min |
| Devices table (status, connection, data today, share) | `profile.get` (device ids) + `device.list {profile}` + `usage.breakdown {range: "day", by: "device", profile}` | 30 s / 5 min |
| 7 day sparklines | `usage.get {scope: "device", id: device, range: "week"}` per device | 5 min |
| Recent activity | `events.list {profile, limit: 5}` | 60 s |
| Add a device picker | `device.list` | On open |

## Actions

| Control | Command | Effect | Confirm | Result |
| --- | --- | --- | --- | --- |
| Rename (topbar) | `profile.rename {profile, name}` | write | No | Rename sheet (name, 32 characters, a taken name shows under the field); toast with Undo |
| Pause profile | `profile.pause {profile}` | write | No | Status Paused; button becomes **Resume profile**; a manual segment appears on today's lane |
| Resume profile | `profile.resume {profile}` | write | No | Active; during a scheduled pause Mia stays online until the next scheduled start (hero line says so) |
| + Add a scheduled pause | - | - | No | Opens the sheet empty (name "New schedule", 9:00 PM to 7:00 AM, School nights) |
| Schedule row, pencil, lane segment | - | - | No | Opens the sheet for that schedule |
| Schedule row switch | `profile.schedule.update {profile, schedule, enabled}` | write | No | Row and lanes update; toast with Undo |
| Sheet: Schedule on, name, times, days, presets | - (form state) | - | No | Preview bar and hours update live |
| Sheet: Save (new) | `profile.schedule.add {profile, name, start, end, days, enabled}` | write | No | Sheet closes; row and lanes added |
| Sheet: Save (existing) | `profile.schedule.update {profile, schedule, ...}` | write | No | Sheet closes; row and lanes update |
| Sheet: Delete schedule | `profile.schedule.remove {profile, schedule}` | write | Yes, UI inline ("Delete Bedtime? Mia's devices stop pausing at 9:00 PM.") | Sheet closes; toast with Undo (re-adds it) |
| Day / Week (usage) | - (re-queries `usage.get`) | - | No | Chart and figure switch |
| + Add a device | `profile.devices.set {profile, devices}` | write | No | Picker of devices (unassigned first; moving one from another profile says "Moves from Alex"); table updates |
| Remove (x) on a device | `profile.devices.set {profile, devices}` (without that device) | write | No | Device goes to Unassigned; toast with Undo |
| Device row | - | - | No | Device detail |
| All → (activity), event row | - | - | No | Activity filtered to Mia; the event's target |
| Delete profile | `profile.delete {profile, confirm: true}` | destructive | Yes, type the name | Toast "Deleted Mia"; navigates to Profiles |

## States

- **Loading.** Hero with avatar and name if cached, `-` metrics; lanes with
  gridlines only; schedule rows blank; chart gridlines.
- **Empty.** No schedules: lanes empty with "No scheduled pauses. Add one to
  pause Mia's devices automatically, like at bedtime." and the add button.
  No devices: "No devices in this profile yet." with **+ Add a device**; Pause
  profile disabled ("Add a device first"). No usage: "No activity in this
  window." No activity: "Nothing has happened here yet."
- **Paused (manual).** Status Paused, hero line "Paused 25 min ago, until
  resumed"; big button Resume profile.
- **In a scheduled pause.** Status Paused and Scheduled, line "Bedtime until
  7:00 AM"; Resume profile overrides until the next scheduled start.
- **Error.** Per section note with Retry. Sheet save errors stay in the
  sheet under the field (overlapping times, no days chosen are `bad_params`).
  A deleted profile shows "This profile is no longer on Maple Street." with a
  link to Profiles.
- **Offline (this computer).** Shell banner; all writes disabled; the sheet
  can open but Save is disabled.
- **Network offline.** Writes disabled with "Maple Street is offline";
  schedules still listed (they run on the eeros).
- **No permission.** Admins may manage profiles; denied permissions disable
  controls with the reason.
- **Unassigned** (`#/profiles/unassigned`, built in M4.5,
  `UnassignedPage.tsx`). Opened from Profiles (Unassigned devices, **Open**).
  A hero (devices and online from `profile.list` `unassigned`, last 24 hours
  from `usage.breakdown`, Paused or Active) with **Pause unassigned** (inline
  confirm) or **Resume unassigned**, and the devices table with status and
  data in the last 24 hours. No Rename, no Delete section, no Add a device
  (devices land here by leaving other profiles); the schedules section is
  left out, since Unassigned schedules have no known endpoint (see
  [profiles.md](profiles.md#notes)). The route shares `/profiles/:profileId`
  (profile ids are numbers).
- **Capability missing.** None specific beyond Unassigned support (eeroOS
  7.12.4+).
- **Bridge mode.** Not reachable; shows the bridge note with a link back.

## Notes

- Schedules use eero's `{profile}/schedules` endpoints; writing schedules on
  the profile object is a silent no-op. Days are sent in eero's expected
  case; an end before the start wraps past midnight.
- `profile.schedule.add` and `.update` params: `name` (1 to 32 chars),
  `start` and `end` (`HH:MM`, 24 h), `days` (non-empty subset of
  `mon`...`sun`), `enabled`. Presets are UI shortcuts: School nights = Sun to
  Thu, Weekdays = Mon to Fri, Weekends = Sat and Sun.
- Week lanes, the per-day preview, "60 h / week", the next event and the
  usage markers are all computed in core from the same schedule list so the
  CLI (`mesh-ui run profile.get`) returns them too.
- Schedule colours: one per schedule from `lib/chartColors.ts`, stable by
  schedule id. eero stores no icon, so core picks one from keywords in the
  name (moon for "bed" or "night", book for "homework") and falls back to
  `calendar-clock`.
- "Resumed during Homework · overrides until Bedtime" reflects eero's rule
  that a manual resume holds until the next scheduled start.
- Delete is type-to-confirm on the exact name, case-sensitive.
- MANUAL: add and remove a schedule on a test profile | profile detail, Add
  a scheduled pause for a few minutes from now, wait for it to start, then
  delete it | devices pause at the start time; the schedule shows in the
  eero app; deleting removes it there too | risk: brief outage for that
  profile's devices.

## Built so far (M3.5, M4.5)

The page lives in `src/renderer/src/features/profile/`. M4.5 wired Rename
(sheet), Pause and Resume (hero, with Undo), Add a device (the devices
picker sheet, `profile.devices.set`), Remove (x on a row, with Undo) and
Delete profile (type-the-name dialog with the engine's message; toast
"Deleted Mia", then Profiles). Controls dim by the `profiles` permission and
bridge mode. Schedule add, edit, switch and delete stay "Coming soon" until
M4.12; `profile.get` already returns `today` (this profile's segments, a
manual pause included) for the week timeline to draw.

- **Hero.** State and the next change come from `profile.get` (`state`,
  `nextChange`, computed in core); the page only words them. In a scheduled
  pause (core's next change is a resume) the line reads "Bedtime until 7:00
  AM" with a "Paused by schedule" status. Scheduled off-time is the sum of
  enabled schedules (`helpers.ts`, `scheduledHoursPerWeek`).
- **Scheduled pauses** use the shared week timeline
  (`components/ui/timeline.tsx`) with one colour per schedule
  (`entityColors` by schedule id) and the Now line in the network time zone.
  Schedules come only from the profile's own `schedule[]`.
- **Data usage** has Day / Week and a **Top devices** column
  (`usage.breakdown {by: device, profile}` for the same range) beside it;
  Day draws dashed markers where an enabled schedule started or ended.
- **Devices** label data as "Last 24 hours": eero's device usage is a
  rolling 24 h, not "today". The 7 day sparklines are left out (one usage
  read per device) and so is **Recent activity** (a later story).
- **Gone.** An id `profile.list` does not have shows "This profile is no
  longer on Maple Street. Devices with no profile are listed under
  Unassigned on Profiles." with a link to Profiles. That covers eero's own
  Unassigned group too (`default: true`, which the list drops), opened by
  id from a device's profile link.
- `[` and `]` move between profiles in `profile.list` order.
- Page-load budget: `helpers.test.ts` runs `pageReads` (every read the page
  mounts) against the fake eero server: about 18 requests, no
  `/schedules` reads.
