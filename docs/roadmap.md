# Roadmap

Milestones (`M<n>`) are slices a user can try. Each is made of stories
(`M<n>.<k>`), one PR each, and ends with the maintainer's review `M<n>.R`.
Only the next milestone has stories; later ones have a goal and a rough
scope, and get their stories when they are next. Stories become GitHub
issues on the [project board](https://github.com/users/pkkid/projects/5)
one milestone at a time, after the maintainer approves them here.

Rules for running milestones are in [AGENTS.md](../AGENTS.md#milestone-runs);
the format follows the `milestone-plan` skill. The design lives in
[docs/](README.md): every story names the docs it implements.

How stories prove things: done-whens may include read-only shape checks
on the real network ([AGENTS.md](../AGENTS.md#testing-sandbox-for-changes-read-only-on-the-real-network)),
recorded redacted (key paths, types, counts). `MANUAL:` lines stay for
visual comparison with the eero app, copy and clipboard in a real window,
and every write.

Lessons so far (from [M3](reviews/M3.md#6-numbers-surprises-open-items-next);
read these before planning the next milestone):
- Capture before mapping. In M3 the real eero API differed from the docs
  and fixtures in five places, and each was found only by a read-only
  capture: a hidden Unassigned profile with `default: true`,
  `{profile}/schedules` and `{net}/proxied_nodes` answer 404, the
  `app_events` shape, profile usage rows keyed `profile_id`, and members
  with no email. A story captures the raw shape before it maps or writes
  anything. When a capture contradicts the docs or fixtures, the worker
  reports it even if the fix is outside its files, and the lead makes a
  fix task.
- File lists were too tight. Several M3 stories also needed
  `docs/architecture/data-model.md`, `src/shared/types.ts`,
  `src/renderer/src/lib/chartColors.ts` or `src/core/poll.ts` (new cache
  topics). List these in the hotspots as shared-additive files, like the
  registration files.
- A shared mapping file that several page stories depend on (the device,
  usage and network maps) is owned by the core story or a named fix task.
  Three M3 fixes landed in those maps.
- A story that adds a sensitive command lists `src/cli/format.ts` (secret
  masking) and tests the CLI table output, not only logs and MCP.
- Done-when `ui:shot` lines use the real route paths from
  `src/renderer/src/app/routes.ts` (settings pages are `#/settings/wifi`,
  `#/settings/advanced`, `#/settings/ports` and `#/settings/updates`).
- Workers run headless and push PR screenshots to an assets branch; see
  [AGENTS.md](../AGENTS.md#milestone-runs).

## Overview

| Milestone | Goal | Status |
|---|---|---|
| M1 | Sign in (or use demo or the fake server) and see the Overview and Devices pages, from the app, the CLI and MCP | ✅ ([milestone](https://github.com/pkkid/mesh-ui/milestone/1), [review](reviews/M1.md)) |
| M2 | See the network and its devices: Internet, eeros, eero detail, device detail, command palette | ✅ ([milestone](https://github.com/pkkid/mesh-ui/milestone/2), [review](reviews/M2.md)) |
| M3 | See people and settings: Profiles, Activity, Guest, Wi-Fi, Troubleshooting health, offline alerts | ✅ ([milestone](https://github.com/pkkid/mesh-ui/milestone/3), [review](reviews/M3.md)) |
| M4 | Everyday control: pause, rename, block, profiles and schedules, guest and Wi-Fi, restarts | ✅ ([milestone](https://github.com/pkkid/mesh-ui/milestone/4), [review](reviews/M4.md)) |
| M5 | Advanced settings: networking, reservations and ports, updates and admins, troubleshooting tools | planned |
| M6 | App and account, CLI on PATH, auto-update and signed release builds | later |

Why this order: M1 proves the riskiest parts first (command engine shared by
three surfaces, the CLI running through headless Electron with the keychain,
the real eero client against the fake server) behind two simple read-only
pages. M2 and M3 fill in the read side, which is safe to try on a real
network: first the network and its devices, then people, activity and the
settings pages. M4 and M5 add writes, the least risky first. M6 is release
work that only makes sense once the app is useful.

## M1: Foundation, Overview and Devices

Issue: [#17](https://github.com/pkkid/mesh-ui/issues/17) (parent of every M1 story)

Goal: a user can sign in to eero, or run in demo mode or against the local
fake eero server, and see the Overview and Devices pages, with the same data
available from `mesh-ui run ...` and the MCP server.
In: command engine and registry, demo backend, fake eero server, the real
eero client (auth, refresh, rotation, rate limits, errors), Electron host
(keychain, IPC), CLI and MCP surfaces, app shell and themes, chart kit,
sign-in, the read commands behind Overview and Devices, those two pages,
an unsigned local package build per OS.
Out: every write except sign-in and sign-out, all other pages (sidebar
entries show "Coming in a later milestone"), signing, auto-update, CLI
install on PATH.

Done when:
- `pnpm check` (typecheck, test, build) passes locally in under a minute,
  and the CI smoke passes on macOS, Windows and Linux.
- `pnpm dev:demo` and `pnpm dev:fake` both show Overview and Devices matching
  the mockups in light and dark Gruvbox Hard.
- Sign-in, wrong code, sign-out and expired session work against the fake
  server, and the session survives a restart only when a real keychain
  exists (memory only with `--password-store=basic`).
- `mesh-ui --demo commands`, `mesh-ui --demo run device.list` and the MCP
  tool list work; every M1 command has command tests including `bad_params`.
- `pnpm dist:dir` produces a runnable unpacked app on each OS.

Parallelism: 5 waves (1, 7, 5, 2, R); critical path M1.1 > M1.2 > M1.11 >
M1.14 > M1.R. Hotspots: `src/core/model.ts` and `src/core/backend.ts` (owned
by M1.1, later stories only add to their area files), `src/core/commands/index.ts`,
`src/core/demo/index.ts`, `src/core/eero/backend/index.ts`,
`test/fake-eero/routes/index.ts`, `src/cli/index.ts` and
`src/renderer/src/app/routes.ts` (registration files: one-line edits by
anyone), `package.json` and `pnpm-lock.yaml` (small edits by anyone).

### M1.1 Core contracts and test tooling ✅ (#18)
- issue: [#1](https://github.com/pkkid/mesh-ui/issues/1)
- after: (none)
- docs: architecture/overview.md, architecture/commands.md, architecture/engine.md, architecture/backends.md, architecture/data-model.md, testing.md
- files: src/core/model.ts, src/core/backend.ts, src/core/registry.ts, src/core/engine.ts, src/core/errors.ts, src/core/spec.ts, src/core/poll.ts, src/core/format.ts, src/core/commands/index.ts, src/core/demo/index.ts, src/core/eero/backend/index.ts, src/cli/index.ts, test/setup.ts, test/fake-eero/routes/index.ts, vitest.config.ts, package.json, tsconfig.json
- scope: The contracts every other story builds on. `model.ts` with every type in data-model.md (whole model, so later stories never edit it for M1 types). `backend.ts`: the `Backend` interface split into per-area sub-interfaces (auth, account, network, internet, eero, device, profile, usage, events) with method signatures for every M1 command. `spec.ts` (CommandSpec with id, label, description, icon, params zod schema, effect, sensitive, poll, run), `registry.ts` (register, list, JSON Schema via zod-to-json-schema), `engine.ts` (`execute` with lookup, validation, confirm enforcement, error mapping, never throws), `errors.ts` (codes from AGENTS.md). `poll.ts` and `format.ts` with the M1 intervals and formatters (Mbps, GB, %, relative time). Empty registration index files for commands, demo areas, eero backend areas and fake-server routes, plus a `src/cli/index.ts` stub exporting `runCli(argv)`. Vitest config, `test/setup.ts` with the fetch guard that throws on `api-user.e2ro.com`, and scripts `test`, `test:watch`, `check` in package.json.
- done when: `pnpm check` passes; engine tests cover unknown_command, bad_params, needs_confirm (disruptive and destructive), success, and a thrown backend error mapped to eero_error; a test proves the fetch guard blocks eero.

### M1.2 eero HTTP client and fake eero server ✅ (#22)
- issue: [#2](https://github.com/pkkid/mesh-ui/issues/2)
- after: M1.1
- docs: architecture/eero-client.md, testing.md (Fake eero server), eero-api/endpoints.md
- files: src/core/eero/client.ts, src/core/eero/urls.ts, src/core/eero/ratelimit.ts, src/core/eero/raw.ts, src/core/eero/client.test.ts, test/fake-eero/server.ts, test/fake-eero/state.ts, test/fake-eero/scenarios.ts, test/fake-eero/routes/auth.ts
- scope: The only eero HTTP client and the stateful fake server it is tested against. Client: base URL, headers (cookie, User-Agent), body encodings, `/2.2` vs `/2.3`, origin check (fake origin only by injection), no redirects, 30 s timeout, `error.session.refresh` refresh with single flight and one replay, `Set-Cookie` rotation, 80 req/min budget with 4 in flight and serialised writes, 429 and `Retry-After` for queries only, error mapping. `raw.ts` holds the raw response types used by mapping and the fake server. Fake server: random port, per-test state (one account, two networks), request log, scenario switches, auth routes (login, verify, resend, refresh, logout) accepting any email and code `123456`.
- done when: every scenario in testing.md's fake-server table that concerns the client has a passing test using fake timers; request and error logs never contain the token; the suite for this story runs in under 5 seconds.

### M1.3 Demo backend and fixtures ✅ (#23)
- issue: [#3](https://github.com/pkkid/mesh-ui/issues/3)
- after: M1.1
- docs: architecture/backends.md (demo), testing.md (Fixtures)
- files: src/core/demo/backend.ts, src/core/demo/fixtures.ts, src/core/demo/scenario.ts, src/core/demo/backend.test.ts
- scope: The in-memory demo backend implementing every M1 read in `Backend` from one fixture set matching the mockups (Maple Street and Lake Cabin, Alex, Jamie, Mia, Leo, four eeros, about 38 devices, usage series, speed tests, events). Includes the states pages must handle (offline eero, weak link, paused and scheduled profiles, blocked device, update available, bridge mode network, admin role, missing capability). `scenario.ts` holds switchable states for tests (`demo.scenario.set` is registered in M1.9).
- done when: fixtures are typed against `model.ts`; tests check each read returns consistent data (counts in summaries match the lists); no real names, MACs or IPs.

### M1.4 Electron host: keychain, IPC and preload ✅ (#20)
- issue: [#4](https://github.com/pkkid/mesh-ui/issues/4)
- after: M1.1
- docs: architecture/security.md, architecture/ui.md (bridge), platform/cross-platform.md
- files: src/main/index.ts, src/main/secret-store.ts, src/main/secret-store.test.ts, src/main/ipc.ts, src/main/paths.ts, src/main/session.ts, src/main/eero.ts, src/main/demo.ts, src/preload/index.ts, src/shared/types.ts, src/renderer/src/global.d.ts
- scope: Rebuild the host on the engine. `SecretStore` over `safeStorage` (keychain only, never plaintext, atomic 0600 writes, v1/v2 session file handling) replacing `session.ts`. One IPC channel for `execute`, plus `commands` and host events (`session.changed`, `network.selected`). Preload exposes `window.mesh.execute/commands/on`. Backend selection: live, `MESH_UI_DEMO=1` demo, and dev-only fake origin injection for `pnpm dev:fake` (start the fake server from `test/fake-eero` in dev only). Config paths per OS. Keep the window lockdown. `--cli` argv hands off to `runCli` from `src/cli/index.ts` with no window. Delete the prototype `eero.ts` and `demo.ts` once nothing imports them.
- done when: host tests cover keychain, basic_text and unavailable backends, plaintext and undecryptable files, and sign-out deleting the file; the token never crosses IPC (test the bridge payloads); `pnpm dev:demo` opens the window.

### M1.5 CLI surface ✅ (#21)
- issue: [#5](https://github.com/pkkid/mesh-ui/issues/5)
- after: M1.1
- docs: architecture/cli.md, platform/cross-platform.md (CLI launcher)
- files: src/cli/index.ts, src/cli/args.ts, src/cli/run.ts, src/cli/format.ts, src/cli/script.ts, test/cli/cli.test.ts, scripts/mesh-ui-dev.mjs
- scope: `mesh-ui commands`, `run <id> --params '{...}' | @file | stdin`, `run script.jsonl` (stop on failure, `--keep-going`, per-line confirm, global `--confirm` refused for scripts), `status`, `login`, `logout`, `help`, `--version`; `--demo` and dev-only `--fake`; JSON and table output, `--quiet`, `--no-color`, `--reveal` for sensitive results; exit codes from cli.md. A dev launcher script runs the CLI through the local Electron binary headless.
- done when: CLI tests spawn the built CLI with `--demo` and a temp user data dir and cover each format, exit code and script rule; `mesh-ui --demo run app.info` works on the maintainer's machine.

### M1.6 MCP surface ✅ (#19)
- issue: [#6](https://github.com/pkkid/mesh-ui/issues/6)
- after: M1.1
- docs: architecture/mcp.md
- files: src/cli/mcp.ts, test/mcp/mcp.test.ts
- scope: `mesh-ui mcp` over stdio with `@modelcontextprotocol/sdk`: one tool per registry command (name from id, input schema from params, `confirm` added for disruptive and destructive), annotations from effect, `--read-only`, `--allow <glob>`, `--network`; auth login commands and `app.cli.install` not exposed. Registers itself in `src/cli/index.ts` (one-line edit).
- done when: in-process tests list tools, check names, schemas and annotations, call a query and a needs_confirm command with and without `confirm`, and `--read-only` hides writes.

### M1.7 App shell, themes and UI primitives ✅ (#25)
- issue: [#7](https://github.com/pkkid/mesh-ui/issues/7)
- after: M1.1
- docs: ux/overview.md, design/design-system.md, architecture/ui.md
- files: src/renderer/src/App.tsx, src/renderer/src/app/router.tsx, src/renderer/src/app/routes.ts, src/renderer/src/app/useCommand.ts, src/renderer/src/features/shell/Sidebar.tsx, src/renderer/src/features/shell/TopBar.tsx, src/renderer/src/features/shell/NetworkSwitcher.tsx, src/renderer/src/features/shell/ComingSoon.tsx, src/renderer/src/lib/themePalettes.ts, src/renderer/src/lib/themes.ts, src/renderer/src/lib/chartColors.ts, src/renderer/src/index.css, src/renderer/src/components/ui/card.tsx, src/renderer/src/components/ui/status.tsx, src/renderer/src/components/ui/segmented.tsx, src/renderer/src/components/ui/hero.tsx, src/renderer/src/components/ui/confirm.tsx, src/renderer/src/features/devices/DevicesView.tsx, src/renderer/src/features/settings/SettingsView.tsx
- scope: The window everyone builds in. Routes for every page (unbuilt ones render `ComingSoon`), sidebar with all nav items and counts, topbar with title, subtitle slot and actions slot, network switcher, the seven themes (Classic, Rose, Grove, Ocean, Ember, Iris, Gruvbox Hard; Gruvbox Hard default) with light, dark and system, chart series colours per theme, and primitives: card, status dot plus label, segmented toggle, page header (hero), inline confirm. `useCommand` hook wrapping `window.mesh.execute` with loading, error and polling from `poll.ts`. Retire the prototype Devices and Settings views (their pages come in M1.15 and M6). Works against a stub `window.mesh` until M1.4 lands.
- done when: every route renders without console errors; themes switch live and persist; primitives match the mockups; a renderer test or screenshot covers light and dark.

### M1.8 Chart kit ✅ (#27)
- issue: [#8](https://github.com/pkkid/mesh-ui/issues/8)
- after: M1.1
- docs: AGENTS.md (Charts), design/design-system.md (charts)
- files: src/renderer/src/components/charts/AreaChart.tsx, src/renderer/src/components/charts/BarChart.tsx, src/renderer/src/components/charts/Sparkline.tsx, src/renderer/src/components/charts/ShareBar.tsx, src/renderer/src/components/charts/Donut.tsx, src/renderer/src/components/charts/Gauge.tsx, src/renderer/src/components/charts/Heatmap.tsx, src/renderer/src/components/charts/Tooltip.tsx, src/renderer/src/components/charts/scale.ts, src/renderer/src/components/charts/curve.ts, src/renderer/src/components/charts/charts.test.ts
- scope: Hand-written SVG charts per the AGENTS.md rules: monotone cubic curves, line plus 12% area, nice ticks, y gutter, start/middle/end x labels, hover line and glass tooltip, shared scale, loading fade and empty sentence, `role="img"` with aria labels, no load animations. Colours come from `chartColors.ts` props, not inline.
- done when: unit tests cover nice ticks and that curves never overshoot data or go below zero; a demo gallery route (dev only) shows every chart in light and dark.

### M1.9 Auth, account and app commands, and sign-in ✅ (#32)
- issue: [#9](https://github.com/pkkid/mesh-ui/issues/9)
- after: M1.2, M1.3, M1.4, M1.7
- docs: ux/sign-in.md, architecture/commands.md (auth, account, app), architecture/security.md
- files: src/core/commands/auth.ts, src/core/commands/account.ts, src/core/commands/app.ts, src/core/commands/demo.ts, src/core/commands/auth.test.ts, src/core/commands/account.test.ts, src/core/commands/app.test.ts, src/core/eero/backend/auth.ts, src/core/eero/backend/account.ts, test/fake-eero/routes/account.ts, src/renderer/src/features/sign-in/SignInView.tsx, src/renderer/src/features/sign-in/CodeStep.tsx, src/renderer/src/features/sign-in/ChooseNetwork.tsx
- scope: `auth.status`, `auth.login.start`, `auth.login.verify`, `auth.login.resend`, `auth.logout`, `account.get`, `app.info`, and `demo.scenario.set` (demo only), with eero backend implementations and fake routes. Sign-in UI from mockup 18: email or phone, code entry with wrong-code and resend, choose network, first-run loading, signed-out and expired-session states.
- done when: command tests on demo and client tests on the fake server pass; sign-in works end to end in `pnpm dev:fake`; `MANUAL: Sign in to the real account | pnpm dev, sign in with your eero email and code | Overview shows your network | none`.

### M1.10 Network and internet read commands ✅ (#28)
- issue: [#10](https://github.com/pkkid/mesh-ui/issues/10)
- after: M1.2, M1.3
- docs: architecture/commands.md (network, internet), ux/pages/overview.md
- files: src/core/commands/network.ts, src/core/commands/internet.ts, src/core/commands/network.test.ts, src/core/commands/internet.test.ts, src/core/eero/backend/network.ts, src/core/eero/backend/internet.ts, src/core/eero/map/network.ts, test/fake-eero/routes/network.ts
- scope: `network.list`, `network.select`, `network.get`, `network.health`, `network.permissions`, `internet.get`, `speedtest.history`, with mapping from raw eero shapes, capability and permission gating fields, and fake routes for `account`, `{net}`, `{net}/speedtest`, `{net}/permissions`.
- done when: each command has demo tests (including bad_params) and fake-server tests for mapping; switching networks emits `network.selected`.

### M1.11 eero, device and profile read commands ✅ (#29)
- issue: [#11](https://github.com/pkkid/mesh-ui/issues/11)
- after: M1.2, M1.3
- docs: architecture/commands.md (eero, device, profile), ux/pages/devices.md
- files: src/core/commands/eero.ts, src/core/commands/device.ts, src/core/commands/profile.ts, src/core/commands/eero.test.ts, src/core/commands/device.test.ts, src/core/commands/profile.test.ts, src/core/eero/backend/eero.ts, src/core/eero/backend/device.ts, src/core/eero/backend/profile.ts, src/core/eero/map/eero.ts, src/core/eero/map/device.ts, src/core/eero/map/profile.ts, test/fake-eero/routes/eeros.ts, test/fake-eero/routes/devices.ts, test/fake-eero/routes/profiles.ts
- scope: `eero.list`, `eero.get`, `device.list` (with the filter, search, sort and summary params from commands.md, applied in core), `device.get`, `device.rates.refresh` (burst reporter, once a minute), `profile.list`, `profile.get`, with mapping, name fallbacks, and fake routes.
- done when: demo and fake-server tests pass, including the burst reporter rate limit and device name fallback chain; `mesh-ui --demo run device.list --params '{"status":"online"}'` prints a table.

### M1.12 Usage and events read commands ✅ (#30)
- issue: [#12](https://github.com/pkkid/mesh-ui/issues/12)
- after: M1.2, M1.3
- docs: architecture/commands.md (internet usage, activity), ux/pages/overview.md
- files: src/core/commands/usage.ts, src/core/commands/activity.ts, src/core/commands/usage.test.ts, src/core/commands/activity.test.ts, src/core/eero/backend/usage.ts, src/core/eero/backend/events.ts, src/core/eero/map/usage.ts, test/fake-eero/routes/usage.ts, test/fake-eero/routes/events.ts
- scope: `usage.get` (scope network, eero, device, profile; Day and Week; hourly and daily cadence for the heatmap), `usage.breakdown` (by device, profile, eero), `events.list` (paging, type filter, `format: csv`), with mapping of `{series, values}` and `app_events`, and the 7-day limit enforced in core.
- done when: demo and fake-server tests pass, including the 7-day clamp and CSV output.

### M1.13 Package build and CI smoke ✅ (#31)
- issue: [#13](https://github.com/pkkid/mesh-ui/issues/13)
- after: M1.4, M1.5
- docs: platform/build-and-release.md, testing.md (CI)
- files: electron-builder.yml, .github/workflows/ci.yml, scripts/dist-smoke.mjs, package.json
- scope: electron-builder config with app id `io.github.pkkid.meshui`, `pnpm dist:dir` for the current OS (unsigned), a local `pnpm test:keychainless` (Linux), and `ci.yml`: one smoke job per OS on pull requests to main and manual runs (install, typecheck, test, build), with concurrency cancelling. No other CI jobs.
- done when: `pnpm dist:dir` builds and launches with `--demo` locally; the smoke workflow is green on all three OS on the story's PR.

### M1.14 Overview page ✅ (#36)
- issue: [#14](https://github.com/pkkid/mesh-ui/issues/14)
- after: M1.7, M1.8, M1.10, M1.11, M1.12
- docs: ux/pages/overview.md
- files: src/renderer/src/features/overview/OverviewView.tsx, src/renderer/src/features/overview/NetworkHero.tsx, src/renderer/src/features/overview/DataUsage.tsx, src/renderer/src/features/overview/EerosList.tsx, src/renderer/src/features/overview/TopDevices.tsx, src/renderer/src/features/overview/ProfilesList.tsx, src/renderer/src/features/overview/BusyHeatmap.tsx, src/renderer/src/features/overview/RecentActivity.tsx, src/renderer/src/app/routes.ts
- scope: The Overview from mockup 01 and its page doc: header with network name, status, ISP, public IP, last speed test and gauges; data usage chart with Day and Week, By eero share bar; eeros list; top devices; profiles; busy-hours heatmap; recent activity. Buttons that need later write commands (Run speed test, Share Wi-Fi, Pause a profile, Restart network) are shown disabled with "Coming soon" tooltips. All states from the page doc.
- done when: matches the mockup in `pnpm dev:demo` and `pnpm dev:fake` in light and dark (screenshots in the PR); loading, empty and error states shown via `demo.scenario.set`.

### M1.15 Devices page ✅ (#37)
- issue: [#15](https://github.com/pkkid/mesh-ui/issues/15)
- after: M1.7, M1.8, M1.11
- docs: ux/pages/devices.md
- files: src/renderer/src/features/devices/DevicesPage.tsx, src/renderer/src/features/devices/DeviceSummary.tsx, src/renderer/src/features/devices/DeviceFilters.tsx, src/renderer/src/features/devices/DeviceTable.tsx, src/renderer/src/app/routes.ts
- scope: The Devices page from mockup 05, read-only: summary strip, search, network and status filters, group by and sort, grouped table with current rates (via `device.rates.refresh` polling), offline and blocked groups. Selection and bulk actions are shown but disabled until M4. Row click goes to a `ComingSoon` device detail until M2.
- done when: matches the mockup in demo and fake modes in light and dark (screenshots in the PR); filters and sort run through `device.list` params, not renderer logic.

### M1.R Review ✅
- issue: [#16](https://github.com/pkkid/mesh-ui/issues/16)
- owner: maintainer
- after: M1.1, M1.2, M1.3, M1.4, M1.5, M1.6, M1.7, M1.8, M1.9, M1.10, M1.11, M1.12, M1.13, M1.14, M1.15

## M2: See the network and its devices

Issue: [#48](https://github.com/pkkid/mesh-ui/issues/48) (parent of every M2 story)

Goal: the network side of the app is complete read-only: how the internet
connection is doing, how the mesh is built, and everything about each eero
and each device, plus a command palette. Safe to point at a real network.
In: Internet page; eeros page (topology map and tree, eero cards, usage by
eero, clients by band); eero detail (uplink, radios, connected devices,
ports, firmware history, IP and device info); device detail (signal, live
rates, usage, device info, IP addresses, reservation and forwards shown
read-only); command palette (go to pages, devices, profiles; run query
commands); new read commands `updates.get`, `eero.ports.get`,
`eero.firmware.history`, `reservation.list`, `forward.list`; the Carried
from M1 items.
Out: every write (speed test run, find and blink, placement test, LED,
nightlight, rename, port actions, pause, block, profile change, reservations
and forwards, `internet.plan.set`, eero and network restart, eero remove).
Their buttons render disabled with the "Coming soon" tooltip and the palette
lists write commands dimmed. Also out: coverage scan, Troubleshooting,
Profiles, Activity, Guest, Wi-Fi pages, and anything eero Plus (radio
analytics history, usage beyond about 7 days).

Done when:
- `pnpm check` passes locally in under a minute and the CI smoke is green
  on macOS, Windows and Linux.
- `pnpm ui:shot` screenshots of Internet, eeros, eero detail (gateway and a
  wireless leaf), device detail (wireless and wired) and the open palette, in
  demo and `--fake`, light and dark Gruvbox Hard, match mockups 02, 03, 04,
  06 and 19 (as aligned by M2.3), with the `network_offline`, `eero_offline`
  and `empty_network` scenarios and the bridge-mode network (Mom's House).
- Every new M2 command has demo tests through `engine.execute` including
  `bad_params`, and fake-server mapping tests; `mesh-ui --demo commands`
  lists them and `mesh-ui mcp --read-only` exposes them.
- `Ctrl K` (`Cmd K`) opens the palette, finds pages, devices, profiles and
  commands, runs a query command and shows its result; disruptive and
  destructive commands cannot run from it.
- Every Carried from M1 item is closed (M2.1, M2.2, M2.3, M2.7).

Parallelism: 4 waves (3, 5, 1, R); critical path M2.1 > M2.5 > M2.9 > M2.R
(M2.6 also gates M2.9). Hotspots: `src/core/model.ts`, `src/core/backend.ts`,
`src/core/eero/raw.ts`, `src/core/demo/fixtures.ts`, `src/core/demo/backend.ts`
and `test/fake-eero/state.ts` (owned by M2.1; wave 2 does not edit them);
`src/renderer/src/features/overview/OverviewView.tsx` (owned by M2.2);
`docs/architecture/commands.md` (each story edits only its own area's
section); registration files `src/core/commands/index.ts`,
`src/core/eero/backend/index.ts`, `test/fake-eero/routes/index.ts`,
`src/renderer/src/app/routes.ts`, `package.json`, `pnpm-lock.yaml` (one-line
edits by anyone).

Open questions (answers change details, not the plan): firmware history and
`resources.connections` availability on free accounts and older eeros;
whether the eero object has `radio_channel_stats`; per-device retries and
link-local IPv6; `{net}/routing` for admins and in bridge mode; the verdict
thresholds (Great 75% or more of plan, Below plan under 75%, Poor under
40%); a Pages group and `network.select` in the palette. Unknowns show `-`
and get `MANUAL:` lines.

Learned in M2:
- Verdict thresholds kept: Great 75% or more of plan, Poor under 40%.
- The palette has a Pages group.
- `radio_channel_stats` gives channel and tx power on the real API.
- Firmware history is `{data, meta.has_more}`, newest first (50 rows on the
  real gateway); the mapper dropped every row until #78.
- Lease time is not in the API: `lease.dhcp` has only ip, mask and router.
- Routing works for an owner: reservations, forwards and the LAN map.
- Four mappings were wrong on the real network although fake-server tests
  passed (lease time, eero ports, wireless upstream, eero subnet); fixed in
  M2.R-fix2.
- The eero client burned its rate budget on page loads until shared reads
  (#74).

### M2.1 Core contracts and fixtures for M2 ✅ (#62)
- issue: [#49](https://github.com/pkkid/mesh-ui/issues/49)
- after: M1.R
- docs: architecture/data-model.md, architecture/backends.md, architecture/commands.md (eero, device, internet), testing.md (Fixtures)
- files: src/core/model.ts, src/core/backend.ts, src/core/eero/raw.ts, src/core/demo/fixtures.ts, src/core/demo/backend.ts, src/core/demo/backend.test.ts, test/fake-eero/state.ts, src/core/commands/eero.ts, src/core/commands/eero.test.ts, src/core/commands/device.ts, src/core/commands/device.test.ts, src/core/commands/internet.ts, src/core/commands/internet.test.ts, src/core/commands/network.ts, src/core/eero/map/eero.ts, src/core/eero/map/device.ts, src/core/eero/map/network.ts, docs/architecture/data-model.md, docs/architecture/backends.md
- scope: Everything wave 2 shares, so it can fan out. Model: `SpeedTest.rating` gains `"poor"` (under 40% of plan, threshold in `internet.ts`); `Internet` gains `verdict` and `leaseRenewsAt` (core fills verdict, null for now); `Eero` gains `hop`, `meshQuality` (4 bars Excellent, 3 Good, 2 Weak, 0 to 1 Poor), `subnet`, `gatewayIp`, and per-`Radio` `txPowerDbm` and `autoChannel`; `NetworkHealth.issues` (`weak_link`, `eero_offline`, `network_offline` with eero, upstream and devices affected; `[]` for now); `Device.ipv6LinkLocal`; `DeviceSummary.byEero`, `byProfile`, `byManufacturer`; a `Routing` type (reservations, forwards, pinholes, `LanMap`); `FirmwareEntry.current`. Backend: `eero.ports`, `eero.firmwareHistory`, and new `routing` and `updates` areas (eero areas stay "not available yet" until wave 2). Core derives hop and quality in `eero.list`/`eero.get` and the three summary counts in `device.list`. Eero mapping returns `null` for new fields until their stories map them. Raw types for `connections`, `firmware_update/history`, `routing`, `updates` from docs/eero-api. Demo fixtures and backend methods for every new read (ports per eero with attached devices on that eero, firmware history ending at the current version, Maple Street forwards on reserved devices, updates per network, link-local addresses, lease time, tx power, auto channel), and fake-server seed state for the same raw shapes.
- done when: `pnpm check` passes; demo consistency tests cover the new fixtures (port attachments match `device.list`, forward devices have reservations, current firmware equals the eero's); tests show `byEero`, `byProfile`, `byManufacturer` each sum to `summary.total`, hop and quality follow the bar rules, and a 35% test rates `poor`; `mesh-ui --demo run eero.list` shows `hop` and `meshQuality`; no real names, MACs or IPs.

### M2.2 Shared page kit, device icons and time-zone clock ✅ (#60)
- issue: [#50](https://github.com/pkkid/mesh-ui/issues/50)
- after: M1.R
- docs: AGENTS.md (Dashboards and charts), design/design-system.md
- files: src/renderer/src/components/ui/page.tsx, src/renderer/src/components/ui/meter.tsx, src/renderer/src/components/ui/band-badge.tsx, src/renderer/src/components/ui/kv-list.tsx, src/renderer/src/components/ui/breakdown-table.tsx, src/renderer/src/lib/deviceIcons.ts, src/renderer/src/features/overview/OverviewView.tsx, src/renderer/src/features/overview/TopDevices.tsx, src/renderer/src/features/overview/NetworkHero.tsx, src/renderer/src/features/overview/ProfilesList.tsx, src/renderer/src/features/overview/RecentActivity.tsx, src/renderer/src/features/overview/EerosList.tsx, src/renderer/src/features/overview/BusyHeatmap.tsx, src/renderer/src/features/overview/DataUsage.tsx, src/renderer/src/features/devices/DeviceTable.tsx, src/renderer/src/features/devices/DeviceSummary.tsx, src/core/format.ts, src/core/format.test.ts, docs/design/design-system.md
- scope: Renderer pieces every M2 page reuses; no new commands and no visible change. Move `useNow`, `HeaderLink`, `ComingSoonButton`, `RowList`, `Row`, `PlaceholderRows` and `SectionError` out of `OverviewView.tsx` into `components/ui/page.tsx` and update Overview imports. New primitives: meter (plan and utilisation bars, warning tone at a threshold), band badge ("2.4 GHz", "5 GHz", "6 GHz", "Wired"), key-value list for info cards (mono values, copy button), breakdown table (2px series bar, Others row). Carried from M1: one device-type icon map in `lib/deviceIcons.ts` used by Overview and Devices, and a shared network-time-zone clock formatter in `core/format.ts` ("9:41 AM", "Oct 20, 9:41 AM", "Sat Nov 8", hour labels) replacing the inline `Intl.DateTimeFormat` in `BusyHeatmap` and `DataUsage`.
- done when: `pnpm check` passes and format tests cover the clock across a DST change and in two zones; `pnpm ui:shot` of Overview and Devices in light and dark look unchanged from M1 (before and after in the PR); no file outside `lib/deviceIcons.ts` maps device types to icons.

### M2.3 Mockups match the fixtures ✅ (#61)
- issue: [#51](https://github.com/pkkid/mesh-ui/issues/51)
- after: M1.R
- docs: reviews/M1.md (questions 3 and 6), architecture/backends.md (demo)
- files: docs/mockups/01-overview.html, docs/mockups/02-internet.html, docs/mockups/03-eeros.html, docs/mockups/04-eero-detail.html, docs/mockups/06-device-detail.html, docs/mockups/17-account-settings.html, docs/mockups/18-sign-in.html
- scope: Carried from M1, docs only. Align the mockups' numbers with the demo fixtures (Overview eero shares, eeros page band totals and client counts, Lake Cabin's role and eero count, and the values M2 pages show in 02, 04 and 06). Redraw mockup 18 as the two-step sign-in (welcome, code, dashboard) with no chooser or first-run frame. Layout and design stay as approved.
- done when: every changed number matches `mesh-ui --demo run` output for the same field (listed in the PR); mockup 18 shows only welcome and code; the mockup index still opens every page.

### M2.4 Internet page ✅ (#66)
- issue: [#52](https://github.com/pkkid/mesh-ui/issues/52)
- after: M2.1, M2.2, M2.3
- docs: ux/pages/internet.md, architecture/commands.md (internet, speed tests and usage)
- files: src/core/commands/internet.ts, src/core/commands/internet.test.ts, src/core/commands/usage.ts, src/core/commands/usage.test.ts, src/core/eero/backend/internet.ts, src/core/eero/map/network.ts, test/fake-eero/routes/network.ts, src/renderer/src/features/internet/InternetPage.tsx, src/renderer/src/features/internet/InternetHero.tsx, src/renderer/src/features/internet/Connection.tsx, src/renderer/src/features/internet/SpeedHistory.tsx, src/renderer/src/features/internet/EarlierTests.tsx, src/renderer/src/features/internet/InternetUsage.tsx, src/renderer/src/app/routes.ts, docs/ux/pages/internet.md
- scope: Core: the hero verdict built in core ("fast and steady", "slower than your plan", "down"); lease renew time mapped from `lease` on the eero backend with a fake route; `usage.breakdown {top?}` folds the rest into an "Others (n)" row in core. Page (mockup 02): hero with gauges; Connection cards (ISP, Addressing, NAT or Bridge badge, Copy details via `internet.get {format: "text"}`); speed test history Day/Week with averages, plan meters and info note; Earlier tests table with Export CSV (`speedtest.history {format: "csv"}` through a save dialog, or the clipboard if no host save exists yet); Data usage per hour and per day; "Using the most right now" (shares the once-a-minute burst); By device and By profile tables. Run speed test and the plan popover are disabled ("Coming soon"). Bridge mode hides per-device parts. All states from the page doc.
- done when: demo tests cover the verdict forms, Poor in the table, `top` with Others and `bad_params`, and fake-server tests cover lease mapping; `pnpm ui:shot --route '#/internet'` in demo and `--fake`, light and dark, plus `network_offline`, `empty_network` and Mom's House (bridge), are in the PR; `MANUAL: Internet page on the real network | pnpm dev, open Internet | ISP, public IPs, lease, DNS and speed tests match the eero app | none`.

### M2.5 eeros page and software updates read ✅ (#67)
- issue: [#53](https://github.com/pkkid/mesh-ui/issues/53)
- after: M2.1, M2.2, M2.3
- docs: ux/pages/eeros.md, architecture/commands.md (network, updates)
- files: src/core/commands/updates.ts, src/core/commands/updates.test.ts, src/core/commands/network.ts, src/core/commands/network.test.ts, src/core/eero/backend/updates.ts, src/core/eero/map/updates.ts, test/fake-eero/routes/updates.ts, src/renderer/src/components/mesh/Topology.tsx, src/renderer/src/components/mesh/TopologyTree.tsx, src/renderer/src/components/mesh/LinkChip.tsx, src/renderer/src/components/mesh/RadioTable.tsx, src/renderer/src/features/eeros/EerosPage.tsx, src/renderer/src/features/eeros/WeakLinkNote.tsx, src/renderer/src/features/eeros/EeroCards.tsx, src/renderer/src/features/eeros/EeroUsage.tsx, src/renderer/src/features/eeros/ClientsByBand.tsx, src/renderer/src/features/eeros/NetworkActions.tsx, src/renderer/src/app/routes.ts, docs/ux/pages/eeros.md
- scope: Core: `updates.get` (query) with demo and eero backends, mapping and fake route; `network.health` issues derived in core from eeros and devices (weak link with upstream and devices affected, eero offline, network offline). Page (mockup 03): topology Map and Tree with layout in `components/mesh/` for reuse by eero detail (Internet node, gateway, eeros by hop, solid wired links with speed, dashed wireless links with a quality chip, wired-clients chip, legend); weak link note and selected-eero card; eero cards Grid/List with the radio table, dual-band note and wired row; Data usage by eero, stacked, Day/Week, with legend toggles; Clients by band donut; Network actions; subtitle from `updates.get`. Find, Test placement and Restart network are disabled ("Coming soon"); Scan coverage links to Troubleshooting. Offline, one-eero-offline and single-eero states.
- done when: demo tests for `updates.get` (incl. `bad_params`) and every health issue kind, and fake-server tests for updates mapping; `pnpm ui:shot --route '#/eeros'` Map and Tree, demo and `--fake`, light and dark, plus `eero_offline` and `network_offline`, are in the PR; `MANUAL: eeros topology | pnpm dev, open eeros | upstream links, bars and band channels match the eero app | none`; `MANUAL: updates.get shape | pnpm mesh-ui run updates.get | current, target and per-eero versions filled | none`.

### M2.6 eero ports and firmware history reads ✅ (#64)
- issue: [#54](https://github.com/pkkid/mesh-ui/issues/54)
- after: M2.1
- docs: architecture/commands.md (eero), eero-api/endpoints.md (connections, firmware history), ux/pages/eero-detail.md (Data)
- files: src/core/commands/eero.ts, src/core/commands/eero.test.ts, src/core/eero/backend/eero.ts, src/core/eero/map/eero.ts, test/fake-eero/routes/eeros.ts
- scope: `eero.ports.get {eero}`: `GET resources.connections` mapped to `EeroPorts` (port status, negotiated and supported speed such as `P2500`, PoE, MAC, attached device or eero joined by MAC to devices and eeros, `actions[]` kept for M4, empty list when eero reports none). `eero.firmware.history {eero, limit?}`: `GET /2.2/eeros/{id}/firmware_update/history`, newest first, `current` marked. Map the M2.1 eero fields (`radio_channel_stats` tx power and utilisation, auto channel, subnet, gateway IP). Fake routes for both.
- done when: demo tests for both commands, including `bad_params`, an unknown eero and an eero from another network; fake-server tests cover speed parsing, attached-device joins, an empty port list and firmware ordering; `mesh-ui --demo run eero.ports.get --params '{"eero":"Office"}'` prints a table; `MANUAL: eero.ports.get and eero.firmware.history shapes | pnpm mesh-ui run each for one eero | ports and versions match the eero app; note if firmware history is empty or 404 | none`.

### M2.7 Device detail, reservation and forward reads, Devices filter counts ✅ (#68)
- issue: [#55](https://github.com/pkkid/mesh-ui/issues/55)
- after: M2.1, M2.2, M2.3
- docs: ux/pages/device-detail.md, ux/pages/devices.md, architecture/commands.md (device, routing)
- files: src/core/commands/routing.ts, src/core/commands/routing.test.ts, src/core/eero/backend/routing.ts, src/core/eero/map/routing.ts, src/core/eero/backend/device.ts, src/core/eero/map/device.ts, test/fake-eero/routes/routing.ts, src/renderer/src/features/device/DevicePage.tsx, src/renderer/src/features/device/DeviceHero.tsx, src/renderer/src/features/device/DeviceNow.tsx, src/renderer/src/features/device/DeviceUsage.tsx, src/renderer/src/features/device/DeviceInfo.tsx, src/renderer/src/features/device/DeviceAddresses.tsx, src/renderer/src/features/device/DeviceForwards.tsx, src/renderer/src/features/devices/DeviceFilters.tsx, src/renderer/src/app/routes.ts, docs/ux/pages/device-detail.md
- scope: Core: `reservation.list` (reservations joined to devices, plus `LanMap`) and `forward.list {device?}`, both reading one cached `GET {net}/routing`, with bridge mode answering empty with a reason; the eero backend fills `device.get` reservation from routing and maps link-local IPv6; fake routes. Page (mockup 06): hero with profile, eero and signal; Now live box (shared burst); Data usage Day/Week with busiest hour and network rank; Device information (wired variant shows port and speed); IP addresses with Reserved badge; Port forwarding rows; Prev/Next and `[` `]` follow the Devices list order; Devices row click lands here. Pause, Appearance, Change profile, Block, Edit/Reserve, the trash and switch on forwards, and + Open a port are disabled ("Coming soon"). Offline, paused, blocked, guest, wired, gone and bridge states. Carried from M1: counts in the Devices eero, profile and manufacturer filters from the M2.1 summary fields.
- done when: demo tests for both routing commands (incl. `bad_params`, an unknown device and bridge mode) and fake-server tests for routing mapping and `device.get` reservation; `pnpm ui:shot` of a wireless, a wired, a blocked and a guest device, demo and `--fake`, light and dark, plus Devices with the Filters popover open showing counts, are in the PR; `MANUAL: reservation.list and forward.list | pnpm mesh-ui run each | reservations and forwards match the eero app | none`.

### M2.8 Command palette ✅ (#65)
- issue: [#56](https://github.com/pkkid/mesh-ui/issues/56)
- after: M2.2
- docs: ux/pages/command-palette.md, architecture/ui.md (bridge), architecture/mcp.md (tool names, hints)
- files: src/renderer/src/features/palette/CommandPalette.tsx, src/renderer/src/features/palette/PaletteResults.tsx, src/renderer/src/features/palette/PalettePreview.tsx, src/renderer/src/features/palette/ParamsForm.tsx, src/renderer/src/features/palette/search.ts, src/renderer/src/features/palette/search.test.ts, src/renderer/src/components/ui/dialog.tsx, src/renderer/src/features/shell/TopBar.tsx, src/renderer/src/App.tsx, docs/ux/pages/command-palette.md
- scope: The palette from mockup 19, opened by the titlebar search or `Ctrl K` / `Cmd K`. Data: commands from `window.mesh.commands()`, devices and profiles from cached `device.list` and `profile.list`, plus a Pages group from `ROUTES` (documented in the page doc). Behaviour: scope chips, `>` id mode, ranked matches with highlight, Up/Down and Tab, Esc closes. Preview: effect tag, description, a params form generated from the JSON Schema (entity pickers for `Ref` params, segmented controls for small enums, zod messages), CLI line with Copy, MCP tool name, hints and call JSON. Running: Enter on a page, device or profile navigates; Enter on a query command runs it through `window.mesh.execute` and shows the result JSON in the preview. Write, disruptive and destructive commands and device and profile row actions are dimmed with "Coming soon"; "Add to script.jsonl" is disabled. Not-signed-in and no-permission states. Port the dialog from T3 Code.
- done when: unit tests cover ranking, `>` mode, scope counts and param-form defaults from a JSON Schema; `pnpm ui:shot --before` opening the palette with a query (`device`, `>eero.`) shows results and preview in light and dark; running `device.list {"status":"online"}` from the palette in demo shows the same JSON as the CLI.

### M2.9 eero detail page ✅ (#72)
- issue: [#57](https://github.com/pkkid/mesh-ui/issues/57)
- after: M2.5, M2.6
- docs: ux/pages/eero-detail.md
- files: src/renderer/src/features/eero/EeroPage.tsx, src/renderer/src/features/eero/EeroHero.tsx, src/renderer/src/features/eero/EeroUplink.tsx, src/renderer/src/features/eero/EeroUsage.tsx, src/renderer/src/features/eero/EeroRadios.tsx, src/renderer/src/features/eero/EeroDevices.tsx, src/renderer/src/features/eero/EeroPorts.tsx, src/renderer/src/features/eero/EeroSettings.tsx, src/renderer/src/features/eero/EeroActions.tsx, src/renderer/src/app/routes.ts, docs/ux/pages/eero-detail.md
- scope: Page (mockup 04), read-only: hero with product tile and LED bar, status, model and radio badges, uptime, devices and 24h data with share; Uplink card from the M2.5 mesh components (Internet and WAN for the gateway); Data usage Day/Week; Radios (channel, width, tx power, clients, utilisation, `-` when not reported); Connected devices; Ethernet ports tiles from `eero.ports.get`; settings cards shown as values (Location, Status light, Nightlight on Beacon only, Software from `updates.get` with the `eero.firmware.history` list, IP addresses with copy, Device information); `[` `]` move between eeros. Rename, LED, nightlight, port actions, Blink, Restart and Remove are disabled ("Coming soon"). Gateway, offline, gone, no-ports and no-history states.
- done when: `pnpm ui:shot` of the gateway, a wireless leaf (Office), the Beacon and an offline eero (`eero_offline`), demo and `--fake`, light and dark, are in the PR; uplink and ports match `eero.list` and `eero.ports.get` from the CLI; `MANUAL: eero detail on the real network | pnpm dev, open each eero | uplink, radios, ports and versions match the eero app | none`.

### M2.R Review ✅
- issue: [#58](https://github.com/pkkid/mesh-ui/issues/58)
- owner: maintainer
- after: M2.1, M2.2, M2.3, M2.4, M2.5, M2.6, M2.7, M2.8, M2.9

## M3: See people and settings

Issue: [#81](https://github.com/pkkid/mesh-ui/issues/81) (parent of every M3 story)

Goal: the rest of the app is complete read-only, so Mesh UI is a full
monitor of the network.
Carried from M1: guest usage on the eero backend (demo only today);
`events.summary`, `usage.quiet_hours` and grouped events; `slow` and
`errors` demo scenarios so loading and error states can be shown in demo.
Carried from M2: the shared Section header wraps when its subtitle is long
(eero detail "Ethernet ports"); `EerosList.tsx` keeps its own `MeshBars`
(import `components/mesh/LinkChip`); mockups 05, 10 and 14 still use old
`3c:22:fb` sample MACs; a fixed `max` on `AreaChart` so the Internet speed
chart can scale to the plan; a host save dialog for CSV exports (Internet
Export CSV copies to the clipboard today; Activity CSV needs it too);
every story that adds or maps a read first confirms the raw shape with one
read-only capture on the real network (key paths and types only), and the
fake server serves that confirmed shape; every new page gets a page-load
request-budget test like `src/core/eero/pageload.test.ts`; demo fixtures
cover every state the mockup shows (for example a plan set, leased devices,
blocked and guest devices); drop `Internet.leaseRenewsAt`, the Internet
page's lease row, its value in mockup 02 and its data-model row, since eero
sends no lease time (#78).

In: Profiles and Profile detail; Activity (event summary, stream, filters,
grouping, CSV through a save dialog); the notifications bell and desktop
alerts for new notifications; Guest and Wi-Fi as read views with share QR
codes; Advanced networking, Reservations & ports and Updates & admins as
read views; the Troubleshooting health check and support info; new read
commands `guest.get`, `guest.share`, `wifi.get`, `wifi.share`,
`wifi.password.get`, `settings.get`, `integrations.get`, `pinhole.list`,
`events.summary`, `notifications.list`, `notifications.settings.get`,
`health.check`, `support.info`, `support.report`, `admin.list`,
`updates.notes`, `usage.quiet_hours`; the Carried from M1 and M2 items.
Out: every write (pause, rename, schedules, guest and Wi-Fi changes,
settings, reservations, forwards, pinholes, invites, mark read, diagnostics
run, update install); their controls render disabled with "Coming soon".
Also out: App & account (M6) and anything eero Plus.

Done when:
- `pnpm check` passes locally in under a minute and the CI smoke is green
  on macOS, Windows and Linux.
- `pnpm ui:shot` screenshots of Profiles, a profile, Activity, the bell,
  Guest, Wi-Fi, Advanced networking, Reservations & ports, Updates & admins
  and Troubleshooting, in demo and `--fake`, light and dark, match mockups
  07, 08, 10, 11, 12, 13, 14, 15 and 16 (as aligned by M3.3), with the
  `network_offline`, `empty_network`, `slow` and `errors` scenarios and the
  bridge-mode network (Mom's House) where the page doc names them.
- Every new M3 command has demo tests through `engine.execute` including
  `bad_params`, fake-server mapping tests on a confirmed real shape, and a
  read-only real-network shape check in its PR (paths, types, counts);
  `mesh-ui --demo commands` lists them and `mesh-ui mcp --read-only`
  exposes them. Sensitive reads (`guest.share`, `wifi.share`,
  `wifi.password.get`) never print in logs and are marked sensitive in MCP.
- Each new page has a page-load request-budget test.
- Every Carried from M1 and M2 item is closed or moved with a reason.

Parallelism: 3 waves plus R (2, 9, 2, R); critical path M3.1 > M3.4 > M3.5
> M3.R (M3.8 also gates M3.13). Hotspots: `src/core/model.ts`, `src/core/backend.ts`,
`src/core/eero/raw.ts`, `src/core/demo/fixtures.ts`,
`src/core/demo/backend.ts`, `src/core/demo/scenario.ts` and
`test/fake-eero/state.ts` (owned by M3.1; later waves take small additive
edits only and say so); `src/renderer/src/features/shell/TopBar.tsx` (owned
by M3.7); `src/main/ipc.ts` and `src/preload/index.ts` (M3.2 adds the save bridge, then M3.7 the notify bridge);
`docs/architecture/commands.md` (each story edits only its own area's
section); registration files `src/core/commands/index.ts`,
`src/core/eero/backend/index.ts`, `test/fake-eero/routes/index.ts`,
`src/renderer/src/app/routes.ts`, `package.json`, `pnpm-lock.yaml` (one-line
edits by anyone).

Open questions (answers change details, not the plan): whether
`{net}/diagnostics`, `{net}/support`, `{net}/members`, `{net}/invites` and
the integrations fields answer for this account (M3.1 captures them; a 403
or 404 becomes an empty read with a reason, not an error); whether
notifications history is free; how `updates.notes` fetches the manifest
(absolute URL, no cookie); the QR encoder (a small pinned dependency or a
port, decided in M3.2).

### M3.1 Core contracts, captured shapes and fixtures for M3 ✅ (#98)
- issue: [#82](https://github.com/pkkid/mesh-ui/issues/82)
- after: M2.R
- docs: architecture/data-model.md, architecture/backends.md, architecture/commands.md (guest, wifi, settings, routing, activity, diagnostics, admins, integrations), testing.md (Fixtures, demo scenarios), eero-api/endpoints.md
- files: src/core/model.ts, src/core/backend.ts, src/core/eero/raw.ts, src/core/demo/fixtures.ts, src/core/demo/backend.ts, src/core/demo/backend.test.ts, src/core/demo/scenario.ts, test/fake-eero/state.ts, src/core/eero/backend/index.ts, src/core/eero/backend/internet.ts, src/core/eero/map/network.ts, src/core/commands/internet.ts, src/core/commands/internet.test.ts, src/renderer/src/features/internet/Connection.tsx, docs/mockups/02-internet.html, docs/architecture/data-model.md, docs/architecture/backends.md, docs/eero-api/endpoints.md, docs/testing.md
- scope: Everything wave 2 shares. First, one read-only capture on the real network (key paths and types only, per AGENTS.md Testing) of `{net}/guestnetwork`, `{net}` (settings fields), `{net}/wpa3_per_band`, `{net}/fast_transition`, `{net}/power_saving/schedules`, `{net}/thread`, `{net}/ac_compat`, `{net}/routing` pinholes, `{profile}` and `{profile}/schedules`, `{net}/app_events`, `{net}/notifications_history`, `{net}/notifications`, `{net}/diagnostics`, `{net}/support`, `{net}/members`, `{net}/invites`, `{net}/proxied_nodes`; record them in `eero-api/endpoints.md`. Then backend areas `guest`, `wifi`, `settings`, `diagnostics`, `admins`, `integrations` and `notifications` in `backend.ts` (the eero backend answers "not available yet" for each, from `eero/backend/index.ts`, until its story), raw types from the captures, model fields each page needs, demo fixtures and methods for every new read (guest network with guests and usage, Wi-Fi bands, settings with a power saving schedule, pinholes, notifications with unread, a health report with a warning, support contacts, two admins and an invite) and fake seed state in the captured shapes. Demo scenarios `slow` (every read delayed) and `errors` (reads fail with `eero_error`) (Carried from M1). Drop `Internet.leaseRenewsAt` from the model, mapping, data-model row, the Internet page's lease row and mockup 02 (Carried from M2).
- done when: `pnpm check` passes; the PR lists every captured endpoint with its key paths and types, or its 403 or 404, and no values; demo consistency tests cover the new fixtures (guests are on the guest network, pinholes and forwards point at reserved devices, unread count matches); `mesh-ui --demo run demo.scenario.set --params '{"scenario":"slow"}'` then any read is slow, and `errors` makes reads fail with `eero_error`; `leaseRenewsAt` is gone from `internet.get`, the Internet page and mockup 02; no real names, MACs or IPs.

### M3.2 Shared kit: QR, timeline, save dialog and M2 leftovers ✅ (#97)
- issue: [#83](https://github.com/pkkid/mesh-ui/issues/83)
- after: M2.R
- docs: AGENTS.md (Dashboards and charts), design/design-system.md, architecture/ui.md (bridge), architecture/security.md
- files: src/renderer/src/components/ui/qr.tsx, src/renderer/src/components/ui/timeline.tsx, src/renderer/src/components/ui/page.tsx, src/renderer/src/components/charts/AreaChart.tsx, src/renderer/src/components/charts/charts.test.ts, src/renderer/src/features/overview/EerosList.tsx, src/renderer/src/features/internet/SpeedHistory.tsx, src/renderer/src/features/internet/EarlierTests.tsx, src/renderer/src/lib/saveFile.ts, src/main/ipc.ts, src/preload/index.ts, docs/design/design-system.md
- scope: Renderer and host pieces wave 2 reuses. QR block (encoder decided here: a small pinned dependency or a port, with its licence noted) with Copy and Save PNG. Week timeline for schedules (days by hours, blocks that wrap past midnight), shared by profiles and power saving. A host save dialog over the one IPC bridge (`window.mesh.saveFile(name, text)`), never a command, locked to text and the user's chosen path; Internet Export CSV uses it. Carried from M2: Section header no longer wraps with a long subtitle; `EerosList` imports `MeshBars` from `components/mesh/LinkChip`; `AreaChart` takes a fixed `max` and the Internet speed chart scales to the plan.
- done when: `pnpm check` passes with tests for the timeline's wrap-past-midnight layout and the chart `max`; `pnpm ui:shot` of the chart gallery shows the QR and timeline in light and dark; Internet Export CSV writes a file through the save dialog in `ui:shot` (to a scratch path) and Overview, Internet and eero detail look unchanged apart from the listed fixes (before and after in the PR); the save bridge refuses non-text and never exposes a path to the renderer beyond the user's choice.

### M3.3 Mockups match the M3 fixtures ✅ (#101)
- issue: [#84](https://github.com/pkkid/mesh-ui/issues/84)
- after: M3.1
- docs: architecture/backends.md (demo)
- files: docs/mockups/05-devices.html, docs/mockups/07-profiles.html, docs/mockups/08-profile-detail.html, docs/mockups/10-activity.html, docs/mockups/11-guest.html, docs/mockups/12-wifi-settings.html, docs/mockups/13-advanced-networking.html, docs/mockups/14-reservations-ports.html, docs/mockups/15-updates-admins.html, docs/mockups/16-troubleshooting.html, docs/mockups/assets/mockup.js
- scope: Docs only. Align the M3 mockups' numbers and names with the demo fixtures, as M2.3 did; replace the old `3c:22:fb` sample MACs in 05, 10 and 14 (Carried from M2). Grey out or mark anything the captures in M3.1 showed is not available for this account. Layout and design stay as approved.
- done when: every changed value matches `mesh-ui --demo run` output for the same field (table in the PR); no `3c:22:fb` left; the mockup index opens every page.

### M3.4 Profiles page ✅ (#102)
- issue: [#85](https://github.com/pkkid/mesh-ui/issues/85)
- after: M3.1, M3.2
- docs: ux/pages/profiles.md, architecture/commands.md (profile)
- files: src/core/commands/profile.ts, src/core/commands/profile.test.ts, src/core/eero/backend/profile.ts, src/core/eero/map/profile.ts, test/fake-eero/routes/profiles.ts, src/renderer/src/features/profiles/ProfilesPage.tsx, src/renderer/src/features/profiles/ProfileCards.tsx, src/renderer/src/features/profiles/UnassignedCard.tsx, src/renderer/src/features/profiles/ProfilesUsage.tsx, src/renderer/src/features/profiles/ScheduleOverview.tsx, src/renderer/src/app/routes.ts, docs/ux/pages/profiles.md
- scope: Core: map schedules from `{profile}/schedules` on the captured shape; profile state (active, paused, scheduled) and next schedule computed in core in the network time zone; the `unassigned` summary. Page (mockup 07): profile cards with state, devices online, usage today and next schedule; Unassigned card; usage by profile Day/Week; the week schedule overview on the shared timeline. Pause, resume, add and edit are disabled ("Coming soon"). Empty, offline, `slow`, `errors` and bridge states.
- done when: demo tests for state and next schedule across midnight and a DST change, `bad_params`, and fake-server tests for schedule mapping; a real shape check of `profile.list` in the PR; page-load budget test; `pnpm ui:shot --route '#/profiles'` in demo and `--fake`, light and dark, plus `empty_network` and `errors`; `MANUAL: Profiles on the real network | pnpm dev, open Profiles | states, devices and schedules match the eero app | none`.

### M3.5 Profile detail ✅ (#109)
- issue: [#86](https://github.com/pkkid/mesh-ui/issues/86)
- after: M3.4
- docs: ux/pages/profile-detail.md
- files: src/renderer/src/features/profile/ProfilePage.tsx, src/renderer/src/features/profile/ProfileHero.tsx, src/renderer/src/features/profile/ProfileSchedules.tsx, src/renderer/src/features/profile/ProfileDevices.tsx, src/renderer/src/features/profile/ProfileUsage.tsx, src/renderer/src/features/profile/helpers.ts, src/renderer/src/features/profile/helpers.test.ts, src/renderer/src/app/routes.ts, docs/ux/pages/profile-detail.md
- scope: Page (mockup 08), read-only: hero with state and next schedule; schedules on the shared timeline with a list; devices with status and usage; usage Day/Week with top devices; `[` `]` move between profiles. Every write is disabled ("Coming soon"). Paused, scheduled, empty-profile, gone and bridge states.
- done when: helper tests; `pnpm ui:shot` of an active, a paused and a scheduled profile, demo and `--fake`, light and dark, plus a gone profile; page-load budget test; `MANUAL: profile detail on the real network | pnpm dev, open each profile | schedules and devices match the eero app | none`.

### M3.6 Activity page and event summary ✅ (#103)
- issue: [#87](https://github.com/pkkid/mesh-ui/issues/87)
- after: M3.1, M3.2
- docs: ux/pages/activity.md, architecture/commands.md (activity)
- files: src/core/commands/activity.ts, src/core/commands/activity.test.ts, src/core/eero/backend/events.ts, test/fake-eero/routes/events.ts, src/renderer/src/features/activity/ActivityPage.tsx, src/renderer/src/features/activity/ActivityHero.tsx, src/renderer/src/features/activity/ActivityChart.tsx, src/renderer/src/features/activity/EventFilters.tsx, src/renderer/src/features/activity/EventStream.tsx, src/renderer/src/app/routes.ts, docs/ux/pages/activity.md
- scope: Core (Carried from M1): `events.summary` (total, daily average, change vs prior period, per category and per bucket, paging back to the range start within the rate budget) and `grouped` events in `events.list`. Page (mockup 10): hero, events per hour or day chart by category, filters (category, device, eero, profile, search, range), the stream with grouped rows and paging, Export CSV through the M3.2 save dialog. All states from the page doc.
- done when: demo tests for summary counts and change, grouping, filters and `bad_params`, and fake-server tests for paging back within the budget; a real shape check of `events.summary` in the PR; page-load budget test; `pnpm ui:shot --route '#/activity'` demo and `--fake`, light and dark, plus `empty_network` and `errors`; CSV saved through the dialog in `ui:shot`.

### M3.7 Notifications bell and desktop alerts ✅ (#100)
- issue: [#88](https://github.com/pkkid/mesh-ui/issues/88)
- after: M3.1, M3.2
- docs: ux/overview.md (notifications), architecture/engine.md (desktop notifications), architecture/security.md, architecture/commands.md (activity: notifications)
- files: src/core/commands/notifications.ts, src/core/commands/notifications.test.ts, src/core/eero/backend/notifications.ts, src/core/eero/map/notifications.ts, test/fake-eero/routes/notifications.ts, src/renderer/src/features/notifications/Bell.tsx, src/renderer/src/features/notifications/NotificationList.tsx, src/renderer/src/features/notifications/useDesktopAlerts.ts, src/renderer/src/features/shell/TopBar.tsx, src/main/notify.ts, src/main/index.ts, src/main/ipc.ts, src/preload/index.ts
- scope: Core: a `notifications` command area (its rows move out of the activity section in commands.md): `notifications.list` (history plus unread) and `notifications.settings.get` (eero keys plus the desktop choice from app settings). Bell in the titlebar with the unread dot and a popover list; Mark all read is disabled ("Coming soon"). Desktop alerts: the renderer's notifications poll finds new items and asks the host to show one OS notification each (offline eero and network first), through the IPC bridge, never with real data in logs; off when the desktop choice is off; clicking it focuses the window on the matching page.
- done when: demo tests for unread counts, new-item detection and `bad_params`, and fake-server mapping tests; a real shape check of `notifications.list` in the PR; `pnpm ui:shot` of the open bell in light and dark; a test shows one host notification per new item and none on first load; `MANUAL: desktop alert | pnpm dev:demo, run demo.scenario.set eero_offline from the palette | one OS notification appears and clicking it opens the eero | none`.

### M3.8 Guest page ✅ (#99)
- issue: [#89](https://github.com/pkkid/mesh-ui/issues/89)
- after: M3.1, M3.2
- docs: ux/pages/guest.md, architecture/commands.md (guest)
- files: src/core/commands/guest.ts, src/core/commands/guest.test.ts, src/core/eero/backend/guest.ts, src/core/eero/map/guest.ts, test/fake-eero/routes/guest.ts, src/core/commands/usage.ts, src/core/commands/usage.test.ts, src/renderer/src/features/guest/GuestPage.tsx, src/renderer/src/features/guest/GuestHero.tsx, src/renderer/src/features/guest/GuestDevices.tsx, src/renderer/src/features/guest/GuestUsage.tsx, src/renderer/src/app/routes.ts, docs/ux/pages/guest.md
- scope: Core: `guest.get` (no password, `hasPassword` only, online guests) and `guest.share` (sensitive: SSID, password, security, the `WIFI:` payload); guest usage on the eero backend (Carried from M1). Page (mockup 11): status, name and security, the QR block with Copy password and Save QR, guest devices, guest usage. Enable, rename and password changes are disabled ("Coming soon"). Off, open (no password), offline and bridge states.
- done when: demo tests for both commands incl. `bad_params`, the open network and the `WIFI:` escaping of `;`, `,`, `:` and `\`; fake-server tests for guest mapping and usage; a real shape check of `guest.get` in the PR (no password printed); `guest.share` is marked sensitive and its result never reaches logs (test); page-load budget test; `pnpm ui:shot --route '#/guest'` demo and `--fake`, light and dark, plus guest off.

### M3.9 Wi-Fi page ✅ (#104)
- issue: [#90](https://github.com/pkkid/mesh-ui/issues/90)
- after: M3.1, M3.2
- docs: ux/pages/wifi.md, architecture/commands.md (wifi)
- files: src/core/commands/wifi.ts, src/core/commands/wifi.test.ts, src/core/eero/backend/wifi.ts, src/core/eero/map/wifi.ts, test/fake-eero/routes/wifi.ts, src/renderer/src/features/wifi/WifiPage.tsx, src/renderer/src/features/wifi/WifiHero.tsx, src/renderer/src/features/wifi/WifiBands.tsx, src/renderer/src/features/wifi/WifiSecurity.tsx, src/renderer/src/app/routes.ts, docs/ux/pages/wifi.md
- scope: Core: `wifi.get` (SSID, security per band, bands with clients, widths, channels, the 2.4 GHz only flag and its expiry; no password), `wifi.password.get` and `wifi.share` (both sensitive, only on explicit reveal or share). Page (mockup 12): name, the QR block, Reveal password, security per band, bands and clients, time zone. Every change is disabled ("Coming soon"). Offline and single-band states.
- done when: demo tests for the three commands incl. `bad_params`; fake-server tests for `wpa3_per_band` and the flag mapping; a real shape check of `wifi.get` in the PR (no password printed); sensitive results never reach logs (test); page-load budget test (reveal not counted); `pnpm ui:shot --route '#/wifi'` demo and `--fake`, light and dark.

### M3.10 Advanced networking read view ✅ (#106)
- issue: [#91](https://github.com/pkkid/mesh-ui/issues/91)
- after: M3.1, M3.2
- docs: ux/pages/advanced-networking.md, architecture/commands.md (settings, integrations)
- files: src/core/commands/settings.ts, src/core/commands/settings.test.ts, src/core/commands/integrations.ts, src/core/commands/integrations.test.ts, src/core/eero/backend/settings.ts, src/core/eero/map/settings.ts, src/core/eero/backend/integrations.ts, test/fake-eero/routes/settings.ts, src/renderer/src/features/advanced/AdvancedPage.tsx, src/renderer/src/features/advanced/SettingsGroups.tsx, src/renderer/src/features/advanced/PowerSaving.tsx, src/renderer/src/features/advanced/Integrations.tsx, src/renderer/src/app/routes.ts, docs/ux/pages/advanced-networking.md
- scope: Core: `settings.get` (DNS, DHCP, IPv6, WAN, connection mode, UPnP, SQM, band steering, fast roaming, MLO, power saving with schedules, legacy mode, Thread without secrets) and `integrations.get` (each with `available` and `enabled`; a 403 or 404 is unavailable, not an error). Page (mockup 13): every group as read-only values, power saving schedules on the shared timeline, integrations. Every toggle is disabled ("Coming soon"); `settings.impact` waits for M5. Bridge and offline states.
- done when: demo tests incl. `bad_params` and Thread secrets never in the result; fake-server tests on the captured shapes; real shape checks of both commands in the PR; page-load budget test; `pnpm ui:shot --route '#/advanced'` demo and `--fake`, light and dark, plus Mom's House (bridge).

### M3.11 Reservations & ports read view ✅ (#110)
- issue: [#92](https://github.com/pkkid/mesh-ui/issues/92)
- after: M3.1, M3.2
- docs: ux/pages/reservations-ports.md, architecture/commands.md (routing)
- files: src/core/commands/routing.ts, src/core/commands/routing.test.ts, src/core/eero/backend/routing.ts, src/core/eero/map/routing.ts, test/fake-eero/routes/routing.ts, src/renderer/src/features/ports/PortsPage.tsx, src/renderer/src/features/ports/LanMap.tsx, src/renderer/src/features/ports/Reservations.tsx, src/renderer/src/features/ports/Forwards.tsx, src/renderer/src/features/ports/Pinholes.tsx, src/renderer/src/app/routes.ts, docs/ux/pages/reservations-ports.md
- scope: Core: `pinhole.list` on the captured shape, from the same cached routing read. Page (mockup 14): LAN map with the pool and leased count, reservations, port forwards, IPv6 rules, each joined to devices. Add, edit, toggle and remove are disabled ("Coming soon"). Bridge, empty and offline states.
- done when: demo tests for `pinhole.list` incl. `bad_params` and bridge; fake-server mapping tests; a real shape check of `pinhole.list` in the PR; page-load budget test (one routing read for the page); `pnpm ui:shot --route '#/ports'` demo and `--fake`, light and dark, plus bridge and empty.

### M3.12 Troubleshooting health check ✅ (#117)
- issue: [#93](https://github.com/pkkid/mesh-ui/issues/93)
- after: M3.1, M3.2
- docs: ux/pages/troubleshooting.md, architecture/commands.md (diagnostics)
- files: src/core/commands/diagnostics.ts, src/core/commands/diagnostics.test.ts, src/core/eero/backend/diagnostics.ts, src/core/eero/map/diagnostics.ts, test/fake-eero/routes/diagnostics.ts, src/renderer/src/features/troubleshooting/TroubleshootingPage.tsx, src/renderer/src/features/troubleshooting/HealthChecks.tsx, src/renderer/src/features/troubleshooting/SupportCard.tsx, src/renderer/src/features/troubleshooting/Tools.tsx, src/renderer/src/app/routes.ts, docs/ux/pages/troubleshooting.md
- scope: Core: `health.check` (internet, DNS, each eero, mesh links, firmware, each good, warning or problem with one line, from cached topics and `network.health` issues; no active probes), `support.info` (eero and ISP contacts, support ID) and `support.report` (plain-text report with MACs, IPs, names and serials redacted to the last four characters, built in core). Page (mockup 16): health check list, Copy diagnostics report, support contacts. Diagnose, restarts and coverage scan are disabled ("Coming soon"). Healthy, warning, offline and `errors` states.
- done when: demo tests for every check status, the redaction (no full MAC, IP or serial in the report) and `bad_params`; fake-server mapping tests; real shape checks of `health.check` and `support.info` in the PR; page-load budget test; `pnpm ui:shot --route '#/troubleshooting'` demo and `--fake`, light and dark, plus `eero_offline` and `network_offline`.

### M3.13 Updates & admins read view ✅ (#107)
- issue: [#94](https://github.com/pkkid/mesh-ui/issues/94)
- after: M3.1, M3.2, M3.8
- docs: ux/pages/updates-admins.md, architecture/commands.md (updates, admins, usage)
- files: src/core/commands/admins.ts, src/core/commands/admins.test.ts, src/core/commands/usage.ts, src/core/commands/usage.test.ts, src/core/eero/backend/admins.ts, src/core/eero/map/admins.ts, test/fake-eero/routes/admins.ts, src/core/commands/updates.ts, src/core/commands/updates.test.ts, src/core/eero/backend/updates.ts, src/core/eero/client.ts, src/renderer/src/features/updates/UpdatesPage.tsx, src/renderer/src/features/updates/SoftwareCard.tsx, src/renderer/src/features/updates/QuietHours.tsx, src/renderer/src/features/updates/Admins.tsx, src/renderer/src/app/routes.ts, docs/ux/pages/updates-admins.md
- scope: Core: `admin.list` (admins and invites, seats of 10; invites that 403 for an admin are empty, not an error), `updates.notes` (release notes from the absolute manifest URL, fetched by the eero client without the session cookie, https only, size capped) and `usage.quiet_hours` (Carried from M1; the quietest 3-hour window from the hourly usage call). Page (mockup 15): software status and per-eero versions, release notes, preferred update time with the quiet-hours chart, admins and invites. Install, preferred hour, invite and remove are disabled ("Coming soon"). Owner and admin views. Runs after M3.8, which also edits the usage command files.
- done when: demo tests for the three commands incl. `bad_params` and the owner and admin views; a test shows `updates.notes` sends no cookie and refuses http and oversize bodies; real shape checks of `admin.list` and `updates.notes` in the PR; page-load budget test; `pnpm ui:shot --route '#/updates'` demo and `--fake`, light and dark, plus the admin view.

### M3.R Review ✅
- issue: [#95](https://github.com/pkkid/mesh-ui/issues/95)
- owner: maintainer
- after: M3.1, M3.2, M3.3, M3.4, M3.5, M3.6, M3.7, M3.8, M3.9, M3.10, M3.11, M3.12, M3.13

## M4: Everyday control

Issue: [#122](https://github.com/pkkid/mesh-ui/issues/122) (parent of every M4 story)

Goal: do the common jobs from the eero app in Mesh UI: pause and resume,
rename, block, manage profiles and schedules, guest and Wi-Fi changes,
restarts, speed tests, with confirms on every disruptive action.
Carried from M1: the audit log for CLI and MCP calls (no owner yet; cli.md
and mcp.md expect it); burst cooldown, the devices cache TTL after a burst
and a write settle delay; each write invalidates the topics it changes
(`internet.plan.set` invalidates network and speedtest; device writes refresh
`network.get` counts); the engine cache keeps only the last two networks;
the eero client re-reads the SecretStore on a 401 so two processes (app and
CLI) share one session.
Carried from M2: palette and pages dim commands by capability and bridge
mode, and show the "no permission" state, once commands report them; copy
and export feedback through the undo toast system; writes are never tried
on the real network, so before each write story capture, with a read-only
call, the object the write will change, and keep a `MANUAL:` line for the
write itself.
Carried from M3: `profile.get` returns today's pauses so profile detail
draws a manual pause; an Unassigned detail route; Activity row actions
(Assign profile, Resume, Unblock) need device, eero or profile links that
real events do not carry; guest Print card and Send to a guest; Mark all
read; the eero client shares an identical `GET {net}` (which holds the
password) for 5 s, so a reveal right after an outside password change can
show the old one (bypass or clear it for credential reads).
Learned in M3: the Unassigned group is a real profile with `default: true`,
so moving a device to "no profile" likely means assigning the default
profile's id; capture a device's profile link read-only before building
that write. Notifications carry only a network-wide `has_unread`, so Mark
all read is network-wide. Free accounts keep about 7 days of events and
usage history. Guest and Wi-Fi password stories list `src/cli/format.ts`
and handle the 5 s shared GET above.

In: the write commands for devices (pause, resume, rename, type, profile,
block, unblock), profiles (create, rename, pause, resume, devices, delete,
Unassigned pause and resume) and their schedules, guest (on, off, rename,
password), Wi-Fi (name, password, security, 2.4 GHz only, impact, password
generator), eeros (rename, find, status light, nightlight, restart),
network restart, speed test run, internet plan, Mark all read; the
renderer write kit (toasts with Undo and progress, inline confirm, confirm
dialog with type-the-name, edit sheet, capability and bridge dimming, "no
permission"); the palette running write commands with confirm; the engine
and client write rules and the audit log (Carried from M1); every Carried
from M2 and M3 item above.
Out: everything in M5 (DNS, DHCP, IPv6, WAN, UPnP, SQM, band steering,
Thread, power saving, integrations, reservations, forwards, pinholes,
update install, admins and invites, network transfer and delete, eero ports
and remove, diagnostics, coverage scan, notification settings), App &
account (M6), Activity row actions (real events carry no links; moved to
M5 with a capture), and anything eero Plus.

Done when:
- `pnpm check` passes locally in under a minute and the CI smoke is green
  on macOS, Windows and Linux.
- Every new write command has demo tests through `engine.execute` that show
  the change in the next read, plus `bad_params`, and `needs_confirm` for
  `disruptive` and `destructive`; a fake-server test of the exact request
  (method, path, API version, form or JSON body) and of the topics it
  invalidates; a read-only real capture of the object it changes in its PR
  (key paths and types only); and a `MANUAL:` line for the real write. No
  write runs on the real network, on any surface.
- In demo and `--fake`, every M4 control that M3 showed as "Coming soon"
  works: the change shows on the page, reversible writes get a toast with
  Undo, disruptive ones ask first and show a progress toast, destructive
  ones use the confirm dialog. `pnpm ui:shot` light and dark of each page's
  confirm and toast states.
- The palette runs write commands, with the same confirm and toasts; CLI
  `--confirm` and MCP `confirm: true` behave the same (tests).
- CLI and MCP calls are written to the audit log without tokens or
  credentials (test).
- Every Carried from M1, M2 and M3 item is closed or moved with a reason.

Parallelism: 3 waves plus R (3, 7, 2, R); critical path M4.1 > M4.5 >
M4.12 > M4.R (M4.8 also gates M4.9). Hotspots: `src/core/model.ts`, `src/core/backend.ts`,
`src/core/eero/raw.ts`, `src/core/demo/fixtures.ts`,
`src/core/demo/backend.ts`, `src/core/demo/scenario.ts` and
`test/fake-eero/state.ts` (owned by M4.1; later stories take small additive
edits only and say so); `src/core/engine.ts`, `src/core/poll.ts` and
`src/core/eero/client.ts` (owned by M4.2); `src/renderer/src/App.tsx`,
`src/renderer/src/app/useCommand.ts` and `components/ui/confirm.tsx`
(owned by M4.3). Shared-additive files (small edits by anyone, named in the
PR): `docs/architecture/data-model.md`, `src/shared/types.ts`,
`src/renderer/src/lib/chartColors.ts`, `src/cli/format.ts`, and each
story's own area section of `docs/architecture/commands.md`. Registration
files (one-line edits by anyone): `src/core/commands/index.ts`,
`src/core/eero/backend/index.ts`, `test/fake-eero/routes/index.ts`,
`src/renderer/src/app/routes.ts`, `package.json`, `pnpm-lock.yaml`.

Safety for every story: writes are tried only in demo and against the fake
server. The real network gets one read-only capture of the object the write
changes (paths and types). The exact request each write sends comes from
`docs/eero-api/` and the open source clients, and its real behaviour is a
`MANUAL:` line for the maintainer.

### M4.1 Core write contracts, demo writes and fake write state ✅ (#151)
- issue: [#123](https://github.com/pkkid/mesh-ui/issues/123)
- after: M3.R
- docs: architecture/backends.md, architecture/data-model.md, architecture/commands.md (Effects, Confirmation), testing.md (Fixtures), eero-api/endpoints.md
- files: src/core/model.ts, src/core/backend.ts, src/core/eero/raw.ts, src/core/demo/fixtures.ts, src/core/demo/backend.ts, src/core/demo/backend.test.ts, src/core/demo/scenario.ts, test/fake-eero/state.ts, test/fake-eero/server.ts, src/core/eero/backend/index.ts, src/core/commands/wifi.ts, src/core/commands/wifi.test.ts, docs/architecture/backends.md, docs/architecture/data-model.md, docs/eero-api/endpoints.md, docs/testing.md
- scope: Everything wave 2 shares. Write methods on every M4 backend area (devices, profiles, schedules, guest, wifi, eeros, network, speed test, notifications) in `backend.ts`; the eero backend answers "not available yet" for each until its story. The demo backend applies every write to its fixtures (so pause, rename, block and guest off visibly change the next read) and resets per scenario. The fake server accepts PUT, POST and DELETE with form and JSON bodies, keeps state, and records each write request so tests can assert method, path, version and body. Read-only captures of the objects M4 writes change, recorded in `endpoints.md` (paths and types): a device (`profile`, `paused`, `nickname`, `device_type`), a profile with `schedule[]` and the `default: true` profile, `guestnetwork`, `{net}` Wi-Fi fields and `temporary_flags`, `wpa3_per_band`, an eero (`led_on`, `led_brightness`, `resources`, nightlight on a Beacon if any), `speedtest`. Adds `wifi.password.generate` (pure core, crypto RNG, no look-alike characters).
- done when: `pnpm check` passes; the PR lists every capture with key paths and types and no values; demo tests show a write applied and reset by `demo.scenario.set`; a fake-server test records a PUT with a form body and a `/2.3/` JSON body; `wifi.password.generate` tests (length, alphabet, no look-alikes, `bad_params`); no real names, MACs or IPs.

### M4.2 Engine and client write rules, audit log ✅ (#149)
- issue: [#124](https://github.com/pkkid/mesh-ui/issues/124)
- after: M3.R
- docs: architecture/engine.md, architecture/eero-client.md, architecture/security.md (Audit log), architecture/cli.md, architecture/mcp.md
- files: src/core/engine.ts, src/core/engine.test.ts, src/core/poll.ts, src/core/eero/client.ts, src/core/eero/client.test.ts, src/core/audit.ts, src/core/audit.test.ts, src/cli/run.ts, src/cli/script.ts, src/cli/mcp.ts, docs/architecture/engine.md, docs/architecture/eero-client.md, docs/architecture/security.md, docs/architecture/cli.md, docs/architecture/mcp.md
- scope: Carried from M1 and M3. A write invalidates the topics its spec lists, after a short settle delay so the next read sees eero's new state; burst cooldown and the devices TTL after a burst; the engine cache keeps only the last two networks; the eero client re-reads the SecretStore on a 401 before refreshing, so app and CLI share one session; credential reads (`wifi.password.get`, `wifi.share`, `guest.share`) and every write bypass or clear the 5 s shared `GET {net}`; writes are never retried (429 or otherwise). Audit log in core: one line per CLI and MCP command (time, surface, id, effect, ok or error code, params with sensitive fields and passwords removed), stored in the user data dir with a size cap; no token, password or `WIFI:` payload ever.
- done when: engine tests for invalidation after settle, the two-network cache and burst cooldown; client tests against the fake server for the SecretStore re-read on 401, the credential bypass (a password changed on the fake shows on the next reveal) and no retry of a write on 429; audit tests show CLI and MCP calls logged and a `wifi.password.set` or `guest.password.set` line with no password; `pnpm check` passes.

### M4.3 Renderer write kit ✅ (#150)
- issue: [#125](https://github.com/pkkid/mesh-ui/issues/125)
- after: M3.R
- docs: ux/overview.md (Toasts, Sheets, Loading, empty and error), design/design-system.md, architecture/ui.md
- files: src/renderer/src/components/ui/toast.tsx, src/renderer/src/components/ui/sheet.tsx, src/renderer/src/components/ui/confirm.tsx, src/renderer/src/components/ui/page.tsx, src/renderer/src/app/useCommand.ts, src/renderer/src/app/useWrite.ts, src/renderer/src/app/useWrite.test.ts, src/renderer/src/App.tsx, src/renderer/src/lib/clipboard.ts, src/renderer/src/lib/saveFile.ts, src/renderer/src/components/charts/ChartGallery.tsx, docs/ux/overview.md, docs/design/design-system.md
- scope: The pieces every wave-2 page uses. Toasts as in ux/overview.md (success with Undo running the inverse command, progress kept until done, error with Retry, max 3, `aria-live`). Inline confirm for `disruptive` and a dialog with type-the-name for `destructive`, both reading the command's `needs_confirm` message. An edit sheet (header, fields with `bad_params` under the field, Save disabled until valid, Discard changes?). A `useWrite` hook: runs `execute`, passes `confirm` only after the person confirms, shows the toasts, refreshes the topics, leaves the control in its old state on error. Controls dim by capability and bridge mode from `network.permissions` and `network.get`, with a "no permission" tooltip, replacing `ComingSoonButton` where a command exists. Copy and Save feedback through toasts (Carried from M2). The chart gallery shows each piece.
- done when: hook tests for success, Undo, confirm, `needs_confirm` and error paths against the demo engine; `pnpm ui:shot` of the gallery (toasts, confirm, dialog, sheet) light and dark; Copy and Export CSV show a toast; `pnpm check` passes.

### M4.4 Device controls ✅ (#157)
- issue: [#126](https://github.com/pkkid/mesh-ui/issues/126)
- after: M4.1, M4.2, M4.3
- docs: ux/pages/devices.md, ux/pages/device-detail.md, architecture/commands.md (device)
- files: src/core/commands/device.ts, src/core/commands/device.test.ts, src/core/eero/backend/device.ts, src/core/eero/map/device.ts, test/fake-eero/routes/devices.ts, src/renderer/src/features/device/DeviceHero.tsx, src/renderer/src/features/device/DeviceInfo.tsx, src/renderer/src/features/device/DevicePage.tsx, src/renderer/src/features/devices/DeviceTable.tsx, src/renderer/src/features/devices/DevicesPage.tsx, src/renderer/src/features/devices/BulkBar.tsx, docs/ux/pages/devices.md, docs/ux/pages/device-detail.md
- scope: `device.pause`, `device.resume`, `device.rename`, `device.type.set`, `device.profile.set` (to `null` means eero's default profile; capture first), `device.block`, `device.unblock`, all on `/2.3/` where eero needs it. Device detail: pause, rename sheet, type, profile picker, block with Undo. Devices page: row actions and multi-select bulk pause, resume, profile and block. Writes refresh `network.get` counts.
- done when: demo and fake-server tests for every command (method, `/2.3/` path, body, invalidated topics, Unassigned as the default profile); a capture of a device's profile link; `pnpm ui:shot` of device detail and Devices bulk select, light and dark, plus a toast; `MANUAL: pause and resume one device | ... | the device drops and returns, the eero app agrees | brief loss for that device`.

### M4.5 Profile writes ✅ (#155)
- issue: [#127](https://github.com/pkkid/mesh-ui/issues/127)
- after: M4.1, M4.2, M4.3
- docs: ux/pages/profiles.md, ux/pages/profile-detail.md, architecture/commands.md (profile)
- files: src/core/commands/profile.ts, src/core/commands/profile.test.ts, src/core/eero/backend/profile.ts, src/core/eero/map/profile.ts, test/fake-eero/routes/profiles.ts, src/renderer/src/features/profiles/ProfilesPage.tsx, src/renderer/src/features/profiles/ProfileCards.tsx, src/renderer/src/features/profiles/UnassignedCard.tsx, src/renderer/src/features/profile/ProfilePage.tsx, src/renderer/src/features/profile/ProfileHero.tsx, src/renderer/src/features/profile/ProfileDevices.tsx, src/renderer/src/features/profile/UnassignedPage.tsx, src/renderer/src/features/profile/helpers.ts, src/renderer/src/features/profile/helpers.test.ts, src/renderer/src/features/overview/ProfilesList.tsx, docs/ux/pages/profiles.md, docs/ux/pages/profile-detail.md
- scope: `profile.create`, `profile.rename`, `profile.pause`, `profile.resume`, `profile.devices.set`, `profile.delete` (destructive, type-the-name), `profile.unassigned.pause` and `.resume`. Profiles page: Add a profile sheet, Pause all, pause and resume per card, Unassigned pause. Profile detail: rename, pause, devices picker, delete. Carried from M3: `profile.get` returns today's pauses so the hero and lane draw a manual pause; an Unassigned detail route (`#/profiles/unassigned`).
- done when: demo and fake-server tests for every command incl. `needs_confirm` on delete and the default profile never offered as a profile; today's pauses test for `profile.get`; `pnpm ui:shot` of Profiles (sheet, paused card, toast) and a profile (delete dialog) and the Unassigned page, light and dark; `MANUAL: pause and resume a test profile | ... | its devices drop and return | brief loss for that profile`.

### M4.6 Guest writes ✅ (#154)
- issue: [#128](https://github.com/pkkid/mesh-ui/issues/128)
- after: M4.1, M4.2, M4.3
- docs: ux/pages/guest.md, architecture/commands.md (guest)
- files: src/core/commands/guest.ts, src/core/commands/guest.test.ts, src/core/eero/backend/guest.ts, src/core/eero/map/guest.ts, test/fake-eero/routes/guest.ts, src/renderer/src/features/guest/GuestPage.tsx, src/renderer/src/features/guest/GuestHero.tsx, src/renderer/src/features/guest/GuestSettings.tsx, src/renderer/src/features/guest/GuestCard.tsx, src/cli/format.ts, docs/ux/pages/guest.md
- scope: `guest.enable`, `guest.disable` (disruptive), `guest.rename` (disruptive, must differ from the main SSID), `guest.password.set` (disruptive; `null` makes it open). Guest page: on and off with confirm, Name & password sheet with Generate (`wifi.password.generate`), the QR refreshing after a change. Carried from M3: Print a card (a print-only card with name, password and QR through the window's print) and Send to a guest (copies a short invite text with name and password).
- done when: demo and fake-server tests incl. `needs_confirm`, the main-SSID check, open network and form bodies; a new password never reaches logs, the audit log or the CLI table without `--reveal` (tests); `pnpm ui:shot --route '#/guest'` of the confirm, sheet and off state, light and dark; `MANUAL: guest off and on | ... | guests drop, then can rejoin | guests lose Wi-Fi briefly`.

### M4.7 Wi-Fi writes ✅ (#156)
- issue: [#129](https://github.com/pkkid/mesh-ui/issues/129)
- after: M4.1, M4.2, M4.3
- docs: ux/pages/wifi.md, architecture/commands.md (wifi)
- files: src/core/commands/wifi.ts, src/core/commands/wifi.test.ts, src/core/eero/backend/wifi.ts, src/core/eero/map/wifi.ts, test/fake-eero/routes/wifi.ts, src/renderer/src/features/wifi/WifiPage.tsx, src/renderer/src/features/wifi/WifiHero.tsx, src/renderer/src/features/wifi/WifiSecurity.tsx, src/renderer/src/features/wifi/WifiBands.tsx, src/renderer/src/features/wifi/WifiImpact.tsx, src/cli/format.ts, docs/ux/pages/wifi.md
- scope: `wifi.name.set`, `wifi.password.set`, `wifi.security.set`, `wifi.hide5g.set` (all disruptive) and `wifi.impact` (devices that must reconnect, WPA2-only devices for a security change, a restart estimate). Wi-Fi page: name and password sheet with Generate, security per band, the 2.4 GHz only switch with its countdown, the impact panel and inline confirm before each save. A reveal right after a password change shows the new one (M4.2's credential bypass).
- done when: demo and fake-server tests incl. `needs_confirm`, byte length of names, printable ASCII passwords, 6 GHz always WPA3, the `hide_5g` PUT and DELETE; passwords never in logs, audit log or CLI table without `--reveal`; `pnpm ui:shot --route '#/settings/wifi'` with the impact panel and confirm, light and dark; `MANUAL: rename the Wi-Fi network and back, only when a reconnect is fine | Settings > Wi-Fi, Change, save, then restore | every wireless device rejoins and the eero app shows the name | disruptive: all wireless devices drop for about a minute`.

### M4.8 eero and network controls ✅ (#158)
- issue: [#130](https://github.com/pkkid/mesh-ui/issues/130)
- after: M4.1, M4.2, M4.3
- docs: ux/pages/eeros.md, ux/pages/eero-detail.md, architecture/commands.md (eero, network, Restart estimates)
- files: src/core/commands/eero.ts, src/core/commands/eero.test.ts, src/core/commands/network.ts, src/core/commands/network.test.ts, src/core/eero/backend/eero.ts, src/core/eero/backend/network.ts, src/core/eero/map/eero.ts, test/fake-eero/routes/eeros.ts, test/fake-eero/routes/network.ts, src/renderer/src/features/eero/EeroActions.tsx, src/renderer/src/features/eero/EeroHero.tsx, src/renderer/src/features/eero/EeroSettings.tsx, src/renderer/src/features/eero/EeroPage.tsx, src/renderer/src/features/eeros/NetworkActions.tsx, src/renderer/src/features/eeros/EeroCards.tsx, src/renderer/src/features/overview/NetworkHero.tsx, docs/ux/pages/eeros.md, docs/ux/pages/eero-detail.md
- scope: `eero.rename`, `eero.find` (no Stop until verified), `eero.led.set` (through `resources.led_action`), `eero.nightlight.set` (Beacon only, capability check), `eero.restart` and `network.restart` (disruptive, message from Restart estimates, the gateway warning). eero detail and eeros page actions; Overview and eeros "Restart network" with a progress toast that clears when eeros come back.
- done when: demo and fake-server tests for each command incl. the `led_action` link, the Beacon check, `needs_confirm` and the gateway message; `pnpm ui:shot` of eero detail actions, the restart confirm and progress toast, light and dark; `MANUAL: blink one eero's light | ... | the light cycles blue and white | none` and `MANUAL: rename an eero and back | ... | the eero app shows the name | none`.

### M4.9 Speed test and internet plan ✅ (#162)
- issue: [#131](https://github.com/pkkid/mesh-ui/issues/131)
- after: M4.1, M4.2, M4.3, M4.8
- docs: ux/pages/internet.md, ux/pages/overview.md, architecture/commands.md (internet), architecture/engine.md (speed test poller)
- files: src/core/commands/internet.ts, src/core/commands/internet.test.ts, src/core/eero/backend/internet.ts, test/fake-eero/routes/network.ts, src/renderer/src/features/internet/InternetHero.tsx, src/renderer/src/features/internet/InternetPage.tsx, src/renderer/src/features/internet/PlanSheet.tsx, src/renderer/src/features/overview/NetworkHero.tsx, src/renderer/src/features/troubleshooting/Tools.tsx, docs/ux/pages/internet.md
- scope: `speedtest.run` (202, then the result read after about 60 s and the `speedtest` topic invalidated; at most one at a time per network) and `internet.plan.set` (app-local, invalidates network and speedtest). Run speed test on Overview, Internet and Troubleshooting with a progress toast; the plan sheet on Internet. Runs after M4.8, which also edits `test/fake-eero/routes/network.ts` and `NetworkHero.tsx`.
- done when: demo and fake-server tests for the run and result, one at a time, and the plan set and clear; `pnpm ui:shot` of the running and finished states and the plan sheet, light and dark; `MANUAL: run a speed test | ... | a new result appears and matches the eero app | uses the WAN for about 30 s`.

### M4.10 Palette runs write commands ✅ (#152)
- issue: [#132](https://github.com/pkkid/mesh-ui/issues/132)
- after: M4.3
- docs: ux/pages/command-palette.md, architecture/ui.md
- files: src/renderer/src/features/palette/CommandPalette.tsx, src/renderer/src/features/palette/PalettePreview.tsx, src/renderer/src/features/palette/PaletteResults.tsx, src/renderer/src/features/palette/ParamsForm.tsx, src/renderer/src/features/palette/search.ts, src/renderer/src/features/palette/search.test.ts, docs/ux/pages/command-palette.md
- scope: The palette runs `write` commands on Enter with a toast, `disruptive` ones after the inline confirm and `destructive` ones through the dialog, all with `useWrite`. Commands dim by capability, bridge mode and role with the reason (Carried from M2). Works for every write command as it lands, with no per-command code.
- done when: tests for running a write, the confirm path and dimming; `pnpm ui:shot` of the palette confirming `network.restart` and running `device.pause`, light and dark; `pnpm check` passes.

### M4.11 Mark all read ✅ (#153)
- issue: [#133](https://github.com/pkkid/mesh-ui/issues/133)
- after: M4.1, M4.2, M4.3
- docs: ux/overview.md (notifications), architecture/commands.md (notifications)
- files: src/core/commands/notifications.ts, src/core/commands/notifications.test.ts, src/core/eero/backend/notifications.ts, test/fake-eero/routes/notifications.ts, src/renderer/src/features/notifications/Bell.tsx, src/renderer/src/features/notifications/NotificationList.tsx, src/renderer/src/features/activity/EventStream.tsx
- scope: `notifications.mark_read` (network-wide, since eero keeps only `has_unread`) on the bell and the Activity Unread marker; the dot clears and the next poll agrees.
- done when: demo and fake-server tests (POST, `has_unread` false after); `pnpm ui:shot` of the bell before and after, light and dark; `MANUAL: Mark all read | ... | the eero app shows no unread | none`.

### M4.12 Scheduled pauses ✅ (#161)
- issue: [#134](https://github.com/pkkid/mesh-ui/issues/134)
- after: M4.5
- docs: ux/pages/profile-detail.md (Schedules), architecture/commands.md (profile schedules)
- files: src/core/commands/profile.ts, src/core/commands/profile.test.ts, src/core/eero/backend/profile.ts, test/fake-eero/routes/profiles.ts, src/renderer/src/features/profile/ProfileSchedules.tsx, src/renderer/src/features/profile/ScheduleSheet.tsx, src/renderer/src/features/profiles/ScheduleOverview.tsx, docs/ux/pages/profile-detail.md
- scope: `profile.schedule.add`, `.update` and `.remove` through `{profile}/schedules` (the GET there is a 404, so capture the profile's `schedule[]` and keep the write request from the clients; day form `MON` or `monday` decided from the capture). The schedule sheet (name, days, start and end with "next day" past midnight, enabled) on profile detail; the week timeline and today's lanes update.
- done when: demo and fake-server tests incl. wrap past midnight, days form and `bad_params`; `pnpm ui:shot` of the sheet and the updated timeline, light and dark; `MANUAL: add, edit and remove a schedule on a test profile | ... | the eero app shows it and it pauses on time | that profile pauses at the scheduled time`.

### M4.R Review ✅
- issue: [#135](https://github.com/pkkid/mesh-ui/issues/135)
- owner: maintainer
- after: M4.1, M4.2, M4.3, M4.4, M4.5, M4.6, M4.7, M4.8, M4.9, M4.10, M4.11, M4.12

## M5: Advanced settings

Issue: [#137](https://github.com/pkkid/mesh-ui/issues/137) (parent of every M5 story)

Goal: the settings power users need, with clear restart warnings.
Carried from M2: a real source for `Radio.autoChannel` (maybe
`{net}/radio_settings`, shape unknown); firmware history paging past 50
rows if eero ever returns more; eero ports hold a list of attachments per
port (the model keeps one item; eero sends several in
`connection_status.metadata.multiple_devices.connections[]`); confirm the
`port_status` of a down or disabled port with a read-only capture (only
`DATA_CONNECTED` and `WAN` seen; `DISABLED` is a guess).
Carried from M3: map eero Simple Setup (`auto_setup_mode`): print only that
enum value with one read-only call and map it (maintainer approved, M3
review question 1); Reservations & ports "IPv6 off" state from
`settings.get`; the fake eero list has no `radio_channel_stats`, so `--fake`
Wi-Fi shows `-` for width and channel; the fake server cannot serve the raw
release manifest, so `--fake` shows no release notes; `integrations.get` and
`wifi.get` share the `settings` poll topic (give them their own).
Moved from M4 planning: Activity row actions (Assign profile, Resume,
Unblock); real events carry no device, eero or profile links, so capture
whether any event type does before building them.
Carried from M4: move each write's gate (permission, bridge mode,
capability) into its command spec in core so pages and the palette share
it, replacing the id-prefix table in `palette/search.ts` (#152, #154); one
Share Wi-Fi sheet for Overview and Devices (Devices' button is still
disabled; Overview links to the Wi-Fi page, #164); "New profile from
selection" on the Unassigned card (#157); bulk device results carry
`failed[].name` (#157); clicking a week timeline segment opens the
schedule sheet (#161); schedules for Unassigned devices (no endpoint known;
capture first, #161); restart copy in `helpers.restartLine` and Network
actions still hard-codes times, and the Wi-Fi security change estimate is
borrowed from the network restart: both come from `settings.impact` (#156,
#158); `endpoints.md` section 18 says `led_cycle` takes `{id}` while the
client sends the serial: fix whichever the M4 Find manual check disproves
(#158); the palette preview shows "Running..." under a pending disruptive
confirm, and a palette `device.pause` run toasts "Done" without the Undo
that row actions get (M4 review). Update the docs and fixtures from the
answers to the M4 manual checks (Wi-Fi rename path, `hide_5g` shape,
schedule day form `MON`, Unassigned pause, nightlight shape).

In: the write commands behind Advanced networking (DNS, DHCP, IPv6, WAN,
connection mode, NAT randomization, UPnP, SQM, band steering, fast
roaming, MLO, legacy mode, power saving and its schedules, time zone,
Simple Setup, Thread incl. credentials and reset, network delete),
integrations (eero Built-in, Zigbee discover, Frustration-Free Setup,
Amazon unlink), reservations, port forwards (with validate) and IPv6
pinholes, updates (install, preferred hour), admins and invites (invite,
cancel, nickname, remove) and network transfer, eero port actions and eero
remove, Troubleshooting tools (diagnose, placement test, coverage scan,
upgrade report), notification settings, and `settings.impact`; every
Carried from M2, M3 and M4 item above.
Out: App & account and release (M6), anything eero Plus.

Done when:
- `pnpm check` passes locally in under a minute and the CI smoke is green
  on macOS, Windows and Linux.
- Every new write command has demo tests through `engine.execute` that show
  the change in the next read, plus `bad_params`, and `needs_confirm` for
  `disruptive` and `destructive`; a fake-server test of the exact request
  and of the topics it invalidates; a read-only real capture of the object
  it changes in its PR (key paths and types only); and a `MANUAL:` line for
  the real write. No write runs on the real network.
- Disruptive settings show `settings.impact` (what restarts, for how long,
  which devices drop) before the confirm; destructive ones (Thread reset,
  admin remove, network transfer and delete, eero remove, Amazon unlink)
  use the type-the-name dialog.
- In demo and `--fake`, every M5 control that M3 showed as "Coming soon"
  works, with M4's toasts, confirms and Undo. `pnpm ui:shot` light and dark
  of each page's confirm, impact and toast states.
- Every Carried from M2, M3 and M4 item is closed or moved with a reason.

Parallelism: 3 waves plus R (1, 8, 1, R); critical path M5.1 > M5.2 >
M5.3 > M5.R. Hotspots: `src/core/model.ts`, `src/core/backend.ts`,
`src/core/eero/raw.ts`, `src/core/demo/fixtures.ts`,
`src/core/demo/backend.ts`, `src/core/demo/scenario.ts`,
`test/fake-eero/state.ts` and `src/core/poll.ts` (owned by M5.1; later
stories take small additive edits only and say so);
`src/core/commands/settings.ts` and the Advanced networking page (M5.2,
then M5.3). Shared-additive files (small edits by anyone, named in the PR):
`docs/architecture/data-model.md`, `src/shared/types.ts`,
`src/renderer/src/lib/chartColors.ts`, `src/cli/format.ts`, and each
story's own area section of `docs/architecture/commands.md`. Registration
files (one-line edits by anyone): `src/core/commands/index.ts`,
`src/core/eero/backend/index.ts`, `test/fake-eero/routes/index.ts`,
`src/renderer/src/app/routes.ts`, `package.json`, `pnpm-lock.yaml`.

Safety for every story: as in M4, writes run only in demo and against the
fake server; the real network gets one read-only capture of the object a
write changes; real behaviour is a `MANUAL:` line, and anything that
restarts the network says so in its risk field.

### M5.1 Core contracts, captures and fixtures for M5 ☐
- issue: [#138](https://github.com/pkkid/mesh-ui/issues/138)
- after: M4.R
- docs: architecture/backends.md, architecture/data-model.md, architecture/commands.md (settings, Restart estimates), testing.md (Fixtures), eero-api/endpoints.md
- files: src/core/model.ts, src/core/backend.ts, src/core/eero/raw.ts, src/core/demo/fixtures.ts, src/core/demo/backend.ts, src/core/demo/backend.test.ts, src/core/demo/scenario.ts, src/core/poll.ts, test/fake-eero/state.ts, test/fake-eero/routes/eeros.ts, test/fake-eero/routes/updates.ts, src/core/eero/backend/index.ts, src/core/commands/settings.ts, src/core/commands/settings.test.ts, src/core/commands/integrations.ts, src/core/commands/wifi.ts, docs/architecture/backends.md, docs/architecture/data-model.md, docs/eero-api/endpoints.md, docs/testing.md
- scope: Everything wave 2 shares. Write methods on every M5 backend area (settings, integrations, routing, updates, admins, eero ports and remove, diagnostics, notifications settings); the eero backend answers "not available yet" until each story; the demo backend applies every write. Read-only captures (paths and types; one enum value for Simple Setup, as approved) of: `{net}` settings fields, `auto_setup_mode`, `{net}/routing` reservations, forwards and pinholes, `{net}/updates`, `{net}/members` and `{net}/invites`, an eero's `resources.connections` with a down port if any, `{net}/radio_settings` (for `Radio.autoChannel`), `{net}/notifications`, and whether any `app_events` type carries a device, eero or profile link. `settings.impact` in core from Restart estimates and cached devices. Carried from M3: map Simple Setup; fake `radio_channel_stats` and a raw release manifest on the fake server; `integrations.get` and `wifi.get` get their own poll topics.
- done when: `pnpm check` passes; the PR lists every capture (paths and types, the one Simple Setup value) and no other values; `settings.impact` tests for each disruptive setting; demo writes applied and reset per scenario; `--fake` Wi-Fi shows width and channel and `--fake` Updates shows release notes (`ui:shot`); no real names, MACs or IPs.

### M5.2 Internet-side settings ☐
- issue: [#139](https://github.com/pkkid/mesh-ui/issues/139)
- after: M5.1
- docs: ux/pages/advanced-networking.md, architecture/commands.md (settings)
- files: src/core/commands/settings.ts, src/core/commands/settings.test.ts, src/core/eero/backend/settings.ts, src/core/eero/map/settings.ts, test/fake-eero/routes/settings.ts, src/renderer/src/features/advanced/AdvancedPage.tsx, src/renderer/src/features/advanced/SettingsGroups.tsx, src/renderer/src/features/advanced/ImpactPanel.tsx, docs/ux/pages/advanced-networking.md
- scope: `settings.dns.set`, `settings.dhcp.set`, `settings.ipv6.set`, `settings.wan.set`, `settings.connection_mode.set` (bridge), `settings.nat_randomization.set`, `settings.upnp.set`, `settings.sqm.set`. Advanced networking groups for these with sheets, the impact panel and inline confirm. Carried from M3: Reservations & ports "IPv6 off" state reads `settings.get`.
- done when: demo and fake-server tests incl. `needs_confirm`, IP and subnet validation, bridge mode hiding NAT-only settings; `pnpm ui:shot --route '#/settings/advanced'` of a sheet, the impact panel and a progress toast, light and dark, plus Mom's House; `MANUAL: toggle UPnP off and on | ... | the eero app agrees | none` and `MANUAL: DNS change on a test network only | ... | ... | disruptive: the network restarts`.

### M5.3 Wireless, mesh and Thread settings, network delete ☐
- issue: [#140](https://github.com/pkkid/mesh-ui/issues/140)
- after: M5.2
- docs: ux/pages/advanced-networking.md, architecture/commands.md (settings, network)
- files: src/core/commands/settings.ts, src/core/commands/settings.test.ts, src/core/eero/backend/settings.ts, src/core/eero/map/settings.ts, test/fake-eero/routes/settings.ts, src/core/commands/network.ts, src/core/commands/network.test.ts, test/fake-eero/routes/network.ts, src/renderer/src/features/advanced/SettingsGroups.tsx, src/renderer/src/features/advanced/PowerSaving.tsx, src/renderer/src/features/advanced/ThreadCard.tsx, src/renderer/src/features/advanced/DangerZone.tsx, src/cli/format.ts, docs/ux/pages/advanced-networking.md
- scope: `settings.band_steering.set`, `settings.fast_transition.set`, `settings.mlo.set`, `settings.legacy_mode.set`, `settings.power_saving.set` and its schedule add, update and remove (shared week timeline), `settings.timezone.set`, `settings.simple_setup.set`, `settings.thread.set`, `settings.thread.credentials` (sensitive, Copy dataset), `settings.thread.reset` (destructive), `network.delete` (destructive, type-the-name).
- done when: demo and fake-server tests incl. schedules past midnight, Thread credentials never in logs, audit log or the CLI table without `--reveal`, and `needs_confirm`; `pnpm ui:shot` of power saving schedules, the Thread card and the delete dialog, light and dark; `MANUAL: toggle band steering off and on | ... | the eero app agrees | brief roam for some devices`.

### M5.4 Integrations ☐
- issue: [#141](https://github.com/pkkid/mesh-ui/issues/141)
- after: M5.1
- docs: ux/pages/advanced-networking.md (Integrations), architecture/commands.md (integrations)
- files: src/core/commands/integrations.ts, src/core/commands/integrations.test.ts, src/core/eero/backend/integrations.ts, test/fake-eero/routes/integrations.ts, src/renderer/src/features/advanced/Integrations.tsx
- scope: `integrations.builtin.set`, `integrations.zigbee.discover`, `integrations.ffs.set`, `integrations.amazon.unlink` (destructive). Unavailable integrations stay read-only with the reason.
- done when: demo and fake-server tests incl. unavailable cases and `needs_confirm`; `pnpm ui:shot` of the integrations card with a toast, light and dark; `MANUAL: toggle Frustration-Free Setup off and on | ... | the eero app agrees | none`.

### M5.5 Reservations, port forwards and IPv6 pinholes ☐
- issue: [#142](https://github.com/pkkid/mesh-ui/issues/142)
- after: M5.1
- docs: ux/pages/reservations-ports.md, architecture/commands.md (routing)
- files: src/core/commands/routing.ts, src/core/commands/routing.test.ts, src/core/eero/backend/routing.ts, src/core/eero/map/routing.ts, test/fake-eero/routes/routing.ts, src/renderer/src/features/ports/PortsPage.tsx, src/renderer/src/features/ports/Reservations.tsx, src/renderer/src/features/ports/Forwards.tsx, src/renderer/src/features/ports/Pinholes.tsx, src/renderer/src/features/ports/RuleSheet.tsx, src/renderer/src/features/device/DeviceForwards.tsx, src/renderer/src/features/device/DeviceAddresses.tsx, docs/ux/pages/reservations-ports.md
- scope: `reservation.add`, `.update`, `.remove`; `forward.add`, `.validate`, `.update`, `.remove`; `pinhole.add`, `.remove`. Sheets on Reservations & ports and the device detail shortcuts (reserve this IP, add a forward). Validation in core (pool, overlaps, port ranges).
- done when: demo and fake-server tests incl. overlap and range errors and bridge refusal; `pnpm ui:shot --route '#/settings/ports'` of each sheet and a validation error, light and dark; `MANUAL: add and remove a port forward to a test device | ... | the eero app shows it | none`.

### M5.6 Updates, admins and network transfer ☐
- issue: [#143](https://github.com/pkkid/mesh-ui/issues/143)
- after: M5.1
- docs: ux/pages/updates-admins.md, architecture/commands.md (updates, admins)
- files: src/core/commands/updates.ts, src/core/commands/updates.test.ts, src/core/commands/admins.ts, src/core/commands/admins.test.ts, src/core/eero/backend/updates.ts, src/core/eero/backend/admins.ts, src/core/eero/map/admins.ts, test/fake-eero/routes/updates.ts, test/fake-eero/routes/admins.ts, src/renderer/src/features/updates/UpdatesPage.tsx, src/renderer/src/features/updates/SoftwareCard.tsx, src/renderer/src/features/updates/QuietHours.tsx, src/renderer/src/features/updates/Admins.tsx, src/renderer/src/features/updates/TransferDialog.tsx, docs/ux/pages/updates-admins.md
- scope: `updates.install` (disruptive, progress until eeros return), `updates.hour.set` (with the quiet-hours suggestion), `admin.invite.create`, `admin.invite.cancel`, `admin.nickname.set` (verify the request with a capture first; drop it if unverifiable), `admin.remove` (destructive), `network.transfer` (destructive, type-the-name). Owner and admin views.
- done when: demo and fake-server tests incl. owner-only refusals, invite 403 for admins and `needs_confirm`; `pnpm ui:shot --route '#/settings/updates'` of the install confirm, hour picker, invite sheet and transfer dialog, light and dark; `MANUAL: set the preferred update hour and back | ... | the eero app agrees | none`.

### M5.7 eero ports and remove ☐
- issue: [#144](https://github.com/pkkid/mesh-ui/issues/144)
- after: M5.1
- docs: ux/pages/eero-detail.md (Ethernet ports), architecture/commands.md (eero)
- files: src/core/commands/eero.ts, src/core/commands/eero.test.ts, src/core/eero/backend/eero.ts, src/core/eero/map/eero.ts, test/fake-eero/routes/eeros.ts, src/renderer/src/features/eero/EeroPorts.tsx, src/renderer/src/features/eero/EeroActions.tsx, docs/ux/pages/eero-detail.md
- scope: `eero.port.action` (only actions in the port's `actions[]`, disruptive) and `eero.remove` (destructive, refuses the gateway unless it is the only eero). Carried from M2: a list of attachments per port, the down or disabled `port_status` from the M5.1 capture, firmware history paging past 50 rows. Runs after M5.1, which also edits `test/fake-eero/routes/eeros.ts`.
- done when: demo and fake-server tests incl. refused actions, the gateway rule and `needs_confirm`; several attachments on one port in demo and `--fake`; `pnpm ui:shot` of the port menu and remove dialog, light and dark; `MANUAL: restart PoE on a port with nothing critical | ... | the device power cycles | that port's device drops`.

### M5.8 Troubleshooting tools ☐
- issue: [#145](https://github.com/pkkid/mesh-ui/issues/145)
- after: M5.1
- docs: ux/pages/troubleshooting.md, architecture/commands.md (diagnostics, eero coverage)
- files: src/core/commands/diagnostics.ts, src/core/commands/diagnostics.test.ts, src/core/eero/backend/diagnostics.ts, src/core/eero/map/diagnostics.ts, test/fake-eero/routes/diagnostics.ts, src/core/commands/coverage.ts, src/core/commands/coverage.test.ts, src/core/eero/backend/coverage.ts, src/renderer/src/features/troubleshooting/TroubleshootingPage.tsx, src/renderer/src/features/troubleshooting/Tools.tsx, src/renderer/src/features/troubleshooting/Diagnose.tsx, src/renderer/src/features/troubleshooting/Coverage.tsx, docs/ux/pages/troubleshooting.md
- scope: `diagnostics.run` (symptoms, cloud-side, progress), `eero.placement.test` (`/2.3/`), `coverage.scan` and `coverage.upgrade_report` (`/2.4/`), each moved into `commands/coverage.ts` from the eero area if that keeps `eero.ts` free for M5.7. Troubleshooting: Diagnose by symptom, the Fixes cards, radio channels with `Radio.autoChannel` from the M5.1 capture, coverage scan and upgrade report. Health check's "Run again" stays a read.
- done when: demo and fake-server tests incl. the `/2.3/` and `/2.4/` paths and long-running progress; `pnpm ui:shot --route '#/troubleshooting'` of diagnose, coverage and the upgrade report, light and dark; `MANUAL: run a coverage scan | ... | rooms match the eero app | none`.

### M5.9 Notification settings ☐
- issue: [#146](https://github.com/pkkid/mesh-ui/issues/146)
- after: M5.1
- docs: ux/overview.md (notifications), architecture/commands.md (notifications)
- files: src/core/commands/notifications.ts, src/core/commands/notifications.test.ts, src/core/eero/backend/notifications.ts, test/fake-eero/routes/notifications.ts, src/renderer/src/features/notifications/Bell.tsx, src/renderer/src/features/notifications/NotificationSettings.tsx, src/renderer/src/features/notifications/useDesktopAlerts.ts
- scope: `notifications.settings.set`: eero keys (full merged map, dotted keys as sent, no eero Plus keys) and the desktop choices in `settings.json`; a settings sheet from the bell's gear; desktop alerts follow the choices.
- done when: demo and fake-server tests incl. the merged map and Plus keys never sent; a test shows desktop alerts stop when turned off; `pnpm ui:shot` of the sheet, light and dark; `MANUAL: turn one eero notification off and on | ... | the eero app agrees | none`.

### M5.10 Activity row actions ☐
- issue: [#147](https://github.com/pkkid/mesh-ui/issues/147)
- after: M5.1
- docs: ux/pages/activity.md, architecture/commands.md (activity)
- files: src/core/commands/activity.ts, src/core/commands/activity.test.ts, src/core/eero/backend/events.ts, test/fake-eero/routes/events.ts, src/renderer/src/features/activity/EventStream.tsx, docs/ux/pages/activity.md
- scope: Moved from M4. From the M5.1 capture: if an event type carries a device, eero or profile link, map it and add row actions (Assign profile, Resume, Unblock) through the M4 commands; if none does, match by name only where it is unambiguous, otherwise keep the link to the page and say so in the doc.
- done when: demo and fake-server tests of the link mapping and each action's command; `pnpm ui:shot --route '#/activity'` with a row action and its toast, light and dark; the PR states what the capture found.

### M5.R Review ☐
- issue: [#148](https://github.com/pkkid/mesh-ui/issues/148)
- owner: maintainer
- after: M5.1, M5.2, M5.3, M5.4, M5.5, M5.6, M5.7, M5.8, M5.9, M5.10


## M6: App, account and release

Goal: Mesh UI is installable and updatable on every OS by people other
than the maintainer.
Rough scope: App & account page (account edits, notifications, networks,
CLI and agents panel with the audit log, Application Theme, About, sign out
and delete), CLI install on PATH per OS, signed and notarized macOS builds,
release workflow and draft releases, auto-update and beta channel, Linux
AppImage, deb and rpm, Windows installer (unsigned for now), first public
release.
Carried from M1: "Try demo mode" switches a running app to demo; "delete
my account" (`account.delete`); move to the async safeStorage API (the sync
call is deprecated in Electron 45); an `author` with email in package.json
for deb and rpm; prove `pnpm dist:dir` and `pnpm ui:shot` on macOS and
Windows; add the `pnpm test:ui` script or drop it from testing.md.
Carried from M3: the packaged Linux launcher strips `DISPLAY` and
`WAYLAND_DISPLAY` for `--cli`, like the dev launcher (#115); the
`dist:smoke` window step fails with no display (set `MESH_UI_HEADLESS`);
sidebar and sign-in avatars use an inline `hue("orange")` (from M1.7), move
it to `chartColors.ts` or make avatars neutral.
Carried from M4: the speed test one-at-a-time lock is per process, so the
app and a CLI in another process can each start one (share it, or accept
eero's own refusal, #162); the CLI and agents panel reads the audit log
(`audit.jsonl`, live CLI and MCP only, #149).
