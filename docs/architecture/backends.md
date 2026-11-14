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
  network: NetworkBackend;   // list, get, health, permissions; restart
  internet: InternetBackend; // get, speedTests; runSpeedTest
  usage: UsageBackend;       // series, breakdown
  eero: EeroBackend;         // list, get, ports, firmwareHistory; rename, find, setLed, setNightlight, restart
  device: DeviceBackend;     // list (includes blocked), get, requestBurst; setPaused, rename, setType, setProfile, setBlocked
  profile: ProfileBackend;   // list, get; create, rename, setPaused, setDevices, remove, setUnassignedPaused,
                             //   addSchedule, updateSchedule, removeSchedule
  events: EventsBackend;     // list(net, cursor): one page, newest first
  routing: RoutingBackend;   // get: reservations, forwards, pinholes, LAN map
  updates: UpdatesBackend;   // get
  guest: GuestBackend;       // get (no password), credentials (sensitive); setEnabled, rename, setPassword
  wifi: WifiBackend;         // get (no password), credentials (sensitive); setName, setPassword, setSecurity, setHide5g
  settings: SettingsBackend; // get (no Thread secrets), threadCredentials (sensitive)
  diagnostics: DiagnosticsBackend; // latest, support
  admins: AdminsBackend;     // list: admins and invites (seats in core)
  integrations: IntegrationsBackend; // get
  notifications: NotificationsBackend; // list(net, cursor), unread, settings; markRead
}

