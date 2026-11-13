# eeros

The mesh itself: how the eeros link to each other, how each radio is doing,
where the traffic goes, and network-wide restart.

Mockup: [../../mockups/03-eeros.html](../../mockups/03-eeros.html)

Shell, confirmations, states and refresh rules: [../overview.md](../overview.md).
Topbar: title "eeros", subtitle "eeroOS 7.12.1, up to date · updated 4s ago".
Sidebar count: number of eeros.

## Layout

1. **Mesh topology** section. Sub "Upstream links and mesh quality bars".
   Tool: Map / Tree segmented toggle. Two columns:
   - **Map** (card, 430 px tall): left to right, an Internet node ("Ziply
     ONT"), the gateway (larger puck, "eero Max 7 · Gateway"), then each
     eero placed by hop count, with a link line to its upstream. Wired links
     are solid in the wired colour with a label ("10 Gbps WAN"); wireless
     backhaul is dashed in the status colour of its quality with a label
     chip ("Excellent" 4 to 5 bars, "Good" 3, "Weak" 2, "Poor" 0 to 1) and mesh bars. A node with
     a weak link gets a dashed warning outline; the selected node a solid
     muted outline. A small chip under the gateway summarises wired clients
     ("3 wired: NAS, PS5, Hue Bridge"). Legend bottom left (Wired, Good 3 to 5
     bars, Weak, Poor) and "Dashed lines are wireless backhaul" bottom right.
   - **Tree** view (toggle): the same data as an indented list: eero,
     backhaul, bars, downstream eeros.
   - Right column (330 px):
     - Weak link note when any eero is weak (warn note): title "Garage has a
       weak link", body "It reaches Office at only 2 of 5 bars, so the 3
       devices connected through it get slower speeds than the rest of the
       mesh.", three suggestions with icons (move it 1 or 2 rooms closer, in
       line of sight; run Ethernet for wired backhaul; add an eero halfway),
       and buttons **Test placement** and **Scan coverage**.
     - Selected eero card: icon, name, "Selected · uplink to Living Room",
       **Open →**; key values Backhaul (Wireless), Mesh quality ("4 of 4
       bars"), Downstream (Garage).
2. **Your eeros**. Sub "Bands, channels and load per eero". Tool: Grid / List
   toggle. Grid of cards, two per row. Each card:
   - Header: icon, name with a Gateway badge, "eero Max 7 · 192.168.4.1 · up
     23d 4h", status (Online, Weak link), **Find** button, or while blinking
     an info-dot "Blinking · 24s" with **Stop**, and a chevron button to the
     detail page.
   - Body: a band table with columns Band (badge "2.4 GHz", "5 GHz", "6
     GHz"), Channel ("ch 149"), Width ("160 MHz"), Utilisation (meter in the
     band colour, warning colour and text at 65% or more, percent on the
     right), Cl. (clients). A note for dual-band models ("eero 7 is dual band,
     no 6 GHz radio") and a Wired row with the wired client count when there
     are any.
   - List view: one row per eero with the header fields and per-band client
     counts.
3. Two columns:
   - **Data usage by eero**. Sub "Download and upload per hour, stacked". Day
     / Week toggle. Legend with each eero's total in its series colour, then a
     stacked area chart with a Total row in the tooltip.
   - Right column, stacked:
     - **Clients by band**. Donut with the client total in the middle ("31
       clients") and a list: 5 GHz 14, 2.4 GHz 9, 6 GHz 4, Wired 4, each
       with its band colour square.
     - **Network actions**. One row: Restart network, "Restarts every eero
       at once", a "Disruptive" label. Its inline confirm is shown open in
       the mockup: "Everyone loses internet for about 2 to 3 minutes,
       including every connected device and any calls in progress." with
       **Yes, restart network** and **Cancel**.

## Data

| Element | Command | Refresh |
| --- | --- | --- |
| Subtitle firmware line ("eeroOS 7.12.1, 7.13.0 scheduled") | `updates.get` | 15 min (`POLL.updates`) |
| Topology nodes and links (upstream, backhaul, mesh bars, wired link speed) | `eero.list` (each eero has `upstreamId`, `backhaul`, `meshBars`, `hop`) | 60 s |
| Internet node label (ISP, ONT) | `internet.get` | 10 min |
| Wired clients chip | `device.list {eero: gateway, band: "wired"}` (names from summary) | 30 s |
| Weak link note and suggestions | `network.health` issues: the most serious one shows (`network_offline`, then `eero_offline`, then `weak_link`), with its eero, upstream and affected devices | 60 s |
| Selected eero card | `eero.list` (view state picks the eero; default the first with an issue, else the first non-gateway) | 60 s |
| eero cards: header fields, bands, channel, width, utilisation, clients | `eero.list` | 60 s |
| Find state ("Blinking · 24s") | Result of `eero.find` (`until` timestamp); countdown in the renderer | - |
| Data usage by eero | `usage.get {scope: "eero", range}` (all eeros) | 5 min |
| Clients by band | `device.list` summary (`byBand`) | 30 s |

## Actions

| Control | Command | Effect | Confirm | Result |
| --- | --- | --- | --- | --- |
| Map / Tree | - (view state) | - | No | Switches topology view |
| Click a node | - (view state) | - | No | Selects it; right card updates |
| Double-click a node, Open → | - | - | No | eero detail |
| Test placement | `eero.placement.test {eero}` | write | No | Note shows "Testing placement..." then the rating ("Good spot", "Move closer to Office") with the measured bars |
| Scan coverage | - | - | No | Troubleshooting, coverage section, which runs `coverage.scan` |
| Grid / List | - (view state) | - | No | Switches card layout |
| Find | `eero.find {eero}` | write | No | LED flashes blue and white for 30 s; header shows "Blinking · 30s" counting down |
| Stop (while blinking) | `eero.find {eero, stop: true}` | write | No | Countdown ends; LED returns to its setting |
| Card chevron, card title | - | - | No | eero detail |
| Day / Week (usage by eero) | - (re-queries `usage.get`) | - | No | Chart switches range |
| Legend item | - (view state) | - | No | Hides or shows that eero's series |
| Restart network | `network.restart {confirm: true}` | disruptive | Yes, inline | Progress toast "Restarting Maple Street, about 2 to 3 minutes"; all eeros show Restarting; faster polling until every eero is Online |

## States

- **Loading.** Topology shows the Internet and gateway placeholders with no
  links; cards render with names `-` and empty band rows; charts show
  gridlines.
- **Empty.** A single eero: topology shows Internet and the gateway only, no
  note; usage by eero still shows one series.
- **Error.** Per section note with Retry.
- **Offline (this computer).** Shell banner; Find, Test placement and Restart
  network disabled.
- **Network offline.** All nodes muted with Offline; links drawn grey and
  dashed; note "Maple Street is not reporting" in place of the weak-link
  note; actions disabled.
- **One eero offline.** Its node and card show Offline with "last seen
  2:16 AM"; its link is drawn in the destructive colour with "No link";
  downstream eeros attach to it greyed. `network.health` produces an
  offline issue that replaces the weak-link note.
- **Restarting.** Nodes show Restarting (info); links hidden until back.
- **No permission.** Restart network disabled with "Owner only" if
  `network.permissions` denies it. Admins can Find and test placement.
- **Capability missing.** No 6 GHz radio: dual-band note. Utilisation not
  reported by a model or firmware: the meter column shows `-`. Placement
  test unsupported on a model: Test placement hidden for that eero.
- **Bridge mode.** Page works as normal.

## Built so far (M2.5)

- Find, Test placement and Restart network are shown disabled with a
  "Coming soon" tooltip until `eero.find`, `eero.placement.test` and
  `network.restart` land; Scan coverage links to Troubleshooting. So the
  Stop control, the blinking countdown and the open inline confirm in the
  mockup are not built yet.
- The Map, Tree and radio table live in `components/mesh/` (`Topology`,
  `TopologyTree`, `LinkChip`, `RadioTable`) so eero detail can draw one
  eero's uplink with the same pieces.
- Legend reads "Good (3 to 5 bars)": core words 4 to 5 bars Excellent and
  3 Good, both in the success colour.
- An offline eero shows "last seen 2:16 AM" (a date and time once it is
  older than most of a day).

## Notes

- Topology layout (columns by hop, vertical spread, link label positions) is
  view code in `components/`; the graph itself (who is upstream of whom,
  quality words from bars) comes from `eero.list` and core mapping. Quality
  words: 4 to 5 bars Excellent, 3 Good, 2 Weak, 0 to 1 Poor.
- `eero.find` maps to `POST /2.2/eeros/{serial}/led_cycle` with a 30 s
  duration. Open question: there is no known stop endpoint; `stop: true`
  could re-apply the LED setting through `led_action`. Until verified, hide
  Stop and let the countdown run out.
- Open question on utilisation: current per-band `channel_utilization` comes
  from the eero object (`radio_channel_stats`), while historical channel
  utilisation is an eero Plus feature. Show the current value only when the
  free eero object includes it, never the history.
- Adding or replacing an eero is not in Mesh UI: it needs Bluetooth pairing
  and the mobile app's setup flow, so the page has no setup section.
- `eero.placement.test` uses `/2.3/` (placement test is 2.3 only) and runs
  against the chosen eero; the result comes back in a minute or less.
- `network.restart` (`POST {net}/reboot`) restarts every eero. The run
  confirms in the UI, and the engine requires `confirm: true`.
- MANUAL: Test placement on one non-gateway eero | eeros page, Test
  placement on the weak eero | a rating appears within a minute | risk:
  none.
