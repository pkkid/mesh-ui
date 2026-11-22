# Device detail

One device: live rate, usage, connection details, addresses and port
forwards, plus pause, rename, change type or profile, and block.

Mockup: [../../mockups/06-device-detail.html](../../mockups/06-device-detail.html)
(shows "Alex's MacBook Pro"; its `?sheet=1` Appearance sheet predates the
name field on the row and the icon-only sheet).

Shell, confirmations, states and refresh rules: [../overview.md](../overview.md).
Topbar: crumbs "Devices / Alex's MacBook Pro" (the name opens the crumb
switcher, a searchable list of every device in the Devices table's order;
see design-system.md, Crumb switcher), then only the **Live** switch
(see devices.md, Live switch), beside the search field, where it sits on
Devices too. No Prev / Next buttons; `[` and `]` still step to the previous
and next device in the Devices table's order. Sidebar item Devices stays active.

## Layout

1. **Hero**: the flat page header (`PageHeader flat`, as Devices and eero
   detail; no card, closed by the 1px rule):
   - Left: device type icon in the 64px tile; name with the GUEST tag; status
     line with Online and the type ("Laptop"); facts: Profile (avatar and
     "Alex"), Connected to ("Office"), Signal (bars and "-52 dBm"). Actions,
     all outline: **Rename…** first (the shared Rename sheet: the nickname, with the device's own name as the
     placeholder; empty follows the own name again; `device.rename` with
     Undo), then **Pause device…** (or **Resume device**), then **Block…**
     (destructive text). Blocked: **Rename…** and **Unblock**. The icon tile itself is a button ("Change icon…") that
     opens the icon sheet (5). The profile is a settings row at the bottom
     of the page (6).
   - Right: **Live throughput**, the same panel as the Devices hero
     (`LivePanel`, 384px here; see devices.md, Layout 1) for this one device:
     with Live off the dim watermark (pulse icon, "Live throughput off");
     with Live on the title with the waiting bar, "38.4 Mbps down" and "6.1
     Mbps up", a chart of this device's readings since Live was turned on,
     and "Last reading 8:43:02 PM". With Live on but the device offline,
     paused or blocked, the watermark reads "Device offline", "Device
     paused" or "Device blocked". Hidden in bridge mode.
2. Two columns (one on narrow windows).
   - Left (22rem, 26rem on wide windows):
     - **Addresses and ports** (one card of settings rows, like Device
       settings; "Addresses" for guests, who have no port forwards).
       Description "Reserved, 1 open" or "Not reserved, no ports open".
       Header link "Reservations & ports →" (`SectionLink`; that
       page holds both reservations and forwards; none in bridge mode).
       It drops the usual "View" lead on purpose: the page name is long
       enough on its own.
       Rows:
       - **IPv4**: the address (mono, copy button), "IPv4, reserved: it
         never changes" or "IPv4, can change when the device reconnects";
         outline **Edit…** or **Reserve…** opening the reservation sheet
         (not for guests, blocked devices or in bridge mode). Editing, the
         sheet's footer has **Remove reservation…** on the left (ghost,
         destructive text): the confirm "Remove the reservation for Synology
         NAS?" (it also says which port forwards go with it), then the
         sheet closes with a toast and Undo (no Undo when forwards went too).
       - **IPv6**: the addresses (mono, one per line) or "No IPv6 address",
         with "Link-local fe80::…" under them.
       - **Port forwarding** (not for guests or in bridge mode): "No ports
         open to this device" or "2 open, 1 off", outline **Open a port…**
         (not while blocked), and the forwards listed under the row: name
         ("(off)" when disabled), port or range (mono), protocol badge (TCP,
         UDP, TCP+UDP, in the band badge's neutral box), the standard switch to turn
         it on or off (`forward.update`, Undo toast), and a trash button
         ("Remove Plex…", asks first). The rows share one grid, so the
         columns line up and the name takes what is left.
   - Right:
     - **Data usage**, shaped like Overview's (no card): description under
       the title "24 hours, busiest hour 11 AM, 9.4 GB" (the bare window,
       then its busiest hour or day), range dropdown on the right (Last 24
       hours, Last 7 days, This month: the calendar month from the 1st, one
       point a day, axis labels "Sat Nov 8", like the eero app's Month view). Hero figure "86 GB" on one line with the legend
       Download "64 GB (74%)" and Upload "22 GB (26%)" (value, then its
       share), then an area chart.
3. **Device information** (card), the full width under both columns: one
   card split down the middle by a 1px rule, the device on the left and the
   connection on the right (stacked, with a rule between them, on narrow
   windows). Wi-Fi devices get five rows a side (six on the left with a
   private MAC); wired devices have only two connection rows. Description:
   how it connects now, "Wi-Fi 6E on 6 GHz", "Wired, port 3 on Office" or
   "Not connected" (the rows hold the detail). Header link
   **Look up online** (dim text link with the external-link icon, like a
   section header link, not a button): opens a web search for the device in
   the user's browser, built by `core/deviceLookup.ts` from the
   manufacturer, model, a hostname that is not just the name or the MAC, and
   the MAC's vendor prefix with "OUI" (never the full MAC; no prefix for a
   private or other locally administered MAC). Its tooltip shows the search
   text. Hidden when there is nothing to search for.
   - Left: Manufacturer, Model, Hostname (mono), MAC address (mono), MAC
     type ("Private (random)", only for a private MAC), Active since ("Nov
     18, 9:41 PM" in the network's time zone; eero's `first_active`: when
     this stretch of activity began, not when the device first joined).
   - Right: Security (shield icon, "WPA3 Personal (SAE)"), Wi-Fi standard
     ("Wi-Fi 6E · 802.11ax"), Channel ("37 · 160 MHz · 6 GHz"), Link rate
     ("2401 Mbps rx · 2161 Mbps tx"), SNR ("41 dB · 0.2% retries").
4. Sections after the hero are 56px apart (design system, Shape and
   spacing), the two columns 28px apart.
5. **Icon sheet** (from the icon in the hero), a clean
   sheet (no divider lines): header the current icon, "Icon", "The icon for
   Kitchen Echo, shown everywhere in Mesh UI and the eero app". Body: only
   the device type grid of 32 icons in 8 columns (no field label; the picked
   tile is marked). Footer: Cancel, Save (`device.type.set`, toast with
   Undo).
6. **Device settings**, full width at the bottom, like eero detail's "eero
   settings": description "In Alex" or "No profile", then one card of
   settings rows. Left out entirely for guests and in bridge mode (no
   profile to pick). The name and icon are changed from the hero.
   - **Profile**, "Pauses, schedules and usage for this device follow its
     profile.", a menu button with the current profile ("Alex" or
     "Unassigned") listing the profiles (`device.profile.set`, Undo toast).
     Left out for guests and in bridge mode; dimmed while the device is
     blocked ("Unblock Kitchen Echo to change its profile").

