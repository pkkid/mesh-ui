# Mesh UI

A desktop app for managing [eero](https://eero.com) mesh networks on macOS,
Windows and Linux, with a command line and an MCP server for scripts and AI
agents. Built with Electron, React, and Tailwind, with a look and theme
system borrowed from [T3 Code](https://github.com/pingdotgg/t3code).

> Mesh UI is an independent app and is not made by eero or Amazon. It talks
> to eero's unofficial cloud API (the one the mobile app uses) and is not
> affiliated with or endorsed by eero or Amazon.

## Features

- Sign in with the email or phone on your eero account (one-time code).
- Overview, Internet, eeros, Devices, Profiles, Guest, Wi-Fi, Activity,
  Troubleshooting, Advanced networking, Updates and admins, and App &
  account pages, plus a command palette.
- Pause and rename devices, manage profiles and schedules, reservations and
  port forwards, guest access, and network settings. Restarts and other
  disruptive changes always ask first.
- Everything the window does is also a command for the `mesh-ui` CLI and
  its MCP server.
- Light, dark, and system appearance, plus the Default, Grove, Ocean, Ember,
  Iris, and Gruvbox Hard palettes from T3 Code.
- Free eero accounts only: nothing behind eero Plus.

## Install

Download the file for your system from the
[latest release](https://github.com/pkkid/mesh-ui/releases/latest). Builds
are not code-signed yet, so macOS and Windows warn on first launch; check
the download against `SHA256SUMS.txt` first (see
[Check the download](#check-the-download)).

### macOS (Apple silicon and Intel)

1. Download `Mesh-UI-<version>-universal.dmg`, open it, and drag Mesh UI to
   Applications.
2. Open Mesh UI once. macOS says it cannot verify the app; click **Done**.
3. Open **System Settings > Privacy & Security**, scroll to the Mesh UI
   message, click **Open Anyway**, and confirm. From then on it opens
   normally.

Or, in Terminal, clear the quarantine flag and open it:

```sh
xattr -d com.apple.quarantine "/Applications/Mesh UI.app"
```

The app is not notarized, so on macOS 15 and later the old right-click,
Open shortcut no longer works. **Updates on a Mac are by hand for now:**
Mesh UI checks for new versions and, when one is out, App & account links
to its release page. Download the new dmg and replace the app.

### Windows (x64 and arm64)

1. Download `Mesh-UI-Setup-<version>-x64.exe` (or `-arm64.exe`) and run it.
   It installs for your user only, with no admin prompt.
2. SmartScreen may say "Windows protected your PC". Click **More info**,
   then **Run anyway**.

The installed app updates itself. `Mesh-UI-<version>-<arch>-portable.zip`
is also available: unzip and run, with no install, no updates and no CLI
on `PATH`.

### Linux (x64 and arm64)

- **AppImage:** download `Mesh-UI-<version>-<arch>.AppImage`, then
  `chmod +x Mesh-UI-*.AppImage` and run it. It updates itself.
- **deb** (Debian, Ubuntu): `sudo apt install ./mesh-ui_<version>_amd64.deb`
  (or `_arm64.deb`).
- **rpm** (Fedora, openSUSE): `sudo dnf install ./mesh-ui-<version>.x86_64.rpm`
  (or `.aarch64.rpm`).

deb and rpm do not update themselves; install the new package the same way.
To keep your session between launches, Linux needs a keyring (GNOME Keyring
or KWallet); without one you sign in each time you open the app.

### Check the download

Each release has `SHA256SUMS.txt` with a checksum for every file. With it
and your download in the same folder:

```sh
sha256sum -c SHA256SUMS.txt --ignore-missing                    # Linux
grep universal.dmg SHA256SUMS.txt | shasum -a 256 -c             # macOS
```

On Windows, compare `(Get-FileHash .\Mesh-UI-Setup-<version>-x64.exe).Hash`
with the file's line in `SHA256SUMS.txt` (case does not matter).

## Command line

The `mesh-ui` command runs the same commands as the window, without opening
it. Sign in once in the app; the CLI uses the same saved session.

| Install | How `mesh-ui` gets on your `PATH` |
| --- | --- |
| macOS | App & account, **Install CLI** (asks for an admin password), or add `/Applications/Mesh UI.app/Contents/Resources/bin` to `PATH` |
| Windows installer | Added to your user `PATH` by the installer; open a new terminal |
| Windows portable | Not added; run `bin\mesh-ui.cmd` from the folder, or add it to `PATH` |
| Linux deb, rpm | Installed as `/usr/bin/mesh-ui` |
| Linux AppImage | App & account, **Install CLI** writes `~/.local/bin/mesh-ui` |

```sh
mesh-ui --demo run app.info        # try it on invented demo networks
mesh-ui commands                   # every command, with its params as JSON Schema
mesh-ui run network.list
mesh-ui run eero.list
mesh-ui run eero.restart --params '{"eero": "<id from eero.list>"}' --confirm
```

Restarts, DNS changes and anything that cannot be undone fail with
`needs_confirm` unless you pass `--confirm`. See
[docs/architecture/cli.md](docs/architecture/cli.md).

### MCP server for AI agents

`mesh-ui mcp` serves every command as an MCP tool over stdio:

```sh
claude mcp add mesh-ui -- mesh-ui mcp              # Claude Code
claude mcp add mesh-ui-demo -- mesh-ui mcp --demo  # demo networks only
claude mcp add mesh-ui -- mesh-ui mcp --read-only  # only read tools
```

Other clients use the same command in their config:

```json
{ "mcpServers": { "mesh-ui": { "command": "mesh-ui", "args": ["mcp"] } } }
```

Agents must pass `confirm: true` for disruptive and destructive tools, and
App & account lists the commands the CLI and agents ran this week. See
[docs/architecture/mcp.md](docs/architecture/mcp.md).

## Demo mode

No eero account needed: click **Try demo mode** on the sign-in screen, or
start the app, CLI or MCP server with `--demo` (or `MESH_UI_DEMO=1`). Demo
mode uses invented networks, and nothing you change in it reaches eero.

## Building from source

Requires Node 22+ and [pnpm](https://pnpm.io).

```sh
pnpm install        # also downloads the Electron binary
pnpm dev:demo       # run with demo data and hot reload, no eero account needed
pnpm dev            # run against your eero account
pnpm check          # typecheck, test, build
pnpm dist           # packages for this OS into dist/ (unsigned)
```

| Command | What it does |
| --- | --- |
| `pnpm dev` | Start the app with Vite hot reload |
| `pnpm dev:demo` | Same, with built-in demo networks (no sign-in) |
| `pnpm build` | Production build into `out/` |
| `pnpm start` | Run the production build |
| `pnpm mesh-ui` | Run the CLI from the build (`pnpm -s mesh-ui --demo run app.info`) |
| `pnpm check` | Typecheck, test and build |
| `pnpm dist`, `pnpm dist:dir` | Packages, or an unpacked app, for the current OS |
| `pnpm dist:smoke` | Launch the unpacked app with `--demo` and check the CLI and window |

How it is built and released: [docs/platform/build-and-release.md](docs/platform/build-and-release.md).
All the docs: [docs/](docs/README.md).

## Project layout

```
src/
  core/         Commands, engine, eero client and demo backend (plain Node)
  main/         Electron main process: window, IPC, keychain, updater, CLI install
  cli/          The mesh-ui CLI and MCP server
  preload/      Exposes a typed `window.mesh` API to the renderer
  shared/       Types shared by main and renderer
  renderer/     React app (Vite + Tailwind v4)
```

## Privacy and security

Your eero session token gives full control of your network, so Mesh UI is
careful with it on every platform:

- It stays in the app's main process (or the CLI's) and never reaches the
  UI, the MCP client or the logs.
- It is saved only when the OS can encrypt it with a real keychain: Keychain
  on macOS, DPAPI on Windows, and GNOME Keyring or KWallet on Linux. Without
  one (for example, Linux with no keyring running), the session is kept in
  memory and you sign in each launch. It is never written in plaintext.
- The file is written atomically with owner-only permissions.
- Signing out ends the session with eero as well as deleting it locally.
- The window cannot navigate away from the app, open popups or webviews, or
  request permissions such as camera or location.
- CLI and MCP calls are logged to `audit.jsonl` in the config dir, without
  the token or secret params.

App & account shows whether your session is saved in the keychain or held
in memory.

## Credits

Theme palettes and UI primitives are adapted from T3 Code, MIT License,
Copyright (c) 2026 T3 Tools Inc.
