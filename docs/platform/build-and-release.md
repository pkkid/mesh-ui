# Build and release

How Mesh UI is built, signed, published and updated. Builds use
electron-vite for the code and electron-builder for packages, in a GitHub
Actions matrix. Releases are published to GitHub Releases on
`pkkid/mesh-ui`.

## Local builds

```sh
pnpm install            # also downloads the Electron binary
pnpm typecheck
pnpm build              # electron-vite: out/main, out/preload, out/renderer
pnpm test               # vitest, the whole suite
pnpm dist               # electron-builder for the current OS (unsigned unless signing env is set)
pnpm dist:dir           # unpacked app in dist/<os>-unpacked, fastest to test
pnpm dist:smoke         # launch the dist:dir app with --demo and check CLI and window
pnpm test:keychainless  # Linux: built app with --password-store=basic keeps the session in memory
```

`pnpm dist` and `pnpm dist:dir` build with electron-vite, then run
electron-builder, which reads `electron-builder.yml`. `pnpm dist:smoke` and
`pnpm test:keychainless` run `scripts/dist-smoke.mjs` with a throwaway user
data dir and `XDG_CONFIG_HOME`, against the demo backend or the local fake
eero server. Local builds are unsigned unless the signing variables below are
set; that is fine for testing.

electron-builder is not a devDependency. The scripts run it as
`pnpm dlx electron-builder@26.18.0`, pinned to an exact version. As a
devDependency it makes `pnpm install` fail under pnpm 12's strict dependency
builds, because `electron-winstaller` (a peer of `app-builder-lib`, for
Squirrel, which Mesh UI does not use) has a build script that would need an
`allowBuilds` entry in `pnpm-workspace.yaml`. Running it through `dlx` keeps
installs, the lockfile and CI lighter. To bump it, change the version in both
scripts in `package.json`.

## Identity

