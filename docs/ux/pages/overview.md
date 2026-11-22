# Overview

The landing page: is the network healthy, how fast is it, who is using it, and
what changed recently.

Mockup: [../../mockups/01-overview.html](../../mockups/01-overview.html)

Shell, confirmations, states and refresh rules: [../overview.md](../overview.md).
Topbar: title "Overview", nothing after it (freshness, "Updated just now", is in the Refresh tooltip), no page
actions.

## Layout

1. **Status hero** (card). Left column:
   - Network name ("Maple Street") as the title.
   - Status line: Online status and "Gateway up 23 days, 4 hours".
   - Metric row: ISP ("Ziply Fiber"), Public IP ("203.0.113.48"), Last
     speed test ("2h ago"), all three values in the same type so they share a
     baseline.
   - Action row: **Share Wi-Fi**, **Restart network…** (the ellipsis because it confirms first), both outline buttons with dim icons. Speed tests
     run from Internet and Troubleshooting; profiles pause on Profiles.
   - Right side: two speed gauges, Download and Upload, each a 240 degree arc
     with the latest result in the middle ("942 Mbps", "918 Mbps") in the
     download and upload series colours. With a plan the arc runs to 125% of
     it, a short foreground mark crosses the arc at the plan, and a muted
     line under "Mbps" reads "78% of plan", or "9% over plan" after a solid
     flame in the over-plan colour (orange) when the result beats it. A
     caption under them says where the figures come from: "Last speed test
     Nov 14, 9:12 PM · **View history**" (network time; "No speed test yet"
     before the first; View history opens `#/internet/history`, Internet
     scrolled to Speed test history). While no plan is set, a second line
     reads "**Set your internet plan** to scale the gauges" (opens the plan
     sheet). The links are `TextLink`s, so they read as links.
2. **Data usage** section. Header: "Data usage", with the range and the
   `device.list` count under it ("Last 24 hours, 38 devices", "Last 7 days, 38
   devices"), and a range dropdown on the right ("Last 24 hours",
   "Last 7 days"). Switching range crossfades the body (150 ms out, swap, 150 ms in, opacity
   only, none with reduced motion); background polls never crossfade. Body is
   a side column plus main chart:
   - Hero figure "412 GB" with "Busiest hour 12 to 1 PM" (the range is in the
     subtitle, so it is not repeated here) and
     "48.2 GB so far today".
   - Series list, one line per series, 8px apart: Download (arrow icon in
     series colour, then "351 GB (85%)" on the right, the share in muted
     `text-xs` after the size) and Upload ("61 GB (15%)").
   - Rule, then **By eero**: a share bar split by eero (Living Room, Office,
     Upstairs Hall, Garage) with tooltips "Living Room · 212 GB · 51%" and a
     legend with percentages.
   - Main chart: download and upload per hour, line plus soft area, hover
     tooltip with a Total row.
3. Two columns:
   - **eeros**. Description under the title from the eero list and
     `network.health`: count, then online, weak links and offline, zero
     counts left out ("4 eeros · 4 online, 1 weak link"). Header link
     "View topology →" (a dim text link). One row per eero: icon (the eero
     product glyph from `eeroIcon`) and three lines: the name followed by "Gateway" in plain dim text;
     model · backhaul type; status (Online, Weak link, Offline), mesh bars for
     wireless, device count. A 24 h usage sparkline in that eero's series
     colour sits right of lines 2 and 3 (never beside the name), the same
     width in every row, up to 110 px; it narrows before the text does and
     hides below 40 px.
   - **Top devices**. Description under the title: "Last 24 hours" and the
     share of all traffic the rows account for, from the same
     `usage.breakdown` ("Last 24 hours · 78% of all traffic"); only "Last 24
     hours" until it loads. Link "View all devices →" (a dim text link). Table of the top 5: rank, device icon and name with a thin bar scaled
     to the top device, Down and Up (Up muted).
4. Three columns:
   - **Top profiles**. Description under the title: the window and the
     data every profile used in it ("24 hours, 1.2 GB"). Link "View all profiles →" (a dim
     text link). The top 3
     profiles by data used in the last 24 hours (pure ranking: a paused
     profile with little usage drops out; pausing is one click away on
     Profiles). One row per profile:
     avatar initial in the profile colour, name, a detail line ending in the
     same 24-hour total the rows are ranked by ("6 devices · 96 GB", "Bedtime
     9:00 PM to 7:00 AM · 1.2 GB", "3 devices paused · 40 MB"), status
     (Active, Scheduled, Paused). With no profiles it keeps the "No profiles
     yet" note with Add a profile.
   - **When the network is busy**. Description under the title: "Busiest
     Thursday, 4 to 6 PM", the peak block (no window: a Mon to Sun grid is
     obviously a week). A 7 x 12 heatmap (Mon to Sun by two-hour block, each
     the sum of its two hours) in one series colour, intensity by share of
     the week's peak block; labels 12a, 6a, 12p, 6p; cell tooltip "Thu 18:00
     to 20:00 · 78%". Two-hour blocks give square cells that read as a grid in
     a third-width column; hourly detail belongs on a detail page.
   - **Recent activity**. Description under the title: the count of
     kept events from `events.summary {range: "kept"}` ("7 events"), with no
     time span: eero sends only its last ~15 minutes, so the log covers that
     plus the time the app has been open. Link
     "View all activity →" (a dim text link). The latest 3 events with icon, one line
     of text and relative time.

