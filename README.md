# Mesh UI

A desktop app for managing [eero](https://eero.com) mesh networks. Built with
Electron, React, and Tailwind, with a look and theme system borrowed from
[T3 Code](https://github.com/pingdotgg/t3code).

> Mesh UI talks to eero's unofficial cloud API (the one the mobile app uses).
> It is not affiliated with or endorsed by eero or Amazon.

## Features

- Sign in with the email or phone on your eero account (one-time code).
- See every network on the account and the devices on each, with search and
  online/offline filters.
- Light, dark, and system appearance, plus the Default, Grove, Ocean, Ember,
  Iris, and Gruvbox Hard palettes from T3 Code.

## Getting started

Requires Node 22+ and [pnpm](https://pnpm.io).

```sh
pnpm install        # also downloads the Electron binary
pnpm dev            # run with hot reload
pnpm dev:demo       # run with fake data, no eero account needed
```

## Scripts

| Command          | What it does                                     |
| ---------------- | ------------------------------------------------ |
| `pnpm dev`       | Start the app with Vite hot reload               |
| `pnpm dev:demo`  | Same, with built-in demo networks (no sign-in)   |
| `pnpm build`     | Production build into `out/`                     |
| `pnpm start`     | Run the production build                         |
| `pnpm typecheck` | Type-check the main, preload, and renderer code  |

## Project layout

```
src/
  main/         Electron main process: window, IPC handlers, eero API client
  preload/      Exposes a typed `window.mesh` API to the renderer
  shared/       Types shared by main and renderer
  renderer/     React app (Vite + Tailwind v4)
    src/components/ui/   Primitives adapted from T3 Code (button, input, badge)
    src/features/        Screens: login, devices, settings, app shell
    src/lib/             Theme engine and palettes, utilities
```

## Privacy and security

Your eero session token gives full control of your network, so Mesh UI is
careful with it on every platform:

- It stays in Electron's main process and never reaches the UI.
- It is saved only when the OS can encrypt it with a real keychain: Keychain
  on macOS, DPAPI on Windows, and GNOME Keyring or KWallet on Linux. Without
  one (for example, Linux with no keyring running), the session is kept in
  memory and you sign in each launch. It is never written in plaintext.
- The file is written atomically with owner-only permissions.
- Signing out ends the session with eero as well as deleting it locally.
- The window cannot navigate away from the app, open popups or webviews, or
  request permissions such as camera or location.

Settings shows whether your session is saved in the keychain or held in memory.

## Credits

Theme palettes and UI primitives are adapted from T3 Code, MIT License,
Copyright (c) 2026 T3 Tools Inc.
