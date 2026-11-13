# Troubleshooting

A health check, guided diagnostics by symptom, coverage and upgrade reports, radio state, and the fixes and restarts people reach for when something is wrong.

Mockup: [../../mockups/16-troubleshooting.html](../../mockups/16-troubleshooting.html)

Shared patterns (hero, section cards, status, inline confirms) are described in [../overview.md](../overview.md).

## Layout

Breadcrumb `Settings / Troubleshooting`, subtitle `Last health check 2 min ago`.

1. **Health check hero.** Left: a score ring (`86`, "Health") with status summary under it (`Good`, `1 warning`). Right: title "Network health check", sub line "8 checks across internet, DNS, eeros, mesh links and firmware.", **Run again** (primary). A grid of checks, each with a pass or warning mark, icon, name and value: Internet (ISP up, last speeds), DNS resolution, one row per eero (gateway shows the WAN link), Mesh links (warning: "Garage 2 bars to Office"), Firmware (current version and next update). Under it, "Something specific?" chips: **My connection drops**, **My internet is slow**, **My internet is offline**, **My eero's light is red**.
2. **Tools.** Rows: **Run speed test** ("Uses the WAN for about 30 s") with **History** link and **Run**; **Find an eero** with an eero select and **Blink light**.
3. Two columns:
   - **Coverage scan** ("Scanned today 1:05 PM"), **Scan again**, legend Poor / Fair / Good / Strong. Placement advice note when needed ("Adjust eero placement. Garage sits too far from Office..."). Table of rooms: room, link quality as 5 cells (1 to 5), device count, eero serving it.
   - **Upgrade report** ("Wi-Fi generation scan"): donut of devices by Wi-Fi generation (7, 6E, 6, 5, 4 or older) with a legend of counts; findings (how many eeros are Wi-Fi 7, which eero limits which devices, 2.4 GHz only devices that are fine); an info note with the upgrade suggestion.
4. **Radio channels** ("Current radio state per eero · auto channel selection"). Table: eero (name, model), 2.4 GHz, 5 GHz low, 5 GHz high, 6 GHz (each cell: channel, width, a busy meter and percent; `-` or "No 6 GHz radio" when absent), Clients. Footnote: channels are chosen by eero and read only.
5. **Fixes** ("Temporary modes and restarts"), a grid of tool cards:
   - **Connect 2.4 GHz only devices** (`Disruptive`): a muted line "eero brings 5 and 6 GHz back on its own when the window ends" (eero picks the length; there is no duration choice). When active: countdown timer to eero's end time, progress meter, "5 and 6 GHz paused · 22 devices moved to 2.4 GHz · restores at 3:12 PM", a list "Joined during this window" (new devices with band, eero, time, `New`), a waiting row, **Restore now** and "Started 3 min ago".
   - **Connect devices that can't detect Wi-Fi 6**: switch, warning note (may reduce speeds, restarts the network for about 2 to 3 minutes), status and devices that may need it, **Turn on legacy mode**.
   - **Status light colors**: reference list of LED states and meanings (solid white, blinking white, blinking blue, solid blue, solid green, solid red, off).
   - **Restart a single eero**: one row per eero with **Restart**; the gateway row warns "takes network offline"; an eero with wireless children notes "Garage restarts too".
   - **Restart network** (`Disruptive`): shown with its inline confirm open: "Restart all eeros? Maple Street will be offline for about 2 to 3 minutes. 31 devices will disconnect, including this computer if it is on Wi-Fi." **Cancel** and **Restart network**; "Last restart Nov 11, 3:01 AM (firmware update)".
   - **Get help**: Support center, Email support (external links), Call eero and ISP support numbers, **Support ID** with **Copy**, **Copy diagnostics report**.

## Data

| Element | Command | Refresh |
| --- | --- | --- |
| Score, status summary, checks grid | `health.check` | on load, on Run again; cached result shown with its age |
| Symptom results | `diagnostics.run` `{symptom}` | on demand |
| Find an eero select | `eero.list` | on load |
| Coverage rooms and advice | `coverage.scan` | on load (last result), on Scan again |
| Upgrade report | `coverage.upgrade_report` | on load |
| Radio channels table | `eero.list` (radio stats per band) | every 60 s |
| 2.4 GHz mode state and countdown | `wifi.get` (`hide5g` with expiry) | every 15 s while active |
| Joined during this window | `device.list` `{firstSeenSince}` (start of the window) | every 15 s while active |
| Legacy mode state, devices that may need it | `settings.get` (legacy mode), `coverage.upgrade_report` | on load |
| Restart rows, downstream eeros, last restart | `eero.list`, `events.list` `{type: "eero_status"}` | on load |
| Device count in the restart confirm | `network.get` | on load |
| Support contacts, ISP number, Support ID | `support.info` | on load |
| Diagnostics report text | `support.report` | on demand |

