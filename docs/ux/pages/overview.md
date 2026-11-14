# Overview

The landing page: is the network healthy, how fast is it, who is using it, and
what changed recently.

Mockup: [../../mockups/01-overview.html](../../mockups/01-overview.html)

Shell, confirmations, states and refresh rules: [../overview.md](../overview.md).
Topbar: title "Overview", subtitle freshness ("Updated just now"), no page
actions.

## Layout

1. **Status hero** (card). Left column:
   - Network name ("Maple Street") as the title.
   - Status line: Online status and "Gateway up 23 days, 4 hours".
   - Metric row: ISP ("Ziply Fiber"), Public IP ("203.0.113.48"), Last
     speed test ("2h ago"), all three values in the same type so they share a
     baseline.
   - Action row: **Run speed test** (primary), **Share Wi-Fi**, **Pause a
     profile**, **Restart network** (ghost).
   - Right side: two speed gauges, Download and Upload, each a 240 degree arc
     on the plan max (1.2 Gbps) with the latest result in the middle ("942
     Mbps", "918 Mbps") in the download and upload series colours.
2. **Data usage** section. Header: "Data usage", sub "Per hour, last 24 hours,
   all devices" on the heading's baseline, Day / Week toggle. Switching range
   crossfades the subtitle and body (150 ms out, swap, 150 ms in, opacity
   only, none with reduced motion); background polls never crossfade. Body is
   a side column plus main chart:
   - Hero figure "412 GB" with "used in 24h · busiest hour 12 to 1 PM" and
     "48.2 GB so far today".
   - Series list: Download (arrow icon in series colour, "351 GB", "85% of
     traffic") and Upload ("61 GB", "15%").
   - Rule, then **By eero**: a share bar split by eero (Living Room, Office,
     Upstairs Hall, Garage) with tooltips "Living Room · 212 GB · 51%" and a
     legend with percentages.
   - Main chart: download and upload per hour, line plus soft area, hover
     tooltip with a Total row.
3. Two columns:
   - **eeros**. Header link "Topology →". One row per eero: icon (router, or
     lamp for a Beacon) and three lines: the name followed by a Gateway badge;
     model · backhaul type; status (Online, Weak link, Offline), mesh bars for
     wireless, device count. A 24 h usage sparkline in that eero's series
     colour sits right of lines 2 and 3 (never beside the name), the same
     width in every row, up to 110 px; it narrows before the text does and
     hides below 40 px.
   - **Top devices**. Sub "Data used, 24h · 31 online now", link "All devices
     →". Table of the top 5: rank, device icon and name with a thin bar scaled
     to the top device, Down and Up (Up muted).
4. Three columns:
   - **Profiles**, link "Manage". One row per profile: avatar initial in the
     profile colour, name, a detail line ("6 devices · 96 GB today", "Bedtime
     9:00 PM to 7:00 AM", "Paused 25 min ago"), status (Active, Scheduled,
     Paused).
   - **When the network is busy**, sub "This week". A 7 x 24 heatmap (Mon to
     Sun by hour) in one series colour, intensity by share of the week's peak
     hour; hour labels every 6 hours; cell tooltip "Mon 20:00 · 78%".
   - **Recent activity**, link "All". The latest 3 events with icon, one line
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
| "31 online now" | `device.list` summary (`online`) | 30 s |
| Profiles rows | `profile.list` (with today's usage and current pause or schedule state) | 60 s |
| Busy heatmap | `usage.get {scope: "network", range: "week", cadence: "hourly"}`; core normalises to 0..1 | 5 min |
| Recent activity | `events.list {limit: 3}` | 60 s |

## Actions

| Control | Command | Effect | Confirm | Result |
| --- | --- | --- | --- | --- |
| Run speed test | `speedtest.run` | write | No | Button reads "Testing..." and gauges fade to 40%; after about a minute the new result lands and "Last speed test" reads "Just now". Toast "Speed test: 942 down / 918 up Mbps" |
| Share Wi-Fi | - then `wifi.share` | query | No | Opens the Wi-Fi page, whose QR block runs `wifi.share` on Show code (QR, Copy password, Save QR). A Share Wi-Fi sheet shared with Devices is later work |
| Pause a profile | `profile.list` then `profile.pause {profile}` | write | No | A menu of the profiles not yet paused (name and device count; "Every profile is paused", or a link to Profiles when there are none); picking one pauses it and toasts "Paused Leo" with Undo (`profile.resume`). Dims by the `profiles` permission |
| Restart network | `network.restart {confirm: true}` | disruptive | Yes, inline | Reveals the inline note "Everyone loses internet for about 2 to 3 minutes, including every connected device and any calls in progress." with "Yes, restart network" and Cancel. On run: progress toast, hero status Restarting, faster polling until Online |
| Day / Week (Data usage) | - (view state; re-queries `usage.get` with the range) | - | No | Chart, hero and share bar switch range |
| Topology → | - | - | No | eeros page |
| eero row | - | - | No | eero detail |
| All devices → | - | - | No | Devices, sorted by data today |
| Top device row | - | - | No | Device detail |
| Manage (Profiles) | - | - | No | Profiles page |
| Profile row | - | - | No | Profile detail |
| Heatmap cell | - | - | No | Tooltip only |
| All (Recent activity) | - | - | No | Activity page |
| Activity row | - | - | No | The event's target (device, eero, profile, Updates) |

## States

- **Loading.** Hero shows name and `-` metrics, gauges as empty arcs, usage
  chart as unlabelled gridlines, lists as blank rows at normal height. Figures
  fade to 40% on slow refresh.
- **Empty.** Usage with no data: "No activity in this window." Top devices
  with no data: same sentence. No profiles: "No profiles yet. Group devices
  by person to pause them together." with **Add a profile**. No events: "No
  recent activity."
- **Speed test never run.** Gauges show `-`, "Last speed test" is `-`, and
  the primary button stays Run speed test.
- **Error.** Per section note with Retry; the hero keeps whatever loaded.
- **Offline (this computer).** Banner from the shell; Run speed test, Pause a
  profile and Restart network disabled.
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
  best result in history, and a small "Set your plan" link goes to Internet.
- **Bridge mode.** Profiles section hidden (columns become eeros, busy
  heatmap, activity); "Pause a profile" hidden; Top devices hidden (no
  per-device usage); bridge note at the top.

## Notes

- `usage.get` gains an optional `cadence: "hourly" | "daily"` param (defaults: day
  range hourly, week range daily) so the heatmap can ask for 7 x 24 hourly
  buckets. Week is the maximum range (free accounts keep about 7 days).
- `usage.get {scope: "eero"}` without an `id` returns all eeros; this needs
  `{net}/data_usage/eeros` and should be verified in the fake server.
- "Busiest hour" and "so far today" are computed in core from the same
  series, in the network time zone.
- Gauge max is the plan speed the user set on Internet (stored in
  `settings.json`, see [internet.md](internet.md)); eero does not know the
  plan.
- "Pause a profile" is a small menu of profiles rather than the palette:
  one click picks and pauses, and the Undo toast is the same as on Profiles.
- Live rates are not shown here, so this page never triggers
  `device.rates.refresh`.
