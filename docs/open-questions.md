# Open questions

Every open question raised in the docs, in one list. Each line links to the
doc that raised it; the question stays there too, in short form. When one is
settled, update that doc and remove the line here.

Routine `MANUAL:` verification lines (pause a device, rename an eero and so
on) are not questions; they stay in their page docs and the milestone review
gathers them ([testing.md](testing.md#manual-checks)).

## Decided

- 2026-11-13: No timed pauses. Pausing a device or profile lasts until resumed; `profile.pause` has no `minutes` and the engine keeps no resume timers. `wifi.hide5g.set` keeps eero's own expiry only. ([commands.md](architecture/commands.md#profile-commandsprofilets))
- 2026-11-13: **Apply at 2 AM** is dropped from Advanced networking; changes apply now, with the restart warning. No engine scheduler. ([advanced-networking.md](ux/pages/advanced-networking.md))
- 2026-11-13: Items with no known API are left out of the app: Adaptive Ethernet, per-device eero Built-in switches (one network-wide switch stays) and Schedule a pause on Unassigned. ([advanced-networking.md](ux/pages/advanced-networking.md#notes), [profiles.md](ux/pages/profiles.md#notes))
- 2026-11-13: Mobile-only items are dropped: the Switch to Amazon login row and the Add or replace eero section. ([account.md](ux/pages/account.md#notes), [eeros.md](ux/pages/eeros.md#notes))
- 2026-11-13: The app id is `io.github.pkkid.meshui` (final). ([build-and-release.md](platform/build-and-release.md#identity))
- 2026-11-13: Windows builds ship unsigned for now (users click through SmartScreen); signing, Azure Trusted Signing preferred, is added before a wider release. ([build-and-release.md](platform/build-and-release.md#windows))
- 2026-11-13: **Remind me** on Updates is dropped; eero's own update notification toggles on Account cover it. ([updates-admins.md](ux/pages/updates-admins.md#notes))
- 2026-11-14: macOS builds ship unsigned for now (ad-hoc signature, not notarized; no Apple secrets). Users open the app once with **Open Anyway** in System Settings > Privacy & Security, and update by hand from the release page, since an unsigned Mac copy only checks for updates. Developer ID signing and notarization are parked under After M6. ([build-and-release.md](platform/build-and-release.md#macos))
- 2026-11-14: Settings says "MCP used <age>" (or "MCP not used yet") from the audit log, never "MCP connected": there is no live connection to detect. ([settings.md](ux/pages/settings.md#notes))
- 2026-11-14: The weekly report row is not built in M6: no `report_settings` capture exists, so there is no known key. eero's own `network.dataUsageReport` alert key still shows as "Data usage report". The row can return once a capture names the setting. ([settings.md](ux/pages/settings.md#notes))

## Product decisions for the maintainer

- Show the command's source file path in the palette preview only in dev builds? ([command-palette.md](ux/pages/command-palette.md#notes))
- Topbar light/dark toggle alongside themes on the Application page: proposal is to keep both, the toggle only flips the variant. ([ux/overview.md](ux/overview.md#open-questions))
- Wi-Fi page: move the Save button beside the nickname field, since the time zone saves on change. ([wifi.md](ux/pages/wifi.md#notes))

## Needs a manual check on the real network

- Whether a wrong verification code returns a "tries left" count, and the real error code and message. ([sign-in.md](ux/sign-in.md))
- Whether the sign-in code is always 6 digits (the API accepts 4 to 10). ([sign-in.md](ux/sign-in.md))
- Per-row unread state for notifications, derived from `notifications_history` and `has_unread`: needs a real response shape. ([activity.md](ux/pages/activity.md#notes))
- Does `notifications.list` come from an eero inbox endpoint, or must core build it from `events.list`? ([ux/overview.md](ux/overview.md#open-questions))
- "Ports & temperature" event type and "run from Mesh UI" attribution depend on fields not seen yet. ([activity.md](ux/pages/activity.md#notes))
- Account writes (name, email, mobile, Stay up to date, push switches) and the network nickname label type: need the read-only captures of endpoints.md section 20 before the live client sends them. ([account.md](ux/pages/account.md#notes), [endpoints.md](eero-api/endpoints.md))
- Guest network behaviour in bridge mode. ([guest.md](ux/pages/guest.md))
- Whether `device.list` reports guest membership (`is_guest`) on firmware without a guest network. ([devices.md](ux/pages/devices.md#notes))
- Whether eero exposes per-device retries outside the mobile app's User-Agent. ([device-detail.md](ux/pages/device-detail.md#notes))
- Whether `eero.firmware.history` has a real per-eero source, or only network-wide history. ([eero-detail.md](ux/pages/eero-detail.md#notes), [commands.md](architecture/commands.md#eero-commandseerots))
- Whether the free eero object includes current per-band `channel_utilization`. ([eeros.md](ux/pages/eeros.md#notes))
- Gateway uptime vs WAN uptime for the Internet hero "up since" line. ([internet.md](ux/pages/internet.md#notes))
- Whether `hide_5g` also hides 6 GHz. ([troubleshooting.md](ux/pages/troubleshooting.md#notes))
- Outage length for `settings.mlo.set` and `settings.legacy_mode.set` (estimated at about 2 to 3 minutes). ([commands.md](architecture/commands.md#restart-estimates))
- "Password changed N days ago" needs a timestamp not yet seen in a response. ([wifi.md](ux/pages/wifi.md#notes))
- Network transfer: what the recipient sees and whether eero sends it by text when given a phone (built from the LD client in M5.6; never tried on the real network). ([updates-admins.md](ux/pages/updates-admins.md#notes))
- Response shapes known only from one client: network nickname label, IPv6 lease, invite expiry, Simple Setup, integrations. ([commands.md](architecture/commands.md), [data-model.md](architecture/data-model.md))
- Schedule day format: sent as "Monday".."Sunday" (Eeronaut, from eero's field errors; LD's `MON` and FF's `monday` are refused). Not yet tried by us on a real network (M5.R-fix7 MANUAL check). ([commands.md](architecture/commands.md#profile-commandsprofilets))
- `device.rename` with an empty nickname resets to the hostname; `device.type.set` on `/2.3/`. ([commands.md](architecture/commands.md#device-commandsdevicets))

## Needs a technical spike

- Whether `POST {net}/invites` answers an invite id (the clients read only `invite_url`; core finds the new row by reading the invites again). ([commands.md](architecture/commands.md#admins-commandsadminsts))
- A way to stop `eero.find` early; until found, Stop is hidden. ([eeros.md](ux/pages/eeros.md#notes), [commands.md](architecture/commands.md#eero-commandseerots))
- Whether Smart Home Hub (Zigbee discovery) is free or an eero Business feature. ([advanced-networking.md](ux/pages/advanced-networking.md#notes))
- One combined write for Wi-Fi name, password and security, instead of three restarts in sequence. ([wifi.md](ux/pages/wifi.md#notes))
- `usage.get {scope: "eero"}` without an id via `{net}/data_usage/eeros`: verify against the fake server. ([overview.md](ux/pages/overview.md#notes))
