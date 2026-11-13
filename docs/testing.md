# Testing

Mesh UI is tested entirely in a sandbox. The maintainer's eero network is
real and in use, so **agents never touch it on their own initiative**: no
request to eero's cloud API (`api-user.e2ro.com`), not even a read, and no run
of the app, CLI or MCP server against a live session. That rule outranks
feature work and holds for every surface. The full rule, including the
exception when the maintainer explicitly asks, is in `AGENTS.md`.

## The sandbox

Two layers stand in for eero:

1. **Demo backend** (`src/core/backends/demo/`). In-memory fixtures behind the
   same `Backend` interface as the live backend. Writes apply to the fixtures,
   so pausing or renaming visibly works. Used for command tests, CLI and MCP
   tests, UI work and screenshots. Enabled with `--demo` or `MESH_UI_DEMO=1`.
2. **Fake eero server** (`test/fake-eero/`). A local HTTP server that answers
   like the real API, built from the shapes in
   [eero-api/endpoints.md](eero-api/endpoints.md) and
   [eero-api/data-model.md](eero-api/data-model.md). The real `eero` client
   runs against it, so auth, refresh, rotation, rate limits, `/2.3/` writes and
   error mapping are covered without touching eero.

Plus two guards:

- **No real eero.** The test setup replaces global `fetch` with a wrapper that
  throws on any request to `api-user.e2ro.com`, and the client's origin check
  only accepts the fake server's origin when a test injects it (there is no
  environment variable that redirects the client).
- **No real user data.** Every run that starts Electron passes a throwaway
  `--user-data-dir` in a temp or scratch folder. Nothing reads, copies or
  decrypts `~/.config/mesh-ui/`, `~/Library/Application Support/mesh-ui/` or
  `%APPDATA%\mesh-ui\`.

## Fixtures

- Invented data only: network "Maple Street" (and "Lake Cabin" as a second,
  shared network), owner "Alex Kim", family profiles Alex, Jamie, Mia and Leo,
  eeros Living Room (gateway), Office, Upstairs Hall and Garage, devices on
  `192.168.4.x`, MACs from a locally administered range, serials and ids
  made up.
- Fixtures cover the states pages must handle: an offline eero, a weak
  wireless link, a paused profile, a scheduled profile, a blocked device, an
  update available, a network in bridge mode, a non-owner admin role, and a
  capability missing (no nightlight, no Thread).
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
(`_electron.launch`) for UI. `pnpm test` runs all but UI; `pnpm test:ui` runs
UI.

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

On Linux CI the same checks also run against real Electron with
`--password-store=basic`.

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
- To look at a change by hand, run `pnpm dev:demo`, never a real sign-in.

## CI

Runs on macOS, Windows and Linux (see
[build-and-release.md](platform/build-and-release.md#ci)): typecheck, unit,
command, client, host, CLI and MCP tests everywhere; the keychain-less job and
UI screenshots on Linux. CI has no eero credentials and needs none.

## Manual checks

Some things only a real network can prove: a response shape we have not seen,
a write that must really stick, the timing of a reboot. Agents do not try
them. Instead the task adds a line to its PR body:

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

- `pnpm typecheck`, `pnpm test` and `pnpm build` pass.
- New commands have tests, including `bad_params` and `needs_confirm`.
- New client behaviour has a fake-server test.
- UI changes have demo-mode screenshots in the PR.
- Anything that needs the real network is a `MANUAL:` line, not a done-when.
