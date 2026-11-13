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

A sketch; the real file is `src/core/backend.ts`. Network-scoped methods
take the network id first. Methods throw `BackendError` (below), which the
engine maps to error codes.

```ts
import type * as M from "./model";

export interface Backend {
  readonly kind: "eero" | "demo";

  // auth and account
  auth: {
    start(login: string): Promise<void>;
    verify(code: string): Promise<void>;          // session becomes signed in
    resend(): Promise<void>;
    logout(): Promise<void>;                       // best effort
  };
  account: {
    get(): Promise<M.Account>;
    setName(name: string): Promise<void>;
    setEmail(email: string): Promise<void>;
    verifyEmail(code: string): Promise<void>;
    setPhone(phone: string): Promise<void>;
    verifyPhone(code: string): Promise<void>;
    setConsents(c: { marketingEmails: boolean }): Promise<void>;
    setPush(p: { networkOffline: boolean; nodeOffline: boolean }): Promise<void>;
    delete(): Promise<void>;
  };

  // network
  networks: {
    list(): Promise<M.NetworkSummary[]>;
    get(net: Id): Promise<M.Network>;
    health(net: Id): Promise<M.NetworkHealth>;
    permissions(net: Id): Promise<M.Permissions>;
    setNickname(net: Id, nickname: string): Promise<void>;
    restart(net: Id): Promise<void>;
  };

  // internet
  internet: {
    get(net: Id): Promise<M.Internet>;
    runSpeedTest(net: Id): Promise<{ startedAt: Iso }>;
    speedTests(net: Id, from: Iso, to: Iso): Promise<M.SpeedTest[]>;
    usage(net: Id, q: { scope: M.UsageSeries["scope"]; id: Id | null; from: Iso; to: Iso; cadence: "hourly" | "daily"; timezone: string }): Promise<M.UsageSeries>;
    breakdown(net: Id, q: { by: "device" | "profile" | "eero"; from: Iso; to: Iso }): Promise<M.UsageBreakdown>;
  };

  // eeros
  eeros: {
    list(net: Id): Promise<M.Eero[]>;
    get(net: Id, eero: Id): Promise<M.Eero>;
    rename(net: Id, eero: Id, location: string): Promise<void>;
    restart(net: Id, eero: Id): Promise<void>;
    setLed(net: Id, eero: Id, led: { on?: boolean; brightness?: number }): Promise<void>;
    blink(net: Id, eero: Id, seconds: number): Promise<void>;
    setNightlight(net: Id, eero: Id, n: M.Nightlight): Promise<void>;
    ports(net: Id, eero: Id): Promise<M.EeroPorts>;
    portAction(net: Id, eero: Id, port: number, action: PortAction): Promise<void>;
    firmwareHistory(net: Id, eero: Id, limit: number): Promise<M.FirmwareEntry[]>;
    remove(net: Id, eero: Id): Promise<void>;
    placementTest(net: Id, eero: Id): Promise<M.PlacementResult>;
    coverageScan(net: Id): Promise<M.CoverageScan>;
    upgradeReport(net: Id): Promise<M.UpgradeReport>;
  };

  // devices
  devices: {
    list(net: Id): Promise<M.Device[]>;            // includes blocked
    get(net: Id, device: Id): Promise<M.Device>;
    requestBurst(net: Id): Promise<{ nextBurstAt: Iso }>;
    update(net: Id, device: Id, patch: { paused?: boolean; nickname?: string; type?: DeviceType }): Promise<void>;
    setProfile(net: Id, device: Id, profile: Id | null): Promise<void>;
    block(net: Id, device: Id): Promise<void>;
    unblock(net: Id, device: Id): Promise<void>;
  };

  // profiles
  profiles: {
    list(net: Id): Promise<M.Profile[]>;
    get(net: Id, profile: Id): Promise<M.Profile>;
    create(net: Id, p: { name: string; deviceIds: Id[] }): Promise<M.Profile>;
    update(net: Id, profile: Id, patch: { name?: string; paused?: boolean; deviceIds?: Id[] }): Promise<void>;
    delete(net: Id, profile: Id): Promise<void>;
    addSchedule(net: Id, profile: Id, s: Omit<M.Schedule, "id">): Promise<M.Schedule>;
    updateSchedule(net: Id, profile: Id, schedule: Id, patch: Partial<Omit<M.Schedule, "id">>): Promise<void>;
    removeSchedule(net: Id, profile: Id, schedule: Id): Promise<void>;
  };

  // guest and Wi-Fi
  guest: {
    get(net: Id): Promise<M.GuestNetwork>;
    set(net: Id, patch: { enabled?: boolean; name?: string }): Promise<void>;
    setPassword(net: Id, password: string | null): Promise<void>;
    share(net: Id): Promise<M.WifiShare>;           // sensitive
  };
  wifi: {
    get(net: Id): Promise<M.WifiSettings>;
    password(net: Id): Promise<string>;             // sensitive
    setName(net: Id, name: string): Promise<void>;
    setPassword(net: Id, password: string): Promise<void>;
    setSecurity(net: Id, s: { band24?: Security; band5?: Security }): Promise<void>;
    setHide5g(net: Id, enabled: boolean): Promise<void>;
  };

  // settings: one patch method per eero endpoint family
  settings: {
    get(net: Id): Promise<M.NetworkSettings>;
    patch(net: Id, patch: SettingsPatch): Promise<void>;  // PUT {net}/settings
    setFastTransition(net: Id, on: boolean): Promise<void>;
    setMlo(net: Id, mode: "disabled" | "single" | "multi"): Promise<void>;
    setPowerSaving(net: Id, p: { enabled?: boolean; scheduleEnabled?: boolean }): Promise<void>;
    addPowerSchedule(net: Id, s: Omit<M.Schedule, "id">): Promise<M.Schedule>;
    updatePowerSchedule(net: Id, id: Id, patch: Partial<Omit<M.Schedule, "id">>): Promise<void>;
    removePowerSchedule(net: Id, id: Id): Promise<void>;
    setLegacyMode(net: Id, on: boolean): Promise<void>;
    setSimpleSetup(net: Id, on: boolean): Promise<void>;
    setThread(net: Id, t: { enabled?: boolean; credentialSync?: boolean }): Promise<void>;
    threadCredentials(net: Id): Promise<M.ThreadCredentials>; // sensitive
    resetThread(net: Id): Promise<void>;
  };

  // routing
  routing: {
    get(net: Id): Promise<{ reservations: M.Reservation[]; forwards: M.Forward[]; pinholes: M.Pinhole[]; lan: M.LanMap }>;
    addReservation(net: Id, r: { mac: string; ip: string; description: string }): Promise<M.Reservation>;
    updateReservation(net: Id, id: Id, patch: { ip?: string; description?: string }): Promise<void>;
    removeReservation(net: Id, id: Id, removeForwards: boolean): Promise<void>;
    addForward(net: Id, f: Omit<M.Forward, "id" | "deviceId">): Promise<M.Forward>;
    updateForward(net: Id, id: Id, patch: Partial<Omit<M.Forward, "id" | "deviceId">>): Promise<void>;
    removeForward(net: Id, id: Id): Promise<void>;
    addPinhole(net: Id, p: { deviceId: Id; protocol: "tcp" | "udp" | "both"; port: string }): Promise<M.Pinhole>;
    removePinhole(net: Id, id: Id): Promise<void>;
  };

  // updates, admins, activity, diagnostics
  updates: {
    get(net: Id): Promise<M.Updates>;
    install(net: Id): Promise<void>;
    setHour(net: Id, hour: number): Promise<void>;
    notes(net: Id): Promise<M.ReleaseNotes | null>;
  };
  admins: {
    list(net: Id): Promise<M.AdminList>;
    invite(net: Id, nickname: string | null): Promise<{ inviteId: Id; inviteUrl: string; expiresAt: Iso | null }>;
    cancelInvite(net: Id, invite: Id): Promise<void>;
    remove(net: Id, admin: Id): Promise<void>;
    transfer(net: Id, to: { name: string; email: string; phone?: string }): Promise<void>;
  };
  activity: {
    events(net: Id, cursor: string | null): Promise<{ events: M.NetworkEvent[]; nextCursor: string | null }>;
    notifications(net: Id, cursor: string | null): Promise<M.NotificationPage>;
    markRead(net: Id): Promise<void>;
    notificationSettings(net: Id): Promise<Record<string, boolean>>;
    setNotificationSettings(net: Id, map: Record<string, boolean>): Promise<void>;
  };
  diagnostics: {
    latest(net: Id): Promise<M.DiagnosticsResult | null>;
    run(net: Id, q: { symptom?: string; deviceId?: Id }): Promise<M.DiagnosticsResult>;
    support(net: Id): Promise<M.SupportInfo>;
  };
}

type SettingsPatch = {
  dns?: { mode: "automatic" | "custom"; servers?: string[]; ipv6Servers?: string[]; caching?: boolean };
  dhcp?: { mode: "automatic" | "custom"; subnetIp?: string; subnetMask?: string; startIp?: string; endIp?: string };
  ipv6?: boolean;
  wan?: { mode: "dhcp" | "static" | "pppoe"; static?: { ip: string; mask: string; router: string }; pppoe?: { username: string; password: string }; vlan?: number | null };
  connectionMode?: "nat" | "bridged" | "ipPassthrough";
  natRandomization?: boolean;
  upnp?: boolean;
  sqm?: boolean;
  bandSteering?: boolean;
  timezone?: string;
};

export class BackendError extends Error {
  constructor(
    readonly code: "not_signed_in" | "rate_limited" | "eero_error" | "network_error" | "bad_params",
    message: string,
    readonly detail?: { status?: number; eeroError?: string; retryAfterSec?: number },
  ) { super(message); }
}
```

