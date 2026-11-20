# Profile detail

One person's profile: pause now, the weekly schedule of pauses, usage, the
devices in it, recent activity, and delete.

Mockup: [../../mockups/08-profile-detail.html](../../mockups/08-profile-detail.html)
(shows "Mia"; open the schedule sheet with `?sheet=1`).

Shell, confirmations, states and refresh rules: [../overview.md](../overview.md).
Topbar: crumbs "Profiles / Mia", no page actions (Rename is in the hero).
Sidebar item Profiles stays active.

## Layout

1. **Hero**, the flat page header as on device detail (no card; a rule
   under it):
   - A 64 px avatar with the initial in the profile colour.
   - Name; status line with Active, Scheduled or Paused and the next event
     ("Bedtime pause starts at 9:00 PM, in 2h 20m").
   - Facts: Devices ("4 · 3 online"), Last 7 days ("119 GB"), Scheduled
     off-time ("60 h / week").
   - Action row at the bottom: **Rename…** first (the shared Rename sheet),
     then **Pause profile…** (asks first) or **Resume profile**, outline with
     dimmed icons, never filled. Delete is the row in Profile settings at
     the bottom of the page.
   - Sections after the hero sit 56px apart (`gap-14`); every section has
     its subtitle under the title, built from the data.
2. Two columns (one full-width **Schedules** line when there is nothing to
   show, see States):
   - **Scheduled pauses**. Description "60h paused a week, Pacific Time".
     Legend: one colour per schedule (Bedtime, Homework) and a dashed "Off"
     swatch. Card with a lane per day, Mon to Sun:
     - Hour gridlines inside each lane; segments in the schedule's colour
       with its icon and name when wide enough; disabled schedules as dashed
       outlines ("Lights out (off)").
     - Overnight schedules split across two days (Bedtime 9 PM to 12 AM, then
       12 AM to 7 AM next day).
     - Today's label and lane are emphasised; a "Now" line marks the time.
     - Tick labels 12 AM, 6 AM, 12 PM, 6 PM, 12 AM.
   - **Schedules**. Description "3 schedules, 2 on" (the on count only when
     some are off). Tool: **+ Add a scheduled pause…**. One row per
     schedule: colour square and name with the time range beside it ("9:00
     PM to 7:00 AM"), then seven day chips (S M T W T F S; neutral, a picked
     day has an outline and the foreground text, not a fill), the standard
     switch and a pencil. No icon tile. Disabled rows at reduced opacity
     with a dashed square. Clicking a row opens the editor.
3. Two columns:
   - **Data usage**, laid out like device detail's. Description "24 hours,
     busiest hour 7 PM, 2.9 GB". Tool: a Last 24 hours / Last 7 days
     dropdown. Hero figure "16.6 GB" with the Download and Upload legend and
     shares on the right ("15.6 GB (94%)"), and the area chart (`h-56`, on
     the section background, no card) with dashed vertical markers in each
     schedule's colour where a pause started or ended.
   - **Top devices**. Description "24 hours, 4 devices, 65% from Mia's
     iPad". Ranked table: device, data.
