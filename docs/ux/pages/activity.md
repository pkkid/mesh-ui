# Activity

The network's event log and notification inbox in one stream, with a 7 day chart of events by type.

Mockup: [../../mockups/10-activity.html](../../mockups/10-activity.html)

Shared patterns (shell, section cards, status dots, charts, confirms, polling) are described in [../overview.md](../overview.md).

## Layout

Titlebar: title "Activity", **Export CSV** button on the right of the titlebar actions, then the global search and bell.

1. **Events by type** (section, header controls: segmented toggle **Per day** / **Per hour**).
   - Left column: hero figure (`410 events`) with a muted line under it (`59 a day on average · +12% vs prior week`).
   - Under it, the type legend. One row per event type: colour square, icon, label, count, share percent. Types: Devices joined / left, Paused / blocked, Schedules, eero status, Speed tests, Firmware, Admin actions, Ports & temperature. The legend doubles as the type filter: clicking a row toggles that type in the chart and the stream below.
   - Right: stacked bar chart, one bar per day for the last 7 days, or in Per hour mode one bar per hour for the last 24 hours (168 hourly bars are too thin to read), one segment colour per type (`eventCategoryColors` in `lib/chartColors.ts`, hues from the theme series palette; see [design system](../../design/design-system.md#series-colours)).
   - The hero line leaves out the change when history does not reach the prior period (a week on a free account keeps about 7 days, so "vs prior week" usually cannot be known).
2. **Filter bar** (card): text filter ("Filter events"), **Device**, **eero** and **Profile** selects (each defaulting to "Any ..."), **Range** select (dates inside the last 7 days), **Reset** ghost button on the right.
3. **Event stream** (section). Header: title, an **Unread** status marker (info dot plus "Unread") while eero's network-wide `has_unread` is set, sub line `Newest first · polled every 60 s`, then on the right a live dot ("Live"), segmented toggle **Grouped** / **Raw**, **Mark all read** button (disabled, "Coming soon") and a settings icon button that opens Notifications on [App & account](app-account.md).
   - Day bars: `Today`, `Yesterday`, then weekday names. Each shows the date, event count and a small per hour sparkline strip.
   - Event rows: time (mono, right aligned), icon, title with bold entities, a muted detail line (entity chip, band, channel, MAC, IP, profile), and a right side slot holding a contextual action or a status.
   - Rows carry no unread dots or counts: eero keeps no read flag per event or notification, only one `has_unread` for the whole network.
   - Grouped rows (e.g. "Garage mesh link dropped to 2 bars", `2 events` badge) show an indented sub list of the underlying events with their times.
   - Footer: **Load older events** button while there is an older page; at the end, "Start of history. eero keeps about 7 days."
   - Not yet built: **Mark all read** (`notifications.mark_read`) and the settings icon; row write actions (Assign profile, Resume, Unblock, overflow menu) are left out because the real stream carries no device, eero or profile refs. Rows with refs link to their device, profile or eero; firmware rows link to Updates and grouped eero rows to Troubleshooting.

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
| Hero total, average, change vs prior week | `events.summary` `{range: "week", bucket: "day", device?, eero?, profile?}` | on load, then with the stream poll |
| Type legend counts and shares | `events.summary` (same call) | same |
| Events by type chart | Per day: the same call; Per hour: `events.summary` `{range: "day", bucket: "hour"}` | same |
| Day bar counts and hourly strip | day counts from the Per day call, strip from `events.summary` `{range: "week", bucket: "hour"}` | same |
| Event stream rows | `events.list` `{cursor?, type?, device?, eero?, profile?, search?, since?, until?, grouped}` | every 60 s while the page is visible |
| Unread marker | `notifications.list` (`unread`, network-wide; the bell's poll) | every 60 s |
| Device, eero, profile filter options | `device.list`, `eero.list`, `profile.list` | on open of the select |

`events.summary` and the filter params on `events.list` are in the [catalogue](../../architecture/commands.md#activity-commandsactivityts). Grouping is done in `src/core` so the CLI and MCP get the same groups as the window.

## Actions

| Control | Command | Effect | Confirm | Result |
| --- | --- | --- | --- | --- |
| Export CSV | `events.list` `{format: "csv", limit: 1000, ...current filters}` | query | no | Save dialog; the file is built in core, every event in the filtered range (up to 1,000) |
| Per day / Per hour | none (view state) | | | Rebuckets the chart |
| Type legend row | none (view state) | | | Toggles the type in chart and stream |
| Filter text, Device, eero, Profile, Range | none (view state, passed to `events.list`) | | | Refetches the stream |
| Reset | none | | | Clears all filters and types |
| Grouped / Raw | none (passed as `grouped`) | | | Regroups the stream |
| Mark all read | `notifications.mark_read` (not built yet, shown disabled) | write | no | Unread marker and bell dot clear |
| Settings icon | none (navigation) | | | Opens App & account, Notifications |
| Assign profile | `device.profile.set` `{devices: [device], profile}` | write | no | Profile picker popover; row detail updates |
| Row overflow menu | `device.rename`, `device.block`, navigation to device detail | write | no | |
| Resume | `profile.resume` `{profile}` | write | no | New "resumed" event appears on next poll |
| Unblock | `device.unblock` `{devices: [device]}` | write | no | |
| Updates, Diagnose | none (navigation) | | | [Updates & admins](updates-admins.md), [Troubleshooting](troubleshooting.md) |
| Load older events | `events.list` `{cursor}` | query | no | Appends the next page |

## States

- **Loading:** keep the layout; chart and figures fade to `opacity-40` after 150 ms; stream shows placeholder rows of the right height.
- **Empty:** for a filter with no matches, the stream shows one centred muted sentence ("No events match these filters.") and the chart shows "No activity in this window.".
- **Error:** inline note above the stream with the error message and a **Retry** button; cached rows stay visible.
- **Offline (network down):** the stream still loads from eero's cloud; the hero status elsewhere shows the outage. Poll keeps running.
- **No permission:** admins see everything here. Row actions the user cannot perform (per `network.permissions`) are hidden, not disabled.
- **Live paused:** when the window is hidden the poll stops and the Live dot turns muted; it resumes and refetches on focus.

## Notes

- eero's log is `GET {net}/app_events` (page size 50, `timestamp` cursor). A real network answers `{events: [{hash, timestamp_ms, description, category}]}`: no refs and no detail line, and `category` is a bare noun (`device`, `profile`, `eero`), so core picks our type from the description first (paused, schedule, firmware, ...) and the noun second. Notifications come from `GET {net}/notifications_history`; eero only exposes `has_unread` and `mark_read` for all, so Activity shows one network-wide Unread marker and no per row unread state.
- History is about 7 days on free accounts. The Range select never offers more; "Load older events" stops at the 7 day boundary.
- Entity filters (device, eero, profile) and text search are applied in core over fetched pages, because `app_events` has no such query params. Large filters may need several pages; show a "Searching older events..." line while it works.
- The event type list is ours, mapped in core from eero's `event_type` strings. Unknown types fall into an "Other" type and still show.
- "Ports & temperature" and "run from Mesh UI" attribution depend on fields we have not seen; keep them if the real data supports them, otherwise drop the type.
- Notification toggles live on [App & account](app-account.md); the bell in the titlebar opens a short popover of unread events with a link here.
- Commands added: `events.summary` q and filter params on `events.list`. CSV export is `events.list {format: "csv"}`; there is no separate export command.