Composite results (`health.check`, `support.report`, `DeviceList.summary`,
`Profile.nextChange`, `LanMap`) are computed in commands or shared helpers
in `src/core`, not in the backend, so the demo backend gets them for free.

## eero backend

`src/core/eero/` holds three layers. Nothing outside it imports from it
except `createEeroBackend`.

| File | Job |
| --- | --- |
| `client.ts` | The HTTP client: base URL, headers, cookie, envelope, refresh, rotation, rate limiter, timeouts, error mapping. |
| `urls.ts` | id-to-url map filled from every response (`url`, `resources.*`), plus fallbacks (`{net}/x`) and version pins (`/2.3/` device writes, `/2.4/` scans, `/2.2/` support). |
| `map.ts` | Raw shapes (loose types with every field optional) to model objects. Pure functions, unit tested with captured-shape fixtures. |
| `backend.ts` | Implements `Backend` by calling the client and mappers. |

### Client rules

Summary of [eero-client.md](eero-client.md), which is the full reference:

- Base `https://api-user.e2ro.com`. The client refuses any other origin for
  requests that carry the session (the release notes manifest is fetched
  through a separate cookieless `fetchPublic`, https only, 1 MB cap).
- Headers: `Accept: application/json`, `X-Accept-Language: en-US`, an
  app-like `User-Agent` (default in the style of
  `eero-ios/2026.8.1 (iPhone; iOS 18.5)`, overridable in app settings),
  cookie `s=<token>`.
- Bodies per endpoint: JSON, form (`application/x-www-form-urlencoded`,
  booleans `true` / `false`) or empty-JSON (`""`). The endpoint table in
  `client.ts` says which; see the notes column in
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

`map.ts` is the one place eero field names appear. Each mapper is
defensive: unknown enum values become `null` or `"unknown"`, and a missing
nested object never throws. Field-by-field sources are in
[data-model.md](data-model.md). Mappers are tested against JSON shaped like
the open source clients' redacted fixtures, rewritten with invented values.

## demo backend

`src/core/demo/` implements `Backend` over a mutable in-memory copy of the
fixtures.

- **Writes apply.** `devices.update({ paused: true })` flips the fixture,
  `profiles.delete` moves devices to unassigned, `routing.addForward`
  appears in `routing.get`. Restarts set the network or eero to `updating`
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
[../eero-api/endpoints.md](../eero-api/endpoints.md). The real `eero` backend is pointed at it with a
base URL override that only tests can set.

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
