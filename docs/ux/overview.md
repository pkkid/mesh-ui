# Mesh UI: app shell and global patterns

How the window is put together and the rules every page follows. Page docs in
[`pages/`](pages/) describe single screens; this file covers what they share.
The approved look is in [`../mockups/`](../mockups/index.html). Where this doc
and a mockup disagree on behaviour, this doc wins; where they disagree on
looks, the mockup wins.

Every action below is a command run through `engine.execute(id, params)` (see
`AGENTS.md`). The renderer only calls `window.mesh.execute` and
`window.mesh.commands`; it never talks to eero.

## Contents

- [Window layout](#window-layout)
- [Sidebar](#sidebar)
- [Network switcher](#network-switcher)
- [Topbar](#topbar)
- [Notifications bell](#notifications-bell)
- [Command palette](#command-palette)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Navigation](#navigation)
- [Page anatomy](#page-anatomy)
- [Status vocabulary](#status-vocabulary)
- [Confirmations](#confirmations)
- [Sheets](#sheets)
- [Loading, empty and error](#loading-empty-and-error)
- [Offline](#offline)
- [Permission gating](#permission-gating)
- [Capability gating](#capability-gating)
- [Bridge mode](#bridge-mode)
- [Live refresh](#live-refresh)
- [Toasts](#toasts)
- [Formatting](#formatting)
- [Demo mode](#demo-mode)
- [Open questions](#open-questions)

## Window layout

```text
+-----------+--------------------------------------------------------------+
| sidebar   | topbar: crumbs · page nav · search · bell ·                  |
|           |         theme · window controls        (drag region)         |
|           +--------------------------------------------------------------+
|           | content: page (scrolls)                                      |
|           |                                                              |
+-----------+--------------------------------------------------------------+
```

- Two panes: a fixed-width sidebar on `bg-sidebar` and the main pane on
  `bg-background`. Only the content area scrolls.
- The top strip of each pane is the window titlebar (`drag-region`). Every
  button, input and link inside it is `no-drag`.
- Custom titlebar on Windows and Linux: minimise, maximise and close sit at the
  far right of the topbar (shown in every mockup). On macOS the native traffic
  lights sit at the top left of the sidebar; the sidebar header pads by
  `--titlebar-inset-left` and the topbar drops its own window controls.
- Minimum window size 1100 x 700. Below about 1280 wide, two-column page grids
  stack into one column; the sidebar never collapses.

## Sidebar

Top to bottom, as in every page mockup (rendered by `docs/mockups/assets/mockup.js`):

1. **Header.** The app icon (`AppIcon`, 22px, the shapes of `build/icon.svg`
   the launchers use, in the theme's colours) and the wordmark (`AppWordmark`): "Mesh" bold in the text
   colour, "UI" in muted text, like T3 Code's "T3 Code".
2. **Network switcher row.** Status dot, network name ("Maple Street", or
   the network nickname when one is set), a status line, "status · ISP"
   ("Online · Ziply Fiber"), and a chevrons icon, on the same selected
   surface as the active nav item (`bg-sidebar-row-selected`, no border).
   Opens the [network switcher](#network-switcher).
3. **Navigation**, in two groups. Items show an icon, label and an optional
   count on the right in `text-2xs text-muted-foreground tabular-nums`. The
   labels rest in `font-medium text-sidebar-muted-foreground/80` with icons in
   `--sidebar-icon-color` (T3 Code's lighter grey); hover and the active item
   switch both to `text-sidebar-foreground`. The active item uses the selected
   surface (`bg-sidebar-row-selected`) with no outline or shadow, as in T3
   Code; item icons use one muted colour
   (the per-item `--item-color` in the mockup is only a faint accent on the
   active item, never a fill).
4. **Footer.** Account name ("Alex Kim") and role on the selected network
   ("Owner" or "Admin") as plain text: no icon or avatar, and not a link.
   A sign-out icon sits on the right.

| Group | Item | Icon (lucide) | Count | Page doc | Mockup |
| --- | --- | --- | --- | --- | --- |
| Network | Overview | `layout-dashboard` | - | [pages/overview.md](pages/overview.md) | 01 |
| Network | Internet | `globe` | - | [pages/internet.md](pages/internet.md) | 02 |
| Network | eeros | `router` | eero count | [pages/eeros.md](pages/eeros.md), [pages/eero-detail.md](pages/eero-detail.md) | 03, 04 |
| Network | Devices | `monitor-smartphone` | device count | [pages/devices.md](pages/devices.md), [pages/device-detail.md](pages/device-detail.md) | 05, 06 |
| Network | Profiles | `users` | profile count | [pages/profiles.md](pages/profiles.md), [pages/profile-detail.md](pages/profile-detail.md) | 07, 08 |
| Network | Signal | `signal` | - | [pages/signal.md](pages/signal.md) | - |
| Network | Activity | `activity` | - (unread lives on the bell) | [pages/activity.md](pages/activity.md) | 10 |
| Settings | Wi-Fi network | `wifi` | - | [pages/wifi.md](pages/wifi.md) | 12 |
| Settings | Guest network | `ticket` | - | [pages/guest.md](pages/guest.md) | 11 |
| Settings | Advanced networking | `sliders-horizontal` | - | [pages/advanced-networking.md](pages/advanced-networking.md) | 13 |
| Settings | Reservations & ports | `arrow-left-right` | - | [pages/reservations-ports.md](pages/reservations-ports.md) | 14 |
| Settings | Updates & admins | `download` | - | [pages/updates-admins.md](pages/updates-admins.md) | 15 |
| Settings | Troubleshooting | `stethoscope` | - | [pages/troubleshooting.md](pages/troubleshooting.md) | 16 |
| Settings | Settings | `settings` | - | [pages/settings.md](pages/settings.md) | 17 |
| (sidebar footer) | Account | `account` | - | [pages/account.md](pages/account.md) | 17 |

- Counts come from the same queries the pages use (`eero.list`,
  `device.list` summary, `profile.list`) and refresh with them. The Devices
  count is all known devices (38 in the mockup), not only online ones.
- Items for features the network cannot use are hidden, not greyed out (for
  example Profiles in bridge mode, see [Bridge mode](#bridge-mode)).
- Sign out (footer icon) runs `auth.logout` after a small confirm popover
  ("Sign out of Mesh UI? Your networks keep running."). It returns to
  [sign-in](sign-in.md).

## Network switcher

A popover anchored under the sidebar network row.

- **Data:** `network.list` (name, nickname, status, ISP, last seen).
- **Rows** match the sidebar row they open from: status dot, network name,
  and one muted line, "status · ISP" ("Online · Ziply Fiber"), or
  "Offline · last seen 2 days ago" for an offline network. When the network
  has a nickname (set on the Wi-Fi network page), the nickname is the name and the
  Wi-Fi name leads the muted line in place of the ISP ("Kim Home · Online"). No role badge and
  no eero or device counts. The popover is the same width as the sidebar
  row and drawn on the sidebar surface (`bg-sidebar`), so the current
  network's row uses the same selected colour as the active nav item
  (`bg-sidebar-row-selected`) and other rows the sidebar hover.
- **Action:** choosing a row runs `network.select {networkId}` (app-local,
  remembered in `settings.json` so the CLI uses the same default). Every page
  reloads its queries for the new network; the current page is kept if it
  exists on the new network, otherwise Overview.
- **Footer of the popover:** "Manage networks" links to Account
  (Networks on this account). No create-network flow: setting up a new
  network needs the eero mobile app.
- Keyboard: `Ctrl+Shift+N` opens the switcher; arrows and Enter choose.
- With one network the row still shows but the chevrons are hidden and it is
  not interactive.

## Topbar

Left to right (mockup `.topbar`):

| Element | What it shows | Notes |
| --- | --- | --- |
| Crumbs | The selected network, then the page: "Maple Street / Overview", "Maple Street / eeros / Office", "Maple Street / Devices / Alex's MacBook Pro". The page is the `h1`. Settings and Account, which are not about a network, show only their title. A detail page (a device, eero or profile) leaves its last crumb empty until its name loads, never a generic "Device" first | As T3 Code's breadcrumb: `text-sm font-medium`, 12px apart; earlier crumbs in `text-muted-foreground` and links (the network goes to Overview), turning `text-foreground` on hover; the `/` in `text-icon-muted`; the page in `text-foreground`. Nothing follows the page. |
| Subtitle | Freshness or page summary in `text-xs text-muted-foreground` ("Updated 4s ago", "eeroOS 7.12.1, up to date · updated 4s ago") | Freshness text comes from the page's main query `fetchedAt`; see [Live refresh](#live-refresh). |
| Page navigation | Small buttons a page puts in the topbar slot: Prev and Next (Device detail) | Optional per page. Navigation and global tools only; page actions (Add a profile, Export CSV, Rename) live in the page, in hero actions or section tools. Share Wi-Fi (Devices), Live (Devices), Export CSV (Activity), Check for updates (Updates) and Rename (Profile detail) still sit here until #323 moves them. |
| Search | "Search or run a command" field with the palette's current shortcut as its hint (`F1` by default) | Opens the [command palette](#command-palette); it is not a text field itself. |
| Refresh | `RefreshCw` ghost icon button, tooltip "Refresh (F5)" (the current shortcut), with "· Updated 2m ago" where the page reports it, and on a second line how often the page updates on its own: "Updates every minute", or, for any other interval, the short form "Updates every 15m" (Updates & admins) (`useTopBarPollEvery`, from `POLL` in `src/core/poll.ts`) | On every page, in the one shared topbar, with the other icon buttons, between the search field and the notifications bell. Refetches every query on screen (page, sidebar, bell) once, past the engine cache. While it runs the icon spins and the button is disabled; clicks meanwhile are ignored. The icon also spins while any background refetch (a poll, a re-read after a write) has taken longer than 150 ms: it is the app's only updating cue. Errors show in each section as usual. Its shortcut (`F5` by default) does the same. See [Live refresh](#live-refresh). |
| Bell | Notifications, with a small status-colour dot when anything is unread | See [Notifications bell](#notifications-bell). |
| Theme toggle | Sun or moon icon | Flips between the light and dark variant of the current theme. The light and dark themes (Classic by default; also Rose, Grove, Ocean, Ember, Iris, and added VS Code themes such as Gruvbox) are picked in Settings. Stored in renderer `localStorage`, not a command. |
| Window controls | Minimise, maximise, close | Windows and Linux only. |

## Notifications bell

- **Data:** `notifications.list` (newest first). Unread is network-wide:
  eero sends one `has_unread` flag for the network, not a read flag per
  notification, so the dot shows when that flag is set. Activity shows the
  same flag as an "Unread" marker on its event stream.
- **Popover:** up to 8 items, each with an icon, one-line text and relative
  time. A per-item unread marker shows only when the backend keeps per-item
  flags (the demo does; eero does not). Items use the same copy as the Activity event stream
  ("New device joined: Nest Thermostat", "eeroOS 7.13.0 scheduled for
  tonight"). Clicking an item navigates to the thing it is about (device,
  eero, profile, Updates). eero can only mark everything read, so there is
  no per-item mark read.
- **Footer:** "Mark all read" (`notifications.mark_read {}`, which clears the
  network-wide flag and the dot; a "Marked all read" toast with no Undo,
  since eero cannot mark anything unread; disabled with "Nothing unread"
  when the flag is clear, and gated like other network writes),
  "All activity" (to Activity) and a gear that opens the Notification
  settings sheet.
- **Notification settings sheet:** the one editor for every alert choice,
  for the selected network. It opens over the current page from the bell's
  gear, Activity's settings icon, the Notifications row on Account,
  and the `#/account/notifications` deep link. Three groups:
  - **eero alerts**, sent by eero for this network
    (`notifications.settings.get`): the keys eero sends, never an eero Plus
    one; unknown keys show as sent. New device joins shows this week's device
    events (`events.summary` `{type: ["devices"], range: "week"}`, every
    device event, as the summary has no narrower join category).
  - **Phone alerts**, from the eero app for every network on the account:
    Network goes offline and An eero goes offline (`account.push.set`).
    Hidden when eero sends no push settings.
  - **Desktop alerts** for this computer: Show desktop alerts, then Network
    or eero offline, Devices, Everything else, dimmed while the first is off.

  Switches only change the draft; Save and Cancel as in [Sheets](#sheets).
  Save runs `notifications.settings.set` with only the changed eero and
  desktop keys, then `account.push.set` with the changed push keys; the
  "Saved notification settings" toast's Undo puts every changed key back.
- **Desktop notifications:** the host shows an OS notification for new items
  whose kind is on in the desktop choices, only while the app runs. Turning
  them off stops alerts at once; items seen while off are not replayed later.
  Clicking one focuses the window and opens the same target.
- Polled with Activity, every 60 s (see [Live refresh](#live-refresh)).

## Command palette

Mockup: [../mockups/19-command-palette.html](../mockups/19-command-palette.html).
The page-level detail is in [pages/command-palette.md](pages/command-palette.md);
this section is the shell-level summary.
It is the UI face of "everything is a command": anything in the registry can
be found and run here, with the same params and confirm rules as the CLI and
MCP.

**Open and close.** Its shortcut (`F1` by default), the topbar search field, or `>` typed
anywhere outside an input. Only `Esc` or the close button
(an X at the right of the input row) close it; a click outside does not.
`Esc` with focus anywhere in the palette but the search box first moves
focus back to the search box; a second `Esc` closes. Opens centred over the main pane on
a dimmed, slightly blurred backdrop.

**Input row.** Search icon, query text, a result count ("10 results"), a
**Search in** dropdown (`tool` size; All, Commands, Pages, eeros, Devices,
Profiles, each with its icon and count in the list, the trigger showing the
picked name; it replaced a row of scope pills on 2026-11-21 to calm the
header; Tab reaches it from the input, and picking a scope or Esc on its
list puts focus back in the search box) and a close X (ghost icon button, tooltip "Close (Esc)").

**Results list** (left), grouped with uppercase group headers and counts: the selected row (arrow keys or hover) is a plain background, as in the
sidebar, with no outline or side bar;

- **Commands.** Icon, label with the match highlighted ("Pause profile..."),
  the command id in mono under it (`profile.pause`), an effect tag on the
  right (`query`, `write`, `disruptive`, `destructive`: a plain background
  tag, no border or dot, normal weight; `disruptive` in the warning colour,
  `destructive` in the destructive colour, the others in the text colour) and a shortcut if one exists (`Ctrl ⇧ P`). Labels ending in "..." take
  params. A row can be a command with preset params, shown after the id
  (`device.list {"paused":true}`).
- **Places.** Every page, plus every section and settings row on them
  ("DNS · Advanced networking", "IPv6 firewall rules · Reservations &
  ports"): the label, then the page muted. With nothing typed only the
  pages show; a place matches its title, then (ranked lower) its page.
  Choosing one opens the page, scrolls its column to the section: a
  section, or the section a setting sits in, starts at the top of the view
  (22px down). Only the place itself is highlighted: its background
  brightens for a moment and fades back (no outline). A setting so far down
  a long section that it would land below the view goes a third of the way
  down instead
  (`revealPlace` in `lib/places.ts`, the `data-place` anchor every
  `Section`, `Group` and settings `Row` renders from its title). The preview
  says what it is ("Section · Reservations & ports") and "Opens
  Reservations & ports at IPv6 firewall rules." It replaced the Pages group
  on 2026-11-21.
  - **Built from the source.** `scripts/places.ts` reads the feature files
    with Vite's parser and keeps every `Section`, `Group`, settings `Row`
    and `ToggleRow` with a plain-text title; the build serves it as
    `virtual:places` (`electron.vite.config.ts`), rebuilt on every build and
    dev reload, so nothing is kept by hand. Titles built at runtime are not
    places.
  - **Show-if rules.** A place its page shows only sometimes names a rule
    with a `when` prop (`<Section title="IPv6 firewall rules"
    when="ipv6Rules">`), from `features/palette/placeRules.ts`; Places
    offers it only while the rule passes, and an unknown answer (data not
    loaded) hides it. The rules read `network.get`, `settings.get`,
    `account.get`, `guest.get` and `wifi.get` (cached and shared with the
    pages: read once when the palette opens if cold, never per keystroke)
    and the two coverage scans from the cache only.
  - **Safety net.** `places.test.ts` fails, naming the place, when a
    section or row is under a condition in its component (`&&`, `?:`, after
    an early return, or a component its page renders only sometimes, load
    error branches aside) and has no `when`, or names a rule that does not
    exist. Conditions two components up are not seen (2.4 GHz only names its
    rule by hand).
- **Devices / Profiles / eeros.** Entities that match, with status and a
  context line ("Leo · Upstairs Hall", "Bedtime 9 PM to 7 AM"), and on the
  right the most likely action for that entity in its current state
  (Resume, Pause, Pause now) with its effect chip. Enter runs that
  action; `Ctrl+Enter` opens the entity's page instead.
- **Effect names.** Typing an effect on its own (`query`, `write`,
  `disruptive` or `destructive`, any case) lists every command with that
  effect, by label, with no group limit (presets left out), so a whole
  category can be read at once. Places and entities still match as usual.
- A tip at the bottom: type `>` to search all commands by id
  (`>eero.restart`). In `>` mode only commands are listed, matched on id and
  label.

The list comes from `window.mesh.commands()` (id, label, effect, params JSON
Schema) plus entity names from the queries already loaded (`device.list`,
`profile.list`, `eero.list`). Ranking: exact id, label prefix, entity name,
then fuzzy match; recently run commands rank higher for an empty query.

**Preview pane** (right) for the selected row: its own panel in exactly
the navigation sidebar's surface (`bg-sidebar surface-grain`) with the 1px
edge the sidebar has on its right, the same rule (`[data-sidebar-surface]`
in `index.css`: the sidebar's text colour at 8% in dark, 10% in light), on the
palette's background, which is exactly the main content's
(the flat `bg-background`), so the two differ as the sidebar and page
do. It sits 10px from the results list's scrollbar and runs flush to
the palette's right edge and down to the footer, with 1px top and left
borders and a rounded top-left corner (12px); its other corners are square. The results list and the preview each fade their content
at the top and bottom edges (`scroll-fade-y` in `index.css`), only on an
edge with more to scroll to. The palette has no dividers between the
input row, the list and the preview (only the footer keeps its top
border). The footer lists the keys (Navigate, Run, Go to, Copy as CLI; Tab into the params works but is not listed) and nothing else; the effects legend it once had is gone, since every row shows its own effect.

For an eero, device or profile it shows what it is, that Enter opens its
page, then the details read as a **CLI** line with Copy (`mesh-ui run
device.get --params '{"device":"..."}'`) and the **MCP tool** call
(`device_get`, read only), so a script or agent gets what the page shows.
Beside **Go to <name>** (Enter) a **Run command** button runs that read
in line and shows its result under the MCP call, as a query command does.
Rows have no actions (no Pause or Resume): those run as commands
(`device.pause`, `profile.resume`) or from the entity's page.

For a command:

- Label with its effect tag at the right of the line, and the id plus source file in mono (no icon tile:
  the panel carries no decorative icons)
  (`profile.pause · src/core/commands/profile.ts`).
- A one-line description from the command spec, ending with its confirm rule
  ("Reversible, no confirm needed.").
- Colours: the title in the text colour; the description, ids and code in
  the muted colour; sub headings (Params, CLI, MCP tool) in normal
  case, `text-[13px] font-medium` in the text colour (never small caps);
  code blocks on a plain `bg-muted`, no border.
- **Params**, a form generated from the zod JSON Schema: required fields
  marked `*`, entity pickers for ids (profile, device, eero) and dropdowns
  for enums and true/false, all the app's `Select` at its compact `tool`
  size (28px, 12px text; this technical form fits more than other forms),
  and text fields to match. Each field's help (its `.describe()` text from the command
  definition) is a tooltip on its name and its control, not a line under it;
  only a validation error shows under a field (`range`: Day, Week), never
  pill toggles. Inline hints from the
  current state ("scheduled, Bedtime at 9 PM"). `Tab` moves
  into the form.
- **CLI**: the exact `mesh-ui run <id> --params '{...}'` line, with Copy. Adds
  `--confirm` for disruptive and destructive commands.
- **MCP tool**: the call and result JSON (the tool name is in the call, so
  the heading does not repeat it) (no readOnly or destructive badges: the effect chip in the header
  already says it), noting it is the same result
  the UI and CLI get.
- **Buttons:** Run command (outline: nothing in the palette is a filled call to
  action; `Run command…` with an ellipsis for a write, disruptive or destructive
  command, since it asks first; no Enter key hint on it, the footer has it), labelled with what will happen ("Pause Mia ↵"), . ("Add to script.jsonl", a never-built script buffer, was removed on
  2026-11-21.)

**Running.** `query` commands show their result in the preview pane as
a collapsible, syntax-coloured JSON tree (the dev tools' `JsonTree`) with a "Copy" button and, where a page exists, "Open page".
`query` commands run on Enter with no confirm. Every change asks first, in
the app's confirm dialog over the palette: a `write` in a plain confirm (title, what it does,
Cancel and a filled primary button repeating the action),
sending no `confirm`; `disruptive` and `destructive` in
the usual yellow or red confirm, sending `confirm: true`. A write then shows its toast
with Undo. For
`disruptive` and `destructive` commands the Run button becomes a two-step
confirm in the preview pane (consequence text, then a danger button "Yes,
restart network"), and only then passes `confirm: true`. A `bad_params` error
marks the offending field.

**Footer:** key hints (↑↓ Navigate, ↵ Run, Go to, Ctrl Shift C Copy as
CLI). Plain Ctrl C stays the system copy.

The mockup's "Pause 5 and 6 GHz for 2.4 GHz setup" row is `wifi.hide5g.set`
(disruptive) and "Pause unassigned devices" is `profile.unassigned.pause`
(disruptive), both in the [catalogue](../architecture/commands.md).

## Keyboard shortcuts

`Ctrl` is `⌘` on macOS. Shortcuts are view state handled in the renderer;
the ones that run commands go through `execute` like any button.

Six global actions are rebindable in Settings, Keyboard shortcuts
(`lib/shortcuts.ts`, per computer in localStorage). Each has one key
combination, or none once removed, shown below with its Windows and Linux
default. On macOS, Back
and Forward default to `⌘[` / `⌘]` instead, since `Option+←` moves by a word
in text fields. A new combination needs `Ctrl`, `⌘` or `Alt` (`Option`), or
is a function key, and cannot be one another action has, one of the fixed
shortcuts below, or a system key (copy, paste, undo, select all, close,
quit, zoom, full screen). Everything else is fixed and not listed in
Settings. `lib/shortcuts.test.ts` checks the rebindable rows against the
registry.

| Keys | Action | Where |
| --- | --- | --- |
| `F1` | Open command palette (closes it too) | Rebindable. Global |
| `Ctrl+,` | Open Settings | Rebindable. Global |
| `Alt+←` | Go back (same as the sidebar's arrow; the mouse back button always works too) | Rebindable. Global |
| `Alt+→` | Go forward (same as the sidebar's arrow; the mouse forward button always works too) | Rebindable. Global |
| `F5` | Refresh page data: the current page's queries now, past the engine cache (same as the topbar Refresh) | Rebindable. Global. Main catches `F5` and `Ctrl+R` / `Cmd+R` so they never reload the window, and hands them to the renderer to run whatever they are bound to. `Ctrl+Shift+R` still reloads |
| `F12` | Toggle DevTools panel (eero requests), as in browsers. Its DevTools button opens Electron's developer tools docked to the right | Rebindable. Global, sign-in included. See [devtools.md](../architecture/devtools.md) |
| `>` | Open palette in command-id mode | Global, outside inputs |
| `Esc` | Close palette, sheet, popover or confirm dialog | Global |
| `↑` `↓`, `↵`, `Tab` | Move, run, edit params | Palette |
| `Ctrl+Shift+C` | Copy the highlighted result as a CLI line: the command, or an eero, device or profile's `.get` read (`⌘⇧C` on macOS; plain `Ctrl+C` is always the system copy) | Palette, wherever focus is |
| `Ctrl+Shift+N` | Open network switcher | Global, with more than one network |
| `Ctrl+1` ... `Ctrl+7` | Overview, Internet, eeros, Devices, Profiles, Signal, Activity (the Network group, in order) | Global |
| `/` | Focus the list search field | Devices, Activity |
| `Shift+click` | Select a range of rows | Devices table |
| `Ctrl+A` | Select all visible rows | Devices table |
| `[` / `]` | Previous / next item | Device, eero and profile detail |
| `+` `-` `0`, `Ctrl+wheel` | Zoom the topology | Topology |

## Navigation

- Hash routes in the renderer, one per page: `#/overview`, `#/internet`,
  `#/eeros`, `#/eeros/:eeroId`, `#/devices`, `#/devices/:deviceId`,
  `#/profiles`, `#/profiles/:profileId`, `#/activity`, `#/guest`,
  `#/settings/wifi`, `#/settings/advanced`, `#/settings/ports`,
  `#/settings/updates`, `#/troubleshooting`, `#/account`. Navigation is view
  state, never a command. Section deep links reuse a page's route with a
  `:section` segment (no sidebar entry, the page stays selected) and scroll
  to it: `#/account/<section>` and `#/settings/<section>` (see account.md and settings.md) and `#/internet/history`
  (Speed test history, from Overview's "View history").
- Routes are per network: switching network keeps the route when the target
  exists. A detail route whose id is gone (device removed, profile deleted)
  shows "This device is no longer on Maple Street." with a link back to the
  list.
- Back and forward follow in-app history, as in T3 Code: arrow buttons in
  the sidebar titlebar beside the app name (disabled when there is nowhere
  to go), the shortcuts below and the mouse thumb buttons. Every page visit
  is a history entry; only steps that should not be remembered replace the
  current one (detail Prev and Next, a section link redirected to its page),
  and the remembered last route on startup replaces the entry rather than
  adding one. Crumbs link to parents.
- "See all" links in section headers ("Topology →", "All devices →",
  "Manage", "All") go to the matching page, carrying filters where it makes
  sense (Overview "Top devices" → Devices sorted by data today).
- Detail pages offer Prev and Next through the list the user came from, in
  its current filter and sort order (kept in renderer state; falls back to
  name order on a direct link).
- The last route and per-page view state (filters, grid or list, Day or
  Week) are remembered per network in `localStorage`.
- No off-app navigation: external links (eero support articles, release
  notes) open in the system browser via the host, as the
  `web-contents-created` lockdown requires.

## Page anatomy

All pages share one structure (see the decisions in `AGENTS.md`):

- **Hero** at the top: title on the first row, a status line under it
  (status dot plus text and a muted detail), the icon or avatar on the left
  aligned with the title (detail pages), metrics in a row, and the page's
  main actions in a row at the bottom. Big figures and gauges sit on the
  right. On Guest and Wi-Fi the QR block sits top right with its labelled
  buttons to its left.
- **Sections** below, each with a header row: `text-sm font-medium` title, an
  optional muted sub line, and tools on the right (segmented Day / Week, view
  toggles, small buttons, "See all" links).
- Section bodies are subtle cards, as T3 Code's settings groups: `bg-card/40`, 1px `border-border/60`, `shadow-xs/5`, 12px radius, rows divided by `border-border/50`.
  A fully flat layout was tried and rejected. Tables sit in a card with faint
  row dividers.
- Colour only for chart series and status. Notes (`info`, `warn`, `bad`) are
  a neutral card with a coloured icon and title text, not a coloured fill.

## Status vocabulary

Status is always a `size-1.5` dot in the status colour plus plain `text-xs`
text, never a filled pill. Use these words so the same state reads the same
everywhere.

| Thing | Words | Colour |
| --- | --- | --- |
| Network, eero | Online, Weak link, Offline, Restarting, Updating | success, warning, destructive, info, info |
| Internet | Connected, Slow, Down | success, warning, destructive |
| Device | Online, Offline, Paused, Blocked | success, muted, warning, destructive |
| Profile | Active, Scheduled, Paused | success, info, warning |
| Port | Up, Empty, Disabled | success, muted, muted |
| Software | Up to date, Update available, Update scheduled | success, info, info |
| Speed result | Great, Below plan, Poor (text colour, no dot) | success, warning, destructive |
| Effect labels | Disruptive, Destructive (text colour, no dot) | warning or destructive |

Tags such as NEW, GUEST, Gateway, Reserved, Owner, Admin are neutral badges.

## Confirmations

Driven by each command's `effect`. The engine enforces it; the UI makes it
humane.

| Effect | UI before running | Passes `confirm: true` |
| --- | --- | --- |
| `query` | Nothing | No |
| `write` | Nothing, except the few writes listed below | No |
| `disruptive` | Confirm dialog | Yes, after the user confirms |
| `destructive` | Confirm dialog with type-to-confirm or an explicit checkbox | Yes, after the user confirms |

**Confirm dialog.** Every confirm is the same modal, wherever the
trigger is (a page button, a row menu, the bulk bar, the palette, a sheet):
a title naming the target ("Block Alex's MacBook Pro?"), one or two
sentences on who loses what and for how long ("Everyone loses internet for
about 2 to 3 minutes, including every connected device and any calls in
progress."), then a ghost Cancel and a filled button that repeats
the action without a "Yes," in front, yellow for a disruptive action and red for a destructive one ("Restart network", "Remove from network", "Block device").
Focus starts on Cancel (or the type-to-confirm field); `Esc` and Cancel
cancel, and a click on the backdrop does nothing. The title is red for a
destructive action, yellow for a disruptive one, with no icon. Controls never turn into a confirm in place: a note
in place was easy to miss. Inside another dialog (the palette, a sheet) the
confirm opens nested over it, so focus and `Esc` stay there.

**Type to confirm.** Destructive actions on a named thing ask the user to
type its name (Delete profile on 08: `Type "Mia" to confirm`). Account
deletion uses a checkbox statement instead. The danger button stays disabled
until the input matches.

**Anything that takes a device offline is disruptive**, however briefly:
pausing a device or a profile, Pause unassigned, Pause all, and blocking.
They confirm like every other disruptive command: the engine refuses
without `confirm`, the UI shows the dialog with core's message naming who
goes offline, and the CLI and MCP must pass `confirm` too. Resume and
Unblock bring devices back and stay plain writes. Undo after a resume (a
pause) asks again.

**Disruptive labels.** Rows for disruptive or destructive actions show a
"Disruptive" or "Destructive" text label next to the button so the risk is
visible before clicking.

Copy rules: name the target, say the consequence in plain words with a
duration where known, never "Are you sure?". No emdashes.

**How the UI gets the copy.** The write kit runs the command first without
`confirm`. A `disruptive` or `destructive` command answers `needs_confirm`
with a message for people (the spec's `confirmMessage`), and that message is
the consequence sentence in the dialog, so the copy lives in core
and reads the same in the CLI and MCP. Pages add the title, the button label
and, for destructive actions on a named thing, the name to type.

## Sheets

Editors that need more than one field open as a sheet (mockups: Appearance on
06, Edit schedule on 08).

- A 540 px panel (`size="wide"`: 640 px), horizontally centred over a
  dimmed backdrop, `bg-background`, 18 px radius, laid out like the confirm
  dialog. Its top edge sits at the shared modal offset (below the titlebar,
  15% down a tall window) and it grows downward; see
  [design-system.md#position](../design/design-system.md#position).
- **Header:** title and a muted line saying what it affects ("Mia · pauses
  all 4 devices automatically"). No icon, no rule under it. The close X sits
  at the top right on every sheet.
- **Body:** 20 px under the header, labelled fields 16 px apart. Live
  helpers under fields (character count "18 / 32", "next day", a preview
  bar). A long body scrolls; the header and footer stay put.
- **Footer:** the confirm's band (top border, muted fill). A secondary or
  destructive action on the left if any ("Delete schedule", which opens the
  confirm dialog over the sheet), Cancel (outline) and the filled primary
  Save on the right. A content sheet (Share Wi-Fi) has no footer; the X and
  `Esc` close it.
- Save is disabled until something changed and the form is valid. Validation
  is the command's zod schema: `bad_params` messages land under the field.
- Save runs the command(s); the sheet closes on `ok` with a toast, stays open
  with the error otherwise.
- `Esc`, the X and Cancel close it at once, unsaved changes or not; never ask
  "Discard changes?". A click on the backdrop does nothing. See
  [design-system.md#behaviour](../design/design-system.md#behaviour).

Built as `components/ui/sheet.tsx` (`Sheet`, `SheetField`).

## Loading, empty and error

From the chart rules in `AGENTS.md`, applied to every page.

- **First load.** Keep the layout. Sections render with their headers and
  placeholder content: unlabelled gridlines for charts, empty rows at normal
  height for lists, `-` for figures. No spinners on pages.
- **Refresh.** Keep showing the last data, at full strength, until the new
  data lands; sections never dim for a background refresh. If any refresh
  takes longer than 150 ms, the topbar Refresh icon spins until the last one
  lands (with reduced motion it stays still and turns foreground-coloured).
  A switch the person makes to data not loaded yet (Day/Week, a filter)
  fades the affected figures to `opacity-40` after 150 ms. Only opacity
  transitions, no load animations.
- **Empty.** One centred muted sentence in the section body that says what
  is missing and, when there is one, a single action ("No activity in this
  window.", "No pauses today", "No devices in this profile yet. Add a
  device").
- **Missing value.** `-`, never `0` or blank.
- **Errors.** A failed query replaces only its section body with a small
  note: what failed, the error message, and Retry. Other sections keep
  working. A failed write shows an error toast and leaves the control in its
  previous state.

Error codes from `execute` and how the UI words them:

| Code | UI |
| --- | --- |
| `not_signed_in` | Go to [sign-in](sign-in.md) with "Your session ended. Sign in again." |
| `rate_limited` | Keep data, the Refresh tooltip says "Updates paused for 30 s (eero rate limit)"; no toast for background polls, a toast for user actions |
| `network_error` | See [Offline](#offline) |
| `eero_error` | Section note or toast with eero's message, plus Retry |
| `bad_params` | Field-level message in the form or sheet |
| `needs_confirm` | Should not reach the user; the UI always confirms first. If it does, show the confirm dialog |
| `unknown_command` | Developer error; toast "Mesh UI could not run `<id>`" and log it |

## Offline

Two different things, shown differently.

**This computer cannot reach eero** (`network_error`):

- A thin banner under the topbar: "Can't reach eero. Showing data from 3 min
  ago." with Retry. Pages keep the last data, freshness subtitles count up.
- Writes are disabled with a tooltip ("Needs a connection to eero"). Polling
  backs off (15 s, 30 s, 60 s, then every 60 s) and the banner clears itself
  on the first success.

**The eero network is offline** (eero cloud reachable, gateway not reporting):

- The network row in the sidebar and the Overview hero show Offline with
  "last seen 2 days ago". eeros show Offline with their last heartbeat.
- Cloud data that still exists stays visible (device list as last reported,
  usage history, settings). Live rates, speed tests, Find, restarts and
  writes that need the mesh are disabled with "Maple Street is offline".
- Overview shows a note linking to Troubleshooting.
- A single eero being offline is a status on that eero, not a page state.

## Permission gating

- `network.permissions` returns the role (`owner`, admin) and per-area
  create, read, update and delete flags. It is fetched with the network and
  cached for the session.
- Controls the user cannot use are **disabled with a reason**, not hidden, so
  the user knows the feature exists: tooltip or muted line "Owner only".
  Whole sections the user cannot read are hidden.
- Owner-only in the mockups and eero rules: remove an eero ("Owner only ·
  resets this eero" on 04), manage admins and invites, transfer ownership,
  delete network. Admins cannot remove the gateway.
- The engine is still the gate: commands check permissions and return
  `eero_error` if eero refuses. The UI only avoids offering what will fail.
- The sidebar footer shows the role for the selected network.

## Capability gating

Hardware, firmware and eero feature flags decide what is shown.

- Sources: `network.get` (`capabilities` map, connection mode, firmware) and
  `eero.get` (model, bands, ports, nightlight support). Commands expose
  plain booleans in the model; the renderer never reads raw eero fields.
- A feature that one eero lacks but the product has shows a **Not available**
  status with a short reason and, where helpful, a pointer to where it does
  exist (Nightlight on 04: "Nightlight is only on eero Beacon. Your Garage
  eero has one."). Its controls render disabled at `opacity-50`.
- Missing hardware is stated plainly ("eero 7 is dual band, no 6 GHz
  radio").
- **eero Plus features are never shown**, not even as locked teasers. If a
  response hints at a Plus feature, the model drops it. There is no upsell
  anywhere.
- A capability the firmware does not report is treated as unsupported.

## Bridge mode

When the network's connection mode is `bridged` or `ipPassthrough`, the
upstream router does NAT and DHCP and eero drops a set of features.

- `network.get` reports `mode: "bridge"`. A note appears at the top of every
  affected page: "Maple Street is in bridge mode, so your other router hands
  out addresses. Profiles, pausing, blocking and port forwarding are off."
  with a link to Advanced networking.
- Hidden in bridge mode: Profiles (sidebar item and Overview section), pause
  and block on devices, Reservations & ports, live device rates (throughput now), per-device and per-profile usage
  breakdowns, UPnP, IPv6 pinholes, NAT mode.
- Kept: eeros, topology, Wi-Fi settings, guest network (if the firmware
  allows it), speed tests, updates, admins, troubleshooting.
- Internet shows "Bridge mode" in place of the NAT badge and omits the
  double NAT row.
- Sources disagree on profiles in bridge mode; the model follows whatever
  the capabilities say and hides on doubt.

## Live refresh

Poll intervals live in one table in `src/core/poll.ts`, listed in
[engine.md](../architecture/engine.md#polling-intervals) and reported on each
command spec as `poll`. The renderer re-runs queries through `execute` on
those intervals while the window is visible; the CLI and MCP do not poll.
The Refresh columns in the page docs follow that table; where one differs,
engine.md wins.

- **Dedup and cache.** The engine keeps a short-lived cache per query and
  params (half the interval) and merges identical in-flight requests, so
  several sections reading `device.list` cost one eero call.
- **Budget.** Under about 100 requests a minute per account. On 429 the
  engine honours `Retry-After` and returns `rate_limited`; the UI waits.
- **Background.** When the window is hidden or minimised, intervals stretch
  to 5 min and live rates stop. Focus triggers an immediate refresh of the
  current page.
- **After a write.** The command result carries the updated entity; the UI
  applies it at once and the engine drops cached queries the write affects.
  No optimistic updates without a result.
- **Long operations.** Speed test, restarts and firmware installs return
  quickly; the page then polls the relevant query faster (every 5 s for up to
  3 min) and shows progress in place ("Testing... about 1 minute",
  "Restarting, about 2 to 3 minutes"; the estimate comes from core).
- **Manual refresh.** The topbar Refresh button (and its shortcut, `F5` by
  default) refetches every query on screen once with `{ fresh: true }`, so a
  change made in the eero app shows at once instead of after the cache and
  the next poll. One request per query, never more than the page already
  loads; clicks while it runs are ignored.
- **Freshness.** Nothing follows the page title in the topbar. The Refresh
  button's tooltip ends with "Updated just now" / "Updated 4s ago" for the
  page's main query (`useTopBarUpdated`), ticking every 15 s. Sections with live
  data say how they refresh ("refreshes every minute").

## Toasts

- Bottom right of the main pane, stacked, max 3, `bg-popover` glass card
  (`rounded-xl border-border/50 shadow-lg text-xs`), `aria-live="polite"`.
- **Success** for writes the user started: past tense with the target
  ("Paused Leo", "Renamed to Office"). 4 s. Reversible writes get
  **Undo**, which runs the inverse command (`device.resume` after
  `device.pause`, previous name after a rename).
- **Progress** for disruptive actions, kept until done ("Restarting Maple
  Street, about 2 to 3 minutes"), then replaced by the result.
- **Error** stays until dismissed and has Retry when that makes sense.
- No toasts for queries or background polls. Results from the command
  palette and CLI-equivalent actions use the same toasts.
- Copy and Save (Export CSV, Save QR text) say so in a toast: "Copied",
  "Copied password", "Saved speed-tests-2026-11-13.csv", or an error toast.
  A cancelled save dialog shows nothing.

Built by the write kit: `components/ui/toast.tsx` (store and `Toaster`,
mounted once by the shell) and `app/useWrite.ts`, which shows these toasts
for every write. See [design-system.md](../design/design-system.md#write-kit).

## Formatting

Shared formatters in `src/core` (Mbps and Gbps, MB, GB and TB, %, dBm, ms,
relative time, network-time-zone clock times), so the same quantity looks
the same on every page, in the CLI and in MCP results. Always
`tabular-nums`. Times in schedules and activity are in the network's time
zone, labelled once per section ("network time zone (Pacific)").

## Demo mode

`--demo` or `MESH_UI_DEMO=1`, or "Try demo mode" on the sign-in screen, runs
the same UI against the demo backend. A neutral "Demo" badge sits next to
the app name in the sidebar header. Writes apply to fixtures so pause,
rename and block visibly work. Sign out leaves demo mode.

## Open questions

- The mockup topbar has a light/dark toggle while themes are chosen in App &
  account. Keep both: the toggle only flips the variant.
- Does `notifications.list` come from eero, or is it built in core from
  `events.list` plus the notification settings? eero's inbox endpoint is not
  confirmed in the research notes.
