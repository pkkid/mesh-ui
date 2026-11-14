# Devices

Every device the network knows about, with live rates, filters, grouping and
bulk actions (pause, resume, assign profile, block).

Mockup: [../../mockups/05-devices.html](../../mockups/05-devices.html)

Shell, confirmations, states and refresh rules: [../overview.md](../overview.md).
Topbar: title "Devices", subtitle "Updated 4s ago", page action **Share
Wi-Fi**. Sidebar count: all known devices (38).

## Layout

1. **Summary strip**: one card split into three cells by 1px rules.
   - **By type**: a small donut (straight segment ends with a small gap,
     its top level with the "BY TYPE" label) and a list with counts: Phones & tablets 12,
     Computers 7, Entertainment 6, Smart home 10, Other 3, each with its
     colour square.
   - **Throughput now**: "186 Mbps down", "24 Mbps up · 14 devices active",
     a band insight ("6 GHz carries 41% of traffic with 19% of devices") and
     "Sum of current device rates, refreshed every minute".
   - **New this week** with the count (3): up to three devices with icon,
     name and a muted line ("48 min ago · Living Room", "Tue · Living Room",
     "Mon · blocked" in destructive text).
2. **Toolbar**, one row:
   - Search field "Search devices" (tooltip: name, manufacturer, MAC or IP)
     with a `/` hint. It grows up to 300px.
   - Status segment: All 38 / Online 31 / Offline 5 / Paused 3 / Blocked 2.
   - **Filters** button with a count of the popover filters that are set. Its
     popover has one row per filter: Network (All / Main / Guest 1), Band
     (Wired 4, 2.4 GHz 11, 5 GHz 10, 6 GHz 6 toggles), Type, eero, Profile
     (with Unassigned) and Manufacturer (selects with an Any row), First seen
     (New this week 3), and a footer "3 filters set" with **Clear all**.
   - Right: Group by menu (Category), Sort menu (Name), and a Columns button.
     The menus show their name in the tooltip.
3. **Active filters** (only while a popover filter is set): one small chip
   per filter ("6 GHz", "Computers", "Profile: Alex") with an x to remove it,
   then **Clear all**, which clears the popover filters (search and status
   stay).
4. **Bulk action bar** (only while rows are selected): mixed checkbox, "3
   selected", the selected names in muted text, then **Pause**, **Resume**,
   **Assign profile ▾**, **Block 3** (danger), a rule, **Clear**.
