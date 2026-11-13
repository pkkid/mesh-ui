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

## Overview

| Milestone | Goal | Status |
|---|---|---|
| M1 | Sign in (or use demo or the fake server) and see the Overview and Devices pages, from the app, the CLI and MCP | ready ([milestone](https://github.com/pkkid/mesh-ui/milestone/1)) |
| M2 | See the network and its devices: Internet, eeros, eero detail, device detail, command palette | later |
| M3 | See people and settings: Profiles, Activity, Guest, Wi-Fi, Troubleshooting health, offline alerts | later |
| M4 | Everyday control: pause, rename, block, profiles and schedules, guest and Wi-Fi, restarts | later |
| M5 | Advanced settings: networking, reservations and ports, updates and admins, troubleshooting tools | later |
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

### M1.1 Core contracts and test tooling ☐
- issue: [#1](https://github.com/pkkid/mesh-ui/issues/1)
- after: (none)
- docs: architecture/overview.md, architecture/commands.md, architecture/engine.md, architecture/backends.md, architecture/data-model.md, testing.md
- files: src/core/model.ts, src/core/backend.ts, src/core/registry.ts, src/core/engine.ts, src/core/errors.ts, src/core/spec.ts, src/core/poll.ts, src/core/format.ts, src/core/commands/index.ts, src/core/demo/index.ts, src/core/eero/backend/index.ts, src/cli/index.ts, test/setup.ts, test/fake-eero/routes/index.ts, vitest.config.ts, package.json, tsconfig.json
- scope: The contracts every other story builds on. `model.ts` with every type in data-model.md (whole model, so later stories never edit it for M1 types). `backend.ts`: the `Backend` interface split into per-area sub-interfaces (auth, account, network, internet, eero, device, profile, usage, events) with method signatures for every M1 command. `spec.ts` (CommandSpec with id, label, description, icon, params zod schema, effect, sensitive, poll, run), `registry.ts` (register, list, JSON Schema via zod-to-json-schema), `engine.ts` (`execute` with lookup, validation, confirm enforcement, error mapping, never throws), `errors.ts` (codes from AGENTS.md). `poll.ts` and `format.ts` with the M1 intervals and formatters (Mbps, GB, %, relative time). Empty registration index files for commands, demo areas, eero backend areas and fake-server routes, plus a `src/cli/index.ts` stub exporting `runCli(argv)`. Vitest config, `test/setup.ts` with the fetch guard that throws on `api-user.e2ro.com`, and scripts `test`, `test:watch`, `check` in package.json.
- done when: `pnpm check` passes; engine tests cover unknown_command, bad_params, needs_confirm (disruptive and destructive), success, and a thrown backend error mapped to eero_error; a test proves the fetch guard blocks eero.

### M1.2 eero HTTP client and fake eero server ☐
- issue: [#2](https://github.com/pkkid/mesh-ui/issues/2)
- after: M1.1
- docs: architecture/eero-client.md, testing.md (Fake eero server), eero-api/endpoints.md
- files: src/core/eero/client.ts, src/core/eero/urls.ts, src/core/eero/ratelimit.ts, src/core/eero/raw.ts, src/core/eero/client.test.ts, test/fake-eero/server.ts, test/fake-eero/state.ts, test/fake-eero/scenarios.ts, test/fake-eero/routes/auth.ts
- scope: The only eero HTTP client and the stateful fake server it is tested against. Client: base URL, headers (cookie, User-Agent), body encodings, `/2.2` vs `/2.3`, origin check (fake origin only by injection), no redirects, 30 s timeout, `error.session.refresh` refresh with single flight and one replay, `Set-Cookie` rotation, 80 req/min budget with 4 in flight and serialised writes, 429 and `Retry-After` for queries only, error mapping. `raw.ts` holds the raw response types used by mapping and the fake server. Fake server: random port, per-test state (one account, two networks), request log, scenario switches, auth routes (login, verify, resend, refresh, logout) accepting any email and code `123456`.
- done when: every scenario in testing.md's fake-server table that concerns the client has a passing test using fake timers; request and error logs never contain the token; the suite for this story runs in under 5 seconds.

### M1.3 Demo backend and fixtures ☐
- issue: [#3](https://github.com/pkkid/mesh-ui/issues/3)
- after: M1.1
- docs: architecture/backends.md (demo), testing.md (Fixtures)
- files: src/core/demo/backend.ts, src/core/demo/fixtures.ts, src/core/demo/scenario.ts, src/core/demo/backend.test.ts
- scope: The in-memory demo backend implementing every M1 read in `Backend` from one fixture set matching the mockups (Maple Street and Lake Cabin, Alex, Jamie, Mia, Leo, four eeros, about 38 devices, usage series, speed tests, events). Includes the states pages must handle (offline eero, weak link, paused and scheduled profiles, blocked device, update available, bridge mode network, admin role, missing capability). `scenario.ts` holds switchable states for tests (`demo.scenario.set` is registered in M1.9).
- done when: fixtures are typed against `model.ts`; tests check each read returns consistent data (counts in summaries match the lists); no real names, MACs or IPs.

### M1.4 Electron host: keychain, IPC and preload ☐
- issue: [#4](https://github.com/pkkid/mesh-ui/issues/4)
- after: M1.1
- docs: architecture/security.md, architecture/ui.md (bridge), platform/cross-platform.md
- files: src/main/index.ts, src/main/secret-store.ts, src/main/secret-store.test.ts, src/main/ipc.ts, src/main/paths.ts, src/main/session.ts, src/main/eero.ts, src/main/demo.ts, src/preload/index.ts, src/shared/types.ts, src/renderer/src/global.d.ts
- scope: Rebuild the host on the engine. `SecretStore` over `safeStorage` (keychain only, never plaintext, atomic 0600 writes, v1/v2 session file handling) replacing `session.ts`. One IPC channel for `execute`, plus `commands` and host events (`session.changed`, `network.selected`). Preload exposes `window.mesh.execute/commands/on`. Backend selection: live, `MESH_UI_DEMO=1` demo, and dev-only fake origin injection for `pnpm dev:fake` (start the fake server from `test/fake-eero` in dev only). Config paths per OS. Keep the window lockdown. `--cli` argv hands off to `runCli` from `src/cli/index.ts` with no window. Delete the prototype `eero.ts` and `demo.ts` once nothing imports them.
- done when: host tests cover keychain, basic_text and unavailable backends, plaintext and undecryptable files, and sign-out deleting the file; the token never crosses IPC (test the bridge payloads); `pnpm dev:demo` opens the window.

### M1.5 CLI surface ☐
- issue: [#5](https://github.com/pkkid/mesh-ui/issues/5)
- after: M1.1
- docs: architecture/cli.md, platform/cross-platform.md (CLI launcher)
- files: src/cli/index.ts, src/cli/args.ts, src/cli/run.ts, src/cli/format.ts, src/cli/script.ts, test/cli/cli.test.ts, scripts/mesh-ui-dev.mjs
- scope: `mesh-ui commands`, `run <id> --params '{...}' | @file | stdin`, `run script.jsonl` (stop on failure, `--keep-going`, per-line confirm, global `--confirm` refused for scripts), `status`, `login`, `logout`, `help`, `--version`; `--demo` and dev-only `--fake`; JSON and table output, `--quiet`, `--no-color`, `--reveal` for sensitive results; exit codes from cli.md. A dev launcher script runs the CLI through the local Electron binary headless.
- done when: CLI tests spawn the built CLI with `--demo` and a temp user data dir and cover each format, exit code and script rule; `mesh-ui --demo run app.info` works on the maintainer's machine.

### M1.6 MCP surface ☐
- issue: [#6](https://github.com/pkkid/mesh-ui/issues/6)
- after: M1.1
- docs: architecture/mcp.md
- files: src/cli/mcp.ts, test/mcp/mcp.test.ts
- scope: `mesh-ui mcp` over stdio with `@modelcontextprotocol/sdk`: one tool per registry command (name from id, input schema from params, `confirm` added for disruptive and destructive), annotations from effect, `--read-only`, `--allow <glob>`, `--network`; auth login commands and `app.cli.install` not exposed. Registers itself in `src/cli/index.ts` (one-line edit).
- done when: in-process tests list tools, check names, schemas and annotations, call a query and a needs_confirm command with and without `confirm`, and `--read-only` hides writes.

### M1.7 App shell, themes and UI primitives ☐
- issue: [#7](https://github.com/pkkid/mesh-ui/issues/7)
- after: M1.1
- docs: ux/overview.md, design/design-system.md, architecture/ui.md
- files: src/renderer/src/App.tsx, src/renderer/src/app/router.tsx, src/renderer/src/app/routes.ts, src/renderer/src/app/useCommand.ts, src/renderer/src/features/shell/Sidebar.tsx, src/renderer/src/features/shell/TopBar.tsx, src/renderer/src/features/shell/NetworkSwitcher.tsx, src/renderer/src/features/shell/ComingSoon.tsx, src/renderer/src/lib/themePalettes.ts, src/renderer/src/lib/themes.ts, src/renderer/src/lib/chartColors.ts, src/renderer/src/index.css, src/renderer/src/components/ui/card.tsx, src/renderer/src/components/ui/status.tsx, src/renderer/src/components/ui/segmented.tsx, src/renderer/src/components/ui/hero.tsx, src/renderer/src/components/ui/confirm.tsx, src/renderer/src/features/devices/DevicesView.tsx, src/renderer/src/features/settings/SettingsView.tsx
- scope: The window everyone builds in. Routes for every page (unbuilt ones render `ComingSoon`), sidebar with all nav items and counts, topbar with title, subtitle slot and actions slot, network switcher, the seven themes (Classic, Rose, Grove, Ocean, Ember, Iris, Gruvbox Hard; Gruvbox Hard default) with light, dark and system, chart series colours per theme, and primitives: card, status dot plus label, segmented toggle, page header (hero), inline confirm. `useCommand` hook wrapping `window.mesh.execute` with loading, error and polling from `poll.ts`. Retire the prototype Devices and Settings views (their pages come in M1.15 and M6). Works against a stub `window.mesh` until M1.4 lands.
- done when: every route renders without console errors; themes switch live and persist; primitives match the mockups; a renderer test or screenshot covers light and dark.

### M1.8 Chart kit ☐
- issue: [#8](https://github.com/pkkid/mesh-ui/issues/8)
- after: M1.1
- docs: AGENTS.md (Charts), design/design-system.md (charts)
- files: src/renderer/src/components/charts/AreaChart.tsx, src/renderer/src/components/charts/BarChart.tsx, src/renderer/src/components/charts/Sparkline.tsx, src/renderer/src/components/charts/ShareBar.tsx, src/renderer/src/components/charts/Donut.tsx, src/renderer/src/components/charts/Gauge.tsx, src/renderer/src/components/charts/Heatmap.tsx, src/renderer/src/components/charts/Tooltip.tsx, src/renderer/src/components/charts/scale.ts, src/renderer/src/components/charts/curve.ts, src/renderer/src/components/charts/charts.test.ts
- scope: Hand-written SVG charts per the AGENTS.md rules: monotone cubic curves, line plus 12% area, nice ticks, y gutter, start/middle/end x labels, hover line and glass tooltip, shared scale, loading fade and empty sentence, `role="img"` with aria labels, no load animations. Colours come from `chartColors.ts` props, not inline.
- done when: unit tests cover nice ticks and that curves never overshoot data or go below zero; a demo gallery route (dev only) shows every chart in light and dark.

### M1.9 Auth, account and app commands, and sign-in ☐
- issue: [#9](https://github.com/pkkid/mesh-ui/issues/9)
- after: M1.2, M1.3, M1.4, M1.7
- docs: ux/sign-in.md, architecture/commands.md (auth, account, app), architecture/security.md
- files: src/core/commands/auth.ts, src/core/commands/account.ts, src/core/commands/app.ts, src/core/commands/demo.ts, src/core/commands/auth.test.ts, src/core/commands/account.test.ts, src/core/commands/app.test.ts, src/core/eero/backend/auth.ts, src/core/eero/backend/account.ts, test/fake-eero/routes/account.ts, src/renderer/src/features/sign-in/SignInView.tsx, src/renderer/src/features/sign-in/CodeStep.tsx, src/renderer/src/features/sign-in/ChooseNetwork.tsx
- scope: `auth.status`, `auth.login.start`, `auth.login.verify`, `auth.login.resend`, `auth.logout`, `account.get`, `app.info`, and `demo.scenario.set` (demo only), with eero backend implementations and fake routes. Sign-in UI from mockup 18: email or phone, code entry with wrong-code and resend, choose network, first-run loading, signed-out and expired-session states.
- done when: command tests on demo and client tests on the fake server pass; sign-in works end to end in `pnpm dev:fake`; `MANUAL: Sign in to the real account | pnpm dev, sign in with your eero email and code | Overview shows your network | none`.

### M1.10 Network and internet read commands ☐
- issue: [#10](https://github.com/pkkid/mesh-ui/issues/10)
- after: M1.2, M1.3
- docs: architecture/commands.md (network, internet), ux/pages/overview.md
- files: src/core/commands/network.ts, src/core/commands/internet.ts, src/core/commands/network.test.ts, src/core/commands/internet.test.ts, src/core/eero/backend/network.ts, src/core/eero/backend/internet.ts, src/core/eero/map/network.ts, test/fake-eero/routes/network.ts
- scope: `network.list`, `network.select`, `network.get`, `network.health`, `network.permissions`, `internet.get`, `speedtest.history`, with mapping from raw eero shapes, capability and permission gating fields, and fake routes for `account`, `{net}`, `{net}/speedtest`, `{net}/permissions`.
- done when: each command has demo tests (including bad_params) and fake-server tests for mapping; switching networks emits `network.selected`.

### M1.11 eero, device and profile read commands ☐
- issue: [#11](https://github.com/pkkid/mesh-ui/issues/11)
- after: M1.2, M1.3
- docs: architecture/commands.md (eero, device, profile), ux/pages/devices.md
- files: src/core/commands/eero.ts, src/core/commands/device.ts, src/core/commands/profile.ts, src/core/commands/eero.test.ts, src/core/commands/device.test.ts, src/core/commands/profile.test.ts, src/core/eero/backend/eero.ts, src/core/eero/backend/device.ts, src/core/eero/backend/profile.ts, src/core/eero/map/eero.ts, src/core/eero/map/device.ts, src/core/eero/map/profile.ts, test/fake-eero/routes/eeros.ts, test/fake-eero/routes/devices.ts, test/fake-eero/routes/profiles.ts
- scope: `eero.list`, `eero.get`, `device.list` (with the filter, search, sort and summary params from commands.md, applied in core), `device.get`, `device.rates.refresh` (burst reporter, once a minute), `profile.list`, `profile.get`, with mapping, name fallbacks, and fake routes.
- done when: demo and fake-server tests pass, including the burst reporter rate limit and device name fallback chain; `mesh-ui --demo run device.list --params '{"status":"online"}'` prints a table.

### M1.12 Usage and events read commands ☐
- issue: [#12](https://github.com/pkkid/mesh-ui/issues/12)
- after: M1.2, M1.3
- docs: architecture/commands.md (internet usage, activity), ux/pages/overview.md
- files: src/core/commands/usage.ts, src/core/commands/activity.ts, src/core/commands/usage.test.ts, src/core/commands/activity.test.ts, src/core/eero/backend/usage.ts, src/core/eero/backend/events.ts, src/core/eero/map/usage.ts, test/fake-eero/routes/usage.ts, test/fake-eero/routes/events.ts
- scope: `usage.get` (scope network, eero, device, profile; Day and Week; hourly and daily cadence for the heatmap), `usage.breakdown` (by device, profile, eero), `events.list` (paging, type filter, `format: csv`), with mapping of `{series, values}` and `app_events`, and the 7-day limit enforced in core.
- done when: demo and fake-server tests pass, including the 7-day clamp and CSV output.

### M1.13 Package build and CI smoke ☐
- issue: [#13](https://github.com/pkkid/mesh-ui/issues/13)
- after: M1.4, M1.5
- docs: platform/build-and-release.md, testing.md (CI)
- files: electron-builder.yml, .github/workflows/ci.yml, scripts/dist-smoke.mjs, package.json
- scope: electron-builder config with app id `io.github.pkkid.meshui`, `pnpm dist:dir` for the current OS (unsigned), a local `pnpm test:keychainless` (Linux), and `ci.yml`: one smoke job per OS on pull requests to main and manual runs (install, typecheck, test, build), with concurrency cancelling. No other CI jobs.
- done when: `pnpm dist:dir` builds and launches with `--demo` locally; the smoke workflow is green on all three OS on the story's PR.

### M1.14 Overview page ☐
- issue: [#14](https://github.com/pkkid/mesh-ui/issues/14)
- after: M1.7, M1.8, M1.10, M1.11, M1.12
- docs: ux/pages/overview.md
- files: src/renderer/src/features/overview/OverviewView.tsx, src/renderer/src/features/overview/NetworkHero.tsx, src/renderer/src/features/overview/DataUsage.tsx, src/renderer/src/features/overview/EerosList.tsx, src/renderer/src/features/overview/TopDevices.tsx, src/renderer/src/features/overview/ProfilesList.tsx, src/renderer/src/features/overview/BusyHeatmap.tsx, src/renderer/src/features/overview/RecentActivity.tsx, src/renderer/src/app/routes.ts
- scope: The Overview from mockup 01 and its page doc: header with network name, status, ISP, public IP, last speed test and gauges; data usage chart with Day and Week, By eero share bar; eeros list; top devices; profiles; busy-hours heatmap; recent activity. Buttons that need later write commands (Run speed test, Share Wi-Fi, Pause a profile, Restart network) are shown disabled with "Coming soon" tooltips. All states from the page doc.
- done when: matches the mockup in `pnpm dev:demo` and `pnpm dev:fake` in light and dark (screenshots in the PR); loading, empty and error states shown via `demo.scenario.set`.

### M1.15 Devices page ☐
- issue: [#15](https://github.com/pkkid/mesh-ui/issues/15)
- after: M1.7, M1.8, M1.11
- docs: ux/pages/devices.md
- files: src/renderer/src/features/devices/DevicesPage.tsx, src/renderer/src/features/devices/DeviceSummary.tsx, src/renderer/src/features/devices/DeviceFilters.tsx, src/renderer/src/features/devices/DeviceTable.tsx, src/renderer/src/app/routes.ts
- scope: The Devices page from mockup 05, read-only: summary strip, search, network and status filters, group by and sort, grouped table with current rates (via `device.rates.refresh` polling), offline and blocked groups. Selection and bulk actions are shown but disabled until M4. Row click goes to a `ComingSoon` device detail until M2.
- done when: matches the mockup in demo and fake modes in light and dark (screenshots in the PR); filters and sort run through `device.list` params, not renderer logic.

### M1.R Review ☐
- issue: [#16](https://github.com/pkkid/mesh-ui/issues/16)
- owner: maintainer
- after: M1.1, M1.2, M1.3, M1.4, M1.5, M1.6, M1.7, M1.8, M1.9, M1.10, M1.11, M1.12, M1.13, M1.14, M1.15

## M2: See the network and its devices

Goal: the network side of the app is complete read-only: how the internet
connection is doing, how the mesh is built, and everything about each eero
and each device. Safe to point at a real network.
Rough scope: Internet (connection details, speed test history and CSV,
usage by device and profile), eeros (topology map and tree, eero cards with
bands and channels, data usage by eero, clients by band), eero detail
(radios, ports and attached devices, firmware history, uplink), device
detail (signal, rates, usage, IP addresses, reservation and forwards shown),
and the command palette for navigation and running query commands.

## M3: See people and settings

Goal: the rest of the app is complete read-only, so Mesh UI is a full
monitor of the network.
Rough scope: Profiles and Profile detail (schedules timeline, devices,
usage), Activity (event stream, filters, unread, CSV), Guest (status, usage,
isolation, guest devices, QR via `guest.share`), Wi-Fi (name, encryption,
bands, QR via `wifi.share`), Advanced networking and Reservations & ports
as read views, Troubleshooting health check, desktop notifications for
offline alerts.

## M4: Everyday control

Goal: do the common jobs from the eero app in Mesh UI: pause and resume,
rename, block, manage profiles and schedules, guest and Wi-Fi changes,
restarts, speed tests, with confirms on every disruptive action.
Rough scope: device writes, profile CRUD and schedules, guest enable,
disable, rename and password, Wi-Fi name, password, security and only-2.4
GHz, eero rename, find, LED and nightlight, eero and network restart, speed
test run, undo toasts for reversible writes, the palette running commands.

## M5: Advanced settings

Goal: the settings power users need, with clear restart warnings.
Rough scope: Advanced networking (DNS, DHCP, IPv6, WAN, bridge mode, UPnP,
SQM, band steering, Thread, power saving, integrations), reservations, port
forwards and IPv6 pinholes, updates (install, preferred hour, notes), admins
and invites, network transfer and delete, eero ports and remove,
diagnostics, coverage scan and upgrade report, notification settings.

## M6: App, account and release

Goal: Mesh UI is installable and updatable on every OS by people other
than the maintainer.
Rough scope: App & account page (account edits, notifications, networks,
CLI and agents panel with the audit log, Application Theme, About, sign out
and delete), CLI install on PATH per OS, signed and notarized macOS builds,
release workflow and draft releases, auto-update and beta channel, Linux
AppImage, deb and rpm, Windows installer (unsigned for now), first public
release.
