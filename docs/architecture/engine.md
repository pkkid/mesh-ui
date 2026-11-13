# Engine

The engine (`src/core`) owns every state change and every eero call. Each
host process creates one engine; surfaces call `execute` on it. This page
covers `execute`, the session, caching, polling intervals, live device rates,
events to the UI, network switching and rate limiting. Commands are in
[commands.md](commands.md), backends in [backends.md](backends.md), the HTTP
client in [eero-client.md](eero-client.md), the renderer side in
[ui.md](ui.md).

## Creating an engine

```ts
const engine = createEngine({
  backend: demo ? createDemoBackend() : createEeroBackend({ userAgent }),
  secrets,        // host SecretStore (Electron safeStorage)
  paths,          // { configDir } for settings.json and audit.jsonl
  surface,        // "ui" | "cli" | "mcp", recorded in the audit log
  clock,          // injectable for tests
});
```

`--demo` or `MESH_UI_DEMO=1` picks the demo backend on every surface. The
engine only knows which backend it has through `backend.kind`, reported by
`auth.status`.

## execute

```ts
execute(id: string, params?: unknown): Promise<ExecuteResult<unknown>>
```

Steps, in order:

1. Look up `id`. Missing: `unknown_command`.
2. Validate `params` (default `{}`) with the spec's zod schema. Failure:
   `bad_params` with `detail.issues`.
3. Scope check. `network` and `account` scope need a session, else
   `not_signed_in`. `auth.*` and `app.*` do not.
4. Resolve `networkId?` (default: the selected network) and every `Ref`
   param to ids, using cached lists (fetching them if cold). No match or
   several: `bad_params`.
5. Confirmation. `disruptive` or `destructive` without `confirm: true`:
   `needs_confirm` with a message from the spec's optional
   `confirmMessage(ctx, params)` or a default built from the label.
6. Queries: return the cached result if it is fresh for this
   `(id, networkId, params)`; otherwise run and cache. Sensitive queries are
   never cached.
7. Writes: run, then invalidate the spec's `invalidates` topics so the next
   query of any of them goes to the backend.