5. **Device table** (card). Columns: checkbox, Device (sortable, icon, name
   with optional NEW or GUEST tag, maker and model line), Profile (avatar
   and name, or "Unassigned"), Connected to (eero), Band (badge or Wired),
   Signal (bars, `-` for wired), IP · MAC (two mono lines), Now down / up
   (two small numbers; "Paused" or last-seen text when not live), 24h
   (data used in the last 24 hours, `usage.breakdown` range day), Status (Online, Paused, Offline, Blocked), and a row menu (`...`).
   - Rows are grouped. Group header rows have a chevron, an icon, the group
     name and a count. Collapsed groups show a summary instead ("10 devices ·
     all online · Nest Thermostat, Hue Bridge, Ring Doorbell, Kitchen Echo,
     +6" and "Expand"). A group with no devices is not shown, with or
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
| Table rows | `device.list {status?, ssid?, band?, eero?, profile?, type?, manufacturer?, firstSeenSince?, search?, sort?}` (New this week sends `firstSeenSince` a week before it was turned on) | 30 s |
| Live "Now" column, Throughput now | `device.rates.refresh` then `device.list` (rates in each device's `rate`) | 60 s while the page is visible |
| Status and Filters popover counts, By type, band insight, guest count, New this week | `device.list` `summary` (counts by status, band, eero, profile, type, manufacturer; `newThisWeek`) | 30 s |
| Profile avatars and names | `device.list` (embedded profile ref) + `profile.list` for colours | 60 s |
| Assign profile menu | `profile.list` | 60 s |
| Sidebar count | `device.list` summary `total` | 30 s |

## Actions

| Control | Command | Effect | Confirm | Result |
| --- | --- | --- | --- | --- |
| Share Wi-Fi (topbar) | `wifi.share` | query | No | Share Wi-Fi sheet (QR, name, show and copy password) |
| Search, status segment, Filters popover, active filter chips, Clear all, sort | - (view state, passed as `device.list` params) | - | No | Table and counts update; filter state kept per network |
| Group by, Columns, expand or collapse a group | - (view state) | - | No | Layout only |
| Row click, device name | - | - | No | Device detail (Prev and Next follow this table's order) |
| Checkbox, `Shift+click`, `Ctrl+A`, header checkbox | - (view state) | - | No | Selection; bulk bar appears |
| Pause (bulk) | `device.pause {devices}` | write | No | Selected rows show Paused; toast "Paused 3 devices" with Undo (`device.resume`) |
| Resume (bulk) | `device.resume {devices}` | write | No | Rows return to Online; toast with Undo |
| Assign profile ▾ (bulk) | `device.profile.set {devices, profile}` (`profile: null` for Unassigned) | write | No | Profile column updates; toast with Undo |
| Block N (bulk) | `device.block {devices}` | write | Yes, UI dialog ("Block 3 devices? They are disconnected from every eero and can't rejoin Maple Street until you unblock them.") | Rows move to the Blocked group; toast with Undo (`device.unblock`) |
| Clear | - | - | No | Selection cleared |
| Row menu: Pause / Resume | `device.pause {devices: [id]}` / `device.resume` | write | No | As above |
| Row menu: Rename... | `device.rename {device, nickname}` | write | No | Inline edit of the name cell |
| Row menu: Change profile | `device.profile.set {devices: [id], profile}` | write | No | Submenu of profiles |
| Row menu: Block / Unblock | `device.block` / `device.unblock` | write | Block: UI inline confirm | Moves between groups |
| Row menu: Copy IP, Copy MAC | - (clipboard) | - | No | Toast |
| Row menu: Open details | - | - | No | Device detail |
| New this week item | - | - | No | Device detail |

## States

- **Loading.** Summary cells with `-`; toolbar and Filters popover render
  with counts `-`; table shows blank rows at normal height. On refresh, the "Now" column
  fades to 40% while a burst is pending (about 12 s).
- **Empty.** A filter with no matches: one muted sentence in the table body,
  "No devices match these filters." with **Reset filters**. A network with no
  devices: "No devices have joined Maple Street yet." Groups with no
  devices are hidden.
- **Error.** Table body note with Retry; summary keeps last values. A failed
  burst leaves the last rates and marks the column "rates from 3 min ago".
- **Offline (this computer).** Shell banner; bulk and row-menu writes
  disabled; "Now" column shows `-`.
- **Network offline.** Rows show the last known state muted; Throughput now
  shows `-` with "Maple Street is offline".
- **No permission.** Admins may pause and block. If `network.permissions`
  denies device updates, bulk buttons and write menu items are disabled with
  the reason.
- **Capability missing.** Firmware without per-device usage: 24h column
  `-`. Burst reporter unsupported: "Now" column and Throughput now hidden.
- **Bridge mode.** Pause, Resume, Block, Assign profile and the Profile
  column are hidden; "Now" column and Throughput now hidden; the bridge note
  sits above the summary. The list, search and filters still work.
- **Guest devices.** Tagged GUEST; on the Guest segment the bulk bar offers
  only Block (pause and profiles do not apply to guests).

## Notes

- Param design for bulk: `device.pause`, `device.resume`, `device.block`,
  `device.unblock` and `device.profile.set` take `devices: Ref[]` (one or
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
- Live rates: `device.rates.refresh` (`POST {net}/burst_reporters`) is
  allowed once a minute per network; rates are fresh about 12 s later. The
  engine owns the timer and shares it with other live views.
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
