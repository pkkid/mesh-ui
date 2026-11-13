# CLI

`mesh-ui` is the command line surface. Anything a person can do in the window,
the CLI can do headless, because both call the same `engine.execute` on the
same command registry. The MCP server is a subcommand of the CLI (see
[mcp.md](mcp.md)).

## How the CLI runs

**Decision: the CLI runs through the Electron binary in headless mode.** The
`mesh-ui` launcher starts the installed app binary with a `--cli` flag. Main
sees the flag before `app.whenReady()` and:

- creates no window, hides the dock icon on macOS (`app.dock.hide()`) and
  takes no single-instance lock, so it runs next to an open app window;
- keeps `userData` at the normal config dir (so it shares `session.json`,
  `settings.json` and the `safeStorage` key) but moves Chromium's
  `sessionData` and caches to a `cli/` subfolder so two processes never fight
  over the same Chromium profile files;
- builds the engine with the Electron `SecretStore`, runs the subcommand, and
  exits with the exit code below.

So the CLI reuses the same `safeStorage` secret store and the same session as
the app on every OS. Sign in once in either and both are signed in. Signing
out in either signs both out (the app hears about it on its next request and
returns to sign-in).

On Windows a GUI-subsystem `.exe` does not get a console, so the launcher
there runs a small relay: `ELECTRON_RUN_AS_NODE=1 "Mesh UI.exe" cli-relay.js`,
which spawns `"Mesh UI.exe" --cli ...` with piped stdio and forwards stdin,
stdout, stderr and the exit code. The relay has no access to the session; it
only moves bytes. macOS and Linux run `--cli` directly.

**Rejected alternative: a plain Node CLI with `@napi-rs/keyring`.** It would
need a second secret store with its own keychain item and trust prompts, a
native module per OS and arch, and either a second session (sign in twice) or
a migration of the app off `safeStorage`. It also could not read sessions the
app already saved. Running the Electron binary costs some start-up time
(to be measured; expected well under a second) but keeps one implementation of secret storage.

Limits that follow from this:

- On Linux with no keychain (no Secret Service or KWallet on the session bus,
  for example over plain SSH), the session cannot be saved, so every CLI run
  starts signed out. `mesh-ui login` still works for one process, which makes
  `mesh-ui mcp` usable but `mesh-ui run` one-shot. `--demo` always works.
- Headless Linux without a display server runs with `--ozone-platform=headless`
  (set by the launcher when neither `DISPLAY` nor `WAYLAND_DISPLAY` is set).

## Install

