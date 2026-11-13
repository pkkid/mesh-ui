# Backends

Commands never talk to eero directly. They call a `Backend`, an interface
at the level of the [data model](data-model.md): methods take ids and
model-shaped inputs and return model objects. There are two
implementations:

- `eero` (`src/core/eero/`): the live cloud API. The only code in the repo
  that makes eero HTTP requests.
- `demo` (`src/core/demo/`): in-memory fixtures that apply writes, so a
  demo pause or rename visibly works.

Because both return the same model, command code, caching, polling and the
UI do not know which one is active. Every command must work on both.

## The interface

The real file is `src/core/backend.ts`; this is a summary. Network-scoped
methods take the network id first. Methods throw `BackendError` (from
`src/core/errors.ts`), which the engine maps to error codes.

The interface is split into one sub-interface per area, named in the
singular to match the area files (`src/core/commands/<area>.ts` and
`src/core/eero/backend/<area>.ts`):

```ts
export interface BackendAreas {
  auth: AuthBackend;         // status, start, verify, resend, logout
  account: AccountBackend;   // get
  network: NetworkBackend;   // list, get, health, permissions
  internet: InternetBackend; // get, speedTests
  usage: UsageBackend;       // series, breakdown
  eero: EeroBackend;         // list, get
  device: DeviceBackend;     // list (includes blocked), get, requestBurst
  profile: ProfileBackend;   // list, get
  events: EventsBackend;     // list(net, cursor): one page, newest first
}

export interface Backend extends BackendAreas {
  readonly kind: "eero" | "demo";
}
```

The file holds the M1 methods, which are all reads plus sign-in. Later
milestones add their writes (renames, pause, restarts, settings) to the
matching area, and new areas (guest, Wi-Fi, settings, routing, updates,
admins, notifications, diagnostics) as they are built. There is no
`activity` area: events have their own `events` area, and notifications
will get theirs.

`SecretStore`, the host contract for the session token, is defined in the
same file.

### Composing a backend

`composeBackend(kind, areas)` builds a `Backend` from the areas given and
fills every missing one with `unimplementedArea(kind, area)`, whose methods
all reject with `eero_error` "`<area>.<method>` is not available in the
`<kind>` backend yet". So the engine and every surface run while a backend
is only partly built. The eero backend is made this way: it registers one
factory per area file in `src/core/eero/backend/index.ts`. The demo backend
(`src/core/demo/backend.ts`) implements every M1 area itself.

### Derived fields are filled by core

Backends return what eero (or the fixtures) know. Fields computed from
other data or from app settings are filled in by core, so the demo backend
gets them for free and both backends agree:

- `NetworkSummary.selected` (backends may leave it `false`),
- `Internet.planMbps` (from app settings; backends omit it),
- `SpeedTest.rating` (backends leave it `null`),
- `Profile.nextChange` (backends may leave it `null`),
- `usage.breakdown` rows: backends return them unsorted and unfiltered;
  core sorts them and computes each row's `share`,
- summaries such as `DeviceList.summary`, and composites such as
  `health.check` and `support.report`.

The once-a-minute limit on `device.requestBurst` is also enforced in core.

## eero backend

`src/core/eero/` holds the client and the backend. Nothing outside it
imports from it except `createEeroBackend` (and the CLI host, which builds
the backend).

| File | Job |
| --- | --- |
| `client.ts` | `EeroClient`: base URL, headers, cookie, envelope, sign-in, refresh, rotation, timeouts, error mapping. |
| `ratelimit.ts` | `RateLimiter`: request budget, in-flight cap, serial writes, 429 pause. |
| `urls.ts` | Origin check, version prefixes (`/2.3/` device writes), ids from links, path redaction for logs. |
| `raw.ts` | Raw eero shapes (every field optional) and the lenient `asList` helper. |
| `backend/index.ts` | `createEeroBackend`: builds one `EeroContext` (`options`, `client`) and composes the area factories. |
| `backend/<area>.ts` | One file per area, each exporting `EeroArea<"area">`: calls `ctx.client` and maps raw shapes to model objects. Added by the stories that build each area. |

### Client rules

Summary of [eero-client.md](eero-client.md), which is the full reference:

- Base `https://api-user.e2ro.com`. The only other origin it accepts is a
  loopback `http` fake eero server (dev and tests). The client refuses any
  other origin for requests that carry the session. The release notes
  manifest is to be fetched through a separate cookieless call, https only,
  1 MB cap (not yet built in M1).
- Headers: `Accept: application/json`, `X-Accept-Language: en-US`, an
  app-like `User-Agent` (default in the style of
  `eero-ios/2026.8.1 (iPhone; iOS 18.5)`, overridable in app settings),
  cookie `s=<token>`.