| Field | Value |
| --- | --- |
| `productName` | Mesh UI |
| Package name | `mesh-ui` |
| `appId` | `io.github.pkkid.meshui` (final) |
| Executable | `Mesh UI.app` / `Mesh UI.exe` / `mesh-ui` |
| Config dir | `mesh-ui` (see [cross-platform.md](cross-platform.md#paths)) |

`appId` must never change after the first release: it keys the macOS
keychain item, the Windows AppUserModelID and the auto-update identity.

## Artifacts

| OS | Arch | Artifact | Auto-update | Notes |
| --- | --- | --- | --- | --- |
| macOS | universal (arm64 + x64) | `Mesh-UI-<v>-universal.dmg` | Yes | Signed and notarized; for first install |
| macOS | universal | `Mesh-UI-<v>-universal-mac.zip` | Yes | Used by electron-updater; also a manual download |
| Windows | x64 | `Mesh-UI-Setup-<v>-x64.exe` (NSIS) | Yes | Per-user install, no admin; adds CLI to `PATH` |
| Windows | arm64 | `Mesh-UI-Setup-<v>-arm64.exe` (NSIS) | Yes | |
| Windows | x64, arm64 | `Mesh-UI-<v>-<arch>-portable.zip` | No | Unzip and run; no CLI on `PATH` |
| Linux | x64, arm64 | `Mesh-UI-<v>-<arch>.AppImage` | Yes | CLI via "Install CLI" in App & account |
| Linux | x64 (amd64), arm64 | `mesh-ui_<v>_<arch>.deb` | No (package manager or release page) | Installs `/usr/bin/mesh-ui` |
| Linux | x64 (x86_64), arm64 (aarch64) | `mesh-ui-<v>.<arch>.rpm` | No | Installs `/usr/bin/mesh-ui` |
| All | | `latest.yml`, `latest-mac.yml`, `latest-linux.yml`, `latest-linux-arm64.yml` | | electron-updater metadata |
| All | | `SHA256SUMS.txt` | | Checksums for every artifact |

Later: Flatpak (Flathub) and an AUR package. Both update through their own
channels, like deb and rpm.

deb and rpm declare dependencies on `libsecret-1-0` / `libsecret` so a
keychain is usable when a Secret Service is running.

## Signing and notarization

### macOS

- **Developer ID Application** certificate, hardened runtime on.
- Entitlements (`build/entitlements.mac.plist`): only what Electron needs,
  `com.apple.security.cs.allow-jit`. No network server, camera, microphone or
  file entitlements. Add `allow-unsigned-executable-memory` only if a future
  Electron needs it.
- **Notarization** with `notarytool` through electron-builder's `notarize`
  option, using an App Store Connect API key. The ticket is stapled to the dmg
  and app.
- Secrets: `APPLE_API_KEY` (the `.p8`, base64), `APPLE_API_KEY_ID`,
  `APPLE_API_ISSUER`, `CSC_LINK` (Developer ID `.p12`, base64),
  `CSC_KEY_PASSWORD`.

### Windows

- **Unsigned for now.** Early Windows builds ship without Authenticode
  signing. SmartScreen warns on first run ("Windows protected your PC");
  users click **More info** then **Run anyway**. The release notes and the
  download page say so, and `SHA256SUMS.txt` lets users check the download.
- **Before a wider release**, add Authenticode signing of the installer, the
  app exe and `mesh-ui.cmd`'s relay. Preferred: **Azure Trusted Signing**
  through electron-builder's `azureSignOptions` (no hardware token, works in
  CI). Alternative: an OV or EV certificate on a cloud HSM. Secrets then:
  `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, plus the
  account and profile names in `electron-builder.yml`. SmartScreen
  reputation builds up over the first signed releases.

### Linux

- Packages are not signed in the first release. `SHA256SUMS.txt` is published
  with every release, and signed with the project GPG key once one exists.
- When a deb or rpm repository is added (with Flatpak and AUR), packages are
  signed there.

Signing secrets are GitHub environment secrets on the `release` environment.
Pull request workflows never see them.

## CI

Two workflows, and nothing else runs in GitHub Actions.

### `ci.yml` (pull requests to `main` and `milestone/**`, and manual runs)

Light on purpose: most testing is local (see [testing.md](../testing.md#local-first)).

| Job | Runners | Steps |
| --- | --- | --- |
| smoke | `ubuntu-latest`, `macos-latest`, `windows-latest` | `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`, `pnpm build` |

It triggers on `pull_request` to `main` and `milestone/**` (story PRs target
the milestone branch, so they get the smoke too) and on `workflow_dispatch`.
No UI, screenshot, keychain-less or packaging jobs run in CI; those run
locally (`pnpm test:keychainless`, `pnpm dist:dir` then `pnpm dist:smoke`).
Pushes to branches do not trigger CI; concurrency cancels superseded runs.
`pnpm test` runs with vitest's default 5s per-test timeout, so keep every
test well under it (property tests check with plain comparisons and one
`expect` per case, not one per sample).

### `release.yml` (tag `v*`)

| Job | Runner | Builds |
| --- | --- | --- |
| mac | `macos-latest` (arm64) | universal dmg + zip, signed, notarized |
| win | `windows-latest` | NSIS x64 + arm64, portable zips, unsigned for now (see [Windows](#windows)) |
| linux-x64 | `ubuntu-latest` | AppImage, deb, rpm (x64) |
| linux-arm64 | `ubuntu-24.04-arm` | AppImage, deb, rpm (arm64) |
| publish | `ubuntu-latest` | Collects artifacts, writes `SHA256SUMS.txt`, creates a **draft** GitHub Release with notes from the milestone review |

The maintainer reviews the draft and publishes it. Auto-update only sees
published releases.

## Versioning

- Semantic versioning. `package.json` `version` is the source of truth; the
  tag is `v<version>`.
- Before 1.0, minor versions follow milestones (`0.2.0` ships M2) and patch
  versions are fixes.
- Pre-releases use `-beta.N` and are published as GitHub pre-releases. Users
  on the beta channel (App & account, stored in `settings.json`) get them.
- The version shows in App & account and in `mesh-ui --version`, and is
  returned by `app.info`.
- Release notes come from the milestone review (`docs/reviews/M<n>.md`):
  user-facing changes only.

## Auto-update

electron-updater with the GitHub provider.

- **Who updates:** macOS (zip), Windows NSIS, Linux AppImage. Not the Windows
  portable zip, deb or rpm; those builds hide the update controls and App &
  account links to the release page instead ("Installed with a package
  manager. Update with apt or dnf.").
- **When:** check 10 s after launch and every 6 hours while running. Download
  in the background. When ready, show "Restart to update" in App & account and
  the sidebar footer; never restart on its own.
- **Verification:** electron-updater checks the code signature on macOS and
  the sha512 from `latest*.yml` everywhere. Windows adds the signature check
  (`publisherName`) once builds are signed; until then it relies on the
  sha512 and the HTTPS GitHub download.
- **Channel:** `latest` by default, `beta` when the user opts in.
- **Off switch:** App & account can turn automatic checks off
  (`app.settings.set`). `app.info` reports the current version, update state
  and channel.
- **CLI:** the CLI never checks for or installs updates. It runs whatever app
  version is installed.
- **Dev builds** (`pnpm dev`) never check.

## CLI launcher

The CLI is the app binary in headless mode (see
[cli.md](../architecture/cli.md#how-the-cli-runs)). Each package ships a
launcher.

### macOS

- The app bundle contains `Contents/Resources/bin/mesh-ui`, a shell script:

  ```sh
  #!/bin/sh
  exec "$(dirname "$0")/../../MacOS/Mesh UI" --cli "$@"
  ```

  (resolved through the symlink with `realpath` so it works from
  `/usr/local/bin`).
- App & account offers **Install command line tool** (`app.cli.install`),
  which creates `/usr/local/bin/mesh-ui` pointing at that script, asking for
  an admin password through the system prompt. If the app moves, the button
  shows "Reinstall".
- Users who prefer not to give admin rights can add
  `/Applications/Mesh UI.app/Contents/Resources/bin` to `PATH`; App & account
  shows the line to copy.

### Windows

- NSIS installs `bin\mesh-ui.cmd` and `resources\cli-relay.js`:

  ```bat
  @echo off
  setlocal
  set ELECTRON_RUN_AS_NODE=1
  "%~dp0..\Mesh UI.exe" "%~dp0..\resources\cli-relay.js" %*
  ```

  The relay spawns `Mesh UI.exe --cli` with piped stdio, so output reaches the
  console and exit codes pass through.
- The installer adds `<install dir>\bin` to the **user** `PATH` and removes it
  on uninstall.
- The portable zip includes the same `bin\` folder but does not touch `PATH`.

### Linux

- deb and rpm install the app to `/opt/Mesh UI/` and a launcher script at
  `/usr/bin/mesh-ui`:

  ```sh
  #!/bin/sh
  if [ -z "$DISPLAY" ] && [ -z "$WAYLAND_DISPLAY" ]; then
    set -- --ozone-platform=headless "$@"
  fi
  exec "/opt/Mesh UI/mesh-ui" --cli "$@"
  ```

  The desktop entry still launches the window; only the launcher adds
  `--cli`.
- AppImage: App & account shows **Install CLI** (`app.cli.install`), which
  writes `~/.local/bin/mesh-ui` calling the AppImage path (`$APPIMAGE`) with
  `--cli`, and warns if `~/.local/bin` is not on `PATH`. If the AppImage moves
  or is replaced by an update, the button shows "Reinstall".

## Release checklist

1. Milestone review merged by the maintainer.
2. Bump `version` in `package.json`, commit, tag `v<version>`, push the tag.
3. `release.yml` builds, signs (macOS now, Windows once signing is added) and drafts the release.
4. Maintainer only: download one artifact per OS from the draft, install it,
   launch with `--demo`, and check the update prompt from the previous
   version.
5. Publish the draft.
