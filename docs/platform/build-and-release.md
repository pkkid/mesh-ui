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
pnpm dist               # electron-builder for the current OS (unsigned; ad-hoc signed on a Mac)
pnpm dist:dir           # unpacked app in dist/<os>-unpacked, fastest to test
pnpm dist:smoke         # launch the dist:dir app with --demo and check CLI and window
pnpm test:keychainless  # Linux: built app with --password-store=basic keeps the session in memory
```

`pnpm dist` and `pnpm dist:dir` build with electron-vite, then run
electron-builder, which reads `electron-builder.yml`. `pnpm dist:smoke` and
`pnpm test:keychainless` run `scripts/dist-smoke.mjs` with a throwaway user
data dir and `XDG_CONFIG_HOME`, against the demo backend or the local fake
eero server. With no display (Linux without `DISPLAY` or `WAYLAND_DISPLAY`)
every step runs on headless ozone and the window step offscreen
(`MESH_UI_HEADLESS=1`). Builds are unsigned for now (see [Signing](#signing)):
a build on a Mac gets an ad-hoc signature and is not notarized, and no
signing variable is needed anywhere.

`pnpm dist` on Linux builds the AppImage, deb and rpm for the host's arch
(x64 or arm64); release.yml builds each arch on its own runner. To read a
package's install scripts: `dpkg-deb -e dist/mesh-ui_<v>_amd64.deb <dir>`
(`postinst`, `postrm`) and `rpm -qp --scripts dist/mesh-ui-<v>.x86_64.rpm`.

### Packaging files

| File | What it is |
| --- | --- |
| `electron-builder.yml` | Targets, artifact names, signing settings (ad-hoc on macOS for now), publish config |
| `build/icon.png` | The app icon, 1024 px; electron-builder derives icns, ico and the Linux sizes |
| `build/entitlements.mac.plist` | macOS entitlements (only `allow-jit`), for the hardened runtime once Developer ID signing is added |
| `build/mac/mesh-ui` | macOS CLI launcher, `Contents/Resources/bin/mesh-ui` |
| `build/win/mesh-ui.cmd`, `build/win/cli-relay.js` | Windows CLI launcher and relay, `bin\mesh-ui.cmd` and `resources\cli-relay.js` |
| `build/win/installer.nsh` | NSIS: adds `<install dir>\bin` to the user `PATH`, removes it on uninstall |
| `build/linux/mesh-ui` | Linux CLI launcher, `resources/bin/mesh-ui`, copied to `/usr/bin/mesh-ui` |
| `build/linux/after-install.sh`, `after-remove.sh` | deb and rpm scripts: electron-builder's defaults, but writing and removing the `/usr/bin/mesh-ui` launcher in place of a symlink |

`publish` in `electron-builder.yml` names GitHub (`pkkid/mesh-ui`) so the
build writes `resources/app-update.yml` and the `latest*.yml` files (a
`-beta.N` version writes `beta*.yml`). For the GitHub provider
electron-builder ignores `generateUpdatesFilesForAllChannels`: the beta
channel reaches users through GitHub pre-releases (electron-updater's
`allowPrerelease`), so a stable release writes only `latest*.yml`. The flag
is set anyway so a generic update host would get every channel's files.
Every script still passes `--publish never`; only release.yml
uploads, to a draft.

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
| macOS | universal (arm64 + x64) | `Mesh-UI-<v>-universal.dmg` | Yes | Unsigned for now (ad-hoc signature); for first install, see [macOS](#macos) |
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

## Signing

### macOS

- **Unsigned for now** (decided 2026-11-14: no Apple Developer Program
  membership yet). Like Windows, macOS builds ship without a Developer ID
  signature and are not notarized; `SHA256SUMS.txt` lets users check the
  download. `electron-builder.yml` sets `identity: "-"`, so the app gets an
  **ad-hoc signature**: Apple silicon refuses to run an arm64 binary with no
  signature at all, and the universal build carries one. `hardenedRuntime`
  is off (ad-hoc signing with the hardened runtime would need the
  `disable-library-validation` entitlement) and `notarize: false`.
  release.yml sets `CSC_IDENTITY_AUTO_DISCOVERY=false` on the mac job, so
  electron-builder never searches the runner's keychain, and the job uses
  no secret.
- **First launch on macOS 15 and later.** Gatekeeper blocks an app that is
  not notarized, and the old right-click, Open shortcut no longer bypasses
  it. Users install the app, try to open it once (macOS says it cannot
  verify the app), then open **System Settings > Privacy & Security** and
  click **Open Anyway** next to the Mesh UI message, and confirm. Or, in
  Terminal, clear the quarantine flag:
  `xattr -d com.apple.quarantine "/Applications/Mesh UI.app"`. The release
  notes say so, and so should the README's install steps. `codesign -dv "/Applications/Mesh UI.app"` shows
  `Signature=adhoc`.

### Later: Developer ID and notarization

Not used yet; this is the plan for when the maintainer joins the Apple
Developer Program.

- **Developer ID Application** certificate, hardened runtime on.
- Entitlements (`build/entitlements.mac.plist`): only what Electron needs,
  `com.apple.security.cs.allow-jit`. No network server, camera, microphone or
  file entitlements. Add `allow-unsigned-executable-memory` only if a future
  Electron needs it.
- **Notarization** with `notarytool` through electron-builder's `notarize`
  option, using an App Store Connect API key. The ticket is stapled to the dmg
  and app.
- Secrets, as environment secrets of a `release` GitHub environment used
  only by the mac job: `APPLE_API_KEY` (the `.p8`, base64),
  `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, `CSC_LINK` (Developer ID `.p12`,
  base64), `CSC_KEY_PASSWORD`. electron-builder reads `APPLE_API_KEY` as a
  path to the `.p8` file, so release.yml would decode the secret to a temp
  file in `$RUNNER_TEMP`, export its path, and remove it at the end of the
  job. Set the secrets only on the `pnpm dist` step, so the smoke and the
  screenshot never see them.
