# Data model

Every command returns objects from `src/core/model.ts`. They are plain JSON:
no classes, no `Date` objects, no raw eero fields. The eero backend maps
responses into them (`src/core/eero/map.ts`); the demo backend stores them
directly. Field sources come from
[../eero-api/data-model.md](../eero-api/data-model.md) (research copy:
`notes/api-data-model.md`).

## Conventions

- **Ids** are strings: the last path segment of the eero `url`
  (`/2.2/networks/4821907` gives `"4821907"`; a device url ending in
  `3c22fb4a910e` gives `"3c22fb4a910e"`). The eero backend keeps an
  id-to-url map so it can always use the url eero handed out. Urls never
  appear in the model.
- **Missing is `null`.** Every eero field is optional and varies by
  firmware, model, role and User-Agent. A model field that eero did not send
  is `null`, and the UI shows `-`. Never default to `0`, `false` or `""`
  unless eero's absence really means that.
- **Units.** Rates in Mbps (`number`), volumes in bytes, durations in
  seconds, times ISO 8601 UTC strings, schedule times `"HH:MM"` in the
  network time zone, percentages 0 to 100.
- **Status** is a small union, mapped once in core, so every surface shows
  the same words: `online | degraded | offline | updating | unknown`.
- **Secrets** (Wi-Fi and guest passwords, Thread keys, PPPoE password)
  appear only in the `sensitive` command results listed in
  [commands.md](commands.md). Other types expose `hasPassword: boolean`.
- **Names.** Display names are resolved in core (device: nickname, then
  display name, then hostname, then manufacturer, then MAC).

```ts
type Id = string;
type Iso = string;          // "2026-11-12T22:41:00Z"
type Hhmm = string;         // "21:00"
type Status = "online" | "degraded" | "offline" | "updating" | "unknown";
type Band = "2.4" | "5" | "6" | "wired";
type Day = "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";
type Role = "owner" | "admin";
type Security = "WPA2" | "WPA2_WPA3" | "WPA3";
```

## Session and account

```ts
type AuthStatus = {
  signedIn: boolean;
  pending: boolean;               // code sent, not verified
  login: string | null;           // masked: "al***@example.com"
  storage: "keychain" | "memory";
  backend: "eero" | "demo";
};

type Account = {
  id: Id;                         // log_id
  name: string | null;
  email: { value: string; verified: boolean } | null;
  phone: { value: string; verified: boolean } | null;
  authType: "email" | "phone" | "amazon" | null;
  marketingEmails: boolean | null;
  push: { networkOffline: boolean; nodeOffline: boolean } | null;
  canTransfer: boolean;
  networkCount: number;
};
```

| Model | eero source (`GET /2.2/account`) |
| --- | --- |
| `id` | `log_id` (also the "Support ID") |
| `email`, `phone` | `email.{value,verified}`, `phone.{value,verified}` |
| `authType` | `auth.type` |
| `marketingEmails` | `consents.marketing_emails.consented` |
| `push` | `push_settings.{networkOffline,nodeOffline}` |
| `networkCount` | `networks.count` |

`premium_status` and `premium_details` are read only to log a warning in
debug builds; nothing in the model depends on them.

## Network

```ts
type NetworkSummary = {
  id: Id;
  name: string;                   // SSID
  nickname: string | null;
  role: Role | null;
  status: Status;
  eeroCount: number | null;
  devicesOnline: number | null;
  isp: string | null;
  updateAvailable: boolean | null;
  lastSeen: Iso | null;           // for offline networks
  selected: boolean;
};

type Network = NetworkSummary & {
  timezone: string | null;        // IANA
  connectionMode: "nat" | "bridged" | "ipPassthrough" | null;
  gatewayUptimeSec: number | null;
  lastReboot: Iso | null;
  capabilities: Record<string, boolean>; // name -> capable
  messages: string[];             // banners eero sends
  counts: { eeros: number | null; devices: number | null; profiles: number | null };
};

type NetworkHealth = {
  status: Status;
  internet: { status: Status; ispUp: boolean | null };
  mesh: { status: Status };
  eeros: { id: Id; location: string; status: Status; meshBars: number | null; weakLink: boolean }[];
  messages: string[];
  issues: HealthIssue[];          // derived in core from eeros and devices (weak_link, eero_offline, network_offline)
};

type HealthIssue = {
  kind: "weak_link" | "eero_offline" | "network_offline";
  eeroId: Id | null;              // null for network_offline
  upstreamId: Id | null;          // the affected eero's parent
  deviceIds: Id[];                // devices affected
};

type Permissions = {
  role: Role | null;
  can: Record<string, { read: boolean; create: boolean; update: boolean; delete: boolean }>;
};
```

