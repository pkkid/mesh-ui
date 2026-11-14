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
  invalidates?: Topic[];      // write: topics to refresh after success
  sensitive?: true;           // result contains a password or key
  poll?: number;              // query: poll interval in seconds, from src/core/poll.ts
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
- `range: "day" | "week"`. There is no month: free accounts get about 7 days.
- Query commands that feed an "Export CSV" button take
  `format?: "json" | "csv"`. CSV is built in `src/core/format.ts` so every
  surface exports the same columns.

## Effects

| Effect | Meaning | Confirm | MCP hints |
| --- | --- | --- | --- |
| `query` | Reads only. Safe to repeat. | no | `readOnlyHint: true`, `idempotentHint: true` |
| `write` | Changes something reversible without dropping the network. | no | `readOnlyHint: false`, `destructiveHint: false` |
| `disruptive` | Restarts eeros or drops clients (reboot, DNS, DHCP, Wi-Fi password, guest off). | `confirm: true` | `destructiveHint: true` |
| `destructive` | Cannot be undone (delete account or profile, remove eero, remove admin, transfer network, reset Thread). | `confirm: true` | `destructiveHint: true` |

`sensitive: true` queries also say in their MCP description that the result
contains a credential, and the CLI masks them unless `--reveal` is passed
([security.md](security.md#sensitive-results)). Full MCP annotations,
including `openWorldHint`, are in [mcp.md](mcp.md#tools). Choosing an effect: if any eero client has
seen the call restart the mesh or drop clients, it is `disruptive`, even
when it usually does not.

## Confirmation

- The engine checks before `run`: if the effect is `disruptive` or
  `destructive` and `params.confirm !== true`, it returns
  `{ ok: false, error: { code: "needs_confirm", message } }`. The message says
  what will happen ("Restarts every eero on Maple Street. Devices lose
  internet for about 2 to 3 minutes.") so the CLI and agents can show it.
  Estimates come from [Restart estimates](#restart-estimates).
- The UI shows an inline confirm (or a dialog for `destructive`, with
  type-the-name where the mockup has it), then calls again with
  `confirm: true`.
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
| `auth.logout` | Sign out | `{}` | w | `POST /2.2/logout` | Best effort; local session and file are cleared even if eero is unreachable. |

### account (`commands/account.ts`, scope account)

| id | label | params | effect | eero endpoint(s) | notes |
| --- | --- | --- | --- | --- | --- |
| `account.get` | Account | `{}` | q | `GET /2.2/account` | `Account` model. Email and phone as returned (eero masks some). |
| `account.name.set` | Edit name | `{ name: string(1..64) }` | w | `PUT /2.2/account/name` form `name` | |
| `account.email.set` | Change email | `{ email: string }` | w | `PUT /2.2/account/email` form `email` | Pending until verified. |
| `account.email.verify` | Verify email | `{ code: string }` | w | `POST /2.2/account/email/verify` form `code` | |
| `account.phone.set` | Change mobile | `{ phone: string }` | w | `PUT /2.2/account/phone` form `phone` | E.164. |
| `account.phone.verify` | Verify mobile | `{ code: string }` | w | `POST /2.2/account/phone/verify` form `code` | |
| `account.consents.set` | Email preferences | `{ marketingEmails: boolean }` | w | `PUT /2.2/account/consents` form `marketing_emails` | |
| `account.push.set` | Phone push alerts | `{ networkOffline?: boolean, nodeOffline?: boolean }` | w | `PUT /2.2/account/push_settings` JSON | eero wants every key; the command merges with the cached values. |
| `account.delete` | Delete account and data | `{ acknowledge: true }` | x | `DELETE /2.2/account` | Signs out afterwards. `acknowledge` mirrors the mockup checkbox; `confirm` is still required. |

### network (`commands/network.ts`)

| id | label | params | effect | eero endpoint(s) | notes |
| --- | --- | --- | --- | --- | --- |
| `network.list` | Networks | `{}` | q | `GET /2.2/account` (`networks.data`), fallback `GET /2.2/networks`; `GET {net}` per network for status | Scope account. `NetworkSummary[]` with role, eero count, online devices, status, selected flag. |
| `network.select` | Switch network | `{ network: Ref }` | w | none (app-local) | Sets the selected network in the session and `settings.json`. See engine.md. |
| `network.get` | Network | `{}` | q | `GET {net}` | `Network` model: name, nickname, status, counts, capabilities, timezone. `counts.profiles` is the number of profiles `profile.list` lists (eero's default profile left out). |
| `network.health` | Network health | `{}` | q | `GET {net}` (`health`, `eeros.data`, `updates`); `GET {net}/eeros` and `GET {net}/devices` only when an issue needs them | `NetworkHealth`: internet, mesh, per-eero status, weak links, banner messages, and `issues` built in core: `network_offline` (alone, every known device), else `eero_offline` per offline eero (devices last on it) then `weak_link` per weak wireless eero that is not offline (its upstream and the devices connected through it). A healthy network stays one call. |
| `network.permissions` | Permissions | `{}` | q | `GET {net}/permissions` | `Permissions` model. UI disables controls the role cannot use. |
| `network.nickname.set` | Network nickname | `{ nickname: string(0..32) }` | w | `PUT {net}/label?labelType=specialMarket` form `label` | Only LD uses this path; needs a MANUAL check. |
| `network.restart` | Restart network | `{}` | d | `POST {net}/reboot` empty-JSON | Every eero restarts, about 2 to 3 minutes offline (see [Restart estimates](#restart-estimates)). |
| `network.delete` **(added)** | Delete network | `{ networkName: string }` | x | `DELETE {net}` | Owner only. `networkName` must equal the current name (type-to-confirm, like `network.transfer`). Afterwards the session selects another network, or none. Advanced networking. |

### internet, speed tests and usage (`commands/internet.ts`)

| id | label | params | effect | eero endpoint(s) | notes |
| --- | --- | --- | --- | --- | --- |
| `internet.get` | Internet connection | `{ format?: "json" \| "text" }` | q | `GET {net}` (`geo_ip`, `ip_settings`, `lease`, `wan_type`, `gateway_ip`, `connection`, `ipv6_lease`, `dns`, `speed`), gateway from `GET {net}/eeros` | `Internet` model: ISP, public IPs, WAN type, lease renew time (`lease.dhcp.renews_on`, else `expires_on`; field unverified), double NAT, DNS in use, gateway port speed, plan speed from app settings, and the hero `verdict` built in core from status, last test and plan (`down` "... is down", `steady` "... is fast and steady" or "... is up" without a test or plan, `slow` "... is slower than your plan"). `format: "text"` returns the plain-text block for "Copy details". |
| `speedtest.run` | Run speed test | `{}` | w | `POST {net}/speedtest` (202) | Returns `{ startedAt }`. The poller reads `GET {net}/speedtest` after about 60 s and emits `speedtest`. Uses the WAN for about 30 s. |
| `speedtest.history` | Speed test history | `{ range?: "day" \| "week", limit?: 1..200, format? }` | q | `GET {net}/speedtest?startTime&endTime&limit` | `SpeedTest[]` newest first, plus 7-day averages. `format: "csv"` is the Export CSV button. |
| `usage.get` | Data usage | `{ scope: "network" \| "eero" \| "device" \| "profile" \| "guest", id?: Ref, range: "day" \| "week", cadence?: "hourly" \| "daily" }` | q | network `GET {net}/data_usage`; eero `.../data_usage/eeros/{id}`; device `.../data_usage/devices/{mac}`; profile `.../data_usage/profiles/{id}`; guest: sum of `.../data_usage/devices` rows for guest devices | `UsageSeries`. Default cadence hourly for day, daily for week; week plus hourly feeds the "busy hours" heatmaps. Query params only, never a GET body. Without `id`, `eero` and `profile` scopes return one series per eero or profile; the profile scope adds an Unassigned ("Other devices") series. |
| `usage.quiet_hours` **(added)** | Quietest hours | `{ range?: "day" \| "week" (default week), start?: 0..23 }` | q | `GET {net}/data_usage?cadence=hourly` (same call as `usage.get`) | `QuietHours`: average bytes per hour of day in network time (the hour in progress left out; an hour with no sample is null), the quietest 3-hour window (wraps past midnight, earliest start on a tie), the busiest hour, and with `start` the mean of that window (`selected`). No traffic at all: quietest and busiest are null. Used by Updates (preferred update time). Built in core. |
| `internet.plan.set` **(added)** | Internet plan speed | `{ down: number, up: number, label?: string } \| { clear: true }` Mbps | w | none (app-local) | Stored per network in `settings.json`; `internet.get` returns it as `plan`. Gauges and verdicts compare against it. No eero call, so admins can set it too. |
| `usage.breakdown` | Usage breakdown | `{ range: "day" \| "week", by: "device" \| "profile" \| "eero", profile?: Ref, top?: 1..100, format? }` | q | `GET {net}/data_usage/breakdown`; `by: "eero"` uses `GET {net}/data_usage/eeros` | `UsageBreakdown`, rows sorted by total, with share of network. `eero` option added for the Overview "By eero" list. `profile` limits `by: "device"` rows to one profile (Profile detail). `top` keeps the largest rows and folds the rest that used data into a last row `{ id: null, name: "Others (n)" }` (Internet By device). By profile, every row's id is a `profile.list` id, except one Unassigned row `{ id: null, name: "Unassigned" }` (the rest of the network, plus any row whose id `profile.list` does not have, such as eero's default profile). eero's profile rows are `{profile_id, profile_name, upload, download}` (real capture, 2026-11-13). |

### eero (`commands/eero.ts`)

| id | label | params | effect | eero endpoint(s) | notes |
| --- | --- | --- | --- | --- | --- |
| `eero.list` | eeros | `{}` | q | `GET {net}/eeros` (`resources.eeros`), `GET {net}` | `Eero[]` with topology (`upstream`, `meshBars`), clients, bands. `GET {net}` gives the LAN facts: `subnet` from custom DHCP (`dhcp.custom.subnet_ip`/`subnet_mask` as CIDR; null in automatic mode, which does not say the range), `gatewayIp` the gateway eero's `ip_address` (null in bridge or passthrough mode). |
| `eero.get` | eero | `{ eero: Ref }` | q | `GET {eero}`, `GET {net}` | `Eero` plus radios (tx power from `radio_channel_stats.tx_power`) and BSSIDs. `gatewayIp` and `subnet` fall back to the `eero.list` values. `autoChannel` stays null: no eero field for it has been seen. |
| `eero.rename` | Rename eero | `{ eero: Ref, location: string(1..32) }` | w | `PUT {eero}` form `location` | |
| `eero.restart` | Restart eero | `{ eero: Ref }` | d | `POST resources.reboot` (201) | Restarting the gateway takes the network down; downstream eeros drop too. Message says which. |
| `eero.led.set` | Status light | `{ eero: Ref, on?: boolean, brightness?: 0..100 }` | w | `PUT resources.led_action` form `led_on` / `led_brightness` | JSON PUT to `{eero}` is a silent no-op; always use the `led_action` link. |
| `eero.find` | Blink light | `{ eero: Ref, seconds?: 10..60, stop?: boolean }` default 30 | w | `POST /2.2/eeros/{serial}/led_cycle` form `colors[]=blue&colors[]=white&duration&time_per_color=1` | Harmless. `stop: true` ends the blink early by re-applying the LED setting through `led_action`; no stop endpoint is known, so the UI hides Stop until this is verified (open question). |
| `eero.nightlight.set` | Nightlight | `{ eero: Ref, mode: "off" \| "ambient" \| "schedule", brightness?: 0..100, on?: "HH:MM", off?: "HH:MM" }` | w | `PUT {eero}/nightlight/settings` JSON | eero Beacon only; others fail `bad_params` from capability check. |
| `eero.ports.get` | Ethernet ports | `{ eero: Ref }` | q | `GET {eero}`, `GET resources.connections`; `GET {net}/devices` and `GET {net}/eeros` only when a port has a neighbor | `EeroPorts`: per port status, speeds in Mbps (`negotiated_speed` `"P2500"` to 2500, `"P10G"` to 10000; null when the link is down), PoE, MAC, attached device or eero (joined by MAC, then by link), allowed `actions[]`. Ports sorted by number; empty list when eero reports none. Polls every 60 s. |
| `eero.port.action` | Port action | `{ eero: Ref, port: number, action: PortAction }` | d | `POST {eero}/ports/{n}/action` JSON `{action}` | Only actions listed in that port's `actions[]` are accepted. Can cut data or power to wired gear. |
| `eero.firmware.history` | Firmware history | `{ eero: Ref, limit?: 1..50 }` (default 20) | q | `GET {eero}`, `GET /2.2/eeros/{id}/firmware_update/history?limit=50&offset=0` | `FirmwareEntry[]` newest first (sorted in core: eero may send oldest first, so it always asks for 50 and trims), `current` on the newest entry matching the eero's `os_version`. 404 or 405 gives an empty list. Only LD uses it; MANUAL check of shape. |
| `eero.remove` | Remove eero | `{ eero: Ref }` | x | `DELETE {eero}` | Owner only. Removing the gateway kills the network; the command refuses the gateway unless it is the only eero. |
| `eero.placement.test` | Test placement | `{ eero: Ref }` | w | `POST` then `GET /2.3/networks/{id}/placement_test/{serial}` | `/2.3/` only. Returns `PlacementResult`. |
| `coverage.scan` | Coverage scan | `{ refresh?: boolean }` | q | `GET /2.4/networks/{id}/placement/wifi_coverage_scan?allDevices=true` | `/2.4/` only. `CoverageScan`: per room link quality and advice. `refresh: true` skips the cache ("Scan again"). |
| `coverage.upgrade_report` | Upgrade report | `{}` | q | `GET /2.4/networks/{id}/placement/wifi_generation_scan?allDevices=true` | `/2.4/` only. `UpgradeReport`: devices per Wi-Fi generation, limiting eeros. |

`PortAction` = `ENABLE_PORT | DISABLE_PORT | ENABLE_DATA | DISABLE_DATA |
ENABLE_POE | DISABLE_POE | RESTART_POWER`. Node-wide
`POWER_CYCLE_ALL_PORTS` is not exposed yet.

### device (`commands/device.ts`)

| id | label | params | effect | eero endpoint(s) | notes |
| --- | --- | --- | --- | --- | --- |
| `device.list` | Devices | `{ status?: "online" \| "offline" \| "paused" \| "blocked", connected?: boolean, paused?: boolean, blocked?: boolean, ssid?: "main" \| "guest", eero?: Ref, profile?: Ref \| null, band?: Band \| "wired", type?: DeviceCategory, manufacturer?: string, firstSeenSince?: string, search?: string, sort?: "name" \| "usage" \| "rate" \| "last_seen", limit?: number, format? }` | q | `GET {net}/devices` (`resources.devices`), `GET {net}/blacklist` | `DeviceList`: devices plus summary (counts by status, band, category; live rate totals, and per band the rate totals, `trafficPct` and `devicePct` with `topBand`, the busiest Wi-Fi band, for the band insight line). The summary always covers the whole network, not just the filtered rows, so the status segment and the Filters popover keep their counts (see [devices.md](../ux/pages/devices.md)). `summary.total` is every known device, and `network.get` `counts.devices` (the sidebar count) is the same number. `status` is the status segment's shorthand: `online` = connected (paused included), `offline` = not connected and not blocked. Offline devices older than 7 days are dropped (blocked ones stay). `profile: null` lists devices with no profile (Unassigned): devices on eero's own default profile, which `profile.list` leaves out, have `profileId: null` here and in `device.get`. |
| `device.get` | Device | `{ device: Ref }` | q | `GET {device}`, then `GET {net}/routing` for its reservation (matched on MAC; none in bridge mode or when routing fails) | `Device` with connectivity details, its reservation and `ipv6LinkLocal` (the fe80:: address eero lists among `ipv6_addresses`, kept out of `ipv6`). Forwards come from `forward.list {device}`. |
| `device.rates.refresh` | Refresh live rates | `{}` | w | `POST {net}/burst_reporters` empty-JSON, then `GET {net}/devices` after `next_burst` | At most once a minute per network; a second call inside the window returns the pending `nextBurstAt` without calling eero. See engine.md. |
| `device.pause` | Pause device | `{ devices: Ref[] }` | w | `PUT /2.3/networks/{id}/devices/{mac}` JSON `{paused: true}` | `/2.3/` required: `/2.2/` returns 200 and drops the change. |
| `device.resume` | Resume device | `{ devices: Ref[] }` | w | same, `{paused: false}` | |
| `device.rename` | Rename device | `{ device: Ref, nickname: string(0..32) }` | w | `PUT /2.3/networks/{id}/devices/{mac}` JSON `{nickname}` | Empty string resets to hostname (MANUAL check that eero clears it). |
| `device.type.set` | Device type | `{ device: Ref, type: DeviceType }` | w | `PUT /2.3/networks/{id}/devices/{mac}` JSON `{device_type}` | FF verified the write on `{net}/devices/{mac}`; we use `/2.3/` per the device-write rule (MANUAL). |
| `device.profile.set` | Change profile | `{ devices: Ref[], profile: Ref \| null }` | w | assign: `PUT {device}` JSON `{profile: {url}}`; unassign: `PUT {old profile}` JSON `{devices: [...]}` without them | eero has no "none" value on the device. |
| `device.block` | Block device | `{ devices: Ref[] }` | w | `POST {net}/blacklist` form `mac` | Kicks it off every eero until unblocked. |
| `device.unblock` | Unblock device | `{ devices: Ref[] }` | w | `DELETE {net}/blacklist/{mac}` | |

### profile (`commands/profile.ts`)

| id | label | params | effect | eero endpoint(s) | notes |
| --- | --- | --- | --- | --- | --- |
| `profile.list` | Profiles | `{}` | q | `GET {net}/profiles` (schedules from each profile's `schedule[]`) | `ProfileList`: `Profile[]` with state, device counts and next schedule, all computed in core in the network time zone. State: `paused` for a manual pause, else `scheduled` when an enabled schedule exists (or eero says so), else `active`. Also returns an `unassigned` summary (device ids, online count, paused state; it is not a profile and has no id) and `today`: the date, zone and minute it was computed, and one lane per profile plus Unassigned (`profileId: null`) of `PauseSegment`s in minutes after midnight (today's schedule spans, the end of yesterday's overnight ones, and a manual pause from now to the next scheduled start or midnight). |
| `profile.get` | Profile | `{ profile: Ref }` | q | `GET {profile}` | `Profile` with devices and schedules. Schedules come from the profile's own `schedule[]`: `GET {profile}/schedules` is a 404 on a real network although `resources.schedules` names it ([endpoints.md section 17](../eero-api/endpoints.md)). |
| `profile.create` | Add a profile | `{ name: string(1..32), devices?: Ref[] }` | w | `POST {net}/profiles` JSON `{name, paused: false, devices: [{url}]}` | |
| `profile.rename` | Rename profile | `{ profile: Ref, name: string(1..32) }` | w | `PUT {profile}` JSON `{name}` | |
| `profile.pause` | Pause profile | `{ profile: Ref }` | w | `PUT {profile}` JSON `{paused: true}` | Lasts until resumed. eero has no timed pause, so Mesh UI offers none and the engine keeps no resume timers. |
| `profile.resume` | Resume profile | `{ profile: Ref }` | w | `PUT {profile}` JSON `{paused: false}` | During a scheduled pause, eero keeps the profile online until the next schedule. |
| `profile.devices.set` | Profile devices | `{ profile: Ref, devices: Ref[] }` | w | `PUT {profile}` JSON `{devices: [{url}]}` | Replaces the whole list. |
| `profile.delete` | Delete profile | `{ profile: Ref }` | x | `DELETE {profile}` | Devices become unassigned, schedules go, pause lifts. |
| `profile.schedule.add` | Add a scheduled pause | `{ profile: Ref, name: string, days: Day[], start: "HH:MM", end: "HH:MM", enabled?: boolean }` | w | `POST {profile}/schedules` JSON | `end` before `start` wraps past midnight. Days sent as `MON`..`SUN` (LD form; MANUAL check against FF's lowercase). |
| `profile.schedule.update` | Edit schedule | `{ profile: Ref, schedule: Ref, name?, days?, start?, end?, enabled? }` | w | `PUT {schedule url}` | |
| `profile.schedule.remove` | Delete schedule | `{ profile: Ref, schedule: Ref }` | w | `DELETE {schedule url}` | |
| `profile.unassigned.pause` **(added)** | Pause unassigned devices | `{}` | w | `PUT /2.3/networks/{id}/devices/{mac}` `{paused: true}` per unprofiled device | Profiles page and palette. UI asks first because it includes TVs and smart home gear; the engine does not require `confirm`. |
| `profile.unassigned.resume` **(added)** | Resume unassigned devices | `{ all?: boolean }` | w | same, `{paused: false}` | Resumes only devices this command paused (tracked in session) unless `all: true`. |

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

M3 ships `guest.get` and `guest.share`; the writes below are planned, and the
Guest page shows them as disabled "Coming soon" controls. Guest usage is
`usage.get` `{scope: "guest"}`: core adds up the per-device series of every
guest online during the window, on both backends (eero has no guest usage
endpoint).

| id | label | params | effect | eero endpoint(s) | notes |
| --- | --- | --- | --- | --- | --- |
| `guest.get` | Guest network | `{}` | q | `GET {net}/guestnetwork`, `GET {net}/devices` (`is_guest`), `GET {net}/wpa3_per_band`, `GET {net}/eeros` (6 GHz radios) | `GuestNetwork` without the password (`hasPassword` only), plus online guest count (0 while off) and every guest seen in the last 7 days. Security per band is the main network's; none when open; 6 GHz is WPA3 when an eero has the radio. Polled with devices (60 s). |
| `guest.enable` | Turn on guest network | `{ name?: string(1..32) }` | w | `PUT {net}/guestnetwork` form `enabled=true[&name]` | |
| `guest.disable` | Turn off guest network | `{}` | d | `PUT {net}/guestnetwork` form `enabled=false` | Drops every guest. |
| `guest.rename` | Rename guest network | `{ name: string(1..32) }` | d | `PUT {net}/guestnetwork` form `name` | Must differ from the main SSID (checked in core). Guests must rejoin. |
| `guest.password.set` | Guest password | `{ password: string(8..63) \| null }` | d | `PUT {net}/guestnetwork/password` form `password`; `null`: `DELETE {net}/guestnetwork/password` | `null` makes the guest network open. |
| `guest.share` | Share guest Wi-Fi | `{}` | q, sensitive | `GET {net}/guestnetwork` (the password is in the clear there) | `WifiShare`: ssid, password (null when open), security (`WPA` or `nopass`), and the `WIFI:T:WPA;S:...;P:...;;` (open: `WIFI:T:nopass;S:...;;`) payload for the QR, with `\`, `;`, `,`, `:` and `"` escaped. Never cached or polled. An unnamed guest network is an `eero_error`. |

### wifi (`commands/wifi.ts`)

| id | label | params | effect | eero endpoint(s) | notes |
| --- | --- | --- | --- | --- | --- |
| `wifi.get` | Wi-Fi | `{}` | q | `GET {net}` (`name`, `wpa3`, `temporary_flags`), `GET {net}/wpa3_per_band` (404 on older firmware: the `wpa3` switch stands in), `GET {net}/eeros` (`bands`, `radio_channel_stats`), `GET {net}/devices` | `WifiSettings`: SSID, security per band (6 GHz always WPA3; a band no eero has is null and left out of `bands`), bands with clients, widths, channels (5 GHz low and high both kept), the 2.4 GHz only flag and its expiry. No password. Topic `settings`, polled every 60 s. `wpa2OnlyDevices` is an estimate: devices whose link used WPA2 on a band offering WPA2 + WPA3. |
| `wifi.password.get` | Reveal Wi-Fi password | `{}` | q, sensitive | `GET {net}` (`password`, in the clear) | `{ ssid, password }`; `password` null on an open network. Only on explicit reveal or copy. Never cached. |
| `wifi.name.set` | Wi-Fi name | `{ name: string }` 1 to 32 bytes | d | `PUT {net}/settings` form `name` | Every wireless device must reconnect. |
| `wifi.password.set` | Wi-Fi password | `{ password: string(8..63) }` printable ASCII | d | `PUT {net}/password` form `password` | Main network can not be made open; `DELETE {net}/password` is not exposed. |
| `wifi.security.set` | Wi-Fi security | `{ band24?: Security, band5?: Security }` | d | `PUT {net}/wpa3_per_band` JSON `{band_2_4_ghz, band_5_ghz}` | `Security` = `WPA2 \| WPA2_WPA3 \| WPA3`. 6 GHz is always WPA3. Result lists devices that only speak WPA2. |
| `wifi.hide5g.set` | Connect 2.4 GHz only devices | `{ enabled: boolean }` | d | on: `PUT {net}/temporary_flags/hide_5g` `{value: true}`; off: `DELETE` same | Effect changed from the brief's `write` to `disruptive`: it moves every 5 and 6 GHz client. eero expires it on its own (`temporary_flags.hide_5g.expires_on`, surfaced as `hide5g.expiresAt` for the countdown); the write takes no duration and the engine keeps no timer, so there is no `minutes` param. Turn it off sooner with `enabled: false`. Replaces the palette mockup's old `wifi.band24_only.start`. |
| `wifi.impact` **(added)** | Impact of a Wi-Fi change | `{ change: "name" \| "password" \| "security" \| "hide5g", band?: "band24" \| "band5", security?: Security }` | q | none (cached `wifi` and `devices` topics) | `WifiImpact`: devices that must reconnect, devices that only speak WPA2 for a security change, and the estimate from `settings.impact`. Wi-Fi and Guest pages, before the inline confirm. |
| `wifi.password.generate` **(added)** | Generate password | `{ length?: 12..63 }` default 16 | q | none | Random printable password from core (crypto RNG, no look-alike characters). Not saved; the UI fills the field and the person still saves with `wifi.password.set` or `guest.password.set`. Not `sensitive`: it is not a password in use. |
| `wifi.share` | Share Wi-Fi | `{}` | q, sensitive | `GET {net}` (`name`, `password`) | `WifiShare` for the QR and copy buttons: `qr` is `WIFI:T:WPA;S:<ssid>;P:<password>;;` (`T:nopass` when open) with `\ ; , : "` escaped, built in core (`wifiShare` in `commands/guest.ts`, shared with `guest.share`). Only on "Show code" or copy. Never cached. |

### settings (`commands/settings.ts`)

FF saw a DNS write and a DHCP write through `PUT {net}/settings` reboot
every eero for about 8 minutes. Every settings command reads first and skips
the write when nothing changed, and is never retried.

| id | label | params | effect | eero endpoint(s) | notes |
| --- | --- | --- | --- | --- | --- |
| `settings.get` | Network settings | `{}` | q | `GET {net}` (shared), `GET {net}/fast_transition`, `GET {net}/power_saving/schedules`, `GET {net}/thread`, `GET {net}/ac_compat` | `NetworkSettings`. Power saving on/off comes from the network object (`GET {net}/power_saving` is a 404). A 403, 404 or 405 on one of the extra reads is null (not on this network), never an error: Thread is null on a network without it. Thread secrets are never mapped; the command also strips any field outside the Thread model before caching. `devices` (Thread accessories) is always null: eero does not report it. `simpleSetup` is null unless `auto_setup_mode` is a clear on or off word. |
| `settings.dns.set` | DNS | `{ mode?: "automatic" \| "custom", servers?: string[] (1..4), ipv6Servers?: string[], caching?: boolean }` | d | `PUT {net}/settings` JSON `{dns: {mode, caching, custom: {ips}}, ipv6: {name_servers}}` | Confirmed mesh restart. Also the Local DNS caching toggle (`{caching}` alone): there is no separate `settings.dns_cache.set`, because caching is a field of the same `dns` object and SX's `PUT {net}/dns` alternative is just as disruptive. |
| `settings.dhcp.set` | DHCP and NAT | `{ mode: "automatic" \| "custom", subnetIp?, subnetMask?, startIp?, endIp? }` | d | `PUT {net}/settings` JSON `{dhcp: {mode, custom}}` | Confirmed mesh restart. Range validated in core. |
| `settings.ipv6.set` | IPv6 | `{ enabled: boolean }` | d | `PUT {net}/settings` JSON `{ipv6_upstream}` | |
| `settings.wan.set` | ISP settings | `{ mode: "dhcp" \| "static" \| "pppoe", static?: { ip, mask, router }, pppoe?: { username, password }, vlan?: number(1..4094) \| null }` | d | `PUT {net}/settings` JSON `{lease}` / `{pppoe, vlan}`; PPPoE credentials first via `POST {eero}/pppoe` | Wrong values take the network offline. PPPoE password never cached or returned. |
| `settings.connection_mode.set` | Connection mode | `{ mode: "nat" \| "bridged" \| "ipPassthrough" }` | d | `PUT {net}/settings` JSON `{connection: {mode}}` | Bridge disables profiles, reservations, forwards, SQM. |
| `settings.nat_randomization.set` **(added)** | NAT port mode | `{ randomized: boolean }` | d | `PUT {net}/settings` JSON `{nat_port_randomization}` | Advanced networking "Direct / Randomized". Needs eeroOS 7.16.1 or newer. |
| `settings.upnp.set` | UPnP | `{ enabled: boolean }` | w | `PUT {net}/settings` JSON `{upnp}` | |
| `settings.sqm.set` | Optimize for conferencing and gaming | `{ enabled: boolean }` | w | `PUT {net}/settings` JSON `{sqm}` | Not in bridge mode. |
| `settings.band_steering.set` | Client steering | `{ enabled: boolean }` | w | `PUT {net}/settings` JSON `{band_steering}` | |
| `settings.fast_transition.set` | Fast roaming (802.11r) | `{ enabled: boolean }` | w | `PUT {net}/fast_transition` JSON | |
| `settings.mlo.set` | Multi-link operation | `{ mode: "disabled" \| "single" \| "multi" }` | d | `PUT {net}/mlo_mode` JSON `{mlo_mode}` | Only when the network reports `mlo_mode`. Restarts the network (see [Restart estimates](#restart-estimates)). |
| `settings.power_saving.set` | Eco efficiency | `{ enabled?: boolean, scheduleEnabled?: boolean }` | w | `PUT {net}/power_saving` JSON `{enable, power_saving_schedule_enabled}` | |
| `settings.power_saving.schedule.add` **(added)** | Add power saving schedule | `{ name, days: Day[], start, end, enabled? }` | w | `POST {net}/power_saving/schedules` | Advanced networking power saving row. |
| `settings.power_saving.schedule.update` **(added)** | Edit power saving schedule | `{ schedule: Ref, name?, days?, start?, end?, enabled? }` | w | `PUT {item url}` | |
| `settings.power_saving.schedule.remove` **(added)** | Delete power saving schedule | `{ schedule: Ref }` | w | `DELETE {item url}` | |
| `settings.legacy_mode.set` **(added)** | Legacy device mode | `{ enabled: boolean }` | d | `PUT {net}/ac_compat` form `enabled` | Troubleshooting "Connect devices that can't detect Wi-Fi 6". Restarts the network. |
| `settings.timezone.set` **(added)** | Time zone | `{ timezone: string }` IANA | w | `PUT {net}/settings` JSON `{timezone: {value}}` | Wi-Fi page. Schedules follow it. |
| `settings.simple_setup.set` **(added)** | eero Simple Setup | `{ enabled: boolean }` | w | `PUT {net}/auto_setup_mode` (LD, shape unverified) | Advanced networking toggle. MANUAL check before shipping. |
| `settings.thread.set` | Thread | `{ enabled?: boolean, credentialSync?: boolean }` | w | `PUT {net}/thread` JSON `{thread_enable, enable_credential_syncing}` | SX's older `{net}/thread/enable` is a fallback on 404. |
| `settings.thread.credentials` **(added)** | Reveal Thread credentials | `{}` | q, sensitive | `GET {net}/thread` | Network key, PSKc, operational dataset. Only on explicit reveal or "Copy dataset". |
| `settings.thread.reset` | Regenerate Thread credentials | `{}` | x | `POST {net}/thread` | Every Thread device must re-pair. |
| `settings.impact` **(added)** | Impact of a settings change | `{ changes: { id: string, params?: object }[] }` | q | none (cached topics) | `SettingsImpact`: per change whether it restarts the mesh, the outage estimate in minutes (from the table below), devices online now, and whether this computer is behind the network. Advanced networking's Pending change panel and every disruptive confirm message use it. |

### Restart estimates

Core owns every outage estimate (`src/core/impact.ts`). `settings.impact`
returns them, `needs_confirm` messages and command results quote them, and
the UI never hard-codes a number.

| Change | Estimate | Source |
| --- | --- | --- |
| `network.restart` | about 2 to 3 minutes | eero app copy |
| `eero.restart`, leaf eero | about 1 minute | eero app copy |
| `eero.restart`, gateway | about 2 to 3 minutes (whole network) | same as `network.restart` |
| Settings writes through `PUT {net}/settings` that restart the mesh: `settings.dns.set`, `settings.dhcp.set`, `settings.wan.set`, `settings.connection_mode.set`, `settings.ipv6.set`, `settings.nat_randomization.set` | about 8 minutes | FF field report (research notes) |
| `settings.mlo.set`, `settings.legacy_mode.set` (own endpoints) | about 2 to 3 minutes | eero app copy; unverified, MANUAL check |
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

| id | label | params | effect | eero endpoint(s) | notes |
| --- | --- | --- | --- | --- | --- |
| `reservation.list` | Reservations | `{}` | q | `GET {net}`, `GET {net}/routing`, `GET {net}/devices` | `{ reservations: Reservation[], lan: LanMap \| null, leases: string[], unavailable: string \| null }`: reservations A to Z, joined to devices, plus the LAN map (subnet, DHCP pool, static range, leased count) and `leases`, the addresses behind the leased count in address order, for the address map. |
| `reservation.add` | Add a reservation | `{ device?: Ref, mac?: string, ip: string, description?: string }` | w | `POST {net}/reservations` JSON `{description, mac, ip}` | One of `device` or `mac`. `error.reservation.ip.invalid` and `error.assignment.ip.unavailable` map to `bad_params`. |
| `reservation.update` | Edit reservation | `{ reservation: Ref, ip?, description? }` | w | `PUT {reservation url}` | |
| `reservation.remove` | Remove reservation | `{ reservation: Ref, removeForwards?: boolean }` | w | `DELETE {reservation url}?delete_forwards=` | |
| `forward.list` | Port forwards | `{ device?: Ref }` | q | `GET {net}`, `GET {net}/routing`, `GET {net}/devices` | `{ forwards: Forward[], unavailable: string \| null }`, by external port, optionally for one device (device detail). An unknown device is `bad_params`. |
| `forward.add` | Add port forward | `{ device: Ref, externalPort: PortSpec, internalPort?: PortSpec, protocol: "tcp" \| "udp" \| "both", description: string, enabled?: boolean }` | w | `POST {net}/reservations` if the device has none, then `POST {net}/forwards` | Ranges (`"2456-2458"`) only when capability `port_forward_range`. Conflicts with existing forwards fail `bad_params`. |
| `forward.validate` **(added)** | Check port forward | `{ device: Ref, externalPort: PortSpec, internalPort?: PortSpec, protocol: "tcp" \| "udp" \| "both", forward?: Ref }` | q | none (cached `routing` topic) | `{ ok, issues: { field, message }[], needsReservation }`. Same checks `forward.add` and `forward.update` run (overlap with forwards of the same protocol, port bounds, range capability). `forward` is the one being edited, excluded from the overlap check. |
| `forward.update` | Edit port forward | `{ forward: Ref, ...same fields optional }` | w | `PUT {forward url}` | Also the enable toggle. |
| `forward.remove` | Remove port forward | `{ forward: Ref }` | w | `DELETE {forward url}` | |
| `pinhole.list` | IPv6 firewall rules | `{}` | q | `GET {net}`, `GET {net}/routing`, `GET {net}/devices` | `{ pinholes: Pinhole[], unavailable: string \| null }`, by port. Each pinhole is joined to its device by id or MAC; a missing address takes the device's first global IPv6. Empty on a real network so far ([endpoints.md section 17](../eero-api/endpoints.md)). |
| `pinhole.add` | Add IPv6 rule | `{ device: Ref, protocol: "tcp" \| "udp" \| "both", port: PortSpec }` | w | `POST {net}/ipv6/pinholes` JSON `{device: url, protocol, port}` | |
| `pinhole.remove` | Remove IPv6 rule | `{ pinhole: Ref }` | w | `DELETE {pinhole url}` | |

### updates (`commands/updates.ts`)

| id | label | params | effect | eero endpoint(s) | notes |
| --- | --- | --- | --- | --- | --- |
| `updates.get` | Software updates | `{}` | q | `GET {net}/updates`, `GET {net}/eeros` | `Updates`: current (the gateway's) and target eeroOS, can update now, scheduled time, preferred hour, per-eero versions (from the eeros; the updates object has none), stuck eeros from `last_user_update`. Status from `update_status`, else `has_update` and a scheduled time. Polls every 15 min. |
| `updates.install` | Install update now | `{}` | d | `POST {net}/updates` empty-JSON | Only when `canUpdateNow`. Every eero restarts, about 10 minutes. |
| `updates.hour.set` | Preferred update time | `{ hour: 0..23 }` | w | `POST {net}/updates/preferred_update_hour` JSON | |
| `updates.notes` | Release notes | `{}` | q | `GET {net}/updates`, `GET {net}/eeros`, then `GET updates.manifest_resource` (absolute URL, not api-user) | `ReleaseNotes \| null` (null when eero names no manifest). The manifest is `{target, history[]}`, each `{title, os_version, release_date, features: string[]}`; the result is the entry (target or history) of the version being installed, else the one running now (leading `v` and build suffix ignored), null when the manifest has none. Fetched by `EeroClient.fetchPublic` **without** the session cookie or token header, https only (the fake server's own loopback origin is the one exception), no redirects, 1 MB cap. Cached 6 h (`release_notes`). |

### admins (`commands/admins.ts`)

| id | label | params | effect | eero endpoint(s) | notes |
| --- | --- | --- | --- | --- | --- |
| `admin.list` | User permissions | `{}` | q | `GET {net}/members`, `GET {net}/invites` (plus the shared account and permissions reads) | `AdminList`: owner first then admins by name, invites newest first, seats used (members, owner included) of 10. eero sends no member email, so there is none. `isYou` is decided in core: the member whose name is the account name, narrowed by this network's role. Invites answer 403 for an admin; that part is empty, not an error. |
| `admin.invite.create` | Invite an admin | `{ nickname?: string, email?: string }` | w | `POST {net}/invites` JSON `{invite_role: "admin"}`, then `PUT {net}/invites/{id}` `{invite_nickname}` | Returns `{ inviteUrl, expiresAt }` for the QR and copy link. Email sending, if any, is the user's mail app. |
| `admin.invite.cancel` | Cancel invite | `{ invite: Ref }` | w | `DELETE {net}/invites/{id}` | |
| `admin.nickname.set` **(added, unverified)** | Admin nickname | `{ admin: Ref, nickname: string(0..32) }` | w | unknown; only `PUT {net}/invites/{id}` `{invite_nickname}` is known, for invites | Ship only if a member nickname endpoint is found (MANUAL check in the eero app or a capture). Until then the UI shows nicknames read-only. |
| `admin.remove` | Remove admin | `{ admin: Ref }` | x | `DELETE {net}/admins/{user_id}` | Owner only. Can not remove the owner. |
| `network.transfer` | Transfer network | `{ name: string, email: string, phone?: string, networkName: string }` | x | `POST {net}/transfer` form `{name, email, phone}` | `networkName` must equal the current network name (the type-to-confirm step). Owner only. |

### activity (`commands/activity.ts`)

| id | label | params | effect | eero endpoint(s) | notes |
| --- | --- | --- | --- | --- | --- |
| `events.list` | Event stream | `{ cursor?: string, limit?: 1..50 (1..1000 with csv), type?: EventCategory[], device?: Ref, eero?: Ref, profile?: Ref, search?: string, since?: string, until?: string, grouped?: boolean, format? }` | q | `GET {net}/app_events?page_size=50&timestamp=` | `EventPage`: events newest first, `nextCursor`, counts per category for the page. Filters apply in core; device, eero and profile match refs, or the name in the text for events without refs (the real stream has none). `grouped` folds events of the same type and title within an hour into the newest (`grouped` on the row); `limit` still counts events. Reads at most 10 backend pages per call (20 for CSV). `format: "csv"` is the Export CSV button (there is no separate export command), never grouped. |
| `events.summary` **(added)** | Event summary | `{ range: "day" \| "week", bucket?: "hour" \| "day", type?: EventCategory[], device?: Ref, eero?: Ref, profile?: Ref }` | q | `GET {net}/app_events` pages back past the range start, at most 20 pages (cached 120 s, `events` topic) | `EventSummary`: total, daily average, `prior` and `change` against the same length of time before the range (null when history does not reach back, as for a week on a ~7 day account), counts per category and per bucket (network time zone; default hour for day, day for week), `partial` when the page budget ran out. Activity hero, chart and day bars, App & account "this week" counts. |

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
| `notifications.mark_read` | Mark all read | `{}` | w | `POST {net}/notifications/mark_read` | Not built yet; the bell shows it disabled ("Coming soon"). |
| `notifications.settings.get` | Notification settings | `{}` | q | `GET {net}/notifications`, push from `GET /2.2/account` | `NotificationSettings`: eero keys as sent minus the eero Plus ones (`premium.*`, `backup.*`), the account's push choices, and desktop choices from `settings.json` `desktopNotifications` over the default `{ enabled: true }`. Desktop alerts are off when `enabled` is false. |
| `notifications.settings.set` | Notification settings | `{ eero?: Record<string, boolean>, desktop?: Record<string, boolean> }` | w | `PUT {net}/notifications` with the full merged map | Not built yet. Keys contain dots (`device.new`); sent as-is. Desktop choices only touch `settings.json`. |

### diagnostics (`commands/diagnostics.ts`)

| id | label | params | effect | eero endpoint(s) | notes |
| --- | --- | --- | --- | --- | --- |
| `health.check` | Network health check | `{}` | q | `GET {net}`, `GET {net}/eeros`, `GET {net}/updates`, `GET {net}/diagnostics` | `HealthReport`: checks for internet, DNS, each eero, mesh links, firmware, each `good \| warning \| problem` with a one-line detail. Composite of cached topics; no active probes. |
| `diagnostics.run` | Diagnose | `{ symptom?: "internet_slow" \| "internet_offline" \| "connection_drops" \| "eeros_red", device?: Ref }` | w | `POST {net}/diagnostics`, then `GET {net}/diagnostics` | `DiagnosticsResult`. Cloud-side tests; can take a minute. |
| `support.info` | Get help | `{}` | q | `GET {net}/support` (pinned to `/2.2/`), `log_id` from `GET /2.2/account` | `SupportInfo`: eero and ISP contacts, support ID. |
| `support.report` **(added)** | Copy diagnostics report | `{}` | q | composite of cached topics | Plain-text report for "Copy diagnostics report". Redacts MACs, IPs, names and serials except the last four characters. Built in core. |

### app (`commands/app.ts`, scope app, no eero)

| id | label | params | effect | eero endpoint(s) | notes |
| --- | --- | --- | --- | --- | --- |
| `app.info` | About | `{}` | q | none | `AppInfo`: version, Electron, OS, arch, backend, `fakeServer` (true only against the local fake eero server), session storage, update status, config dir. |
| `app.settings.get` | App settings | `{}` | q | none | `AppSettings` from `settings.json`. |
| `app.settings.set` | App settings | `Partial<AppSettings>` | w | none | User-Agent override, plan speed, desktop notifications, open on launch. |
| `app.cli.install` | Install command line tool | `{}` | w | none | macOS symlink into `/usr/local/bin`, AppImage `~/.local/bin`. On Windows, deb and rpm it reports where the installer put it. |
| `app.audit.list` **(added)** | Recent CLI and agent commands | `{ limit?: 1..200 }` | q | none | Reads `audit.jsonl` in the config dir for the App & account "This week" list. Entry format, redaction and cap are in [security.md](security.md#audit-log); never results. |

### integrations (`commands/integrations.ts`) (added)

Partner features on the Advanced networking page. Response shapes come from
LD only and need a MANUAL check before shipping.

| id | label | params | effect | eero endpoint(s) | notes |
| --- | --- | --- | --- | --- | --- |
| `integrations.get` **(added)** | Integrations | `{}` | q | `GET {net}` only (shared): `homekit`, `amazon_account_linked`, embedded `proxied_nodes`, `ffs`, `capabilities` | `Integrations`: HomeKit, Amazon linked, eero Built-in, Smart Home Hub, Frustration-Free Setup, each with `available` and `enabled`. `GET {net}/proxied_nodes` answers 404 on a real network, so eero Built-in is the network's embedded `proxied_nodes`. A missing or null field is unavailable, not an error (`homekit: null` is unavailable). Smart Home Hub is available only when a `smart_home_hub` or `zigbee` capability says so. |
| `integrations.amazon.unlink` **(added)** | Unlink Amazon | `{}` | x | `POST /2.2/amazon/networks/{id}/account_unlink` | Owner only. Linking needs Amazon sign-in in a browser and is out of scope. |
| `integrations.builtin.set` **(added)** | eero Built-in | `{ enabled: boolean }` | w | `PUT {net}/proxied_nodes` JSON `{enabled}` | Network-wide switch; eero has no per-device toggle. |
| `integrations.zigbee.discover` **(added)** | Discover Zigbee devices | `{}` | w | `POST /2.3/networks/{id}/shh/start_zigbee_discovery` | `/2.3/` only. Pairing finishes in the Alexa app. Open question whether Smart Home Hub is free. |
| `integrations.ffs.set` **(added)** | Frustration-Free Setup | `{ enabled: boolean }` | w | `PUT {net}/settings` JSON `{ffs}` | |

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
