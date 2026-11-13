# Device detail

One device: live rate, usage, connection details, addresses and port
forwards, plus pause, rename, change type or profile, and block.

Mockup: [../../mockups/06-device-detail.html](../../mockups/06-device-detail.html)
(shows "Alex's MacBook Pro"; open the Appearance sheet with `?sheet=1`).

Shell, confirmations, states and refresh rules: [../overview.md](../overview.md).
Topbar: crumbs "Devices / Alex's MacBook Pro", page actions **‹ Prev** and
**Next ›** (also `[` and `]`). Sidebar item Devices stays active.

## Layout

1. **Hero** (card), three columns:
   - Left: device type icon in an 84 px rounded tile.
   - Middle: name; status line with Online and the type ("Laptop"); metric
     row: Profile (avatar and "Alex"), Connected to ("Office"), Signal (bars
     and "-52 dBm"). Action row: **Pause device** (primary), **Appearance**,
     **Change profile**, **Block** (danger).
   - Right: **Now** live box: a live dot, "refreshes every minute",
     Download "38.4 Mbps" and Upload "6.1 Mbps", and "Current rates while the
     device is active".
2. Two columns.
   - Left:
     - **Data usage**, sub "Per hour, last 24 hours", Day / Week toggle. Hero
       figure "86 GB" with "busiest hour 11 AM · 9.4 GB · #2 on the network",
       legend with Download 64 GB and Upload 22 GB, and an area chart.
     - **Device information** (card): Manufacturer, Model, Hostname (mono),
       MAC address (mono), Security (shield icon, "WPA3 Personal (SAE)"),
       Wi-Fi standard ("Wi-Fi 6E · 802.11ax"), Channel ("37 · 160 MHz · 6
       GHz"), Link rate ("2401 Mbps rx · 2161 Mbps tx"), SNR ("41 dB · 0.2%
       retries"), First seen.
   - Right:
     - **Block confirm**: when Block is pressed, an inline confirm at the top
       of this column (shown open in the mockup): "Block Alex's MacBook
       Pro?", "It will be disconnected from every eero and can't rejoin Maple
       Street until you unblock it from Devices > Blocked.", **Block device**
       and **Cancel**.
     - **IP addresses** (card): IPv4 with a "Reserved" badge (lock icon) and
       an **Edit** link; IPv6 addresses (one per line); Link-local (muted).
     - **Port forwarding**, link "All →". Card with a header row (Port
       forward, Port, Protocol) and one row per forward: name, port or range
       (mono), protocol badge (TCP, UDP, TCP+UDP), and a trash icon; a
       disabled forward shows muted with an off switch. Button **+ Open a
       port**.
3. **Appearance sheet** (from Appearance): header "Appearance", "Nickname and
   icon, shown everywhere in Mesh UI and the eero app". Body: Nickname input
   with a character count ("18 / 32") and "Hostname: Alexs-MacBook-Pro ·
   reset to hostname"; Device type grid of 32 icons in 8 columns with the
   current type's name on the right ("Laptop"). Footer: Cancel, Save.

## Data

| Element | Command | Refresh |
| --- | --- | --- |
| Hero (name, status, type, profile, eero, signal) | `device.get {device}` | 30 s |
| Now box | `device.rates.refresh` then `device.get` | 60 s while visible and the device is online |
| Data usage chart, totals, busiest hour | `usage.get {scope: "device", id: device, range}` | 5 min |
| "#2 on the network" | `usage.breakdown {range, by: "device"}` (rank of this device) | 5 min |
| Device information | `device.get` | 30 s |
| IP addresses | `device.get` (IPv4, IPv6 list, link-local) | 30 s |
| Reserved badge | `reservation.list` (match on MAC) | 60 s |
| Port forwarding rows | `forward.list {device}` | 60 s |
| Prev / Next targets | Renderer list order from Devices (view state) | - |
| Appearance: nickname, hostname, type list | `device.get`; type list is static in core | On open |
| Change profile menu | `profile.list` | 60 s |

## Actions

| Control | Command | Effect | Confirm | Result |
| --- | --- | --- | --- | --- |
| ‹ Prev / Next › | - | - | No | Next device in the Devices list order |
| Pause device | `device.pause {devices: [device]}` | write | No | Status Paused, button becomes **Resume device**; toast with Undo |
| Resume device | `device.resume {devices: [device]}` | write | No | Status Online |
| Appearance | - | - | No | Opens the Appearance sheet |
| Sheet: reset to hostname | - (fills the field) | - | No | Nickname set to hostname, not saved yet |
| Sheet: type tile | - (form state) | - | No | Selects a type |
| Sheet: Save | `device.rename {device, nickname}` and/or `device.type.set {device, type}` (only what changed) | write | No | Sheet closes, toast "Saved"; name and icon update everywhere |
| Change profile | `device.profile.set {devices: [device], profile}` (`profile: null` for Unassigned) | write | No | Menu of profiles plus Unassigned; hero updates; toast with Undo |
| Block | - | - | - | Reveals the inline confirm in the right column |
| Block device | `device.block {devices: [device]}` | write | Yes, UI inline | Status Blocked; hero actions become **Unblock**; toast |
| Unblock | `device.unblock {devices: [device]}` | write | No | Device can rejoin |
| Edit (IPv4 reserved) | - | - | No | Reservations & ports, this reservation open |
| Reserve (IPv4 not reserved) | `reservation.add {device, ip}` | write | No | Badge Reserved; toast |
| All → (port forwarding) | - | - | No | Reservations & ports, filtered to this device |
| Trash on a forward | `forward.remove {forward}` | write | Yes, UI inline ("Remove Web dev server? Port 8080 closes.") | Row removed; toast with Undo (`forward.add` with the same fields) |
| Switch on a disabled forward | `forward.update {forward, enabled}` | write | No | Row enabled or disabled |
| + Open a port | `forward.add {device, description, externalPort, protocol}` (creates the reservation first if needed) | write | No | Sheet with name, port or range, protocol; if the device has no reservation, the sheet says "Port forwards need a reserved address. Mesh UI will reserve 192.168.4.23." and runs both |

## States

- **Loading.** Hero shows name and icon from the list cache if known, `-`
  elsewhere; Now box `-`; chart gridlines; cards with labels and `-`.
- **Empty.** No usage: "No activity in this window." No IPv6: IPv6 row `-`.
  No forwards: card body "No ports open to this device." with **+ Open a
  port**.
- **Error.** Per section note with Retry. A device that is gone: "This
  device is no longer on Maple Street." with a link back to Devices.
- **Offline device.** Status Offline with "last seen 2h ago on Upstairs
  Hall"; Now box shows `-` and "Rates appear when the device is online";
  Signal, channel, link rate and SNR show `-`; Pause still allowed (applies
  when it reconnects).
- **Paused.** Status Paused; Now box shows "Paused, no internet"; primary
  button Resume device.
- **Blocked.** Status Blocked; Now and usage muted; only Unblock and
  Appearance are offered.
- **Wired device.** Signal shows `-`; Device information shows the eero port
  and negotiated speed instead of Wi-Fi standard, channel and SNR.
- **Guest device.** GUEST tag; Pause, Change profile and port forwarding
  hidden; Block stays.
- **Offline (this computer).** Shell banner; writes disabled; Now box `-`.
- **No permission.** Writes disabled with the reason if
  `network.permissions` denies device updates.
- **Capability missing.** Fields eero does not report for this device
  (security type, SNR, retries) show `-`. No burst support: Now box hidden.
- **Bridge mode.** Pause, Change profile, Block, Reserve and Port forwarding
  are hidden; Now box hidden; the bridge note sits under the hero.

## Notes

- Nickname max is 32 characters (shown in the sheet). `device.rename` with
  the hostname clears the nickname, so the device follows its hostname
  again.
- The 32 icons in the type grid map to eero's `device_type` values in core;
  the grid order is fixed so muscle memory holds.
- Device writes use `/2.3/` (`/2.2/` returns 200 and drops the change).
- Unblocking from the mockup's copy points to "Devices > Blocked"; the
  Blocked group on Devices is that place.
- Port forwards need a DHCP reservation first; `forward.add` creates it in
  core when the device has none (see
  [commands.md](../../architecture/commands.md#routing-commandsroutingts)).
- "#2 on the network" needs the breakdown; skip the rank when the device is
  not in the top 50.
- Open question: whether eero exposes per-device retries ("0.2% retries")
  outside the mobile app's User-Agent; drop it if absent.
- MANUAL: pause and resume one device | device detail, Pause device, wait,
  Resume device | the device loses and regains internet within seconds and
  the eero app agrees | risk: brief outage for that device.