## Data

| Element | Command | Refresh |
| --- | --- | --- |
| Hero (name, status, type, profile, eero, signal) | `device.get {device}` | 30 s |
| Live throughput | `device.rates.refresh` then `device.get` | 60 s while Live is on and the device is online (minimized windows included) |
| Data usage chart, totals, busiest hour | `usage.get {scope: "device", id: device, range}` | 5 min |
| "#2 on the network" | `usage.breakdown {range, by: "device"}` (rank of this device) | 5 min |
| Device information | `device.get` | 30 s |
| Addresses and ports: addresses | `device.get` (IPv4, IPv6 list, link-local) | 30 s |
| Reserved badge | `reservation.list` (match on MAC), or `device.get` `reservation` | 60 s |
| Link-local | `device.get` `ipv6LinkLocal` | 30 s |
| Port forwarding rows | `forward.list {device}` (`unavailable` explains an empty list in bridge mode) | 60 s |
| `[` and `]` targets | Renderer list order from Devices (view state) | - |
| Rename sheet and icon sheet: nickname, hostname, type list | `device.get`; type list is static in core | 30 s; type list on open |
| Profile row menu (Device settings) | `profile.list` | 60 s |

## Actions

| Control | Command | Effect | Confirm | Result |
| --- | --- | --- | --- | --- |
| `[` and `]` keys | - | - | No | Previous and next device in the Devices list order |
| Pause device… | `device.pause {devices: device}` | disruptive | Yes, dialog | Status Paused, button becomes **Resume device**; toast with Undo |
| Resume device | `device.resume {devices: [device]}` | write | No | Status Online |
| Rename… (hero) | `device.rename {device, nickname}` from the Rename sheet (empty clears the nickname) | write | No | Name updates everywhere; toast with Undo |
| Hero icon (Change icon…) | - | - | No | Opens the icon sheet |
| Icon sheet: type tile | - (form state) | - | No | Selects a type |
| Icon sheet: Save | `device.type.set {device, type}` | write | No | Sheet closes, icon updates everywhere; toast with Undo |
| Profile row (Device settings) | `device.profile.set {devices: [device], profile}` (`profile: null` for Unassigned) | write | Only when the target profile is paused or in a scheduled pause now | Menu of profiles plus Unassigned; hero updates; toast with Undo |
| Block | - | - | - | Opens the confirm dialog: "Block Alex's MacBook Pro?", "It will be disconnected from every eero and can't rejoin Maple Street until you unblock it from Devices > Blocked.", **Cancel** and **Block device** |
| Block device | `device.block {devices: [device]}` | disruptive | Yes, dialog | Status Blocked; hero actions become **Unblock**; toast |
| Unblock | `device.unblock {devices: [device]}` | write | No | Device can rejoin |
| Reserve… / Edit reservation… (header) | Opens the reservation sheet: `reservation.add {device, ip}` or `reservation.update` | write | No | Badge Reserved; toast |
| Reservations & ports → | - | - | No | Reservations & ports |
| Trash on a forward | `forward.remove {forward}` | write | Yes, UI inline ("Remove Web dev server? Port 8080 closes.") | Row removed; toast with Undo (`forward.add` with the same fields) |
| Switch on a disabled forward | `forward.update {forward, enabled}` | write | No | Row enabled or disabled |
| Open a port… | `forward.add {device, description, externalPort, protocol}` (creates the reservation first if needed) | write | No | Sheet with name, port or range, protocol; if the device has no reservation, the sheet says "Port forwards need a reserved address. Mesh UI will reserve 192.168.4.23." and runs both |

