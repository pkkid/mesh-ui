# Devices

Every device the network knows about, with live rates, filters, grouping and
bulk actions (pause, resume, assign profile, block).

Mockup: [../../mockups/05-devices.html](../../mockups/05-devices.html)

Shell, confirmations, states and refresh rules: [../overview.md](../overview.md).
Topbar: title "Devices", nothing after it (freshness is in the Refresh tooltip); the **Live**
switch is in the topbar on every page (Share Wi-Fi lives on Overview and Wi-Fi, #259). Sidebar count: all known devices (38).

## Layout

1. **Hero**: the flat page header (`PageHeader flat`, see
   [design system](../../design/design-system.md#page-header-hero)): no card,
   closed by the 1px rule. Everything comes from the `device.list` summary,
   which covers the whole network whatever the filters.
   - **Title**: the count, "38 devices" (`summary.total`; "Devices" while it
     loads).
   - **Status line**: "31 online" as a status (green dot, muted dot at 0),
     then muted "5 offline · 3 paused · 2 blocked".
   - **Facts** (label over value): **New this week** "3 · latest 48m ago"
     (devices eero announced with a New Device notification in the last 7
     days, then how long ago the newest was announced; not the devices'
     `first_active`, which restarts when a device rejoins); the fact is a
     button that turns the New this week filter on and off, pressed while it
     is on. **On guest** "2". **Wired** "4" (`byBand.wired`). **Busiest
     eero** "Living Room · 15" (the eero with the most devices, `byEero`).
   - **By type** share bar on its own line under the facts, as wide as the
     left column (its legend wraps onto a second line next to the Live
     column): Phones & tablets 13, Computers 7, Entertainment 6, Smart home
     11, Other 1, each in its category colour, tooltip
     "Phones & tablets · 13 · 34%".
   - No actions: Live is the topbar switch (28px, the height of the search
     field).
   - **Live throughput**, the right-hand column (448px, pinned to the top
     like every hero aside), 56px from the left column (twice the usual
     28px hero gap, Devices only, so the By type bar and the chart do not
     crowd each other). Hidden in bridge mode and when the burst
     reporter is missing.
     - **Live off**: none of the rows below, only a dim watermark centred
       in a 160px block: a 48px pulse icon (lucide `Activity`, 1.6 stroke)
       at 7% of the text colour, then "Live throughput off" on one line,
       20px semibold at 13%, so it sits just off the background in both
       themes. Turning Live on cross-fades it with the rows below over
       300ms (none with reduced motion).
     - "Live throughput" as a section title (`text-base font-semibold`,
       like All devices), then a green status dot.
       While Live is on, a quiet 2px bar fills the rest of that line
       (`muted-foreground` at 35% on a 10% track): a waiting cue, not a real
       countdown. A reading comes about every 12 s on average, so it fills
       along `1 - 2^(-t / 6 s)`: half full at 6 s, three quarters at 12 s,
       87.5% at 18 s, a smooth curve that keeps slowing (a CSS `linear()`
       easing with a stop a second, `WAIT_EASING`), and starts over from
       empty whenever a new reading arrives. Static and empty with reduced
       motion.
     - Two compact figures (`text-2xl`), each after its series square:
       "164 Mbps down" (download colour) and "39 Mbps up" (upload colour).
       `-` before the first reading. Once a reading
       has come in, a later read with no rates (stale between bursts, or
       eero sent none) keeps the last figures and the line under the chart
       instead of going back to `-`.
     - Live on: a small chart (`h-24`, no y gutter) of download and upload
       opens under the figures (rows grow from 0 and fade in over 300ms;
       it closes the same way when Live goes off; no motion with reduced
       motion). One point per read that brings a new burst or new
       figures (the reads within one burst share its time, but their
       figures move), timed when it arrived, since Live was turned on, labelled with the network's clock ("6:25 PM"); the
       tooltip gives the reading's time to the second ("6:25:42 PM").
       Readings are kept per network for the session and dropped when Live
       goes off (it turns itself off after 10 minutes). Until there are two
       readings: "Waiting for live readings."
     - Under the chart: "18 devices active · 6 GHz carries 36% of traffic"
       (muted `text-xs`).
2. **All devices** section (56px below the rule). **Frozen while
   scrolling:** once the heading reaches the top of the page, the heading
   and its description, the toolbar, the active filter chips and the bulk
   bar stay put (CSS `sticky`, on the page's flat background, starting 24px higher so the heading clears the topbar's scroll fade),
   and the table's header row stays right under them; the rows scroll up
   behind both. The header row is moved with a transform on scroll
   (`usePinnedHead`) rather than `sticky`, because the table's box scrolls
   sideways on narrow windows and would capture a sticky row; it stops at
   the last row. That transform can trail a fast scroll by a frame, so a
   40px shield in the page background sits just above the header row,
   always hidden behind the frozen block, and fills any gap the lag opens
   so rows never show above the header. While it is pinned, a cap under the frozen block redraws the
   card's rounded top edge (its 1px border at the card radius, with the page
   colour covering the card's straight sides at the corners), since the
   card's own top has scrolled away, and a fade the height of the topbar's
   (1.5rem, from the header colour to transparent) runs down from the header
   row, so rows dissolve as they slide under it. The fade comes in with the
   scroll rather than popping in: 0 at the pin point, full after 50px
   (about one row), back out the same way scrolling up. Group header rows scroll normally. The heading with its
   description under it giving every count for the whole network, "38
   devices, 31 online, 5 offline, 3 paused, 2 blocked", leaving out any
   that are zero ("No devices" for an empty network).
3. **Toolbar**, one row:
   - Search field "Search devices" (tooltip: name, manufacturer, MAC or IP)
     with a `/` hint. It grows up to 300px.
   - **Status** dropdown right after search, a `FilterDropdown` like Group
     by: circle-dot icon and the current value ("All devices", "Online"),
     opening a list with counts: All devices 38, Online 31, Offline 5,
     Paused 3, Blocked 2.
   - **Filters** button after Status, with a count of the popover filters
     that are set. Its popover has one row per filter: Network (All / Main /
     Guest 1), Band (Wired 4, 2.4 GHz 11, 5 GHz 10, 6 GHz 6 toggles), Type,
     eero, Profile (with Unassigned) and Manufacturer (selects with an Any
     row), New this week (3, eero's New Device notices), and a footer "3 filters set" with
     **Clear all**.
   - Right: Group by menu (None) and a Columns button (show or hide
     Profile, Connected to, Band, Signal, IP · MAC, Live data, Live chart, 24h and Status). The menu shows its
     name in the tooltip. Sorting is on the table headers (below).
4. **Active filters** (only while a popover filter is set): one small chip
   per filter ("6 GHz", "Computers", "Profile: Alex") with an x to remove it,
   then **Clear all**, which clears the popover filters (search and status
   stay).
5. **Bulk action bar** (only while rows are selected): mixed checkbox, "3
   selected", the selected names in muted text, then **Pause…**, **Resume**,
   **Assign profile ▾**, **Block 3…** (danger), a rule, **Clear**. It
   slides open (200ms) so the table moves down smoothly, then its contents
   fade in; clearing reverses it. Reduced motion skips both.
6. **Device table** (card). Columns: checkbox (the whole cell picks the
   row, so a near miss never opens the device), Device (takes the spare
   width, at least 176px, and truncates long names and maker lines so the
   table fits its card; it scrolls sideways only on windows too narrow for
   the columns shown) (icon, name
   with optional NEW or GUEST tag, maker and model line), Profile (avatar
   and name, or "Unassigned"), Connected to (eero, an eero Built-in Echo included; Echos that can do eero Built-in but have it off are listed too, although eero's device list leaves them out), Band (badge or Wired),
   Signal (bars; wired shows the `<···>` wired mark, lucide `ChevronsLeftRightEllipsis`, as the eero app does), IP · MAC (two mono lines), Live data
   (two small rates with their unit, "4.2 Mbps" or "320 kbps", and the
   device's share of current traffic, "12%", as in the eero app's live
   view; "Paused" or last-seen text when not live), Live chart (its own
   column with a visible header: a 64 by 24px chart of the device's download and upload since Live
   was turned on, the same lines and colors as Live throughput on one shared
   scale, a point for each new burst or change in its figures; kept per
   device for the session and dropped when Live goes off; empty while Live is
   off or the device is offline, paused or blocked), 24h
   (data used in the last 24 hours, `usage.breakdown` range day), Status (Online, Paused, Offline, Blocked), and a row menu (`...`).
   - Every column header except the checkbox and the row menu sorts the
     table (`device.list` `sort` and `order`). The default is Device, A to
     Z. Clicking a new header sorts by it in its natural direction (Device,
     Profile, Connected to, Band, IP and Status ascending; Signal, Live data and
     24h largest first); clicking the active header flips it. Live data sorts
     online devices first, fastest first (by name while Live is off), then
     paused, then offline by last seen, most recent first, then blocked; the
     other direction reverses all of it. The active
     header is in the text colour with a small muted up or down arrow and
     `aria-sort`. Missing values (`-`, Unassigned) sort last either way, and
     ties sort by name. With Group by on, rows are sorted within each group.
     The chosen column and direction are remembered across launches (renderer
     localStorage, the same for every network); filters are not.
   - Rows are a flat list by default. They can be grouped (Group by:
     Category, Status, eero or Profile). Grouped rows have header rows with
     a chevron, an icon, the group name and a count. Collapsed groups show
     a summary instead ("10 devices · all online · Nest Thermostat, Hue
     Bridge, Ring Doorbell, Kitchen Echo, +6" and "Expand"). A group with no devices is not shown, with or
     without filters.
   - Groups in the mockup (Group by Category): Computers & Personal,
     Entertainment, Home (collapsed), Other (hidden while empty), Recently
     online (offline devices with last seen), Blocked.
   - Offline rows are dimmed as a whole: all text between the checkbox and
     the row menu takes the muted subtext colour at 30% strength
     (`text-muted-foreground/30`:
     name, maker line, profile, eero, IP and MAC, last seen, usage and
     status), the device icon is at 60% and the profile avatar at 50%. Blocked rows have muted icons and eero names; selected rows
     have the selected surface and a left marker. The row hover is a muted
     background; the device name is not underlined on hover, since the whole
     row opens device detail.
   - Under the card, outside the table, a plain `Footnote` (no icon):
     "Offline devices drop off the list after 7 days. Paused devices stay
     connected but have no internet."

## Data

| Element | Command | Refresh |
| --- | --- | --- |
| Table rows | `device.list {status?, ssid?, band?, eero?, profile?, type?, manufacturer?, newSince?, search?, sort?, order?}` (New this week sends `newSince` a week before it was turned on) | 30 s |
| Live column, Live throughput | `device.rates.refresh` then `device.list` (rates in each device's `rate`) | 60 s while Live is on, minimized or hidden windows included |
| Hero (counts, facts, By type), Status dropdown and Filters popover counts, band insight, guest count | `device.list` `summary` (counts by status, band, eero, profile, type, manufacturer; `newThisWeek` and `newestAt`, from eero's New Device notifications) | 30 s |
| Profile avatars and names | `device.list` (embedded profile ref) + `profile.list` for colours | 60 s |
| Assign profile menu | `profile.list` | 60 s |
| Sidebar count | `device.list` summary `total` | 30 s |

## Actions

| Control | Command | Effect | Confirm | Result |
| --- | --- | --- | --- | --- |
| Search, Status dropdown, Filters popover, active filter chips, Clear all, column header sort | - (view state, passed as `device.list` params) | - | No | Table and counts update; filter state kept per network |
| Group by, Columns, expand or collapse a group | - (view state) | - | No | Layout only |
| Row click, device name | - | - | No | Device detail (its `[` and `]` keys follow this table's order) |
| Checkbox, `Shift+click`, `Ctrl+A`, header checkbox | - (view state) | - | No | Selection; bulk bar appears |
| Pause… (bulk) | `device.pause {devices}` | disruptive | Yes, dialog ("Pause 3 devices?" with the names) | Selected rows show Paused; toast "Paused 3 devices" with Undo (`device.resume`) |
| Resume (bulk) | `device.resume {devices}` | write | No | Rows return to Online; toast with Undo |
| Assign profile ▾ (bulk) | `device.profile.set {devices, profile}` (`profile: null` for Unassigned) | write | Only when the target profile is paused or in a scheduled pause now | Profile column updates; toast with Undo |
| Block N… (bulk) | `device.block {devices}` | disruptive | Yes, dialog ("Block 3 devices? They are disconnected from every eero and can't rejoin Maple Street until you unblock them.") | Rows move to the Blocked group; toast with Undo (`device.unblock`) |
| Clear | - | - | No | Selection cleared |
| Row menu: Pause… / Resume | `device.pause {devices: [id]}` / `device.resume` | disruptive / write | Pause: dialog | As above |
| Row menu: Rename… | `device.rename {device, nickname}` | write | No | Inline edit of the name cell |
| Row menu: Change profile | `device.profile.set {devices: [id], profile}` | write | Only when the target profile is paused or in a scheduled pause now | Submenu of profiles |
| Row menu: Block… / Unblock | `device.block` / `device.unblock` | disruptive / write | Block: dialog | Moves between groups |
| Row menu: Copy IP, Copy MAC | - (clipboard) | - | No | Toast |
| Row menu: Open details | - | - | No | Device detail |
| New this week fact | - (view state: the New this week filter) | - | No | Table shows only devices new this week; click again to show all |

## States

- **Loading.** Hero title "Devices", facts and counts `-`; toolbar and Filters popover render
  with counts `-`; table shows blank rows at normal height. While a rates burst
  is pending (about 12 s) the Live column keeps its last figures at full
  strength; the refetches after it (every 4 s while eero keeps the burst
  live) show on the topbar Refresh icon.
- **Empty.** A filter with no matches: one muted sentence in the table body,
  "No devices match these filters." with **Reset filters**. A network with no
  devices: "No devices have joined Maple Street yet." Groups with no
  devices are hidden.
- **Error.** Table body note with Retry; summary keeps last values. A failed
  burst leaves the last rates and marks the column "rates from 3m ago".
- **Offline (this computer).** Shell banner; bulk and row-menu writes
  disabled; Live column shows `-`.
- **Network offline.** Rows show the last known state muted; Live throughput
  shows `-`.
- **No permission.** Admins may pause and block. If `network.permissions`
  denies device updates, bulk buttons and write menu items are disabled with
  the reason.
- **Capability missing.** Firmware without per-device usage: 24h column
  `-`. Burst reporter unsupported: Live column and Live throughput hidden.
- **Bridge mode.** Pause, Resume, Block, Assign profile and the Profile
  column are hidden; Live column and Live throughput hidden; the bridge note
  sits above the hero. The list, search and filters still work.
- **Guest devices.** Tagged GUEST; on the Guest segment the bulk bar offers
  only Block (pause and profiles do not apply to guests).

## Built so far (M4.4)

Selection (checkbox, `Shift` click for a range, the header checkbox for the
rows on screen, `Ctrl+A`, `Esc` clears), the bulk bar (Pause, Resume, Assign
profile, Block N, or Unblock N when every selected row is blocked; Clear) and
the row menu (Pause… or Resume, Rename… in place, Change profile submenu,
Block… or Unblock) all run. Bulk and row Block ask in the app dialog. After
a bulk write the failed rows stay selected and the toast says "Paused 2 of
3. <name>: <reason>". Guest-only selections offer only Block; bridge mode
hides pause, profiles and block. Buttons and menu items dim with the reason
from the gates.

## Notes

- Param design for bulk: `device.pause`, `device.resume`, `device.block`,
  `device.unblock` and `device.profile.set` take `devices: Ref | Ref[]` (one or
  many, ids or exact names; see
  [commands.md](../../architecture/commands.md#params-conventions)). The
  engine runs them one by one, within the rate budget, and returns one
  result per device; a partial failure toasts "Paused 2 of 3. PlayStation
  5: <reason>" and leaves the failed row selected.
- Filtering, search and sort are `device.list` params, applied in core to
  the session's cached device snapshot, so the UI, CLI
  (`mesh-ui run device.list --params '{"paused":true}'`) and the palette
  ("List paused devices") share one implementation. Grouping and columns are
  view state.
- **Live switch (#319).** Live rates (a burst a minute plus the reads in its
  window) run only while the shared **Live** switch is on: a pulse icon
  (lucide `Activity`) and "Live", with a status dot while on, 28px like the
  topbar search. It shows in the topbar on every page and stays on wherever
  you go (one app-wide setting). While on, the shell keeps asking eero for
  live rates on every page (`LiveCollector`) and records each reading
  (`app/liveReadings.ts`), so the Live throughput chart, device detail and
  the table's Live chart column keep their history while you are elsewhere
  (Internet had a "Using the most right now" panel and dropped it:
  its tables already show who used the most), like the eero app's live usage
  view. Its tooltip says the rates show on the Devices page ("Show live
  rates on the Devices page (asks eero for live reporting while on)"). Off at every launch (not remembered; renderer view state,
  `useLiveMode`), and it turns itself off after 15 minutes; while on, the
  switch's tooltip counts down to that ("Live rates on, shown on the
  Devices page. Turns off in 7m 12s."). While off,
  nothing asks eero for live rates and rates show `-` with "Turn on Live to see
  current rates". The CLI and MCP are unchanged.
- Live rates: `device.rates.refresh` (`POST {net}/burst_reporters`) is
  allowed once a minute per network; rates are fresh about 12 s later and
  stay live for a few seconds, during which the page reads devices every
  4 s. Later reads keep those last live figures (#254). The engine owns the
  timer and shares it with other live views. Rates below 1 Mbps show in
  kbps, so a trickle never reads as 0.
- Device writes go to `/2.3/`; `/2.2/` returns 200 without saving.
- Category groups come from eero's `device_type`, mapped in core to five
  categories (Phones & tablets, Computers, Entertainment, Smart home, Other)
  for the summary and to the mockup's group names for the table.
- Blocked devices come from the blocklist and may have no IP (`-`).
  Randomised-MAC devices show "Unknown manufacturer · random MAC".
- Offline devices age out of eero's list after about 7 days, hence the
  footnote under the table.
- Open question: the "All networks / Main / Guest" segment assumes
  `device.list` reports guest membership (`is_guest`); verify on firmware
  without a guest network.
