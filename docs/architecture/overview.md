# Architecture overview

Mesh UI is an Electron desktop app for eero mesh networks. Every action is a
command in one registry, and the window, the `mesh-ui` CLI and the MCP server
are thin surfaces over the same `engine.execute`. This page is the map; the
other pages in this folder hold the detail.

| Doc | What it covers |
| --- | --- |
| [commands.md](commands.md) | Command spec, naming, effects, confirmation, error codes, the full catalogue |
| [engine.md](engine.md) | `execute`, session, cache and polling, live rates, change events, network switching, rate limiting |
| [backends.md](backends.md) | The `Backend` interface, the `eero` and `demo` backends, fixtures, the fake eero server |
| [data-model.md](data-model.md) | Every model type and how it maps from eero responses |
| [eero-client.md](eero-client.md) | The eero HTTP client: headers, auth, refresh, rate limits, errors |
| [security.md](security.md) | Threat model, session storage, process boundaries, audit log |
| [ui.md](ui.md) | The renderer: `window.mesh`, data hooks, shell, confirm flow, palette |
| [cli.md](cli.md) | The `mesh-ui` CLI: running headless, install, usage, scripts, exit codes |
| [mcp.md](mcp.md) | The MCP server: tools, annotations, results, safety |

Raw eero API research lives in [../eero-api/](../eero-api/endpoints.md).

`AGENTS.md` at the repo root holds the short rules. These docs expand them and
never contradict them.

## Platforms

macOS, Windows and Linux are all first-class. Every feature, the session
store, the CLI and the installers must work on all three. Anything
platform-specific (keychain, CLI install, titlebar) lives in a host, never in
`src/core`.

## Layers

```text
surfaces   renderer (React UI)  ·  cli (mesh-ui)  ·  mcp (inside the CLI)
              │ window.mesh.execute       │ argv / stdio
host       src/main (Electron: window, IPC, SecretStore, paths)
              │  the CLI is the same Electron binary started headless
engine     src/core: registry, execute, session, cache, poller, rate limiter
              │ Backend interface
backends   eero (live cloud API, src/core/eero)  ·  demo (fixtures)
```

A layer only imports from the layers below it. `src/core` is plain TypeScript
for Node: no Electron, React or DOM imports, so it runs unchanged under the
Electron main process, the CLI and the test runner.

## Directory layout (target)

```text
src/
  core/                 engine, plain Node TS
    commands/           one file per area: auth.ts, account.ts, network.ts,
                        internet.ts, eero.ts, device.ts, profile.ts, guest.ts,
                        wifi.ts, settings.ts, routing.ts, updates.ts,
                        admins.ts, activity.ts, diagnostics.ts, app.ts
    registry.ts         collects every CommandSpec, builds JSON Schema
    engine.ts           execute(), confirmation, error mapping
    session.ts          signed-in state, selected network, token handling
    cache.ts            query cache keyed by command id and params
    poll.ts             poll intervals per command, shared by every surface
    model.ts            data model types (data-model.md)
    format.ts           shared formatters: Mbps, GB, %, relative time, CSV
    backend.ts          the Backend interface
    eero/               the only eero HTTP client (with the rate limiter)
                        and the eero backend
    demo/               demo backend and fixtures
  main/                 Electron host: window, IPC bridge, SecretStore, CLI entry
  preload/              exposes window.mesh (execute, commands, events)
  renderer/             React UI, view state only
  cli/                  argv parsing, `run`, scripts, MCP server (stdio)
test/
  fake-eero/            fake eero HTTP server for client tests
```

The current prototype (`src/main/eero.ts`, `src/main/demo.ts`,
`src/shared/types.ts`, the `start-login` / `verify` / `load` IPC handlers)
moves into `src/core` and is replaced by the single `execute` channel.
`src/main/session.ts` becomes the Electron `SecretStore`.

## How a command flows

1. A surface calls `execute("device.pause", { devices: ["Leo's Switch"] })`.
   - UI: `window.mesh.execute(id, params)` over one IPC channel.
   - CLI: `mesh-ui run device.pause --params '{...}'`.
   - MCP: tool `device_pause` with the same arguments.
2. The engine looks up the spec, validates params with zod, resolves names to
   ids, checks `confirm` for `disruptive` and `destructive` commands, and runs
   the command against the current backend.
3. The command calls backend methods, which go through the rate limiter and,
   for `eero`, the HTTP client.
4. The result comes back as `{ ok: true, result }` or
   `{ ok: false, error: { code, message } }`. The engine never throws to a
   surface.
5. Writes invalidate cache topics, so the next query of anything they
   touched reads fresh data from the backend. The UI's query hooks refetch
   after a write and on their poll interval ([engine.md](engine.md)).

## Processes and hosts

| Host | Process | Engine lives in | Token store |
| --- | --- | --- | --- |
| App | Electron main + one renderer | Electron main | Electron `safeStorage` (`session.json`) |
| CLI | Same Electron binary, headless (`--cli`) | that process | the same `safeStorage` store and file |
| MCP | `mesh-ui mcp`, a long-running CLI process on stdio | that process | same |

