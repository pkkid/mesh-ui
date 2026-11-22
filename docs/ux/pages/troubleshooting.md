# Troubleshooting

A health check, guided diagnostics by symptom, tools, and the fixes and restarts people reach for when something is wrong. The coverage scan, upgrade report and radio channels moved to [Signal](signal.md) on 2026-11-21.

Mockup: [../../mockups/16-troubleshooting.html](../../mockups/16-troubleshooting.html)

Shared patterns (hero, section cards, status, confirm dialogs) are described in [../overview.md](../overview.md).

## Layout

Breadcrumb `Settings / Troubleshooting`, nothing after it. The page is one full-width column (the 1000px content column), with no side panel: Get help sat in a right-hand column until 2026-11-21 and squeezed the sections, so it moved to the foot of the page. Sections sit `gap-14` apart, each a `Section` with a data-driven description and settings rows (`Row` from `SettingsGroups`) in a card, as on Wi-Fi network and Guest network.

1. **Hero** (the flat page header, no icon tile).
   - Title: what the check found (`1 warning`, `2 problems, 1 warning`; `All checks passed`; `Troubleshooting` while loading).
   - Status line: the overall word as a status (`Good` in success or warning, `Needs attention` in destructive), then `From what eero last reported` muted.
   - Facts: **Checks passed** (`7 of 8`), **Look at first** (the first problem, else the first warning: `Mesh links`; `Nothing`), **Last check** (`just now`).
   - Action: **Run checks again** (outline, dim refresh icon that spins while it runs; `Checking...`).
   - Right-hand column: the score ring (`86`, "Health"), in the overall status colour.
