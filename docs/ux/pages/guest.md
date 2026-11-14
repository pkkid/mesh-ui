# Guest network

Turn the guest network on or off, share it, change its name and password, and see who is on it.

Mockup: [../../mockups/11-guest.html](../../mockups/11-guest.html)

Shared patterns (hero, section cards, QR block, inline confirms, tables) are described in [../overview.md](../overview.md).

**Built in M3 (read-only).** Hero with status, guests online and the QR block (Copy password, Save QR), Guest usage, Isolation & security, Name & password shown as values, and Guest devices. Turning the guest network on or off, renaming it and changing the password are disabled "Coming soon" controls until `guest.enable`, `guest.disable`, `guest.rename` and `guest.password.set` land; Print a card and Send to a guest come with them.

## Layout

1. **Hero.** Ticket icon at the left, top aligned with the title. Title is the guest network name (`Maple Street Guest Network`), status line under it (`On` status, "Broadcast on all eeros"). Action row at the bottom: **Turn off guest network** (danger button). Clicking it hides the button and reveals an inline warning confirm: "Turn off guest network? 4 guests are disconnected right away." with **Turn off** and **Cancel**. QR block at the top right: QR code labelled "Guest Network", with labelled buttons to its left: **Copy password**, **Save QR**, **Print a card**.
2. **Guest usage** (left, two thirds). Sub line `6.8 GB in 24 hours, 2% of all network traffic`, segmented toggle **Day** / **Week**. Legend: Download and Upload totals, "Busiest hour 648 MB at 8 PM" on the right. Area chart of download and upload per hour (per day for Week).
3. **Isolation & security** (right, one third). Three diagrams: Guests to Internet (allowed, check), Guests to Maple Street (blocked: NAS, printer, TVs), Guest A to Guest B (blocked). Under a rule, **Encryption** with a link "Same as main network" to [Wi-Fi](wifi.md), then one row per band (2.4 GHz, 5 GHz, 6 GHz) with its security mode.
4. **Name & password** (left half). Sub line "Saving disconnects current guests". Fields: guest network name (hint: must differ from the main name), guest password (mono) with reveal, copy and generate icons, a strength meter ("Strong · 15 characters"). Warning note: clearing the password makes the network open and asks to confirm. **Save** (primary) and **Discard** (ghost).
5. **Send to a guest** (right half). Two rows: **Text message** ("Sends the network name and password") and **Email** ("Opens your mail app with the details filled in").
6. **Guest devices** table. Sub line `4 online · 7 more in the last 7 days`, segmented toggle **All** / **Online** / **Recent**. Columns: Device (icon, name, 2px usage bar), eero, Band, Signal (dBm plus bars, `-` when offline), Last seen, Down, Up, status ("Online" or "Left"). Offline rows are dimmed.

## Data

| Element | Command | Refresh |
| --- | --- | --- |
| Name, on or off, broadcast scope | `guest.get` | on load, after writes |
| QR payload, password for copy | `guest.share` (reveals the password) | once when the hero mounts (guest network on), and again for Copy password; held only in the hero's state, never in the shared query cache, never polled |
| Usage chart, totals, share of network, busiest hour | `usage.get` `{scope: "guest", range: "day" or "week"}` | on load and range change, then every 5 min |
| Isolation diagrams | static copy (eero guests are always isolated) | |
| Encryption per band | `wifi.get` | on load |
| Name and password fields | `guest.get`, then `guest.share` on reveal | on load |
| Guest devices table | `device.list` `{ssid: "guest"}` (devices seen in the last 7 days), Down and Up from `usage.breakdown` `{by: "device", range: "day"}`, eero names from `eero.list` | every 60 s |
| Guest count in the confirm text | `device.list` `{ssid: "guest", connected: true}` | with the table |

## Actions

| Control | Command | Effect | Confirm | Result |
| --- | --- | --- | --- | --- |
| Turn off guest network | `guest.disable` | disruptive | inline confirm, then `confirm: true` | Status turns "Off", button becomes **Turn on guest network** |
| Turn on guest network | `guest.enable` | write | no | Status "On" |
| Copy password | `guest.share` | query | no | Password on clipboard, toast "Copied" |
| Save QR | `guest.share` | query | no | Save dialog for a PNG of the QR |
| Print a card | `guest.share` | query | no | Print dialog with a card: name, password, QR |
| Day / Week | none (passed as `range`) | | | Rebuilds chart |
| Encryption link | none (navigation) | | | Opens [Wi-Fi](wifi.md) |
| Reveal, copy password icons | `guest.share` | query | no | |
| Generate password icon | `wifi.password.generate` | query | no | Fills the field; nothing saved yet |
| Save (name changed) | `guest.rename` `{name}` | disruptive | dialog listing connected guests | Guests drop and rejoin |
| Save (password changed) | `guest.password.set` `{password}` | disruptive | dialog listing connected guests | Guests drop and need the new password |
| Save (password cleared) | `guest.password.set` `{password: null}` | disruptive | stronger dialog: "Anyone nearby can join" | Network becomes open |
| Discard | none | | | Restores the saved values |
| Text message | `guest.share` | query | no | Opens an `sms:` link through the main process |
| Email | `guest.share` | query | no | Opens a `mailto:` link with subject and body filled |
| Table filter All / Online / Recent | none (view state) | | | Filters rows |
| Table row | none (navigation) | | | Opens device detail |

## States

- **Loading:** hero title and status placeholders; QR box shows an empty frame; chart keeps its height and fades.
- **Guest network off:** status "Off"; QR block, Copy password, Send to a guest and the usage chart are hidden or muted with one line "Turn the guest network on to share it."; Name & password stays editable so it can be set before turning on.
- **Empty usage:** "No guest activity in this window."
- **No guests:** table shows "No guests in the last 7 days."
- **Error:** inline note in the failing section with **Retry**; a failed write keeps the edited values and shows the eero error.
- **No permission:** admins can do everything here. If `network.permissions` denies guest updates, inputs and the power button are read only.
- **Network offline:** the status line says "Network offline, showing the last known settings".
- **Open network (no password):** a warning status "Open, no password" in the hero, no Copy password, the QR joins without a password, and each band reads "Open, no password".
- **Bridge mode:** isolation needs eero's NAT, so guest support in bridge mode is unclear (open question). If the network object reports the guest network unavailable, show a note "Guest network is not available in bridge mode" and hide the rest.

## Notes

- `PUT {net}/guestnetwork` with `enabled=false` drops every guest at once, hence `guest.disable` is disruptive while `guest.enable` is a plain write.
- The name must differ from the main SSID. Validate in the zod schema (`bad_params`) so the CLI gets the same rule.
- Password rules match the main network: 8 to 63 printable ASCII. Clearing uses `DELETE {net}/guestnetwork/password`.
- The QR payload is the standard `WIFI:T:WPA;S:<name>;P:<password>;;` string built in core by `guest.share`. The renderer only draws it. Because it reveals the password, `guest.share` is never polled.
- Strength scoring is a pure helper in `src/core`, used by the zod schema and imported by the renderer for the meter.
- `sms:` and `mailto:` links are opened by the main process with `shell.openExternal`, which is allowed by the navigation lockdown only for those schemes.
- Usage range labels are Day / Week, like the rest of the app (the mockup was changed from 24H / 7D).
- Commands added: `wifi.password.generate` q (shared with Wi-Fi).
