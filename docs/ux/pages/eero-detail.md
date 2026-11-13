# eero detail

One eero: its link into the mesh, its radios and ports, the devices on it, its
settings (name, LED, nightlight) and per-eero restart or removal.

Mockup: [../../mockups/04-eero-detail.html](../../mockups/04-eero-detail.html)
(shows "Office", an eero Pro 7 with wireless backhaul and Garage downstream).

Shell, confirmations, states and refresh rules: [../overview.md](../overview.md).
Topbar: crumbs "eeros / Office", subtitle "Updated 4s ago". Sidebar item
eeros stays active. `[` and `]` move to the previous and next eero.

## Layout

1. **Hero** (card), three columns:
   - Left: a product tile (150 px rounded square, router or lamp glyph) with
     a small LED bar at the top that mirrors the LED state (on, dimmed, off,
     blinking).
   - Middle: name ("Office"); status line with Online, model badge ("eero Pro
     7"), radio badge ("Tri-band Wi-Fi 7") and "Up 1d 9h"; metric row:
     Devices ("9", "1 wired"), Data, 24h ("118 GB · 29% of network").
   - Right: **Uplink** card, "Wireless backhaul": upstream eero (Living Room,
     Gateway), a dashed link with its quality chip ("Excellent · 4 bars"),
     this eero, then any downstream eero with its own link chip ("Weak · 2
     bars", warning colour). For the gateway the upstream is the Internet
     node and the link is the WAN ("10 Gbps WAN").
2. Two columns:
   - **Data usage**. Sub "All clients on Office, per hour". Day / Week toggle.
     Legend with totals (Download 101 GB, Upload 17 GB) and an area chart.
   - **Radios**. Sub "Auto channel selection on". One small card per band:
     band badge, "Ch 36", "160 MHz · tx 23 dBm", client count, and
     "Utilisation now" with a meter in the band colour.
3. Two columns:
   - **Connected devices**, link "All devices →". Table: Device (icon, name,
     thin usage bar), Connection (band badge or Wired, plus Wi-Fi generation
     or port: "Wi-Fi 6E", "Port 1"), Signal (dBm and bars, `-` for wired),
     Rate (link rate, "866 Mbps"), Data 24h.
   - **Ethernet ports**. Sub "2 x 5 GbE, numbered left to right". A tile per
     port: name, status (Up, Empty), a jack drawing with link lights,
     negotiated speed ("2.5 Gbps", "of 5 Gbps supported", or `-` "no
     carrier"), and what is attached ("Alex's MacBook Pro", "Nothing plugged
     in"). Under the tiles, port MACs (mono), then a port action button with
     its consequence ("Disable port 1", "Disconnects the wired device").
4. Settings cards, a 3-column grid:
   - **Location** ("Name shown everywhere for this eero"): name input with a
     pencil, and preset chips (Office, Den, Bedroom, Kitchen, Basement,
     + Custom).
   - **Status light** ("LED on the front of this eero"): on/off switch,
     Brightness slider (Dim to Full, "60%"), note "Solid white means all is
     well. The LED returns to full brightness while offline, restarting or
     resetting."
   - **Nightlight** ("Ambient or scheduled glow"): on a model without one,
     status "Not available", a disabled Off / Ambient / Schedule toggle and
     an info note "Nightlight is only on eero Beacon. Your Garage eero has
     one." (link to that eero). On a Beacon the toggle is live, with a
     brightness slider and, for Schedule, on and off times.
   - **Software** ("Updates install network-wide"): status Up to date;
     eeroOS version; Update window "2 to 4 AM" with a **Change** link; a
     short history of versions with dates (current one marked).
   - **IP addresses** ("Assigned by the gateway"): IPv4, IPv6, Subnet,
     Gateway (mono), with a copy button.
   - **Device information** ("Joined Mar 3, 2025"): Model number, Serial, MAC,
     BSSID per band (mono).
5. **More actions**, three rows:
   - **Blink LED**, "Flashes blue and white for 30 s so you can find it",
     **Blink**.
   - **Restart Office**, "Its devices and Garage (downstream) drop for about
     1 minute", a "Disruptive" label and **Restart**.
   - **Remove Office eero** (title in destructive colour), "Owner only ·
     resets this eero". Inline confirm shown open in the mockup: "Remove
     "Office" from Maple Street? Its devices move to other eeros if in range,
     and Garage loses its uplink and may go offline until it finds another
     path." with **Remove from network** and **Cancel**.

## Data

| Element | Command | Refresh |
| --- | --- | --- |
| Hero, status, model, radio badge, uptime, LED state | `eero.get {eero}` | 60 s |
| Device count, wired count | `eero.get` (client counts) | 60 s |
| Data 24h and share of network | `usage.get {scope: "eero", id: eero, range: "day"}` (with `shareOfNetwork`) | 5 min |
| Uplink card (upstream, downstream, link quality) | `eero.list` (graph) | 60 s |
| Data usage chart | `usage.get {scope: "eero", id: eero, range}` | 5 min |
| Radios (channel, width, tx power, clients, utilisation, auto channel) | `eero.get` | 60 s |
| Connected devices | `device.list {eero}` | 30 s |
| Ethernet ports (status, speeds, attached device, MACs, allowed actions) | `eero.ports.get {eero}` | 60 s |
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
| Disable port N / Enable port N | `eero.port.action {eero, port, action}` | disruptive | Yes, inline ("Alex's MacBook Pro loses its wired connection.") | Port tile shows Disabled; toast with Undo (opposite action, also confirmed) |
| Location input (Enter or blur), preset chip, + Custom | `eero.rename {eero, location}` | write | No | Name updates everywhere; toast with Undo |
| Status light switch | `eero.led.set {eero, on}` | write | No | LED bar in hero follows |
| Brightness slider (on release) | `eero.led.set {eero, brightness}` | write | No | Same |
| Nightlight mode, brightness, times (Beacon only) | `eero.nightlight.set {eero, mode, brightness, on?, off?}` | write | No | Toast |
| Garage link in the Nightlight note | - | - | No | Garage detail |
| Change (update window) | - | - | No | Updates & admins page |
| Copy (IP addresses) | - (clipboard of the shown values) | - | No | Toast "IP addresses copied" |
| Blink | `eero.find {eero}` | write | No | Button reads "Blinking · 30s" and counts down; hero LED bar animates |
| Restart | `eero.restart {eero, confirm: true}` | disruptive | Yes, inline | Status Restarting, progress toast "Restarting Office, about 1 minute", faster polling until Online |
| Remove from network | `eero.remove {eero, confirm: true}` | destructive | Yes, inline | Toast "Office removed from Maple Street"; navigates to eeros |

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
  "No link"; radios and ports show `-`; Blink, Restart, LED and port actions
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
  "Everyone on Maple Street loses internet for about 2 to 3 minutes". Remove is
  not offered for the gateway (replace it with the mobile app instead).
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
- Open question: whether `eero.firmware.history` has a real per-eero source.
  If eero only exposes network-wide history, use `updates.get` history and
  label it "Network updates".
- MANUAL: rename one eero and turn its LED off and on | eero detail, edit
  Location, toggle Status light | name and LED change in the eero app too |
  risk: none.
