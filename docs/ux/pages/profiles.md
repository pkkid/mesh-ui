# Profiles

People on the network: each profile groups one person's devices so they can
be paused together, put on schedules and compared by usage. Also the place to
sort out unassigned devices.

Mockup: [../../mockups/07-profiles.html](../../mockups/07-profiles.html)

Shell, confirmations, states and refresh rules: [../overview.md](../overview.md).
Topbar: title "Profiles", no page actions. Sidebar
count: number of profiles, not counting Unassigned.

## Layout

1. **Hero** (flat `PageHeader`, as Devices; `ProfilesHero.tsx`).
   - Title: the profile count ("4 profiles").
   - Status line: a status dot with "2 active", then "1 paused · 1 in a
     scheduled pause" (zero counts left out).
   - Facts: **In a profile** ("18 of 36 devices", Unassigned counted in the
     total), **Next change** (the soonest scheduled start or end across
     profiles not paused by hand: "Mia · Homework ends 6:00 PM", or "None
     scheduled"), **Most data today** ("Alex · 141 GB").
   - A share bar of devices by profile in the profile colours, Unassigned in
     the neutral series last, with its legend.
   - Actions: **+ Add a profile…**, **Pause all…** and, while any profile is
     paused, **Resume all** (no confirm, one Undo). Hidden with no profiles;
     the empty card has its own Add a profile.
   - **Right-hand column: Usage by profile** (`ProfilesUsage.tsx`), built
     like Devices' Live throughput panel, 28rem wide and 56px from the
     facts. Title "Usage by profile" (`text-base font-semibold`) with the
     subtitle under it, "About 247 GB a day" (or "an hour"); a Last 24 hours
     / Last 7 days dropdown on the title's row. The total as the compact
     hero figure ("1.7" in `text-2xl`, "TB in 7 days" muted), a 96px
     stacked column chart with no y labels (one segment per profile in its
     colour, tooltip per bucket with a Total), and a chip per profile with
     its total ("Alex 1.2 TB"). Profiles only: Unassigned is left out (it
     is in the devices bar, and its traffic would flatten the profiles).
   - Sections after the hero sit 56px apart (`gap-14`).
2. **Your profiles** section: the profiles and the unassigned devices in
   one place, so assigning is dragging a device onto its person. Description
   "18 devices in profiles, 18 unassigned". Tools, in order: a Card view /
   List view dropdown, **Add a profile…** (with unassigned devices selected
   it reads **Add profile from selection (2)…** and opens the sheet with
   them picked) and a **View unassigned profile →** text link to the
   Unassigned page, where Unassigned is paused and scheduled like any
   profile.
   - **Profile cards**, a 4-column grid. Each card:
     - Avatar initial in the profile colour, name, "6 devices, 6 online".
     - A stacked row of device-type icons, online first, up to six and then
       "+N" styled like the last icon shown. Offline: fill, outline and icon
       each mixed 50% into the window background, never transparent. An icon
       that arrives from a drop falls into the stack with a small bounce.
     - The status (Active, Scheduled, Paused).
     - The next change: "Homework ends 6:00 PM", "Bedtime starts 9:00 PM",
       "Paused until resumed" or "No schedules".
     - "Today" with the usage figure ("96 GB") and a 24 h sparkline in the
       profile colour.
     - No buttons: pausing, schedules, rename and delete are on the
       profile's own page, one click away.
     - The whole card opens profile detail (a clickable card, see the
       design system): hover brightens the background, and the name is the
       keyboard focus target.
     - List view: one row per profile with the same fields in columns.
   - **Drop targets.** While unassigned devices are selected, or one is being
     dragged, every card (or list row) turns into a drop target: a 2px
     dotted outline in the theme's border colour (`outline-border`) (an outline, so nothing moves), and the one under a drag
     takes a muted fill and a darker outline; it does not grow. In List view the
     table's border, background and row rules turn transparent meanwhile, so
     only the rows' dotted outlines show. Nothing moves or resizes;
     neighbouring outlines touch. Dropping moves the devices there;
     clicking a card with a selection does the same instead of opening the
     profile.
   - **Unassigned**, under the cards: a quiet line "Unassigned 18 devices, 16
     online" with a hint on the line under it ("Drag a device onto a profile, or
     select several. New and private-MAC devices land here."; with a
     selection: "2 selected: drag them onto a profile, or click one. Clear").
     With none: "Every device is in a profile."
   - A 3-column grid of device tiles with no outline and no background until
     hovered (`bg-muted/60`; selected: `bg-muted` with a 2px inset ring; the
     drag ghost, and every card in a dragged stack, looks selected): icon,
     name, "Online, 142 GB in 24h", "Offline, 3 days ago" or "Blocked"
     (destructive text); offline tiles at reduced opacity.
   - **Drag and drop** (`useTileDrag.tsx`): a press that moves 5px lifts the
     tile. The ghost follows the pointer and wobbles like GNOME's wobbly
     windows: an underdamped spring shears it around the grab point, so
     the far edges lag a move (at most 4 degrees) and jiggle back into
     shape when the pointer stops. The source tile fades in place. Dropping
     on a card shrinks the ghost into it and the card gives a small bounce;
     anywhere else the ghost springs back. Esc cancels. Dragging a selected
     tile carries the whole selection as a fanned stack with a count.
     Reduced motion drops the wobble and the animations.
   - **Keyboard and click path:** select tiles (click or Space), then click a
     profile card to move them there.
