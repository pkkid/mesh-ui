# Activity

A live stream of the network's events and notification inbox, under a hero with a chart of events over time. eero's API sends only its last ~15 minutes of events (#263), so Activity shows those plus every event read while the app is open; it offers no way to look further back.

Mockup: [../../mockups/10-activity.html](../../mockups/10-activity.html)

Shared patterns (shell, section cards, status dots, charts, confirms, polling) are described in [../overview.md](../overview.md).

## Layout

Titlebar: breadcrumbs only (no page actions), then the global search, Refresh and bell.

1. **Hero** (the flat page header, [design system](../../design/design-system.md#page-header-hero)), from `events.summary {range: "kept"}` with no filters, so it always covers every kept event:
   - Title: the kept event count (`64 events`; `Activity` while loading).
   - Status line: a **Live** dot (muted **Paused** while the window is hidden and the poll stops), `Kept since 9:41 AM` (with the date on an earlier day), and an **Unread notifications** info dot while eero's network-wide `has_unread` is set.
   - Facts: **Busiest type** (`Devices · 36%`) and **Most active** (`Living Room · 11 events`, the device, eero or profile with the most kept events). No share bar.
   - Actions, all outline hero buttons: **Export CSV**, **Mark notifications read** (`notifications.mark_read`; shown only while the flag is set, and hidden rather than greyed out while it is clear, since events themselves have no read state), **Notification settings…** (opens the Notification settings sheet over Activity, [overview.md](../overview.md#notifications-bell)).
   - Right-hand column, **Events over time** (`w-[28rem]`, as Profiles' Usage by profile): title, subtitle `2h bars, busiest 8 AM to 10 AM`, then plain columns (`BarChart`, `h-28`, no Y labels, no gridlines, a 2px stub for an empty slot) of every kept event in the neutral series colour (`seriesColors.neutral`), so it informs without competing with the title. It covers only the kept events: from the oldest kept event (at least 15 minutes back, at most 24 hours) to now, in about 12 bars whose step fits that span (1, 2, 5, 10, 15 or 30 minutes, 1 or 2 hours), so even eero's first 15 minutes draw a full row of slots. Hover shows the slot (`3:40 to 3:42 PM`) and its count. Before any event: "No events yet."
2. **Event stream** (section), subtitle from the rows on screen: `50 events loaded, newest first` (`loaded` while older pages remain), then `filtered` while any filter is set. No header tools.
   - **Filter bar** first, the shared list-page filter bar ([design system](../../design/design-system.md#filter-bar)), no card, as on Devices.
     - Left: search ("Filter events", `/` focuses it, Esc clears it) and a **Filters** button with a count of the popover filters that are set. Its popover has an **Event type** row of toggles (one per type with kept events, with its count; picking some shows only those, none picked shows every type), then a row each for **Device**, **eero** and **Profile** (each "Any" by default), and a footer "2 filters set" with **Clear all**. The Device list is long, so its picker has a type-ahead field (Enter picks the first match). Labels in the popover sit on the first line of their control (`FilterRow`, baseline aligned).
     - Right: a **Show** dropdown, **Group repeats** (default) or **Every event**, remembered across launches (localStorage `mesh-ui:activity:mode:v1`, on this computer, for every network).
     - No Range dropdown: the stream is live, so there is no older window to pick.
     - Under the bar, while any is set: one chip per popover filter ("Type: Devices, Firmware", or "Type: 3 types" past two; "Device: Alex's iPhone", "eero: Living Room", "Profile: Alex") with an x to remove it, then **Clear all**, which clears them (search stays).
   - Day bars (group header rows: `text-3xs` uppercase label on `bg-muted`): `Today`, `Yesterday`, then weekday names (only while the app stays open that long). Within the last 24 hours each shows the date, that day's event count in the window and a small per hour sparkline strip; an older day shows the date alone.
   - Event rows: time (mono, right aligned), icon, title, a muted detail line (band, channel, MAC, IP, profile), and a right side slot holding a contextual action and a dim `View ...` text link to where the row leads.
   - Rows carry no unread dots or counts: eero keeps no read flag per event or notification, only one `has_unread` for the whole network.
   - Grouped rows (e.g. "Garage mesh link dropped to 2 bars", no count badge) show an indented sub list of the underlying events with their times.
   - Footer row inside the card: **Load older events** button while there is an older page, nothing else. At the end, a footnote under the card (the page kit's `Footnote`, not a row in it): "eero shares only its last 15 minutes; newer events are added while Mesh UI is open." With no events: "No events yet. New ones show up here as they happen."
   - Row actions: **Assign profile** (profile menu) on a new device that is still Unassigned, **Resume** on a profile pause while the profile is paused, **Unblock** on a block while the device is blocked. Core sets `action` on the newest such row per device or profile; the button shows only while the target still needs it, so Resume goes away once the profile runs again. Each runs the M4 command through the write kit with its success toast and Undo, and a closed gate (the command's own gate) hides it.
   - Links: every row that leads somewhere ends in one dim text link (`SectionLink`): **View device** for a device, **View profile**, **View eero**, **View updates** for firmware, **View troubleshooting** for a grouped eero problem. No `...` menu (removed 2026-11-21, it had Rename device…, Block device… and Device details): renaming and blocking happen on the device page.

Row actions shown in the mockup:

| Event | Right side |
| --- | --- |
| New device joined | **Assign profile** button, **View device** |
| Profile paused | **Resume** button |
| Update available | **View updates** link |
| Speed test | status "Fast" |
| Mesh link dropped (grouped) | **View troubleshooting** link |
| Admin invited | status "Pending" |
| Device blocked | **Unblock** button |
| Firmware installed | status "Installed" |
| eero back online / went offline | status "Online" / "Offline" |
| Temperature high | status "Warm" |

## Data

| Element | Command | Refresh |
| --- | --- | --- |
| Hero title, Kept since and facts | `events.summary` `{range: "kept"}` (`total`, `earliest`, `counts`, `buckets`, `top`) | on load, then with the stream poll |
| Events over time | the same unfiltered call (`buckets`, `step`) | same |
| Event type toggle counts | the same unfiltered call (`counts`) | same |
| Day bar counts and strip | `events.summary` `{range: "kept", device?, eero?, profile?}` buckets on that day | same |
| Event stream rows | `events.list` `{cursor?, type?, device?, eero?, profile?, search?, grouped}` | every 60 s while the page is visible |
| Unread notifications (hero) | `notifications.list` (`unread`, network-wide; the bell's poll) | every 60 s |
| Device, eero, profile filter options | `device.list`, `eero.list`, `profile.list` | on open of the page |

`events.summary` and the filter params on `events.list` are in the [catalogue](../../architecture/commands.md#activity-commandsactivityts). Grouping is done in `src/core` so the CLI and MCP get the same groups as the window.

## Actions

| Control | Command | Effect | Confirm | Result |
| --- | --- | --- | --- | --- |
| Export CSV | `events.list` `{format: "csv", limit: 1000, ...current filters}` | query | no | Save dialog; the file is built in core, every event in the filtered range (up to 1,000) |
| Filters: Event type | none (view state, passed to `events.list` as `type`) | | | Shows only the picked types in the stream |
| Filter text, Filters (Device, eero, Profile) | none (view state, passed to `events.list`) | | | Refetches the stream |
| Filter chip x, Clear all | none | | | Clears that filter; Clear all clears every chip |
| Show: Group repeats / Every event | none (passed as `grouped`) | | | Regroups the stream |
| Mark notifications read | `notifications.mark_read` | write | no | Unread notifications status, the button itself and the bell dot clear; "Marked all read" toast, no Undo |
| Notification settings… | none (opens the sheet) | | | The Notification settings sheet, over Activity |
| Assign profile | `device.profile.set` `{devices: [device], profile}` | write | only when the profile is paused or in a scheduled pause now | Profile menu; "Moved X to Y" toast with Undo; the button goes once the device has a profile |
| View device | none (navigation) | | | Opens the device page |
| Resume | `profile.resume` `{profile}` | write | no | "Resumed Leo" toast with Undo (`profile.pause`, which asks first); the button goes; a "resumed" event appears on a later poll |
| Unblock | `device.unblock` `{devices: [device]}` | write | no | "Unblocked X" toast with Undo (`device.block`); the button goes |
| View updates, View troubleshooting, View profile / eero | none (navigation) | | | [Updates & admins](updates-admins.md), [Troubleshooting](troubleshooting.md) |
| Load older events | `events.list` `{cursor}` | query | no | Appends the next page |

## States

- **Loading:** keep the layout; on a first load, the hero chart and figures fade to `opacity-40` after 150 ms; stream shows placeholder rows of the right height. Background refreshes do not dim them (the topbar Refresh icon spins).
- **Empty:** for a filter with no matches, the stream shows one centred muted sentence ("No events match these filters."); the hero chart ignores filters, so it only shows "No events yet." before any event is kept.
- **Error:** inline note above the stream with the error message and a **Retry** button; cached rows stay visible.
- **Offline (network down):** the stream still loads from eero's cloud; the hero status elsewhere shows the outage. Poll keeps running.
- **No permission:** admins see everything here. Row actions the user cannot perform (per `network.permissions`) are hidden, not disabled.
- **Live paused:** when the window is hidden the poll stops and the hero's Live dot turns a muted "Paused"; it resumes and refetches on focus.

## Notes

- eero's log is `GET {net}/app_events` (page size 50, `timestamp` cursor). A real network only sends about its last 15 minutes and ignores the cursor (capture 2026-11-16, #263), so the eero backend keeps every event it has read in a log for as long as it runs (up to 15 days, 10,000 events per network) and older pages come from that log. History therefore starts when the app (or a `mesh-ui mcp` session) started reading, not 7 days back; it is lost on quit. A real network answers `{events: [{hash, timestamp_ms, description, category}]}`: no refs and no detail line, and `category` is a bare noun (`device`, `profile`, `eero`), so core picks our type from the description first (paused, schedule, firmware, ...) and the noun second. Notifications come from `GET {net}/notifications_history`; eero only exposes `has_unread` and `mark_read` for all, so Activity shows one network-wide Unread marker and no per row unread state.
- History is about 7 days on free accounts in the eero app, but the API only sends recent events (above), so the stream reaches back only as far as the backend's log, and Activity is designed as a live view: no Range filter, a 24 hour chart, and "Load older events" stops at the end of the log. `events.summary` still takes `range: "week"` for the CLI, MCP and Application counts.
- Entity filters (device, eero, profile) and text search are applied in core over fetched pages, because `app_events` has no such query params. Large filters may need several pages; show a "Searching older events..." line while it works.
- The event type list is ours, mapped in core from eero's `event_type` strings. Unknown types fall into an "Other" type and still show.
- "Ports & temperature" and "run from Mesh UI" attribution depend on fields we have not seen; keep them if the real data supports them, otherwise drop the type.
- Notification toggles live on [Account](account.md); the bell in the titlebar opens a short popover of unread events with a link here.
- Commands added: `events.summary` q and filter params on `events.list`. CSV export is `events.list {format: "csv"}`; there is no separate export command.