## Data

| Element | Command | Refresh |
| --- | --- | --- |
| Name, status, gateway uptime | `network.get` | 30 s |
| Status issues (drives the status word and any note) | `network.health` | 30 s |
| ISP, public IP | `internet.get` | 10 min |
| Last speed test time, gauge values | `speedtest.history {limit: 1}` | 10 min, and every 5 s while a test runs |
| Plan speed (gauge max) | `internet.get` (`plan`, user-set) | 10 min |
| Usage hero, series totals, chart | `usage.get {scope: "network", range: "day"}` (or `"week"`) | 5 min |
| By eero share bar | `usage.get {scope: "eero", range}` (no `id`: one series per eero, with totals) | 5 min |
| eero rows | `eero.list` | 60 s |
| eero sparklines | `usage.get {scope: "eero", range: "day"}` (same call as the share bar) | 5 min |
| Top devices | `usage.breakdown {range: "day", by: "device"}`, first 5 | 5 min |
| Top devices names and icons | `device.list` | 30 s |
| Top profiles rows | `profile.list` (pause or schedule state) | 60 s |
| Top profiles ranking and totals | `usage.get {scope: "profile", range: "day"}`, sorted by `total.down + total.up`, first 3 | 5 min |
| Busy heatmap | `usage.get {scope: "network", range: "week", cadence: "hourly"}`; core normalises to 0..1 | 5 min |
| Recent activity | `events.list {limit: 3}` | 60 s |
| Recent activity count | `events.summary {range: "kept"}` | 60 s |

## Actions

| Control | Command | Effect | Confirm | Result |
| --- | --- | --- | --- | --- |
| Share Wi-Fi | `wifi.share` | query | No | Opens the Share Wi-Fi sheet (`features/wifi/ShareSheet.tsx`, shared with Devices): opening it is the ask, so it runs `wifi.share` then and shows the QR code with Copy password and Save QR. The password lives only while the sheet is open |
| Restart network | `network.restart {confirm: true}` | disruptive | Yes, in the confirm dialog | Opens the confirm dialog "Restarts every eero on Maple Street at once. Everyone loses internet for about 2 to 3 minutes." with "Yes, restart network" and Cancel. On run: progress toast, hero status Restarting, faster polling until Online |
| Range dropdown (Data usage) | - (view state; re-queries `usage.get` with the range) | - | No | Chart, hero and share bar switch range |
| Topology → | - | - | No | eeros page |
| eero row | - | - | No | eero detail |
| All devices → | - | - | No | Devices, sorted by data today |
| Top device row | - | - | No | Device detail |
| All profiles → | - | - | No | Profiles page |
| Profile row | - | - | No | Profile detail |
| Heatmap cell | - | - | No | Tooltip only |
| All (Recent activity) | - | - | No | Activity page |
| Activity row | - | - | No | The event's target (device, eero, profile, Updates) |

## States

- **Loading.** Hero shows name and `-` metrics, gauges as empty arcs, usage
  chart as unlabelled gridlines, lists as blank rows at normal height. A
  background refresh keeps the figures as they are; only the topbar Refresh
  icon spins.
- **Empty.** Usage with no data: "No activity in this window." Top devices
  with no data: same sentence. No profiles: "No profiles yet. Group devices
  by person to pause them together." with **Add a profile**. No events: "No
  recent activity."
- **Speed test never run.** Gauges show `-` and "Last speed test" is `-`.
  A test started elsewhere (Internet, Troubleshooting) fades the gauges
  until its result lands.
- **Error.** Per section note with Retry; the hero keeps whatever loaded.
- **Offline (this computer).** Banner from the shell; Restart network
  disabled.
- **Network offline.** Hero status Offline with "last seen ..." in place of
  uptime, a warning note under the hero "Maple Street is not reporting.
  Check the gateway's power and cable." with **Troubleshoot**. Gauges show
  the last result muted. Actions disabled except Share Wi-Fi.
- **Weak link or degraded.** Status from `network.health` (Weak link,
  Slow); hero status line names the cause ("Garage has a weak link") and
  links to eeros.
- **No permission.** Admins see everything here. If `network.restart` is not
  permitted, Restart network is disabled with "Owner only".
- **Capability missing.** No plan speed set: gauge max falls back to the
  best result in history, and the caption's "Set your internet plan" link
  opens the plan sheet.
- **Bridge mode.** Profiles section hidden (columns become eeros, busy
  heatmap, activity); Top devices hidden (no
  per-device usage); bridge note at the top.

## Notes

- `usage.get` gains an optional `cadence: "hourly" | "daily"` param (defaults: day
  range hourly, week range daily) so the heatmap can ask for 7 x 24 hourly
  buckets. Week is the maximum range (free accounts keep about 7 days).
- `usage.get {scope: "eero"}` without an `id` returns all eeros; this needs
  `{net}/data_usage/eeros` and should be verified in the fake server.
- "Busiest hour" and "so far today" are computed in core from the same
  series, in the network time zone. In Week, today's partial day comes from
  today's hours, since eero's daily series stops at yesterday.
- Gauge max is 125% of the plan speed the user set on Internet (stored in
  `settings.json`, see [internet.md](internet.md)), so a result above the
  plan still moves the arc; eero does not know the plan. Without a plan it
  is the best result in history, with no mark or "% of plan" line.
- Live rates are not shown here, so this page never triggers
  `device.rates.refresh`.
