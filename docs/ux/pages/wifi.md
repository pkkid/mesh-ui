# Wi-Fi

The main network's name, password, per band security, band summary, nickname and timezone, with a clear picture of who drops when you save.

Mockup: [../../mockups/12-wifi-settings.html](../../mockups/12-wifi-settings.html)

Shared patterns (hero, QR block, settings column plus side panel, confirm bar) are described in [../overview.md](../overview.md).

## Layout

Breadcrumb: `Settings / Wi-Fi`.

1. **Hero.** Wi-Fi icon top left. Title is the SSID (`Maple Street`), status line `Broadcasting` plus "One name on every band". Metric row: **Wireless clients** (`27 of 31 online`) and **Password changed** (`142 days ago`). QR block at the top right ("Wi-Fi Network") with **Copy password**, **Save QR**, **Print a card** to its left.
2. Two columns: settings on the left, side panel on the right.

Left column:

1. **Network name and password.** Two fields side by side. Name with copy icon and a character count (`12 of 32 characters`). Password (mono) with hide, copy and generate icons; an `edited` marker when it differs from the saved value; a 4 step strength bar ("Strong · 25 chars").
2. **Encryption** ("WPA3 support per band"). Header switch **WPA3** (master on or off). Table: Band, Security mode (segmented **Standard (WPA2)** / **Hybrid (WPA2 + WPA3)** / **Enhanced (WPA3)**), and "WPA2 only" devices count. 6 GHz is fixed to Enhanced, other options disabled. Info note: 6 GHz always uses WPA3; choosing Enhanced on 2.4 or 5 GHz asks to confirm and names the WPA2 only devices (HP LaserJet, Ring Doorbell, Nest Thermostat); the section is hidden while Compatibility Mode is on.
3. **Bands** ("All three radios on, managed by eero"). Header button **2.4 GHz only devices** links to [Troubleshooting](troubleshooting.md). Three band cards (2.4, 5, 6 GHz): icon, label, hint, `On` status, client count, Width, Channels, Share of clients. Footnote: eero picks channels automatically, no per band SSID, and which eero lacks a 6 GHz radio.
4. **Nickname and location.** Network nickname field (hint: helps tell networks apart). Timezone select with a `saved` marker and a hint with the local time. A row listing schedules that follow this timezone (profile bedtime, power saving, updates) and a **Save** button.

Side panel:

1. **Impact of saving.** Big figures: devices that disconnect (warning colour) and devices that need setup in their own app. Icon stack of those devices plus a muted list of names. Check list of what stays fine: guest network not affected, wired devices stay online, eeros do not restart.
2. **Tips.** Password advice, a tip to keep the name and change only the password, and a muted line that extra SSIDs (IoT, business) only exist on eero Business and ISP networks.

Bottom: **confirm bar** (sticky) when there are unsaved changes: warning icon, `1 unsaved change · Wi-Fi password`, consequence line (`27 devices will disconnect and must rejoin with the new password`), **Discard** and **Save and reconnect**.

## Data

| Element | Command | Refresh |
| --- | --- | --- |
| SSID, broadcasting state, bands, security per band, password changed date | `wifi.get` | on load, after writes |
| Password for reveal or copy | `wifi.password.get` | on demand only |
| QR payload | `wifi.share` | on demand only |
| Wireless clients metric | `device.list` `{connected: true}` | every 60 s |
| WPA2 only device counts and names | `wifi.impact` `{change: "security", band, security}` | when the selection changes |
| Band cards (width, channels, clients, share) | `wifi.get` (bands) with `eero.list` (radio stats) | every 60 s |
| Nickname | `network.get` | on load |
| Timezone and local time | `settings.get` | on load |
| Schedules that use the timezone | `profile.list`, `settings.get` (power saving), `updates.get` | on load |
| Impact of saving | `wifi.impact` `{change: "name" or "password" or "security"}` | whenever the pending edit changes |

## Actions

| Control | Command | Effect | Confirm | Result |
| --- | --- | --- | --- | --- |
| Copy password, Save QR, Print a card | `wifi.share` | query | no | Clipboard, PNG save dialog, print dialog |
| Name copy icon | none | | | Copies the SSID |
| Password hide, copy | `wifi.password.get` | query | no | |
| Password generate | `wifi.password.generate` | query | no | Fills the field; marks it edited |
| WPA3 master switch | stages `wifi.security.set` for all bands | disruptive | confirm bar | |
| Band security segment | stages `wifi.security.set` `{band24?, band5?}` | disruptive | confirm bar; Enhanced on 2.4 or 5 GHz adds a dialog naming the WPA2 only devices | |
| 2.4 GHz only devices | none (navigation) | | | Opens the fix on [Troubleshooting](troubleshooting.md) |
| Nickname Save | `network.nickname.set` `{nickname}` | write | no | `saved` marker; sidebar switcher updates |
| Timezone select | `settings.timezone.set` `{timezone}` | write | no | Saves on change, `saved` marker |
| Confirm bar Discard | none | | | Reverts staged edits |
| Save and reconnect | `wifi.name.set`, `wifi.password.set`, `wifi.security.set` in that order, each with `confirm: true` | disruptive | the confirm bar plus impact panel is the confirm | Wireless clients drop and rejoin; hero updates |

## States

- **Loading:** hero placeholders; QR frame empty; band cards keep their size and fade.
- **No changes:** confirm bar hidden; impact panel shows "Nothing to save" in muted text and the stays fine list.
- **Saving:** confirm bar shows progress per step ("Saving password..."). If the computer running Mesh UI is on Wi-Fi it will drop too; the bar warns about this before saving, and the app reconnects and refetches when the network returns.
- **Error:** a failed step stops the sequence, keeps later edits staged and shows the eero error in the bar.
- **Compatibility mode on:** Encryption section hidden with one line explaining why and a link to [Troubleshooting](troubleshooting.md).
- **Capability missing:** a band with no radio on any eero is not shown; MLO or WPA3 not supported on older eeros greys out the matching options with a hint.
- **No permission:** inputs read only if `network.permissions` denies Wi-Fi updates.
- **Bridge mode:** everything here still applies (Wi-Fi runs in bridge mode).

## Notes

- Name and password writes go through `PUT {net}` / `PUT {net}/password` and drop every wireless client. Password rules: 8 to 63 printable ASCII. SSID up to 32 bytes; count bytes, not characters.
- Order matters when saving several changes: name, then password, then security, so devices see one final state as quickly as possible. Consider one combined write if the API allows it (open question).
- "Password changed N days ago" needs a timestamp we have not seen in a response. If eero does not expose it, drop the metric (MANUAL check).
- "Need setup in their app" is a heuristic in core: device types that usually cannot be rejoined from a phone (IoT, speakers, printers). Label it as an estimate.
- `wifi.hide5g.set` lives on [Troubleshooting](troubleshooting.md), not here.
- Timezone auto saves per the eero app. The Save button in that section is for the nickname only; consider moving it beside the nickname field so this is obvious.
- Commands added: `wifi.impact` q `{change, band?, security?}`, `wifi.password.generate` q, `settings.timezone.set` w.
