# eero detail

One eero: its link into the mesh, its radios and ports, the devices on it, its
settings (name, LED, nightlight) and per-eero restart or removal.

Mockup: [../../mockups/04-eero-detail.html](../../mockups/04-eero-detail.html)
(shows "Office", an eero Pro 7 with wireless backhaul and Garage downstream).

Shell, confirmations, states and refresh rules: [../overview.md](../overview.md).
Topbar: crumbs "Maple Street / eeros / Office eero" (the eero's name plus "eero"; just "eero" until it loads; the name opens the crumb switcher, a list of every eero in `eero.list` order with its status, see design-system.md, Crumb switcher), nothing after them; the Refresh tooltip says "Updated 4s ago". Sidebar item
eeros stays active. `[` and `]` move to the previous and next eero.

## Layout

1. **Hero** (flat, as on Overview: no card, a rule under it), three columns:
   - Left: a 64 px product tile, the device hero's size (the eero product
     glyph from `eeroIcon`, 12 px radius), with a small LED bar at the top
     that mirrors the LED state (on, dimmed, off, blinking).
   - Middle: name ("Office", with "Gateway" in plain dim text after it for
     the gateway); status line with Online and "Up 1d 9h"; facts, label
     over value: Model ("eero Pro 7"), Radios ("Tri-band Wi-Fi 7"), Devices
     ("9", "1 wired"), Data, 24h ("118 GB (29%)", the share of the network
     after the value). No boxed badges.
   - Actions under the facts, as on Overview and Internet (`hero` size,
     28px, outline, dim icons, 12px above): **Blink light** (blinks at once,
     then "Blinking · 30s") and **Restart eero…** (the ellipsis because it
     confirms first; its tooltip says what drops, "Restarts Office. 6 devices
     on it lose internet for about 1 minute. Garage connects through it and
     drops too.", the sentence Troubleshooting's restart rows use).
   - Right: **Uplink** card, "Wireless backhaul": upstream eero (Living Room,
     Gateway), a dashed link with its quality chip ("Excellent · 4 bars"),
     this eero, then any downstream eero with its own link chip ("Weak · 2
     bars", warning colour). For the gateway the upstream is the Internet
     node and the link is the WAN ("10 Gbps WAN"). With more than one
     downstream eero (the gateway, usually) they are listed under the row,
     each with its link chip, instead of drawn inline. Under the row, for
     every eero but the gateway (it has no upstream eero to measure
     against), **Test placement** (xs outline) on the right, with no label;
     "Testing placement..." while it runs, then the rating (a dot in its
     signal quality colour and the word) with eero's advice under it.
2. Two columns, 56px below the hero:
   - **Data usage**. Description under the title: the window and this
     eero's total ("24 hours, 143 GB"; its share of the network is in the
     hero). Range dropdown "Last 24 hours" or "Last 7 days". Legend with
     totals (Download 101 GB, Upload 17 GB) and an area chart.
   - **Radios**. Description: the radio count, then how channels are picked
     ("3 radios, fixed channel on 5 GHz", "2 radios, auto channel selection
     on"). One card with a row per band, split by faint dividers (no card
     per band): band badge, "Ch 36", "160 MHz" over "tx 23 dBm" (always two lines, so the channel never wraps), client count,
     and "Utilization now" with a meter in the band colour.
3. Two columns:
   - **Connected devices**. Description under the title: the count, then
     how many are wired ("12 devices, 3 wired"). A dim text link "View all
     devices →". The card is capped at about seven rows (392px); more rows
     scroll inside it, with the header row pinned. Table: Device (icon, name,
     thin usage bar), Connection (band badge or Wired, plus Wi-Fi generation
     or port: "Wi-Fi 6E", "Port 1"), Signal (dBm and bars; the `<···>` wired mark for wired),
     Rate (link rate, "866 Mbps"), Data 24h.
   - **Ethernet ports**. Description: the ports, then how many are in use
     ("2 x 5 GbE, 1 in use"). Port actions under the tiles end in an
     ellipsis ("Disable port 2…": each confirms first) with dim icons. Under the
     ports card, the same wired backhaul info note as on the eeros page, under
     the same condition (a non-gateway eero with a wired backhaul and wired
     devices on the gateway); see eeros.md. A tile per
     port: name, status (Up, Empty), a jack drawing with link lights,
     negotiated speed ("2.5 Gbps", "of 5 Gbps supported", or `-` "no
     carrier"), and everything attached, one name per line ("Alex's MacBook
     Pro"; a switch lists each device behind it; "Nothing plugged in";
     "Turned off" for a disabled port). Under the tiles, port MACs (mono),
     then a button per action eero lists for a port, with its consequence
     ("Disable port 1", "Synology NAS loses its wired connection").
4. **Device information**. Description: the model and when it joined
   ("eero Pro 7, joined Mar 3, 2025"). Three cards side by side:
   - **Software** ("Updates install network-wide"): status Up to date,
     level with the title;
     eeroOS version; Update window "2 to 4 AM" with a **Change** link (the plain
     underlined link style, not blue); a
     short history of versions with dates (current one marked).
   - **IP addresses** ("Assigned by the gateway"): IPv4, IPv6, Subnet,
     Gateway (mono, each with its own copy icon), then a right-aligned
     **Copy IP addresses** button under the list.
   - **Device information** ("Joined Mar 3, 2025"): Model number, Serial, MAC,
     BSSID per band (mono).
5. **eero settings**. Description: what is set now ("Status light on,
   nightlight ambient"). One card of settings rows split by faint dividers,
   as T3 Code's settings groups (title over a muted description, the
   control on the right, anything more under it):
   - **Status light**, "The LED on the front. Solid white means all is
     well; it returns to full brightness while offline, restarting or
     resetting.": on/off switch, then a brightness dropdown to its right
     (0%, 25%, 50%, 75%, 100%; a level eero reports between steps, such as
     60%, is listed too). The dropdown is disabled while the light is off.
   - **Nightlight**: only on eero Beacon; the row is hidden on every other
     model. On a Beacon, a mode dropdown on the right (Off, Ambient,
     Scheduled), with a brightness slider and, for Scheduled, on and off
     times under it.
   - **Remove eero**, "Removes Office from Maple Street and resets it.
     Owner only.", and **Remove eero…** (outline, destructive text; the
     ellipsis because it asks first), which opens the confirm dialog:
     "Remove "Office" from Maple Street? Its devices move to other eeros if
     in range, and Garage loses its uplink and may go offline until it
     finds another path." with type-the-name, **Remove from network** and
     **Cancel**. For the gateway while other eeros remain: the button stays,
     disabled and dimmed, with the tooltip "Disabled: the gateway can't be
     removed while other eeros use it", and the description "The gateway
     can't be removed while other eeros use it; replace it in the eero app."

