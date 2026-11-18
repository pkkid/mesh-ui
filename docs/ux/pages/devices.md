# Devices

Every device the network knows about, with live rates, filters, grouping and
bulk actions (pause, resume, assign profile, block).

Mockup: [../../mockups/05-devices.html](../../mockups/05-devices.html)

Shell, confirmations, states and refresh rules: [../overview.md](../overview.md).
Topbar: title "Devices", nothing after it (freshness is in the Refresh tooltip), page action the **Live**
switch (Share Wi-Fi lives on Overview and Wi-Fi, #259). Sidebar count: all known devices (38).

## Layout

1. **Hero**: the page header, one card at hero weight (`--hero-radius`,
   24px by 22px padding) split into three cells by 1px rules. Each cell has
   a small uppercase label and leads with a key figure in `text-4xl
   font-semibold tabular-nums` (#248). The layout follows the hero's own
   width (container queries): three columns when wide (`auto 0.85fr
   1.15fr`); at the default 1200px window, Devices on the left with
   Current throughput over New this week on the right; one column when narrow.
   - **Devices**: "38" (every known device, `summary.total`) with "31
     online" and "3 paused · 2 blocked" in muted `text-xs` under it, then
     the By type donut and legend: a 96px donut with "38 devices" in the
     middle (straight segment ends with a small gap) and an 11rem list of
     device counts and their share: Phones & tablets "12 · 32%", Computers
     "7 · 18%", Entertainment "6 · 16%", Smart home "10 · 26%", Other
     "3 · 8%", each with its colour square (count in `font-medium`, percent
     muted, from the total of the counts). The cell takes only the width it
     needs. Hovering a segment dims the others and shows
     "Phones & tablets · 12 devices · 32%" in a tooltip that follows the
     pointer, and highlights its legend row; hovering a legend row does the
     same to the ring.
   - **Current throughput**: "186" with "Mbps down", then "24 Mbps up · 14
     devices active", a band insight ("6 GHz carries 41% of traffic with
     19% of devices") and "Sum of current device rates while Live is on".
     With Live off: `-` and "Turn on Live to see current rates".
   - **New this week**: the count ("3") beside up to three devices with
     icon, name and a muted line ("48m ago · Living Room", "Tue · Living
     Room", "Mon · blocked" in destructive text), or "No new devices this
     week."
2. **Toolbar**, one row:
   - Search field "Search devices" (tooltip: name, manufacturer, MAC or IP)
     with a `/` hint. It grows up to 300px.
   - Status segment: All 38 / Online 31 / Offline 5 / Paused 3 / Blocked 2.
   - **Filters** button with a count of the popover filters that are set. Its
     popover has one row per filter: Network (All / Main / Guest 1), Band
     (Wired 4, 2.4 GHz 11, 5 GHz 10, 6 GHz 6 toggles), Type, eero, Profile
     (with Unassigned) and Manufacturer (selects with an Any row), First seen
     (New this week 3), and a footer "3 filters set" with **Clear all**.
   - Right: Group by menu (None) and a Columns button. The menu shows its
     name in the tooltip. Sorting is on the table headers (below).
3. **Active filters** (only while a popover filter is set): one small chip
   per filter ("6 GHz", "Computers", "Profile: Alex") with an x to remove it,
   then **Clear all**, which clears the popover filters (search and status
   stay).
4. **Bulk action bar** (only while rows are selected): mixed checkbox, "3
   selected", the selected names in muted text, then **Pause**, **Resume**,
   **Assign profile ▾**, **Block 3** (danger), a rule, **Clear**.
5. **Device table** (card). Columns: checkbox, Device (icon, name
   with optional NEW or GUEST tag, maker and model line), Profile (avatar
   and name, or "Unassigned"), Connected to (eero), Band (badge or Wired),
   Signal (bars, `-` for wired), IP · MAC (two mono lines), Now down / up
   (two small rates with their unit, "4.2 Mbps" or "320 kbps", and the
   device's share of current traffic, "12%", as in the eero app's live
   view; "Paused" or last-seen text when not live), 24h
   (data used in the last 24 hours, `usage.breakdown` range day), Status (Online, Paused, Offline, Blocked), and a row menu (`...`).
   - Every column header except the checkbox and the row menu sorts the
     table (`device.list` `sort` and `order`). The default is Device, A to
     Z. Clicking a new header sorts by it in its natural direction (Device,
     Profile, Connected to, Band, IP and Status ascending; Signal, Now and
     24h largest first); clicking the active header flips it. The active
     header is in the text colour with a small muted up or down arrow and
     `aria-sort`. Missing values (`-`, Unassigned) sort last either way, and
     ties sort by name. With Group by on, rows are sorted within each group.
   - Rows are a flat list by default. They can be grouped (Group by:
     Category, Status, eero or Profile). Grouped rows have header rows with
     a chevron, an icon, the group name and a count. Collapsed groups show
     a summary instead ("10 devices · all online · Nest Thermostat, Hue
     Bridge, Ring Doorbell, Kitchen Echo, +6" and "Expand"). A group with no devices is not shown, with or
     without filters.
   - Groups in the mockup (Group by Category): Computers & Personal,
     Entertainment, Home (collapsed), Other (hidden while empty), Recently
     online (offline devices with last seen), Blocked.
   - Offline and blocked rows have muted icons and eero names; selected rows
     have the selected surface and a left marker. The row hover is a muted
     background; the device name is not underlined on hover, since the whole
     row opens device detail.
   - Footer: info icon, "Offline devices drop off the list after 7 days.
     Paused devices stay connected but have no internet." and, right,
     "`Shift` click to select a range".

## Data

| Element | Command | Refresh |
| --- | --- | --- |
| Table rows | `device.list {status?, ssid?, band?, eero?, profile?, type?, manufacturer?, firstSeenSince?, search?, sort?, order?}` (New this week sends `firstSeenSince` a week before it was turned on) | 30 s |
| Live "Now" column, Current throughput | `device.rates.refresh` then `device.list` (rates in each device's `rate`) | 60 s while the page is visible and Live is on |
| Status and Filters popover counts, By type, band insight, guest count, New this week | `device.list` `summary` (counts by status, band, eero, profile, type, manufacturer; `newThisWeek`) | 30 s |
| Profile avatars and names | `device.list` (embedded profile ref) + `profile.list` for colours | 60 s |
| Assign profile menu | `profile.list` | 60 s |
| Sidebar count | `device.list` summary `total` | 30 s |

## Actions

| Control | Command | Effect | Confirm | Result |
| --- | --- | --- | --- | --- |
| Search, status segment, Filters popover, active filter chips, Clear all, column header sort | - (view state, passed as `device.list` params) | - | No | Table and counts update; filter state kept per network |
| Group by, Columns, expand or collapse a group | - (view state) | - | No | Layout only |
| Row click, device name | - | - | No | Device detail (Prev and Next follow this table's order) |
| Checkbox, `Shift+click`, `Ctrl+A`, header checkbox | - (view state) | - | No | Selection; bulk bar appears |
| Pause (bulk) | `device.pause {devices}` | disruptive | Yes, dialog ("Pause 3 devices?" with the names) | Selected rows show Paused; toast "Paused 3 devices" with Undo (`device.resume`) |
| Resume (bulk) | `device.resume {devices}` | write | No | Rows return to Online; toast with Undo |
| Assign profile ▾ (bulk) | `device.profile.set {devices, profile}` (`profile: null` for Unassigned) | write | Only when the target profile is paused or in a scheduled pause now | Profile column updates; toast with Undo |
| Block N (bulk) | `device.block {devices}` | disruptive | Yes, dialog ("Block 3 devices? They are disconnected from every eero and can't rejoin Maple Street until you unblock them.") | Rows move to the Blocked group; toast with Undo (`device.unblock`) |
| Clear | - | - | No | Selection cleared |
| Row menu: Pause / Resume | `device.pause {devices: [id]}` / `device.resume` | disruptive / write | Pause: dialog | As above |
| Row menu: Rename... | `device.rename {device, nickname}` | write | No | Inline edit of the name cell |
| Row menu: Change profile | `device.profile.set {devices: [id], profile}` | write | Only when the target profile is paused or in a scheduled pause now | Submenu of profiles |
| Row menu: Block / Unblock | `device.block` / `device.unblock` | disruptive / write | Block: dialog | Moves between groups |
| Row menu: Copy IP, Copy MAC | - (clipboard) | - | No | Toast |
| Row menu: Open details | - | - | No | Device detail |
| New this week item | - | - | No | Device detail |

## States

- **Loading.** Hero figures and cells with `-`; toolbar and Filters popover render
  with counts `-`; table shows blank rows at normal height. While a rates burst
  is pending (about 12 s) the "Now" column keeps its last figures at full
  strength; the refetches after it (every 4 s while eero keeps the burst
  live) show on the topbar Refresh icon.
- **Empty.** A filter with no matches: one muted sentence in the table body,
  "No devices match these filters." with **Reset filters**. A network with no
  devices: "No devices have joined Maple Street yet." Groups with no
  devices are hidden.
- **Error.** Table body note with Retry; summary keeps last values. A failed
  burst leaves the last rates and marks the column "rates from 3m ago".
- **Offline (this computer).** Shell banner; bulk and row-menu writes
  disabled; "Now" column shows `-`.
- **Network offline.** Rows show the last known state muted; Current throughput
  shows `-` with "Maple Street is offline".
- **No permission.** Admins may pause and block. If `network.permissions`
  denies device updates, bulk buttons and write menu items are disabled with
  the reason.
- **Capability missing.** Firmware without per-device usage: 24h column
  `-`. Burst reporter unsupported: "Now" column and Current throughput hidden.
- **Bridge mode.** Pause, Resume, Block, Assign profile and the Profile
  column are hidden; "Now" column and Current throughput hidden; the bridge note
  sits above the hero. The list, search and filters still work.
- **Guest devices.** Tagged GUEST; on the Guest segment the bulk bar offers
  only Block (pause and profiles do not apply to guests).

## Built so far (M4.4)

Selection (checkbox, `Shift` click for a range, the header checkbox for the
rows on screen, `Ctrl+A`, `Esc` clears), the bulk bar (Pause, Resume, Assign
profile, Block N, or Unblock N when every selected row is blocked; Clear) and
the row menu (Pause or Resume, Rename... in place, Change profile submenu,
Block... or Unblock) all run. Bulk and row Block ask in the app dialog. After
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
  (lucide `Activity`) and "Live", with a status dot while on. It sits in the
  Devices top bar and in a device's Now box; one setting for both (Internet
  had a "Using the most right now" panel and dropped it: its tables already
  show who used the most), like the eero app's live usage
  view. Off on a first run, the last choice is remembered (renderer view
  state, `useLiveMode`), and it turns itself off after 10 minutes. While off,
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
  footer note.
- Open question: the "All networks / Main / Guest" segment assumes
  `device.list` reports guest membership (`is_guest`); verify on firmware
  without a guest network.