4. **Devices**, full width. Description "4 devices, 3 online". Tool **+ Add a
   device…**. Table: Device (icon, name, connection line or "Offline · last
   seen 2h ago on Upstairs Hall", and a 2px bar in the profile colour),
   Status, Down 24h, Up 24h, Share, and a remove (x) button "Remove from
   profile".
5. **Profile settings**, at the bottom of the page, like device detail's
   Device settings and eero detail's eero settings. Description "4 devices,
   3 schedules". One card with the settings row:
   - **Delete profile**: "Mia's devices move to Unassigned, the schedules
     are removed and any pause is lifted. Usage history stays with the
     devices." with **Delete profile…**, an outline button in the
     destructive colour that opens the type-the-name dialog (as Remove
     eero…).
6. **Schedule sheet** ("Edit schedule", or "Add a scheduled pause" when new;
   "Mia, pauses all 4 devices automatically"), a clean sheet with no divider
   lines:
   - **Schedule on**, the standard 36x20 switch ("Turn off to keep it
     without pausing").
   - Schedule name input.
   - Start time and End time pickers (hour : minute, AM or PM); End shows
     "next day" when it wraps past midnight.
   - **Repeats on**: seven day buttons (Sun to Sat), neutral: a picked day
     has a stronger outline and the foreground text, not a fill colour.
     Under them the presets as plain text links (School nights, Weekdays,
     Weekends, Every day), the one matching the days in the foreground
     colour.
   - **Each day** preview: a 24 h `bg-muted` bar with the paused span(s) in
     the muted scheduled fill (as Today's pauses), "10h paused, 50h a
     week", and tick labels in normal case.
   - Footer: **Delete schedule…** (danger, left; opens the confirm dialog
     over the sheet), **Cancel**, **Save**.

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
| Rename… (hero) | `profile.rename {profile, name}` | write | No | Rename sheet (name, 32 characters, a taken name shows under the field); toast with Undo |
| Pause profile… (hero) | `profile.pause {profile}` | disruptive | Yes, dialog | Status Paused; button becomes **Resume profile**; a manual segment appears on today's lane |
| Resume profile | `profile.resume {profile}` | write | No | Active; during a scheduled pause Mia stays online until the next scheduled start (hero line says so) |
| + Add a scheduled pause… | - | - | No | Opens the sheet empty (name "New schedule", 9:00 PM to 7:00 AM, School nights) |
| Schedule row, pencil, lane segment | - | - | No | Opens the sheet for that schedule |
| Schedule row switch | `profile.schedule.update {profile, schedule, enabled}` | write | Only when turning it on during its window would pause online devices now | Row and lanes update; toast with Undo |
| Sheet: Schedule on, name, times, days, presets | - (form state) | - | No | Preview bar and hours update live |
| Sheet: Save (new) | `profile.schedule.add {profile, name, start, end, days, enabled}` | write | Only when the window covers now ("Pause devices now?", over the sheet) | Sheet closes; row and lanes added |
| Sheet: Save (existing) | `profile.schedule.update {profile, schedule, ...}` | write | Only when the new window covers now | Sheet closes; row and lanes update |
| Sheet: Delete schedule | `profile.schedule.remove {profile, schedule}` | write | Yes, UI inline ("Delete Bedtime? Mia's devices stop pausing at 9:00 PM.") | Sheet closes; toast with Undo (re-adds it) |
| Last 24 hours / Last 7 days (usage) | - (re-queries `usage.get`) | - | No | Chart and figure switch |
| + Add a device… | `profile.devices.set {profile, devices}` | write | Only when the profile is paused or in a scheduled pause now | Picker of devices (unassigned first; moving one from another profile says "Moves from Alex"); table updates |
| Remove (x) on a device | `profile.devices.set {profile, devices}` (without that device) | write | Only when Unassigned is paused | Device goes to Unassigned; toast with Undo |
| Device row | - | - | No | Device detail |
| All → (activity), event row | - | - | No | Activity filtered to Mia; the event's target |
| Delete profile… (Profile settings) | `profile.delete {profile, confirm: true}` | destructive | Yes, type the name | Toast "Deleted Mia"; navigates to Profiles |

## States

- **Loading.** Hero with avatar and name if cached, `-` metrics; lanes with
  gridlines only; schedule rows blank; chart gridlines.
- **Empty.** No schedules and no manual pause today: the week timeline hides
  and only **Schedules** shows, full width, with one muted line in a small
  card, "No scheduled pauses yet. Add one to pause Mia's devices
  automatically, like at bedtime.", and **+ Add a scheduled pause**. Not
  while `profile.get` is loading (the two columns keep their placeholders).
  Adding the first schedule brings back both columns. A manual pause with no
  schedules keeps the timeline.
  No devices: "No devices in this profile yet." with **+ Add a device**; Pause
  profile disabled ("Add a device first"). No usage: "No activity in this
  window." No activity: "Nothing has happened here yet."
- **Paused (manual).** Status Paused, hero line "Paused 25m ago, until
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
  data in the last 24 hours. Since M5.11-fix it also has the same
  **Scheduled pauses** week timeline and **Schedules** list as a profile
  (`ProfileSchedules.tsx`, a block click or row opens the schedule sheet),
  read from `profile.get {profile: "unassigned"}` (eero's default profile,
  as id `unassigned`), and the hero shows its state, next change and
  scheduled off-time. Without a default profile (eeroOS before 7.12.4) the
  schedules section shows the error with Retry. No Rename, no Delete
  section, no Add a device (devices land here by leaving other profiles;
  see
  [profiles.md](profiles.md#notes)). The route shares `/profiles/:profileId`
  (profile ids are numbers).
- **Capability missing.** None specific beyond Unassigned support (eeroOS
  7.12.4+).
- **Bridge mode.** Not reachable; shows the bridge note with a link back.

## Notes

- Schedules use eero's `{profile}/schedules` endpoints (POST, then PUT and
  DELETE on `{profile}/schedules/{id}`); writing schedules on the profile
  object is a silent no-op. Days are sent as "Monday".."Sunday" (eero
  refuses LD's `MON` and FF's `monday`, per Eeronaut; a MANUAL check
  confirms it); an end before the start wraps past midnight.
- `profile.schedule.add` and `.update` params: `name` (1 to 32 chars,
  unique within the profile), `start` and `end` (`HH:MM`, 24 h, and not
  equal), `days` (non-empty subset of `MON`..`SUN`), `enabled`. `.update`
  takes only the fields that change. Presets are UI shortcuts: School
  nights = Sun to Thu, Weekdays = Mon to Fri, Weekends = Sat and Sun.
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
- MANUAL: add, edit and remove a schedule on a test profile | profile
  detail, Add a scheduled pause starting a few minutes from now, check the
  eero app shows it with the right days, edit its end time, wait for it to
  start, then delete it | the eero app shows it (days right, so "Monday" is
  accepted) and the edit; devices pause at the start time; deleting removes
  it there too | risk: that profile pauses at the scheduled time.

## Built so far (M3.5, M4.5, M4.12)

The page lives in `src/renderer/src/features/profile/`. M4.5 wired Rename
(sheet), Pause and Resume (hero, with Undo), Add a device (the devices
picker sheet, `profile.devices.set`), Remove (x on a row, with Undo) and
Delete profile (type-the-name dialog with the engine's message; toast
"Deleted Mia", then Profiles). Controls dim by the `profiles` permission and
bridge mode.

M4.12 wired the schedules (`ProfileSchedules.tsx`, `ScheduleSheet.tsx`):
**+ Add a scheduled pause**, a row or its pencil open the sheet; the row
switch runs `profile.schedule.update {enabled}` with Undo. The sheet's
times are native time inputs (hour, minute, AM or PM); End shows "next
day" when it wraps, and equal times are refused under End. Save toasts with
Undo (remove for a new schedule, the old fields for an edit); Delete
schedule asks inline and its Undo adds the schedule back (with a new id).
A manual pause draws on today's lane in the warning colour (as on the
Profiles lanes) from `profile.get` `today`, with a "Manual pause" legend
swatch. Clicking a lane segment opens the sheet for that schedule (M5.11:
the shared timeline's `onSelect`, given only when the `profiles` gate
allows; the manual pause block is `inert`). The Profiles card menu has no
"Add a scheduled pause" item (`ProfileCards.tsx` was not this story's file).

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
