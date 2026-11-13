# UI (renderer)

The window is a thin surface over the command engine. It renders model data
and sends commands; it never builds eero requests, holds tokens or repeats
logic a command owns. The approved look is in
[docs/mockups/](../mockups/index.html); visual rules are in
[design/design-system.md](../design/design-system.md).

## Stack

- React 19 + TypeScript (strict), built by electron-vite into `out/renderer/`.
- Tailwind CSS v4 with semantic tokens in `src/renderer/src/index.css`.
- `@base-ui/react` for accessible primitives (dialog, popover, menu, switch,
  tooltip), `class-variance-authority` and `tailwind-merge` for variants,
  `lucide-react` icons.
- Hand-written SVG charts in `src/renderer/src/components/charts/`; no chart
  library.

## Folder layout

```text
src/renderer/src/
  main.tsx              bootstraps theme, platform attributes, React root
  App.tsx               auth gate, shell, router outlet
  global.d.ts           window.mesh type (from src/shared)
  index.css             Tailwind tokens and base styles
  lib/
    mesh.ts             typed wrappers: run(), useQuery(), useCommand()
    themes.ts           applies palettes as --theme-* variables
    themePalettes.ts    ThemeDefinition list (ported from T3 Code)
    chartColors.ts      one colour per series kind
    format.ts           re-exports the shared formatters from src/core/format.ts
    utils.ts            cn() and small helpers
  components/
    ui/                 primitives ported from T3 Code (button, input, badge, dialog, ...)
    charts/             AreaChart, Sparkline, Gauge, Heatmap, ShareBar, axis helpers
    confirm/            ConfirmInline and ConfirmDialog
    palette/            command palette
  features/
    shell/              Sidebar, TopBar, NetworkPicker, NotificationsPopover
    login/              sign-in flow
    overview/ internet/ eeros/ devices/ profiles/ activity/ guest/
    wifi/ advanced/ ports/ updates/ troubleshoot/ account/
```

One folder per page. A page owns its layout and view state and calls
commands for everything else.

## The bridge: `window.mesh`

The preload script exposes one object. Its type lives in `src/shared/` so main,
preload and renderer agree.

```ts
type MeshApi = {
  platform: "darwin" | "linux" | "win32";
  execute(id: string, params?: unknown): Promise<Result>;   // the only data path
  commands(): Promise<CommandInfo[]>;                       // registry listing
  onEvent(cb: (e: HostEvent) => void): () => void;          // session and update events
  setTitlebarColors(colors: TitlebarColors): void;          // window-only, not a command
};
type Result = { ok: true; result: unknown } | { ok: false; error: { code: string; message: string; detail?: unknown } };
```

- `execute` maps to one IPC channel, `mesh:execute`, handled in main by
  `engine.execute`. It never throws; IPC failures come back as
  `{ ok: false, error: { code: "network_error" } }`.