## Actions

| Control | Command | Effect | Confirm | Result |
| --- | --- | --- | --- | --- |
| Run again | `health.check` | query | no | Checks refresh; subtitle time resets |
| Symptom chip | `diagnostics.run` `{symptom: "connection_drops" or "internet_slow" or "internet_offline" or "eeros_red"}` | write | no | Panel under the chips with eero's findings and suggested next steps |
| Run (speed test) | `speedtest.run` | write | no | Row shows progress, then down and up Mbps |
| History | none (navigation) | | | Internet page speed test history |
| Blink light | `eero.find` `{eero}` | write | no | LED cycles for 30 s |
| Scan again | `coverage.scan` `{refresh: true}` | query | no | Table and advice update |
| Start 2.4 GHz mode | `wifi.hide5g.set` `{enabled: true}` | disruptive | inline confirm with device count | Timer starts |
| Restore now | `wifi.hide5g.set` `{enabled: false}` | disruptive | short inline confirm ("Bring back 5 and 6 GHz now?") | 5 and 6 GHz come back |
| Legacy mode switch, Turn on legacy mode | `settings.legacy_mode.set` `{enabled}` | disruptive | inline confirm (outage from `settings.impact`, about 2 to 3 min) | |
| Restart (single eero) | `eero.restart` `{eero}` | disruptive | inline confirm; gateway confirm says the whole network goes offline | Row shows "Restarting" until the eero is back |
| Restart network | `network.restart` | disruptive | inline confirm (shown open in the mockup) | Network offline; page waits and refetches |
| Support center, Email support | none | | | Opens eero support pages externally |
| Support ID Copy | none | | | Copies the ID |
| Copy diagnostics report | `support.report` | query | no | Report text on the clipboard |

## States

- **Loading:** score ring empty with `-`; checks show placeholders; cached last result shown faded with its age if available.
- **All good:** score ring in the success colour, `Good`, no warning pill.
- **Warnings or failures:** failing checks use the warning or danger foreground; the hero summary counts them; each failing check links to its fix (mesh link to coverage, firmware to [Updates & admins](updates-admins.md)).
- **Network offline:** Internet check fails, score drops, the offline symptom chip is highlighted; restarts and blink still go through the cloud and may fail with `eero_error`.
- **2.4 GHz mode active:** card shows the countdown; the Wi-Fi page and sidebar show a small "5 and 6 GHz paused" notice.
- **Empty:** coverage never scanned shows "No scan yet" and **Scan now**.
- **Error:** inline note per card with **Retry**.
- **Capability missing:** coverage and upgrade reports need the 2.4 API; if they fail with 404, hide those sections. 6 GHz columns show "No 6 GHz radio" per eero.
- **Bridge mode:** everything here still applies.
- **No permission:** restarts and modes hidden if `network.permissions` denies them.

## Notes

- `health.check` is composite and built in core from `network.get` (health), `eero.list`, `updates.get` and the last speed test; the score formula lives in core so the CLI and MCP get the same number.
- `diagnostics.run` posts to `{net}/diagnostics` with a symptom, then reads `GET {net}/diagnostics` until it has results.
- Coverage scan and upgrade report are `GET /2.4/networks/{id}/placement/...`; they read only but may take a while, so show progress.
- Busy percent comes from `radio_channel_stats.channel_utilization` on each eero, a current value that free accounts get. Historical channel analytics (`channel_utilization` endpoint) is an eero Plus feature and is not used.
- The 2.4 GHz mode uses the temporary `hide_5g` flag, which auto expires. `wifi.hide5g.set` is disruptive (it moves every 5 and 6 GHz client) and takes no duration: eero sets the end time itself (`temporary_flags.hide_5g.expires_on`, `hide5g.expiresAt` in the model), which drives the countdown, and the engine keeps no timer. Open question: whether the flag also hides 6 GHz (MANUAL check).
- Legacy mode is `{net}/ac_compat`, command `settings.legacy_mode.set` d, separate from `settings.connection_mode.set` (NAT, bridged or IP passthrough).
- Outage estimates come from core (`settings.impact`, see [commands.md](../../architecture/commands.md#restart-estimates)): about 2 to 3 minutes for a network restart and legacy mode, about 1 minute for a leaf eero, about 8 minutes for DNS, DHCP, WAN and connection mode writes on [Advanced networking](advanced-networking.md).
- The diagnostics report never contains the session token, and `support.report` redacts MACs, IPs, names and serials to their last four characters (see [commands.md](../../architecture/commands.md#diagnostics-commandsdiagnosticsts)), so it is safe to paste into a support chat.
- Status light colours are static reference copy.
- Commands added: `support.report` q, `settings.legacy_mode.set` d.
