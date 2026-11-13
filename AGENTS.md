# Mesh UI

Mesh UI is an Electron desktop app for managing eero mesh networks. Its look
and feel follow T3 Code (`~/Sources/t3code`): quiet zinc surfaces, a sidebar
plus main pane, a custom titlebar, and role-based theme palettes.

## Stack

- Electron, built with electron-vite (`electron.vite.config.ts`).
- React 19 + TypeScript (strict) in the renderer.
- Tailwind CSS v4. Semantic tokens live in `src/renderer/src/index.css`.
- `@base-ui/react`, `class-variance-authority`, `tailwind-merge`, `lucide-react`.
- pnpm for packages. Do not add npm or yarn lockfiles.

## Architecture

- `src/main/` owns all network access and secrets. The eero client
  (`eero.ts`) and session storage (`session.ts`) run here only. The session
  token must never be sent to the renderer.
- `src/preload/index.ts` exposes `window.mesh`, typed by `MeshApi` in
  `src/shared/types.ts`. Add new capabilities by extending `MeshApi`, adding an
  `ipcMain` handler in `src/main/index.ts`, and wiring it in the preload.
- The main process maps raw eero responses into the shapes in
  `src/shared/types.ts`. The renderer only sees those shapes.
- `src/renderer/` is a plain React app with no Node access (context isolation
  and sandbox are on). Keep it that way.
- `MESH_UI_DEMO=1` (`pnpm dev:demo`) serves fixtures from `src/main/demo.ts`
  instead of calling eero. Keep the fixtures in step with new data you add.

## Security

The eero session token grants full control of the user's network. Rules, all
of which must hold on macOS, Windows, and Linux:

- The token lives only in the main process. Never return it over IPC or log it.
- `src/main/session.ts` is the only code that persists it. It writes only when
  `sessionStorage()` reports a real keychain (Linux `basic_text` does not
  count) and never falls back to plaintext.
- New windows or web contents inherit the lockdown in `src/main/index.ts`
  (`web-contents-created`): no off-app navigation, popups, webviews, or
  permissions. Do not loosen it to load remote content.
- Test the no-keychain path on Linux with `--password-store=basic`.

## Design and theming

- Use the semantic Tailwind tokens (`bg-background`, `bg-card`, `text-muted-foreground`,
  `border`, `bg-sidebar`, `bg-primary`, `bg-brand`, ...). Never hard-code colors.
- Themes are defined in `src/renderer/src/lib/themePalettes.ts` (ported from
  T3 Code's `packages/shared/src/themePalettes.ts`) and applied by
  `lib/themes.ts` as `--theme-*` CSS variables. To add a theme, add a
  `ThemeDefinition` and list it in `BUILT_IN_THEMES`.
- Reuse the primitives in `components/ui/`. When you need a new one, port it
  from T3 Code's `apps/web/src/components/ui/` and trim what we do not use.
- Dense UI: 14px base, `text-xs` and `text-2xs` for metadata, 8px control radius.
- The top strip of each pane is the window titlebar (`drag-region`). Interactive
  elements inside it need `no-drag`. Respect `--titlebar-inset-left/right`
  for native window controls.

## Working rules

- Run `pnpm typecheck` and `pnpm build` before calling work done.
- To see UI changes, run `pnpm dev:demo` rather than signing in to a real account.
- Keep changes small and the model simple. Prefer one clear file over layers of
  abstraction.
- Do not commit secrets, tokens, or real network data (device names, MACs, IPs).
- No emdashes in docs or UI copy.
