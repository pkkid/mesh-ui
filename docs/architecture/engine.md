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
  backend: demo ? createDemoBackend() : createEeroBackend({ secrets, userAgent }),
  settings,       // SettingsStore: fileSettings(path) or memorySettings()
  surface,        // "ui" | "cli" | "mcp"
  host,           // HostInfo: version, configDir, ...
  commands,       // optional; defaults to every spec in src/core/commands
  clock,          // injectable for tests
});
```

The host's `SecretStore` goes to the eero backend, not the engine: the
token lives in the eero client (see
[eero-client.md](eero-client.md#token-custody)).

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
3. Scope check. Every command except `app` scope and `auth.*` asks
   `backend.auth.status()` and fails with `not_signed_in` when signed out.
4. Resolve the network for `network` scope commands: the `networkId` param
   (an id or name), else the selected network if it is still in the
   account's list, else the first network, which becomes the selection
   (saved and announced with `network.selected`). No networks: `bad_params`.
   `Ref` params (eero, device, profile) are resolved by the command through
   `ctx.resolve(kind, ref)`, using cached lists (fetching them if cold). No
   match or several: `bad_params`.
5. Confirmation. `disruptive` or `destructive` without `confirm: true`:
   `needs_confirm` with a message from the spec's optional
   `confirmMessage(ctx, params)` or a default built from the label.
6. Queries: return the cached result if it is fresh for this
   `(id, networkId, params)`; otherwise run and cache. Sensitive queries are
   never cached. `execute(id, params, { fresh: true })` skips the cached
   answer and runs again (the header Refresh, Run again, Check for updates);
   the new answer replaces the cached one. Writes ignore `fresh`.
7. Writes: run (one at a time per network), then invalidate the spec's
   `invalidates` topics, also when the write failed (a write that timed
   out may still have landed). They are stale at once, and a read of them
   fetched in the next `WRITE_SETTLE_SEC` (2 s) expires when that window
   ends, so the read after it sees eero's settled state. See Cache.
8. Map any thrown error to an error code. `execute` never throws.
9. CLI and MCP calls append an audit line (see
   [security.md](security.md#audit-log)): `execute` awaits the append, so a
   CLI that exits at once keeps its line, and a failed append never fails
   the command. The default log is `audit.jsonl` in `host.configDir` for
   the `cli` and `mcp` surfaces on the live backend; the UI, demo and fake
   runs are not audited. `createEngine({ audit })` overrides it (tests pass
   `memoryAudit()`).

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

In M1 the token is a private field of the eero client, loaded from the
host `SecretStore` on first use and saved on every rotation
([eero-client.md](eero-client.md#token-custody)); the engine never holds
it. It never appears in `Session`, results, events, errors or logs.

- **Startup.** The eero client calls `secrets.load()` lazily, on its first
  session-dependent call. With a token it is `signed_in` and loads the
  account lazily on the first command.
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
  adopts it and replays once, before trying a refresh. Only then does it
  return `not_signed_in`. The eero client does this
  ([eero-client.md](eero-client.md#refresh-and-replay)).
- **Session dead** (`error.session.expired`, `invalid` after refresh,
  `revoked`, other 401 or 419): clear memory and store, drop every cache
  entry, emit `session.changed`. The UI routes to sign in.
- **Sign out.** `auth.logout` clears memory and store first, then tells eero
  best effort, and drops all caches.

## Cache

One in-memory cache per engine, keyed by
`topic|networkId|commandId|params` (params as stable JSON). Only queries
with a `topic` and a TTL above zero are cached; concurrent calls for a cold
key share one promise, and a failed load is dropped, not cached.
Each query spec names the `topic` it reads; each write lists the topics it
`invalidates`. The TTL is how long a cached result is served before the next
`execute` goes to the backend. It protects the rate budget when several
views, a CLI script or an agent ask for the same thing.

| Topic | Commands | TTL |
| --- | --- | --- |
| `account` | `account.get`, `network.list` | 10 min |
| `network` | `network.get`, `network.health`, `internet.get` | 30 s |
| `eeros` | `eero.list`, `eero.get` | 30 s |
| `eero_ports` | `eero.ports.get` | 30 s |
| `devices` | `device.list`, `device.get` | 30 s, 10 s while a burst is pending |
| `profiles` | `profile.list`, `profile.get` | 30 s |
| `guest` | `guest.get` | 30 s |
| `settings` | `settings.get` | 30 s |
| `wifi` | `wifi.get`, `wifi.impact` | 30 s |
| `integrations` | `integrations.get` | 30 s |
| `routing` | `reservation.list`, `forward.list`, `pinhole.list` | 30 s |
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
the backend while two views polling the same topic share one request. A
test (`src/core/eero/pollbudget.test.ts`) holds every polled query's TTL
under its poll; `events.summary` is the one exception (2 min on purpose:
it pages through history, and `events.list` carries the live part).

- Composite queries (`health.check`, `network.health`, `support.report`)
  read other topics through the cache and cost nothing when those are fresh.
- Sensitive results (`wifi.password.get`, `wifi.share`, `guest.share`,
  `settings.thread.credentials`) are never cached. Their eero reads also
  never take a finished 5 s shared GET (`share: false`), so a password
  changed elsewhere shows on the next reveal.
- After a write the invalidated topics are stale at once, and eero may be
  slow to reflect the change (device pause, profile writes). So the engine
  also marks them stale at `WRITE_SETTLE_SEC` (2 s, `src/core/poll.ts`)
  after the write: a read fetched inside that window is served only until
  it ends, and the next read after it goes to eero again. The renderer's
  refresh right after a write still gets an answer at once.
- `ctx.invalidate(topics, atMs)` with a future time does the same for a
  command: cached answers are served until then, and anything fetched
  before it expires at that time. `device.rates.refresh` uses it to keep
  `devices` until the burst is in.
- **Fresh reads.** `execute(id, params, { fresh: true })` is the one way to
  bypass the cache, for every query at once: no per-command flag is needed.
  The fresh load replaces the entry (so later plain reads and other views
  share it, and its TTL starts again); a failed fresh load drops the entry.
  It only skips the engine cache: the eero client may still answer a GET
  from a request finished in the last 5 s (`share`), and `ctx.resolve`
  lists stay cached. The UI uses it for Refresh (topbar button, `Ctrl+R`,
  `Cmd+R`, `F5`) and per-page Check for updates and Run again. The older
  `refresh: true` params of `health.check` and `coverage.scan` still work
  for the CLI and MCP, which have no option for it.
- A backend `not_signed_in` clears the whole cache and emits
  `session.changed`.
- After a `disruptive` write that restarts eeros (`network.restart`,
  `eero.restart`, `updates.install`, settings that restart the mesh), the
  engine marks `network`, `eeros` and `devices` stale. The UI keeps polling
  as usual and shows the `updating` status eero reports.

## Polling intervals

Polling is driven by surfaces, not by the engine. Each query command can
declare a `poll` interval, read from the constants in `src/core/poll.ts` and
reported by `engine.commands()`. The renderer's `useQuery(..., { poll: true })`
re-executes on that interval while the view is mounted and the window is
visible ([ui.md](ui.md#data-access)); those calls hit the engine cache
first. Readers of the same id and params share one timer (`pollQuery`) at
the shortest interval any of them asks for, so a query shown by five
components reaches the engine once per interval, and a reader that mounts
later does not restart the countdown. Every read a page keeps on screen
polls, so a change made in the eero app shows within about a minute
(M5.R-fix9); only rarely changing or expensive reads wait for open, a
write or Refresh. The CLI
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
| Reservations, forwards, IPv6 rules | `reservation.list`, `forward.list`, `pinhole.list` | 60 s on Reservations & ports and device detail (the eero app changes them too) |
| Usage charts | `usage.get`, `usage.breakdown` | 5 min |
| Speed test history | `speedtest.history` | on open and after `speedtest.run` (one re-read about 60 s later) |
| Updates | `updates.get` | on open and after a write; 15 min on the Updates page |
| Settings, integrations, guest, Wi-Fi | `settings.get`, `integrations.get`, `guest.get`, `wifi.get` | 60 s (M5.R-fix9: Simple Setup, power saving, Thread and the rest change in the eero app too) |
| Admins, permissions, networks | `admin.list`, `network.permissions` | on open and after a write (roles and owners rarely change); `network.list` 60 s from the network switcher, served from its 10 min cache |
| Account | `account.get` | 5 min (TTL 4.5 min): name, verification and push choices change in the eero app too |
| App info, CLI and agent log | `app.info`, `app.audit.list` | 60 s on App & account and the sidebar's update chip; no eero calls (update state, and CLI runs from another process) |
| Session | `auth.status` | not polled: it follows `session.changed` events |
| App settings | `app.settings.get` | not polled: only written through commands, which answer with the new settings |
| Weekly device joins | `events.summary` (week) | on open: a week's count moves slowly and pages through history (kept 2 min on purpose) |
| Notification settings, impact, Thread credentials | `notifications.settings.get`, `settings.impact`, `wifi.impact`, `settings.thread.credentials` | on open (dialogs and confirms; credentials never cached) |
| Firmware history, coverage, upgrade report, release notes | | on open only |
| Health check | `health.check` | on open and on "Run again" (a fresh read) |

**Request budget.** `src/core/eero/pollbudget.test.ts` keeps each page
open for ten minutes against the fake eero server, runs every poll due each
minute through the engine and the real eero client with no read sharing
(an upper bound: real polls are jittered and often share reads), and counts
requests. Measured at M5.R-fix9, typical minute / busiest minute (when the 5
minute usage polls and the 10 minute account read line up):

| Page | Requests a minute |
| --- | --- |
| Overview | 31 / 64 |
| eero detail | 29 / 50 |
| Reservations & ports | 39 / 49 |
| Troubleshooting | 26 / 36 |
| Devices (live rates on) | 23 / 37 |
| Wi-Fi | 21 / 31 |
| Guest | 17 / 40 |
| Advanced networking | 14 / 24 |
| App & account (M6.1) | 7 / 18 |

The test fails if a typical minute goes over 40 or any minute over 70, under
the client's 80 a minute limiter and eero's limit of about 100. One poll of
`settings.get` costs 5 requests, `wifi.get` and `guest.get` 4,
`integrations.get` 1. Polls are jittered by up to 10 percent, stretch to 5
minutes while the window is hidden, and run once to catch up when it is
shown again.

## Live device rates

eero has no network-wide live history. Live rates exist only per device and
only after a burst:

1. `device.rates.refresh` calls `POST {net}/burst_reporters`. The response
   has `next_burst`, about 12 s ahead. eero allows one burst per minute per
   network; core (not the eero client) keeps a per-network timestamp
   (`commands/device.ts`) and a second call inside `BURST_COOLDOWN_SEC`
   returns the pending `nextBurstAt` without calling eero.
2. The command marks `devices` stale at `next_burst` plus
   `BURST_SETTLE_SEC` (2 s) with `ctx.invalidate`, so the next
   `device.list` after that point reads fresh `usage.down_mbps` and
   `usage.up_mbps`, while reads before it share the cache.
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
outbound IPC channel; preload exposes `window.mesh.on(listener)`, which returns an
unsubscribe. Main forwards `engine.onEvent` to it (`src/main/ipc.ts`).

```ts
type HostEvent =
  | { type: "session.changed"; state: "signed_out" | "signed_in"; storage: "keychain" | "memory" }
  | { type: "network.selected"; networkId: string }
  | { type: "update.changed"; status: UpdateStatus };
