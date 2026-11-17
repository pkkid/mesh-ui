# Activity

A live stream of the network's events and notification inbox, with a 24 hour chart of events by type. eero's API sends only its last ~15 minutes of events (#263), so Activity shows those plus every event read while the app is open; it offers no way to look further back.

Mockup: [../../mockups/10-activity.html](../../mockups/10-activity.html)

Shared patterns (shell, section cards, status dots, charts, confirms, polling) are described in [../overview.md](../overview.md).

## Layout

Titlebar: title "Activity", **Export CSV** button on the right of the titlebar actions, then the global search and bell.

1. **Events by type** (section, sub line `Since 9:41 AM · per 5 minutes · pick a type or a device to filter the stream`, no header controls). Two cards side by side, 50/50 (stacked on narrow windows), the same height:
   - Left card, compact hero ([design system](../../design/design-system.md)): `58` (`text-2xl`) with `events · last 58 min` beside it, then a share bar of the types filling the rest of the line. Under it the type legend as wrapping chips (colour square, label, count): usually one line, two with all 8 types. The chips double as the type filter: clicking one toggles that type in the chart and the stream (struck through while hidden). Labels are short (Devices, Paused / blocked, Schedules, eero status, Speed tests, Firmware, Admin actions, Ports & temp).
   - Under the legend, the stacked bar chart fills the card's leftover height (at least `h-32`), so a one-line legend gives a taller chart. It covers only the kept events: from the oldest kept event (at least 15 minutes back, at most 24 hours) to now, in about 12 bars whose step fits that span (1, 2, 5, 10, 15 or 30 minutes, 1 or 2 hours). Hover shows the slice (`10:15 to 10:20 AM`) with one row per type and a total. One segment colour per type (`eventCategoryColors` in `lib/chartColors.ts`, hues from the theme series palette; see [design system](../../design/design-system.md#series-colours)).
   - Right card, **Most active**: a breakdown table of the 4 devices, eeros and profiles with the most kept events (name, with `eero` or `profile` after it; a 2px bar in the colour of its main event type, scaled to the top row; event count; last event, relative), then `+ 20 more` when others have events. Clicking a row filters the stream (and the summary) to it, as the Filters popover would; clicking it again clears that filter. Events are matched to names the way stream rows are linked (below).
2. **Event stream** (section, right under Events by type). Header: title, an **Unread notifications** status marker (info dot plus "Unread notifications") while eero's network-wide `has_unread` is set, and the sub line `Newest first · polled every 60 s`; no header tools.
   - **Filter bar** first, the shared list-page filter bar ([design system](../../design/design-system.md#filter-bar)), no card, as on Devices. On its row, right aligned and vertically centred with the search: a live dot ("Live"), segmented toggle **Grouped** / **Raw**, **Mark notifications read** button (`notifications.mark_read`; shown only while the flag is set, and hidden rather than greyed out while it is clear, since events themselves have no read state) and a settings icon button that opens the Notification settings sheet over Activity ([overview.md](../overview.md#notifications-bell)).
     - Left: search ("Filter events", `/` focuses it, Esc clears it) and a **Filters** button with a count of the popover filters that are set. Its popover has a row each for **Device**, **eero** and **Profile** (each "Any" by default), and a footer "2 filters set" with **Clear all**. The Device list is long, so its picker has a type-ahead field (Enter picks the first match).
     - No Range dropdown: the stream is live, so there is no older window to pick.
     - Under the bar, while any is set: one chip per popover filter ("Device: Alex's iPhone", "eero: Living Room", "Profile: Alex") with an x to remove it, a "2 types hidden" chip while the legend hides types (its x shows them all), then **Clear all**, which clears those filters and types (search stays).
   - Day bars: `Today`, `Yesterday`, then weekday names (only while the app stays open that long). Within the last 24 hours each shows the date, that day's event count in the window and a small per hour sparkline strip; an older day shows the date alone.
   - Event rows: time (mono, right aligned), icon, title with bold entities, a muted detail line (entity chip, band, channel, MAC, IP, profile), and a right side slot holding a contextual action or a status.
   - Rows carry no unread dots or counts: eero keeps no read flag per event or notification, only one `has_unread` for the whole network.
   - Grouped rows (e.g. "Garage mesh link dropped to 2 bars", `2 events` badge) show an indented sub list of the underlying events with their times.
   - Footer: **Load older events** button while there is an older page; at the end, "That's every event so far. eero shares only its last 15 minutes; newer ones are added while Mesh UI is open." With no events: "No events yet. New ones show up here as they happen."
   - Row actions: **Assign profile** (profile menu) on a new device that is still Unassigned, **Resume** on a profile pause while the profile is paused, **Unblock** on a block while the device is blocked. Core sets `action` on the newest such row per device or profile; the button shows only while the target still needs it, so Resume goes away once the profile runs again. Each runs the M4 command through the write kit with its success toast and Undo, and a closed gate (the command's own gate) hides it.
   - Links: rows with refs link to their device, profile or eero; firmware rows link to Updates and grouped eero rows to Troubleshooting. The real stream carries no refs (M5.1 capture: 5 of 5 rows had only `hash`, `timestamp_ms`, `description`, `category`), so core links a row by name only where it is unambiguous: exactly one device, eero or profile whose name stands alone in the description (not inside a longer word or a possessive, the longest name wins so "Living Room TV" is the device and not the Living Room eero). A name two things share, or two devices named in one row, links nothing; such a row keeps only its page link, if any, and offers no action.
   - Row menu (M6.10): every row linked to a device ends in a `...` menu with **Rename...** (a small dialog with the nickname; empty uses the device's own name), **Block...** (the block confirm; **Unblock** while the device is blocked) and **Device details**. Rename and Block need the device in the device list, so a device eero no longer lists keeps only Device details. A closed gate (`device.rename`, `device.block` or `device.unblock`) disables the item with its reason, as on Devices.

Row actions shown in the mockup:

| Event | Right side |
| --- | --- |
| New device joined | **Assign profile** button, overflow menu |
| Profile paused | **Resume** button |
| Update available | **Updates** link button |
| Speed test | status "Fast" |
| Mesh link dropped (grouped) | **Diagnose** link button |
| Admin invited | status "Pending" |
| Device blocked | **Unblock** button |
| Firmware installed | status "Installed" |
| eero back online / went offline | status "Online" / "Offline" |
| Temperature high | status "Warm" |

## Data

| Element | Command | Refresh |
| --- | --- | --- |
| Hero total, span and "since" sub line | `events.summary` `{range: "kept", device?, eero?, profile?}` (`total`, `earliest`, `step`) | on load, then with the stream poll |
| Share bar and legend chips | `events.summary` (same call, `counts`) | same |
| Events by type chart | the same call (`buckets`) | same |
| Most active | the same call (`top`, `topMore`) | same |
| Day bar counts and strip | the same call's buckets on that day | same |
| Event stream rows | `events.list` `{cursor?, type?, device?, eero?, profile?, search?, grouped}` | every 60 s while the page is visible |
| Unread marker | `notifications.list` (`unread`, network-wide; the bell's poll) | every 60 s |
| Device, eero, profile filter options | `device.list`, `eero.list`, `profile.list` | on open of the page |

`events.summary` and the filter params on `events.list` are in the [catalogue](../../architecture/commands.md#activity-commandsactivityts). Grouping is done in `src/core` so the CLI and MCP get the same groups as the window.

## Actions

| Control | Command | Effect | Confirm | Result |
| --- | --- | --- | --- | --- |
| Export CSV | `events.list` `{format: "csv", limit: 1000, ...current filters}` | query | no | Save dialog; the file is built in core, every event in the filtered range (up to 1,000) |
| Type legend row | none (view state) | | | Toggles the type in chart and stream |
| Filter text, Filters (Device, eero, Profile) | none (view state, passed to `events.list`) | | | Refetches the stream |
| Filter chip x, Clear all | none | | | Clears that filter (or the hidden types); Clear all clears every chip |
| Grouped / Raw | none (passed as `grouped`) | | | Regroups the stream |
| Mark notifications read | `notifications.mark_read` | write | no | Unread notifications marker, the button itself and the bell dot clear; "Marked all read" toast, no Undo |
| Settings icon | none (opens the sheet) | | | The Notification settings sheet, over Activity |
| Assign profile | `device.profile.set` `{devices: [device], profile}` | write | only when the profile is paused or in a scheduled pause now | Profile menu; "Moved X to Y" toast with Undo; the button goes once the device has a profile |
| Row menu: Rename | `device.rename` `{device, nickname}` | write | no | Dialog; "Renamed to X" toast with Undo; field errors stay in the dialog |
| Row menu: Block, Unblock | `device.block` / `device.unblock` `{devices: [device]}` | disruptive (Block) / write | Block: confirm dialog | "Blocked X" toast with Undo |
| Row menu: Device details | none (navigation) | | | Opens the device page |
| Resume | `profile.resume` `{profile}` | write | no | "Resumed Leo" toast with Undo (`profile.pause`, which asks first); the button goes; a "resumed" event appears on a later poll |
| Unblock | `device.unblock` `{devices: [device]}` | write | no | "Unblocked X" toast with Undo (`device.block`); the button goes |
| Updates, Diagnose | none (navigation) | | | [Updates & admins](updates-admins.md), [Troubleshooting](troubleshooting.md) |
| Load older events | `events.list` `{cursor}` | query | no | Appends the next page |

## States

- **Loading:** keep the layout; on a first load or a range switch, chart and figures fade to `opacity-40` after 150 ms; stream shows placeholder rows of the right height. Background refreshes do not dim them (the topbar Refresh icon spins).
- **Empty:** for a filter with no matches, the stream shows one centred muted sentence ("No events match these filters.") and the chart shows "No activity in this window.".
- **Error:** inline note above the stream with the error message and a **Retry** button; cached rows stay visible.
- **Offline (network down):** the stream still loads from eero's cloud; the hero status elsewhere shows the outage. Poll keeps running.
- **No permission:** admins see everything here. Row actions the user cannot perform (per `network.permissions`) are hidden, not disabled.
- **Live paused:** when the window is hidden the poll stops and the Live dot turns muted; it resumes and refetches on focus.

## Notes

- eero's log is `GET {net}/app_events` (page size 50, `timestamp` cursor). A real network only sends about its last 15 minutes and ignores the cursor (capture 2026-11-16, #263), so the eero backend keeps every event it has read in a log for as long as it runs (up to 15 days, 10,000 events per network) and older pages come from that log. History therefore starts when the app (or a `mesh-ui mcp` session) started reading, not 7 days back; it is lost on quit. A real network answers `{events: [{hash, timestamp_ms, description, category}]}`: no refs and no detail line, and `category` is a bare noun (`device`, `profile`, `eero`), so core picks our type from the description first (paused, schedule, firmware, ...) and the noun second. Notifications come from `GET {net}/notifications_history`; eero only exposes `has_unread` and `mark_read` for all, so Activity shows one network-wide Unread marker and no per row unread state.
- History is about 7 days on free accounts in the eero app, but the API only sends recent events (above), so the stream reaches back only as far as the backend's log, and Activity is designed as a live view: no Range filter, a 24 hour chart, and "Load older events" stops at the end of the log. `events.summary` still takes `range: "week"` for the CLI, MCP and Settings & Account counts.
- Entity filters (device, eero, profile) and text search are applied in core over fetched pages, because `app_events` has no such query params. Large filters may need several pages; show a "Searching older events..." line while it works.
- The event type list is ours, mapped in core from eero's `event_type` strings. Unknown types fall into an "Other" type and still show.
- "Ports & temperature" and "run from Mesh UI" attribution depend on fields we have not seen; keep them if the real data supports them, otherwise drop the type.
- Notification toggles live on [Settings & Account](account-settings.md); the bell in the titlebar opens a short popover of unread events with a link here.
- Commands added: `events.summary` q and filter params on `events.list`. CSV export is `events.list {format: "csv"}`; there is no separate export command.
