# eeros

The mesh itself: how the eeros link to each other, how each radio is doing,
where the traffic goes, and network-wide restart.

Mockup: [../../mockups/03-eeros.html](../../mockups/03-eeros.html)

Shell, confirmations, states and refresh rules: [../overview.md](../overview.md).
Topbar: title "eeros", nothing after it (freshness is in the Refresh tooltip). The network's eeroOS and update state ("eeroOS 7.12.1, up to date") is a muted line under the selected eero, to the right of the topology, with a check icon when up to date or an up arrow otherwise; the update part ("7.13.0 available", "7.13.0 scheduled") is a TextLink to Updates & admins. Under it, only when an eero other than the gateway has a wired backhaul and eero reports wired devices (not eeros) on the gateway, an info note: "Devices plugged into an eero with a wired backhaul may show as wired to the gateway. That eero passes its Ethernet ports straight through to the cable, so eero sees them arrive at the gateway's port." Mesh UI shows the device's eero as eero reports it (see eero-api/data-model.md, Device).
Sidebar count: number of eeros.

## Layout

1. **Mesh topology** section. The page has no hero, so this first title takes the hero title size (28px semibold, tight tracking) to match the other pages' headers. Description under the title: the count, the
   wired backhaul count, then what needs attention ("4 eeros, 1 weak link",
   "3 eeros, 1 wired backhaul"; zero counts left out). Tool: a view
   dropdown, "Map view" or "Tree view". Two columns:
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
     The drawing is centred in the card. Zoom and pan: small **-**, **+**
     and **Fit** buttons top right; Ctrl or Cmd + scroll and trackpad pinch
     zoom about the pointer (plain scroll still scrolls the page); dragging
     the background (or a node) pans, and a click that did not move still
     selects; with the map focused, `+`, `-` and `0` (Fit). Zoom runs 50% to
     200%. Fit is the default and what the button and `0` return to.
   - **Tree** view (toggle): the same data as an indented list: eero,
     backhaul, bars, downstream eeros.
   - Right column (330 px):
     - Weak link note when any eero is weak (warn note): title "Garage has a
       weak link", body "It reaches Office at only 2 of 5 bars, so the 3
       devices connected through it get slower speeds than the rest of the
       mesh.", three suggestions with icons (move it 1 or 2 rooms closer, in
       line of sight; run Ethernet for wired backhaul; add an eero halfway),
       and buttons **Test placement** and **Scan coverage**, both outline with
       dim icons (Scan coverage opens Troubleshooting but reads as an
       action, so it stays a button, like the Internet hero's Troubleshoot).
     - Selected eero card: icon, name, "Selected · uplink to Living Room",
       a clickable card (a click anywhere opens the eero; no View link); key values Backhaul (Wireless), Mesh quality ("4 of 4
       bars"), Downstream (Garage).
2. **Your eeros**. Description under the title: connected clients across
   the mesh, then any busy radio ("31 clients", "31 clients, 1 busy radio";
   busy is utilisation at 65% or more). Tool: a view dropdown, "Grid view"
   or "List view". Grid of cards, two per row. Each card:
   - Header: icon, name with "Gateway" in plain dim text, "eero Max 7 · 192.168.4.1 · up
     23d 4h", status (Online, Weak link), **Blink light** button (outline, dim icon; no ellipsis, it blinks at once), or while blinking
     an info-dot "Blinking · 24s" with **Stop**. The whole card opens the
     detail page (a clickable card, see the design system); no chevron
     button.
   - Body: a band table with columns Band (badge "2.4 GHz", "5 GHz", "6
     GHz"), Channel ("ch 149"), Width ("160 MHz"), Utilisation (meter in the
     band colour, warning colour and text at 65% or more, percent on the
     right), Cl. (clients); headers in normal case. A Wired row with the wired
     client count, when there are any, is the last row of the same table
     (same dashed divider), and the note for dual-band models ("eero 7 is
     dual band, no 6 GHz radio") sits under the whole table. The header's
     status and Blink light are level with the eero name, 4px further right
     so the button's gap to the card edge matches its gap to the top.
   - List view: one row per eero with the header fields and per-band client
     counts.
3. Two columns, 56px below Your eeros:
   - **Data usage by eero**. Description under the title: the window and the
     busiest eero's share ("24 hours, Living Room carried 66%"). Range
     dropdown "Last 24 hours" or "Last 7 days". Legend with each eero's
     total in its series colour, then a stacked area chart with a Total row
     in the tooltip.
   - **Clients by band**. Description: the busiest band ("Most on 2.4 GHz",
     "Most wired", "No clients"). Donut with the client total in the middle
     ("31 clients") and a list: 5 GHz 14, 2.4 GHz 9, 6 GHz 4, Wired 4, each
     with its band colour square. Hovering a segment or a row highlights
     both and shows the band, count and percent in a tooltip; the total in
     the middle stays.
4. **Network actions**, its own full-width section at the bottom of the
   page (disruptive actions sit apart from the read-only sections).
   Description: "31 devices online would lose internet" (from
   `settings.impact`). One row: Restart network, "Restarts every eero at
   once" with the impact line, and **Restart network…** (outline, 28px like the
   section dropdowns, centred in the row; the ellipsis because it opens the confirm dialog: "Everyone loses
   internet for about 2 to 3 minutes, including every connected device and
   any calls in progress." with **Yes, restart network** and **Cancel**).

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
| Blink light state ("Blinking · 24s") | Result of `eero.find` (`until` timestamp); countdown in the renderer | - |
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
| Blink light | `eero.find {eero}` | write | No | LED flashes blue and white for 30 s; toast "Blinking Office"; the button reads "Blinking · 30s" counting down. The same label on eero detail and Troubleshooting; its `aria-label` names the eero ("Blink Office's light") |
| Stop (while blinking) | not built: no stop call is known | - | - | Hidden; the countdown runs out |
| Card (click outside Blink light) | - | - | No | eero detail |
| Day / Week (usage by eero) | - (re-queries `usage.get`) | - | No | Chart switches range |
| Legend item | - (view state) | - | No | Hides or shows that eero's series |
| Restart network | `network.restart {confirm: true}` | disruptive | Yes, in the confirm dialog (the engine's `needs_confirm` message) | Progress toast "Restarting Maple Street" with "Back in about 2 to 3 minutes"; eeros show Updating; the eero and network queries refresh every 5 s until every restarted eero is back, then "Maple Street is back" |

## States

- **Loading.** Topology shows the Internet and gateway placeholders with no
  links; cards render with names `-` and empty band rows; charts show
  gridlines.
- **Empty.** A single eero: topology shows Internet and the gateway only, no
  note; usage by eero still shows one series.
- **Error.** Per section note with Retry.
- **Offline (this computer).** Shell banner; Blink light, Test placement and Restart
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
  `network.permissions` denies it. Admins can blink lights and test placement.
- **Capability missing.** No 6 GHz radio: dual-band note. Utilisation not
  reported by a model or firmware: the meter column shows `-`. Placement
  test unsupported on a model: Test placement hidden for that eero.
- **Bridge mode.** Page works as normal.

## Built so far (M2.5, M4.8)

- Blink light (`eero.find`) and Restart network (`network.restart`) work (M4.8).
  Test placement runs `eero.placement.test` (M5) with the same hook and
  rating as Troubleshooting's coverage table (`usePlacementTest`,
  `PlacementRating` in `troubleshooting/Coverage.tsx`): "Testing
  placement..." while it runs, then the rating and eero's advice under the
  suggestions, and **Test again**. Scan coverage links to Troubleshooting. Stop
  is hidden until a stop call is verified.
- The restart watcher (`watchRestart` in `NetworkActions.tsx`) is shared by
  the eeros page, the Overview hero and eero detail. It reads `eero.list`
  after 1 s and then every 5 s (the engine cache answers most reads, so a
  real network sees about one request per 30 s), counts a failed read as
  down (the gateway takes this computer offline too), and clears the
  progress toast once every restarted eero has been seen down and back, or
  after 90 s if none was ever seen down. After 10 minutes it turns into an
  error toast. Offline eeros are left out, since they cannot restart.
- The Map, Tree and radio table live in `components/mesh/` (`Topology`,
  `TopologyTree`, `LinkChip`, `RadioTable`) so eero detail can draw one
  eero's uplink with the same pieces.
- Legend reads "Good (3 to 5 bars)": core words 4 to 5 bars Excellent and
  3 Good, both in the success colour.
- An offline eero shows "last seen 2:16 AM" (a date and time once it is
  older than most of a day).

## Notes

- Topology layout (columns by hop, vertical spread, link label positions) is
  view code in `components/`. Columns sit a fixed step apart (at most 30% of
  the width, so a small mesh does not stretch across the card); once placed,
  the whole drawing (nodes with their labels, the Internet node and the
  wired chip) is shifted so its box is centred both ways. Fit scales that
  box into the card above the legend with padding, shrinking a large mesh
  (down to 50%) but never enlarging a small one past 100%. Zoom and pan is
  one CSS `translate() scale()` on a layer holding both the nodes (HTML, in
  percent) and the links (SVG, `viewBox 0 0 100 100`), so they stay in step.
  It is opt-in (`interactive`), on only for this page's Map. The graph
  itself (who is upstream of whom, quality words from bars) comes from
  `eero.list` and core mapping. Quality
  words: 4 to 5 bars Excellent, 3 Good, 2 Weak, 0 to 1 Poor.
- `eero.find` maps to `POST /2.2/eeros/{serial}/led_cycle` (form
  `colors[]=blue&colors[]=white&duration=30&time_per_color=1`; the eero id
  when it has no serial). Open question: there is no known stop endpoint,
  so the command has no `stop` and the UI hides Stop; the countdown runs
  out.
- Open question on utilisation: current per-band `channel_utilization` comes
  from the eero object (`radio_channel_stats`), while historical channel
  utilisation is an eero Plus feature. Show the current value only when the
  free eero object includes it, never the history.
- Adding or replacing an eero is not in Mesh UI: it needs Bluetooth pairing
  and the mobile app's setup flow, so the page has no setup section.
- `eero.placement.test` uses `/2.3/` (placement test is 2.3 only) and runs
  against the chosen eero; the result comes back in a minute or less.
- `network.restart` (`POST {net}/reboot`) restarts every eero. The run
  confirms in the UI, and the engine requires `confirm: true`. It returns
  `{ eeroIds, estimate }`: the reachable eeros that restart.
- MANUAL: blink one eero's light | eeros page, Blink light on one eero | the light
  cycles blue and white for about 30 s | risk: none.
- MANUAL: Test placement on one non-gateway eero | eeros page, Test
  placement on the weak eero | a rating appears within a minute | risk:
  none.
