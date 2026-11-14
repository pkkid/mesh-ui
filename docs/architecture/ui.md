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
  app/
    useCommand.ts       the data path: execute(), useQuery(), useCommand(), followHostEvents()
    router.tsx          in-memory router (view state)
    routes.ts           page list
  lib/
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

The preload script exposes one object. Its type (`MeshApi`) lives in
`src/shared/types.ts` so main, preload and renderer agree. Both halves of
the bridge (`createMeshBridge` for preload and the `ipcMain` handlers) are
in `src/main/ipc.ts`, so they are tested together.

```ts
type MeshApi = {
  platform: "darwin" | "linux" | "win32";
  execute(id: string, params?: unknown): Promise<Result>;   // the only data path
  commands(): Promise<CommandInfo[]>;                       // registry listing
  on(listener: (e: HostEvent) => void): () => void;         // host events; returns an unsubscribe
  setTitlebarColors(colors: TitlebarColors): void;          // window-only, not a command
  saveFile(name: string, text: string): Promise<SaveFileResult>; // native save dialog, text only
};
type SaveFileResult = { status: "saved"; name: string } | { status: "canceled" } | { status: "failed"; message: string };
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
- `on` carries host events that are not command results, on the
  `mesh:event` channel: `session.changed` (signed out or expired elsewhere,
  for example by the CLI), `network.selected`, `update.ready` (an app
  update is downloaded). No eero data travels on it.
- `saveFile` (`mesh:save-file`, renderer helper `lib/saveFile.ts`) saves a
  text export, such as Internet's Export CSV, to a file the user picks in the
  native save dialog. It is not a command: the text comes from a command
  first (`speedtest.history {format: "csv"}`). Main refuses anything but a
  string (8 MB at most), keeps only the base name of `name` as the
  suggestion, allows only text extensions (`csv`, `tsv`, `txt`, `json`,
  `jsonl`, `log`), and returns just the chosen file name, never the folder or
  path. Headless runs (`ui:shot`) may set `MESH_UI_SAVE_DIR` to skip the
  dialog and write there. Images (Save QR) use Chromium's download save
  dialog instead.

The renderer reads the bridge through a local `MeshBridge` type in
`app/useCommand.ts` (`execute`, `commands`, optional `on`). If `window.mesh`
has no `execute` (for example a renderer opened without the preload),
`bridge()` falls back to a stub that answers every call with
`network_error` ("not connected to its engine yet") and an empty registry,
so the shell renders its empty and missing states; `engineConnected()`
reports which one is active.

## Data access

`app/useCommand.ts` wraps `execute` for reads, and `app/useWrite.ts` (the
write kit, [design-system.md#write-kit](../design/design-system.md#write-kit))
runs every write. No page calls `window.mesh` directly.

```ts
const devices = useQuery("device.list", { profile: null }, { poll: true });
const pause = useWrite("profile.pause", {
  success: "Paused Leo",
  undo: { id: "profile.resume", params: { profile: "Leo" } },
});
await pause.run({ profile: "Leo" });   // Ref: an id or exact name
```

- **`useQuery(id, params, opts)`** caches by `id + params` (key order does
  not matter), dedupes concurrent calls, keeps the previous data while
  refetching, and returns `{ data, error, loading, fetchedAt, fading,
  refetch }`. `fading` turns on after a request has been in flight 150 ms.
  `poll: true` refetches on the interval the registry reports for that
  command (from `src/core/poll.ts`), a number polls every that many
  seconds, and `enabled: false` skips the query. While the window is hidden
  polls stretch to at least 5 minutes, and it refetches at once when shown;
  a `rate_limited` error waits at least `retryAfterSec`.
- **`useWrite(id, options)`** is how a control runs a write. It returns
  `{ run, running, error, asking, confirming, answer }` and handles what
  every page would otherwise repeat: the confirm flow (below), a progress
  toast while a confirmed disruptive command runs, a success toast with Undo
  when the options name the inverse write, an error toast with Retry, and
  `bad_params` under form fields (`form: true`, `fieldErrors`). After a
  successful write it invalidates the queries `affectedBy(id)` names: the
  command's own area, `network.get` and related areas (a device write also
  refetches `profile.*` and `eero.*`), mirroring the "re-read after write"
  habit of mature eero clients. Surfaces with no room for an inline note
  (the palette, bulk bars) call `performWrite` directly.
- **Gates.** `useGate({ area, op, capability, bridgeOff })` and
  `GatedButton` (`components/ui/page.tsx`) dim a write control with the
  reason (no permission, bridge mode, not available) from
  `network.permissions` and `network.get`; `gateFor` is the pure check the
  palette's gate table uses. The engine still has the last word.
- **Sheets.** Forms open in `Sheet` (`components/ui/sheet.tsx`) with
  `SheetField`s; Save runs the write through `useWrite` with `form: true`.
- **`useCommand(id)`** runs a command on demand without the kit (a query the
  person asks for, such as Copy details) and returns `{ run, running,
  result, error, reset }`.
- **`followHostEvents()`**, called once by `App.tsx`, ends the session on a
  `session.changed` sign-out and refetches every query on
  `network.selected`. Any command answering `not_signed_in` also ends the
  session (`onSessionEnded`).
- **No optimistic updates.** A control keeps its old state until the write
  answers, then the refetch shows the new one.
- **Errors.** A failed read shows inline where the data would be, with a
  Retry button; a failed write shows an error toast with Retry
  (`errorText`). `not_signed_in` anywhere sends the app to the sign-in
  screen. `rate_limited` shows the message core wrote ("A speed test is
  already running on this network...", "eero is limiting requests. Try again
  in 20 s.") and pauses polling for `retryAfterSec`.

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
`useWrite` drives it: it runs the command without `confirm`, shows the
engine's `needs_confirm` message (so the copy lives in core) in the confirm,
and runs again with `confirm: true` only after the person confirms. The
pieces are in `components/ui/confirm.tsx`: `WriteConfirm` and
`InlineConfirm` for the inline note, and `ConfirmHost`, the app-wide dialog
behind `useWrite(id, { confirmIn: "dialog" })` and `performWrite`.

- **Inline confirm** for single-target disruptive actions (restart one eero,
  change guest password): the button turns into a short sentence plus
  `Cancel` and a coloured confirm button in place ("Restart Office? Devices on
  it reconnect in about a minute. Restart").
- **Dialog** for network-wide or destructive actions (restart network, DNS or
  DHCP changes, remove eero, delete profile, transfer network, delete
  account). The dialog names the effect and outage, and destructive ones need
  a checkbox or typed name before the button enables.
- After confirming, the kit calls `execute(id, { ...params, confirm: true })`.
  The UI never adds `confirm` on its own without one of these steps. A
  `write` the UI confirms itself (block a device) passes `askFirst` and never
  sends `confirm`.

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