```

- `session.changed` fires when the engine clears a dead session, when the
  user signs out, or when another process (the CLI) signed out and this
  engine notices on its next request.
- `network.selected` fires after `network.select`, so every open view
  switches together.
- `update.changed` comes from the window host's updater (M6.5), not the
  engine, whenever the update state changes (found, downloading, ready).
- No eero data and never the token travel on this channel.
- Desktop notifications: the renderer's `notifications.list` poll finds new
  entries and asks main to show them with Electron `Notification`, filtered
  by the desktop choices in app settings. While the window is hidden no
  polls run, so alerts wait until it is shown (open question: a slow 5 min
  background poll in main for "network offline" alerts).

## Network switching

- The selected network is held by the engine (`engine.selectedNetworkId()`),
  read lazily from and persisted as `lastNetworkId` in `settings.json` so the app and CLI start on the same
  network. With no valid selection the engine falls back to the first
  network, and sign in does the same: it opens the last used network if the
  account still has it, else the first, via `network.select`. There is no
  chooser; switching is the sidebar's network switcher.
- `network.select` (app-local, no eero call) sets the id, saves it, and
  emits `network.selected`. The renderer drops its query state for the old
  network and re-runs its visible queries.
- The engine cache is keyed per network and keeps the last
  `CACHE_NETWORKS` (2) networks used, so switching back is instant; using a
  third drops the entries of the least recently used one. Account-wide
  entries (`network.list`) are kept regardless.
- Every network-scoped command accepts `networkId?` (an id or a name), so a
  CLI script or agent can act on another network without changing the
  selection. `--network` in the CLI and MCP is shorthand for it.
- If the selected network disappears from the account (access removed or
  transferred), the next network-scoped command without `networkId` selects
  the first remaining one and emits `network.selected`.

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

The demo backend skips the limiter. It is meant to add 50 to 300 ms of
simulated latency so loading states stay visible; not yet built in M1.
