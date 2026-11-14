# Internet

The WAN side of the network: is the ISP delivering, what addresses are in
use, how speed tests have gone, and how much data crossed the WAN.

Mockup: [../../mockups/02-internet.html](../../mockups/02-internet.html)

Shell, confirmations, states and refresh rules: [../overview.md](../overview.md).
Topbar: title "Internet", subtitle freshness, no page actions.

## Layout

1. **Hero** (card). Left:
   - Title is a one-line verdict built in core from the latest tests and
     plan: "Ziply Fiber is fast and steady" (other forms: "Ziply Fiber is
     slower than your plan", "Ziply Fiber is down").
   - Status line: Connected, "Gateway up 23 days, 4 hours · since Oct 20,
     9:41 AM".
   - Muted line: "Last test 2 hours ago hit 78% of your 1.2 Gbps plan".
   - Actions: **Run speed test** (primary), **Troubleshoot** (ghost).
   - Right: Download and Upload gauges, as on Overview.
2. **Connection** section. Sub: "Gateway: Living Room (eero Max 7), WAN port
   10 GbE". Tools: **Copy details**, **ISP settings →**. Two cards:
   - **Internet provider** (globe icon, "From geo IP lookup", status "ISP
     up"): ISP, Organisation, ASN (mono), Location, Plan ("Fiber Gig 1.2
     Gbps" with a "set by you" badge).
   - **Addressing** (network icon, "WAN address and DNS in use", "NAT mode"
     badge): WAN type ("DHCP"; eero sends no lease time), Public IPv4, Public IPv6,
     IPv6 prefix, ISP gateway, DNS in use (with "ISP auto" badge), Double NAT
     ("Not detected" in success colour).
3. **Speed test history**. Sub: "Last 7 days · 15 tests · automatic test
   every 1 to 3 days". Day / Week toggle (Week selected). Side column:
   - Download, 7-day average "921 Mbps", a meter of the plan, "77% of plan".
   - Upload, 7-day average "904 Mbps", meter, "75% of plan".
   - Rule, then info note: "Tests run from the gateway to your ISP, so they
     show what Ziply delivers, not Wi-Fi speed in a room."
   - Main chart: one point per test, download and upload lines, fixed y
     scale to the plan (`AreaChart max`, nice ticks up to at least the
     plan), x labels "Nov 6", "Nov 9",
     "Today", tooltip per test with date and time.
4. **Earlier tests** table. Sub "Before the latest result above". Tool:
   **Export CSV**. Columns: When, Download (value plus meter of plan), Upload
   (same), verdict (Great, Below plan in text colour). Values well below plan
   use the warning text colour.
5. **Data usage** section. Sub: "Internet (WAN) traffic only, local
   transfers excluded". Day / Week toggle. Two cards side by side:
   - **Per hour** (wide): legend with totals (Download 351 GB, Upload 61 GB),
     hourly area chart, rule, then **Using the most right now** ("current rate
     · refreshed every minute"): a 3-column grid of up to 6 devices with icon,
     name, eero and band ("Living Room · 5 GHz", "Wired"), and the current
     download rate in Mbps, `-` when idle.
   - **Per day**: "avg 388 GB / day", legend with weekly totals (2.31 TB,
     402 GB), stacked daily columns with today highlighted, rule, then "Today
     so far 48.2 GB" and "Busiest day Sat Nov 8 · 512 GB".
   - Below, two tables: **By device** (24h, "All devices →") and **By
     profile** (24h, "Profiles →"). Columns Down, Up, Share. Device rows have
     an icon and a 2px bar in the device's series colour scaled to the
     largest row; the last row groups the rest ("Others (26)"). Profile rows
     have the avatar, a muted detail ("6 devices", "3 devices · paused",
     "unassigned") and the bar; "Other devices" covers unassigned.

## Data

| Element | Command | Refresh |
| --- | --- | --- |
| Hero verdict, status, uptime, plan line | `internet.get` (connection, uptime, verdict) + `speedtest.history {limit: 1}` | 10 min, every 5 s during a test |
| Gauges | `speedtest.history {limit: 1}` | As above |
| Connection cards (ISP, ASN, location, WAN type, IPv4, IPv6, prefix, ISP gateway, DNS in use, double NAT, NAT or bridge mode) | `internet.get` | 10 min |
| Gateway sub line | `eero.list` (gateway eero, WAN port speed) | 60 s |
| Plan | `internet.get` (`plan` from `settings.json`) | On change |
| Speed test chart, averages, count, table | `speedtest.history {range: "week"}` (or `"day"`) | 10 min, and after a test |
| Per hour chart and totals | `usage.get {scope: "network", range: "day"}` | 5 min |
| Using the most right now | `device.rates.refresh` then `device.list {sort: "rate", limit: 6}` | 60 s while visible |
| Per day chart, average, today, busiest day | `usage.get {scope: "network", range: "week", cadence: "daily"}` | 5 min |
| By device | `usage.breakdown {range, by: "device", top: 5}` (Others row folded in core) | 5 min |
| By profile | `usage.breakdown {range, by: "profile"}` | 5 min |

## Actions

| Control | Command | Effect | Confirm | Result |
| --- | --- | --- | --- | --- |
| Run speed test | `speedtest.run` | write | No | Button "Testing..." with a spinner; gauges fade; progress toast "Testing internet speed" until the result appears (about a minute), then "Speed test: 941 Mbps down, 917 Mbps up"; hero, chart and table update. The same control and toast on Overview and Troubleshooting |
| Troubleshoot | - | - | No | Troubleshooting page |
| Copy details | `internet.get {format: "text"}` | query | No | Copies a plain-text block of both cards (formatted in core); toast "Connection details copied" |
| ISP settings → | - | - | No | Advanced networking, WAN section |
| Set plan / Edit plan (the plan line under the gauges; Overview "Set your plan") | `internet.plan.set {down, up, label?}` or `{clear: true}` | write | No | Plan sheet: Download and Upload (Mbps) and an optional name; Save toasts "Plan set to 1.2 Gbps down, 1.2 Gbps up" with Undo; Remove plan (asks inline) toasts "Plan removed" with Undo; gauges, meters and verdicts recompute |
| Day / Week (speed tests) | - (re-queries `speedtest.history`) | - | No | Chart and averages switch range |
| Export CSV | `speedtest.history {range, format: "csv"}` | query | No | Host save dialog (`window.mesh.saveFile`), file `speed-tests-maple-street-2026-11-12.csv`; the button reads "CSV saved" for a moment, or "Couldn't save" with eero's or the host's message as its tooltip |
| Day / Week (data usage) | - (re-queries `usage.get`, `usage.breakdown`) | - | No | Both cards and tables switch |
| Device in "Using the most" or By device | - | - | No | Device detail |
| All devices → | - | - | No | Devices sorted by data today |
| Profile row, Profiles → | - | - | No | Profile detail, Profiles |

## States

- **Loading.** Cards show labels with `-` values; charts show placeholder
  gridlines; tables keep their header.
- **Empty.** No speed tests yet: chart area says "No speed tests in this
  window." and the hero line reads "No speed test yet". No usage: "No
  activity in this window."
- **Test running.** Only one at a time per network; the button reads
  "Testing..." and stays disabled until the result lands or 3 minutes pass,
  then the toast turns into "Speed test did not finish". A test started
  elsewhere in the app (the palette, before a reload) shows the same way:
  `speedtest.history` reports it as `running`.
- **Error.** Per card or section note with Retry.
- **Offline (this computer).** Shell banner; Run speed test disabled;
  "Using the most right now" shows "Live rates need a connection to eero".
- **Network offline / internet down.** Hero title "Ziply Fiber is down",
  status Down with "since 2:17 AM"; Connection cards keep the last values
  muted with "as of"; Run speed test disabled; Troubleshoot becomes primary.
- **No permission.** Admins can run tests. `internet.plan.set` is app-local
  and always allowed.
- **Capability missing.** No IPv6: IPv6 rows show `-` with "IPv6 is off"
  and a link to Advanced networking. Geo IP lookup missing: ISP card shows
  "-" and drops the Organisation and ASN rows.
- **Bridge mode.** Badge "Bridge mode" replaces "NAT mode"; Double NAT row is
  hidden; DNS row shows what the upstream router hands out if eero reports
  it, else `-`. "Using the most right now" and both breakdown tables are
  hidden (no per-device data in bridge mode). Speed tests still work.

## Notes

- Added commands and params (now in the [catalogue](../../architecture/commands.md#internet-speed-tests-and-usage-commandsinternetts)):
  - `internet.plan.set` (write, app-local): stores the plan speed per
    network in `settings.json` so the CLI and Overview gauges agree. Lives in
    `src/core/commands/internet.ts`.
  - `internet.get {format?: "json" | "text"}` for Copy details.
  - `speedtest.history {range?: "day" | "week", limit?, format?: "json" |
    "csv"}`.
  - `device.list {sort?, limit?}` (also used by Devices).
- eero runs automatic tests every one to three days; manual tests use about
  30 s of WAN bandwidth and the result appears about a minute after
  `POST {net}/speedtest`.
- Speed tests measure gateway to ISP, never room Wi-Fi; the info note says
  so. The verdict thresholds (Great at 75% of plan or better, Below plan
  under 75%, Poor under 40%) live in core.
- Double NAT detection: true when the WAN address is private (RFC 1918 or
  CGNAT 100.64/10). Core computes it from `internet.get`.
- "Using the most right now" needs a burst report; it shares the Devices
  page's once-a-minute `device.rates.refresh` budget, so two visible views
  never burst twice.
- Usage history is limited to about 7 days for free accounts, so there is
  no Month range.
- Built in M4.9: Run speed test (here, Overview and Troubleshooting share
  one runner and toast) and the plan sheet. The plan sheet opens from the
  plan line under the gauges; the Connection card's Plan row still only
  shows the value. Built in M2.4: there was no toast yet, so Copy details and Export CSV confirm on the button
  ("Details copied", "CSV saved"). The Per day card always shows the last 7
  days (one bar for Day would say nothing); the Day / Week toggle switches the
  Per hour chart and both tables. Since M3.2 the speed test chart scales to
  the plan (`AreaChart max`), or to the results when no plan is set.
- Open question: "Gateway up ... since Oct 20, 9:41 AM" uses the gateway's
  `last_reboot`; WAN uptime might differ from gateway uptime if the ISP link
  dropped without a reboot. Show gateway uptime and label it as such.
