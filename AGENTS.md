# Mesh UI

> **Project board:** all story issues live on
> [github.com/users/pkkid/projects/5](https://github.com/users/pkkid/projects/5).
> Every story is a GitHub issue in `pkkid/mesh-ui` added to this board.

Mesh UI is an Electron desktop app for managing eero mesh networks. Its look
and feel follow T3 Code (`~/Sources/t3code`): quiet surfaces, a sidebar
plus main pane, a custom titlebar, and role-based theme palettes.

**Docs:** this file holds the short rules. The detail lives in
[docs/](docs/README.md): architecture, the command catalogue
(`docs/architecture/commands.md`, the source of truth for command ids),
platform and release, testing, the design system, one UX doc per page, and
the eero API reference. The approved screens are `docs/mockups/`. Read the
relevant docs before building a feature, and update them in the same change
when behaviour or a command changes.

## Scope: no eero Plus features

Mesh UI does not support anything behind the eero Plus (or eero Secure)
subscription. Do not build commands, screens, mockups or stories for them:
Advanced Security, ad blocking, content filters, block apps, block and allow
sites, security insights, VPN, 1Password, Malwarebytes, Dynamic DNS, Hotspot
or Internet Backup, Wi-Fi radio analytics, or usage history beyond what free
accounts get (about 7 days). `notes/app-screens.md` marks these `[Plus]`.

## Stack

- Electron, built with electron-vite (`electron.vite.config.ts`).
- React 19 + TypeScript (strict) in the renderer.
- Tailwind CSS v4. Semantic tokens live in `src/renderer/src/index.css`.
- `@base-ui/react`, `class-variance-authority`, `tailwind-merge`, `lucide-react`.
- pnpm for packages. Do not add npm or yarn lockfiles.

## Architecture: everything is a command

Mesh UI follows the command model of the Craft apps (Dalica, LightCraft,
PhotoCraft): every action is a command in one registry, and the UI, CLI and
MCP server are thin surfaces that all call the same `execute`. Anything a
person can do in the window, a script or an AI agent can do headless.

```text
surfaces   renderer (React UI) · cli (mesh-ui) · mcp (inside the CLI)
host       main (Electron: window, IPC, keychain)  ·  cli (Node host)
engine     src/core: command registry, execute, session, backends
backends   eero (live cloud API) · demo (fixtures)
```

- `src/core/` is plain TypeScript for Node: no Electron, React or DOM imports.
  It holds the eero client, the data model, the command registry and the
  engine. A layer only imports from layers below it.
- **Everything is a command** (`src/core/commands/<area>.ts`, one file per
  area: `auth`, `network`, `eero`, `device`, `profile`, `guest`, `settings`,
  ...). A command spec has:
  - `id`: dotted lowercase, `area.verb` or `area.object.verb`
    (`network.list`, `device.pause`, `eero.reboot`, `settings.dns.set`).
  - `label`: the English UI label.
  - `params`: a zod schema. It validates input and generates the JSON Schema
    shown by `mesh-ui commands` and the MCP tool, so it is the params doc.
  - `effect`: `query` (reads only) | `write` (changes something, reversible)
    | `disruptive` (restarts eeros or drops clients, e.g. reboot, DNS or DHCP
    changes) | `destructive` (cannot be undone: delete network, remove eero,
    transfer ownership).
  - `run(ctx, params)`: async, returns plain JSON-serialisable data from the
    model in `src/core/model.ts`, never a raw eero response.
- `engine.execute(id, params)` is the **only** way state changes or eero is
  called. It looks up the id, validates params, enforces confirmation, runs
  the command, and returns `{ ok: true, result }` or
  `{ ok: false, error: { code, message } }`. It never throws to a surface.
  Error codes: `unknown_command`, `bad_params`, `needs_confirm`,
  `not_signed_in`, `rate_limited`, `eero_error`, `network_error`.
- **Confirmation.** `disruptive` and `destructive` commands fail with
  `needs_confirm` unless params include `"confirm": true`. The UI shows a
  confirm dialog first and then passes `confirm: true`; the CLI needs
  `--confirm`; MCP agents must pass it explicitly.
- **Surfaces** all call `execute` and nothing else:

  | Surface | How it reaches `engine.execute` |
  | --- | --- |
  | UI | `window.mesh.execute(id, params)` over one IPC channel; `window.mesh.commands()` lists the registry |
  | CLI | `mesh-ui commands` (registry as JSON), `mesh-ui run <id> --params '{...}' [--confirm]`, `mesh-ui run script.jsonl` (one `{ "id", "params" }` per line, prints each result) |
  | MCP | `mesh-ui mcp`: one tool per command, named from the id; hints derived from `effect` (`query` is read-only and idempotent, `disruptive` and `destructive` are destructive) |

  Every surface accepts `--demo` (or `MESH_UI_DEMO=1`) to run against fixtures.
- **The UI is thin.** Renderer code never builds eero requests, holds tokens
  or reimplements logic a command owns. If a screen needs data or an action
  that no command provides, add the command first, then the UI. Pure view
  state (navigation, filters, theme, panel sizes) stays in the renderer and
  is not a command.
- **One implementation per behaviour.** Mapping, formatting of exported data,
  polling intervals and validation live in `src/core`, shared by every surface.
- **Backends.** The engine talks to a `Backend` interface with two
  implementations: `eero` (live) and `demo` (in-memory fixtures that also
  apply writes, so demo pause or rename visibly works). Every new command
  works in demo mode; keep fixtures in step with the model.
- **Hosts** provide what differs per runtime: a `SecretStore` for the session
  token (Electron `safeStorage` in the app) and settings paths. Core never
  imports Electron.

### eero client rules (`src/core/eero/`)

The single eero HTTP client lives here; nothing else calls eero. From
`notes/api-clients.md`:

- On a 401 with `meta.error` = `error.session.refresh`, call
  `POST /2.2/login/refresh` and replay the request once. Adopt any new `s=`
  token from `Set-Cookie`.
- Send an app-like `User-Agent` (configurable); eero returns fewer
  capabilities to generic clients.
- Stay under about 100 requests a minute; on 429 honour `Retry-After`.
  Retry only `query` requests, never writes.
- Device writes use `/2.3/`; `/2.2/` returns 200 without saving.

## Security

The eero session token grants full control of the user's network. Rules, all
of which must hold on macOS, Windows, and Linux:

- The token lives only in the engine's process (Electron main or the CLI). No
  command returns it, and it never crosses IPC, MCP or logs.
- Only a host `SecretStore` persists it. It writes only when a real OS keychain
  is available (Linux `basic_text` does not count) and never falls back to
  plaintext; without one the session stays in memory.
- MCP and CLI automation can control the user's network. `disruptive` and
  `destructive` commands always require explicit `confirm`, on every surface.
- New windows or web contents inherit the lockdown in `src/main/index.ts`
  (`web-contents-created`): no off-app navigation, popups, webviews, or
  permissions. Do not loosen it to load remote content.
- Test the no-keychain path on Linux with `--password-store=basic`.

## Design and theming

- Use the semantic Tailwind tokens (`bg-background`, `bg-card`, `text-muted-foreground`,
  `border`, `bg-sidebar`, `bg-primary`, `bg-brand`, ...). Never hard-code colors.
- Themes are defined in `src/renderer/src/lib/themePalettes.ts` (ported from
  T3 Code's `packages/shared/src/themePalettes.ts`) and applied by
  `lib/themes.ts` as `--theme-*` CSS variables. To add a theme, add a
  `ThemeDefinition` and list it in `BUILT_IN_THEMES`.
- Reuse the primitives in `components/ui/`. When you need a new one, port it
  from T3 Code's `apps/web/src/components/ui/` and trim what we do not use.
- Dense UI: 14px base, `text-xs` and `text-2xs` for metadata, 8px control radius.
- The top strip of each pane is the window titlebar (`drag-region`). Interactive
  elements inside it need `no-drag`. Respect `--titlebar-inset-left/right`
  for native window controls.

## Dashboards and charts

Modelled on T3 Code's usage page (`apps/web/src/components/usage/UsagePage.tsx`,
`UsageProviderChart.tsx`, `UsageShareBar.tsx`) and resource diagnostics
(`components/settings/ResourceTelemetryDiagnostics.tsx`). Read those before
building a new chart; port from them rather than inventing a style.

### Charts

- **Hand-written SVG, no chart library.** Shared pieces live in
  `src/renderer/src/components/charts/`. A chart is an SVG with a fixed
  `viewBox` (e.g. 960 x 260), `preserveAspectRatio="none"`, filling its box
  (`h-56` for a main chart), and every stroke uses
  `vectorEffect="non-scaling-stroke"` so lines stay crisp when stretched.
- **Smooth lines that never lie.** Lines use monotone cubic interpolation
  (T3's `monotoneTangents` / `smoothCurve`): smooth, but no overshoot above
  the data or below zero. Never use a plain Catmull-Rom or bezier spline.
- **Line plus soft area.** Each series is a 2px line in its colour with the
  area under it filled in the same colour at 12% opacity. Draw all areas
  first, then all lines. Draw the largest series first so small ones sit on
  top.
- **Minimal chrome.** Horizontal gridlines only, 1px `text-border`, at "nice"
  ticks (steps of 1, 2 or 5 times a power of ten, about 4 ticks). No axis
  lines, no vertical gridlines, no chart border or background box.
- **Quiet labels.** Y labels sit in a separate gutter (`w-14`) to the left,
  right-aligned, `text-3xs text-muted-foreground tabular-nums`, with the zero
  tick shown as `0`. X labels are only start, middle and end, `text-3xs
  uppercase text-muted-foreground`.
- **Hover.** A 1px muted vertical line at the nearest point and a tooltip
  that follows the pointer 12px away and stays inside the plot. Tooltip: glass
  card (`rounded-xl border-border/50 shadow-lg text-xs`), period label in
  muted text, one row per series (colour dot or icon, muted label, value
  right-aligned in `tabular-nums`), and a Total row under a top border when
  totals make sense.
- **Scale.** Series that overlap (not stacked) share a scale based on the
  largest single series, not the sum, so the plot height is not wasted.
- **Loading and empty.** Keep the layout; fade figures to `opacity-40` after
  a 150ms delay instead of spinners. Unlabelled placeholder gridlines while
  there is no data yet. An empty range shows one centred muted sentence
  ("No activity in this window.").
- **Accessible.** Every chart has `role="img"` and an `aria-label` that says
  what it shows.
- **No load animations.** Only opacity transitions. Charts must stay cheap
  to re-render while live data polls.

### Colour

- Each kind of series has one colour, defined once in
  `src/renderer/src/lib/chartColors.ts`, and used in every chart, legend,
  dot and bar for that thing (download, upload, each band, each eero, each
  profile). Never pick a colour inline.
- Series colours come from the active theme's palette (Gruvbox Hard by
  default: blue, purple, aqua, orange, red, green, yellow, gray), with a
  light and a dark value each, so they read on both. A neutral series uses a
  mix of `--foreground` with the background. Check every chart in light and
  dark. See `docs/design/design-system.md`.
- **Restrained colour.** Colour is only for chart series (and their legends,
  share bars, heatmaps) and status. No gradients, glows or coloured accent
  bars; icons, chips, badges, buttons and selected states are neutral; one
  colour marker per legend item. Sections stay in subtle cards (solid
  surface, 1px border); a fully flat layout was tried and rejected.
- Semantic tokens (`success`, `warning`, `destructive`, `info`) mean status
  only (online, degraded, offline, notice), never "series number three".

### Dashboard layout

- **Sections, not boxes.** A page is a column of `<section>`s with
  `gap-6`, each headed by `text-sm font-medium text-foreground`. Controls for a
  section (range Day/Week/Month, metric switch) are a segmented toggle on the
  right of that header. Do not wrap every number in its own card.
- **Hero.** The key figure is `text-4xl font-semibold tabular-nums` with a
  `text-xs text-muted-foreground` line under it. Beside a main chart, an
  `18rem` column lists each series: colour dot, icon, label, value on the
  right in `font-medium`, and a muted share line below.
- **Metric row.** A grid (2 columns, 5 on wide) of label (`text-xs
  text-muted-foreground`) over value (`text-base font-medium tabular-nums`).
- **Stat tiles** (status and diagnostics): icon plus label in `text-3xs
  font-semibold uppercase tracking-widest text-muted-foreground/70`, value in
  `font-mono text-2xl font-semibold tracking-tighter tabular-nums`, optional
  detail in `text-3xs text-muted-foreground/60`. Warning or danger values
  take the semantic foreground colour.
- **Share bars.** An `h-2` bar split into segments with `gap-0.5`, rounded
  outer ends, each segment's width proportional to its value with a tooltip
  ("label · value · percent"), and a legend of `size-2` colour squares with
  muted label and value.
- **Breakdown tables.** Header `text-xs text-muted-foreground font-normal`,
  rows `border-b border-border/50` with `hover:bg-muted/50`, numbers
  right-aligned `tabular-nums`. Under the name, a 2px (`h-0.5`) bar in the
  series colour scaled to the largest row, `max-w-48`.
- **Status.** A `size-1.5` dot in the status colour followed by a plain
  `text-xs` label in `text-foreground/80` ("Online", "Weak link"). No pill
  outline, fill or uppercase.
- **Numbers.** Always `tabular-nums`. Units and rounding come from shared
  formatters (Mbps, GB, %, relative time), so the same quantity looks the same
  everywhere. Show `-` for a missing value, never `0` or blank.

## Working rules

- Run `pnpm check` (typecheck, test, build) locally before calling work done.
  Testing is local-first and fast; GitHub Actions only runs a light
  cross-platform smoke on PRs and the release builds. Do not add CI jobs.
- Check behaviour headless first (`mesh-ui run --demo ...`); the window is for
  checking looks.
- To see UI changes, run `pnpm dev:demo` (fixtures) or `pnpm dev:fake` (the
  real eero client against the local fake eero server), never a real sign-in.
- See "Testing" for the sandbox rule and "Milestone runs" for how work is
  planned and reviewed.
- Keep changes small and the model simple. Prefer one clear file over layers of
  abstraction.
- Do not commit secrets, tokens, or real network data (device names, MACs, IPs).
- No emdashes in docs or UI copy.

## Testing: sandbox only, never the maintainer's network

The maintainer's eero network is real and in use. **Agents never touch it on
their own initiative.** That rule outranks feature work and holds for every
surface (app, CLI, MCP, scripts, tests).

- **Exception: the maintainer asks.** When the maintainer explicitly asks an
  agent to check or test something on their network, the agent may use the
  real network and session for that request. Scope it to what was asked,
  prefer read-only calls, never put the token in output or files, print only
  the fields needed, and confirm before any write. The permission covers that
  request only, not later work.

- **No agent sends any request to eero's cloud API** (`api-user.e2ro.com`),
  not even read-only queries, and never runs the app, CLI or MCP server
  against a live session. Always use `--demo` / `MESH_UI_DEMO=1`.
- **Never read or use the maintainer's session or settings.** Do not open,
  copy or decrypt `~/.config/mesh-ui/` (or the macOS and Windows
  equivalents). Every automated run, screenshot or test uses a throwaway
  user data directory in a temp or scratch folder, so the maintainer's
  theme, window state and session are never changed.
- **The sandbox has two layers:**
  1. The `demo` backend: in-memory fixtures behind the same `Backend`
     interface, used for command tests, UI work and screenshots. Writes apply
     to the fixtures so behaviour is visible.
  2. A fake eero HTTP server (`test/fake-eero/`) that answers like the real
     API, using response shapes from `docs/eero-api/` and the open source
     clients. It keeps state, and `pnpm dev:fake` runs the app against it. The real `eero` client code (auth, session refresh,
     cookie rotation, rate limits, `/2.3/` writes, error mapping) is tested
     against it, so the live code path is covered without touching eero.
- **Every command has a test** that runs it through `engine.execute` against
  the demo backend, including its `bad_params` and `needs_confirm` cases.
  Client behaviour has tests against the fake server.
- **Fixtures are invented.** Fake names, MACs, IPs and serials; never copy
  real network data into code, tests or docs.
- **When only a real network can prove something** (a response shape we
  have not seen, a write that must really stick, timing of a reboot), do not
  try it. Write a manual check instead (below). If a real response shape is
  needed for a fixture, ask the maintainer to capture it with a read-only
  command and redact it.

### Manual checks

Things only the maintainer can verify on the real network are collected and
done at the milestone review, not during the run.

- A task that needs one adds a line to its PR body:
  `MANUAL: <what to check> | <steps> | <expected result> | <risk: none, brief outage, ...>`
- Keep them light: read-only views, or reversible writes on a single device.
  Anything `disruptive` or `destructive` says so plainly in its risk field.
- The milestone review gathers every `MANUAL:` line into a **Manual checks**
  section of `docs/reviews/M<n>.md` as a checklist. The maintainer runs them
  before merging the review; failures become fix tasks.

## Milestone runs

Work is planned and run with the `milestone-plan`, `milestone-start` and
`milestone-review` skills. These project rules override their defaults.

- The roadmap lives in `docs/roadmap.md`: milestones (`M<n>`), each a slice
  a user can try, made of stories (tasks, `M<n>.<k>`), each one PR, ending
  with the maintainer's review `M<n>.R`.
- Each milestone has one parent issue `M<n>: <name>` in `pkkid/mesh-ui`, and
  each story (including `M<n>.R`) is a GitHub sub-issue of it. All of them
  share the GitHub milestone, sit on the project board (top of this file) and
  are linked from the roadmap. A story's PR closes its issue; the review PR
  closes `M<n>.R` and the parent. Issues are created one milestone at a time,
  after the maintainer approves the stories.
- Only plan a milestone when the maintainer asks. Write stories only for the
  next milestone; later ones get a Goal line.
- A story is a vertical slice where it can be: commands in `src/core`, their
  tests, then the UI (and CLI and MCP come for free from the registry).
- Every story's done-when lines are provable in the sandbox. Anything that
  needs the real network is a `MANUAL:` line, not a done-when.
- Reviews are written to `docs/reviews/M<n>.md` and include the Manual checks
  section above, plus demo-mode screenshots for UI changes.
- Never merge a review PR; the maintainer approves a milestone by merging it.
