# Mesh UI docs

How Mesh UI works and how it should be built. [AGENTS.md](../AGENTS.md) holds the short
rules every change must follow; these docs hold the detail behind them. The approved
screens live in [mockups/](mockups/index.html).

Open questions from every doc are gathered in [open-questions.md](open-questions.md).

## Reading order

1. [architecture/overview.md](architecture/overview.md): the layers and how a command flows.
2. [architecture/commands.md](architecture/commands.md): the command spec and the full catalogue.
3. [ux/overview.md](ux/overview.md): the app shell and patterns shared by every page.
4. The page doc for whatever you are building, under [ux/pages/](ux/pages/).

## Architecture

| Doc | What it covers |
| --- | --- |
| [overview.md](architecture/overview.md) | Layers, processes and hosts, `src/` layout, config files |
| [commands.md](architecture/commands.md) | Command spec, effects, confirmation, error codes, every command by area |
| [engine.md](architecture/engine.md) | `execute`, session, caching, polling, live device rates, network switching |
| [backends.md](architecture/backends.md) | The `Backend` interface, `eero` and `demo` backends, fixtures |
| [eero-client.md](architecture/eero-client.md) | The eero HTTP client: auth and refresh, User-Agent, rate limits, API versions, errors |
| [data-model.md](architecture/data-model.md) | Mesh UI's own types and how each maps from eero responses |
| [security.md](architecture/security.md) | Threat model, token storage, process boundaries, window lockdown, audit log |
| [ui.md](architecture/ui.md) | Renderer structure, data hooks, the IPC bridge, components and charts |
| [cli.md](architecture/cli.md) | The `mesh-ui` CLI: commands, flags, output formats, exit codes, scripts |
| [mcp.md](architecture/mcp.md) | The MCP server for AI agents: tools, hints, confirmation, setup |

## Platform, testing and design

| Doc | What it covers |
| --- | --- |
| [platform/cross-platform.md](platform/cross-platform.md) | macOS, Windows and Linux differences: titlebar, keychains, paths, CLI on PATH |
| [platform/build-and-release.md](platform/build-and-release.md) | Build artifacts per OS, signing, notarization, CI matrix, versioning, auto-update |
| [testing.md](testing.md) | The sandbox rule, demo backend, fake eero server, test layout, manual checks |
| [design/design-system.md](design/design-system.md) | Themes, tokens, colour, status, cards, tables, charts, headers, confirms |

## UX

| Doc | Page |
| --- | --- |
| [ux/overview.md](ux/overview.md) | App shell, navigation, shortcuts and shared patterns |
| [ux/sign-in.md](ux/sign-in.md) | Sign in, verify code, choose network, sign out |
| [pages/overview.md](ux/pages/overview.md) | Overview |
| [pages/internet.md](ux/pages/internet.md) | Internet |
| [pages/eeros.md](ux/pages/eeros.md) | eeros |
| [pages/eero-detail.md](ux/pages/eero-detail.md) | eero detail |
| [pages/devices.md](ux/pages/devices.md) | Devices |
| [pages/device-detail.md](ux/pages/device-detail.md) | Device detail |
| [pages/profiles.md](ux/pages/profiles.md) | Profiles |
| [pages/profile-detail.md](ux/pages/profile-detail.md) | Profile detail |
| [pages/activity.md](ux/pages/activity.md) | Activity |
| [pages/guest.md](ux/pages/guest.md) | Guest network |
| [pages/wifi.md](ux/pages/wifi.md) | Wi-Fi |
| [pages/advanced-networking.md](ux/pages/advanced-networking.md) | Advanced networking |
| [pages/reservations-ports.md](ux/pages/reservations-ports.md) | Reservations & ports |
| [pages/updates-admins.md](ux/pages/updates-admins.md) | Updates & admins |
| [pages/troubleshooting.md](ux/pages/troubleshooting.md) | Troubleshooting |
| [pages/app-account.md](ux/pages/app-account.md) | App & account |
| [pages/command-palette.md](ux/pages/command-palette.md) | Command palette |

## eero API reference

Unofficial, compiled from open source clients and never verified against the live API by us.

| Doc | What it covers |
| --- | --- |
| [eero-api/endpoints.md](eero-api/endpoints.md) | About 230 endpoints, with method, body, effect and which clients use them |
| [eero-api/data-model.md](eero-api/data-model.md) | eero response shapes and fields |
