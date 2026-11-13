# eero client

The one HTTP client for eero's cloud API. It lives in `src/core/eero/` and is
the only code in Mesh UI that talks to eero. Commands reach it through the
`eero` backend; the `demo` backend replaces it with fixtures. Raw endpoint and
field references are in [eero-api/endpoints.md](../eero-api/endpoints.md) and
[eero-api/data-model.md](../eero-api/data-model.md).

The API is unofficial and undocumented. Everything below comes from reading
open source clients (see [Prior art](#prior-art)); none of it was tested by
the project against the live API. Agents never call it (see
[testing.md](../testing.md)).

## Where it sits

```text
engine.execute(id, params)
  -> command.run(ctx, params)
     -> ctx.backend (Backend interface)
        -> EeroBackend   -> EeroClient (src/core/eero/)  -> https://api-user.e2ro.com
        -> DemoBackend   -> in-memory fixtures
```

- `EeroClient` knows HTTP, auth, versions, encodings, rate limits and error
  mapping. It returns raw `data` from the eero envelope.
- The eero backend (`createEeroBackend` in `backend/index.ts`) implements
  `Backend` with one factory per area (`backend/<area>.ts`, typed
  `EeroArea<"area">`). Each factory gets an `EeroContext`
  (`{ options, client }`), calls eero only through `ctx.client`, and maps raw
  shapes into the model in `src/core/model.ts`. Mapping lives there and
  nowhere else. Areas not built yet answer "not available yet" (see
  [backends.md](backends.md#composing-a-backend)).
- Commands call `ctx.backend`, never the client. A command cannot see a raw
  eero response or the token.

## Module layout

| File | Holds |
| --- | --- |
| `src/core/eero/client.ts` | `EeroClient`: request pipeline, envelope parsing, token custody and rotation, refresh-and-replay, sign-in (`startLogin`, `verifyLogin`, `resendLogin`, `logout`, `status`), and `mapError` from HTTP status and `meta.error` to `BackendError` codes |
| `src/core/eero/ratelimit.ts` | `RateLimiter`: request budget, in-flight cap, serial writes, 429 pause; `parseRetryAfter` |
| `src/core/eero/urls.ts` | Origin check (`checkOrigin`), URL resolution and version rewriting (`resolveUrl`), device write paths, ids from links, `Links`, path redaction |
| `src/core/eero/raw.ts` | Raw response types, limited to fields we read; `asList`, `linkUrl` |
| `src/core/eero/backend/index.ts` | `createEeroBackend`, `EeroContext`, `EeroArea`: composes the area factories |
| `src/core/eero/backend/<area>.ts` | One area of `Backend`: calls `ctx.client`, maps raw to model (added per area) |

`BackendError` itself lives in `src/core/errors.ts`, shared with the demo
backend.

## Request pipeline

Every request goes through one function, `client.request(spec)`, where `spec`
is a `RequestSpec`: `{ method, path, version?, query?, body?, encoding?, effect?, auth? }`.

1. **Resolve the URL.** Prefer links the API hands back (`network.url`,
   `resources.*`, item `url`) over building paths. `path` is a versioned API
   path (`/2.2/...`) or a same-origin absolute URL; a bare id is refused.
   Rewrite the version prefix when the call needs one (below).
2. **Check the origin.** The final URL must be on the client's origin with a
   path under `/2.2/`, `/2.3/` or `/2.4/`. Anything else is refused before
   the request is built, so the token can never be sent elsewhere. The
   origin is `https://api-user.e2ro.com` unless the `origin` option is set,
   which is for dev and tests only: `checkOrigin` accepts nothing but the
   real API or a loopback `http` origin (`127.0.0.1`, `localhost`, `[::1]`)
   for the fake eero server.
   The one exception is the firmware release notes manifest, to be fetched
   with a separate unauthenticated call (no cookie, no token header). Not
   yet built in M1.
3. **Wait for budget** in the limiter (see [Rate limits](#rate-limits)).
4. **Send** with the standard headers and a 30 s timeout. No redirects
   (`redirect: "error"`).
5. **Adopt a rotated token** from any `Set-Cookie: s=...` on the response
   (regex `(?:^|,\s*)s=([^; ,]+)`), and tell the host `SecretStore` to save it.
6. **Parse the envelope** `{ meta: { code, server_time, error? }, data }`.
   An empty body is valid (`data` is `null`). A 2xx status with `meta.code`
   outside 200-299 is a failure. Bodies over 10 MiB are refused.
7. **Refresh on demand.** On 401 with `meta.error` = `error.session.refresh`,
   run the refresh flow and replay the original request once.
8. **Map errors** to a `BackendError` with an engine code (see
   [Errors](#errors)).

### Headers

| Header | Value |
| --- | --- |
| `Accept` | `application/json` |
| `X-Accept-Language` | `en-US` |
| `User-Agent` | App-like string, configurable (below) |
| `Cookie` | `s=<token>` |
| `X-User-Token` | `<token>` (also accepted by eero; sent alongside the cookie) |
| `Content-Type` | Per encoding: `application/json` or `application/x-www-form-urlencoded` |

No cookie jar. The client manages `s=` by hand so stale `Set-Cookie` values
are never replayed blindly.

### User-Agent

eero returns fewer capabilities to generic or old clients (one client measured
41 capable features with an old UA and 76 with a current one), moves some
resource links to `/2.3/` for current UAs, and may throttle non-mobile clients
harder. There is also `error.app.version.blocked` for refused UAs.

- Default: an app-like string in the style of `eero-ios/2026.8.1 (iPhone; iOS 18.5)`.
- Configurable through `settings.json` (`userAgent`), read by both the
  app and the CLI. Not exposed as a UI control; it is an escape hatch for when
  eero blocks the default.
- When `error.app.version.blocked` comes back, the error message tells the user
  the UA was refused and how to change it.

### Body encodings

eero mixes encodings per endpoint. The client never guesses: each backend
method states its encoding.

| Encoding | Used for (examples) |
| --- | --- |
| JSON | Most settings, profiles, devices, schedules, forwards, reservations |
| Form | Login and verify, account name, email and phone, LED (`led_on`, `led_brightness`), eero `location`, network `name`, passwords, guest network, blacklist `mac`, `led_cycle`, nightlight override |
| Empty JSON | Parameterless POSTs (reboot, speed test, burst reporter, mark read): the literal body `""` |
| Query only | Every GET. A GET with a body gets 400 on some endpoints. Times are ISO-8601 UTC (`2026-11-05T00:00:00Z`), URL-escaped |

### API versions

| Version | Used for |
| --- | --- |
| `/2.2/` | Default. Account, network, eeros, profiles, settings, guest, updates |
| `/2.3/` | **All device writes** (pause, nickname, type, profile, backup-internet access), placement test and rating, multi static IP |
| `/2.4/` | Coverage scan and Wi-Fi generation ("upgrade report") scan |

Device writes on `/2.2/` return 200 but do not save. `urls.ts` rewrites the
device URL to `/2.3/networks/{id}/devices/{mac}` for every device write, and
a client test proves it (see [testing.md](../testing.md#fake-eero-server)).

`forwards`, `routing` and `support` may be published on `/2.3/` by a current
UA. `forwards` and `routing` have the same shape on both; `support` differs,
so it is pinned to `/2.2/`.

## Auth and session

Passwordless, two steps, driven by the `auth.*` commands.

| Step | Command | eero call | Notes |
| --- | --- | --- | --- |
| Send code | `auth.login.start {login}` | `POST /2.2/login` (form `login`) | `login` is an email or E.164 phone. Returns a pending `user_token`, held in engine memory only |
| Resend | `auth.login.resend` | `POST /2.2/login/resend` | Allowed once per 60 s. `error.too.many.resends` maps to `rate_limited` |
| Verify | `auth.login.verify {code}` | `POST /2.2/login/verify` (form `code`, cookie `s=<pending>`) | On success the pending token becomes the session. Prefer a new value from `Set-Cookie s=` or `data.user_token` if present |
| Refresh | (automatic) | `POST /2.2/login/refresh` | See below |
| Sign out | `auth.logout` | `POST /2.2/logout` | Best effort; the local session is cleared first, whatever eero answers |

- A wrong code (`error.code.invalid`, `error.verification.invalid`) keeps the
  pending token so the user can retry.
- Tokens beginning `eero-web-` are a retired web credential and are rejected.
- Amazon login is not supported (it needs Amazon's OAuth flow). The sign-in
  screen says so.

### Refresh and replay

On HTTP 401 with `meta.error` = `error.session.refresh`:

1. Single-flight: if a refresh is already running, wait for it instead of
   starting another.
2. `POST /2.2/login/refresh` with the current token.
3. Take the new token from `Set-Cookie s=` or `data.user_token`; if neither is
   present, keep the old one. Save it through the `SecretStore`.
4. Replay the original request once. A second 401 is final.

Treat `error.session.invalid` the same way (one client does). Any other 401,
or 419, or `error.session.expired` / `error.session.revoked`, means the session
is gone: clear it and return `not_signed_in`.

Refresh is safe to replay for writes because the original write was rejected
before it ran; this is the one case where a write is sent twice.

### Token custody

The token lives in one place: a private field of the `EeroClient`. The
client loads it from the host's `SecretStore` on first use, saves every
rotation back to it, and clears it when the session ends (reporting the
change through `onSessionChange`). It persists only through the `SecretStore`
(see [security.md](security.md)). No command returns the token, no log line
contains it, and errors are built from status and `meta.error`, never from
request headers.

## Rate limits

eero tolerates roughly 100 requests a minute per account before answering 429.

- **Budget.** A token bucket of 80 requests per rolling minute, shared by all
  callers in the process. Requests beyond it wait.
- **Concurrency.** At most 4 requests in flight; writes are serialised
  (one at a time, in order).
- **429.** Honour `Retry-After` (seconds or HTTP date); without one, back off
  30 s. Also treat `meta.error` = `error.rate.limit` on any status as a 429.
- **Retries.** Only `query` requests are retried: on 429 after the wait, and on
  network errors or 5xx with backoff (1 s, 4 s), at most twice. Writes are
  never retried; a failed write returns its error. If the wait would exceed
  20 s the request fails with `rate_limited` and `retryAfterSec` instead of
  blocking the caller.
- **Burst reporter.** `POST {net}/burst_reporters` (behind
  `device.rates.refresh`) is allowed once a minute per network. Core
  enforces this, not the limiter (not yet built in M1) (see `DeviceBackend.requestBurst`); a second
  call inside the minute returns the last result's `nextBurst` without
  calling eero. Fresh `usage.down_mbps` /
  `up_mbps` appear on devices about 12 s after a burst.
- **Polling.** Polling intervals are constants in `src/core/poll.ts`, shared by
  every surface. The renderer only polls while the window is visible.

| Data | Interval |
| --- | --- |
| Network, eeros, devices, profiles | 60 s |
| Device rates (burst, then `device.list`) | 60 s, only while a page shows live rates |
| Notifications | 60 s |
| Usage charts | 5 min |
| Speed test history, updates, settings | On open and after a write |

The CLI has no background polling. Scripts that loop must pace themselves;
the limiter still protects the account.

There is no network-wide live throughput history in the API. Live rates come
only from bursts and are not stored beyond what the renderer keeps in memory
for the current view.

## Errors

The client throws `BackendError { code, message, detail? }` (from
`src/core/errors.ts`); `mapError` in `client.ts` builds it. The engine
catches it and returns `{ ok: false, error: { code, message, detail } }`.
Engine codes are the fixed set from AGENTS.md; finer detail goes in
`error.detail` (`{ status, eeroError, retryAfterSec }`) so surfaces can
choose wording.

| eero answer | Engine `code` | Notes |
| --- | --- | --- |
| 401 `error.session.refresh` | (refresh and replay) | Becomes `not_signed_in` if refresh fails |
| 401 / 419, `error.session.expired`, `.invalid`, `.revoked` | `not_signed_in` | Session cleared |
| 401 `error.code.invalid`, `error.verification.*` | `eero_error` | Pending login kept |
| 402, `error.premium.*` | `eero_error` | Should not happen: Plus features have no commands |
| 403 | `eero_error` | `detail.status = 403`; UI says "Your role can't change this" |
| 404 / 405, `error.eero.not.capable`, `error.network.unavailable` | `eero_error` | Not available on this network or model |
| `error.eero.offline` | `eero_error` | The eero is offline |
| 429, `error.rate.limit`, `error.too.many.resends` | `rate_limited` | `detail.retryAfterSec` |
| `error.app.version.blocked` | `eero_error` | Suggests changing the User-Agent |
| Other 4xx / 5xx | `eero_error` | Message includes status and `meta.error` |
| DNS failure, TLS error, timeout, offline | `network_error` | Never `eero_error` |

Messages are written for people ("eero says the Office eero is offline"),
not raw codes. They never include request bodies, because bodies can hold
Wi-Fi passwords.

## Capabilities and permissions

Feature visibility is driven by data, not guesses:

- `network.capabilities[name].capable` decides whether a setting exists on this
  network (for example `led_action`, `device_blacklist`, `wpa3`, `sqm`,
  `thread_network`, `port_forward_range`, `power_saving`).
- `GET {net}/permissions` (`network.permissions`) decides whether the signed-in
  role may change it.
- `connection.mode` = `bridged` or `ipPassthrough` disables profiles, routing,
  reservations and forwards.
- Per-port and per-node actions are only offered when listed in the eero's
  `connections` response (`actions[]`, `node_actions[]`).

The model exposes these as plain flags (`model.Network.can.pauseDevices`,
`...can.editDns`), so surfaces never read raw capability names.

## Dangerous writes

From client reports, these restart eeros or drop clients, so their commands are
`disruptive` and need `confirm: true`:

- Any `PUT {net}/settings` write. DNS and DHCP writes were seen to reboot every
  eero for about 8 minutes. Read first, skip the write when nothing changed,
  never loop.
- Network, eero and port reboots, firmware install.
- Wi-Fi name, password and security changes; guest disable, rename and password.
- `mlo_mode`, `wpa3_per_band`, connection mode, WAN, IPv6.

`destructive` (cannot be undone): remove eero, delete profile, remove admin,
transfer network, delete account, reset Thread credentials.

Silent no-ops to avoid:

- Device writes on `/2.2/` (use `/2.3/`).
- JSON `{led_on}` PUT to the eero URL (use form PUT to `resources.led_action`).
- Filters or schedules written onto the profile object (schedules go to
  `{profile}/schedules`).
- `device labels` PUT.

## Command to endpoint map

The main calls behind each command family. Full rows are in
[endpoints.md](../eero-api/endpoints.md).

| Commands | eero calls |
| --- | --- |
| `auth.*` | `/2.2/login`, `/login/verify`, `/login/resend`, `/login/refresh`, `/logout` |
| `account.*` | `GET /2.2/account`, `PUT /2.2/account/{name,email,phone,consents,push_settings}`, `POST .../verify`, `DELETE /2.2/account` |
| `network.list`, `network.get`, `network.health` | `GET /2.2/account` (network refs), `GET {net}` |
| `network.permissions` | `GET {net}/permissions` |
| `network.nickname.set` | `PUT {net}/label?labelType=specialMarket` |
| `network.restart` | `POST {net}/reboot` |
| `internet.get`, `speedtest.*` | `GET {net}` (`speed`, `geo_ip`, `ip_settings`), `GET/POST {net}/speedtest` |
| `usage.get`, `usage.breakdown` | `GET {net}/data_usage[/devices/{mac} \| /eeros/{id} \| /profiles/{id}]`, `/data_usage/breakdown` |
| `eero.list`, `eero.get` | `GET {net}/eeros`, `GET {eero}` |
| `eero.rename`, `eero.restart` | `PUT {eero}` (form `location`), `POST {eero}/reboot` |
| `eero.led.set`, `eero.find`, `eero.nightlight.set` | `PUT resources.led_action` (form), `POST /2.2/eeros/{serial}/led_cycle`, `PUT {eero}/nightlight/settings` |
| `eero.ports.get`, `eero.port.action` | `GET {eero}/connections`, `POST {eero}/ports/{n}/action` |
| `eero.firmware.history`, `eero.remove` | `GET /2.2/eeros/{id}/firmware_update/history`, `DELETE {eero}` |
| `eero.placement.test`, `coverage.*` | `/2.3/networks/{id}/placement_test/{serial}`, `/2.4/networks/{id}/placement/wifi_{coverage,generation}_scan` |
| `device.list`, `device.get` | `GET {net}/devices`, `GET {device}` |
| `device.rates.refresh` | `POST {net}/burst_reporters` |
| `device.pause`, `.resume`, `.rename`, `.type.set`, `.profile.set` | `PUT /2.3/networks/{id}/devices/{mac}` |
| `device.block`, `.unblock` | `POST {net}/blacklist` (form `mac`), `DELETE {net}/blacklist/{mac}` |
| `profile.*` | `GET/POST {net}/profiles`, `PUT/DELETE {profile}`, `{profile}/schedules` |
| `guest.*` | `GET/PUT {net}/guestnetwork`, `PUT {net}/guestnetwork/password` |
| `wifi.*` | `GET {net}` (`name`, `password`), `PUT {net}/settings` (form `name`), `PUT {net}/password`, `{net}/wpa3_per_band`, `{net}/temporary_flags/hide_5g` |
| `settings.*` | `PUT {net}/settings`, `{net}/fast_transition`, `{net}/mlo_mode`, `{net}/power_saving`, `{net}/thread` |
| `reservation.*`, `forward.*`, `pinhole.*` | `GET {net}/routing`, `{net}/reservations`, `{net}/forwards`, `{net}/ipv6/pinholes` |
| `updates.*` | `GET/POST {net}/updates`, `POST {net}/updates/preferred_update_hour`, `manifest_resource` (no auth) |
| `admin.*`, `network.transfer` | `{net}/members`, `{net}/invites`, `DELETE {net}/admins/{id}`, `{net}/transfer` |
| `events.list`, `notifications.*` | `GET {net}/app_events`, `{net}/notifications_history`, `{net}/notifications`, `POST .../mark_read` |
| `health.check`, `diagnostics.run`, `support.info` | Composite of `GET {net}`, `{net}/eeros`, `{net}/updates`; `POST {net}/diagnostics`; `GET {net}/support` (2.2) |

Pagination is rare. `events.list` and `notifications.list` take a `cursor`
that wraps eero's `timestamp`; `eero.firmware.history` uses `limit` and
`offset`. Every other list comes back whole.

## Lenient parsing

List responses vary: a bare array, `{ data: [...] }`, or a named key
(`devices`, `members`, `invites`, `schedules`). `raw.ts` has one helper,
`asList(data, key)`, that accepts all of them. Every raw field is optional;
mapping code supplies `null` for missing values and the UI shows `-`.

## Prior art

Open source clients reviewed for this design (source read, nothing run):

| Code | Project | Why it matters |
| --- | --- | --- |
| FF | fulviofreitas/eero-api (Python) | Most complete; many writes marked live-verified; documents no-ops, mesh reboots, rate limits and UA effects |
| LD | Los33c/unofficial_eero_desktop_native (C#, Swift) | A desktop clone of the eero app; documents every request, body and validation rule |
| SX | schmittx/home-assistant-eero (Python) | Long-standing Home Assistant integration; shows what is practical to poll and toggle |
| ES | EvanSchalton/eero-client (Python) | Typed models of account, network, eero and device |
| EH | erikh/eero (Rust) | Typed client and CLI |
| MX | 343max/eero-client (Python) | The original reverse engineering |

Validation rules worth copying from LD: SSID 1-32 bytes, Wi-Fi passwords 8-63
printable ASCII, phone numbers normalised to E.164.