3. **Today's pauses** section. Description "3 scheduled, 1 manual, Pacific
   Time" (today's pauses by kind, zero counts left out, then the network
   time zone). Legend on the right: Scheduled (muted fill), Manual pause
   (warning fill), Upcoming (hatched). Card with one lane per profile plus
   Unassigned, 12 AM to 12 AM, each lane a plain `bg-muted` track:
   - Segments with a label ("Bedtime", "Homework", "Paused until resumed").
     Past scheduled segments are solid muted, upcoming ones hatched, a manual
     pause is warning-filled.
   - A vertical now line across all lanes with the time above the first lane
     ("2:05 PM").
   - Empty lanes say "No pauses today".
   - Tick labels in normal case: 12 AM, 6 AM, 12 PM, 6 PM, 12 AM.
   - Collapsed when there is nothing to show: no profile or Unassigned has a
     schedule and nothing is paused today. Description "None scheduled", one
     muted line in a small card, "No scheduled pauses. Schedules pause
     a profile's internet at set times, like bedtime.", and the tool **+ Add
     a schedule** opens a picker of profiles (opens that profile's schedule
     sheet) and Unassigned (opens the Unassigned page). A manual pause with
     no schedules keeps the full chart.

## Data

| Element | Command | Refresh |
| --- | --- | --- |
| Profile cards (name, colour, device counts, online, status, next schedule) | `profile.list` | 60 s |
| Device type icons on cards | `device.list` (all devices, shared with Unassigned) | 30 s |
| Today's usage per profile and sparklines | `usage.get {scope: "profile", range: "day"}` (no `id`: one series per profile) | 5 min |
| Today's pauses lanes | `profile.list` (`today` segments per profile, computed in core from schedules and manual pause state, in the network time zone) | 60 s; the now line moves every minute |
| Usage by profile in the hero (total, per-profile totals, per day or hour bars) | `usage.get {scope: "profile", range}` (the Unassigned series is left out in the view) | 5 min |
| Unassigned device tiles | `device.list` (devices with no profile, blocked ones included, guests left out) | 30 s |
| "142 GB in 24h" on a tile (the breakdown's day is the last 24 hours, so the mockup's "today" would overstate it) | `usage.breakdown {range: "day", by: "device"}` | 5 min |
| Avatar row on tiles | `profile.list` | 60 s |

## Actions