The renderer never sees the token, never builds eero requests and never
imports `src/core/eero`. It may import pure helpers from `src/core/format.ts`
and types from `src/core/model.ts`.

### Decision: the CLI runs through the Electron binary

The `mesh-ui` CLI is the Electron executable started in headless mode: no
window, no dock icon (`app.dock?.hide()` on macOS), no tray. It waits for
`app.whenReady()`, runs the command or MCP server, and exits with the
command's status. Because it is the same binary with the same `userData`
path, it uses the same `safeStorage` `SecretStore` and the same
`session.json` as the app on every OS. Signing in once in either place works
for both.

The installer puts a `mesh-ui` launcher on `PATH`:

- macOS: App & account offers to symlink a launcher script into
  `/usr/local/bin/mesh-ui` (`app.cli.install`, asks for admin rights).
- Windows: the NSIS installer adds a `mesh-ui` launcher to `PATH` that
  starts `Mesh UI.exe --cli` through the stdio relay.
- Linux: deb and rpm install `/usr/bin/mesh-ui`. AppImage users get an
  "Install CLI" button that writes `~/.local/bin/mesh-ui` pointing at the
  AppImage path.

Rejected alternative: a plain Node CLI with `@napi-rs/keyring`. It would
need a second secret format, a native module per platform, and a separate
sign-in, and the app and CLI could disagree about which session is current.
Reusing Electron keeps one store and one code path, at the cost of a heavier
CLI start (about a few hundred ms).

Known caveats to verify in the CLI story:

- Windows Electron is a GUI subsystem binary, so stdout is not attached to a
  console by default. The launcher runs a small stdio relay so `mesh-ui run`
  and MCP stdio work in `cmd`, PowerShell and Windows Terminal (see
  [cli.md](cli.md#how-the-cli-runs)).
- Linux over SSH or without a desktop session has no Secret Service, so
  `safeStorage` falls back to `basic_text`. That counts as no keychain: the
  CLI keeps the session in memory for that process only. A long-running
  `mesh-ui mcp` can sign in once; one-shot `mesh-ui run` calls cannot.

## Config and files

| OS | Config dir |
| --- | --- |
| Linux | `~/.config/mesh-ui/` |
| macOS | `~/Library/Application Support/mesh-ui/` |
| Windows | `%APPDATA%\mesh-ui\` |

| File | Owner | Contents |
| --- | --- | --- |
| `session.json` | `SecretStore` | `{ v: 2, token }`, token encrypted with `safeStorage`. Written only when a real keychain is available; atomic write, mode `0600`. |
| `settings.json` | engine (`app.settings.*`) | Settings the CLI also needs: last selected network, User-Agent override, demo flag default, ISP plan speed per network, desktop notification choices. Never holds the token. |
| `audit.jsonl` | engine | One line per command run from the CLI or MCP, never the result. Format and limits in [security.md](security.md#audit-log). Shown on App & account. |
| renderer `localStorage` | renderer | Pure UI preferences: theme, panel sizes, collapsed sections, table sort. |

Tests, screenshots and agents always pass a throwaway `--user-data-dir` (or
`MESH_UI_USER_DATA`) in a temp folder so the maintainer's config is never
read or changed.

## Security summary

The full rules are in `AGENTS.md`. Architecturally:

- The token exists only in the engine's process. No command result, event,
  log line, audit entry or error message contains it.
- `SecretStore` persists only with a real OS keychain (Keychain, DPAPI,
  libsecret or KWallet). Linux `basic_text` and `unknown` count as none.
- `disruptive` and `destructive` commands need `confirm: true` on every
  surface. The engine enforces it, not the UI.
- Secrets that a command does return on purpose (`wifi.password.get`,
  `wifi.share`, `guest.share`, `settings.thread.credentials`) are `query`
  commands marked `sensitive`: the UI calls them only on an explicit reveal,
  the CLI masks them without `--reveal`, and MCP descriptions say so.
- The renderer lockdown in `src/main/index.ts` (`web-contents-created`) stays
  as is: no off-app navigation, popups, webviews or permissions.

## Distribution

- Build with electron-builder in a GitHub Actions matrix (macos, windows,
  ubuntu).
- macOS: universal dmg and zip, signed and notarized.
- Windows: NSIS installer (x64 and arm64) and a portable zip, unsigned for
  now (users click through SmartScreen); code signing (Azure Trusted Signing
  preferred) is added before a wider release.
- Linux: AppImage, deb and rpm from day one. Flatpak and AUR later.
- Auto-update with electron-updater from GitHub Releases for dmg, zip, NSIS
  and AppImage. deb and rpm update through the package manager or the
  release page; the app only shows that an update exists.

## Scope

No eero Plus or eero Secure features: no ad blocking, content filters, block
apps, block and allow sites, security insights, VPN, DDNS, backup internet,
radio analytics or usage beyond about 7 days. Usage ranges are Day and Week
only. Amazon login, onboarding of new eeros and eero for Business are also
out of scope. See `AGENTS.md`.