- To switch on: in `electron-builder.yml` remove `identity: "-"` and set
  `hardenedRuntime: true` and `notarize: true`; in release.yml add
  `environment: release` to the mac job, drop `CSC_IDENTITY_AUTO_DISCOVERY`,
  and add the decode step and the five secrets; update
  `test/packaging/release.test.ts`, the release notes and the first-launch steps
  in the README.

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

No release job uses a secret today. When signing is added, its secrets are
GitHub environment secrets on a `release` environment, which pull request
workflows never see.

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

### `release.yml` (tag `v*`, or a manual dry run)

| Job | Runner | Builds |
| --- | --- | --- |
| mac | `macos-latest` (arm64) | universal dmg + zip, ad-hoc signed, not notarized (see [macOS](#macos)) |
| win | `windows-latest` | NSIS x64 + arm64, portable zips, unsigned for now (see [Windows](#windows)) |
| linux-x64 | `ubuntu-latest` | AppImage, deb, rpm (x64) |
| linux-arm64 | `ubuntu-24.04-arm` | AppImage, deb, rpm (arm64) |
| publish | `ubuntu-latest` | Collects artifacts, writes `SHA256SUMS.txt`, creates a **draft** GitHub Release with notes from the milestone review |

- **Triggers:** a pushed `v*` tag, or **Run workflow** (`workflow_dispatch`)
  with `dry_run` (on by default). A dry run builds everything and uploads
  the packages and screenshots as workflow artifacts, but never makes a
  release. `publish` runs only for a `v*` tag ref: a tag push, or a manual
  run on a tag with `dry_run` off (to redo a failed release). A manual run
  on a branch can never publish.
- **Each OS job** runs `pnpm dist:dir`, `pnpm dist:smoke` (the packaged CLI
  and window, `--demo`), and `pnpm ui:shot --route '#/overview'`, uploaded
  as the `ui-shot-<os>` artifact: the proof that the app starts and renders
  on macOS, Windows and Linux. Then `pnpm dist` builds the packages, uploaded
  as `dist-<os>` (packages, `.blockmap` files and the update files, `latest*.yml` or `beta*.yml`). Windows
  smokes the x64 dir build only (`pnpm dist:dir --x64`), the runner's arch.
  The Linux jobs install `rpm` and allow unprivileged user namespaces
  (Ubuntu 24.04 blocks them, and Chromium's sandbox needs them); arm64 uses
  a system `fpm` (`USE_SYSTEM_FPM=true`) because electron-builder's bundled
  one is x86_64 only.
- **Never publishes from a build.** Every build goes through the `pnpm dist`
  scripts, which pass `--publish never`, and no build job has a token that
  can write. Only `publish` has `contents: write`; every other job reads.
- **No secrets and no environment.** macOS and Windows ship unsigned for
  now, so no job reads a secret or uses the `release` environment. The mac
  job sets `CSC_IDENTITY_AUTO_DISCOVERY=false` and builds with the ad-hoc
  identity and `notarize: false` from `electron-builder.yml`. The plan for
  adding signing is under [Later: Developer ID and
  notarization](#later-developer-id-and-notarization).
- **publish** checks that the tag is `v` plus `package.json` `version`,
  runs `node scripts/checksums.mjs release` (`SHA256SUMS.txt`, `sha256sum`
  format, sorted) and `node scripts/release-notes.mjs` (section 4 "What
  changed for a user" of the highest-numbered `docs/reviews/M<n>.md`, plus
  fixed lines on first launch of the unsigned macOS and Windows builds and
  on checksums), then runs `gh
  release create --draft --verify-tag`, with `--prerelease` when the tag has
  a `-` suffix (`v0.7.0-beta.1`).
- Actions are pinned to major versions, as in `ci.yml`.
  `test/packaging/release.test.ts` runs both scripts and checks the
  workflow's triggers, `--publish never`, that no job uses a secret or an
  environment, the unsigned mac build (`CSC_IDENTITY_AUTO_DISCOVERY=false`,
  no notarization), the permissions and `--draft`. Check edits with
  `actionlint` (for example
  `uvx --with shellcheck-py --from actionlint-py actionlint`).

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
  user-facing changes only (its section 4, through
  `scripts/release-notes.mjs`).
- The tag must match `package.json`: release.yml's `publish` job fails on
  `v0.6.0` if the version is not `0.6.0`.

## Auto-update

electron-updater with the GitHub provider.

- **Install kind:** `src/main/install-kind.ts` tells them apart at launch
  (`app.info` `install`): unpackaged is `dev`; packaged macOS is `mac`;
  Windows is `nsis` when the NSIS uninstaller sits beside the exe, else
  `portable`; Linux is `appimage` when `APPIMAGE` is set, `deb` or `rpm`
  from `resources/package-type` (written by electron-builder), else
  `portable` (an unpacked build).
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
  self=$(realpath "$0")
  bin=$(cd "$(dirname "$self")" && pwd -P)
  exec "$bin/../../MacOS/Mesh UI" --cli "$@"
  ```

  It resolves its own symlink with `realpath` so it works from
  `/usr/local/bin` (on macOS before 13, which has no `realpath`, it follows
  the links with `readlink`). Source: `build/mac/mesh-ui`.
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
  exit /b %ERRORLEVEL%
  ```

  The relay (`build/win/cli-relay.js`) spawns `Mesh UI.exe --cli` (its own
  binary, without `ELECTRON_RUN_AS_NODE`) with piped stdio, so output
  reaches the console and exit codes pass through.
- The installer adds `<install dir>\bin` to the **user** `PATH` and removes it
  on uninstall (`build/win/installer.nsh`). An update keeps it. A user `PATH`
  too long for NSIS strings is left alone, with a line in the install log.
- The portable zip includes the same `bin\` folder but does not touch `PATH`.

### Linux

- deb and rpm install the app to `/opt/Mesh UI/`. Their after-install
  script copies the launcher (`build/linux/mesh-ui`, shipped as
  `resources/bin/mesh-ui`) to `/usr/bin/mesh-ui`, in place of
  electron-builder's default symlink; after-remove deletes it on removal
  but not on upgrade:

  ```sh
  #!/bin/sh
  unset DISPLAY WAYLAND_DISPLAY
  exec "/opt/Mesh UI/mesh-ui" --cli --ozone-platform=headless --disable-gpu "$@"
  ```

  Like the dev launcher (#115), it never lets the CLI reach a display
  server, even from a desktop terminal. The desktop entry still launches
  the window from `/opt`; only the launcher adds `--cli`.
- AppImage: App & account shows **Install CLI** (`app.cli.install`), which
  writes `~/.local/bin/mesh-ui` calling the AppImage path (`$APPIMAGE`) with
  `--cli`, and warns if `~/.local/bin` is not on `PATH`. If the AppImage moves
  or is replaced by an update, the button shows "Reinstall".

## Release checklist

Maintainer only; agents never add secrets, push tags or publish. No
secrets or environments are needed while macOS and Windows ship unsigned.

1. Milestone review merged by the maintainer. (Signing secrets come later;
   see [Later: Developer ID and
   notarization](#later-developer-id-and-notarization).)
2. **Dry run:** Actions, Release, Run workflow on `main` with `dry_run`.
   Expect four green build jobs (mac, win, linux-x64, linux-arm64) and a
   skipped `publish`. Check the `ui-shot-*` PNGs, and that the `dist-mac`
   zip opens on Apple silicon after **Open Anyway** and `codesign -dv`
   shows `Signature=adhoc`.
3. Bump `version` in `package.json`, commit, tag `v<version>`, push the tag.
4. `release.yml` builds (unsigned for now; macOS ad-hoc signed) and
   drafts the release with `SHA256SUMS.txt` and the review's notes. For a
   patch release, edit the notes in the draft.
5. Download one artifact per OS from the draft, install it, launch with
   `--demo`, and check the update prompt from the previous version.
6. Publish the draft.
