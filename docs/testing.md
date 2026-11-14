# Testing

Mesh UI is tested in a sandbox. The maintainer's eero network is real and
in use, so **agents may read it but never change it**: gentle `query`
commands against the real session are allowed (to check a response shape,
say), and no `write`, `disruptive` or `destructive` command ever runs on it.
Tests, screenshots and every window an agent starts use demo or fake data
and a throwaway user data dir. The full rule, including how a CLI reaches
the real session and what may be printed, is in `AGENTS.md` (Testing).

## Local first

Almost all testing runs on the developer's machine, and it has to be fast.
GitHub Actions only does light cross-platform checks and release builds
(see [CI](#ci)).

- `pnpm test` runs every layer except UI in one Vitest run. Target: under
  30 seconds on a laptop. Tests share nothing, need no network beyond
  `127.0.0.1`, and start the fake eero server in-process.
- `pnpm test:watch` reruns affected tests on save; use it while building.
- `pnpm test:ui` runs the Playwright Electron checks locally (a few minutes).
  Run it before opening a PR that changes the UI, and attach its screenshots.
- `pnpm check` is the pre-PR gate: `typecheck`, `test`, `build`. Every PR is
  expected to pass it locally first; CI is a backstop, not the main signal.
- Slow tests are a bug. A test that needs real waiting (rate limits,
  `Retry-After`, burst cooldowns) uses fake timers, never `sleep`.

## The sandbox

Two layers stand in for eero:

1. **Demo backend** (`src/core/backends/demo/`). In-memory fixtures behind the
   same `Backend` interface as the live backend. Writes apply to the fixtures,
   so pausing or renaming visibly works. Used for command tests, CLI and MCP
   tests, UI work and screenshots. Enabled with `--demo` or `MESH_UI_DEMO=1`.
2. **Fake eero server** (`test/fake-eero/`). A local stand-in for eero's
   cloud API: an HTTP server that answers like `api-user.e2ro.com`, built
   from the shapes in [eero-api/endpoints.md](eero-api/endpoints.md) and
   [eero-api/data-model.md](eero-api/data-model.md). It keeps state (writes
   stick), so it behaves like a small real network. The real `eero` client
   and `EeroBackend` run against it, so auth, refresh, rotation, rate limits,
   `/2.3/` writes and error mapping are covered without touching eero. This
   is where most testing of the live code path happens.

The demo backend is for speed and screenshots; the fake server is for
proving the code that will talk to the real eero.

### Running the app against the fake server

`pnpm dev:fake` starts the fake eero server on a local port and the app in
dev mode pointed at it, with a temp user data dir. Sign-in, every page and
every action then run through the **real** eero client and backend, exactly
as they would against eero, so flows can be tried by hand in the real UI
without touching a real network. The CLI has the same: `mesh-ui --fake run
...` in dev builds. The fake sign-in accepts any email and the code `123456`.

The redirect exists only in dev builds: the fake origin is injected by the
dev entry point, and release builds contain no code path that points the
client anywhere but `api-user.e2ro.com`.

Plus two guards:

- **No real eero.** The test setup replaces global `fetch` with a wrapper that
  throws on any request to `api-user.e2ro.com`, and the client's origin check
  only accepts the fake server's origin when a test or the dev entry point
  injects it (release builds have no way to redirect the client).
- **No real user data in tests.** Every test, screenshot or window that
  starts Electron passes a throwaway `--user-data-dir` in a temp or scratch
  folder. Only a one-off read-only CLI check (see `AGENTS.md`) points at
  `~/.config/mesh-ui/`, `~/Library/Application Support/mesh-ui/` or
  `%APPDATA%\mesh-ui\`, and nothing copies or decrypts files there.

The test setup (`test/setup.ts`) also warms ICU (a collator, a time-zone date
format and a number format) before any test runs. The first use in a process
loads ICU data, which has taken 1 to 9s on CI runners and timed out whichever
test happened to sort by name or do local-time math first. Do not raise test
timeouts for a slow first test; check whether it is the first use of something
process-wide like this.

## Fixtures

- Invented data only, in `src/core/demo/fixtures.ts`: three networks for
  account "Alex Kim". "Maple Street" (owner, the main one) has family
  profiles Alex, Jamie, Mia and Leo, eeros Living Room (gateway), Office,
  Upstairs Hall and Garage, and devices on `192.168.4.x`. "Lake Cabin"
  (owner) is offline with 1 eero. "Mom's House" (admin role) is in bridge
  mode with 2 eeros and no Thread or nightlight. MACs use a locally
  administered prefix; serials and ids are made up.
- Fixtures cover the states pages must handle: an offline eero, a weak
  wireless link, a paused profile, a scheduled profile, a blocked device, an
  update available, a network in bridge mode, a non-owner admin role, and a
  capability missing (no nightlight, no Thread). From M3 also: a guest
  network on (Maple Street), open (Lake Cabin) and off (Mom's House, bridge
  mode), WPA2-only devices, a power saving schedule, IPv6 pinholes on
  reserved devices, unread notifications, a diagnostics warning, support
  contacts, two admins and a pending invite, and integrations on and
  unavailable. `src/core/demo/backend.test.ts` checks they agree with each
  other (guests are on the guest network, pinholes and forwards point at
  reserved devices, the unread flag matches the unread rows).
- Demo scenarios (`demo.scenario.set`, `src/core/demo/scenario.ts`):
  `default`, `signed_out`, `no_networks`, `network_offline`, `eero_offline`,
  `empty_network`, plus `slow` (every read waits about 1.5 s) and `errors`
  (every read fails with `eero_error`) for loading and error states. Sign-in
  and switching scenarios keep working in both. A CLI run is one process,
  so set the scenario and read in one script:
  `mesh-ui --demo run steps.jsonl` with a `demo.scenario.set` line first.
- Fixtures live in one place and are typed against `src/core/model.ts` (demo)
  or `src/core/eero/raw.ts` (fake server), so model changes break them at
  compile time.
- If a real response shape is needed, ask the maintainer to capture it with a
  read-only command and redact it. Never copy real names, MACs, IPs or
  serials.

## Test layers

| Layer | What | Runs against | Where |
| --- | --- | --- | --- |
| Unit | Formatters, nice ticks, monotone curve maths, mapping raw to model, zod schemas | Pure functions | `src/**/*.test.ts` |
| Command | Every command through `engine.execute` | Demo backend | `src/core/commands/*.test.ts` |
| Client | `EeroClient` and `EeroBackend` | Fake eero server | `src/core/eero/*.test.ts` |
| Host | `SecretStore` rules, session file handling | Fake `safeStorage` | `src/main/*.test.ts` |
| CLI | Argument parsing, formats, exit codes, scripts | Built CLI, `--demo` | `test/cli/*.test.ts` |
| MCP | Tool listing, schemas, annotations, calls | In-process server, demo | `test/mcp/*.test.ts` |
| UI | Pages render, confirm flows, screenshots | Electron + Playwright, demo | `test/ui/*.spec.ts` |

Runner: Vitest for everything but UI; Playwright's Electron support
(`_electron.launch`) for UI. All of it runs locally; see [Local first](#local-first).

### Command tests

**Every command has a test.** At minimum:

- the happy path, checking the returned model data and, for writes, that the
  fixture changed (`device.pause` then `device.get` shows `paused: true`);
- `bad_params` for a missing or malformed param;
- `needs_confirm` for every `disruptive` and `destructive` command called
  without `confirm`, and success with `confirm: true`;
- `not_signed_in` when the demo session is signed out, for commands that need
  a session.

A registry test checks that every command has an id matching
`area.verb` / `area.object.verb`, a label, an effect, a params schema that
converts to JSON Schema, and a test file that mentions its id.

### Fake eero server

A small Node `http` server started per test file on a random port. It holds
state (one account, two networks) and records every request. Scenarios are
switched per test:

| Scenario | Proves |
| --- | --- |
| Login, verify, resend | Two-step auth, pending token kept on a wrong code |
| `401 error.session.refresh` once | Refresh is called, the request is replayed once, the new token is saved |
| Refresh fails | Session cleared, `not_signed_in` |
| Concurrent 401s | Only one refresh call (single-flight) |
| `Set-Cookie: s=new` on a normal response | Rotated token adopted and saved |
| 429 with `Retry-After: 2` on a GET | Query retried after the wait |
| 429 on a write | Not retried; `rate_limited` returned |
| 120 queued requests | No more than the budget per minute reach the server |
| Device write on `/2.2/` | Server returns 200 and ignores it (like eero); the test asserts the client used `/2.3/` |
| LED JSON vs form | Only a form PUT to `led_action` changes state |
| Two burst reporters inside a minute | Second one does not reach the server |
| A `url` pointing at another host | Request refused before sending |
| Bare array vs `{data: [...]}` lists | Lenient parsing |
| 403, 404, `error.eero.offline`, timeout, connection refused | Error codes map as in [eero-client.md](architecture/eero-client.md#errors) |
| Request and error logs | Never contain the token or a password |

### Host tests

`safeStorage` is replaced by a fake with switchable backend
(`keychain`, `gnome_libsecret`, `basic_text`, unavailable):

- keychain: token saved encrypted, file mode `0600`, atomic write;
- `basic_text` or unavailable: nothing written, existing file deleted,
  `auth.status` reports `memory`;
- plaintext or undecryptable file: deleted on load;
- sign-out deletes the file even when the eero logout call fails.

A local script (`pnpm test:keychainless`, Linux) also runs the app and CLI
against real Electron with `--password-store=basic` to prove the session
stays in memory.

### CLI and MCP tests

- CLI: spawn the built CLI with `--demo` and a temp user data dir. Check
  `commands` JSON against the registry, table and JSON output, every exit
  code, `--params @file` and stdin, scripts (stop on failure, `--keep-going`,
  per-line confirm, global `--confirm` refused).
- MCP: start the server in-process over a paired transport, list tools,
  check names (`device_pause`), input schemas (including `confirm` on
  disruptive tools) and annotations, and call tools with and without
  `confirm`. `--read-only` lists only query tools.

### UI checks

Behaviour is checked headless first (`mesh-ui --demo run ...`); the window is
for looks.

- Launch Electron with `MESH_UI_DEMO=1` and a temp `--user-data-dir`.
- Each page loads without console errors, shows its main sections, and
  handles its empty and error states (fixtures switched with
  `demo.scenario.set`, a command registered only by the demo backend).
- Confirm flows: a disruptive action shows its inline confirm or dialog and
  does not call `execute` with `confirm: true` until confirmed.
- Screenshots of every page in the default theme, light and dark, saved for
  the milestone review. Compare against the mockups by eye; no pixel diffing.
- Agents look at the UI only with `pnpm ui:shot` (below), never with a
  visible window: the maintainer is working on the same desktop. A person
  looking at a change by hand runs `pnpm dev:demo`, never a real sign-in.

### Screenshots with ui-shot

`pnpm ui:shot` (`scripts/ui-shot.mjs`) builds `out/` when `src/` is newer
(or reuses it), launches the app with no visible window, drives it over the
DevTools protocol and saves PNGs with `Page.captureScreenshot`.

```sh
pnpm ui:shot --route '#/devices' --theme dark --out devices-dark.png
pnpm ui:shot --before "document.querySelector('[aria-label=\"Switch network\"]').click()" --out switcher.png
pnpm ui:shot --shots shots.json --out-dir shots/
pnpm ui:shot --fake --route '#/overview' --out overview-fake.png
pnpm ui:shot --help
```

Per shot: `--route` (default `#/overview`), `--theme light|dark`,
`--theme-id <id>`, `--size 1200x780`, `--scale 1`, `--scenario <name>` (demo
only, default `default`), `--before <js>` (awaited in the page before the
shot: click, open a popover), `--wait <ms>` (settle time, default 600) and
`--out <file.png>`. `--shots` takes a JSON array of objects with the same
fields (`out`, `route`, `theme`, `themeId`, `size`, `scale`, `scenario`,
`before`, `wait`), all taken in one app launch:

```json
[
  { "out": "overview-dark.png", "route": "#/overview", "theme": "dark" },
  { "out": "garage-offline.png", "route": "#/overview", "scenario": "eero_offline" }
]
```

- **Demo by default.** Each shot starts from its scenario (`default` unless
  given), so writes from an earlier shot or `--before` do not leak.
- **`--fake`** uses a dev build in `node_modules/.cache/mesh-ui-shot` (the fake
  redirect exists only in dev builds, and this one can never be packaged),
  lets the app start the fake eero server, and signs in with the fake code
  unless `--signed-out`.
- **Isolated.** Every run uses a temp user data dir and `XDG_CONFIG_HOME`,
  deleted afterwards (`--keep` keeps them), and a random DevTools port.
- **Fails loudly.** It exits non-zero and prints the errors when the renderer
  throws or logs an error, `--before` throws, or a route is not a page (the
  router would otherwise quietly show the last route).

How it stays invisible: the app runs with `MESH_UI_HEADLESS=1`, which
`src/main/index.ts` reads to render the window offscreen (`offscreen: true`),
never show it, and hide the macOS dock icon. On Linux the app also gets no
`DISPLAY` or `WAYLAND_DISPLAY` and runs with `--ozone-platform=headless`
(with `--ozone-override-screen-size`, since the headless screen is 1x1
otherwise, and `--disable-gpu`), so it cannot reach the display server at
all. Headless ozone segfaults when a window has a native `titleBarOverlay`,
so the flag also drops the overlay. No Xvfb is needed.

What headless cannot show: the native window controls (the Linux and
Windows overlay, the macOS traffic lights) and native popups such as an open
`<select>` list. Capture the in-page equivalent, or add a `MANUAL:` line.

## CI

Kept deliberately light. GitHub Actions is used for two things only:

1. **Cross-platform smoke** on pull requests to `main` and `milestone/**`,
   and on demand (`workflow_dispatch`): one job per OS (macOS, Windows,
   Linux) that installs, runs `pnpm typecheck` and `pnpm test`, and builds. Its job is catching OS-specific breakage
   (paths, keychains, line endings), not being the main test signal.
2. **Release builds** when a version tag is pushed, because signed macOS and
   Windows artifacts need those runners.

UI tests, screenshots, the keychain-less run (`pnpm test:keychainless`) and
packaging smoke tests (`pnpm dist:dir`, then `pnpm dist:smoke`) run locally. CI has no eero credentials and needs none. Details in
[build-and-release.md](platform/build-and-release.md#ci).

## Manual checks on the real network

Once a milestone looks complete in demo mode and against the fake server,
the maintainer runs a short hands-on pass in the real UI against their real
network. That pass is driven by the checklist below. Agents may tick the
items a read-only CLI check proves (see `AGENTS.md`); visual comparisons
with the eero app stay with the maintainer.

Some things only a real network can prove: a write that must really stick,
the timing of a reboot. Agents do not try them. Instead the task adds a line
to its PR body:

```text
MANUAL: <what to check> | <steps> | <expected result> | <risk: none, brief outage, ...>
```

Example:

```text
MANUAL: Device pause persists | Pause "Leo's Switch" in Devices, reopen the app | Still paused, and paused in the eero app | none (reversible, one device)
```

- Keep them light: read-only views, or reversible writes on one device.
  Anything `disruptive` or `destructive` says so in its risk field.
- The milestone review collects every `MANUAL:` line into a **Manual checks**
  checklist in `docs/reviews/M<n>.md`. The maintainer runs them before merging
  the review; failures become fix tasks.

## Done means

- `pnpm check` (typecheck, test, build) passes locally.
- New commands have tests, including `bad_params` and `needs_confirm`.
- New client behaviour has a fake-server test.
- UI changes ran `pnpm test:ui` locally and have demo-mode screenshots in the PR.
- Anything that needs the real network is a `MANUAL:` line, not a done-when.