- `commands()` returns `{ id, label, description, icon, effect, sensitive,
  params (JSON Schema), poll? }` for every command (fields defined in
  [commands.md](commands.md#the-spec)). Params follow the
  [Ref conventions](commands.md#params-conventions): `device`, `profile`,
  `eero` take an id or exact name, bulk actions take `devices: Ref[]`, and
  `networkId` is optional. The palette and confirm dialogs read it.
- `onEvent` carries host events that are not command results:
  `session.changed` (signed out or expired elsewhere, for example by the CLI),
  `update.ready` (an app update is downloaded). No eero data travels on it.

## Data access

`lib/mesh.ts` wraps `execute` in two hooks. No page calls `window.mesh`
directly.

```ts
const devices = useQuery("device.list", { profile: null }, { poll: true });
const pause = useCommand("device.pause");
await pause.run({ devices: [device.id] });   // Ref[]: ids or exact names
const pauseProfile = useCommand("profile.pause");
await pauseProfile.run({ profile: "Leo" });
```

- **`useQuery(id, params, opts)`** caches by `id + params`, dedupes concurrent
  calls, keeps the previous data while refetching, and returns
  `{ data, error, loading, stale, refetch }`. With `poll: true` it refetches on
  the interval the registry reports for that command (from
  `src/core/poll.ts`), only while the window is visible and focused at least
  once in the last 5 minutes.
- **`useCommand(id)`** runs a write. It handles `needs_confirm` by opening the
  confirm flow (below), and on success invalidates the queries that the
  command's area owns (a device write invalidates `device.*`, `profile.*` and
  `network.get`), mirroring the "re-read after write" habit of mature eero
  clients.
- **Optimistic updates** only for cheap toggles whose result is certain
  (pause, LED on). Roll back on error.
- **Errors** show inline where the data would be, with a Retry button.
  `not_signed_in` anywhere sends the app to the sign-in screen.
  `rate_limited` shows "eero is rate limiting requests, retrying in 20 s" and
  pauses polling for `retryAfter`.

## Shell

From the mockups (`01-overview.html` and every page):

- **Sidebar** (`bg-sidebar`, 15rem): app mark at the top in the titlebar
  strip; the **network picker** (status dot, name, "Online · 1.2 Gbps fiber",
  chevrons) which calls `network.list` and `network.select`; two nav groups,
  **Network** (Overview, Internet, eeros, Devices, Profiles, Activity, Guest
  network) and **Settings** (Wi-Fi, Advanced networking, Reservations & ports,
  Updates & admins, Troubleshooting, App & account), with counts on eeros,
  Devices and Profiles; the signed-in user (avatar, name, role, sign-out) in
  the footer.
- **Top bar** (44px, `drag-region`): breadcrumbs (`eeros / Office`), then on
  the right the search field ("Search or run a command", `Ctrl K` / `Cmd K`),
  the notifications bell with an unread dot (`notifications.list`), and space
  for native window controls (`--titlebar-inset-right`). Every control in it
  has `no-drag`.
- **Content**: a scrolling column, max width 1320px, padding 22px 28px.

Navigation is view state: a small in-memory router (`page` + optional
`id`), with the last page remembered in localStorage. It is not a command.

## Page pattern

Every page follows the same top-to-bottom shape (details per page in
`docs/ux/pages/`):

1. **Page header (hero)**: icon or avatar at the left, top-aligned with the
   title; title on the top row; a status line under it (status dot plus plain
   text, uptime or last seen); key facts; a row of actions at the bottom.
   Guest network and Wi-Fi put a QR block at the top right with labelled
   buttons to its left.
2. **Sections**: subtle cards (solid `bg-card`, 1px `border`), each with a
   `text-sm font-medium` heading and its controls (Day / Week, metric switch)
   on the right.
3. Charts, tables and settings rows inside sections.

## Confirm flow

`disruptive` and `destructive` commands never run on the first click.

- **Inline confirm** for single-target disruptive actions (restart one eero,
  change guest password): the button turns into a short sentence plus
  `Cancel` and a coloured confirm button in place ("Restart Office? Devices on
  it reconnect in about a minute. Restart").
- **Dialog** for network-wide or destructive actions (restart network, DNS or
  DHCP changes, remove eero, delete profile, transfer network, delete
  account). The dialog names the effect and outage, and destructive ones need
  a checkbox or typed name before the button enables.
- After confirming, the UI calls `execute(id, { ...params, confirm: true })`.
  The UI never adds `confirm` on its own without one of these steps.

## Command palette

`Ctrl K` / `Cmd K` opens it (`19-command-palette.html`).

- Searches commands (label and id), devices, profiles and eeros in one list,
  grouped, with scope chips (All, Commands, Devices, Profiles).
- `>` searches all commands by id (`>eero.restart`).
- Each command row shows its label, id, effect badge and shortcut.
- The preview pane shows the description, a params form generated from the
  command's JSON Schema, the equivalent CLI line and MCP call, and the result
  shape. `Tab` edits params, `Enter` runs, `Ctrl C` copies as CLI.
- Running a disruptive or destructive command from the palette still goes
  through the confirm flow.

## Live data

- Device rates: pages that show them call `device.rates.refresh` once a minute
  (the engine limits it per network) and then poll `device.list`. The
  renderer keeps the last 30 samples in memory for sparklines; nothing is
  stored. There is no network-wide live history.
- Usage charts use `usage.get` with `range: day | week` only. There is no month
  range (free accounts keep about 7 days).
- Notifications poll every 60 s while visible; new ones become desktop
  notifications through main.

## State

| State | Where |
| --- | --- |
| Theme id and appearance mode | localStorage `mesh-ui:theme:v1` |
| Last page, sidebar and panel sizes, table sort, filters | localStorage `mesh-ui:view:v1` |
| Selected network | `settings.json` via `network.select` (the CLI uses it too) |
| App settings the CLI also needs (User-Agent, desktop notifications on or off, update channel) | `settings.json` via `app.settings.get` / `app.settings.set` |
| eero data | `useQuery` cache in memory only |

## States every page handles

- **Loading**: keep the layout; fade figures to `opacity-40` after 150 ms. No
  spinners in content (a spinner only inside a button that is running).
- **Empty**: one centred muted sentence ("No devices are paused.").
- **Error**: inline message with Retry; the rest of the page stays usable.
- **Offline** (`network_error`): a slim notice under the top bar, "Can't
  reach eero. Showing data from 2 minutes ago."; writes are disabled.
- **No permission**: controls the role cannot use are disabled with a tooltip
  from `network.permissions`, not hidden.
- **Capability missing**: settings the network cannot do are hidden, or shown
  with one muted line when hiding would confuse ("This eero model has no
  nightlight").
- **Bridge mode**: pages that need NAT (Profiles, Reservations & ports) show
  why they are unavailable and link to Advanced networking.

## Platform details

- `main.tsx` sets `data-platform` on `<html>`. CSS reserves
  `--titlebar-inset-left: 78px` on macOS (traffic lights) and
  `--titlebar-inset-right: 140px` on Windows and Linux (overlay controls).
- `themes.ts` sends the chrome colours to main so the Windows and Linux
  titlebar overlay matches the theme.
- Shortcuts use `Cmd` on macOS and `Ctrl` elsewhere; labels follow the
  platform.

## Rules

- No raw eero shapes, URLs or ids in renderer code beyond the opaque ids the
  model gives.
- No `dangerouslySetInnerHTML`. Device names and hostnames come from devices
  on the LAN and are untrusted text.
- Colours only through semantic tokens and `chartColors.ts`.
- Units and rounding only through the shared formatters.
- If a page needs data or an action no command provides, add the command in
  `src/core` first.
