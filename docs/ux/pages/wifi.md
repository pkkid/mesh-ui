# Wi-Fi

The main network's name, password, per band security, band summary, nickname and timezone, with a clear picture of who drops when you save.

Mockup: [../../mockups/12-wifi-settings.html](../../mockups/12-wifi-settings.html)

Shared patterns (hero, QR block, settings column plus side panel, confirm bar) are described in [../overview.md](../overview.md).

## Built in M3.9 (read view)

In M3.9 the page was read-only; M4.7 (below) added the writes. The rest of this section is still how the read view works.

- **Hero:** SSID, `Broadcasting` / `Not broadcasting` / `Offline`, "One name on every band" (or on the one band), **Wireless clients** and **Bands on** (`3 of 3`). "Password changed" is not shown: no response carries that date.
- **QR block:** an empty muted frame with a **Show code** button (eye icon, neutral outline) centred in it; nothing is read until it is clicked, then it runs `wifi.share` and the code replaces the button where it was. There is no separate Show code button beside the frame. **Copy password** and **Save QR** work from then on. **Print a card** is "Coming soon".
- **Name and password:** read-only fields. The name has copy and a byte count. The password shows dots until the eye reveals it; copy reads it on demand. Generate and **Change** are "Coming soon". The revealed password and QR payload live only in the page's state, are never polled or cached, and are dropped on a network switch.
- **Encryption:** one row per band with a segmented control showing the current mode (other modes disabled). The WPA2 only column counts connected devices that joined a hybrid band with WPA2 (an estimate from each device's link security); it shows `-` for a WPA2 only or WPA3 band and while offline. The info note names them.
- **Bands:** a card per band any eero offers (a single-band network shows one card), with On or Off, clients, widths, channels and share of clients, and the 2.4 GHz only state with its expiry.
- **Nickname and location:** nickname and time zone from `network.get`, with the local time there. Edit is "Coming soon".
- Not yet: the impact panel and confirm bar (with the write commands), WPA3 master switch, compatibility mode hiding, schedule list.

## Built in M4.7 (writes)

Name, password, security and 2.4 GHz only now change through the write kit; every save is disruptive and asks inline first, with the engine's `needs_confirm` message (the `wifi.impact` summary). Nickname, time zone and Print a card stayed "Coming soon" (time zone came in M5, below). Controls dim with the "no permission" tooltip when `network.permissions` denies `settings` updates, and while the network is offline.

- **Name and password sheet** (**Change**): the name with a live byte count (32 bytes), and a new password that starts empty (the current one is never read to fill it; empty keeps it), with show and **Generate** (`wifi.password.generate`). The impact panel sits under the fields. **Save and reconnect** runs `wifi.name.set`, then `wifi.password.set`, each after a confirm dialog over the sheet; a progress toast while it runs, then a success toast. After either, the revealed password and QR are dropped, so the next reveal reads the new ones (M4.2's credential bypass). No Undo: these writes are disruptive and the old password is never held.
- **Encryption:** 2.4 and 5 GHz segments stage a change (`edited` marker); a staged change shows the impact panel (devices that disconnect, WPA2 only devices that can not rejoin a WPA3 band, the restart estimate) with **Discard** and **Save and restart**, which asks inline before `wifi.security.set`. 6 GHz stays Enhanced (WPA3).
- **2.4 GHz only** (in Bands, `Disruptive` badge): off, it says when you would want it (setting up an older or smart home device that can't find the Wi-Fi; leave it off otherwise) and what it costs (5 and 6 GHz hidden for a while, phones and laptops on 2.4 GHz until eero ends it). **Turn on** has a tooltip saying the same and asks inline with the impact (devices on 5 and 6 GHz that move); while on, a mono countdown to eero's own expiry and **Turn off**. The copy is shared with Troubleshooting (`src/core/hide5g.ts`). eero does not say the length ahead of time, so the copy says "for a while". The task brief put this switch here, so the Troubleshooting note below changed.
- **Impact panel** (`WifiImpact.tsx`): reads `wifi.impact` for the pending change; two figures (devices disconnect in warning colour; may need their own app, or can't rejoin for security), the summary from core with the names, and a check list of what stays fine.
- Not yet: the side panel layout and sticky confirm bar from the mockup (the impact panel sits with each control instead), WPA3 master switch, "Password changed".

## Built in M5 (time zone)

- **Time zone sheet** (Nickname and location > **Edit**, `TimezoneSheet.tsx`): a select of IANA zones (the runtime's list, plus the current zone if missing), the local time in the chosen zone, and the `settings.impact` panel ("Nothing restarts; schedules follow the new time zone"). **Save** runs `settings.timezone.set` (a `write`, no confirm), then a toast "Time zone set to ..." with **Undo**, which sets the old zone back. If eero answers but keeps the old zone, the command fails with that reason (an error toast with Retry), so the toast never names a zone eero did not save. Edit dims with the gate's reason (settings permission) and while the network is offline.
- The network nickname stays read only: no command sets it yet (M6). **Print a card** is still "Coming soon" (M6).

## Built in M6.9 (nickname, Print a card, time zone)

- **Nickname and location** has one pencil per field, inside the field like the copy icons above. Each dims with the gate's reason, and while the network is offline. The bottom row keeps the "follow this time zone" line; the separate Edit button is gone.
- **Nickname sheet** (`NicknameSheet` in `WifiPage.tsx`): one text field with a live "n of 32 characters" count; empty clears it. **Save** runs `network.nickname.set` (a `write`, no confirm, gate `network`), then a toast "Nickname set to ..." (or "Nickname cleared") with **Undo**, which sets the old nickname back. The command reads the nickname back from `network.list` (the account's network refs as well as `GET {net}`); if eero keeps the old nickname it fails with that reason (an error toast with Retry). `network.list` is refetched too, so the network switcher follows. The request is `PUT {net}/label?labelType=specialMarket` form `label`, which Eeronaut sends quoting eero's Android client. Clearing sends an empty `label`; no client clears it, so that is a MANUAL check.
- **What the nickname is for (#270).** It names the network in the sidebar switcher and the Networks table (the Wi-Fi name moves to the muted line), and in eero's app network list. The field is always shown, as in eero's app (Settings > Nickname & location). The field and the sheet say: "A name for this network in Mesh UI and the eero app, handy if you manage more than one. Your Wi-Fi name doesn't change." The page reads the nickname from `network.list`, like the switcher.
- **Print a card** (hero, beside Copy password and Save QR): reads `wifi.share`, the same read as **Show code** (it runs it first if the code is not shown yet), and prints the guest card layout (`GuestCard.tsx`) titled "Wi-Fi": the QR code, the network name and the password, black on white. No new command.
- **Time zone on a live network is read only.** The eero backend has no time zone write, so `settings.timezone.set` answers "not available yet" there and sends nothing. The only request any client sends, `PUT {net}/settings` JSON `{timezone: {value}}`, answered 200 on a real network and kept the old zone (M5.R-fix4, M5 review). No client has tested a time zone write live (endpoints.md section 20). On the eero backend (`app.info` `backend: eero`, the fake server included) the time zone pencil dims with "Change the time zone in the eero app: eero keeps the old zone when Mesh UI sends it", and the line under the fields adds "Change it in the eero app." Demo still applies it through the M5 sheet. If a working request turns up, add `setTimezone` back to the eero backend and drop the gate.

## Name and password beside Encryption (#268)

- **Name and password** and **Encryption** sit side by side once the page content is at least 48rem wide (a container query on the pair, so it follows the sidebar too), and stack full width below that. Bands stays full width below them. Both cards stretch to the taller one.
- Beside Encryption the name and password fields stack; full width they sit side by side again.
- The read-only name and password fields have no helper lines: the byte count lives only in the Change sheet, and "Hidden until you reveal it" and the revealed "N characters" are gone. A failed reveal still shows its error under the password.
- **Encryption** uses short segment labels, **WPA2** / **Hybrid** / **WPA3**, with no icons; each option's tooltip is eero's full name (Standard (WPA2), Hybrid (WPA2 + WPA3), Enhanced (WPA3)). The section subtitle explains them ("WPA3 is stronger; Hybrid adds WPA2 for older devices"). No control scrolls sideways; the device count per band stays on the right.

## Layout

Breadcrumb: `Settings / Wi-Fi`.

1. **Hero.** Wi-Fi icon top left. Title is the SSID (`Maple Street`), status line `Broadcasting` plus "One name on every band". Metric row: **Wireless clients** (`27 of 31 online`) and **Password changed** (`142 days ago`). QR block at the top right ("Wi-Fi Network") with **Copy password**, **Save QR**, **Print a card** to its left. Before reveal the frame is empty with **Show code** centred on it.
2. Two columns: settings on the left, side panel on the right.

Left column:

1. **Network name and password** (beside Encryption on wide pages, #268). Two fields, stacked beside Encryption and side by side full width. Name with copy icon and a character count (`12 of 32 characters`). Password (mono) with hide, copy and generate icons; an `edited` marker when it differs from the saved value; a 4 step strength bar ("Strong · 25 chars").
2. **Encryption** ("WPA3 support per band"). Header switch **WPA3** (master on or off). Table: Band, Security mode (segmented **WPA2** / **Hybrid** / **WPA3**, full names in tooltips), and "WPA2 only" devices count. 6 GHz is fixed to Enhanced, other options disabled. Info note: 6 GHz always uses WPA3; choosing Enhanced on 2.4 or 5 GHz asks to confirm and names the WPA2 only devices (HP LaserJet, Ring Doorbell, Nest Thermostat); the section is hidden while Compatibility Mode is on.
3. **Bands** ("All three radios on, managed by eero"). Three band cards (2.4, 5, 6 GHz): icon, label, hint, `On` status, client count, Width, Channels, Share of clients. Footnote: eero picks channels automatically, no per band SSID, and which eero lacks a 6 GHz radio.
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
| WPA2 only device counts and names | `wifi.impact` `{change: "security", band24?, band5?}` | when the selection changes |
| Band cards (width, channels, clients, share) | `wifi.get` (bands) with `eero.list` (radio stats) | every 60 s |
| Nickname | `network.get` | on load |
| Timezone and local time | `settings.get` | on load |
| Schedules that use the timezone | `profile.list`, `settings.get` (power saving), `updates.get` | on load |
| Impact of saving | `wifi.impact` `{change: "name" or "password" or "security" or "hide5g"}` | whenever the pending edit changes |

## Actions

| Control | Command | Effect | Confirm | Result |
| --- | --- | --- | --- | --- |
| Copy password, Save QR, Print a card | `wifi.share` | query | no | Clipboard, PNG save dialog, print dialog |
| Name copy icon | none | | | Copies the SSID |
| Password hide, copy | `wifi.password.get` | query | no | |
| Password generate | `wifi.password.generate` | query | no | Fills the field; marks it edited |
| WPA3 master switch | stages `wifi.security.set` for all bands | disruptive | confirm bar | |
| Band security segment | stages `wifi.security.set` `{band24?, band5?}` | disruptive | confirm dialog naming the WPA2 only devices that can not rejoin | |
| 2.4 GHz only Turn on / Turn off | `wifi.hide5g.set` `{enabled}` | disruptive | confirm dialog with the impact | Countdown to `hide5g.expiresAt` |
| Nickname pencil, sheet Save | `network.nickname.set` `{nickname}` (empty clears) | write | no | Toast with Undo (sets the old nickname back); network switcher updates |
| Time zone pencil, sheet Save | `settings.timezone.set` `{timezone}` | write | only when the new zone starts a scheduled pause now (dialog over the sheet) | Toast with Undo (sets the old zone back). Demo only: dimmed on the eero backend (M6.9) |
| Confirm bar Discard | none | | | Reverts staged edits |
| Save and reconnect | `wifi.name.set`, `wifi.password.set`, `wifi.security.set` in that order, each with `confirm: true` | disruptive | the confirm bar plus impact panel is the confirm | Wireless clients drop and rejoin; hero updates |

## States

- **Loading:** hero placeholders; QR frame empty with **Show code** disabled; band cards keep their size and fade.
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
- `wifi.hide5g.set` is on this page (Bands, since M4.7) and may also be offered from [Troubleshooting](troubleshooting.md).
- Timezone auto saves per the eero app. Mesh UI edits the nickname and the time zone in separate sheets, each from its own pencil (M6.9).
- The SSID goes through `PUT {net}/settings` form `name` (FF live-verified); some clients use `PUT {net}`. Real behaviour is a MANUAL check.
- Commands added: `wifi.impact` q `{change, band24?, band5?}`, `wifi.password.generate` q, `settings.timezone.set` w, `network.nickname.set` w (M6.9).
