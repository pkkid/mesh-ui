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
| sidebar   | topbar: crumbs · subtitle · page actions · search · bell ·   |
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
  stack into one column; the sidebar never collapses on its own but can be
  hidden with `Ctrl+B` (view state, not a command).

## Sidebar

Top to bottom, as in every page mockup (rendered by `docs/mockups/assets/mockup.js`):

1. **Header.** App mark (wifi glyph in a rounded square) and the name "Mesh UI".
2. **Network switcher row.** Status dot, network name ("Maple Street"), a
   status line, "status · ISP" ("Online · Ziply Fiber"), and a chevrons
   icon. Opens the [network switcher](#network-switcher).
3. **Navigation**, in two groups. Items show an icon, label and an optional
   count on the right in `text-2xs text-muted-foreground tabular-nums`. The
   active item uses the selected surface; item icons use one muted colour
   (the per-item `--item-color` in the mockup is only a faint accent on the
   active item, never a fill).
4. **Footer.** Avatar with initials, account name ("Alex Kim"), role on the
   selected network ("Owner" or "Admin") and a sign-out icon.

| Group | Item | Icon (lucide) | Count | Page doc | Mockup |
| --- | --- | --- | --- | --- | --- |
| Network | Overview | `layout-dashboard` | - | [pages/overview.md](pages/overview.md) | 01 |
| Network | Internet | `globe` | - | [pages/internet.md](pages/internet.md) | 02 |
| Network | eeros | `router` | eero count | [pages/eeros.md](pages/eeros.md), [pages/eero-detail.md](pages/eero-detail.md) | 03, 04 |
| Network | Devices | `monitor-smartphone` | device count | [pages/devices.md](pages/devices.md), [pages/device-detail.md](pages/device-detail.md) | 05, 06 |
| Network | Profiles | `users` | profile count | [pages/profiles.md](pages/profiles.md), [pages/profile-detail.md](pages/profile-detail.md) | 07, 08 |
| Network | Activity | `activity` | - (unread lives on the bell) | [pages/activity.md](pages/activity.md) | 10 |
| Network | Guest network | `ticket` | - | [pages/guest.md](pages/guest.md) | 11 |
| Settings | Wi-Fi | `wifi` | - | [pages/wifi.md](pages/wifi.md) | 12 |
| Settings | Advanced networking | `sliders-horizontal` | - | [pages/advanced-networking.md](pages/advanced-networking.md) | 13 |
| Settings | Reservations & ports | `arrow-left-right` | - | [pages/reservations-ports.md](pages/reservations-ports.md) | 14 |
| Settings | Updates & admins | `download` | - | [pages/updates-admins.md](pages/updates-admins.md) | 15 |
| Settings | Troubleshooting | `stethoscope` | - | [pages/troubleshooting.md](pages/troubleshooting.md) | 16 |
| Settings | App & account | `settings` | - | [pages/app-account.md](pages/app-account.md) | 17 |

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

- **Data:** `network.list` (name, status, ISP, last seen).
- **Rows** match the sidebar row they open from: status dot, network name,
  and one muted line, "status · ISP" ("Online · Ziply Fiber"), or
  "Offline · last seen 2 days ago" for an offline network. No role badge and
  no eero or device counts. The popover is the same width as the sidebar
  row, and the current network's row uses the selected surface.
- **Action:** choosing a row runs `network.select {networkId}` (app-local,
  remembered in `settings.json` so the CLI uses the same default). Every page
  reloads its queries for the new network; the current page is kept if it
  exists on the new network, otherwise Overview.
- **Footer of the popover:** "Manage networks" links to App & account
  (Networks on this account). No create-network flow: setting up a new
  network needs the eero mobile app.
- Keyboard: `Ctrl+Shift+N` opens the switcher; arrows and Enter choose.
- With one network the row still shows but the chevrons are hidden and it is
  not interactive.

## Topbar

Left to right (mockup `.topbar`):

| Element | What it shows | Notes |
| --- | --- | --- |
| Crumbs | Page title as `h1`, or a path ("Devices / Alex's MacBook Pro", "eeros / Office", "Profiles / Mia") | Earlier crumbs are links. |
| Subtitle | Freshness or page summary in `text-xs text-muted-foreground` ("Updated 4s ago", "eeroOS 7.12.1, up to date · updated 4s ago") | Freshness text comes from the page's main query `fetchedAt`; see [Live refresh](#live-refresh). |
| Page actions | Small buttons a page puts in the topbar slot: Share Wi-Fi (Devices), Prev and Next (Device detail), Add a profile (Profiles), Rename (Profile detail) | Optional per page. |
| Search | "Search or run a command" field with the `Ctrl K` hint (`⌘K` on macOS) | Opens the [command palette](#command-palette); it is not a text field itself. |
| Bell | Notifications, with a small status-colour dot when anything is unread | See [Notifications bell](#notifications-bell). |
| Theme toggle | Sun or moon icon | Flips between the light and dark variant of the current theme. The theme itself (Gruvbox Hard by default; also Classic, Rose, Grove, Ocean, Ember, Iris) is picked in App & account. Stored in renderer `localStorage`, not a command. |
| Window controls | Minimise, maximise, close | Windows and Linux only. |

## Notifications bell

- **Data:** `notifications.list` (newest first). Unread is network-wide:
  eero sends one `has_unread` flag for the network, not a read flag per
  notification, so the dot shows when that flag is set. Activity shows the
  same flag as an "Unread" marker on its event stream.
- **Popover:** up to 8 items, each with an icon, one-line text, relative time
  and an unread marker. Items use the same copy as the Activity event stream
  ("New device joined: Nest Thermostat", "eeroOS 7.13.0 scheduled for
  tonight"). Clicking an item navigates to the thing it is about (device,
  eero, profile, Updates). eero can only mark everything read, so there is
  no per-item mark read.
- **Footer:** "Mark all read" (`notifications.mark_read {}`, which clears the
  network-wide flag; not built yet, so it is shown disabled with "Coming soon"),
  "All activity" (to Activity) and a gear to notification settings in
  App & account (`notifications.settings.get` / `notifications.settings.set`).
- **Desktop notifications:** the host shows an OS notification for new items
  whose type is enabled in settings, only while the app runs. Clicking one
  focuses the window and opens the same target.
- Polled with Activity, every 60 s (see [Live refresh](#live-refresh)).

## Command palette

Mockup: [../mockups/19-command-palette.html](../mockups/19-command-palette.html).
The page-level detail is in [pages/command-palette.md](pages/command-palette.md);
this section is the shell-level summary.
It is the UI face of "everything is a command": anything in the registry can
be found and run here, with the same params and confirm rules as the CLI and
MCP.

**Open and close.** `Ctrl+K` (`⌘K`), the topbar search field, or `>` typed
anywhere outside an input. `Esc` closes. Opens centred over the main pane on
a dimmed, slightly blurred backdrop.

**Input row.** Search icon, query text, a result count ("10 results"), scope
chips with counts (All, Commands, Devices, Profiles; eeros appear as a scope
when they match) and an `Esc` key hint.

**Results list** (left), grouped with uppercase group headers and counts:

- **Commands.** Icon, label with the match highlighted ("Pause profile..."),
  the command id in mono under it (`profile.pause`), an effect chip on the
  right (`query`, `write`, `disruptive`, `destructive`, each with a small
  dot) and a shortcut if one exists (`Ctrl ⇧ P`). Labels ending in "..." take
  params. A row can be a command with preset params, shown after the id
  (`device.list {"paused":true}`).
- **Devices / Profiles / eeros.** Entities that match, with status and a
  context line ("Leo · Upstairs Hall", "Bedtime 9 PM to 7 AM"), and on the
  right the most likely action for that entity in its current state
  (Resume, Pause, Pause now) with its effect chip. Enter runs that
  action; `Ctrl+Enter` opens the entity's page instead.
- A tip at the bottom: type `>` to search all commands by id
  (`>eero.restart`). In `>` mode only commands are listed, matched on id and
  label.

The list comes from `window.mesh.commands()` (id, label, effect, params JSON
Schema) plus entity names from the queries already loaded (`device.list`,
`profile.list`, `eero.list`). Ranking: exact id, label prefix, entity name,
then fuzzy match; recently run commands rank higher for an empty query.

**Preview pane** (right) for the selected row:

- Icon, label, effect chip, and the id plus source file in mono
  (`profile.pause · src/core/commands/profile.ts`).
- A one-line description from the command spec, ending with its confirm rule
  ("Reversible, no confirm needed.").
- **Params**, a form generated from the zod JSON Schema: required fields
  marked `*`, entity pickers for ids (profile, device, eero), segmented
  controls for small enums (`range`: Day, Week). Inline hints from the
  current state ("scheduled, Bedtime at 9 PM"). `Tab` moves
  into the form.
- **CLI**: the exact `mesh-ui run <id> --params '{...}'` line, with Copy. Adds
  `--confirm` for disruptive and destructive commands.
- **MCP tool**: the tool name (`profile_pause`), its hints (`readOnly`,
  `destructive`) and the call and result JSON, noting it is the same result
  the UI and CLI get.
- Surfaces strip: UI (`window.mesh`), CLI (`mesh-ui run`), MCP
  (`mesh-ui mcp`) and a note that disruptive and destructive commands need
  `confirm: true` on every surface.
- **Buttons:** primary Run, labelled with what will happen ("Pause Mia ↵"), and "Add to script.jsonl" (appends `{ "id", "params" }` to a
  script buffer the user can save; local, no command).

**Running.** `query` commands show their result in the preview pane as
formatted JSON with a "Copy" button and, where a page exists, "Open page".
`write` commands run on Enter and close the palette with a toast. For
`disruptive` and `destructive` commands the Run button becomes a two-step
confirm in the preview pane (consequence text, then a danger button "Yes,
restart network"), and only then passes `confirm: true`. A `bad_params` error
marks the offending field.

**Footer:** key hints (↑↓ Navigate, ↵ Run, Tab Edit params, Ctrl C Copy as
CLI) and an effects legend.

The mockup's "Pause 5 and 6 GHz for 2.4 GHz setup" row is `wifi.hide5g.set`
(disruptive) and "Pause unassigned devices" is `profile.unassigned.pause`
(write), both in the [catalogue](../architecture/commands.md).

## Keyboard shortcuts

`Ctrl` is `⌘` on macOS. Shortcuts are view state handled in the renderer;
the ones that run commands go through `execute` like any button.

| Keys | Action | Where |
| --- | --- | --- |
| `Ctrl+K` | Open command palette | Global |
| `>` | Open palette in command-id mode | Global, outside inputs |
| `Esc` | Close palette, sheet, popover or inline confirm | Global |
| `↑` `↓`, `↵`, `Tab` | Move, run, edit params | Palette |
| `Ctrl+C` | Copy selected command as CLI | Palette (no text selected) |
| `Ctrl+Shift+P` | Pause profile... (palette with `profile.pause`) | Global |
| `Ctrl+Shift+D` | Pause device... (palette with `device.pause`) | Global |
| `Ctrl+Shift+N` | Open network switcher | Global |
| `Ctrl+1` ... `Ctrl+7` | Overview, Internet, eeros, Devices, Profiles, Activity, Guest network | Global |
| `Ctrl+,` | App & account | Global |
| `Alt+←` / `Alt+→` (`⌘[` / `⌘]`) | Back / forward | Global |
| `Ctrl+R` | Refresh the current page's queries now | Global (does not reload the window) |
| `Ctrl+B` | Hide or show the sidebar | Global |
| `/` | Focus the list search field | Devices, Activity |
| `Shift+click` | Select a range of rows | Devices table |
| `Ctrl+A` | Select all visible rows | Devices table |
| `[` / `]` | Previous / next item | Device detail, eero detail |

Only `Ctrl+K`, `/`, `Esc`, the palette keys, `Ctrl+Shift+P`, `Ctrl+Shift+D`
and `Shift+click` appear in the mockups; the rest are proposed here. A
shortcut list lives in App & account.

## Navigation

- Hash routes in the renderer, one per page: `#/overview`, `#/internet`,
  `#/eeros`, `#/eeros/:eeroId`, `#/devices`, `#/devices/:deviceId`,
  `#/profiles`, `#/profiles/:profileId`, `#/activity`, `#/guest`,
  `#/settings/wifi`, `#/settings/advanced`, `#/settings/ports`,
  `#/settings/updates`, `#/troubleshooting`, `#/account`. Navigation is view
  state, never a command.
- Routes are per network: switching network keeps the route when the target
  exists. A detail route whose id is gone (device removed, profile deleted)
  shows "This device is no longer on Maple Street." with a link back to the
  list.
- Back and forward follow in-app history. Crumbs link to parents.
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
- Section bodies are subtle cards: solid `bg-card`, 1px `border`, 14px radius.
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
| `disruptive` | Inline confirm (or a dialog when there is no room) | Yes, after the user confirms |
| `destructive` | Inline confirm with type-to-confirm or an explicit checkbox | Yes, after the user confirms |

**Inline confirm.** The button reveals a note in place, under or beside the
control (mockups: Restart network on 03, Remove eero on 04, Block on 06):
icon and title naming the target ("Block Alex's MacBook Pro?"), one or two
sentences on who loses what and for how long ("Everyone loses internet for
about 2 to 3 minutes, including every connected device and any calls in
progress."), then a danger button that repeats the action ("Yes, restart
network", "Remove from network", "Block device") and a ghost Cancel. Focus
moves to Cancel; `Esc` cancels. The note stays until confirmed or cancelled.

**Dialog.** Used when the trigger has no room for a note (palette, bulk bar,
row menus, topbar). Same copy, same buttons, centred.

**Type to confirm.** Destructive actions on a named thing ask the user to
type its name (Delete profile on 08: `Type "Mia" to confirm`). Account
deletion uses a checkbox statement instead. The danger button stays disabled
until the input matches.

**Writes that still confirm in the UI** (engine does not require it, the UI
asks because the reach is large): block a device, block several devices,
pause the Unassigned profile (includes TV, printer and smart home gear),
Pause all profiles. These use a dialog or inline note and do not pass
`confirm`.

**Disruptive labels.** Rows for disruptive or destructive actions show a
"Disruptive" or "Destructive" text label next to the button so the risk is
visible before clicking.

Copy rules: name the target, say the consequence in plain words with a
duration where known, never "Are you sure?". No emdashes.

## Sheets

Editors that need more than one field open as a sheet (mockups: Appearance on
06, Edit schedule on 08).

- Centred panel near the top of the window (about 60 px down, 520 to 560 px
  wide) over a dimmed backdrop, `bg-popover`, 18 px radius.
- **Header:** icon, title, a muted line saying what it affects ("Mia · pauses
  all 4 devices automatically"), close button.
- **Body:** labelled fields, 16 px apart. Live helpers under fields
  (character count "18 / 32", "next day", a preview bar).
- **Footer:** destructive action on the left if any ("Delete schedule", which
  reveals an inline confirm), Cancel and primary Save on the right.
- Save is disabled until something changed and the form is valid. Validation
  is the command's zod schema: `bad_params` messages land under the field.
- Save runs the command(s); the sheet closes on `ok` with a toast, stays open
  with the error otherwise.
- `Esc`, the backdrop and the close button all cancel. If there are unsaved
  changes, ask "Discard changes?" first.

## Loading, empty and error

From the chart rules in `AGENTS.md`, applied to every page.

- **First load.** Keep the layout. Sections render with their headers and
  placeholder content: unlabelled gridlines for charts, empty rows at normal
  height for lists, `-` for figures. No spinners on pages.
- **Refresh.** Keep showing the last data. If a refresh takes longer than
  150 ms, fade the affected figures to `opacity-40` until it lands. Only
  opacity transitions, no load animations.
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
| `rate_limited` | Keep data, subtitle says "Updates paused for 30 s (eero rate limit)"; no toast for background polls, a toast for user actions |
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
  and block on devices, Reservations & ports, live device rates ("Using the
  most right now", throughput now), per-device and per-profile usage
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
- **Freshness.** The topbar subtitle shows "Updated just now" / "Updated 4s
  ago" for the page's main query and ticks every second. Sections with live
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
