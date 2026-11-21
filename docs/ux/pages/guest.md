# Guest network

Turn the guest network on or off, share it, change its name and password, and see who is on it.

Mockup: [../../mockups/11-guest.html](../../mockups/11-guest.html)

Shared patterns (hero, section cards, QR block, confirm dialogs, tables) are described in [../overview.md](../overview.md).

**Built in M3 (read-only), writes in M4.** Hero with status, guests online, the power button (Turn on, or Turn off… behind the confirm dialog) and the QR code with Copy invite under it (earlier: Copy password, Save QR, Print a card, Send to a guest), Guest usage, Isolation & security, Name & password with its edit sheet, and Guest devices.

## Layout

1. **Hero** (the flat page header, [design system](../../design/design-system.md#page-header-hero)). No icon tile (list pages have none). Title is the guest network name alone (it usually ends in "Guest" already, and the breadcrumb says Guest network) (`Maple Street Guest Network`), status line under it (`On` status, "Broadcast on all eeros"; `Off`, "Guests cannot join while it is off"). While on, three facts: **Online now** (`1`), **Recently left** (guests seen in the last 7 days who are gone: `1 · latest 3d ago`) and **Data in 24 hours** (`2.8 GB · under 1% of all traffic`), from the same `device.list {ssid: guest}` and `usage.get` queries as Guest devices and Guest usage (shared cache, no extra eero calls). Action row at the bottom: the power button, then **Copy invite** to its right (while on, outline with a dim copy icon; placed after Turn off by choice, an exception to disruptive-last): **Turn off guest network…** while on (outline with a dim icon; it confirms in the dialog first, hence the ellipsis; never a filled red button), **Turn on guest network** while off (the filled primary button: the one bold step on an off page). While on, the right-hand column is the plain QR code ([design system](../../design/design-system.md#components): round dots, rounded corner markers, no tile, border or logo, level L) 130px in a 1px rounded frame (12px radius) with 15px of padding, with no buttons beside it and no caption (only "Couldn't load the code" if the share fails).
2. **Guest usage** (left, two thirds, beside Isolation & security; both cards the same height). Subtitle under the title, from the data: `24 hours, 2.9 GB, under 1% of all traffic` (`24 hours, no guest traffic` when empty). A **Last 24 hours** / **Last 7 days** dropdown in the section header (never a pill toggle). One card drawn like the Internet page's Per hour card (shared `Legend` and `Stat`): the legend (Download and Upload arrows with bold totals), the area chart of download and upload per hour (per day for Last 7 days) filling the card, a rule, then a stats row: **Busiest hour** (`7 PM 282 MB`; **Busiest day** with a weekday for Last 7 days), **Max down**, **Max up**.
3. **Isolation & security** (right, one third). Subtitle `Internet only, same encryption as Maple Street` (`Internet only, open with no password` on an open network). Three diagrams: Guests to Internet (allowed, check), Guests to Maple Street (blocked), Guest A to Guest B (blocked). Under a rule, **Encryption** with a dim **View Wi-Fi network** text link to [Wi-Fi network](wifi.md), then one row per band (2.4 GHz, 5 GHz, 6 GHz) with its security mode.
4. **Name & password**. Subtitle under the title, from the data: "Saving disconnects 1 guest now online", "No guests online, so saving disconnects no one", or "Off, so saving disconnects no one". **Edit name and password…** is an outline button in the section header. The card holds two settings rows (title, muted description, value on the right), never read-only values drawn as inputs: **Name** ("Must be different from your main network name, Maple Street.") with the name, and **Password** (description by state: "Copy it or share the QR code above.", "Set it now; guests use it once the network is on.", or "Anyone nearby can join an open network.") with dots, or a warning status "Open, no password". The button opens the **Name & password sheet**, a clean sheet (no divider lines under the header or above the footer): guest network name (helper "18 of 32 characters, must be different from <main name>"), guest password (mono, prefilled from `guest.share` when the sheet opens) with reveal, copy and generate icon buttons (each with a tooltip), a strength meter ("Strong, 16 characters"). Clearing the password shows a warning note (the network becomes open) and the confirm says so. **Save** and **Cancel**; Cancel with changes asks "Discard changes?".
5. **Copy invite** is the outline hero button after Turn off: it copies a short invite ("Join our guest Wi-Fi. Network: ... Password: ...", or "No password needed.") with an "Invite copied" toast. The header has no Copy password, Save QR or Print a card (dropped; the Wi-Fi network page keeps its own QR code, Save QR and printed card).
6. **Guest devices** table. Subtitle `1 online, 1 more in 7 days` (`None in 7 days` when empty). A **Show** dropdown in the section header: **All guests**, **Online now**, **Left this week**. Columns: Device (icon, name, 2px usage bar), eero, Band, Signal (dBm plus bars, `-` when offline), Last seen, Down, Up, status ("Online" or "Left"). Offline rows are dimmed.

## Data

| Element | Command | Refresh |
| --- | --- | --- |
| Name, on or off, broadcast scope | `guest.get` | on load, after writes |
| QR payload, password for copy | `guest.share` (reveals the password) | once when the hero mounts (guest network on), and again for Copy invite; held only in the hero's state, never in the shared query cache, never polled |
| Usage chart, totals, share of network, busiest hour | `usage.get` `{scope: "guest", range: "day" or "week"}` | on load and range change, then every 5 min |
| Isolation diagrams | static copy (eero guests are always isolated) | |
| Encryption per band | `wifi.get` | on load |
| Name and password fields | `guest.get`, then `guest.share` on reveal | on load |
| Guest devices table | `device.list` `{ssid: "guest"}` (devices seen in the last 7 days), Down and Up from `usage.breakdown` `{by: "device", range: "day"}`, eero names from `eero.list` | every 60 s |
| Guest count in the confirm text | the write's `needs_confirm` message (core counts the guests online) | when asked |

## Actions

| Control | Command | Effect | Confirm | Result |
| --- | --- | --- | --- | --- |
| Turn off guest network… | `guest.disable` | disruptive | confirm dialog with the engine's message, then `confirm: true` | Progress toast, then "Guest network off" with Undo; status turns "Off", button becomes **Turn on guest network** |
| Turn on guest network | `guest.enable` | write | no | Status "On", toast "Guest network on" with Undo (Undo turns it off, which asks first) |
| Range: Last 24 hours / Last 7 days | none (passed as `range`) | | | Rebuilds chart |
| View Wi-Fi network | none (navigation) | | | Opens [Wi-Fi network](wifi.md) |
| Reveal, copy password icons | `guest.share` | query | no | |
| Generate password icon | `wifi.password.generate` | query | no | Fills the field; nothing saved yet |
| Edit name and password… | none | | | Opens the sheet |
| Save (name changed) | `guest.rename` `{name}` | disruptive | dialog with the guests it drops | Guests drop and rejoin |
| Save (password changed) | `guest.password.set` `{password}` | disruptive | dialog with the guests it drops | Guests drop and need the new password; the QR is read again |
| Save (password cleared) | `guest.password.set` `{password: null}` | disruptive | "Make the guest network open?": "anyone nearby can join" | Network becomes open |
| Save (both changed) | `guest.password.set`, then `guest.rename` | disruptive | one dialog (the password's) covers both | One toast for both |
| Copy invite (hero button) | `guest.share` | query | no | Copies the invite text, toast "Invite copied" |
| Show: All guests / Online now / Left this week | none (view state) | | | Filters rows |
| Table row | none (navigation) | | | Opens device detail |

## States

- **Loading:** hero title and status placeholders; QR box shows an empty frame; chart keeps its height and fades.
- **Guest network off:** the hero keeps the name, status "Off" and its one action, the filled **Turn on guest network** (no QR block). Usage, Isolation & security and Guest devices give way to an off watermark (no card, [design system](../../design/design-system.md#buttons-and-links)): a large dim power glyph and "Guest network off", centred in a `h-40` band, decoration only. Name & password stays under it, editable, so they can be set before turning on. While `guest.get` is still loading, the on layout shows its placeholders.
- **Empty usage:** the Guest usage card keeps the chart card's full height (its legend, chart and stats rows laid out but hidden) and shows the dim watermark Devices uses while Live throughput is off, centred: a `ChartArea` glyph (`size-12`, `text-foreground/7`) beside "No guest network activity" (`font-semibold text-xl text-foreground/13`). Screen readers get "No guest network activity in this window."
- **No guests:** table shows "No guests in the last 7 days."
- **Error:** inline note in the failing section with **Retry**; a failed write keeps the edited values and shows the eero error.
- **No permission:** admins can do everything here. If `network.permissions` denies `settings` updates, the power button and Edit name and password are dimmed with the reason.
- **Failed write:** the control keeps its old state and an error toast offers Retry; in the sheet a `bad_params` lands under its field (the main-name check under the name) and other errors under the form, with the edits kept.
- **Network offline:** the status line says "Network offline, showing the last known settings".
- **Open network (no password):** a warning status "Open, no password" in the hero, the QR joins without a password and the invite says "No password needed.", and each band reads "Open, no password".
- **Bridge mode:** isolation needs eero's NAT, so guest support in bridge mode is unclear (open question). If the network object reports the guest network unavailable, show a note "Guest network is not available in bridge mode" and hide the rest.

## Notes

- `PUT {net}/guestnetwork` with `enabled=false` drops every guest at once, hence `guest.disable` is disruptive while `guest.enable` is a plain write.
- The name must differ from the main SSID (ignoring case). Core checks it before the confirm and answers `bad_params` on `name`, so the CLI and MCP get the same rule.
- Password rules match the main network: 8 to 63 printable ASCII. Clearing uses `DELETE {net}/guestnetwork/password`.
- The QR payload is the standard `WIFI:T:WPA;S:<name>;P:<password>;;` string built in core by `guest.share`. The renderer only draws it. Because it reveals the password, `guest.share` is never polled.
- Strength scoring is a pure helper in `src/core`, used by the zod schema and imported by the renderer for the meter.
- Usage range labels are Last 24 hours / Last 7 days in a dropdown, like Overview's Data usage (the mockup had 24H / 7D pills).
- Commands added: `wifi.password.generate` q (shared with Wi-Fi).
