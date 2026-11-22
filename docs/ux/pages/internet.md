# Internet

The WAN side of the network: is the ISP delivering, what addresses are in
use, how speed tests have gone, and how much data crossed the WAN.

Mockup: [../../mockups/02-internet.html](../../mockups/02-internet.html)

Shell, confirmations, states and refresh rules: [../overview.md](../overview.md).
Topbar: title "Internet", nothing after it (freshness is in the Refresh tooltip), no page actions.

## Layout

1. **Hero** (flat, as on Overview: no card, a rule under it). Left:
   - Title is only the provider, the same in every state: eero's ISP name
     ("Ziply Fiber"), else the organisation that owns the public IP (geo IP),
     else "Internet". It never judges ("is fast and steady" was dropped: it
     came from one test and repeated the status line and gauges).
   - Status line: Connected, "Gateway up 23 days, 4 hours · since Oct 20,
     9:41 AM".
   - Facts, label over value as on Overview: Public IP, Plan ("1,200 /
     1,200 Mbps"), Last speed test ("2h ago"). The share of plan is under each
     gauge, so it is not repeated here.
   - Actions: **Run speed test**, **Troubleshoot**, both outline buttons with
     dim icons, in that order in every state. Troubleshoot only navigates but
     reads as an action, so it stays a button (a one-off, not a rule).
   - Right: Download and Upload gauges, as on Overview (plan mark, "% of
     plan" or flame and "% over plan" line).
2. **Connection** section. Description under the title: "Living Room
   gateway (eero Max 7), 10 GbE WAN" (`-` until it loads). Tools: **Copy
   details** (outline, dim icon) and a dim text link **View ISP settings →**
   (Advanced networking). Two cards:
   - **Internet provider** (globe icon, "From geo IP lookup", status "ISP
     up"): ISP, Organization, ASN (mono), Location, Plan ("1,200 Mbps / 1,200
     Mbps", or "Not set") with a small outline button under the value,
     right-aligned: **Change plan…** (or **Set plan…**), opening the plan
     sheet, hence the ellipsis. No "set by you" badge: only the user sets a
     plan. The static "From geo IP lookup" stays: it says where the
     rows come from, which nothing else on screen does.
   - **Addressing** (network icon; subtitle "NAT mode" or "Bridge mode",
     no badge): WAN type
     ("DHCP"; eero sends no lease time), Public IPv4, Public IPv6 and IPv6
     prefix (when IPv6 is off, only the Public IPv6 row, reading "IPv6 is off"), ISP gateway, DNS in use (the servers, then "(ISP auto)" or "(custom)" in muted text, no badge), Double NAT
     (a status: dot plus "Not detected" or "Detected", never coloured text).
   - Offline, both cards show "as of 5m ago" as their subtitle.
3. **Speed test history**. Description under the title: "Since Wed Mar 4,
   100 tests" (eero returns at most 100 tests; "30 days, 12 tests" for
   Month). Range dropdown (`Select`, tool size), "Last month" or "All results" (All results selected); eero keeps about a year of
   tests and runs one only every 1 to 3 days, so a week holds only 2 to 5
   and Day and Week ranges were dropped (#241). Tool: **Export CSV…** (outline, dim icon; the
   ellipsis because it opens the save dialog) of the chosen range, left of
   the dropdown. There is no Earlier tests table: it repeated the chart's points
   (removed in #241; each test's values are in the chart tooltip and the CSV).
   Deep link
   `#/internet/history` opens the page scrolled here (DOM id
   `internet-history`; Overview's "View history"). Side column:
   - "Download" and "921 Mbps (77%)" on one line (the 7-day average; the note
     below says so), the share of
     plan after the value in muted text as on Overview, then a meter of the
     plan. No line under the meter; with no plan, no share and an empty
     meter.
   - "Upload", "904 Mbps (75%)", meter.
   - Rule, then info note: "Values show 7d average. Tests run from the
     gateway to your ISP, so they show what Ziply delivers, not Wi-Fi speed
     in a room."
   - Main chart: one point per test, each marked with a dot (up to 40
     points) so a few tests do not read as a broken line, download and
     upload lines, fixed y
     scale to the plan (`AreaChart max`, nice ticks up to at least the
     plan), x labels "Nov 6", "Nov 9",
     "Today", tooltip per test with date and time.
4. **Data usage** section. Description under the title: the monthly pace,
   the last 7 days' daily average times 30 ("On pace for 14.0 TB a month"),
   for anyone watching an ISP data cap; `-` until it loads. Range dropdown (`Select`, tool size):
   "Last 24 hours" or "Last 7 days". Two cards side by side:
   - **Per hour** (wide): title with the window and total under it ("24
     hours, 463 GB"), like Per day's, and the legend with totals (Download
     351 GB, Upload 61 GB) on the right, the hourly area chart filling the space so it ends
     level with the Per day chart, rule, then stats like Per day's: **Busiest
     hour** ("8 PM 41.0 GB"; "Mon 8 PM ..." on 7 days), **Max down** and
     **Max up** (the largest hour each way). No live rates or Live switch on
     this page (see Notes).
   - **Per day**: title with "7 days, 388 GB a day" under it, legend with
     weekly totals (2.31 TB, 402 GB), stacked daily columns with today
     highlighted, rule, then "Today so far 48.2 GB" and "Busiest day Sat 512 GB" (the
     short weekday only; the date made it too long). Every stat in both cards
     uses the same style (see design-system.md, Dashboard patterns).
5. **By device** and **By profile**, two sections of their own side by side
   (56px below Data usage, like every section), following the Data usage
   range. Each has a description under its title and a dim text link:
   - **By device**: "24 hours, top 5 used 78%" (the share the named rows
     account for), link "View all devices →".
   - **By profile**: "24 hours, 4 profiles, 1 paused" (paused left out when
     none), link "View all profiles →".
   - Columns Down, Up, Share. Device rows have an icon and a 2px bar in the
     device's series colour scaled to the largest row; the last row groups
     the rest ("Others (26)"). Profile rows have the avatar, a muted detail
     ("6 devices", "3 devices · paused", "unassigned") and the bar; "Other
     devices" covers unassigned and is always the last row, like By
     device's Others. Bridge mode hides both sections.

## Data

| Element | Command | Refresh |
| --- | --- | --- |
| Hero verdict, status, uptime, plan line | `internet.get` (connection, uptime, verdict) + `speedtest.history {limit: 1}` | 10 min, every 5 s during a test |
| Gauges | `speedtest.history {limit: 1}` | As above |
| Connection cards (ISP, ASN, location, WAN type, IPv4, IPv6, prefix, ISP gateway, DNS in use, double NAT, NAT or bridge mode) | `internet.get` | 10 min |
| Gateway sub line | `eero.list` (gateway eero, WAN port speed) | 60 s |
| Plan | `internet.get` (`plan` from `settings.json`) | On change |
| Speed test chart, count, Export CSV | `speedtest.history {range: "all", limit: 200}` (or `"month"`) | 10 min, and after a test |
| 7-day averages | `avg7d` of the same read (always the last 7 days) | As above |
| Per hour chart and totals | `usage.get {scope: "network", range: "day"}` | 5 min |
| Per day chart, average, today, busiest day | `usage.get {scope: "network", range: "week", cadence: "daily"}` | 5 min |
| By device | `usage.breakdown {range, by: "device", top: 5}` (Others row folded in core) | 5 min |
| By profile | `usage.breakdown {range, by: "profile"}` | 5 min |

## Actions

| Control | Command | Effect | Confirm | Result |
| --- | --- | --- | --- | --- |
| Run speed test | `speedtest.run` | write | No | Button "Testing..." with a spinner; gauges fade; progress toast "Testing internet speed" until the result appears (about a minute), then "Speed test: 941 Mbps down, 917 Mbps up"; hero and chart update. The same control and toast on Troubleshooting |
| Troubleshoot | - | - | No | Troubleshooting page |
| Copy details | `internet.get {format: "text"}` | query | No | Copies a plain-text block of both cards (formatted in core); toast "Connection details copied" |
| ISP settings → | - | - | No | Advanced networking, WAN section |
| Set plan… / Edit plan… (the plan line under the gauges, 12px under them as on Overview, the Connection card's Change plan… button; Overview "Set your internet plan") | `internet.plan.set {down, up, label?}` or `{clear: true}` | write | No | Plan sheet: Download and Upload (Mbps) and an optional name; Save toasts "Plan set to 1.2 Gbps down, 1.2 Gbps up" with Undo; Remove plan (asks inline) toasts "Plan removed" with Undo; gauges, meters and verdicts recompute |
| Month / All (speed tests) | - (re-queries `speedtest.history`) | - | No | Chart, count and Export CSV switch range; averages stay 7-day |
| Export CSV | `speedtest.history {range, format: "csv"}` | query | No | Host save dialog (`window.mesh.saveFile`), file `speed-tests-maple-street-2026-11-12.csv`; the button reads "CSV saved" for a moment, or "Couldn't save" with eero's or the host's message as its tooltip |
| Day / Week (data usage) | - (re-queries `usage.get`, `usage.breakdown`) | - | No | Both cards and tables switch |
| Device in "Using the most" or By device | - | - | No | Device detail |
| All devices → | - | - | No | Devices sorted by data today |
| Profile row, Profiles → | - | - | No | Profile detail, Profiles |

## States

- **Loading.** Cards show labels with `-` values; charts show placeholder
  gridlines; tables keep their header.
- **Empty.** No speed tests yet: chart area says "No speed tests in this
  window." and the Last speed test fact shows "-". No usage: "No
  activity in this window."
- **Test running.** Only one at a time per network; the button reads
  "Testing..." and stays disabled until the result lands or 3 minutes pass,
  then the toast turns into "Speed test did not finish". A test started
  elsewhere in the app (the palette, before a reload) shows the same way:
  `speedtest.history` reports it as `running`.
- **Error.** Per card or section note with Retry.
- **Offline (this computer).** Shell banner; Run speed test disabled.
- **Network offline / internet down.** Hero title stays "Ziply Fiber",
  status Down with "since 2:17 AM"; Connection cards keep the last values
  muted with "as of"; Run speed test disabled; the buttons keep their places and style (the Down status draws the eye).
- **No permission.** Admins can run tests. `internet.plan.set` is app-local
  and always allowed.
- **Capability missing.** No IPv6: IPv6 rows show `-` with "IPv6 is off"
  and a link to Advanced networking. Geo IP lookup missing: ISP card shows
  "-" and drops the Organization and ASN rows.
- **Bridge mode.** Badge "Bridge mode" replaces "NAT mode"; Double NAT row is
  hidden; DNS row shows what the upstream router hands out if eero reports
  it, else `-`. By device and By profile are
  hidden (no per-device data in bridge mode). Speed tests still work.

## Notes

- Added commands and params (now in the [catalogue](../../architecture/commands.md#internet-speed-tests-and-usage-commandsinternetts)):
  - `internet.plan.set` (write, app-local): stores the plan speed per
    network in `settings.json` so the CLI and Overview gauges agree. Lives in
    `src/core/commands/internet.ts`.
  - `internet.get {format?: "json" | "text"}` for Copy details.
  - `speedtest.history {range?: "week" | "month" | "all", limit?,
    format?: "json" | "csv"}`.
  - `device.list {sort?, limit?}` (also used by Devices).
- eero runs automatic tests every one to three days; manual tests use about
  30 s of WAN bandwidth and the result appears about a minute after
  `POST {net}/speedtest`.
- Speed tests measure gateway to ISP, never room Wi-Fi; the info note says
  so. The verdict thresholds (Great at 75% of plan or better, Below plan
  under 75%, Poor under 40%) live in core.
- Double NAT detection: true when the WAN address is private (RFC 1918 or
  CGNAT 100.64/10). Core computes it from `internet.get`.
- No live rates on this page: By device and By profile already show who
  used the most, and the charts refresh on the usage poll (every 5 min), so
  there is no Live switch here.
- Usage history is limited to about 7 days for free accounts, so Data usage
  has no Month range. Speed tests are not: a read-only check (#241) found
  about a year of tests (100 returned, the oldest 382 days old).
- Built in M4.9: Run speed test (here and Troubleshooting share
  one runner and toast) and the plan sheet. The plan sheet opens from the
  plan line under the gauges and the Connection card's Plan row. Built in M2.4: there was no toast yet, so Copy details and Export CSV confirm on the button
  ("Details copied", "CSV saved"). The Per day card always shows the last 7
  days (one bar for Day would say nothing); the Day / Week toggle switches the
  Per hour chart and both tables. Since M3.2 the speed test chart scales to
  the plan (`AreaChart max`), or to the results when no plan is set.
- Open question: "Gateway up ... since Oct 20, 9:41 AM" uses the gateway's
  `last_reboot`; WAN uptime might differ from gateway uptime if the ISP link
  dropped without a reboot. Show gateway uptime and label it as such.