8. Map any thrown error to an error code. `execute` never throws.
9. CLI and MCP calls append an audit line (see
   [security.md](security.md#audit-log)).

Concurrency: queries run in parallel and are deduplicated (two callers
asking for the same cold key share one backend call). Writes to one network
run one at a time in call order, so a double click can not interleave two
`PUT`s.

`engine.commands()` returns the registry as JSON (id, label, effect, scope,
`sensitive`, `poll` interval, JSON Schema of params). It backs
`window.mesh.commands()`, `mesh-ui commands` and the MCP tool list.

## Session

```ts
type Session = {
  state: "signed_out" | "pending_code" | "signed_in";
  login: string | null;           // masked, for "Check your email"
  storage: "keychain" | "memory";
  accountId: string | null;
  networkId: string | null;       // selected network
};
```

The token is a private field of the session module. The eero client reads it
through a getter on every request and reports rotations back
([eero-client.md](eero-client.md#token-custody)). It never appears in
`Session`, results, events, errors or logs.

- **Startup.** The engine calls `secrets.load()`. With a token it is
  `signed_in` and loads the account lazily on the first command.
- **Sign in.** `auth.login.start` holds the unverified token in memory
  (`pending_code`). `auth.login.verify` promotes it and calls
  `secrets.save(token)`, which answers `keychain` or `memory`.
- **Refresh and rotation** happen inside the eero client: 401 with
  `error.session.refresh` refreshes once (single-flight) and replays; any new
  `s=` cookie replaces the token and is saved.
- **Two processes.** The app and a CLI or MCP process share `session.json`
  but each holds its own copy in memory. If one rotates the token, the
  other's copy can go stale. Before treating a 401 as final, the engine
  re-reads `secrets.load()`; if the stored token differs from its own, it
  adopts it and replays once. Only then does it return `not_signed_in`.
- **Session dead** (`error.session.expired`, `invalid` after refresh,
  `revoked`, other 401 or 419): clear memory and store, drop every cache
  entry, emit `session.changed`. The UI routes to sign in.
- **Sign out.** `auth.logout` clears memory and store first, then tells eero
  best effort, and drops all caches.

## Cache

One in-memory cache per engine, keyed by `topic + networkId + paramsHash`.
Each query spec names the `topic` it reads; each write lists the topics it
`invalidates`. The TTL is how long a cached result is served before the next
`execute` goes to the backend. It protects the rate budget when several
views, a CLI script or an agent ask for the same thing.

| Topic | Commands | TTL |
| --- | --- | --- |
| `account` | `account.get`, `network.list` | 10 min |
| `network` | `network.get`, `network.health`, `internet.get`, `wifi.get`, network part of `settings.get` | 30 s |
| `eeros` | `eero.list`, `eero.get` | 30 s |
| `eero_ports` | `eero.ports.get` | 30 s |
| `devices` | `device.list`, `device.get` | 30 s, 10 s while a burst is pending |
| `profiles` | `profile.list`, `profile.get` | 30 s |
| `guest` | `guest.get` | 2 min |
| `settings` | `settings.get` extras (fast transition, power saving, Thread, ac_compat) | 2 min |
| `routing` | `reservation.list`, `forward.list`, `pinhole.list` | 2 min |
| `updates` | `updates.get` | 5 min |
| `release_notes` | `updates.notes` | 6 h |
| `speedtest` | `speedtest.history` | 5 min |
| `usage` | `usage.get`, `usage.breakdown` | 4 min for day, 15 min for week |
| `events` | `events.list` first page (later pages are not cached) | 30 s |
| `notifications` | `notifications.list` | 30 s |
| `notification_settings` | `notifications.settings.get` | 10 min |
| `admins` | `admin.list` | 5 min |
| `permissions` | `network.permissions` | 10 min |
| `firmware_history` | `eero.firmware.history` | 24 h |
| `coverage` | `coverage.scan`, `coverage.upgrade_report` | 1 h |
| `diagnostics` | `health.check`, `support.info`, `support.report` | 1 min |

TTLs are a little under the poll intervals below, so a poll always reaches
the backend while two views polling the same topic share one request.

- Composite queries (`health.check`, `network.health`, `support.report`)
  read other topics through the cache and cost nothing when those are fresh.
- Sensitive results (`wifi.password.get`, `wifi.share`, `guest.share`,
  `settings.thread.credentials`) are never cached.
- After a write the invalidated topics are stale at once. Where eero is slow
  to reflect a change (device pause, profile writes), the engine waits about
  2 s before serving the next read of that topic from the backend.
- After a `disruptive` write that restarts eeros (`network.restart`,
  `eero.restart`, `updates.install`, settings that restart the mesh), the
  engine marks `network`, `eeros` and `devices` stale. The UI keeps polling
  as usual and shows the `updating` status eero reports.

## Polling intervals

Polling is driven by surfaces, not by the engine. Each query command can
declare a `poll` interval, read from the constants in `src/core/poll.ts` and
reported by `engine.commands()`. The renderer's `useQuery(..., { poll: true })`
re-executes on that interval while the window is visible
([ui.md](ui.md#data-access)); those calls hit the engine cache first. The CLI
does not poll; a long-running `mesh-ui mcp` keeps its cache between tool
calls but never polls in the background.

| Data | Commands | Poll |
| --- | --- | --- |
| Network status, health, internet | `network.get`, `network.health`, `internet.get` | 60 s |
| eeros | `eero.list`, `eero.get`, `eero.ports.get` | 60 s |
| Devices | `device.list`, `device.get` | 60 s |
| Live rates | `device.rates.refresh` then `device.list` | 60 s, only while a page shows live rates |
| Profiles | `profile.list`, `profile.get` | 60 s |
| Events | `events.list` (first page) | 60 s on the Activity page |
| Notifications | `notifications.list` | 60 s |
| Usage charts | `usage.get`, `usage.breakdown` | 5 min |
| Speed test history | `speedtest.history` | on open and after `speedtest.run` (one re-read about 60 s later) |
| Updates | `updates.get` | on open and after a write; 15 min on the Updates page |
| Settings, guest, Wi-Fi, routing, admins | `settings.get`, `guest.get`, `wifi.get`, routing lists, `admin.list` | on open and after a write |
| Firmware history, coverage, upgrade report, release notes | | on open only |
| Health check | `health.check` | on open and on "Run again" |

Busiest case (Devices page with live rates, window focused): network 1,
devices 2, profiles 1, notifications 1, burst 1: about 6 requests a minute,
far below the limit. Polls are jittered by up to 10 percent, pause while the
window is hidden, and run once to catch up when it is shown again.

## Live device rates

eero has no network-wide live history. Live rates exist only per device and
only after a burst:

1. `device.rates.refresh` calls `POST {net}/burst_reporters`. The response
   has `next_burst`, about 12 s ahead. eero allows one burst per minute per
   network; the client keeps a per-network timestamp and a second call
   inside the minute returns the pending `nextBurstAt` without calling eero.
2. The engine shortens the `devices` TTL until `next_burst` plus 2 s, so the
   next `device.list` after that point reads fresh `usage.down_mbps` and
   `usage.up_mbps`.
3. The mapper stamps each device's `rates` with the read time. Rates older
   than 90 s become `null`, which the UI shows as `-`, never `0`.
4. `DeviceList.summary.rates` sums current rates and counts active devices
   ("Throughput now 186 Mbps, 14 devices active") and computes each band's
   share of traffic, so every surface gets the same totals.

Pages that show "Now" figures (Devices, Device detail, Internet "Using the
most right now", eero detail) call `device.rates.refresh` once a minute
while visible and then poll `device.list`. Sparklines of recent rates are
built by the renderer from the last 30 samples it has seen; nothing is
stored, and there is no history to load.

## Events to the UI

Command results are the data path. The only push channel carries host
events that are not command results. The Electron host sends them on one
outbound IPC channel; preload exposes `window.mesh.onEvent(cb)`.

```ts
type HostEvent =
  | { type: "session.changed"; state: "signed_out" | "signed_in"; storage: "keychain" | "memory" }
  | { type: "network.selected"; networkId: string }
  | { type: "update.ready"; version: string };
```

- `session.changed` fires when the engine clears a dead session, when the
  user signs out, or when another process (the CLI) signed out and this
  engine notices on its next request.
- `network.selected` fires after `network.select`, so every open view
  switches together.
- `update.ready` comes from electron-updater, not the engine.
- No eero data and never the token travel on this channel.
- Desktop notifications: the renderer's `notifications.list` poll finds new
  entries and asks main to show them with Electron `Notification`, filtered
  by the desktop choices in app settings. While the window is hidden no
  polls run, so alerts wait until it is shown (open question: a slow 5 min
  background poll in main for "network offline" alerts).

## Network switching

- The selected network is `session.networkId`, persisted as
  `lastNetworkId` in `settings.json` so the app and CLI start on the same
  network. After the first sign in with several networks the UI shows the
  chooser; with one network it selects it.
- `network.select` (app-local, no eero call) sets the id, saves it, and
  emits `network.selected`. The renderer drops its query state for the old
  network and re-runs its visible queries.
- The engine cache is per network. It keeps the last two networks so
  switching back is instant; older entries are dropped.
- Every network-scoped command accepts `networkId?` (an id or a name), so a
  CLI script or agent can act on another network without changing the
  selection. `--network` in the CLI and MCP is shorthand for it.
- If the selected network disappears from the account (access removed or
  transferred), the engine selects the first remaining one and emits
  `network.selected`.

## Rate limiting

The limiter lives in the eero client; the full rules are in
[eero-client.md](eero-client.md#rate-limits). In short:

- a token bucket of 80 requests per rolling minute per process, at most 4
  in flight, writes serialised;
- 429 or `error.rate.limit` honours `Retry-After` (30 s without one); a wait
  over 20 s returns `rate_limited` with `retryAfterSec` instead of blocking;
- only `query` requests retry (after the wait, and on network errors or 5xx
  with 1 s and 4 s backoff); writes never retry, and a write that timed out
  leaves its topics stale so the next read shows the real state;
- bulk `devices: Ref[]` commands run their writes one by one through the
  bucket and stop at the first `rate_limited`, returning per-device results;
- local limits on top: `auth.login.resend` once per 60 s,
  `device.rates.refresh` once per 60 s per network, `speedtest.run` refused
  while a test is running.

The app and a CLI or MCP process have separate buckets. A long CLI script
should pace itself; the limiter still keeps each process under the budget.

The demo backend skips the limiter but adds 50 to 300 ms of simulated
latency so loading states stay visible.