## Data

| Element | Command | Refresh |
| --- | --- | --- |
| Hero, status, model, radio badge, uptime, LED state | `eero.get {eero}` | 60 s |
| Device count, wired count | `eero.get` (client counts) | 60 s |
| Data 24h and share of network | `usage.get {scope: "eero", id: eero, range: "day"}` (with `shareOfNetwork`) | 5 min |
| Uplink card (upstream, downstream, link quality) | `eero.list` (graph) | 60 s |
| Data usage chart | `usage.get {scope: "eero", id: eero, range}` | 5 min |
| Radios (channel, width, tx power, devices, utilisation, auto channel) | `eero.get` | 60 s |
| Connected devices | `device.list {eero}` | 30 s |
| Ethernet ports (status, speeds, attached devices, MACs, allowed actions) | `eero.ports.get {eero}` | 60 s |
| Location presets | Static list in core (eero's room names) | - |
| Status light | `eero.get` (`led.on`, `led.brightness`) | 60 s |
| Nightlight | `eero.get` (`nightlight` support and settings) | 60 s |
| Software status, update window | `updates.get` | 10 min |
| Version history | `eero.firmware.history {eero}` | 10 min |
| IP addresses, device information | `eero.get` | 60 s |

## Actions

| Control | Command | Effect | Confirm | Result |
| --- | --- | --- | --- | --- |
| Day / Week | - (re-queries `usage.get`) | - | No | Chart switches range |
| Upstream or downstream eero in Uplink | - | - | No | That eero's detail |
| Device row, All devices → | - | - | No | Device detail; Devices filtered to this eero |
| Disable port N / Enable port N, Restart PoE, PoE and data on or off (whichever the port lists) | `eero.port.action {eero, port, action}` | disruptive | Yes, in the confirm dialog (the engine's message names everything plugged in: "Turns off port 3 on Living Room. Living Room TV and Hue Bridge lose their wired connection.") | Port tile shows Disabled and "Turned off"; toast "Port 3 disabled on Living Room" with Undo (opposite action, also confirmed) |
| Rename… (hero, first, before Blink light and Restart eero…) | `eero.rename {eero, location}` from the shared Rename sheet ("Location" field, required) | write | No | Name updates everywhere; toast with Undo |
| Status light switch | `eero.led.set {eero, on}` | write | No | LED bar in hero follows |
| Brightness slider (on release) | `eero.led.set {eero, brightness}` | write | No | Same |
| Nightlight mode, brightness, times (Beacon only) | `eero.nightlight.set {eero, mode, brightness, on?, off?}` | write | No | Toast |
| Garage link in the Nightlight note | - | - | No | Garage detail |
| Change (update window) | - | - | No | Updates & admins page |
| Copy (IP addresses) | - (clipboard of the shown values) | - | No | Toast "IP addresses copied" |
| Test placement (Uplink card, not the gateway) | `eero.placement.test {eero}` | write | No | "Testing placement..." (up to a minute), then the rating and eero's advice; disabled with a tooltip while the eero is offline |
| Blink light | `eero.find {eero}` | write | No | Button reads "Blinking · 30s" and counts down; hero LED bar pulses |
| Restart | `eero.restart {eero, confirm: true}` | disruptive | Yes, in the confirm dialog (the engine's message: the gateway outage, or the eeros downstream that drop too) | Status Updating, progress toast "Restarting Office" with "Back in about 1 minute", refreshing every 5 s until the restarted eeros are back (see [eeros.md](eeros.md#built-so-far-m25-m48)) |
| Remove from network | `eero.remove {eero, confirm: true}` | destructive | Yes, in the confirm dialog, type the eero's name (the engine's message names the eeros that lose their uplink) | Toast "Office removed from Maple Street"; navigates to eeros |

## States

- **Loading.** Hero shows the tile and `-` figures; radios and port tiles at
  normal size with `-`; tables blank rows.
- **Empty.** No devices on this eero: "No devices are connected to Office
  right now." No Ethernet ports reported: section shows "Port details aren't
  available for this model."
- **Error.** Per section note with Retry. A missing eero id (removed
  elsewhere) shows "This eero is no longer on Maple Street." with a link to
  eeros.
- **Offline (this computer).** Shell banner; all writes disabled.
- **This eero offline.** Status Offline, "last seen 2:16 AM"; Uplink shows
  "No link"; radios and ports show `-`; Blink light, Restart, LED and port actions
  disabled with "Office is offline". Remove stays available to the owner.
- **Restarting or updating.** Status Restarting or Updating; actions
  disabled until Online.
- **No permission.** Remove disabled with "Owner only" for admins. Port
  actions and LED changes follow `network.permissions` (`eeros.update`).
- **Capability missing.** No nightlight: as in the mockup. No 6 GHz: radios
  show two cards. A port offers only the actions eero lists for it, so the
  action button changes (Disable port, Enable port, Restart PoE) or is
  absent. Placement and utilisation as on [eeros.md](eeros.md).
- **Gateway.** Uplink shows Internet and the WAN link. Restart copy reads
  "Restarts Living Room, the gateway. Everyone on Maple Street loses internet
  for about 2 to 3 minutes." Remove is
  not offered for the gateway while other eeros remain (replace it with the
  mobile app instead); core refuses it too. A gateway that is the only eero
  can be removed, which takes the network offline.
- **Bridge mode.** No change on this page.

## Notes

- Restart copy names the downstream eeros that will also drop (from the
  topology), and the duration from core (about 1 minute for a leaf eero, about 2 to 3 for
  the gateway; see [commands.md](../../architecture/commands.md#restart-estimates)).
- LED writes go through the eero's `led_action` resource as form data; a
  JSON PUT to the eero object silently does nothing.
- Port actions come only from the port's `actions[]` in
  `eero.ports.get`; never offer one that is not listed. They can cut power
  or data to wired gear, hence disruptive.
- `eero.remove` resets the eero and cannot be undone from Mesh UI; adding it
  back needs the mobile app.
- Location presets mirror the eero app's room list; Custom opens the input
  with the text selected.
- Version history uses `eero.firmware.history {eero}` (per eero, from
  M2.6). An empty list reads "No version history reported."; an error reads
  "Version history isn't available." and the rest of the card still shows.
- Built in M4.8: Location (input saves on Enter or blur, Esc reverts;
  preset chips; Custom selects the input), Status light (switch, brightness
  saved on release), Nightlight (Beacon: mode, brightness, On at and Off at
  as time inputs saved on blur), Blink light and Restart. Each write shows a
  toast with Undo (the previous value), except Blink light and Restart. Writes
  dim with the reason when the eero is offline ("Office is offline") or
  restarting, or when `network.permissions` denies `eeros.update`; the
  status light also needs the network's `led_action` capability. The presets
  stay in the page: they are labels, not a rule core needs.
- Built in M5.7: port actions (only the ones a port lists, gated by
  `eeros.update`, dimmed "Office is offline" while the eero is offline) and
  Remove (gated by `eeros.delete`, so admins see "Owner only"). Each port
  tile lists every attachment (`attachments`), linked to its device or eero.
  A down port reads `port_status` `DISCONNECTED`; a disabled one has not been
  captured, so the fake server and mapper guess `DISABLED`.
- MANUAL: restart PoE on a port with nothing critical | eero detail of an
  eero whose port lists Restart PoE, Ethernet ports, Restart PoE on port N,
  confirm | the device on that port power cycles and comes back; the eero app
  agrees | risk: that port's device drops for a moment.
- MANUAL: disable a port with nothing critical, then Undo | eero detail,
  Ethernet ports, Disable port N, confirm, then Undo in the toast and confirm
  | the port shows Disabled, then Up again; note the real `port_status` of a
  disabled port | risk: that port's device loses its wired link until Undo.
- MANUAL: remove an eero only if one is spare and can be re-added with the
  eero app | eero detail, Remove, type the name, Remove from network | the
  eero leaves the network and resets | destructive: cannot be undone from
  Mesh UI; re-adding needs the eero app.
- Nightlight on a non-Beacon fails `bad_params` in core ("Office has no
  nightlight. Only eero Beacon has one."), before any request. Its write
  shape is from the open source clients (every captured eero has
  `nightlight: null`).
- MANUAL: rename an eero and back | eero detail, Rename…, type a new name,
  Enter, then Undo in the toast | the eero app shows the new name, then the
  old one | risk: none.
- MANUAL: rename one eero and turn its LED off and on | eero detail, Rename…,
  toggle Status light | name and LED change in the eero app too |
  risk: none.