export interface Backend extends BackendAreas {
  readonly kind: "eero" | "demo";
}
```

The file holds the M1 to M3 methods, which are all reads plus sign-in.
M2.1 added `eero.ports`, `eero.firmwareHistory` and the `routing` and
`updates` areas; the demo backend answers them, while the eero backend
answers "not available yet" until the M2 stories that map them (M2.5 updates,
M2.6 ports and firmware, M2.7 routing). M3.1 added the `guest`, `wifi`,
`settings`, `diagnostics`, `admins`, `integrations` and `notifications`
areas the same way: the demo backend answers them, and the eero backend
answers "not available yet" until the M3 story that maps each one. M4.1
added the M4 writes (after the `;` above) the same way: the demo backend
applies them all, and the eero backend answers "not available yet" for each
until the wave-2 story that builds it. M5 adds its settings writes later.
There is no `activity` area: events have their own `events`
area and notifications theirs. Wi-Fi and guest passwords never travel in
`get`; each has a `credentials` method that only the sensitive share and
reveal commands call, and core builds the `WIFI:` QR payload.

`SecretStore`, the host contract for the session token, is defined in the
same file.

### Writes

A write takes model-shaped input (ids, a nickname, a `ScheduleInput`, a
`LedInput`), makes the change and returns the changed object as the next
read would show it (`Device`, `Profile`, `GuestNetwork`, `WifiSettings`,
`Eero`, `Schedule`), or nothing when eero only accepts the request and acts
later (restarts, speed test, remove, mark read). Writes never retry and do
no confirmation or cache work: the engine owns `needs_confirm`, the topics
a write invalidates and the settle delay. Notes on the contracts:

- `device.setProfile(net, device, null)` takes the device out of every
  profile. On a real network every device has a `profile` (capture
  2026-11-13), and "no profile" is eero's `default: true` profile, which
  the model shows as Unassigned; the eero backend maps `null` to that
  profile's url.
- `profile.setUnassignedPaused` pauses the Unassigned devices (the default
  profile), which is not a `Profile` in the model.
- Schedules are written through `{profile}/schedules`, but read only from
  the profile's `schedule[]` (the GET there is a 404).
- `wifi.setName` changes the SSID, which is also the network's `name`.
- `eero.setNightlight` is Beacon only; other eeros fail with `eero_error`.

`WRITE_METHODS` in `backend.ts` lists each area's writes. An eero area
file returns `PartialWrites<K>`: every read, and whichever writes are built.
`composeBackend` wraps each area in `partialArea`, so a missing write
answers "not available yet" instead of failing typecheck, and each wave-2
story adds its methods without touching the others.

### Composing a backend

`composeBackend(kind, areas)` builds a `Backend` from the areas given and
fills every missing one with `unimplementedArea(kind, area)`, whose methods
all reject with `eero_error` "`<area>.<method>` is not available in the
`<kind>` backend yet". So the engine and every surface run while a backend
is only partly built. The eero backend is made this way: it registers one
factory per area file in `src/core/eero/backend/index.ts`, each wrapped in
`partialArea` (see Writes). The demo backend (`src/core/demo/backend.ts`)
implements every area and write itself.

### Derived fields are filled by core

Backends return what eero (or the fixtures) know. Fields computed from
other data or from app settings are filled in by core, so the demo backend
gets them for free and both backends agree:

- `NetworkSummary.selected` (backends may leave it `false`),
- `NetworkHealth.issues` (backends omit it),
- `Internet.planMbps` (from app settings) and `Internet.verdict` (backends omit both),
- `SpeedTest.rating` (backends leave it `null`),
- `Eero.hop` and `Eero.meshQuality` (backends leave them `null`),
- `Profile.nextChange` (backends may leave it `null`),
- `usage.breakdown` rows: backends return them unsorted and unfiltered;
  core sorts them and computes each row's `share`, and by profile folds
  every row whose id is not in `profile.list` (eero's default profile, or
  no id) into one Unassigned row with a null id,
- summaries such as `DeviceList.summary` (including `byEero`, `byProfile`
  and `byManufacturer`), and composites such as
  `health.check` and `support.report`.

The once-a-minute limit on `device.requestBurst` also belongs in core.

Not yet built in M1: the command registry is still empty, so nothing in core
fills these fields or enforces the burst limit yet; the commands that read
them do it as they land.

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
  manifest is fetched through a separate cookieless call, `fetchPublic`:
  https only, 1 MB cap, no rate limiting (M3.13).
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

- **Writes apply** (M4.1). Every write changes the in-memory fixtures, so
  the next read shows it and derived fields follow: pausing a device clears
  its live rates, blocking it drops it off (unblocking puts it back as it
  was), a profile's state follows its pause and schedules, deleting a
  profile moves its devices to Unassigned, the guest network's online count
  drops to 0 when it is off, an open guest network has no security, and a
  speed test result appears at once (eero takes about a minute). Restarts
  set the eero, or the network and every reachable eero, to `updating` and
  back to the old status after `RESTART_MS` (5 s, not minutes), so the
  restart flow can be checked; an offline eero refuses to restart. The 2.4
  GHz only window lasts 20 minutes (`HIDE_5G_MS`; eero picks its own) and
  ends on its own. New profiles and schedules get `demo-profile-<n>` and
  `demo-schedule-<n>` ids, counted from 1 again on reset. M5 settings writes
  are not in the demo yet.
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
- **Ports, firmware, routing, updates.** Port status, speed and attachment
  come from the connected devices' `wiredPort` (the gateway WAN port takes
  the internet gateway's speed); firmware history is stored newest first
  and `current` marks the entry equal to the eero's firmware; forwards per
  reservation come from the lists (the pool's leased count is left at 0
  for core's `reservation.list` to count, as with the eero backend); per-eero
  update versions come from the eeros. Bridge mode (Mom's House) answers
  routing with empty lists and no LAN map.
- **Guest, Wi-Fi and settings (M3).** Guests are the devices with
  `ssid: "guest"` (online only while the guest network is on); Wi-Fi bands
  merge every eero's radios, with clients from the connected devices and a
  band off when no eero broadcasts on it; settings take DHCP from the LAN
  map (bridged in bridge mode), WAN and the ISP's DNS from the internet
  fixture, and the connection mode and time zone from the network. Passwords
  and Thread secrets come back only from the `credentials` and
  `threadCredentials` methods.
- **Notifications, admins, support, integrations (M3).** Stored per
  network; `unread` is true when any stored notification is unread, and
  notifications page by 50 like events.
- **Read modes.** The `slow` scenario delays every method of every area but
  `auth` by `slowMs` (1.5 s by default), and `errors` makes them fail with
  `eero_error` (status 503), so loading and error states show in demo while
  sign-in and `demo.scenario.set` keep working.
- **Errors on purpose.** Device writes on "Flaky Plug" (Maple Street) fail
  with `eero_error` (status 503, `error.eero.offline`) and change nothing,
  so error states are reachable in the UI without a real network. The
  `errors` scenario fails every write too.
- **Reset.** Each process starts from the pristine fixtures, and
  `demo.scenario.set` rebuilds them, which undoes every write. Tests create
  a fresh demo backend per test.
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
  Homework, Leo paused), a guest network that is on with one guest seen this
  week (Sam's Pixel, offline now), 8 reservations, 5 port forwards (3 on
  Alex's MacBook Pro, 1 each on the Synology NAS and PlayStation 5, all
  reserved), 2 IPv6 pinholes (on the reserved NAS and PlayStation 5),
  Thread on, eeroOS 7.13.0 scheduled for the next 2 AM window, Wi-Fi on
  2.4, 5 and 6 GHz with three WPA2-only devices, power saving with an
  overnight schedule, a last diagnostics run with a mesh warning (the
  Garage link), eero and ISP support contacts, two admins (Alex owner, Jamie
  admin) and one pending invite, integrations with Amazon and eero Built-in
  on, and six notifications, three unread.
- Lake Cabin has an open guest network (no password) and Thread off. Mom's
  House is in bridge mode: guest network off, no Thread, no power saving,
  DHCP bridged, and Alex is an admin there (Rose Kim owns it), so invites
  are empty.
- Every eero has Ethernet ports except the Garage Beacon, a firmware
  history ending at its current version, tx power and auto channel per
  radio, and its LAN subnet and gateway. Devices have `fe80::` link-local
  addresses built from their invented MACs.
- Demo settings: `DEMO_SETTINGS` gives Maple Street the mockup 02 plan
  (1,200 Mbps down and up); Lake Cabin and Mom's House have none. Settings
  are host state, not backend state, so the demo hosts (app window, CLI)
  seed their settings store with it: `memorySettings(DEMO_SETTINGS)`, or
  `fileSettings(path, DEMO_SETTINGS)` with a user data dir, where the file
  wins once written. Tests pass their own settings.
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
followed by a read round-trips through the real mapper. Since M2.1 the
seed also holds raw `connections` per eero, `firmware_update/history` per
eero (seeded oldest first, so mappers must sort), `routing` and `updates`
(the same object the network embeds); the routes that serve them land with
the stories that map them.

Writes (M4.1). PUT, POST and DELETE are parsed like reads (form, JSON, or
the empty-JSON `""` body) and each is also recorded, parsed, in
`fake.writes` (`method`, `path`, `version`, `route`, `contentType`,
`encoding`, `body`, `rawBody`, `status`), whichever route answered it, so a
test asserts the exact request a write sent. Write routes change the seeded
objects in place, so the next GET shows the change; `state.nextId()` gives
ids for created profiles and schedules. Each wave-2 story adds the routes
for its writes, with `versions: ["2.3"]` where eero needs `/2.3/`; a `/2.2/`
device write may answer 200 and change nothing, as eero does, and the test
asserts the recorded `version`.
