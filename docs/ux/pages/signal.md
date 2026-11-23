# Signal

How well the wireless devices are connected and what would make it better: plain-language fixes, the mesh as a map, signal against link speed, each eero's radios on the airwaves, load per radio, resent packets, signal over time and Wi-Fi generations supported against in use. Sidebar: **Signal** in the Network group, between Profiles and Activity (route `#/signal`, icon `Signal`). Added 2026-11-20 as Wi-Fi health, renamed Signal 2026-11-21 so it reads apart from Wi-Fi network.

Most figures come from `wifi.health`, which core works out from the device and eero lists the app already reads: no requests of its own, refreshed with the device poll (60 s). eero keeps history for eero Plus only, which Mesh UI does not support, so Signal history is Mesh UI's own: samples taken while it runs (`wifi.history`).

Shared patterns (flat hero, sections, share bars, footnotes) are described in [../overview.md](../overview.md) and the [design system](../../design/design-system.md).

## Layout

Rebuilt 2026-11-22 (issue #351): the page reads top to bottom: where things connect, how well each device links, the airwaves, load per radio and resent packets, stability over time, what devices could use, and last what to fix. Sections that belong together sit side by side as separate sections, each with its own title. **Side-by-side sections take their own height** (`items-start`), so a short one never shows an empty stretch of card; the next row clears both. One signal quality scale holds across the page: excellent is success (green), good a neutral strength of the text colour, fair is warning, weak is destructive (`signalQualityColors`), and eero's coverage ratings use the same four (strong as excellent, poor as weak).

1. **Hero** (the flat page header, no icon tile).
   - Title: the wireless device count (`27 wireless devices`; `Signal` while loading).
   - Status line: a warning `3 weak connections` when any device is below -75 dBm, else a success `Every connection good` (or `No weak connections` with fair ones); then `3 fair` and `1 weak mesh link`, muted, when not zero.
   - Facts in a 2 by 2 grid: **Median signal** (`-62 dBm · good`), **Weakest mesh link** (the Wi-Fi linked eero with the fewest bars, `Garage · 2 of 5 bars`; `All wired` when none), **Busiest radio** (`Living Room · 2.4 GHz · 29%`), **Wi-Fi 6 or newer** (`59% · could be 63%`, the second figure from `wifi.insights` when the devices support more; only devices that report a generation count).
   - Right-hand column, **Signal by eero** (`w-[26rem]`): one strip per eero with devices, a thin line per device at its dBm in its band's colour, a taller foreground line at the eero's median, the weak zone (below -75 dBm) tinted, quality words above and `-90 / -65 / -40 dBm` under, the device count on the right. Lines, not dots, so a network of 200 devices still reads: crowded stretches get denser. Hover: the devices near that dBm on that eero.
2. **Mesh map** (left 3/5) beside **Coverage scan** (right 2/5), two titled sections (renamed from one Mesh coverage section 2026-11-22), with one legend for both under the list, where there is room.
   - Mesh map, subtitle `4 eeros, 3 over Wi-Fi, 1 weak link`.
   - Coverage scan, subtitle `Scanned 2m ago` (`Not scanned yet`); what the cells mean is their tooltip (`Coverage 72 of 100, good: how well the devices on this eero connect, from eero's coverage scan`) (`Scanning...`; `Not available on this network` when eero answers 404), **Scan again** (refresh icon, spinning while it scans) on the right when the scan exists.
   - Map (Mesh map): its own card, zoomed and panned as the eeros page Map is (drag, Ctrl or Command and scroll, the + / - / Fit buttons, + - 0 keys; `useMapNav` from `components/mesh/Topology.tsx`). eeros in columns by hop from the gateway, each in its colour (gateway with a filled centre), joined to its upstream as the eeros page draws links (wired solid, Wi-Fi dashed, weak in the warning colour, the link chip at the middle). Around each eero its devices as dots in their quality colour, nearer for a stronger signal; a faint ring at -65 dBm and a dashed red ring at -75 dBm. The eero's name sits under its outer ring, clear of the dots.
   - List (Coverage scan): eero name (links to the eero), devices and `3 weak`, model and how it links (`Gateway`, `Wired to Living Room`, `Wi-Fi to Office`), then **Test** (not for the gateway, which has no upstream to test) and the coverage scan's 5 cells last, so the cells line up down the list (the gateway has cells too: eero scores the devices on it like any other), with eero's coverage advice at the top. Replaces the Coverage table (2026-11-22).
   - Legend (under the list): Excellent (`or strong`), Good, Fair, Weak (`or poor`) with coverage, then on a line of its own Wired and Wi-Fi link. `Nearer its eero is a stronger signal` sits inside the map at the bottom left, outside the zoomed layer, on the box's own background so it reads over the drawing.
3. **Signal and speed** (left 3/5) beside **Weakest connections** (right 2/5).
   - Signal and speed, subtitle `Median -62 dBm, 3 weak`: one cell per band (devices, median dBm and link speed, a share bar of its devices by quality), then a scatter of link speed (log scale) against signal, one dot per device in its band's colour over faint columns (7%) in the signal quality colours (weak, fair, good, excellent by dBm), with the opposite corners labelled `Fast and strong` (top right, success text) and `Slow and weak` (bottom left, destructive text); the old strong signal, slow link box was dropped 2026-11-22, since idle devices report slow links. Legend under: the qualities and their cut-offs, no counts (the band cells above already name the bands). Replaces Signal quality and Link speed.
   - Weakest connections, subtitle `The 6 weakest of 27`: no table header; each row a quality dot, the device's icon, its name (link) over eero and band (just the band when there is no eero), then dBm and signal bars.
4. **Signal history** (left) beside **Airwaves** (right). On wide screens the two share rows (`grid-rows-subgrid`), so headers, cards and footnotes line up and the history card takes the Airwaves card's height, its list scrolling inside; stacked, the list shows about seven rows.
   - Signal history, subtitle `Last 59 minutes, 3 devices dropped off` (`Recording` until there are two samples): up to 20 devices from `wifi.history` (most drops, then weakest), the time axis (`59m ago` to `Now`) fixed above the rows, which scroll under it with `scroll-fade-y` edges, each a line on one shared dBm scale in its median quality's colour, broken where it dropped off (a faint destructive band), with the -75 dBm line dashed; `Dropped once` (`Dropped 3x`, destructive) or `Median -73 dBm` (muted) under the device name, so the line takes the rest of the row. Footnote: `The dashed line is -75 dBm, below which a signal is weak.` Samples are recorded while Mesh UI runs, kept 4 hours, never saved.
   - Airwaves, subtitle `Busiest: Living Room 2.4 GHz at 29%` (`, plenty of room` under 50%). The eero legend sits inside the card, top right, so the subtitle keeps the header's width. One row per band on its channel axis; each eero radio is an arch as wide as its channel (the 80 or 160 MHz block it sits in) and as tall as its channel utilization (the busiest radio fills the row less a line for its label, every band on that one scale, with dotted `N% busy` lines at nice steps below the peak, labelled in the left gutter under the band name), in the eero's colour (2px line, 12% area), labelled with the eeros and percents above, each label kept inside the plot; a label that would overlap its neighbour moves up a line. Hover: channel, width, busy, devices, transmit power. Footnote, one line: width is the channel, height how busy it is; eeros often share a channel by design, which only matters past 50% busy. Replaces the Radios table.
5. **Devices per radio** (left) beside **Resent packets** (right).
   - Devices per radio, subtitle `Most: Living Room 5 GHz, 5 devices`: a table, one row per eero, a column per band; each cell the device count, a quality dot and the median dBm, tinted in the band's colour by count; `-` where the eero has no radio on that band. Footnote, one line: darker carries more; best is devices spread across eeros with a good signal.
   - Resent packets, subtitle `1 device resends a lot` (`No device resends much`; `No device reports it`): the share of packets each device sent again against its signal; the ones the noisy link advice names are warning-coloured and labelled. Footnote: a few percent is normal, above 10% with a decent signal points at interference. Without any report the card holds a watermark (`Repeat` glyph in the solid `text-watermark`, so overlapping strokes do not brighten, and `No reports`) and stretches to the height of Devices per radio.
6. **Wi-Fi generations** (left 3/5) beside **What holds them back** (right 2/5).
   - Wi-Fi generations, subtitle `5 devices connect below what they support`: a flow from the newest generation each device supports to the one it connects with; level flows faint, flows to an older generation in the colour of what they could use. Hovering any flow lists its devices (up to 40, then `and N more`). No footnote.
   - What holds them back, subtitle `4 reasons`: one row per reason (On 2.4 GHz, No 6 GHz radio on their eero, On 5 GHz beside a 6 GHz radio, Weak signal, Other) with the count, the devices (three, then `and N more`, which opens the rest) and a hint.
   - Without the upgrade report it is one full-width section, a share bar of the generations devices connect with. Replaces Wi-Fi generations and the Upgrade report.
7. **Worth a look**, subtitle `5 things that would help, most useful first` (`Nothing to fix right now` with an empty card). A two-column grid of cards from `wifi.insights` advice (`wifi.health`'s until it loads): a status dot (destructive, warning or info), the title, core's reasoning in muted text, then, just under the text, the devices it is about as dim links (four, then `and N more`), or the eeros when it is about eeros. A weak mesh link card offers **Test placement** (`eero.placement.test` on that eero), and shows the rating after.

Link headroom (a link's speed as a share of the top rate its generation, width and streams allow) was tried and dropped on 2026-11-22: eero's link rate is the rate of the last packets, so idle devices read a few percent and the figure measured idleness, not headroom. `maxMbps` and `headroomPct` stay in `wifi.health` for agents.

## Data

| Element | Command | Refresh |
| --- | --- | --- |
| Hero, Mesh map, Signal and speed, Weakest connections, Airwaves, Devices per radio, Resent packets | `wifi.health` `{}` (`WifiHealth`) | every 60 s (topic `devices`) |
| Worth a look, Wi-Fi generations, the hero's "could be" | `wifi.insights` `{}` (`WifiInsights`) | on load |
| Signal history | `wifi.history` `{limit: 20}` (`SignalHistory`) | every 60 s |
| Weakest connections' device icons | `device.list` | shared cache |
| Mesh list's link cells and advice | `coverage.scan` | on load (last result), on Scan again |
| eero details for the map's links and the placement test | `eero.list` | shared cache |

`wifi.health` reads `device.list` and `eero.list` through the backend; `wifi.insights` adds eero's upgrade report (`/2.4/`). The advice rules and thresholds live in core (`ADVICE` in `src/core/commands/signal.ts`); quality cut-offs are `SIGNAL_DBM` in `src/core/signal.ts` (-55, -65, -75 dBm), common rules of thumb, not eero's own. Channel spans and top link rates are in `src/core/signal.ts` too, shared by core and the charts.

## Actions

| Control | Command | Effect | Confirm | Result |
| --- | --- | --- | --- | --- |
| Device and eero names | none (navigation) | | | Opens the device or eero page |
| Scan again | `coverage.scan` `{refresh: true}` | query | no | Subtitle and button say "Scanning...", then the list's cells and advice update |
| Test (Mesh list), Test placement (Worth a look) | `eero.placement.test` `{eero}` | write | no | "Testing..." (up to a minute), then the rating as a dot in its quality colour and the word; advice in its tooltip. Not offered for the gateway |

Only the placement test changes anything (it asks eero to measure; nothing goes offline).

## States

- **Loading:** keep the layout; the hero and charts fade to `opacity-40`, the advice grid shows two blank cards.
- **Background refresh:** nothing dims; the topbar Refresh icon spins.
- **No wireless devices:** title `0 wireless devices`, a muted status, and an empty sentence in each chart.
- **Error:** an inline note with the eero message and **Retry** in place of the sections.
- **Upgrade report missing** (a `/2.4/` 404): Worth a look keeps `wifi.health`'s advice; Wi-Fi generations shows the share bar.
- **Coverage scan missing:** the Coverage scan list has no link cells, Test or Scan again, and says the scan is not available.
- **History empty** (just opened, or a CLI run): "Recording. Lines appear after a few minutes with Mesh UI open."
- **Large networks:** the hero strips, the map (smaller dots past 120 devices) and the scatters stay readable; Weakest connections shows six, Signal history scrolls past seven rows, and advice names four devices.

## Notes

- Coverage, the Upgrade report and Radios (as Radio channels) used to be on [Troubleshooting](troubleshooting.md); they moved here on 2026-11-21 so that page keeps the health check, tools and fixes. The eeros page's **Scan coverage** and the health check's failing Mesh links (**View coverage**) link here.
- Coverage scan and upgrade report are `GET /2.4/networks/{id}/placement/...`. Their shapes were captured read-only on 2026-11-14 (M5.R-fix5): both are instant reads that list devices, not rooms or counts, so core builds the rooms (one per eero, mean device link score) and the generation counts. The placement test response is still not captured (it is a write); its mapper reads the likely field names tolerantly and a MANUAL check confirms it.
- Busy percent comes from `radio_channel_stats.channel_utilization` on each eero, a current value that free accounts get. Historical channel analytics (the `channel_utilization` endpoint) is an eero Plus feature and is not used.
- `Radio.autoChannel`: eero has no auto-channel field (`{net}/radio_settings` and `radio_channel_stats` have none, M5.1 capture), so the page does not show one.
- Wi-Fi generation comes from each device's link standard (`he` is Wi-Fi 6, on 6 GHz counted as 6E); devices with no standard count as Unknown.
- Link speed is the download rate (eero to device), `rx_rate_info.rate_bps` or `rx_bitrate`.
- `wifi.health`'s top rate needs each link's spatial streams (`rx_rate_info.nss`, mapped to `link.streams` 2026-11-22) and width. Whether a real network sends `nss`, `snr` and `packet_stats.tx_retry_pct` is not yet checked; Resent packets shows its watermark if not (MANUAL check).
- What a device supports comes from the upgrade report's device rows, matched to the device list by the device url's last part (or the MAC). That match is not yet checked on a real network (MANUAL check).
