# Signal

How well the wireless devices are connected right now: signal per band, the weakest connections, how well each eero covers its room, Wi-Fi generations in use and supported, link speeds and how busy each eero's radios are. Sidebar: **Signal** in the Network group, between Profiles and Activity (route `#/signal`, icon `Signal`). Added 2026-11-20 as Wi-Fi health, renamed Signal 2026-11-21 so it reads apart from Wi-Fi network.

Most figures come from one command, `wifi.health`, which core works out from the device and eero lists the app already reads: no requests of its own. It is a snapshot, refreshed with the device poll (60 s). eero keeps channel utilisation history for eero Plus only, which Mesh UI does not support, so there is no history here.

Shared patterns (flat hero, sections, share bars, footnotes) are described in [../overview.md](../overview.md) and the [design system](../../design/design-system.md).

## Layout

1. **Hero** (the flat page header, no icon tile).
   - Title: the wireless device count (`27 wireless devices`; `Signal` while loading). Counts connected wireless devices that report a signal.
   - Status line: a warning `3 weak connections` when any device is below -75 dBm, else a success `Every connection good` (or `No weak connections` with fair ones), then `3 fair` muted.
   - Facts: **Median signal** (`-63 dBm · good`), **Weakest device** (`Flaky Plug · -85 dBm`), **Busiest radio** (`Living Room · 2.4 GHz · 34%`), **Wi-Fi 6 or newer** (`67%`).
   - Right-hand column, **Signal spread** (`w-[28rem]`, like Activity's Events over time): title, subtitle `Devices per 5 dBm, median -63 dBm`, then bare columns (no gridlines, no Y labels, 2px stubs for empty buckets) of devices per 5 dBm from -90 to -40 dBm (ends open), each bar in its quality's colour. Hover: the dBm range and the count.
2. **Signal quality**, subtitle `Median -63 dBm, 3 devices weak`. One row per band in a card: the band (its colour square), a share bar of its devices by quality, and `median -64 dBm`. One legend under the card: colour square, **Excellent (-55 dBm or better)**, **Good**, **Fair**, **Weak (below -75 dBm)**, each with the network-wide count.
3. **Weakest connections**, subtitle `3 devices below -75 dBm, most on Garage` (`None below -75 dBm` when none). A table of the five weakest wireless devices, weakest first: Device (links to its page), Band (band badge), eero, Signal (dBm and the signal bars used on Devices).
4. **Coverage**, subtitle `4 rooms, scanned 2m ago` (with `1 poor` when one is; zero counts are left out) (`Scanning...` while it runs), **Scan again** (outline, `Scan now` before the first scan) on the right. eero's coverage scan: how well each eero reaches the mesh. eero's placement advice, when it has some, leads the card. A table: Room, Link (5 cells, 1 to 5, in the rating's status colour), Devices, Served by (the eero it links through, `Gateway` for the gateway), Placement (**Test** per room, not for the gateway; then the rating as a status, eero's advice in its tooltip). Legend under the card: Poor (destructive), Fair (warning), Good (success, softened) and Strong (success), each its own marker. Moved from Troubleshooting 2026-11-21.
5. **Wi-Fi generations** (left) beside **Upgrade report** (right), stacked on narrow windows: what devices are connected with now beside what they could use.
   - Wi-Fi generations, subtitle `67% connected with Wi-Fi 6 or newer`: a share bar with its legend of Wi-Fi 7, 6E, 6, 5 and 4 (and Unknown when a device does not say), from each device's current link.
   - Upgrade report, subtitle `50% support Wi-Fi 6 or newer`: eero's Wi-Fi generation scan, the newest generation each device supports, as a share bar with its legend in the same colours (Wi-Fi 4 reads `Wi-Fi 4 or older`). Under a divider: the eeros that hold devices back (`Garage · No 6 GHz radio`); eero's notes, which explain the figures, are a footnote under the card. Moved from Troubleshooting 2026-11-21, where it was a donut.
6. **Link speed**, subtitle `Best 2.4 Gbps, on 6 GHz`: a table (rows highlight on hover, as every table's do) of each band's median and best link speed (eero to device).
7. **Radios**, subtitle `Busiest: Living Room 2.4 GHz at 34%`. A table, one row per eero (name, model muted under it), a column per band, then Devices. Each band cell is the channel utilisation (`34%`) with the channel and width muted beside it (`ch 36 · 80 MHz`), tinted in the band's colour in proportion to the figure (a heatmap); an eero with 5 GHz low and high radios shows both, stacked; `-` where the eero has no radio on that band. The tooltip adds the radio's devices and transmit power. Footnote: how busy each radio's channel is right now, refreshed every minute; eero picks the channels and keeps a history only for eero Plus. Replaces Airtime by eero and Troubleshooting's Radio channels (2026-11-21); the Auto channel column was dropped, since eero never reports it.

## Data

| Element | Command | Refresh |
| --- | --- | --- |
| Hero, Signal quality, Weakest connections, Wi-Fi generations, Link speed, Radios | `wifi.health` `{}` (`WifiHealth`) | every 60 s (topic `devices`) |
| Coverage rooms and advice | `coverage.scan` | on load (last result), on Scan again |
| Upgrade report | `coverage.upgrade_report` | on load |
| eero names, models and status for Coverage and the Upgrade report | `eero.list` | shared cache |

`wifi.health` reads `device.list` and `eero.list` through the backend (shared with every other page that reads them) and is in the [catalogue](../../architecture/commands.md). Quality cut-offs are `SIGNAL_DBM` in `src/core/commands/wifi.ts` (-55, -65, -75 dBm): common rules of thumb, not eero's own; eero's 0 to 5 bars are kept beside them in the weakest table.

## Actions

| Control | Command | Effect | Confirm | Result |
| --- | --- | --- | --- | --- |
| Weakest connections device name | none (navigation) | | | Opens the device page |
| Scan again | `coverage.scan` `{refresh: true}` | query | no | Subtitle and button say "Scanning...", the table fades, then table and advice update |
| Test (coverage row) | `eero.placement.test` `{eero}` | write | no | Row says "Testing..." (up to a minute), then the rating as a status; advice in its tooltip. Not offered for the gateway |

Only the placement test changes anything (it asks eero to measure; nothing goes offline).

## States

- **Loading:** keep the layout; the hero fades, the weakest table shows five blank rows, the chart shows its placeholder.
- **Background refresh:** nothing dims; the topbar Refresh icon spins.
- **No wireless devices:** title `0 wireless devices`, a muted status, and "No wireless devices." in the cards.
- **Error:** an inline note with the eero message and **Retry** in place of the sections; Coverage and the Upgrade report each have their own.
- **Coverage never scanned:** "No scan yet." and **Scan now**.
- **Capability missing:** Coverage and the Upgrade report need the `/2.4/` API; a 404 hides those sections.
- **Offline (network down):** the lists are the last known; every device reads offline, so the counts fall to 0.

## Notes

- Coverage, the Upgrade report and Radios (as Radio channels) used to be on [Troubleshooting](troubleshooting.md); they moved here on 2026-11-21 so that page keeps the health check, tools and fixes. The eeros page's **Scan coverage** and the health check's failing Mesh links (**View coverage**) link here.
- Coverage scan and upgrade report are `GET /2.4/networks/{id}/placement/...`. Their shapes were captured read-only on 2026-11-14 (M5.R-fix5): both are instant reads that list devices, not rooms or counts, so core builds the rooms (one per eero, mean device link score) and the generation counts. The placement test response is still not captured (it is a write); its mapper reads the likely field names tolerantly and a MANUAL check confirms it.
- Busy percent comes from `radio_channel_stats.channel_utilization` on each eero, a current value that free accounts get. Historical channel analytics (the `channel_utilization` endpoint) is an eero Plus feature and is not used.
- `Radio.autoChannel`: eero has no auto-channel field (`{net}/radio_settings` and `radio_channel_stats` have none, M5.1 capture), so the page does not show one.
- Wi-Fi generation comes from each device's link standard (`he` is Wi-Fi 6, on 6 GHz counted as 6E); devices with no standard count as Unknown.
- Link speed is the download rate (eero to device), `rx_rate_info.rate_bps` or `rx_bitrate`.