| Model | eero source |
| --- | --- |
| `name`, `nickname` | `name`, `nickname_label` (network), or `networks.data[].{name,nickname_label}` in the list |
| `status` | `status` (`connected`/`online` = online, `offline`, `updating`), downgraded to `degraded` when any eero is red or `health.internet.isp_up` is false |
| `role` | `GET {net}/permissions` `role` (`standard-admin` = admin), else account `role` |
| `timezone` | `timezone.value` |
| `connectionMode` | `connection.mode` |
| `gatewayUptimeSec` | gateway eero `uptime.since_last_reboot_s` |
| `capabilities` | `capabilities.<name>.capable` |
| `counts` | `eeros.count`, `profiles.count`; `devices` is every known device, the same number as `device.list` `summary.total` (eero's `clients.count` counts connected devices only, so it is not used) |
| `health.internet` | `health.internet.{status,isp_up}` |
| `health.mesh` | `health.eero_network.status` |
| `weakLink` | wireless eero with `mesh_quality_bars <= 2` |
| `issues` | derived in core from eeros and devices (not a backend field) |
| `Permissions.can` | `permissions.<area>.{create,read,update,delete}` |

## Internet, speed and usage

```ts
type Internet = {
  status: Status;
  isp: { name: string | null; org: string | null; asn: string | null; city: string | null; region: string | null; country: string | null };
  publicIpv4: string | null;
  publicIpv6: string | null;
  ipv6Prefix: string | null;
  wanType: "dhcp" | "static" | "pppoe" | null;
  ispGateway: string | null;
  vlan: number | null;
  dnsInUse: string[];
  dnsMode: "automatic" | "custom" | null;
  doubleNat: boolean | null;
  gateway: { eeroId: Id; location: string; model: string | null; wanPortSpeedMbps: number | null } | null;
  leaseRenewsAt: Iso | null;      // WAN DHCP lease renewal
  planMbps: { down: number; up: number } | null;   // from app settings, "set by you"
  lastSpeedTest: SpeedTest | null;
  verdict: { kind: "steady" | "slow" | "down"; title: string; detail: string | null } | null;  // built in core
};

// rating vs plan, in core: great when every direction is at least 75%, poor when any is under 40%, else below_plan
type SpeedTest = { at: Iso; downMbps: number | null; upMbps: number | null; rating: "great" | "below_plan" | "poor" | null };

type SpeedHistory = { tests: SpeedTest[]; avg7d: { downMbps: number | null; upMbps: number | null } };

type UsagePoint = { at: Iso; down: number; up: number };   // bytes in the bucket
type UsageSeries = {
  scope: "network" | "eero" | "device" | "profile" | "guest";
  id: Id | null;
  range: "day" | "week";
  cadence: "hourly" | "daily";
  points: UsagePoint[];
  total: { down: number; up: number };
  busiest: UsagePoint | null;
  todaySoFar: number | null;
};

type UsageBreakdown = {
  range: "day" | "week";
  by: "device" | "profile" | "eero";
  rows: { id: Id | null; name: string; down: number; up: number; share: number }[];  // share 0..100
  total: { down: number; up: number };
};
```

| Model | eero source |
| --- | --- |
| `isp.*` | `geo_ip.{isp,org,asn,city,regionName,countryCode}` |
| `publicIpv4`, `doubleNat` | `ip_settings.{public_ip,double_nat}` |
| `publicIpv6`, `ipv6Prefix` | `ipv6_lease` (shape unverified, MANUAL) |
| `wanType` | `wan_type`, `lease.mode`, `pppoe_enabled` |
| `ispGateway` | `gateway_ip` or `lease.dhcp.router` |
| `dnsInUse`, `dnsMode` | `dns.parent.ips` or `dns.custom.ips`, `dns.mode` |
| `leaseRenewsAt` | always null from eero: `lease.dhcp` has only `ip`, `mask`, `router` and `GET {net}` has no lease time (real capture, 2026-11-13). Only the demo fills it |
| `verdict` | built in core from status, plan and the last speed test |
| `gateway.wanPortSpeedMbps` | gateway eero `ethernet_status.statuses[isWanPort].speed` (`"P2500"` to 2500), only when that port `hasCarrier` (an unlinked port reports `"P10"`) |
| `lastSpeedTest` | `speed.{date,down.value,up.value}` |
| `SpeedTest` | `GET {net}/speedtest` rows `{date, down_mbps, up_mbps}`; `rating` vs `planMbps` in core |
| `UsageSeries.points` | `series[type=download\|upload].values[{time,value}]` zipped by `time` |
| `total` | each series `sum` |
| `UsageBreakdown.rows` | `data_usage/breakdown` (shape varies; LD documents both device and profile lists), or `data_usage/eeros` |

## eeros

```ts
type Eero = {
  id: Id;
  serial: string | null;
  location: string;
  model: string | null;           // "eero Pro 7"
  modelNumber: string | null;
  isGateway: boolean;
  status: Status;                 // green online, yellow degraded, red offline
  firmware: string | null;
  updateAvailable: boolean | null;
  endOfLife: { expired: boolean; date: Iso | null } | null;
  backhaul: "wired" | "wireless" | null;
  meshBars: number | null;        // 1..5, wireless only
  upstream: Id | null;            // parent eero
  hop: number | null;             // core: 0 gateway, parent + 1; null for a broken chain
  meshQuality: "excellent" | "good" | "weak" | "poor" | null;  // core: bars 4-5, 3, 2, 0-1; null when wired
  clients: { total: number | null; wired: number | null; wireless: number | null };
  bands: Band[];
  radios: Radio[];
  led: { on: boolean | null; brightness: number | null };
  nightlight: Nightlight | null;  // Beacon only
  ipv4: string | null;
  ipv6: string[];
  subnet: string | null;          // LAN CIDR
  gatewayIp: string | null;       // LAN gateway address
  mac: string | null;
  bssids: { band: Band; mac: string }[];
  joined: Iso | null;
  uptimeSec: number | null;
  lastHeartbeat: Iso | null;
  powerSource: string | null;
  messages: string[];
};

type Radio = {
  band: Band; channel: number | null; widthMhz: number | null; utilization: number | null; clients: number | null;
  txPowerDbm: number | null; autoChannel: boolean | null;
};

type Nightlight = { mode: "off" | "ambient" | "schedule"; brightness: number | null; on: Hhmm | null; off: Hhmm | null };

type EeroPorts = {
  eeroId: Id;
  ports: {
    number: number;
    name: string | null;
    status: "up" | "down" | "disabled";
    speedMbps: number | null;
    supportedMbps: number | null;
    isWan: boolean;
    poe: "on" | "off" | null;
    mac: string | null;
    attached: { deviceId: Id | null; eeroId: Id | null; name: string | null } | null;
    actions: string[];            // PortAction values eero allows
  }[];
};

type FirmwareEntry = { version: string; installedAt: Iso | null; current: boolean };  // newest first

type PlacementResult = { eeroId: Id; rating: "poor" | "fair" | "good" | "strong" | null; advice: string | null };

type CoverageScan = {
  scannedAt: Iso | null;
  rooms: { eeroId: Id; location: string; quality: number | null; devices: number | null; servedBy: Id | null }[];
  advice: string[];
};

type UpgradeReport = {
  byGeneration: { generation: "wifi7" | "wifi6e" | "wifi6" | "wifi5" | "wifi4"; devices: number }[];
  limitingEeros: { eeroId: Id; reason: string }[];
  notes: string[];
};
```

| Model | eero source (`GET {net}/eeros`) |
| --- | --- |
| `location`, `model`, `modelNumber`, `serial` | same names (`model_number`) |
| `isGateway` | `gateway` or `is_primary_node` |
| `status` | `status` green, yellow, red; `heartbeat_ok == false` forces offline |
| `firmware`, `updateAvailable` | `os_version`, `update_available` |
| `endOfLife` | `update_status.{support_expired,support_expiration_date}` |
| `backhaul` | `wired` / `connection_type` |
| `meshBars` | `mesh_quality_bars` |
| `upstream` | wireless: `wireless_upstream_node.name` matched to exactly one eero's `location` (eero sends no url, and `node_or_proxied_node_id` is not an eero id; a `url` is used if ever sent). Wired: the `neighbor` of type `EERO` (`metadata.url`) on the port with `isLeafWiredToUpstream`, else on the `isWanPort` port with carrier, else the only EERO neighbour (`isLeafWiredToUpstream` is false on every real port). `eero.get` reads the list to resolve the name |
| `clients` | `connected_clients_count`, `connected_wired_clients_count`, `connected_wireless_clients_count` |
| `bands` | `bands[]` (`band_5GHz_low` and `_high` both map to `"5"`) |
| `radios` | `radio_channel_stats.<band>.{channel,channel_width,channel_utilization,client_count}`; `txPowerDbm` from `tx_power`; `autoChannel` is always null (no known eero field) |
| `hop`, `meshQuality` | derived in core in `eero.list` and `eero.get` from `upstream`, `backhaul` and `meshBars` |
| `subnet`, `gatewayIp` | `subnet` from the same `mapLan(dhcp)` as `reservation.list`: `dhcp.custom`, or eero's automatic 192.168.4.0/22 when `dhcp.mode` is `automatic` (null in bridge or passthrough); `gatewayIp` is the gateway eero's IP (null in bridge or passthrough) |
| `led` | `led_on`, `led_brightness` |
| `nightlight` | `nightlight` (`enabled` false = off; `schedule.enabled` picks schedule vs ambient) |
| `ipv4`, `ipv6`, `mac`, `bssids` | `ip_address`, `ipv6_addresses[].address`, `mac_address`, `bssids_with_bands` |
| `uptimeSec`, `joined` | `uptime.since_last_reboot_s`, `joined` |
| `EeroPorts` | `resources.connections`: `ports.interfaces[]`. `status`: `port_status` `DATA_CONNECTED` or `WAN` is up, `DISABLED` disabled, else down. `speedMbps`: `negotiated_speed` (`"P1000"`) when up; `supportedMbps`: `supported_speed`. `isWan`: `port_status` `WAN` or `connection_status.type` `WAN_SOURCE` (`network_type` is `UNKNOWN` on real ports). `attached`: from `connection_status.metadata.multiple_devices.connections[]` (`type` `EERO_DEVICE` or `CLIENT_DEVICE`, joined by `metadata.url`): an eero if one is there, else the only device, else `"N devices"` with no id. `poe_status`, `actions[].type` |
| `FirmwareEntry` | `GET /2.2/eeros/{id}/firmware_update/history`, `data.data[]`: `version` is `firmware_version` up to `+` (the build tail dropped, so it equals the eero's `os_version`), `installedAt` is `finished_at`, else `timestamp`; rows whose `outcome` or `status` says failed are dropped; `current` is the newest entry matching `os_version` |
| `CoverageScan`, `UpgradeReport` | `/2.4/` placement scans; shapes known only from LD, MANUAL capture needed |

## Devices

```ts
type DeviceCategory = "phones_tablets" | "computers" | "entertainment" | "smart_home" | "other";

type Device = {
  id: Id;                         // MAC without colons
  name: string;
  nickname: string | null;
  hostname: string | null;
  manufacturer: string | null;
  model: string | null;
  type: DeviceType;               // eero device_type, "generic" if absent
  category: DeviceCategory;
  mac: string;
  privateMac: boolean;
  ipv4: string | null;
  ipv6: string[];
  ipv6LinkLocal: string | null;   // fe80:: address
  connected: boolean;
  lastActive: Iso | null;
  firstSeen: Iso | null;
  ssid: "main" | "guest" | null;
  eeroId: Id | null;              // which eero it is on
  band: Band | null;
  channel: number | null;
  signal: { dbm: number | null; bars: number | null } | null;   // bars 0..5
  link: { rxMbps: number | null; txMbps: number | null; widthMhz: number | null; standard: string | null; snr: number | null; retryPct: number | null } | null;
  wiredPort: { eeroId: Id; port: number; speedMbps: number | null } | null;
  security: string | null;        // "WPA3 Personal (SAE)"
  paused: boolean;
  blocked: boolean;
  profileId: Id | null;
  rates: { downMbps: number; upMbps: number; at: Iso } | null;  // null when stale
  reservation: { id: Id; ip: string } | null;                    // device.get only
};

type DeviceList = {
  devices: Device[];
  summary: {
    total: number; online: number; offline: number; paused: number; blocked: number;
    byBand: Record<Band, number>;
    byCategory: Record<DeviceCategory, number>;
    // each sums to total, largest first; null is no eero (blocked), Unassigned, unknown maker
    byEero: { eeroId: Id | null; count: number }[];
    byProfile: { profileId: Id | null; count: number }[];
    byManufacturer: { manufacturer: string | null; count: number }[];
    newThisWeek: Id[];
    rates: { downMbps: number; upMbps: number; active: number; at: Iso } | null;
  };
};
```

| Model | eero source (`GET {net}/devices`) |
| --- | --- |
| `id`, `mac` | `url` last segment, `mac` |
| `name` | `nickname`, then `display_name`, `hostname`, `manufacturer`, `mac` |
| `model`, `type` | `model_name`, `device_type` |
| `category` | core table from `device_type` (phone and tablet, laptop and desktop, television and game console and media streamer, thermostat and plug and camera and so on) |
| `privateMac` | `is_private` |
| `ipv4`, `ipv6` | `ipv4` or `ip`, `ipv6_addresses[].address` |
| `ipv6LinkLocal` | the `fe80::` entry of `ipv6_addresses` |
| `connected`, `lastActive`, `firstSeen` | `connected`, `last_active`, `first_active` |
| `ssid` | `is_guest` (guest) else main; `subnet_kind` when present |
| `eeroId` | `source.url` |
| `band` | `interface.frequency` (`"2.4"`, `"5"`, `"6"`); `wireless == false` gives `"wired"` |
| `signal` | `connectivity.signal` (`"-52 dBm"` parsed), `connectivity.score_bars` |
| `link` | `connectivity.rx_rate_info`, `tx_rate_info` (`rate_bps`, `channel_width`, `phy_type` `he`/`eht`), `snr`, `packet_stats.tx_retries` |
| `wiredPort` | `connectivity.ethernet_status` |
| `security` | `auth` |
| `paused`, `blocked` | `paused`, `blocked` or `blacklisted`, or present in `GET {net}/blacklist` |
| `profileId` | `profile.url` |
| `rates` | `usage.{down_mbps,up_mbps}` after a burst, stamped with the read time |

Blocked devices may be missing from `devices`; the backend merges
`GET {net}/blacklist` entries in with `blocked: true, connected: false`.

## Profiles

```ts
type Profile = {
  id: Id;                         // eero profile id; Unassigned is not a Profile
  name: string;
  state: "active" | "paused" | "scheduled";
  paused: boolean;
  deviceIds: Id[];
  devicesOnline: number;
  schedules: Schedule[];
  nextChange: { at: Iso; to: "paused" | "active"; scheduleId: Id } | null;
};

type Schedule = {
  id: Id;
  name: string;
  days: Day[];
  start: Hhmm;
  end: Hhmm;                      // before start: wraps past midnight
  enabled: boolean;
};
```

| Model | eero source (`GET {net}/profiles`, `{profile}/schedules`) |
| --- | --- |
| `name`, `paused` | `name`, `paused` |
| `state` | `state.value` (`paused`, `active`, `schedule` = scheduled) |
| `deviceIds` | `devices[].url` |
| `schedules` | `{profile}/schedules` items, else `schedule[]` on the profile; days normalised from `MON` or `monday` |
| `nextChange` | computed in core from schedules and the network time zone |

`premium_dns` and `unified_content_filters` are ignored (Plus).

## Guest and Wi-Fi

```ts
type GuestNetwork = { enabled: boolean; name: string | null; hasPassword: boolean; online: number; security: Record<Exclude<Band, "wired">, Security | null> };

type WifiSettings = {
  ssid: string;
  hasPassword: boolean;
  security: Record<Exclude<Band, "wired">, Security | null>;
  wpa2OnlyDevices: Id[];          // would drop on WPA3
  bands: { band: Exclude<Band, "wired">; on: boolean; clients: number; widthsMhz: number[]; channels: number[] }[];
  hide5g: { active: boolean; expiresAt: Iso | null };
  wirelessClients: number;
};

type WifiShare = { ssid: string; password: string | null; security: "WPA" | "nopass"; qr: string };
```

| Model | eero source |
| --- | --- |
| `GuestNetwork` | `GET {net}/guestnetwork` `{name, enabled, password}`; online from devices with `is_guest` |
| `ssid` | network `name` |
| `security` | `GET {net}/wpa3_per_band` (`band_2_4_ghz`, `band_5_ghz`, `band_6_ghz`, case normalised) |
| `bands` | merged `radio_channel_stats` across eeros, clients from devices |
| `hide5g` | `temporary_flags.hide_5g.{value,expires_on}` (or a bare bool) |
| `WifiShare.qr` | `WIFI:T:WPA;S:<ssid>;P:<password>;;` with `\`, `;`, `,`, `:` escaped |

## Settings and routing

```ts
type NetworkSettings = {
  dns: { mode: "automatic" | "custom"; servers: string[]; ipv6Servers: string[]; caching: boolean | null; ispServers: string[] };
  dhcp: { mode: "automatic" | "custom" | "bridged"; subnetIp: string | null; subnetMask: string | null; gateway: string | null; startIp: string | null; endIp: string | null };
  ipv6: { enabled: boolean | null };
  wan: { mode: "dhcp" | "static" | "pppoe"; static: { ip: string; mask: string; router: string } | null; pppoeUsername: string | null; vlan: number | null };
  connectionMode: "nat" | "bridged" | "ipPassthrough" | null;
  natRandomization: boolean | null;
  upnp: boolean | null;
  sqm: boolean | null;
  bandSteering: boolean | null;
  fastTransition: boolean | null;
  mlo: "disabled" | "single" | "multi" | null;     // null = not supported
  legacyMode: boolean | null;
  simpleSetup: boolean | null;
  powerSaving: { enabled: boolean | null; scheduleEnabled: boolean | null; schedules: Schedule[] };
  thread: { enabled: boolean; credentialSync: boolean | null; name: string | null; channel: number | null; panId: string | null; xpanId: string | null; borderAgent: string | null; devices: number | null } | null;
  timezone: string | null;
};

type ThreadCredentials = { networkKey: string; pskc: string | null; dataset: string | null };

type Reservation = { id: Id; deviceId: Id | null; name: string; mac: string; ip: string; forwards: number };
type Forward = { id: Id; deviceId: Id | null; name: string; ip: string; externalPort: string; internalPort: string; protocol: "tcp" | "udp" | "both"; enabled: boolean };
type Pinhole = { id: Id; deviceId: Id | null; address: string | null; port: string; protocol: "tcp" | "udp" | "both" };
type LanMap = { subnet: string; size: number; gateway: string; pool: { start: string; end: string; size: number; leased: number }; staticRange: { start: string; end: string } };
// everything from one GET {net}/routing; bridge mode gives empty lists and lan null
type Routing = { reservations: Reservation[]; forwards: Forward[]; pinholes: Pinhole[]; lan: LanMap | null };
```

| Model | eero source |
| --- | --- |
| `dns` | `dns.{mode,caching,custom.ips,parent.ips}`, `ipv6.name_servers` |
| `dhcp` | `dhcp.{mode,custom}`; `connection.mode == bridged` gives `"bridged"` |
| `wan` | `lease.{mode,static}`, `pppoe_enabled`, `pppoe_username`, `vlan` |
| toggles | `upnp`, `sqm`, `band_steering`, `ipv6_upstream`, `nat_port_randomization`, `mlo_mode`, `power_saving`, `power_saving_schedule_enabled` |
| `fastTransition` | `GET {net}/fast_transition` |
| `legacyMode` | `GET {net}/ac_compat` |
| `thread` | `GET {net}/thread` minus `master_key`, `commissioning_credential`, `active_operational_dataset` |
| `ThreadCredentials` | those three fields |
| `Reservation`, `Forward`, `Pinhole` | `GET {net}/routing` `reservations.data[]`, `forwards.data[]`, `pinholes.data[]`, joined to devices by MAC or IP |
| `LanMap` | `dhcp.custom` (or defaults), reservations and connected device count |

## Updates and admins

```ts
type Updates = {
  status: "up_to_date" | "available" | "scheduled" | "installing";
  current: string | null;
  target: string | null;
  canUpdateNow: boolean;
  required: boolean;
  scheduledAt: Iso | null;
  preferredHour: number | null;   // 0..23 network time
  lastUpdatedAt: Iso | null;
  eeros: { id: Id; location: string; firmware: string | null }[];
  stuckEeros: Id[];               // unresponsive or incomplete in last update
};

type ReleaseNotes = { version: string; releasedAt: Iso | null; title: string | null; features: string[] };

type Admin = { id: Id; name: string | null; email: string | null; role: Role; isYou: boolean };
type Invite = { id: Id; nickname: string | null; createdAt: Iso | null; expiresAt: Iso | null };
type AdminList = { admins: Admin[]; invites: Invite[]; seatsUsed: number; seatsMax: 10 };
```

| Model | eero source |
| --- | --- |
| `Updates` | `GET {net}/updates`: `has_update`, `update_required`, `can_update_now`, `target_firmware`, `scheduled_update_time`, `preferred_update_hour`, `last_update_started`, `last_user_update.{unresponsive_eeros,incomplete_eeros}` |
| `ReleaseNotes` | `manifest_resource` JSON `{title, os_version, release_date, features}` |
| `Admin` | `GET {net}/members` `{user_id, user_role, user_name, user_email}` |
| `Invite` | `GET {net}/invites` `{invite_id, invite_nickname, created}`; expiry is created plus 48 h (MANUAL) |

## Activity and notifications

```ts
type EventCategory = "devices" | "pause_block" | "schedules" | "eero_status" | "speed_tests" | "firmware" | "admin" | "ports_temperature" | "other";

type NetworkEvent = {
  id: Id;
  at: Iso;
  category: EventCategory;
  type: string;                   // raw eero event_type, kept for filters
  title: string;
  detail: string | null;
  refs: { deviceId?: Id; eeroId?: Id; profileId?: Id; adminId?: Id };
};

type EventPage = { events: NetworkEvent[]; nextCursor: string | null; counts: Record<EventCategory, number> };

type Notification = { id: Id; at: Iso; title: string; body: string; read: boolean };
type NotificationPage = { notifications: Notification[]; unread: boolean; nextCursor: string | null };

type NotificationSettings = { eero: Record<string, boolean>; push: { networkOffline: boolean; nodeOffline: boolean } | null; desktop: Record<string, boolean> };
```

| Model | eero source |
| --- | --- |
| `NetworkEvent` | `GET {net}/app_events` `{event_type, title or message, created}`; `category` from a core table of `event_type` prefixes, unknown types go to `other` |
| `nextCursor` | `created` of the last event (the `timestamp` param) |
| `Notification` | `notifications_history` `{uuid, title, body}` |
| `unread` | `notifications/has_unread` (object or bare bool) |
| `NotificationSettings.eero` | `GET {net}/notifications` flat map, keys kept as-is (`device.new`) |

The list of `event_type` values is not documented anywhere. The mapping
table starts from what the clients log and grows as MANUAL captures come in.

## Diagnostics and support

```ts
type Check = { id: string; label: string; status: "good" | "warning" | "problem" | "unknown"; detail: string | null };
type HealthReport = { overall: "good" | "warning" | "problem"; checks: Check[]; at: Iso };

type DiagnosticsResult = { status: string | null; issueArea: string | null; results: { name: string; status: string; detail: string | null }[] };

type SupportInfo = {
  supportId: string | null;
  eero: { phone: string | null; email: string | null; helpUrl: string | null };
  isp: { name: string | null; phone: string | null; url: string | null } | null;
};
```

| Model | eero source |
| --- | --- |
| `HealthReport` | composed in core from `NetworkHealth`, `Internet`, `Eero[]`, `Updates` and `GET {net}/diagnostics` |
| `DiagnosticsResult` | `GET {net}/diagnostics` `{status, issue_area, results[]}` |
| `SupportInfo` | `GET {net}/support` (2.2: `support_phone`, `contact_url`, `help_url`, `name`), account `log_id` |

## App

```ts
type AppInfo = {
  version: string;
  electron: string | null;        // null under a plain Node test host
  os: "darwin" | "win32" | "linux";
  arch: string;
  backend: "eero" | "demo";
  sessionStorage: "keychain" | "memory";
  keychainName: string | null;    // "GNOME Keyring", "macOS Keychain", "Windows DPAPI"
  update: { available: boolean; version: string | null; channel: "auto" | "package_manager" } | null;
  configDir: string;
};

type AppSettings = {
  lastNetworkId: Id | null;
  userAgent: string | null;       // null = default app-like UA
  planMbps: Record<Id, { down: number; up: number }>;
  desktopNotifications: Record<string, boolean>;
  openOnLaunch: Id | null;
};

type AuditEntry = { at: Iso; surface: "cli" | "mcp"; id: string; effect: Effect; ok: boolean; code: string | null };
```

## Keeping fixtures in step

The demo backend stores these types directly. When a type changes, the
fixtures in `src/core/demo/fixtures.ts` change in the same PR, and the
command tests catch any drift. See [backends.md](backends.md#fixtures).