- Bodies per endpoint: JSON, form (`application/x-www-form-urlencoded`,
  booleans `true` / `false`) or empty-JSON (`""`). The backend area that
  makes the call states the encoding on each request; see the notes column in
  [commands.md](commands.md#catalogue).
- GET params go in the query string, never a body. Times are
  `YYYY-MM-DDTHH:MM:SSZ`.
- Envelope `{ meta: { code, error? }, data }`. A 2xx HTTP status with
  `meta.code` outside 200 to 299 is a failure. Empty `data` is fine.
- Lists are parsed leniently: bare array, `{ data: [...] }` or a named key
  (`devices`, `members`, `invites`, `schedules`).
- **Refresh.** 401 with `meta.error == "error.session.refresh"` (and
  `error.session.invalid`, as SX does): `POST /2.2/login/refresh`, adopt a
  token from `Set-Cookie s=` or `data.user_token`, replay once. Concurrent
  401s share one refresh.
- **Rotation.** Every response's `Set-Cookie` is checked with
  `(?:^|,\s*)s=([^; ,]+)`; a new value replaces the token and is saved
  through the `SecretStore`.
- **Device writes** always use `/2.3/networks/{id}/devices/{mac}`.
- **LED** writes always use the form PUT to `resources.led_action`.
- **Rate limits and retries** as in [engine.md](engine.md#rate-limiting):
  80 a minute, 4 in flight, writes serialised, honour `Retry-After`, retry
  only queries.
- **Error mapping.**

  | eero answer | `BackendError.code` |
  | --- | --- |
  | 401 or 419 after refresh, `error.session.expired` / `invalid` / `revoked` | `not_signed_in` |
  | 429, `error.rate.limit` | `rate_limited` |
  | `error.reservation.ip.invalid`, `error.assignment.ip.unavailable`, other validation codes | `bad_params` |
  | 402, 403, 404, 405, 5xx, `error.eero.offline`, `error.eero.not.capable`, anything else | `eero_error` |
  | fetch failure, timeout, TLS | `network_error` |

- **No secrets in errors.** Messages carry method, a path with ids
  replaced by `:id`, status and `meta.error`. Never headers, cookies or
  bodies.

### Mapping

The area files in `backend/` (and the raw types in `raw.ts`) are the one
place eero field names appear. Each mapper is
defensive: unknown enum values become `null` or `"unknown"`, and a missing
nested object never throws. Field-by-field sources are in
[data-model.md](data-model.md). Mappers are tested against JSON shaped like
the open source clients' redacted fixtures, rewritten with invented values.

## demo backend

`src/core/demo/` implements `Backend` over a mutable in-memory copy of the
fixtures.

- **Writes apply.** pausing a device flips the fixture,
  deleting a profile moves its devices to unassigned, and a new port
  forward appears in the routing list. Restarts set the network or eero to `updating`
  and back to `online` after a short simulated delay (5 s, not minutes), so
  the restart flow can be checked.
- **Auth.** Any login is accepted; the code `000000` (or any 6 digits)
  verifies, `111111` returns a wrong-code `eero_error` so the error state
  can be tested.
- **Live rates.** `requestBurst` returns `nextBurstAt` about 3 s ahead;
  the following `list` gives rates from a seeded random walk around each
  device's typical rate, so charts move but tests stay deterministic with a
  fixed seed and clock.
- **Usage.** Series are generated from per-device daily profiles (TV heavy
  in the evening, laptop in work hours) for the last 7 days, seeded, so
  totals add up across network, eero, profile and device scopes.
- **Events.** A generated stream covering every `EventCategory`, with
  `nextCursor` paging.
- **Errors on purpose.** A device named "Flaky Plug" fails writes with
  `eero_error` (`error.eero.offline`) so error states are reachable in the
  UI without a real network.
- **Reset.** Each process starts from the pristine fixtures. Tests create a
  fresh demo backend per test.
- The demo backend never opens a socket. `--demo` must work offline.

## Fixtures

- Location: `src/core/demo/fixtures.ts`, typed with the model, so a model
  change that is not reflected fails `pnpm typecheck`.
- Content matches the mockups: networks Maple Street (owner, 4 eeros:
  Living Room gateway eero Max 7, Office eero Pro 7, Upstairs Hall eero 7,
  Garage eero Beacon with a weak link), Lake Cabin (offline, 1 eero) and
  Mom's House (admin, 2 eeros).
- Maple Street has about 38 devices across every category and band, 4
  profiles (Alex active, Jamie active, Mia scheduled with Bedtime and
  Homework, Leo paused), a guest network with a few guests, 8 reservations,
  5 port forwards, 2 IPv6 pinholes, Thread on, an available eeroOS update,
  and one pending admin invite.
- Account: Alex Kim, `alex@example.com`, `+1 (555) 010-0142`.
- Every name, MAC, IP, serial and phone number is invented. IPs use
  `192.168.4.x` on the LAN and documentation ranges (`203.0.113.x`,
  `2001:db8::/32`) for public addresses. MACs use a fixed invented prefix.
  Phone numbers use `555-01xx`. Nothing is copied from a real network.

## Fake eero server

The second sandbox layer, in `test/fake-eero/`: a small Node HTTP server
that answers like `api-user.e2ro.com`, built from the shapes in
[../eero-api/endpoints.md](../eero-api/endpoints.md). The real `eero` backend is pointed at it with the
`origin` option (dev and tests only; `checkOrigin` in `urls.ts` accepts
only a loopback `http` origin besides the real API).

It must let tests prove:

- sign in, verify, wrong code, resend limit,
- 401 `error.session.refresh` leads to one refresh and one replay, and
  concurrent requests share the refresh,
- a rotated `Set-Cookie s=` token is adopted and saved,
- dead-session codes give `not_signed_in` and clear the store,
- 429 with `Retry-After` pauses the client, queries retry once, writes do
  not retry,
- device writes go to `/2.3/` and a `/2.2/` device write is a failing test,
- form vs JSON vs empty-JSON bodies per endpoint,
- the release notes fetch carries no cookie,
- `meta.code` failures inside a 2xx are errors,
- lenient list parsing.

The fake server stores state in memory per test, seeded from the same
invented data as the demo fixtures (converted to eero shapes), so a write
followed by a read round-trips through the real mapper.