## States

- **Loading.** Hero shows name and icon from the list cache if known, `-`
  elsewhere; Live throughput watermark; chart gridlines; cards with labels and `-`.
- **Empty.** No usage: "No activity in this window." No IPv6: IPv6 row `-`.
  No forwards: card body "No ports open to this device." with **+ Open a
  port**.
- **Error.** Per section note with Retry. A device that is gone: "This
  device is no longer on Maple Street." with a link back to Devices.
- **Offline device.** Status Offline with "last seen 2h ago on Upstairs
  Hall"; with Live on, Live throughput reads "Device offline";
  Signal, channel, link rate and SNR show `-`; Pause still allowed (applies
  when it reconnects).
- **Paused.** Status Paused; with Live on, Live throughput reads "Device
  paused"; the first action is Resume device.
- **Blocked.** Status Blocked; with Live on, Live throughput reads "Device
  blocked"; the hero actions are Unblock and Rename…; the profile stays in Device
  settings and the Profile row is dimmed.
- **Wired device.** Signal shows `-`; Device information shows the eero port
  and negotiated speed instead of Wi-Fi standard, channel and SNR.
- **Guest device.** GUEST tag; Pause, the Profile row and port forwarding
  hidden; Block stays.
- **Offline (this computer).** Shell banner; writes disabled; Live throughput shows its watermark.
- **No permission.** Writes disabled with the reason if
  `network.permissions` denies device updates.
- **Capability missing.** Fields eero does not report for this device
  (security type, SNR, retries) show `-`. No burst support: Live throughput hidden.
- **Bridge mode.** Pause, the Profile row, Block, Reserve and Port forwarding
  are hidden; Live throughput hidden; the bridge note sits under the hero.

## Built so far (M2.7, M4.4)

M4.4: Pause and Resume, Change profile (menu of profiles plus Unassigned,
with a check on the current one) and Unblock run at once with an Undo toast.
Block asks in the confirm dialog and then
blocks (toast with Undo). Rename… opens the sheet: nickname with "18 /
32", the hostname and "reset to hostname" (empties the field, so saving
clears the nickname and the device follows its own name), and the 32-type
grid with labels; Save sends only what changed. Each control dims with the
reason from `network.permissions` (devices update), bridge mode and, for
Block, the `device_blacklist` capability.

Still read-only: Edit or Reserve, the trash and switch on a forward, and
+ Open a port stay disabled with "Coming soon" until their commands land
(M5). Live throughput asks
for `device.rates.refresh` once a minute while Live is on and the device is
online (minimized windows included), sharing the engine's one burst per network with Devices.
`[` and `]` follow the Devices table's last row order (groups in order);
opened without it (a restart, a deep link), they follow `device.list` in
the Devices table's remembered sort, without filters. The "No burst
support: Live throughput hidden" and "No permission" states wait for the
capability and permission checks of the write stories.

## Notes

- Nickname max is 32 characters (shown in the sheet). `device.rename` with
  an empty nickname clears it, so the device follows its hostname again.
- The 32 icons in the type grid map to eero's `device_type` values in core
  (`DEVICE_TYPES`); the grid order is fixed so muscle memory holds. Each
  tile carries its label. The grid selects eero's `type`, so a `generic`
  device has Other selected even when its icon shows core's guess
  (`inferredType`). Picking a type drops the guess.
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
- MANUAL: pause and resume one device | device detail, Pause device…, wait,
  Resume device | the device loses and regains internet within seconds and
  the eero app agrees | risk: brief outage for that device.