2. **Checks**, subtitle `8 checks, 1 warning` (`all passed`). A two-column grid in one card: per check a dim icon, the name, eero's detail under it (in the warning or danger colour when failing), and on the right its status (a passing check: a green check mark and `Good`; unknown: a muted dot), or for a failing check a link to its fix: **View internet**, **View coverage** (Signal) for mesh links, **View updates** for firmware.
3. **Diagnose a problem**, subtitle `eero tests the network for one symptom, up to a minute` (while one runs, `Testing: My internet is slow`; after, `My internet is slow: eero's diagnostics found nothing wrong`). One row per symptom (My connection drops, My internet is slow, My internet is offline, My eero's light is red), each with a one-line description and **Diagnose**. While it runs the row says eero is testing and the button `Testing...`; eero's findings and the next steps then open under that row, flat (no box of their own), set off like a quote by a 2px bar on the left in the theme's dim colour (`border-muted-foreground/30`): a muted `eero's answer` label over the summary in the warning colour (so the fresh answer stands out), eero's results, then a muted `Next steps` label over the numbered steps. While the network is offline, My internet is offline carries a `Network offline` status.
4. **Tools**, subtitle `Last speed test 942 Mbps down, 2h ago` (`No speed test yet`), led by any mode that is on (`2.4 GHz only on, Last speed test ...`). One card of rows (Fixes was its own section until 2026-11-21; they are all tools):
   - **Speed test** with **Run speed test** and, after it, a **View history** link.
   - **Find an eero** with an eero dropdown and **Blink light** (counts down while it blinks).
   - **2.4 GHz only**: the same row as on [Wi-Fi network](wifi.md) (`Hide5gRow`): when you would want it, **Hide 5 and 6 GHz…** or **Show 5 and 6 GHz…**, eero's countdown while it is on.
   - **Legacy mode** (warning `On` status when on): what it does and what it costs, and **View advanced networking**, where the switch lives.
5. **Restart**, subtitle `4 eeros` (with `1 offline` when one is). One row per eero, each described in the shared restart sentence ("Restarts Office. 6 devices on it lose internet for about 1 minute. Garage connects through it and drops too."; the gateway, with a muted `Gateway` status: "Restarts Living Room, the gateway. Everyone on Maple Street loses internet for about 2 to 3 minutes.") with **Restart Garage…** (the eero's name in the button, so it is clear which one restarts), then the shared Restart network row (as on the eeros page). All buttons are neutral outline with a dim icon: restarts recover on their own, so no red text (design-system.md, Confirmation). Both ask first. Disruptive, so it sits apart near the foot of the page.
6. **Status light colors** (left) beside **Get help** (right), stacked on narrow windows. Neither has a subtitle; the titles say enough.
   - Status light colors: one column, one 28px line per light: a dot the network switcher's size (`size-2`), the light and its meaning. White is the text colour (so it reads on light themes), blue, green and red the theme's series hues, Off a dim dot. The blinking ones fade in and out (`light-blink`, 1.2 s, opacity only; still for reduced motion). These are the eero's real light colours, so they are status, not decoration.
   - Get help: one plain card of 28px label and value lines, no row dividers or descriptions. **Support center** (its address without `https://`, a dim link with the external-link icon that opens the browser), **Email support** (the address with a copy icon), **Call eero** (the number with a copy icon), **Support ID** and **Network ID** (mono, each with a copy icon: a plain grey `ghost-muted` icon button right after the value, no label or outline, a check for a moment once copied), **Diagnostics report** with **Copy report** (outline, dim icon). A contact eero sends nothing for is left out. Every contact comes from eero's `{net}/support` (checked read-only on a real network 2026-11-21: name, phone, help and contact URLs and the `mailto:` email link all present). No ISP row: eero gives only the ISP's name, never its number or site. Footnote under the card: first, that the support center, email and phone number come from eero's API for the network; then that the report shows only the last four characters of names, serials, MAC and IP addresses.

No `Disruptive` badges: the ellipsis on a button and its confirm dialog say it asks first (design-system.md, Buttons and links).

## Data

| Element | Command | Refresh |
| --- | --- | --- |
| Hero, score ring, Checks | `health.check` | on load, on Run checks again; cached result shown with its age |
| Symptom results | `diagnostics.run` `{symptom}` | on demand |
| Find an eero dropdown, Restart rows | `eero.list` | every 60 s |
| Tools subtitle (last speed test) | `internet.get` | shared cache |
| 2.4 GHz mode state and countdown | `wifi.get` (`hide5g` with expiry) | every 15 s while active |
| Legacy mode state | `settings.get` (legacy mode) | every 60 s |
| Device count in the restart confirm | `network.get` | on load |
| Support contacts, Support ID | `support.info` | on load |
| Network ID | `network.get` | on load |
| Diagnostics report text | `support.report` | on demand |

## Actions

| Control | Command | Effect | Confirm | Result |
| --- | --- | --- | --- | --- |
| Run checks again | `health.check`, fetched with `{ fresh: true }` (the CLI and MCP pass `{refresh: true}`) | query | no | One run per click: the button is disabled and says "Checking..." with a spinning icon, the ring and grid fade, then checks refresh. Clicks while it runs are ignored; the fresh report replaces the cached one, so a later poll never shows an older one |
| Diagnose (symptom row) | `diagnostics.run` `{symptom: "connection_drops" or "internet_slow" or "internet_offline" or "eeros_red"}` | write | no | The row says eero is testing (up to a minute), then eero's findings and the next steps from core open under it |
| Run speed test | `speedtest.run` | write | no | Button says "Testing...", then the subtitle shows the new result |
| View history | none (navigation) | | | Internet page speed test history |
| Blink light | `eero.find` `{eero}` | write | no | LED cycles for 30 s |
| Hide 5 and 6 GHz…, Show 5 and 6 GHz… | `wifi.hide5g.set` `{enabled}` | disruptive | confirm dialog with the devices it moves | Countdown starts, or the bands come back |
| View advanced networking | none (navigation) | | | Advanced networking, where the legacy mode switch lives |
| Restart Garage… (single eero) | `eero.restart` `{eero}` | disruptive | confirm dialog; gateway confirm says the whole network goes offline | Row shows "Restarting" until the eero is back |
| Restart network… | `network.restart` | disruptive | confirm dialog | Network offline; page waits and refetches |
| Support center address | none | | | Opens eero's support center in the browser |
| Email support copy icon | none | | | Copies the support email address |
| Support ID copy icon | none | | | Copies the ID |
| Network ID copy icon | none | | | Copies the ID |
| Copy report | `support.report` | query | no | Report text on the clipboard |

## States

- **Loading:** score ring empty with `-`; checks show placeholders; cached last result shown faded with its age if available.
- **All good:** score ring in the success colour, `Good`, no warning pill.
- **Warnings or failures:** failing checks use the warning or danger foreground; the hero summary counts them; each failing check links to its fix (mesh links to Signal's Coverage, firmware to [Updates & admins](updates-admins.md)).
- **Network offline:** Internet check fails, score drops, My internet is offline carries a `Network offline` status; restarts and blink still go through the cloud and may fail with `eero_error`.
- **2.4 GHz mode active:** card shows the countdown; the Wi-Fi network page and sidebar show a small "5 and 6 GHz paused" notice.
- **Error:** inline note per card with **Retry**.
- **Bridge mode:** everything here still applies.
- **No permission:** restarts and modes hidden if `network.permissions` denies them.

## Notes

- `health.check` is composite and built in core from `network.health` (with its issues), `internet.get` (with the last speed test), `eero.list` and `updates.get`; it runs no active probes and does not post a diagnostics run. The score formula lives in core (100 minus 14 per warning, 30 per problem, 5 per unknown, so one warning gives 86) so the CLI and MCP get the same number. The hero word is "Good" for good or warning and "Needs attention" with any problem.
- Built so far (M3.12): the health check hero and checks grid, Tools and restarts (all disabled, "Coming soon"), coverage scan and upgrade report placeholders (disabled, "No scan yet"; no fixtures until M5), and Get help with Copy diagnostics report. The symptom chips are disabled until `diagnostics.run`. Radio channels and the Fixes cards (2.4 GHz mode, legacy mode, status lights) come with their commands.
- Built in M5.8: the symptom chips (`diagnostics.run`) and their panel, Find an eero (eero select and Blink light), the coverage scan with per-room placement tests, the upgrade report, radio channels and the Fixes cards (2.4 GHz mode, legacy mode state, status lights, restart a single eero, restart network). Coverage and upgrade report stack below the 2xl breakpoint so the coverage table keeps its columns.
- The findings line is Mesh UI's wording, not eero's: "eero's diagnostics point to the internet." names eero's `issue_area`; with none (eero answers `none` when it found nothing, mapped to null in core) it says what the results show ("found nothing wrong", "found something to check", "returned no findings").
- `diagnostics.run` posts to `{net}/diagnostics` with a symptom, then reads `GET {net}/diagnostics` every 3 s (first after one interval, so the previous run is not taken for this one) until it is no longer running, and fails `eero_error` after 2 minutes. The placement test waits the same way.
- The 2.4 GHz mode uses the temporary `hide_5g` flag, which auto expires. `wifi.hide5g.set` is disruptive (it moves every 5 and 6 GHz client) and takes no duration: eero sets the end time itself (`temporary_flags.hide_5g.expires_on`, `hide5g.expiresAt` in the model), which drives the countdown, and the engine keeps no timer. Open question: whether the flag also hides 6 GHz (MANUAL check).
- Legacy mode is `{net}/ac_compat`, command `settings.legacy_mode.set` d, separate from `settings.connection_mode.set` (NAT, bridged or IP passthrough).
- Outage estimates come from core (`settings.impact`, see [commands.md](../../architecture/commands.md#restart-estimates)): about 2 to 3 minutes for a network restart and legacy mode, about 1 minute for a leaf eero, about 8 minutes for DNS, DHCP, WAN and connection mode writes on [Advanced networking](advanced-networking.md).
- The diagnostics report never contains the session token, and `support.report` redacts MACs, IPs, names and serials to their last four characters (see [commands.md](../../architecture/commands.md#diagnostics-commandsdiagnosticsts)), so it is safe to paste into a support chat.
- Status light colours are static reference copy.
- Commands added: `support.report` q, `settings.legacy_mode.set` d.
