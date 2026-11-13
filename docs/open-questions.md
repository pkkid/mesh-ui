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
- 2026-11-13: Mobile-only items are dropped: the Switch to Amazon login row and the Add or replace eero section. ([app-account.md](ux/pages/app-account.md#notes), [eeros.md](ux/pages/eeros.md#notes))
- 2026-11-13: The app id is `io.github.pkkid.meshui` (final). ([build-and-release.md](platform/build-and-release.md#identity))
- 2026-11-13: Windows builds ship unsigned for now (users click through SmartScreen); signing, Azure Trusted Signing preferred, is added before a wider release. ([build-and-release.md](platform/build-and-release.md#windows))
- 2026-11-13: **Remind me** on Updates is dropped; eero's own update notification toggles on App & account cover it. ([updates-admins.md](ux/pages/updates-admins.md#notes))

## Product decisions for the maintainer

- Wording and basis of "MCP connected" on App & account (there is no live connection to detect; base it on the audit log). ([app-account.md](ux/pages/app-account.md#notes))
- Show the command's source file path in the palette preview only in dev builds? ([command-palette.md](ux/pages/command-palette.md#notes))
- Topbar light/dark toggle alongside themes in App & account: proposal is to keep both, the toggle only flips the variant. ([ux/overview.md](ux/overview.md#open-questions))
- Wi-Fi page: move the Save button beside the nickname field, since the time zone saves on change. ([wifi.md](ux/pages/wifi.md#notes))

## Needs a manual check on the real network

- Whether a wrong verification code returns a "tries left" count, and the real error code and message. ([sign-in.md](ux/sign-in.md))
- Whether the sign-in code is always 6 digits (the API accepts 4 to 10). ([sign-in.md](ux/sign-in.md))
- Per-row unread state for notifications, derived from `notifications_history` and `has_unread`: needs a real response shape. ([activity.md](ux/pages/activity.md#notes))
- Does `notifications.list` come from an eero inbox endpoint, or must core build it from `events.list`? ([ux/overview.md](ux/overview.md#open-questions))
- "Ports & temperature" event type and "run from Mesh UI" attribution depend on fields not seen yet. ([activity.md](ux/pages/activity.md#notes))
- Which setting backs the weekly report toggle: `{net}/data_usage/report_settings` or a notifications key? ([app-account.md](ux/pages/app-account.md#notes))
- Guest network behaviour in bridge mode. ([guest.md](ux/pages/guest.md))
- Whether `device.list` reports guest membership (`is_guest`) on firmware without a guest network. ([devices.md](ux/pages/devices.md#notes))
- Whether eero exposes per-device retries outside the mobile app's User-Agent. ([device-detail.md](ux/pages/device-detail.md#notes))
- Whether `eero.firmware.history` has a real per-eero source, or only network-wide history. ([eero-detail.md](ux/pages/eero-detail.md#notes), [commands.md](architecture/commands.md#eero-commandseerots))
- Whether the free eero object includes current per-band `channel_utilization`. ([eeros.md](ux/pages/eeros.md#notes))
- Gateway uptime vs WAN uptime for the Internet hero "up since" line. ([internet.md](ux/pages/internet.md#notes))
- Whether `hide_5g` also hides 6 GHz. ([troubleshooting.md](ux/pages/troubleshooting.md#notes))
- Outage length for `settings.mlo.set` and `settings.legacy_mode.set` (estimated at about 2 to 3 minutes). ([commands.md](architecture/commands.md#restart-estimates))
- "Password changed N days ago" needs a timestamp not yet seen in a response. ([wifi.md](ux/pages/wifi.md#notes))
- Network transfer: the real flow (recipient name, email, phone vs the mockup's QR or link). Never try it on the real network; capture only. ([updates-admins.md](ux/pages/updates-admins.md#notes))
- Response shapes known only from one client: network nickname label, IPv6 lease, coverage and upgrade scans, invite expiry, Simple Setup, integrations. ([commands.md](architecture/commands.md), [data-model.md](architecture/data-model.md))
- Schedule day format: `MON`..`SUN` (LD) vs lowercase (FF). ([commands.md](architecture/commands.md#profile-commandsprofilets))
- `device.rename` with an empty nickname resets to the hostname; `device.type.set` on `/2.3/`. ([commands.md](architecture/commands.md#device-commandsdevicets))

## Needs a technical spike

- A member nickname endpoint for `admin.nickname.set` (only invite nicknames are known). ([commands.md](architecture/commands.md#admins-commandsadminsts), [updates-admins.md](ux/pages/updates-admins.md#notes))
- An email invite endpoint, or "Send invite" stays a `mailto:` with the link. ([updates-admins.md](ux/pages/updates-admins.md#notes))
- A way to stop `eero.find` early; until found, Stop is hidden. ([eeros.md](ux/pages/eeros.md#notes), [commands.md](architecture/commands.md#eero-commandseerots))
- Whether Smart Home Hub (Zigbee discovery) is free or an eero Business feature. ([advanced-networking.md](ux/pages/advanced-networking.md#notes))
- One combined write for Wi-Fi name, password and security, instead of three restarts in sequence. ([wifi.md](ux/pages/wifi.md#notes))
- `usage.get {scope: "eero"}` without an id via `{net}/data_usage/eeros`: verify against the fake server. ([overview.md](ux/pages/overview.md#notes))
- A slow background poll in main for "network offline" desktop alerts while the window is hidden. ([engine.md](architecture/engine.md))