| Control | Command | Effect | Confirm | Result |
| --- | --- | --- | --- | --- |
| + Add a profile (hero) | `profile.create {name, devices}` | write | No | Sheet: name, device picker (unassigned first, then others with their current profile shown); Save creates and opens the profile |
| Pause all… (hero) | `profile.pause {profile}` once per profile (Unassigned not included) | disruptive | Yes, one dialog for all ("Pause Alex, Jamie, Mia and Leo? 18 devices lose internet until you resume them.") | All cards Paused; toast with Undo |
| Resume all (hero, while any profile is paused) | `profile.resume {profile}` once per paused profile | write | No | Cards Active or Scheduled; one toast with Undo that pauses them again |
| Card view / List view | - (view state) | - | No | Layout |
| View unassigned profile | - | - | No | The Unassigned page (pause, schedules) |
| Card (click outside buttons) | - | - | No | Profile detail |
| Lane segment | - | - | No | Tooltip "Bedtime · 9:00 PM to 7:00 AM"; click opens the profile |
| Last 24 hours / Last 7 days (hero) | - (re-queries `usage.get`) | - | No | Chart and list update |
| Drop a tile (or the selection) on a profile bucket, or click a bucket with tiles selected | `device.profile.set {devices, profile}` | write | Only when the target profile is paused or in a scheduled pause now | Tile leaves the grid; toast "Moved Living Room TV to Alex" with Undo |
| Tile click | - (view state: toggles selection) | - | No | Selected tiles get the selected surface; the cards become drop targets and Add a profile… becomes Add profile from selection… |
| Tile double-click | - | - | No | Device detail |
| Add profile from selection… (section tools, with a selection) | `profile.create {name, devices}` | write | No | Add a profile sheet with the selection picked |

Built in M4.5: Add a profile (sheet with name and a device picker:
unassigned first, then others with "Moves from Alex"; Save opens the new
profile), Pause all (dialog; one toast with Undo that resumes them all; off
with "Every profile is paused" when there is nothing to pause) and Resume
all. Per-profile pause, resume, rename, schedules and delete, and Pause
unassigned, live on the profile pages ([profile-detail.md](profile-detail.md));
the cards and the **View unassigned profile** link
(`#/profiles/unassigned`) open them.
Every write control dims by the `profiles` permission and bridge mode.

Dropping on a profile card runs `device.profile.set` (M4.4) with an Undo
toast; dragging and the drop targets are off without the `devices` permission
or in bridge mode. A tile click
(or Space) toggles its selection; **Add a profile…** in the section header becomes
**Add profile from selection…** once a tile is selected and opens the Add a profile sheet with the selection
picked (`profile.create {name, devices}`, M5.11), dimmed by the
`profile.create` gate. Card clicks, lane segments and tile double-clicks
navigate as described.

## States

- **Loading.** Cards at normal size with `-`; one empty lane without the now
  line until the network time zone is known (never the collapsed form until
  `profile.list` answers); chart gridlines; tile grid blank.
- **Empty: no profiles.** The Profiles section shows "No profiles yet. Group
  devices by person to pause them together." with **Add a profile**. Today's
  pauses shows the collapsed one-line form (only Unassigned in its picker),
  or only the Unassigned lane when Unassigned has a pause. The hero's Usage by profile shows
  `-` and the chart's empty sentence.
- **Empty: no unassigned devices.** The Unassigned line says "Every device
  is in a profile." and no tiles show.
- **Error.** Per section note with Retry.
- **Offline (this computer).** Shell banner; pause, resume and assignment
  disabled.
- **Network offline.** Writes disabled ("Maple Street is offline"); history
  and cards stay with last values.
- **No permission.** Admins can manage profiles and schedules. Denied
  `profiles` permissions disable the controls with the reason.
- **Capability missing.** Firmware before the Unassigned profile (eeroOS
  7.12.4): the Unassigned lane is hidden; Unassigned devices still list.
- **Bridge mode.** Page not reachable: the sidebar item is hidden and a
  direct link shows the bridge note with a link to Advanced networking.

## Notes

- `profile.pause` takes one `profile` (an id or exact name) and lasts until
  resumed; there are no timed pauses. Pause all calls it per profile.
  Unassigned devices have their own commands, `profile.unassigned.pause` and
  `profile.unassigned.resume`. Only `profile.get` and the schedule commands
  take Unassigned, as the ref `unassigned`; no profile can be named
  Unassigned.
- Unassigned schedules (M5.11-fix): the eero app can schedule pauses for
  Unassigned (eeroOS 7.12.4+), and the M5.1 capture shows eero's default
  profile carries `schedule[]` and `resources.schedules` like any other
  profile, so `profile.schedule.add`, `update` and `remove` with `profile:
  "unassigned"` write to the default profile's `{profile}/schedules`.
  Today's Unassigned lane on this page draws them. A real write there is
  unproven (a `MANUAL:` check). A network without a default profile
  (eeroOS before 7.12.4) has no Unassigned schedules.
- Manual pause start time ("Paused 25m ago", the manual segment start)
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
