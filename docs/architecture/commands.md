# Commands

Everything a person can do in Mesh UI is a command. The UI, the CLI and the
MCP server list the same registry and call the same `engine.execute`. This
page defines the command spec and lists every command. Endpoint details come
from [../eero-api/endpoints.md](../eero-api/endpoints.md) (the research copy is
`notes/api-endpoints.md`), the per-request rules from
[eero-client.md](eero-client.md); the engine side is in [engine.md](engine.md)
and result types are in [data-model.md](data-model.md).

## The spec

```ts
type Effect = "query" | "write" | "disruptive" | "destructive";

type CommandSpec<P extends z.ZodTypeAny, R> = {
  id: string;                 // "device.pause"
  label: string;              // "Pause device", English UI label
  description?: string;       // one or two sentences for the palette, `mesh-ui commands` and the MCP tool
  icon?: string;              // lucide icon name for the palette and menus ("pause")
  params: P;                  // zod schema, also the JSON Schema for CLI and MCP
  effect: Effect;
  scope?: "network" | "account" | "app"; // default "network"
  topic?: Topic;              // query: cache topic it reads (engine.md)
  gate?: WriteGate;           // write: what it needs to run here; required for every non-query command
  invalidates?: Topic[];      // write: topics to refresh after success
  sensitive?: true;           // result contains a password or key
  poll?: number;              // query: poll interval in seconds, from src/core/poll.ts
  confirmMessage?(ctx, params): Promise<string>;       // disruptive and destructive: the needs_confirm message
  confirmWhen?(ctx, params): Promise<string | null>;   // write: the needs_confirm message when this run would take devices offline
  run(ctx: CommandContext, params: z.infer<P>): Promise<R>;
};
```

Field notes (this is the one place they are defined):