The installer puts a `mesh-ui` launcher on `PATH`. Details per OS are in
[build-and-release.md](../platform/build-and-release.md#cli-launcher).

| OS | Launcher |
| --- | --- |
| macOS | Symlink `/usr/local/bin/mesh-ui` to a script inside the app bundle, offered from App & account ("Install command line tool", needs an admin prompt) |
| Windows | NSIS installer adds `<install dir>\bin` (holding `mesh-ui.cmd`) to the user `PATH` |
| Linux deb / rpm | Package installs `/usr/bin/mesh-ui` |
| Linux AppImage | "Install CLI" button in App & account writes `~/.local/bin/mesh-ui` pointing at the AppImage path |

The App & account button runs `app.cli.install`, which reports where the
launcher is and whether it is on `PATH`.

## Usage

```text
mesh-ui <command> [options]

Commands
  commands                 List every command (id, label, effect, params schema)
  run <id>                 Run one command
  run <file.jsonl>         Run a script, one command per line
  login                    Sign in interactively (email or phone, then code)
  logout                   Sign out and forget the saved session
  status                   Show sign-in state, storage and selected network
  mcp                      Start the MCP server on stdio
  help [command]           Show help

Global options
  --demo                   Use the demo backend (also MESH_UI_DEMO=1)
  --fake                   Dev builds only: use the local fake eero server
  --network <id|name>      Network for this run (default: the selected one)
  --format <json|table>    Output format (default: table on a TTY, json otherwise)
  --quiet                  Print nothing on success; errors still go to stderr
  --no-color               Disable colour (also NO_COLOR=1)
  --version                Print the version
  -h, --help               Help

run options
  --params <json|@file|->  Params as JSON, from a file, or from stdin
  --confirm                Allow a disruptive or destructive command
  --reveal                 Show sensitive values (passwords) in table output
  --keep-going             Scripts: continue after a failed line
```

`login`, `logout` and `status` are shortcuts for `auth.login.start` plus
`auth.login.verify`, `auth.logout` and `auth.status`. `--network` is
shorthand for adding `networkId` to params; it does not change the selected
network in `settings.json` (use `run network.select` for that).

## Commands listing

`mesh-ui commands` prints the registry. Table format:

```text
ID                  EFFECT       LABEL
auth.status         query        Session status
device.list         query        List devices
device.pause        write        Pause device
eero.restart        disruptive   Restart eero
eero.remove         destructive  Remove eero
...
```

JSON format is an array of
`{ id, label, description, effect, sensitive, params }` where `params` is the
JSON Schema generated from the command's zod schema. This is the params
documentation; there is no separate list to keep in sync.

`mesh-ui help <id>` prints one command with its schema and an example.

## Output formats

### json

Prints exactly what `engine.execute` returned, one JSON document on stdout,
for success and failure alike:

```json
{ "ok": true, "result": { "id": "dev_7f2c", "name": "Leo's Switch", "paused": true } }
```

```json
{ "ok": false, "error": { "code": "needs_confirm", "message": "eero.restart restarts the Office eero. Pass --confirm to run it." } }
```

Pipe through `jq .result` for the data. JSON is the default when stdout is not
a TTY, so scripts get stable output without flags.

### table

For people at a terminal. Rendered from the result:

- an array of objects becomes a grid: the first 6 scalar fields as columns,
  headed in upper case (`DEVICES ONLINE`), numeric columns right-aligned;
- an object becomes `key  value` rows;
- an object with an array-of-objects field (`{ devices, summary }`) prints in
  sections: its scalar fields first as `key  value` rows, then each such
  array as its own grid headed `NAME (count)` (`DEVICES (12)`), then its
  other object fields as `key  value` blocks under their own heading;
- inside a cell, a small flat object (up to 6 scalar fields) shows inline
  (`downMbps 171 Mbps, upMbps 38 Mbps`); other nested objects are summarised
  (`8 fields`) and other arrays, including an empty nested array, as a count
  (`0 items`); use json for detail;
- values use the shared formatters (Mbps, GB, relative time) and `-` for
  missing;
- `sensitive` fields show `********` unless `--reveal`.

Errors in table format go to stderr as one line: `error needs_confirm: ...`.

## Exit codes

| Code | Meaning | Engine error codes |
| --- | --- | --- |
| 0 | Success | |
| 1 | The command ran and eero or the network failed | `eero_error`, `network_error` |
| 2 | Usage error | `unknown_command`, `bad_params`, bad flags, unreadable params file |
| 3 | Needs confirmation | `needs_confirm` |
| 4 | Not signed in | `not_signed_in` |
| 5 | Rate limited | `rate_limited` (retry after `error.detail.retryAfterSec` seconds) |
| 10 | A script line failed (see Scripts) | any |
| 130 | Interrupted (Ctrl C) | |

## Scripts

`mesh-ui run file.jsonl` runs one command per line, in order, through the same
`execute`:

```jsonl
{"id": "device.list", "params": {"connected": true}}
{"id": "profile.pause", "params": {"profile": "Leo"}}
{"id": "eero.restart", "params": {"eero": "Garage", "confirm": true}}
```

- Blank lines and lines starting with `#` are skipped.
- Each result prints as one JSON line on stdout:
  `{"line": 3, "id": "eero.restart", "ok": true, "result": {...}}`.
- The run stops at the first failed line and exits 10, unless `--keep-going`,
  in which case it runs every line and exits 10 if any failed.
- **Confirmation is per line.** A disruptive or destructive line runs only if
  its own params contain `"confirm": true`. A global `--confirm` is refused for
  scripts, so one flag cannot approve a whole file the reader has not seen.
- `--demo`, `--network` and `--format` apply to every line. A line may set
  its own `networkId`.
- `-` reads the script from stdin.

The command palette's "Add to script.jsonl" action writes lines in this
format.

## Examples

```sh
# Who is online right now
mesh-ui run device.list --params '{"connected": true}'

# Same, as JSON for jq
mesh-ui run device.list --params '{"connected": true}' --format json | jq '.result[].name'

# Pause a profile until it is resumed
mesh-ui run profile.pause --params '{"profile": "Leo"}'

# Restart one eero (disruptive, needs --confirm)
mesh-ui run eero.restart --params '{"eero": "Garage"}' --confirm

# Data used this week, per device
mesh-ui run usage.breakdown --params '{"range": "week", "by": "device"}'

# Params from a file
mesh-ui run reservation.add --params @reservation.json

# Try anything without an eero account
mesh-ui --demo run eero.list
MESH_UI_DEMO=1 mesh-ui run network.get

# Run a script against the demo network
mesh-ui --demo run evening.jsonl --keep-going

# Sign in from the terminal
mesh-ui login
```

## Implementation

- `src/cli/` holds argument parsing, output formatting and the launcher relay.
  It imports `src/core` and nothing from the renderer.
- `src/cli/index.ts` holds the entry points and the host contract:
  - `runCli(argv, io, host)` parses the global flags, picks the subcommand
    and the backend mode (`demo`, `fake` or `live`), and returns an exit
    code. It never exits the process.
  - `cliMain(argv, host?)` runs the CLI as a whole process: it calls
    `runCli`, exits 130 on Ctrl C, and waits for stdout and stderr to drain
    before `process.exit`, so piped output is never cut short.
  - `CliHost` is what differs per runtime: version, `dev` (allows `--fake`),
    `isTTY`, env, `createEngine({ mode, surface, userDataDir })`, stdin and
    a terminal prompt. The engine is built once per run and shared by the
    subcommand (and by `mcp`, see [mcp.md](mcp.md#implementation)).
  - `nodeHost()` is the host for tests and the dev launcher. It serves the
    demo backend and the fake eero server only (`--fake` needs
    `MESH_UI_FAKE_ORIGIN` set to a loopback origin), with an in-memory
    session. A live request fails with "This build has no live backend".
    Settings go to `settings.json` in `--user-data-dir` (or
    `MESH_UI_USER_DATA_DIR`) when given, else stay in memory.
- The live host is the Electron one. `src/main/index.ts` sees `--cli`,
  creates no window, and calls `cliMain` with `electronCliHost()`: `nodeHost`'s
  terminal handling plus a `createEngine` that builds the live engine with
  the Electron `SecretStore` and the app's settings paths, so the paths and
  storage rules are identical to the app. Demo and fake runs there use the
  real config dir only when `--user-data-dir` is given.
- stdout carries only results (or, for `mcp`, the protocol). Logs and progress
  go to stderr.
- Commands from the CLI and MCP are to be recorded in the audit log (see
  [security.md](security.md#audit-log)). Not yet built in M1: there is no
  audit log yet.