- `description`: plain English, says what happens and to whom ("Pauses
  internet for the device. It stays connected to Wi-Fi."). It becomes the
  MCP tool description and the `mesh-ui commands` help. For `disruptive` and
  `destructive` commands it names the outage or loss.
- `icon`: a lucide icon name. Core stores only the string; the renderer maps
  it to the component. Optional; the palette falls back to the area icon.
- `sensitive`: the result holds a credential (Wi-Fi or guest password, Thread
  key). See [Effects](#effects) for how surfaces treat it.
- `gate` (`WriteGate` in `src/core/spec.ts`): what a write needs to run on
  this network: `area`, the `network.permissions` `can` key (`devices`,
  `eeros`, `profiles`, `settings`, `network`, or a dotted key such as
  `network.proxied_nodes`) or `null` for none, resolved by `permissionFor`
  (an area eero does not send inherits `network`; see
  [data-model.md#permissions](data-model.md#permissions)); `op`
  (`create`, `update` default, `delete`); `bridgeOff: true` when it is off in
  bridge and IP passthrough mode; `capability`, a `network.get` capability
  that must be true. Every write, disruptive and destructive command declares
  one (`{ area: null }` when nothing limits it, as for sign-in and app-local
  settings); `src/core/spec.test.ts` fails otherwise. The registry lists it
  as `gate` (defaults filled in, `null` for queries) in `mesh-ui commands`,
  the MCP tool list and `window.mesh.commands()`, and the palette and pages
  dim from it ([ui.md](ui.md), Gates). Destructive commands are also owner
  only. The engine and eero still have the last word.
- `poll`: how often a visible view re-runs this query, in seconds. Values
  come from the one table in `src/core/poll.ts` ([engine.md](engine.md#polling-intervals)). The
  renderer polls on it; the CLI and MCP do not poll.

- `run` returns plain JSON-serialisable model data (`src/core/model.ts`),
  never a raw eero response.
- `ctx` gives the command `ctx.backend`, `ctx.session` (signed-in state,
  selected network), `ctx.resolve` (names to ids), `ctx.settings` and
  `ctx.now()`. Commands never call `fetch`.
- One file per area in `src/core/commands/<area>.ts`. A file exports an
  array of specs; `registry.ts` collects them and fails at startup on a
  duplicate id.

## Naming

- Ids are dotted lowercase: `area.verb` or `area.object.verb`
  (`network.list`, `device.pause`, `settings.dns.set`). Multi-word parts use
  `snake_case` (`settings.band_steering.set`, `coverage.upgrade_report`).
- Verbs: `list`, `get` (read one), `set` (replace a value), `add`, `update`,
  `remove` (list members), `create` and `delete` (owned objects), plus plain
  verbs for actions (`pause`, `resume`, `restart`, `run`, `share`).
- The id names the object, not the page. A file may hold ids from more than
  one prefix (`admins.ts` holds `admin.*` and `network.transfer`; `internet.ts`
  holds `internet.*`, `speedtest.*`, `usage.*`).
- MCP tool names replace dots with underscores: `profile.pause` becomes
  `profile_pause`.
- Labels are short sentence case English, the same text the command palette
  shows ("Pause profile", "Restart network").

## Params conventions

- `networkId?: Ref` on every network-scoped command. It defaults to the
  selected network ([engine.md](engine.md#network-switching)). The CLI and
  MCP `--network <id or name>` flag is shorthand for it.
- Object params take a `Ref`: an id or an exact, case-insensitive name.
  `device`, `eero`, `profile`, `schedule`, `reservation`, `forward`,
  `pinhole`, `admin`, `invite`. A name that matches more than one object
  fails with `bad_params` and lists the matches. This is what makes
  `{"profile": "Leo"}` work from the palette, CLI and agents.
- Bulk actions take an array: `devices: Ref[]` (1 to 50). The command runs
  the writes one at a time under the rate limiter and returns one entry per
  device, so a partial failure is visible.
- `confirm?: boolean` is added by the registry to every `disruptive` and
  `destructive` schema (required in the MCP input schema, see
  [mcp.md](mcp.md#tools)). Only `true` passes. Commands never declare it
  themselves.
- Times are `"HH:MM"` 24-hour strings in the network time zone; dates are
  ISO 8601 UTC strings; durations are whole minutes; rates are Mbps;
  volumes are bytes.
- `range: "day" | "week"`. There is no month: free accounts get about 7 days
  of usage. Speed test history is the exception: eero keeps about a year of
  tests, so `speedtest.history` takes `range: "week" | "month" | "all"`.
- Query commands that feed an "Export CSV" button take
  `format?: "json" | "csv"`. CSV is built in `src/core/format.ts` so every
  surface exports the same columns.

## Effects

| Effect | Meaning | Confirm | MCP hints |
| --- | --- | --- | --- |
| `query` | Reads only. Safe to repeat. | no | `readOnlyHint: true`, `idempotentHint: true` |
| `write` | Changes something reversible without taking any device offline. | no | `readOnlyHint: false`, `destructiveHint: false` |
| `disruptive` | Restarts eeros or takes any device offline, even briefly (reboot, DNS, DHCP, Wi-Fi password, guest off, pausing or blocking a device or profile). Reversible. | `confirm: true` | `destructiveHint: true` |
| `destructive` | Cannot be undone (delete account or profile, remove eero, remove admin, transfer network, reset Thread). | `confirm: true` | `destructiveHint: true` |

`sensitive: true` queries also say in their MCP description that the result
contains a credential, and the CLI masks them unless `--reveal` is passed
([security.md](security.md#sensitive-results)). Full MCP annotations,
including `openWorldHint`, are in [mcp.md](mcp.md#tools). Choosing an effect: if any eero client has
seen the call restart the mesh or drop clients, it is `disruptive`, even
when it usually does not. A command that takes a device offline on purpose
(pause, block) is `disruptive` too; the command that brings it back (resume,
unblock) stays a `write`.

## Confirmation

- The engine checks before `run`: if the effect is `disruptive` or
  `destructive` and `params.confirm !== true`, it returns
  `{ ok: false, error: { code: "needs_confirm", message } }`. The message says
  what will happen ("Restarts every eero on Maple Street. Devices lose
  internet for about 2 to 3 minutes.") so the CLI and agents can show it.
  Estimates come from [Restart estimates](#restart-estimates).
- The UI shows its confirm dialog (with type-the-name for `destructive`
  actions on a named thing), then calls again with `confirm: true`.
- **Writes that take devices offline only sometimes** stay `write` and
  declare `confirmWhen`: the engine runs it before `run` (unless
  `confirm: true`) and answers `needs_confirm` with its message when this run
  would take a device offline, otherwise it just runs. The registry adds an
  optional `confirm` param and `confirmsWhenOffline: true` to the command
  info; the MCP tool lists `confirm` as optional and says when it is needed.
  Today: `device.profile.set` and `profile.devices.set` (a device joins a
  paused profile, or one with a scheduled pause on now, or leaves to a
  paused Unassigned), and `profile.schedule.add` and `.update` (the window
  covers now and its devices are online). Validation (`bad_params`) runs before
  the question.
- CLI: `--confirm`. Script lines: `"params": { ..., "confirm": true }`. MCP:
  the agent must pass `confirm: true` itself; the server never adds it.
- `confirm` is never remembered. Each call confirms on its own.
- Sign-in commands (`auth.login.*`) and `app.cli.install` are not exposed as
  MCP tools; agents use the session the person created ([mcp.md](mcp.md#tools)).

## Results and error codes

```ts
type ExecuteResult<R> =
  | { ok: true; result: R }
  | { ok: false; error: { code: ErrorCode; message: string; detail?: ErrorDetail } };

type ErrorDetail = {
  status?: number;        // HTTP status from eero
  eeroError?: string;     // meta.error, e.g. "error.eero.offline"
  retryAfterSec?: number; // for rate_limited
  matches?: { id: string; name: string }[]; // ambiguous Ref
  issues?: { path: string; message: string }[]; // zod issues
};
```

| Code | When |
| --- | --- |
| `unknown_command` | No spec with that id. |
| `bad_params` | zod validation failed, a `Ref` matched nothing or several things, or a value is out of range (password length, port range). |
| `needs_confirm` | `disruptive` or `destructive` without `confirm: true`. |
| `not_signed_in` | No session, or the session is dead (`error.session.expired`, `invalid`, `revoked`) after a refresh attempt. |
| `rate_limited` | Local budget exhausted or eero answered 429 / `error.rate.limit`. `detail.retryAfterSec` set. |
| `eero_error` | eero answered with an error envelope: 402, 403 (no permission), 404 / 405 (not on this network or firmware), `error.eero.offline`, `error.eero.not.capable`, validation codes. `detail` holds status and `meta.error`. |
| `network_error` | Timeout, DNS failure, TLS error, no connectivity. |

Messages are short, plain English and safe to show. They never include the
token, cookies, raw response bodies or request headers.

## Catalogue

Notation: `{net}` is the network `url`, `{eero}`, `{device}`, `{profile}`
are object urls, all taken from eero responses or `resources.*` links rather
than built by hand. Effects: q query, w write, d disruptive, x destructive.
Every network-scoped command also accepts `networkId?`. Commands marked
**(added)** are not in the original brief and were added for a mockup.

### auth (`commands/auth.ts`, scope account)

| id | label | params | effect | eero endpoint(s) | notes |
| --- | --- | --- | --- | --- | --- |
| `auth.status` | Session status | `{}` | q | none | `{ signedIn, pending, login?, storage: "keychain" \| "memory", backend: "eero" \| "demo" }`. Never the token. |
| `auth.login.start` | Send sign-in code | `{ login: string }` email or E.164 phone | w | `POST /2.2/login` | Keeps the unverified `user_token` in the session. Phone normalised to E.164 in core. |
| `auth.login.verify` | Verify code | `{ code: string }` 4 to 10 digits | w | `POST /2.2/login/verify`, then `GET /2.2/account` | Adopts a rotated token from `Set-Cookie` or `data.user_token`. Saves via `SecretStore`. Wrong code keeps the pending token and returns `eero_error`. |
| `auth.login.resend` | Resend code | `{}` | w | `POST /2.2/login/resend` | Engine refuses more than once per 60 s (`rate_limited`). |
| `auth.login.amazon` | Sign in with Amazon | `{}` | w | host Amazon window → `POST /2.2/login/amazon` → `GET /2.2/account` | Window-only (`HOST_ONLY` on CLI/MCP; not an MCP tool). Private BrowserWindow runs OpenID+PKCE; host returns an Amazon access token to the command; eero commit only after account identity verifies. `create_account=false`. Failed attempts leave a previous session untouched. Not exposed to MCP. |
| `auth.logout` | Sign out | `{}` | w | `POST /2.2/logout` | Best effort; local session and file are cleared even if eero is unreachable. |

### account (`commands/account.ts`, scope account)

Every account write is applied by demo and by the fake eero server (the
exact requests below are tested there). Against the real eero API they
answer `eero_error` "not available yet": no live-tested client sends them
and nothing was captured ([endpoints.md section 20](../eero-api/endpoints.md#20-real-captures-and-write-sources-for-m6-2026-11-14)).
Codes are params named `code`, removed from the audit log; no result
echoes them. `account.push.set` also invalidates `notification_settings`.

| id | label | params | effect | eero endpoint(s) | notes |
| --- | --- | --- | --- | --- | --- |
| `account.get` | Account | `{}` | q | `GET /2.2/account` | `Account` model. Email and phone as returned (eero masks some). Polled every 5 min (TTL 4.5 min). |
| `account.name.set` | Edit name | `{ name: string(1..64) }` | w | `PUT /2.2/account/name` form `name` | Returns the `Account` read again. |
| `account.email.set` | Change email | `{ email: string }` | w | `PUT /2.2/account/email` form `email` | Pending until verified: the new address reads `verified: false`. Returns the `Account`. |
| `account.email.verify` | Verify email | `{ code: string }` 6 digits | w | `POST /2.2/account/email/verify` form `code` | `eero_error` when no change waits for a code or the code is wrong. Returns the `Account`. |
| `account.phone.set` | Change mobile | `{ phone: string }` E.164 | w | `PUT /2.2/account/phone` form `phone` | E.164 (`+15550100142`), else `bad_params`. Returns the `Account`. |
| `account.phone.verify` | Verify mobile | `{ code: string }` 6 digits | w | `POST /2.2/account/phone/verify` form `code` | As email verify. |
| `account.consents.set` | Email preferences | `{ marketingEmails: boolean }` | w | `PUT /2.2/account/consents` form `marketing_emails` | Returns the `Account`. |
| `account.push.set` | Phone push alerts | `{ networkOffline?: boolean, nodeOffline?: boolean }` (at least one) | w | `PUT /2.2/account/push_settings` JSON | eero wants every key; the command merges with the account's current values (`bad_params` when eero sent none and a key is missing). |
| `account.delete` | Delete account and data | `{ acknowledge: true }` | x | `DELETE /2.2/account` | Signs out afterwards (`session.changed`). `acknowledge` mirrors the mockup checkbox; `confirm` is still required. Refused with `bad_params` before any confirm while the account owns a network, or has one whose role eero did not send ("Transfer or delete them before deleting the account."). Returns `{ deleted: true }`. Never run on the real network. |

Every account write has gate `{ area: null }`, invalidates `account` and is
built in demo (M6.1). The eero backend answers "not available yet" for all
of them: no live-tested client sends any of these requests
([endpoints.md section 20](../eero-api/endpoints.md#20-real-captures-and-write-sources-for-m6-2026-11-14)),
so each stays out of the eero backend until one is found (M6.7).

### network (`commands/network.ts`)

| id | label | params | effect | eero endpoint(s) | notes |
| --- | --- | --- | --- | --- | --- |
| `network.list` | Networks | `{}` | q | `GET /2.2/account` (`networks.data`), fallback `GET /2.2/networks`; `GET {net}` per network for status | Scope account. `NetworkSummary[]` with role, eero count, online devices, status, selected flag. |
| `network.select` | Switch network | `{ network: Ref }` | w | none (app-local) | Sets the selected network in the session and `settings.json`. See engine.md. |
| `network.get` | Network | `{}` | q | `GET {net}` | `Network` model: name, nickname, status, counts, capabilities, timezone. `counts.profiles` is the number of profiles `profile.list` lists (eero's default profile left out). |
| `network.health` | Network health | `{}` | q | `GET {net}` (`health`, `eeros.data`, `updates`); `GET {net}/eeros` and `GET {net}/devices` only when an issue needs them | `NetworkHealth`: internet, mesh, per-eero status, weak links, banner messages, and `issues` built in core: `network_offline` (alone, every known device), else `eero_offline` per offline eero (devices last on it) then `weak_link` per weak wireless eero that is not offline (its upstream and the devices connected through it). A healthy network stays one call. |
| `network.permissions` | Permissions | `{}` | q | `GET {net}/permissions` | `Permissions` model. UI disables controls the role cannot use. |
| `network.nickname.set` | Network nickname | `{ nickname: string(0..32) }` | w | `PUT {net}/label?labelType=specialMarket` form `label`, then `GET {net}` | Built in M6.9. Eeronaut sends it (quoting eero's Android client) and reads `nickname_label` back ([endpoints.md section 20](../eero-api/endpoints.md#20-real-captures-and-write-sources-for-m6-2026-11-14)). Trimmed; an empty nickname clears it (sends an empty `label`; no client clears it, MANUAL check). Unchanged sends nothing. The nickname before and after the write is read from `network.list` (which also reads the account's `networks.data[].nickname_label`, #270), falling back to `GET {net}`. If the read after the write shows another nickname, `eero_error` ("eero accepted the nickname but still reports ..."). Returns `{ networkId, nickname }`. Gate `network`. Invalidates `account`, `network`. |
| `network.restart` | Restart network | `{}` | d | `POST {net}/reboot` empty-JSON (`resources.reboot` when known) | Every eero restarts, about 2 to 3 minutes offline (see [Restart estimates](#restart-estimates)). Confirm: "Restarts every eero on Maple Street at once. Everyone loses internet for about 2 to 3 minutes.", the same sentence as the Restart network row. Returns `{ eeroIds, estimate }`, the reachable (not offline) eeros that restart. Invalidates network, eeros. |
| `network.delete` **(added)** | Delete network | `{ networkName: string }` | x | `DELETE {net}` | Built (M5.3). Owner only: gate `network`, op `delete`, and core refuses a network whose role is admin (a real network often reports no role, so eero has the last word). `networkName` must equal the current name exactly (type-to-confirm, like `network.transfer`). Afterwards the session selects another network, or none. Invalidates every network topic and `account`. Advanced networking danger zone. |

### internet, speed tests and usage (`commands/internet.ts`)

| id | label | params | effect | eero endpoint(s) | notes |
| --- | --- | --- | --- | --- | --- |
| `internet.get` | Internet connection | `{ format?: "json" \| "text" }` | q | `GET {net}` (`geo_ip`, `ip_settings`, `lease`, `wan_type`, `gateway_ip`, `connection`, `ipv6_lease`, `dns`, `speed`), gateway from `GET {net}/eeros` | `Internet` model: ISP, public IPs, WAN type, lease renew time (`lease.dhcp.renews_on`, else `expires_on`; field unverified), double NAT, DNS in use, gateway port speed, plan speed from app settings, and the hero `verdict` built in core from status, last test and plan (`down` "... is down", `steady` "... is fast and steady" or just the ISP name ("Internet" if unknown) without a test or plan, `slow` "... is slower than your plan"). `format: "text"` returns the plain-text block for "Copy details". |
| `speedtest.run` | Run speed test | `{}` | w | `POST {net}/speedtest` (`resources.speedtest`; empty JSON, 202) | Returns `SpeedTestRun { networkId, startedAt, resultAt }` (`resultAt` = start + 60 s). Invalidates `speedtest` and `network` now, and again at `resultAt`. One test at a time per network, shared by every process on one config dir (the app and a CLI, M6.10): another start answers `rate_limited` (`retryAfterSec` to the 3 minute give-up) until a `speedtest.history` read sees a result dated from the start (10 s clock skew allowed) and newer than any result read before the start, or 3 minutes pass. The eero backend (live or fake) with a config dir keeps the lock in `<configDir>/locks/speedtest-<network id>.json`, `{since, after}` in engine-clock ms, written to a temp file and hard-linked into place so taking it is atomic; an expired or unreadable file counts as free, and an eero refusal frees it. Demo, and any engine with no config dir, keep it in memory. While a test runs, a history read without its result is cached for only 5 s. Uses the WAN for about 30 s. |
| `speedtest.history` | Speed test history | `{ range?: "week" \| "month" \| "all", limit?: 1..200, format? }` | q | `GET {net}/speedtest?startTime&endTime&limit` | `SpeedHistory`: `SpeedTest[]` newest first for the last 7 days (default), 30 days or everything eero keeps (about a year; eero returns at most 100 tests per read), 7-day averages whatever the range, and `running` (the `SpeedTestRun` still waiting for its result, else null; the UI adopts it so a test started from the palette or before a reload shows as running). `format: "csv"` is the Export CSV button. |
| `usage.get` | Data usage | `{ scope: "network" \| "eero" \| "device" \| "profile" \| "guest", id?: Ref, range: "day" \| "week" \| "month", cadence?: "hourly" \| "daily" }` | q | network `GET {net}/data_usage`; eero `.../data_usage/eeros/{id}`; device `.../data_usage/devices/{mac}`; profile `.../data_usage/profiles/{id}`; guest: sum of `.../data_usage/devices` rows for guest devices | `UsageSeries`. `month` is the current calendar month from the 1st (network time, today partial), like the eero app's Month view; free accounts get it (checked 2026-11-19). Default cadence hourly for day, daily for week and month; week plus hourly feeds the "busy hours" heatmaps. eero's daily chart has no bucket for the day in progress, so a daily series that stops before today gets one more `cadence=hourly` call from local midnight, summed into a partial today point; if that call fails, today is left out and `todaySoFar` is null (shown as `-`). Query params only, never a GET body. Without `id`, `eero` and `profile` scopes return one series per eero or profile; the profile scope adds an Unassigned ("Other devices") series. |
| `usage.quiet_hours` **(added)** | Quietest hours | `{ range?: "day" \| "week" (default week), start?: 0..23 }` | q | `GET {net}/data_usage?cadence=hourly` (same call as `usage.get`) | `QuietHours`: average bytes per hour of day in network time (the hour in progress left out; an hour with no sample is null), the quietest 3-hour window (wraps past midnight, earliest start on a tie), the busiest hour, and with `start` the mean of that window (`selected`). No traffic at all: quietest and busiest are null. Used by Updates (preferred update time). Built in core. |
| `internet.plan.set` **(added)** | Set internet plan | `{ down: number, up: number, label?: string } \| { clear: true }` Mbps (more than 0, at most 100,000; label up to 40 characters) | w | none (app-local) | Stored per network in `settings.json`; `internet.get` returns it as `planMbps`. Returns the `PlanSpeed`, or null after clear. Invalidates `network` and `speedtest`. Gauges and verdicts compare against it. One object schema: a missing `down` or `up`, or `clear` with either, is `bad_params`. No eero call, so admins can set it too. |
| `usage.breakdown` | Usage breakdown | `{ range: "day" \| "week", by: "device" \| "profile" \| "eero", profile?: Ref, top?: 1..100, format? }` | q | `GET {net}/data_usage/breakdown`; `by: "eero"` uses `GET {net}/data_usage/eeros` | `UsageBreakdown`, rows sorted by total, with share of network. `eero` option added for the Overview "By eero" list. `profile` limits `by: "device"` rows to one profile (Profile detail). `top` keeps the largest rows and folds the rest that used data into a last row `{ id: null, name: "Others (n)" }` (Internet By device). By profile, every row's id is a `profile.list` id, except one Unassigned row `{ id: null, name: "Unassigned" }` (the rest of the network, plus any row whose id `profile.list` does not have, such as eero's default profile). eero's profile rows are `{profile_id, profile_name, upload, download}` (real capture, 2026-11-13). |

### eero (`commands/eero.ts`)

| id | label | params | effect | eero endpoint(s) | notes |
| --- | --- | --- | --- | --- | --- |
| `eero.list` | eeros | `{}` | q | `GET {net}/eeros` (`resources.eeros`), `GET {net}` | `Eero[]` with topology (`upstream`, `meshBars`), clients, bands. `GET {net}` gives the LAN facts: `subnet` from custom DHCP (`dhcp.custom.subnet_ip`/`subnet_mask` as CIDR; null in automatic mode, which does not say the range), `gatewayIp` the gateway eero's `ip_address` (null in bridge or passthrough mode). |
| `eero.get` | eero | `{ eero: Ref }` | q | `GET {eero}`, `GET {net}` | `Eero` plus radios (tx power from `radio_channel_stats.tx_power`) and BSSIDs. `gatewayIp` and `subnet` fall back to the `eero.list` values. `autoChannel` stays null: no eero field for it has been seen (`{net}/radio_settings` carries only `enabled` per band, M5.1 capture). |
| `eero.rename` | Rename eero | `{ eero: Ref, location: string(1..32) }` | w | `PUT {eero}` form `location` | Trimmed. Returns the `Eero`. Invalidates eeros, network, eero_ports. |
| `eero.restart` | Restart eero | `{ eero: Ref }` | d | `POST resources.reboot` empty-JSON (201) | Restarting the gateway takes the network down; downstream eeros drop too. Message says which: "Living Room is the gateway: restarting it takes Maple Street offline. ..." or "Restarts Office. Its devices drop for about 1 minute. Garage connects through it and drops too." Returns `{ eeroIds, estimate }` (this eero and those through it, or all for the gateway; offline ones left out). Invalidates eeros, network. |
| `eero.led.set` | Status light | `{ eero: Ref, on?: boolean, brightness?: 0..100 }` | w | `PUT resources.led_action` form `led_on` / `led_brightness` | JSON PUT to `{eero}` is a silent no-op; always use the `led_action` link. At least one of `on` and `brightness` (else `bad_params`); only the given field is sent. Invalidates eeros. |
| `eero.find` | Blink light | `{ eero: Ref, seconds?: 10..60 }` default 30 | w | `POST /2.2/eeros/{serial}/led_cycle` form `colors[]=blue&colors[]=white&duration&time_per_color=1` (the eero id if it has no serial) | Harmless. Returns `{ eeroId, seconds }`. No `stop`: no stop endpoint is known, so the UI hides Stop until one is verified (open question). Invalidates nothing. |
| `eero.nightlight.set` | Nightlight | `{ eero: Ref, mode: "off" \| "ambient" \| "schedule", brightness?: 0..100, on?: "HH:MM", off?: "HH:MM" }` | w | `PUT {nightlight.url}` (normally `{eero}/nightlight/settings`) JSON `{enabled, brightness_percentage, schedule{enabled, on, off}}` | eero Beacon only; others fail `bad_params` from capability check (the eero reports no `nightlight`). Fields not given keep their current value. Invalidates eeros. |
| `eero.ports.get` | Ethernet ports | `{ eero: Ref }` | q | `GET {eero}`, `GET resources.connections`; `GET {net}/devices` and `GET {net}/eeros` only when a port has a neighbor | `EeroPorts`: per port status, speeds in Mbps (`negotiated_speed` `"P2500"` to 2500, `"P10G"` to 10000; null when the link is down), PoE, MAC, `attachments` (everything behind the port, several behind a switch, eeros first; joined by MAC, then by link; an entry eero sends without link or name still counts) and `attached`, their one-line summary built in core (`portSummary`: the eero, else the only device, else "N devices"), allowed `actions[]`. Ports sorted by number; empty list when eero reports none. Polls every 60 s. |
| `eero.port.action` | Port action | `{ eero: Ref, port: 1..64, action: PortAction }` | d | `POST {eero}/ports/{n}/action` JSON `{action}`, then `eero.ports.get` | Gate `eeros.update`. Only an action listed in that port's `actions[]` is accepted; an unlisted action or unknown port is `bad_params` before any confirm or write ("Port 1 on Office does not allow RESTART_POWER. It allows DISABLE_PORT."). Confirm names everything plugged in: "Turns off port 3 on Living Room. Living Room TV and Hue Bridge lose their wired connection." (and any eero behind it "may go offline"). Returns the `EeroPorts` as the next read shows them; Undo is the opposite action (`INVERSE_PORT_ACTION`), confirmed again. Invalidates eero_ports, eeros, devices, network. |
| `eero.firmware.history` | Firmware history | `{ eero: Ref, limit?: 1..200 }` (default 20) | q | `GET {eero}`, `GET /2.2/eeros/{id}/firmware_update/history?limit=50&offset=0`, then `offset=50`, ... while `meta.has_more` (at most 10 pages) | `FirmwareEntry[]` newest first (sorted in core: eero may send oldest first, so it reads every page and trims), `current` on the newest entry matching the eero's `os_version`. 404 or 405 gives an empty list. Only LD uses it; MANUAL check of shape. |
| `eero.remove` | Remove eero | `{ eero: Ref }` | x | `DELETE {eero}` | Gate `eeros.delete` (owner only). Refuses the gateway with `bad_params` unless it is the only eero, before any confirm ("Living Room is the gateway. Remove the other eeros first, or replace the gateway in the eero app."). Confirm names the eeros that lose their uplink; the UI asks the person to type the eero's name. Returns `{ networkId, eeroId, location }`. Invalidates eeros, network, eero_ports, devices, usage. |
| `eero.placement.test` | Test placement | `{ eero: Ref }` | w | `GET {eero}` (serial), `POST` then `GET /2.3/networks/{id}/placement_test/{serial}` (unshared, every 3 s until not running; `eero_error` after 2 minutes) | `/2.3/` only. Lives in `commands/coverage.ts` (eero backend: `backend/coverage.ts`, merged into the eero area). Returns `PlacementResult`; the rating is read from `rating`, `placement_rating` or `result.rating`, as a word or a 1 to 5 / 0 to 100 number, and advice from `advice` or `recommendation`. Shape not captured (a write): MANUAL check. Gate `eeros`. Invalidates `coverage`. |
| `coverage.scan` | Coverage scan | `{ refresh?: boolean }` | q | `GET /2.4/networks/{id}/placement/wifi_coverage_scan?allDevices=true` | `/2.4/` only, `commands/coverage.ts`. `CoverageScan`: eero answers device rows split into `healthy_devices` and `unhealthy_devices` (real capture 2026-11-14, an instant read). Core groups them by their eero (`source.url`) into rooms: quality is the mean device link score 0 to 100 (`connectivity.score` times 100, or `score_bars` times 20), devices the count; eeros with no wireless device are added with no quality; `servedBy` is the eero's upstream from `eero.list`; `scannedAt` is the read time (eero sends none); each unhealthy device becomes one advice line. Rooms weakest first. `refresh: true` is never cached ("Scan again"). Topic `coverage`. |
| `coverage.upgrade_report` | Upgrade report | `{}` | q | `GET /2.4/networks/{id}/placement/wifi_generation_scan?allDevices=true` | `/2.4/` only, `commands/coverage.ts`. `UpgradeReport`: devices per Wi-Fi generation (every generation listed, newest first). eero groups device rows under a numeric `wifi_version` (real capture 2026-11-14); core counts the rows, and a Wi-Fi 6 device on 6 GHz counts as 6E. eero names no limiting eero, so `limitingEeros` is empty; one note says how many devices support a newer version than the eeros (`network_wifi_version`). Topic `coverage`. |

`PortAction` = `ENABLE_PORT | DISABLE_PORT | ENABLE_DATA | DISABLE_DATA |
ENABLE_POE | DISABLE_POE | RESTART_POWER`. Node-wide
`POWER_CYCLE_ALL_PORTS` is not exposed yet.

### device (`commands/device.ts`)

| id | label | params | effect | eero endpoint(s) | notes |
| --- | --- | --- | --- | --- | --- |
| `device.list` | Devices | `{ status?: "online" \| "offline" \| "paused" \| "blocked", connected?: boolean, paused?: boolean, blocked?: boolean, ssid?: "main" \| "guest", eero?: Ref, profile?: Ref \| null, band?: Band \| "wired", type?: DeviceCategory, manufacturer?: string, newSince?: string, search?: string, sort?: "name" \| "usage" \| "rate" \| "last_seen" \| "profile" \| "eero" \| "band" \| "signal" \| "ip" \| "status", order?: "asc" \| "desc", limit?: number, format? }` | q | `GET {net}/devices` (`resources.devices`), `GET {net}/blacklist`, `GET {net}/profiles`, `GET {net}/notifications_history` (New Device notices, one read cached a minute per network) | `DeviceList`: devices (each live `rates` with `sharePct`, its share of current traffic) plus summary (counts by status, band, category; live rate totals, and per band the rate totals, `trafficPct` and `devicePct` with `topBand`, the busiest Wi-Fi band, for the band insight line; `newThisWeek`, the devices eero announced with a New Device notification, category `device.new`, in the last 7 days, newest first, and `newestAt`, when the newest was announced). New this week does not use the device's `firstSeen` (eero's `first_active`), which restarts whenever a device rejoins after a while away or the eeros restart; a failed notifications read gives none new and the list still loads. `newSince` keeps devices announced at or after that time. The summary always covers the whole network, not just the filtered rows, so the Status dropdown and the Filters popover keep their counts (see [devices.md](../ux/pages/devices.md)). `sort` (default `name`) and `order` back the table's header sort: each key has a natural direction used when `order` is left out (name, profile, eero, band, ip and status ascending; usage, rate, last_seen and signal descending). `profile` and `eero` sort by name, `band` as 2.4, 5, 6, wired, `signal` by bars then dBm, `ip` numerically, `status` as online, paused, blocked, offline. Missing values (Unassigned, no eero, offline band and signal, no IP, no rate or usage) sort last in either order, and ties fall back to name A to Z. `summary.total` is every known device, and `network.get` `counts.devices` (the sidebar count) is the same number. `status` is the Status dropdown's shorthand: `online` = connected (paused included), `offline` = not connected and not blocked. Offline devices older than 7 days are dropped (blocked ones stay). `profile: null` lists devices with no profile (Unassigned): devices on eero's own default profile, which `profile.list` leaves out, have `profileId: null` here and in `device.get`. eero's device list leaves out profile members that have been offline a while; they come from their profile's `devices[]`, offline, in that profile and with no last seen, so a profile lists every member the eero app shows (M5.R-fix6). |
| `device.get` | Device | `{ device: Ref }` | q | `GET {device}`, then `GET {net}/routing` for its reservation (matched on MAC; none in bridge mode or when routing fails) | `Device` with connectivity details, its reservation and `ipv6LinkLocal` (the fe80:: address eero lists among `ipv6_addresses`, kept out of `ipv6`). Forwards come from `forward.list {device}`. |
| `device.rates.refresh` | Refresh live rates | `{}` | w | `POST {net}/burst_reporters` empty-JSON, then `GET {net}/devices` after `next_burst` | At most once a minute per network; a second call inside the window returns the pending `nextBurstAt` without calling eero. `nextBurstAt` is when the figures land: eero's `next_burst` or the POST plus 12 s, whichever is later (eero's `next_burst` is about the POST time). Marks `devices` stale at each of `burstReadTimes` (every 4 s through the burst's live window). See engine.md. |
| `device.pause` | Pause device | `{ devices: Ref \| Ref[] }` (1 to 50) | d | `PUT /2.3/networks/{id}/devices/{mac}` JSON `{paused: true}` | `/2.3/` required: `/2.2/` returns 200 and drops the change. Returns `DeviceBulkResult`: the changed devices and `failed[]` (`device` as given, `id`, `name` (the device's display name, read once from the device list only when something failed; null when that read fails or sign-in or a rate limit stopped the run), `code`, `message`) for each one eero refused; when every device fails, the first error is the command's error. Unknown refs fail the whole call with `bad_params` before anything is sent. Invalidates `devices`, `network`, `profiles`. Disruptive: the device goes offline, so it needs `confirm`; the message names the devices. |
| `device.resume` | Resume device | `{ devices: Ref \| Ref[] }` | w | same, `{paused: false}` | As `device.pause`. |
| `device.rename` | Rename device | `{ device: Ref, nickname: string(0..32) }` | w | `PUT /2.3/networks/{id}/devices/{mac}` JSON `{nickname}` | An empty nickname sends `null`, so the device follows its own name again (MANUAL check that eero clears it). Returns the `Device`. Also invalidates `usage` (breakdown names). |
| `device.type.set` | Set device type | `{ device: Ref, type: DeviceType }` | w | `PUT /2.3/networks/{id}/devices/{mac}` JSON `{device_type}` | `type` is one of eero's `device_type` values in `DEVICE_TYPES` (`src/core/eero/map/device.ts`, the Appearance grid's 32 entries). FF verified the write on `{net}/devices/{mac}`; we use `/2.3/` per the device-write rule (MANUAL). |
| `device.profile.set` | Change profile | `{ devices: Ref \| Ref[], profile: Ref \| null }` | w | `PUT /2.3/networks/{id}/devices/{mac}` JSON `{profile: {url}}` | `null` is Unassigned: every real device has a `profile`, and "no profile" is eero's `default: true` profile, so the backend reads `GET {net}/profiles` and sends that profile's url. The default profile is never accepted as a `profile` ref. Returns `DeviceBulkResult`. Asks first (`confirmWhen`) when the run would take devices offline. |
| `device.block` | Block device | `{ devices: Ref \| Ref[] }` | d | `POST {net}/blacklist` form `mac` (with colons) | Kicks it off every eero until unblocked. Returns `DeviceBulkResult`. Disruptive: needs `confirm`; the message names the devices and the network. |
| `device.unblock` | Unblock device | `{ devices: Ref \| Ref[] }` | w | `DELETE {net}/blacklist/{mac}` (compact MAC, no body) | Returns `DeviceBulkResult`. |

### profile (`commands/profile.ts`)

| id | label | params | effect | eero endpoint(s) | notes |
| --- | --- | --- | --- | --- | --- |
| `profile.list` | Profiles | `{}` | q | `GET {net}/profiles` (schedules from each profile's `schedule[]`) | `ProfileList`: `Profile[]` with state, device counts and next schedule, all computed in core in the network time zone. State: `paused` for a manual pause, else `scheduled` when an enabled schedule exists (or eero says so), else `active`. Also returns an `unassigned` summary (device ids, online count, paused state and the default profile's schedules; it is not a profile and has no id) and `today`: the date, zone and minute it was computed, and one lane per profile plus Unassigned (`profileId: null`) of `PauseSegment`s in minutes after midnight (today's schedule spans, the end of yesterday's overnight ones, and a manual pause from now to the next scheduled start or midnight). |
| `profile.get` | Profile | `{ profile: Ref }` | q | `GET {profile}` | `profile: "unassigned"` gives Unassigned (eero's `default: true` profile, found in `GET {net}/profiles`) as id `unassigned`, name Unassigned, with the list's devices and pause and the default profile's schedules. `ProfileDetail`: `Profile` with devices and schedules, plus `today` (date, zone, minute and this profile's `PauseSegment`s, as in `profile.list`), so profile detail can draw a manual pause. Schedules come from the profile's own `schedule[]`: `GET {profile}/schedules` is a 404 on a real network although `resources.schedules` names it ([endpoints.md section 17](../eero-api/endpoints.md)). |
| `profile.create` | Add a profile | `{ name: string(1..32), devices?: Ref[] }` | w | `POST {net}/profiles` JSON `{name, paused: false, devices: [{url}]}` | Names are trimmed and unique (case-insensitive, since names are refs): a taken name is `bad_params` on `name`. |
| `profile.rename` | Rename profile | `{ profile: Ref, name: string(1..32) }` | w | `PUT {profile}` JSON `{name}` | Same name rule as create. |
| `profile.pause` | Pause profile | `{ profile: Ref }` | d | `PUT {profile}` JSON `{paused: true}` | Lasts until resumed. eero has no timed pause, so Mesh UI offers none and the engine keeps no resume timers. Disruptive: needs `confirm`; the message says how many devices go offline. |
| `profile.resume` | Resume profile | `{ profile: Ref }` | w | `PUT {profile}` JSON `{paused: false}` | During a scheduled pause, eero keeps the profile online until the next schedule. |
| `profile.devices.set` | Profile devices | `{ profile: Ref, devices: Ref[] }` | w | `PUT {profile}` JSON `{devices: [{url}]}` | Replaces the whole list. Asks first (`confirmWhen`) when the run would take devices offline. |
| `profile.delete` | Delete profile | `{ profile: Ref }` | x | `DELETE {profile}` | Devices become unassigned, schedules go, pause lifts. The `needs_confirm` message names the profile and its device count; result `{deleted, name}`. |
| `profile.schedule.add` | Add a scheduled pause | `{ profile: Ref, name: string, days: Day[], start: "HH:MM", end: "HH:MM", enabled?: boolean }` | w | `POST {profile}/schedules` JSON `{name, days, start, end, enabled}` | The three schedule commands also take `profile: "unassigned"`, which writes to the default profile's `{profile}/schedules` (MANUAL check on a real network). `end` before `start` wraps past midnight; `end` equal to `start` is `bad_params` on `end`. Names are unique within the profile (`bad_params` on `name`). Days sent as "Monday".."Sunday" in week order (eero refuses `MON` and `monday` with `error.form.enum.invalid`, per Eeronaut; M5.R-fix7 MANUAL check). Result: the `Schedule`; when eero answers without it, it is read back from the profile. Asks first (`confirmWhen`) when the run would take devices offline. |
| `profile.schedule.update` | Edit schedule | `{ profile: Ref, schedule: Ref, name?, days?, start?, end?, enabled? }` | w | `PUT {profile}/schedules/{id}` JSON, every field | `schedule` is an id or exact name within the profile (unknown is `bad_params` on `schedule`). Fields left out keep their value; the full schedule is sent. Result: the `Schedule`. Asks first (`confirmWhen`) when the run would take devices offline. |
| `profile.schedule.remove` | Delete schedule | `{ profile: Ref, schedule: Ref }` | w | `DELETE {profile}/schedules/{id}` | Result `{removed, schedule}` (the removed schedule, so Undo can add it back). |
| `profile.unassigned.pause` **(added)** | Pause unassigned devices | `{}` | d | `PUT {default profile}` JSON `{paused: true}` (the `default: true` row of `GET {net}/profiles`); a network without one (eeroOS before 7.12.4) gets `PUT /2.3/networks/{id}/devices/{mac}` `{paused: true}` per unprofiled device | Profiles page, Unassigned page and palette. Disruptive: needs `confirm`; the message counts the devices and warns about TVs, printers and smart home gear. Result `{paused}`. |
| `profile.unassigned.resume` **(added)** | Resume unassigned devices | `{}` | w | same, `{paused: false}` | Resumes every unassigned device (eero keeps one pause flag on its default profile, so there is nothing per device to track). |

Every profile write invalidates `profiles`, `devices` and `network`. The
default profile is never a `Profile`: refs to it (by id or by the name
"Unassigned") fail with `bad_params` on every profile command.

Unassigned devices are handled by `profile.unassigned.pause` and
`.resume`, `device.list {profile: null}` and `device.profile.set` with
`profile: null`. There is no reserved "unassigned" profile id. On a real
network (2026-11-13) eero returns its own Unassigned group as a profile with
`default: true` that holds every unprofiled device; the eero backend leaves it
out of the profile list, so its devices count as Unassigned in `profile.list`
and the usage Unassigned series. The eero app
can schedule pauses for its Unassigned group (eeroOS 7.12.4+), but no client
we studied shows the endpoint, so Mesh UI leaves Unassigned schedules out.

Writing `schedule`, filters or blocked apps onto the profile object is a
silent no-op (FF); schedule writes go through `{profile}/schedules` (POST,
PUT, DELETE per the clients; unverified, since the GET there is a 404).
Reads always take the profile's own `schedule[]`.

### guest (`commands/guest.ts`)

M3 shipped `guest.get` and `guest.share`; M4 adds the writes. Each write
invalidates `guest` and `devices` and answers with the new `GuestNetwork`
(never the password). The disruptive ones' `needs_confirm` message names the
guests they drop ("1 guest is disconnected right away. ..."). Guest usage is
`usage.get` `{scope: "guest"}`: core adds up the per-device series of every
guest online during the window, on both backends (eero has no guest usage
endpoint).

| id | label | params | effect | eero endpoint(s) | notes |
| --- | --- | --- | --- | --- | --- |
| `guest.get` | Guest network | `{}` | q | `GET {net}/guestnetwork`, `GET {net}/devices` (`is_guest`), `GET {net}/wpa3_per_band`, `GET {net}/eeros` (6 GHz radios) | `GuestNetwork` without the password (`hasPassword` only), plus online guest count (0 while off) and every guest seen in the last 7 days. Security per band is the main network's; none when open; 6 GHz is WPA3 when an eero has the radio. Polled every 60 s (TTL 30 s, M5.R-fix9). |
| `guest.enable` | Turn on guest network | `{}` | w | `PUT {net}/guestnetwork` form `enabled=true` | Keeps the current name and password; rename separately (while off it drops nobody). |
| `guest.disable` | Turn off guest network | `{}` | d | `PUT {net}/guestnetwork` form `enabled=false` | Drops every guest. |
| `guest.rename` | Rename guest network | `{ name: string(1..32), trimmed }` | d | `GET {net}/guestnetwork`, then `PUT {net}/guestnetwork` form `enabled=<current>&name` | Must differ from the main SSID, ignoring case: `bad_params` on `name`, checked in core before the confirm. `enabled` repeats the current state (the clients always send it). Guests must rejoin. |
| `guest.password.set` | Set guest password | `{ password: string(8..63, printable ASCII) \| null }` | d | `PUT {net}/guestnetwork/password` form `password`; `null`: `DELETE {net}/guestnetwork/password`, no body | `null` makes the guest network open (its confirm says so). The password is removed from the audit log; messages never echo it. `passwordStrength` (same file) feeds the page's meter. |
| `guest.share` | Share guest Wi-Fi | `{}` | q, sensitive | `GET {net}/guestnetwork` (the password is in the clear there) | `WifiShare`: ssid, password (null when open), security (`WPA` or `nopass`), and the `WIFI:T:WPA;S:...;P:...;;` (open: `WIFI:T:nopass;S:...;;`) payload for the QR, with `\`, `;`, `,`, `:` and `"` escaped. Never cached or polled. An unnamed guest network is an `eero_error`. |

### wifi (`commands/wifi.ts`)

| id | label | params | effect | eero endpoint(s) | notes |
| --- | --- | --- | --- | --- | --- |
| `wifi.get` | Wi-Fi | `{}` | q | `GET {net}` (`name`, `wpa3`, `temporary_flags`), `GET {net}/wpa3_per_band` (404 on older firmware: the `wpa3` switch stands in), `GET {net}/eeros` (`bands`, `radio_channel_stats`), `GET {net}/devices` | `WifiSettings`: SSID, security per band (6 GHz always WPA3; a band no eero has is null and left out of `bands`), bands with clients, widths, channels (5 GHz low and high both kept), the 2.4 GHz only flag and its expiry. No password. Topic `wifi`, polled every 60 s (TTL 30 s). `wpa2OnlyDevices` is an estimate: devices whose link used WPA2 on a band offering WPA2 + WPA3. |
| `wifi.health` **(added)** | Signal | `{}` | q | none of its own: `device.list` and `eero.list` | `WifiHealth`: connected wireless devices that report a signal, per signal quality (excellent at -55 dBm or better, good to -65, fair to -75, weak below; `SIGNAL_DBM`) with the median dBm, overall and per band; median and best link speed (download) per band; the 5 weakest devices with their band and eero; a histogram of devices per 5 dBm from -90 to -40 (ends open); devices per Wi-Fi generation (7, 6E, 6, 5, 4, unknown; from the link standard, Wi-Fi 6 on 6 GHz counted as 6E); each eero (model, devices) with one entry per radio by band (channel, width, channel utilisation, transmit power, devices; 5 GHz low and high are two entries) and the busiest radio. A snapshot: eero keeps utilisation history for eero Plus only. Topic `devices`, polled every 60 s. Signal page. |
| `wifi.password.get` | Reveal Wi-Fi password | `{}` | q, sensitive | `GET {net}` (`password`, in the clear) | `{ ssid, password }`; `password` null on an open network. Only on explicit reveal or copy. Never cached. |
| `wifi.name.set` | Rename Wi-Fi | `{ name: string }` 1 to 32 bytes (UTF-8), not blank, not the guest network's name | d | `PUT {net}/settings` form `name` | `WifiSettings`. Every wireless device must reconnect; the `needs_confirm` message is the `wifi.impact` summary. Invalidates `settings`, `network`. |
| `wifi.password.set` | Change Wi-Fi password | `{ password: string(8..63) }` printable ASCII | d | `PUT {net}/password` form `password` | `WifiSettings`, never the password. Main network can not be made open; `DELETE {net}/password` is not exposed. The audit log removes `password`; a reveal right after reads eero again (credential bypass). Invalidates `settings`. |
| `wifi.security.set` | Change Wi-Fi security | `{ band24?: Security, band5?: Security, band6?: "WPA3" }` at least one of 2.4 and 5 | d | `PUT {net}/wpa3_per_band` JSON with only the bands given (`band_2_4_ghz`, `band_5_ghz`) | `Security` = `WPA2 \| WPA2_WPA3 \| WPA3`. 6 GHz is always WPA3: `band6` accepts only `WPA3` and is never sent. A band no eero has is `bad_params`. eero restarts to apply it (estimate about 2 to 3 minutes, unverified). Result `WifiSettings` with `wpa2OnlyDevices`. Invalidates `settings`, `guest`. |
| `wifi.hide5g.set` | Connect 2.4 GHz only devices | `{ enabled: boolean }` | d | on: `PUT {net}/temporary_flags/hide_5g` JSON `{value: true}`; off: `DELETE` same, no body | Effect changed from the brief's `write` to `disruptive`: it moves every 5 and 6 GHz client. eero expires it on its own (`temporary_flags.hide_5g.expires_on`, surfaced as `hide5g.expiresAt` for the countdown); the write takes no duration and the engine keeps no timer, so there is no `minutes` param. Turn it off sooner with `enabled: false`. Replaces the palette mockup's old `wifi.band24_only.start`. Invalidates `settings`, `devices`. |
| `wifi.impact` **(added)** | Impact of a Wi-Fi change | `{ change: "name" \| "password" \| "security" \| "hide5g", band24?: Security, band5?: Security }` (bands for `security` only, at least one) | q | none of its own: `wifi.get` and the device list | `WifiImpact`: connected wireless devices that must reconnect, WPA2 only devices that would drop on a move to WPA3, smart home devices that may need their own app (estimate), guest and wired affected, the restart estimate, and a `summary` that is also each write's `needs_confirm` message. Topic `settings`. Wi-Fi page, before the confirm dialog. The estimate lives in `commands/wifi.ts` until `src/core/impact.ts` exists (M5). |
| `wifi.password.generate` **(added)** | Generate password | `{ length?: 12..63 }` default 16 | q | none | Random password from core: letters and digits without look-alikes (no `0 O 1 I l`), at least one upper case letter, lower case letter and digit, from the crypto RNG. App scope, so it works signed out; never cached. Not saved; the UI fills the field and the person still saves with `wifi.password.set` or `guest.password.set`. Not `sensitive`: it is not a password in use. |
| `wifi.share` | Share Wi-Fi | `{}` | q, sensitive | `GET {net}` (`name`, `password`) | `WifiShare` for the QR and copy buttons: `qr` is `WIFI:T:WPA;S:<ssid>;P:<password>;;` (`T:nopass` when open) with `\ ; , : "` escaped, built in core (`wifiShare` in `commands/guest.ts`, shared with `guest.share`). Only on "Show code" or copy. Never cached. |

### settings (`commands/settings.ts`)

FF saw a DNS write and a DHCP write through `PUT {net}/settings` reboot
every eero for about 8 minutes. Every settings command reads first and skips
the write when nothing changed, and is never retried. The M5.2 writes also
refuse NAT-only settings (`bad_params`, "off in bridge mode") when the
network is bridged or in IP passthrough, and a disruptive one whose change
changes nothing confirms with "Nothing changes, so nothing restarts.".

| id | label | params | effect | eero endpoint(s) | notes |
| --- | --- | --- | --- | --- | --- |
| `settings.get` | Network settings | `{}` | q | `GET {net}` (shared), `GET {net}/fast_transition`, `GET {net}/power_saving/schedules`, `GET {net}/thread`, `GET {net}/ac_compat` | `NetworkSettings`. Power saving on/off comes from the network object (`GET {net}/power_saving` is a 404). A 403, 404 or 405 on one of the extra reads is null (not on this network), never an error: Thread is null on a network without it. Thread secrets are never mapped; the command also strips any field outside the Thread model before caching. `devices` (Thread accessories) is always null: eero does not report it. `simpleSetup` is true only for `ZTS`; `LTS`, `DEFAULT` and `OFF` are false, anything else null (M5.R-fix3: a real network reads `LTS` while eero's app says Off). Polled every 60 s with a 30 s TTL (M5.R-fix9), so a change made in the eero app shows within about a minute. |
| `settings.dns.set` | Change DNS | `{ mode?: "automatic" \| "custom", servers?: string[] (1..4, IPv4 or IPv6), ipv6Servers?: string[] (0..2, IPv6), caching?: boolean }` | d | `PUT {net}/settings` JSON `{dns: {mode, caching, custom: {ips}}, ipv6: {name_servers: {mode, custom}}}` | Built (M5.2). Omitted fields keep the current value; automatic sends no servers; custom needs one. Also the Local DNS caching toggle (`{caching}` alone): there is no separate `settings.dns_cache.set`, because caching is a field of the same `dns` object and SX's `PUT {net}/dns` alternative is just as disruptive. Gate `settings`, off in bridge mode. Invalidates `settings`, `network`. |
| `settings.dhcp.set` | Change DHCP range | `{ mode: "automatic" \| "custom", subnetIp?, subnetMask?, startIp?, endIp? }` | d | `PUT {net}/settings` JSON `{dhcp: {mode: "automatic"}}` or `{dhcp: {mode: "custom", custom: {subnet_ip, subnet_mask, start_ip, end_ip}}}` | Built (M5.2). Custom needs all four; `dhcpProblem` checks a private (RFC 1918) network address with a /16 to /29 mask, and a pool after the gateway (first address) and before broadcast, start not after end. Gate `settings`, off in bridge mode (bridge itself is `settings.connection_mode.set`). Invalidates `settings`, `network`, `routing`, `devices`. |
| `settings.ipv6.set` | Turn IPv6 on or off | `{ enabled: boolean }` | d | `PUT {net}/settings` JSON `{ipv6_upstream}` | Built (M5.2). Gate `settings`, off in bridge mode. Invalidates `settings`, `network`. |
| `settings.wan.set` | Change ISP settings | `{ mode: "dhcp" \| "static" \| "pppoe", static?: { ip, mask, router }, pppoe?: { username, password }, vlan?: number(1..4094) \| null }` | d | `PUT {net}/settings` JSON `{lease: {mode, static?}, pppoe: {enabled, credentials?}, vlan: "" \| "201"}` | Built (M5.2). `static` only with static mode (`wanStaticProblem`: router in the IP's subnet, neither the network nor broadcast address, IP and router differ), `pppoe` only (and always) with PPPoE; `vlan` omitted keeps the tag, null turns it off. Credentials go in the settings body (LD); FF's `POST {eero}/pppoe` encrypted blob is not used (MANUAL check). The PPPoE password is never cached, returned or logged (the audit log removes it). Wrong values take the network offline. Gate `settings`, off in bridge mode. Invalidates `settings`, `network`. |
| `settings.connection_mode.set` | Change connection mode | `{ mode: "nat" \| "bridged" \| "ipPassthrough" }` | d | `PUT {net}/settings` JSON `{connection: {mode}}` | Built (M5.2). The confirm lists what bridge turns off (DHCP, profiles, pausing, reservations, port forwards, UPnP, SQM, custom DNS). Gate `settings` (not off in bridge mode: it is the way back). Invalidates `settings`, `network`, `routing`, `devices`, `profiles`, `integrations`. |
| `settings.nat_randomization.set` **(added)** | Change NAT port mode | `{ randomized: boolean }` | d | `PUT {net}/settings` JSON `{nat_port_randomization}` | Built (M5.2). Advanced networking "Direct / Randomized". A network that does not report it (null) is `bad_params`; no capability gate, since the demo and fake fixtures lack the `nat_port_randomization` capability a real network sends. Gate `settings`, off in bridge mode. Invalidates `settings`, `network`. |
| `settings.upnp.set` | Turn UPnP on or off | `{ enabled: boolean }` | w | `PUT {net}/settings` JSON `{upnp}` | Built (M5.2). Applies live; the UI offers Undo. Gate `settings`, off in bridge mode. Invalidates `settings`. |
| `settings.sqm.set` | Optimize for conferencing and gaming | `{ enabled: boolean }` | w | `PUT {net}/settings` JSON `{sqm}` | Built (M5.2). Applies live; the UI offers Undo. Gate `settings`, off in bridge mode. Invalidates `settings`. |
| `settings.band_steering.set` | Turn client steering on or off | `{ enabled: boolean }` | w | `PUT {net}/settings` JSON `{band_steering}` | Built (M5.3). Skips an unchanged value; null (not reported) is `bad_params`. Gate `settings`. Invalidates `settings`. |
| `settings.fast_transition.set` | Turn fast roaming on or off | `{ enabled: boolean }` | d | `PUT {net}/fast_transition` JSON `{fast_transition}` | Built (M5.3). Gate `settings`. Invalidates `settings`. Disruptive: turning it on can keep older devices from connecting. |
| `settings.mlo.set` | Change multi-link operation | `{ mode: "disabled" \| "single" \| "multi" }` | d | `PUT {net}/mlo_mode` JSON `{mlo_mode}` | Built (M5.3). A network without `mlo_mode` (null) is `bad_params`. Restarts the network (see [Restart estimates](#restart-estimates)); the confirm is its `settings.impact` summary. Gate `settings`. Invalidates `settings`, `network`, `wifi`. |
| `settings.power_saving.set` | Change power saving | `{ enabled?: boolean, scheduleEnabled?: boolean }` (at least one) | w | `PUT {net}/power_saving` JSON `{enable?, power_saving_schedule_enabled?}` | Built (M5.3). Sends only the fields that change. Gate `settings`. `enabled` needs the `power_saving` capability: when `network.get` reports it false (a gateway without power saving; a real network answers `enable` with 403), `bad_params` "Your eero hardware does not support power saving." and nothing is sent. Since M5.R-fix9 `scheduleEnabled` is refused the same way (eero answers 200 there, but the eero app hides the section and the schedules do nothing). Invalidates `settings`. |
| `settings.power_schedule.add` **(added)** | Add power saving schedule | `{ name (1..32), days: Day[], start, end (HH:MM), enabled? }` | w | `POST {net}/power_saving/schedules` JSON `{name, days: ["Monday", ...], start_time, end_time, enabled}` | Built (M5.3). Renamed from `settings.power_saving.schedule.add`: ids have at most three parts. End before start wraps past midnight; start and end must differ; names are unique. Network without power saving: `bad_params`; hardware eero reports not `power_saving` capable: `bad_params` with the hardware reason, before eero is called (M5.R-fix9). Days go as capitalized full names: `MON` and "monday" answer 400 `error.form.errors` (M5.R-fix4, from Eeronaut's live check; MANUAL check). Gate `settings`. Invalidates `settings`. |
| `settings.power_schedule.update` **(added)** | Edit power saving schedule | `{ schedule: id or name, name?, days?, start?, end?, enabled? }` | w | `PUT {net}/power_saving/schedules/{id}` (same body) | Built (M5.3). Omitted fields keep their value. Days as `.add`. Refused like `.add` on hardware without power saving (M5.R-fix9). Gate `settings`. Invalidates `settings`. |
| `settings.power_schedule.remove` **(added)** | Delete power saving schedule | `{ schedule: id or name }` | w | `DELETE {net}/power_saving/schedules/{id}` | Built (M5.3). Returns the removed schedule (the UI's Undo adds it back). Allowed on hardware without power saving, so old schedules can be cleaned up (M5.R-fix9). Gate `settings`, op `delete`. Invalidates `settings`. |
| `settings.legacy_mode.set` **(added)** | Turn legacy device mode on or off | `{ enabled: boolean }` | d | `PUT {net}/ac_compat` form `enabled` | Built (M5.3). Troubleshooting "Connect devices that can't detect Wi-Fi 6" and Advanced networking. Restarts the network. Gate `settings`. Invalidates `settings`, `network`, `wifi`. |
| `settings.timezone.set` **(added)** | Change time zone | `{ timezone: string }` IANA | d | demo only; the eero backend answers "not available yet" (M6.9) | Built (M5.3); the Wi-Fi page edits it (TimezoneSheet). Schedules follow it. If the read after the write still shows another zone, `eero_error` ("eero accepted the time zone but still reports ..."), never a result that looks saved. **Not sent to eero since M6.9:** `PUT {net}/settings` JSON `{timezone: {value}}`, the only request any client sends, answered 200 on a real network and kept the old zone (M5.R-fix4, M5 review), and no client has tested a time zone write live ([endpoints.md section 20](../eero-api/endpoints.md#20-real-captures-and-write-sources-for-m6-2026-11-14)). The Wi-Fi page dims it on the eero backend. Gate `settings`. Invalidates `settings`, `network`, `profiles`. Disruptive (#360): every schedule shifts at once, so it always asks; the message says so and names devices a schedule takes offline right away. |
| `settings.simple_setup.set` **(added)** | Turn eero Simple Setup on or off | `{ enabled: boolean }` | w | `PUT {net}/auto_setup_mode` JSON `{mode: "ZTS" \| "DEFAULT"}` | Built (M5.3, fixed M5.R-fix3). As eero's own app does (per Eeronaut): on sends `ZTS`, off sends `DEFAULT`, which eero stores as `LTS`. Only `ZTS` reads as on. If the read after the write still shows the old value, fails with `eero_error` (eero answers 200 to writes it ignores). MANUAL check. Gate `settings`. Invalidates `settings`. |
| `settings.thread.set` | Change Thread | `{ enabled?: boolean, credentialSync?: boolean }` (at least one) | d | `enabled`: `PUT {thread}/enable` JSON `{enabled}` (SX, Eeronaut); `credentialSync`: `PUT {thread}` JSON `{enable_credential_syncing}` | Built (M5.3, fixed M5.R-fix3: `thread_enable` on `{thread}` answers 200 and changes nothing on a real network). No Thread: `bad_params`. If the read after the write still shows the old value, fails with `eero_error`. The UI asks before turning Thread off. Gate `settings`. Invalidates `settings`. Disruptive: turning Thread off takes accessories off their border router. |
| `settings.thread.credentials` **(added)** | Reveal Thread credentials | `{}` | q, sensitive | `GET {net}/thread` | Built (M5.3). `{networkKey, pskc, dataset}` (a real network sends no dataset: null). Not cached; results are never in the audit log; the CLI table masks them without `--reveal`. Only on Reveal or Copy. |
| `settings.thread.reset` | Regenerate Thread credentials | `{}` | x | `POST {net}/thread` (empty) | Built (M5.3). Every Thread device must re-pair. The UI confirms in the dialog with type-the-name (the Thread network name). Gate `settings`. Invalidates `settings`. |
| `settings.impact` **(added)** | Impact of a settings change | `{ changes: { id: string, params?: object }[] }` (1 to 20, ids of writes) | q | `GET {net}/devices` (backend device list) | `SettingsImpact`: per change (`ChangeImpact`) whether every eero restarts, the estimate (from the table below), who drops (`all`, `wireless`, `thread`, `port`, `none`) and the online devices that drop, plus the longest estimate, devices online, every dropped device once and a `summary` that is each disruptive write's `needs_confirm` message. An id with no row is `bad_params`; `params` are accepted for later and do not change the estimate yet. Topic `settings`, cached 30 s. Built in core (`IMPACT` and `settingsImpact` in `commands/settings.ts`; `impactOf(ctx, id)` for confirm messages). Whether this computer is behind the network is not reported: core cannot tell yet. |

### Restart estimates

Core owns every outage estimate in one table, `IMPACT` in
`src/core/commands/settings.ts` (restart copy from `RESTART_ESTIMATE` in
`commands/network.ts`; the Wi-Fi security estimate in `commands/wifi.ts`
reads its row). `settings.impact` returns them, `needs_confirm` messages and
command results quote them, and the UI never hard-codes a number. A wave 2
story that adds a write adds its row; a disruptive write without one fails
`settings.test.ts`.

| Change | Estimate | Source |
| --- | --- | --- |
| `network.restart` | about 2 to 3 minutes | eero app copy |
| `eero.restart`, leaf eero | about 1 minute | eero app copy |
| `eero.restart`, gateway | about 2 to 3 minutes (whole network) | same as `network.restart` |
| Settings writes through `PUT {net}/settings` that restart the mesh: `settings.dns.set`, `settings.dhcp.set`, `settings.wan.set`, `settings.connection_mode.set`, `settings.ipv6.set`, `settings.nat_randomization.set` | about 8 minutes | FF field report (research notes) |
| `settings.mlo.set` | Change multi-link operation | `{ mode: "disabled" \| "single" \| "multi" }` | d | `PUT {net}/mlo_mode` JSON `{mlo_mode}` | Built (M5.3). A network without `mlo_mode` (null) is `bad_params`. Restarts the network (see [Restart estimates](#restart-estimates)); the confirm is its `settings.impact` summary. Gate `settings`. Invalidates `settings`, `network`, `wifi`. |
| `wifi.security.set` (`wpa3_per_band`) | about 2 to 3 minutes | same as `network.restart`; unverified, MANUAL check |
| `wifi.name.set`, `wifi.password.set` | no restart; wireless devices on the main network drop and rejoin | `wifi.impact` |
| `settings.thread.set` | Change Thread | `{ enabled?: boolean, credentialSync?: boolean }` (at least one) | d | `enabled`: `PUT {thread}/enable` JSON `{enabled}` (SX, Eeronaut); `credentialSync`: `PUT {thread}` JSON `{enable_credential_syncing}` | Built (M5.3, fixed M5.R-fix3: `thread_enable` on `{thread}` answers 200 and changes nothing on a real network). No Thread: `bad_params`. If the read after the write still shows the old value, fails with `eero_error`. The UI asks before turning Thread off. Gate `settings`. Invalidates `settings`. Disruptive: turning Thread off takes accessories off their border router. |
| `eero.port.action` | no restart; that port's device loses data or power | |
| Live toggles: `settings.upnp.set`, `settings.sqm.set`, `settings.band_steering.set`, `settings.power_saving.set`, `settings.simple_setup.set` | nothing restarts | |
| `settings.timezone.set` | nothing restarts; every schedule shifts, and one that is on now in the new zone pauses its devices (disruptive) | |
| `settings.fast_transition.set` | nothing restarts; a few older devices may not connect while it is on (disruptive) | |
| `updates.install` | about 10 minutes | eero app copy |

### routing (`commands/routing.ts`)

All three lists come from one `GET {net}/routing` (pinned to `/2.2/`),
cached as the `routing` topic, so the Reservations & ports page makes one
routing read; the LAN map comes from the network's `dhcp`
settings (`dhcp.custom`, or eero's automatic 192.168.4.0/22 with the pool
from .4.100 to .7.254). Core joins rows to devices by MAC (reservations) and
IP (forwards) and counts leased addresses: connected, unblocked
main-network devices with an IPv4 inside the pool and no reservation, using
the same `blocked` flag `device.list` reports. Only core counts leases; both
backends report `pool.leased` as 0. Writes apply instantly and never restart eeros. Not
available in bridge or IP passthrough mode: the reads answer empty lists
with `unavailable` set to the reason, without calling eero's routing.

Writes (M5.5) are plain `write`s (no confirm), gated `{ area: "settings",
bridgeOff: true }`, and invalidate `routing` and `devices` (device detail
carries the reservation). In bridge or IP passthrough mode every write and
`forward.validate` fail `eero_error` with the same reason, before any eero
write. Every check lives in core and fails `bad_params` with
`detail.issues[]` keyed by param: an address must be IPv4, inside the LAN
subnet, not its network, broadcast or gateway address, not reserved for
another device and not in use by another connected device now (a pool
address is fine when it is free); ports are `"N"` or `"N-M"` within 1 to
65535; an internal range is as long as the external one; ranges need the
`port_forward_range` capability; a forward may not share an external port
with another forward whose protocol overlaps (TCP+UDP overlaps both); a
pinhole may not overlap another on the same device. Guest devices take no
reservation, forward or pinhole. The eero backend reads routing back after
each write (eero's write answers are not captured) and sends a PUT as the
whole row. Forward ports are strings in `{net}/routing` and numbers in
`{net}/forwards`; the mapper takes both. The lists poll every 60 s
(`POLL.routing`), since the eero app changes them too.

A remove whose ref is shaped like an id (no spaces, a digit) and matches
nothing eero lists now answers `alreadyGone: true` with a null row instead
of `bad_params`: it was removed elsewhere, and the write still refreshes the
lists. A name with no match is still `bad_params`. When eero refuses a
DELETE (404 or its own code) and a fresh routing read no longer lists the
row, the eero backend counts it as removed; if the row is still there the
error stands.

| id | label | params | effect | eero endpoint(s) | notes |
| --- | --- | --- | --- | --- | --- |
| `reservation.list` | Reservations | `{}` | q | `GET {net}`, `GET {net}/routing`, `GET {net}/devices` | `{ reservations: Reservation[], lan: LanMap \| null, leases: string[], unavailable: string \| null }`: reservations A to Z, joined to devices, plus the LAN map (subnet, DHCP pool, static range, leased count) and `leases`, the addresses behind the leased count in address order, for the address map. |
| `reservation.add` | Add a reservation | `{ device?: Ref, mac?: string, ip?: string, description?: string }` | w | `POST {net}/reservations` JSON `{description, mac, ip}` | One of `device` or `mac`. Without `ip`: the device's current IPv4 when free, else the first free address in the static range. A device or MAC that already has one fails. Returns the `Reservation`. eero's `error.reservation.ip.invalid` and `error.assignment.ip.unavailable` map to `bad_params`. |
| `reservation.update` | Edit reservation | `{ reservation: Ref, ip?, description? }` | w | `PUT {net}/reservations/{id}` JSON `{description, mac, ip}` (whole row) | `reservation` matches id, MAC, IP, description or the device's name. Forwards on the old address follow it. Returns the `Reservation`. |
| `reservation.remove` | Remove reservation | `{ reservation: Ref, removeForwards?: boolean }` | w | `DELETE {net}/reservations/{id}?delete_forwards=true\|false` | `removeForwards` defaults to false. Returns `{ reservation, removedForwards: Forward[], alreadyGone }` for Undo; `reservation` is null when `alreadyGone`. |
| `forward.list` | Port forwards | `{ device?: Ref }` | q | `GET {net}`, `GET {net}/routing`, `GET {net}/devices` | `{ forwards: Forward[], unavailable: string \| null }`, by external port, optionally for one device (device detail). An unknown device is `bad_params`. |
| `forward.add` | Add port forward | `{ device: Ref, externalPort: PortSpec, internalPort?: PortSpec, protocol: "tcp" \| "udp" \| "both", description: string, enabled?: boolean }` | w | `POST {net}/reservations` if the device has none, then `POST {net}/forwards` JSON `{ip, gateway_port, client_port, protocol, description, enabled}` | `internalPort` defaults to `externalPort`, `enabled` to true, `description` 1 to 64 characters. Runs `forward.validate`'s checks. Returns `{ forward, reservation: Reservation \| null }` (the reservation it made). |
| `forward.validate` **(added)** | Check port forward | `{ device: Ref, externalPort: PortSpec, internalPort?: PortSpec, protocol: "tcp" \| "udp" \| "both", forward?: Ref }` | q | none beyond the routing reads | `{ ok, issues: { field, message }[], needsReservation }`. Same checks `forward.add` and `forward.update` run (port bounds, range length, range capability, overlap with forwards of an overlapping protocol, a device that can take a reservation). `forward` is the one being edited, excluded from the overlap check. Cached on the `routing` topic. |
| `forward.update` | Edit port forward | `{ forward: Ref, device?, externalPort?, internalPort?, protocol?, description?, enabled? }` | w | `PUT {net}/forwards/{id}` (whole row); `POST {net}/reservations` first when moved to a device without one | Also the Enabled switch. A new `externalPort` moves `internalPort` with it when they were equal. Returns the `Forward`. |
| `forward.remove` | Remove port forward | `{ forward: Ref }` | w | `DELETE {net}/forwards/{id}` | The reservation stays. Returns `{ forward, alreadyGone }`, the removed `Forward` for Undo (null when `alreadyGone`). |
| `pinhole.list` | IPv6 firewall rules | `{}` | q | `GET {net}`, `GET {net}/routing`, `GET {net}/devices` | `{ pinholes: Pinhole[], unavailable: string \| null }`, by port. Each pinhole is joined to its device by id or MAC; a missing address takes the device's first global IPv6. Empty on a real network so far ([endpoints.md section 17](../eero-api/endpoints.md)). |
| `pinhole.add` | Add IPv6 rule | `{ device: Ref, protocol: "tcp" \| "udp" \| "both", port: PortSpec }` | w | `POST {net}/ipv6/pinholes` JSON `{device: url, protocol, port}` | Returns the `Pinhole`. |
| `pinhole.remove` | Remove IPv6 rule | `{ pinhole: Ref }` | w | `DELETE {pinhole url}` (the url routing lists; `{net}/ipv6/pinholes/{id}` without one) | `pinhole` is its id or `device name:port`. Returns `{ pinhole, alreadyGone }`, the removed `Pinhole` for Undo (null when `alreadyGone`). |

### updates (`commands/updates.ts`)

| id | label | params | effect | eero endpoint(s) | notes |
| --- | --- | --- | --- | --- | --- |
| `updates.get` | Software updates | `{}` | q | `GET {net}/updates`, `GET {net}/eeros` | `Updates`: current (the gateway's) and target eeroOS, can update now, scheduled time, preferred hour, per-eero versions (from the eeros; the updates object has none), stuck eeros from `last_user_update`. Status from `update_status`, else `has_update` and a scheduled time. Polls every 15 min. |
| `updates.install` | Install update now | `{}` | d | `POST {net}/updates` empty-JSON | Only when `canUpdateNow` and not already installing, else `bad_params` before the confirm. Every eero restarts, about 10 minutes; the confirm is `settings.impact`'s summary. Returns `Updates` read right after; the `updates`, `eeros` and `network` topics go stale again 10 minutes later. Gate `eeros` (no `updates` key in the real permissions). |
| `updates.hour.set` | Set preferred update time | `{ hour: 0..23 }` | w | `POST {net}/updates/preferred_update_hour` JSON `{preferred_update_hour}` | Returns `Updates`. Gate `eeros`. The page offers Undo (the old hour) and "Use quietest" from `usage.quiet_hours`. |
| `updates.notes` | Release notes | `{}` | q | `GET {net}/updates`, `GET {net}/eeros`, then `GET updates.manifest_resource` (absolute URL, not api-user) | `ReleaseNotes \| null` (null when eero names no manifest). The manifest is `{target, history[]}`, each `{title, os_version, release_date, features: string[]}`; the result is the entry (target or history) of the version being installed, else the one running now (leading `v` and build suffix ignored), null when the manifest has none. Fetched by `EeroClient.fetchPublic` **without** the session cookie or token header, https only (the fake server's own loopback origin is the one exception), no redirects, 1 MB cap. Cached 6 h (`release_notes`). |

### admins (`commands/admins.ts`)

| id | label | params | effect | eero endpoint(s) | notes |
| --- | --- | --- | --- | --- | --- |
| `admin.list` | User permissions | `{}` | q | `GET {net}/members`, `GET {net}/invites` (plus the shared account and permissions reads) | `AdminList`: owner first then admins by name, invites newest first, seats used (members, owner included) of 10. eero sends no member email, so there is none. `isYou` is decided in core: the member whose name is the account name, narrowed by this network's role. Invites answer 403 for an admin; that part is empty, not an error. |
| `admin.invite.create` | Invite an admin | `{ nickname?: string(1..32) }` | w | `GET {net}/invites`, `POST {net}/invites` JSON `{invite_role: "admin"}` (answers only `{invite_url}`), `GET {net}/invites` again to find the new row, then `PUT {net}/invites/{id}` JSON `{invite_nickname}` when a nickname is given | **Sensitive**: returns `{ invite, inviteUrl, expiresAt }`; the link makes whoever opens it an admin. `bad_params` when members plus pending invites fill the 10 seats. eero sends no email and has no email invite endpoint, so there is no `email` param: the link is shared by hand (QR or Copy link). Gate `network.admin_invites` create. |
| `admin.invite.cancel` | Cancel invite | `{ invite: Ref }` | w | `DELETE {net}/invites/{id}` | The invite is an id or its nickname. Resend on the page is this on the old one, then `admin.invite.create` with the same nickname, so a full network keeps its seat. Gate `network.admin_invites` delete. |
| `admin.remove` | Remove admin | `{ admin: Ref }` | x | `DELETE {net}/admins/{user_id}` | Owner only (eero answers 403 otherwise). `bad_params` for the owner. The page confirms by typing the person's name. Gate `network.standard_admins` delete. |
| `network.transfer` | Transfer network | `{ name: string, email?: string, phone?: string, networkName: string }` | x | `POST {net}/transfer` form `{name, email}` or `{name, phone}` | Exactly one of `email` or `phone` (where eero sends it), else `bad_params`. `networkName` must equal the network's name or nickname (the type-to-confirm step), else `bad_params`. Returns `{ recipient, sentTo }`; the recipient becomes owner when they accept. Owner only. Gate `network.ownership_transfer` create and capability `ownership_transfer`. |

There is no `admin.nickname.set` (dropped in M5.6): the M5.1 capture shows
members carry no nickname or url, `{net}/admins` has no GET, and the clients
only rename pending invites (`PUT {net}/invites/{id}`), so no member
nickname request can be verified. Invite nicknames are set by
`admin.invite.create`. The real `{net}/permissions` (M5.6 capture, keys
only) names the admin areas `network.admin_invites`,
`network.standard_admins` and `network.ownership_transfer`, which the gates
above use; its `network.transfer` key is all false even for the owner, and
it sends no `role`.

### activity (`commands/activity.ts`)

| id | label | params | effect | eero endpoint(s) | notes |
| --- | --- | --- | --- | --- | --- |
| `events.list` | Event stream | `{ cursor?: string, limit?: 1..50 (1..1000 with csv), type?: EventCategory[], device?: Ref, eero?: Ref, profile?: Ref, search?: string, since?: string, until?: string, grouped?: boolean, format? }` | q | `GET {net}/app_events?page_size=50&timestamp=` (eero sends only its last ~15 minutes and ignores the cursor, so the eero backend keeps a log of what it has read and older pages come from it; see eero-client.md#command-to-endpoint-map) | `EventPage`: events newest first, `nextCursor`, counts per category for the page. Filters apply in core; device, eero and profile match refs, or the name in the text for events without refs (the real stream has none). `grouped` folds events of the same type and title within an hour into the newest (`grouped` on the row); `limit` still counts events. Reads at most 10 backend pages per call (20 for CSV). `format: "csv"` is the Export CSV button (there is no separate export command), never grouped. Rows without refs get them by name where it is unambiguous (one device, eero or profile with that name standing alone in the title; the longest name wins, a shared name links nothing). Each row may carry `action` (`assign_profile`, `resume`, `unblock`) from what the event says happened, on the newest such row per target; it runs `device.profile.set`, `profile.resume` or `device.unblock`, and the UI shows it only while the target still needs it. |
| `events.summary` **(added)** | Event summary | `{ range: "day" \| "week" \| "kept", bucket?: "hour" \| "day", type?: EventCategory[], device?: Ref, eero?: Ref, profile?: Ref }` | q | `GET {net}/app_events` pages back past the range start, at most 20 pages (cached 120 s, `events` topic); on eero the pages come from the backend's event log, so a range reaches back only as far as the log | `EventSummary`: total, daily average, `prior` and `change` against the same length of time before the range (null when history does not reach back, as for a week on a ~7 day account), counts per category and per bucket (network time zone; default hour for day, day for week), `range: "kept"` (the Activity summary): every kept event of the last 24 hours, from the oldest one (at least 15 minutes back) to now in about 12 buckets of `step` minutes (1, 2, 5, 10, 15, 30, 60 or 120, the smallest that fits; `bucket: "minutes"`), with `top` (the 4 devices, eeros and profiles with the most events, by ref or by name as `events.list` links rows: `{kind, id, name, count, last, category}`) and `topMore`; no prior. `step` is 60 or 1440 for the other ranges. `earliest` (the oldest event read, whatever the filters: how far back the eero backend's log reaches, the Activity hero's "since"), `partial` when the page budget ran out. Activity hero, chart and day bars, Settings "this week" counts. |

### notifications (`commands/notifications.ts`)

eero keeps no read flag per notification, only `has_unread` for the whole
network. So `unread` (the bell's dot) is eero's flag, every row is read
unless the backend knows better (the demo does), and when `has_unread` is
false core marks every row read. Desktop alerts never use read flags: core's
`findNewNotifications` treats an id the surface has not seen before as new,
alerts nothing on the first page seen for a network, puts offline network
and eero alerts first and sends at most 5 per poll.

| id | label | params | effect | eero endpoint(s) | notes |
| --- | --- | --- | --- | --- | --- |
| `notifications.list` | Notifications | `{ cursor?: string }` | q | `GET {net}/notifications_history?limit=50&timestamp=`, `GET {net}/notifications/has_unread` | `NotificationPage`: newest first, `unread` from `has_unread`, `nextCursor` is the `created_at` of the last row of a full page. Only the first page is cached. The bell and desktop alerts, polled every 60 s. |
| `notifications.mark_read` | Mark all read | `{}` | w | `POST {net}/notifications/mark_read` (empty-JSON body) | Network-wide: clears `has_unread`, so the next `notifications.list` has `unread: false` and every row read. Returns `{ unread: false }`. Invalidates `notifications`. No undo (eero cannot mark anything unread). The bell footer and the Activity event stream. |
| `notifications.settings.get` | Notification settings | `{}` | q | `GET {net}/notifications`, push from `GET /2.2/account` | `NotificationSettings`: eero keys as sent minus the eero Plus ones (`premium.*`, `backup.*`), the account's push choices, and desktop choices from `settings.json` `desktopNotifications` over the default `{ enabled: true }`. Desktop alerts are off when `enabled` is false, and a kind is off when its key is false: `offline` (network or eero offline), `devices` (category `device` or `devices`), `other` (everything else); core's `findDesktopAlerts` applies them. |
| `notifications.settings.set` | Set notification settings | `{ eero?: Record<string, boolean>, desktop?: { enabled?, offline?, devices?, other?: boolean } }` (at least one key) | w | `PUT {net}/notifications` with the full merged map, only when `eero` is given | Gate `{ area: null }` (the account's own alerts plus app-local choices). Core reads the current switches, rejects an unknown key or an eero Plus key (`premium.*`, `backup.*`) as `bad_params`, merges the change and sends every non-Plus key, dotted keys as-is (`device.new`); eero's Plus switches are never sent. `desktop` merges into `settings.json` `desktopNotifications` and is the same on every network. Returns `NotificationSettings` as the next read shows it. Invalidates `notification_settings`. The Notification settings sheet (bell's gear, Activity, Account) saves with it; Undo restores the changed keys. |

### diagnostics (`commands/diagnostics.ts`)

| id | label | params | effect | eero endpoint(s) | notes |
| --- | --- | --- | --- | --- | --- |
| `health.check` | Network health check | `{ refresh?: boolean }` | q | `GET {net}`, `GET {net}/eeros`, `GET {net}/updates`, plus `{net}/devices` only when an issue needs it | `HealthReport`: checks in order internet, DNS, each eero (gateway first, id `eero.<id>`), mesh links, firmware, each `good \| warning \| problem \| unknown` with a one-line detail, `overall` and a 0 to 100 `score` (100 minus 14 per warning, 30 per problem, 5 per unknown). Composite of the same reads as `network.health`, `internet.get`, `eero.list` and `updates.get`; no active probes and no `{net}/diagnostics` call. Network health and eeros are required (their error fails the command); an internet or updates failure gives an `unknown` check. Topic `network` (cached 30 s); `refresh: true` is never cached ("Run again"). |
| `diagnostics.run` | Diagnose | `{ symptom?: "connection_drops" \| "internet_slow" \| "internet_offline" \| "eeros_red", device?: Ref }` | w | `POST {net}/diagnostics` JSON `{symptom?, device?}` (device id), then `GET {net}/diagnostics` (unshared reads) every 3 s, first after one interval, until `status` is no longer `not_started` (what an idle real network reports, capture 2026-11-14)/`running`/`in_progress`/`pending`/`started`/`queued`; `eero_error` after 2 minutes | `Diagnosis`: the `DiagnosticsResult` plus `symptom`, `at` and `steps[]`, next steps built in core (`diagnosisSteps`: one per area eero flagged, then the symptom's own). Gate `network`. Invalidates `diagnostics`. Can take a minute; nothing restarts. |
| `support.info` | Get help | `{}` | q | `GET {net}/support` (pinned to `/2.2/`), `log_id` from `GET /2.2/account` | `SupportInfo`: eero and ISP contacts, support ID. `email` is the address in `email_web_form_url`, a `mailto:` link on real networks (2026-11-21). eero's 2.2 object has no ISP contact, so `isp` is then `{name}` from `internet.get` with null phone and url, or null. |
| `support.report` **(added)** | Copy diagnostics report | `{}` | q | composite: the `health.check` reads, `GET {net}/devices` (counts only), `GET /2.2/account`, `GET {net}/diagnostics` (last run) | Plain-text report for "Copy diagnostics report": network, health check, internet, eeros, firmware, issues, last cloud diagnostics. Names, serials, MACs and IPs keep only their last four characters (`***rage`; four or fewer characters are hidden whole): every known value is replaced first, then any leftover MAC or IP pattern. Never holds the token. Built in core; not cached. |

### app (`commands/app.ts`, scope app, no eero)

| id | label | params | effect | eero endpoint(s) | notes |
| --- | --- | --- | --- | --- | --- |
| `app.info` | About | `{}` | q | none | `AppInfo`: version, Electron, OS, arch, backend, `fakeServer` (true only against the local fake eero server), session storage, `install` kind, `update` (`UpdateStatus`; `unsupported` where the host has no updater, the CLI and MCP), `cli` (`CliStatus`, null outside the window), `tray` (whether this desktop can show a tray icon; null outside the window), `startup` (`StartupStatus` `{supported, enabled}`: start at login as the OS records it; null outside the window), config dir. Polled every 60 s. |
| `app.settings.get` | App settings | `{}` | q | none | `AppSettings` from `settings.json`. |
| `app.settings.set` | Change app settings | `{ userAgent?, openOnLaunch?, autoUpdate?, updateChannel?, runInTray? }` (at least one) | w | none | User-Agent override (applies on the next launch), network to open on launch, automatic update checks, `latest` or `beta`, keep running in the system tray (off by default; the window shows or removes its tray icon at once through the `tray` host action, other hosts only save it). Plan speed and desktop alerts have their own commands (`internet.plan.set`, `notifications.settings.set`). Returns `AppSettings`. |
| `app.startup.set` | Start at login | `{ enabled }` | w | none | Adds or removes the OS login item (macOS and Windows login items, a Linux XDG autostart entry, `src/main/startup.ts`). With Keep running in the tray on, a login launch starts in the tray. `bad_params` in a development build and outside the window (`HOST_ONLY`). Returns `StartupStatus`. |
| `app.cli.install` | Install command line tool | `{}` | w | none | macOS symlink into `/usr/local/bin`, AppImage `~/.local/bin`. On Windows, deb and rpm it reports where the installer put it. Window only. Returns `CliStatus`. |
| `app.audit.list` **(added)** | Recent CLI and agent commands | `{ limit?: 1..200 }` (default 20) | q | none | `AuditList` from `audit.jsonl` in the config dir for the Settings "This week" list: newest entries, a count per local day, refused with `needs_confirm`, `mcpLastAt`. Entry format, redaction and cap are in [security.md](security.md#audit-log); never results. Polled every 60 s. Reading lands in M6.6 (`readAudit`); until then an empty week. |
| `app.update.check` **(added)** | Check for updates | `{}` | w | none | Checks now; returns `UpdateStatus`. Window only. |
| `app.update.install` **(added)** | Restart to update | `{}` | w | none | Restarts Mesh UI (only the app, never the network) to install a downloaded update; `bad_params` unless the state is `ready`. Never runs on its own. Window only. Returns `{ restarting: true, version }`. |
| `app.log.show` **(added)** | Show eero request log | `{}` | w | none | Shows `eero-requests.jsonl` in the system file manager (its folder when there is no log yet), for a bug report. Contents in [security.md](security.md#eero-request-log). Window only. Returns `{ path, exists }`. |
| `app.demo.set` **(added)** | Demo mode | `{ enabled: boolean }` | w | none | "Try demo mode" and leaving it: relaunches Mesh UI with or without the demo backend. Already in that mode: `{ demo, restarting: false }`, no relaunch. Window only. |

"Window only": these need the window's host actions (`HostInfo.actions`
in `spec.ts`, given by `src/main/host-actions.ts`). The CLI and MCP hosts
have none, so there they answer `bad_params` "Only in the Mesh UI window."
Every app write has gate `{ area: null }`.

### integrations (`commands/integrations.ts`) (added)

Partner features on the Advanced networking page. Response shapes come from
LD only and need a MANUAL check before shipping.

| id | label | params | effect | eero endpoint(s) | notes |
| --- | --- | --- | --- | --- | --- |
| `integrations.get` **(added)** | Integrations | `{}` | q | `GET {net}` only (shared): `homekit`, `amazon_account_linked`, embedded `proxied_nodes`, `ffs`, `capabilities` | `Integrations`: HomeKit, Amazon linked, eero Built-in, Smart Home Hub, Frustration-Free Setup, each with `available` and `enabled`. `GET {net}/proxied_nodes` answers 404 on a real network, so eero Built-in is the network's embedded `proxied_nodes`. A missing or null field is unavailable, not an error (`homekit: null` is unavailable). Frustration-Free Setup is unavailable ("Not offered for this network") when the `ffs` capability is false. Smart Home Hub is available only when a `smart_home_hub` or `zigbee` capability says so. Frustration-Free Setup has no write command: no live-tested client sends one and eero's own app shows no switch, so it is read only (`integrations.ffs.set` removed in M6.10). Polled every 60 s (TTL 30 s, M5.R-fix9). |
| `integrations.amazon.unlink` **(added)** | Unlink Amazon | `{}` | x | `POST /2.2/amazon/networks/{id}/account_unlink` | Owner only; gate `amazon.account` delete. The type-the-name dialog asks for the network name. Refuses with `bad_params` when nothing is linked, before the confirm. Linking needs Amazon sign-in in a browser and is out of scope. Returns `Integrations`; invalidates integrations, network. |
| `integrations.builtin.set` **(added)** | eero Built-in | `{ enabled: boolean }` | d | `PUT {net}/proxied_nodes` JSON `{enabled}` | Network-wide switch; eero has no per-device toggle. Gate `network.proxied_nodes`, off in bridge mode. Returns `Integrations`; invalidates integrations, devices (Echo-connected devices move). Disruptive: turning it off drops devices connected through an Echo while they move to an eero. |
| `integrations.zigbee.discover` **(added)** | Discover Zigbee devices | `{}` | w | `POST /2.3/networks/{id}/shh/start_zigbee_discovery` | `/2.3/` only. Gate `network.smart_home_hub`. Returns `{ started: true }`; pairing finishes in the Alexa app. Open question whether Smart Home Hub is free. |

Every write reads `integrations.get` first and refuses an integration that
is not available here with `bad_params` and eero's reason ("eero Built-in
is not available on this network: Not available in bridge mode."), so
nothing is sent. The gates use the `{net}/permissions` keys a real network
sends for these features (capture, 2026-11-14).

### demo (`src/core/backends/demo`, demo backend only) (added)

| id | label | params | effect | eero endpoint(s) | notes |
| --- | --- | --- | --- | --- | --- |
| `demo.scenario.set` **(added)** | Demo scenario | `{ scenario: string }` | w | none | Registered only when the demo backend is active, so it never appears in a live session. Swaps the fixtures (for example `default`, `empty`, `offline`, `bridge`, `admin`) for UI and state tests. See [testing.md](../testing.md). |

## Testing every command

Each command has a test that runs it through `engine.execute` against the
demo backend and covers:

- a valid call and the shape of the result,
- `bad_params` for a missing or wrong param and for an unknown or ambiguous
  `Ref`,
- `needs_confirm` without `confirm` for `disruptive` and `destructive`, and
  success with it,
- for writes, that the demo fixtures changed and the next query shows it.

Commands with eero quirks (refresh, `/2.3/` writes, form bodies, 429) also
have client tests against the fake eero server; see
[backends.md](backends.md#fake-eero-server).
