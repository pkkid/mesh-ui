/**
 * The data model every command returns. Plain JSON only: no classes, no Date
 * objects, no raw eero fields. Field sources are in
 * docs/architecture/data-model.md; keep the two in step.
 */

// ---------------------------------------------------------------------------
// Primitives

export type Id = string;
/** ISO 8601 UTC, e.g. "2026-11-12T22:41:00Z". */
export type Iso = string;
/** 24-hour "HH:MM" in the network time zone. */
export type Hhmm = string;
export type Status = "online" | "degraded" | "offline" | "updating" | "unknown";
export type Band = "2.4" | "5" | "6" | "wired";
export type WirelessBand = Exclude<Band, "wired">;
export type Day = "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";
export type Role = "owner" | "admin";
export type Security = "WPA2" | "WPA2_WPA3" | "WPA3";
export type Effect = "query" | "write" | "disruptive" | "destructive";
export type SessionStorageKind = "keychain" | "memory";
export type BackendKind = "eero" | "demo";
/** eero `device_type` as sent ("phone", "laptop", ...); "generic" if absent. */
export type DeviceType = string;
export type PortAction =
  | "ENABLE_PORT"
  | "DISABLE_PORT"
  | "ENABLE_DATA"
  | "DISABLE_DATA"
  | "ENABLE_POE"
  | "DISABLE_POE"
  | "RESTART_POWER";
export type UsageRange = "day" | "week";
export type UsageCadence = "hourly" | "daily";

// ---------------------------------------------------------------------------
// Session and account

export type AuthStatus = {
  signedIn: boolean;
  /** Code sent, not verified yet. */
  pending: boolean;
  /** Masked, e.g. "al***@example.com". */
  login: string | null;
  storage: SessionStorageKind;
  backend: BackendKind;
};

export type Account = {
  /** eero `log_id`, also the "Support ID". */
  id: Id;
  name: string | null;
  email: { value: string; verified: boolean } | null;
  phone: { value: string; verified: boolean } | null;
  authType: "email" | "phone" | "amazon" | null;
  marketingEmails: boolean | null;
  push: { networkOffline: boolean; nodeOffline: boolean } | null;
  canTransfer: boolean;
  networkCount: number;
};

// ---------------------------------------------------------------------------
// Network

export type NetworkSummary = {
  id: Id;
  /** SSID. */
  name: string;
  nickname: string | null;
  role: Role | null;
  status: Status;
  eeroCount: number | null;
  devicesOnline: number | null;
  isp: string | null;
  updateAvailable: boolean | null;
  /** For offline networks. */
  lastSeen: Iso | null;
  selected: boolean;
};

export type ConnectionMode = "nat" | "bridged" | "ipPassthrough";

export type Network = NetworkSummary & {
  /** IANA time zone. */
  timezone: string | null;
  connectionMode: ConnectionMode | null;
  gatewayUptimeSec: number | null;
  lastReboot: Iso | null;
  /** Capability name to capable. */
  capabilities: Record<string, boolean>;
  /** Banners eero sends. */
  messages: string[];
  counts: { eeros: number | null; devices: number | null; profiles: number | null };
};

export type NetworkHealth = {
  status: Status;
  internet: { status: Status; ispUp: boolean | null };
  mesh: { status: Status };
  eeros: { id: Id; location: string; status: Status; meshBars: number | null; weakLink: boolean }[];
  messages: string[];
};

export type Permission = { read: boolean; create: boolean; update: boolean; delete: boolean };

export type Permissions = {
  role: Role | null;
  can: Record<string, Permission>;
};

// ---------------------------------------------------------------------------
// Internet, speed and usage

export type SpeedTest = {
  at: Iso;
  downMbps: number | null;
  upMbps: number | null;
  rating: "great" | "below_plan" | null;
};

export type PlanSpeed = { down: number; up: number };

export type Internet = {
  status: Status;
  isp: {
    name: string | null;
    org: string | null;
    asn: string | null;
    city: string | null;
    region: string | null;
    country: string | null;
  };
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
  /** From app settings ("set by you"), filled in by core, not the backend. */
  planMbps: PlanSpeed | null;
  lastSpeedTest: SpeedTest | null;
};

export type SpeedHistory = {
  tests: SpeedTest[];
  avg7d: { downMbps: number | null; upMbps: number | null };
};

/** Bytes moved in one bucket. */
export type UsagePoint = { at: Iso; down: number; up: number };

export type UsageScope = "network" | "eero" | "device" | "profile" | "guest";

export type UsageSeries = {
  scope: UsageScope;
  id: Id | null;
  range: UsageRange;
  cadence: UsageCadence;
  points: UsagePoint[];
  total: { down: number; up: number };
  busiest: UsagePoint | null;
  todaySoFar: number | null;
};

export type UsageBreakdownRow = {
  id: Id | null;
  name: string;
  down: number;
  up: number;
  /** Share of the network total, 0 to 100. */
  share: number;
};

export type UsageBreakdown = {
  range: UsageRange;
  by: "device" | "profile" | "eero";
  rows: UsageBreakdownRow[];
  total: { down: number; up: number };
};

// ---------------------------------------------------------------------------
// eeros

export type Radio = {
  band: Band;
  channel: number | null;
  widthMhz: number | null;
  utilization: number | null;
  clients: number | null;
};

export type Nightlight = {
  mode: "off" | "ambient" | "schedule";
  brightness: number | null;
  on: Hhmm | null;
  off: Hhmm | null;
};

export type Eero = {
  id: Id;
  serial: string | null;
  location: string;
  /** "eero Pro 7". */
  model: string | null;
  modelNumber: string | null;
  isGateway: boolean;
  /** green online, yellow degraded, red offline. */
  status: Status;
  firmware: string | null;
  updateAvailable: boolean | null;
  endOfLife: { expired: boolean; date: Iso | null } | null;
  backhaul: "wired" | "wireless" | null;
  /** 1 to 5, wireless only. */
  meshBars: number | null;
  /** Parent eero. */
  upstream: Id | null;
  clients: { total: number | null; wired: number | null; wireless: number | null };
  bands: Band[];
  radios: Radio[];
  led: { on: boolean | null; brightness: number | null };
  /** Beacon only. */
  nightlight: Nightlight | null;
  ipv4: string | null;
  ipv6: string[];
  mac: string | null;
  bssids: { band: Band; mac: string }[];
  joined: Iso | null;
  uptimeSec: number | null;
  lastHeartbeat: Iso | null;
  powerSource: string | null;
  messages: string[];
};

export type EeroPort = {
  number: number;
  name: string | null;
  status: "up" | "down" | "disabled";
  speedMbps: number | null;
  supportedMbps: number | null;
  isWan: boolean;
  poe: "on" | "off" | null;
  mac: string | null;
  attached: { deviceId: Id | null; eeroId: Id | null; name: string | null } | null;
  /** PortAction values eero allows on this port. */
  actions: PortAction[];
};

export type EeroPorts = { eeroId: Id; ports: EeroPort[] };

export type FirmwareEntry = { version: string; installedAt: Iso | null };

export type PlacementResult = {
  eeroId: Id;
  rating: "poor" | "fair" | "good" | "strong" | null;
  advice: string | null;
};

export type CoverageScan = {
  scannedAt: Iso | null;
  rooms: { eeroId: Id; location: string; quality: number | null; devices: number | null; servedBy: Id | null }[];
  advice: string[];
};

export type UpgradeReport = {
  byGeneration: { generation: "wifi7" | "wifi6e" | "wifi6" | "wifi5" | "wifi4"; devices: number }[];
  limitingEeros: { eeroId: Id; reason: string }[];
  notes: string[];
};

// ---------------------------------------------------------------------------
// Devices

export type DeviceCategory = "phones_tablets" | "computers" | "entertainment" | "smart_home" | "other";

export type DeviceRates = { downMbps: number; upMbps: number; at: Iso };

export type Device = {
  /** MAC without colons. */
  id: Id;
  name: string;
  nickname: string | null;
  hostname: string | null;
  manufacturer: string | null;
  model: string | null;
  type: DeviceType;
  category: DeviceCategory;
  mac: string;
  privateMac: boolean;
  ipv4: string | null;
  ipv6: string[];
  connected: boolean;
  lastActive: Iso | null;
  firstSeen: Iso | null;
  ssid: "main" | "guest" | null;
  /** Which eero it is on. */
  eeroId: Id | null;
  band: Band | null;
  channel: number | null;
  /** bars 0 to 5. */
  signal: { dbm: number | null; bars: number | null } | null;
  link: {
    rxMbps: number | null;
    txMbps: number | null;
    widthMhz: number | null;
    standard: string | null;
    snr: number | null;
    retryPct: number | null;
  } | null;
  wiredPort: { eeroId: Id; port: number; speedMbps: number | null } | null;
  /** "WPA3 Personal (SAE)". */
  security: string | null;
  paused: boolean;
  blocked: boolean;
  profileId: Id | null;
  /** null when stale (older than 90 s) or never measured. */
  rates: DeviceRates | null;
  /** device.get only. */
  reservation: { id: Id; ip: string } | null;
};

export type DeviceSummary = {
  total: number;
  online: number;
  offline: number;
  paused: number;
  blocked: number;
  byBand: Record<Band, number>;
  byCategory: Record<DeviceCategory, number>;
  newThisWeek: Id[];
  rates: { downMbps: number; upMbps: number; active: number; at: Iso } | null;
};

export type DeviceList = { devices: Device[]; summary: DeviceSummary };

/** Result of device.rates.refresh. */
export type BurstResult = { nextBurstAt: Iso };

// ---------------------------------------------------------------------------
// Profiles

export type Schedule = {
  id: Id;
  name: string;
  days: Day[];
  start: Hhmm;
  /** Before start: wraps past midnight. */
  end: Hhmm;
  enabled: boolean;
};

export type Profile = {
  /** eero profile id. Unassigned is not a Profile. */
  id: Id;
  name: string;
  state: "active" | "paused" | "scheduled";
  paused: boolean;
  deviceIds: Id[];
  devicesOnline: number;
  schedules: Schedule[];
  nextChange: { at: Iso; to: "paused" | "active"; scheduleId: Id } | null;
};

/** Devices with no profile. Not a profile and has no id. */
export type UnassignedDevices = { deviceIds: Id[]; devicesOnline: number; paused: boolean };

/** Result of profile.list. */
export type ProfileList = { profiles: Profile[]; unassigned: UnassignedDevices };

// ---------------------------------------------------------------------------
// Guest and Wi-Fi

export type GuestNetwork = {
  enabled: boolean;
  name: string | null;
  hasPassword: boolean;
  online: number;
  security: Record<WirelessBand, Security | null>;
};

export type WifiSettings = {
  ssid: string;
  hasPassword: boolean;
  security: Record<WirelessBand, Security | null>;
  /** Devices that would drop on WPA3. */
  wpa2OnlyDevices: Id[];
  bands: { band: WirelessBand; on: boolean; clients: number; widthsMhz: number[]; channels: number[] }[];
  hide5g: { active: boolean; expiresAt: Iso | null };
  wirelessClients: number;
};

export type WifiShare = { ssid: string; password: string | null; security: "WPA" | "nopass"; qr: string };

// ---------------------------------------------------------------------------
// Settings and routing

export type NetworkSettings = {
  dns: { mode: "automatic" | "custom"; servers: string[]; ipv6Servers: string[]; caching: boolean | null; ispServers: string[] };
  dhcp: {
    mode: "automatic" | "custom" | "bridged";
    subnetIp: string | null;
    subnetMask: string | null;
    gateway: string | null;
    startIp: string | null;
    endIp: string | null;
  };
  ipv6: { enabled: boolean | null };
  wan: {
    mode: "dhcp" | "static" | "pppoe";
    static: { ip: string; mask: string; router: string } | null;
    pppoeUsername: string | null;
    vlan: number | null;
  };
  connectionMode: ConnectionMode | null;
  natRandomization: boolean | null;
  upnp: boolean | null;
  sqm: boolean | null;
  bandSteering: boolean | null;
  fastTransition: boolean | null;
  /** null = not supported. */
  mlo: "disabled" | "single" | "multi" | null;
  legacyMode: boolean | null;
  simpleSetup: boolean | null;
  powerSaving: { enabled: boolean | null; scheduleEnabled: boolean | null; schedules: Schedule[] };
  thread: {
    enabled: boolean;
    credentialSync: boolean | null;
    name: string | null;
    channel: number | null;
    panId: string | null;
    xpanId: string | null;
    borderAgent: string | null;
    devices: number | null;
  } | null;
  timezone: string | null;
};

export type ThreadCredentials = { networkKey: string; pskc: string | null; dataset: string | null };

export type Protocol = "tcp" | "udp" | "both";

export type Reservation = { id: Id; deviceId: Id | null; name: string; mac: string; ip: string; forwards: number };

export type Forward = {
  id: Id;
  deviceId: Id | null;
  name: string;
  ip: string;
  externalPort: string;
  internalPort: string;
  protocol: Protocol;
  enabled: boolean;
};

export type Pinhole = { id: Id; deviceId: Id | null; address: string | null; port: string; protocol: Protocol };

export type LanMap = {
  subnet: string;
  size: number;
  gateway: string;
  pool: { start: string; end: string; size: number; leased: number };
  staticRange: { start: string; end: string };
};

// ---------------------------------------------------------------------------
// Updates and admins

export type Updates = {
  status: "up_to_date" | "available" | "scheduled" | "installing";
  current: string | null;
  target: string | null;
  canUpdateNow: boolean;
  required: boolean;
  scheduledAt: Iso | null;
  /** 0 to 23, network time. */
  preferredHour: number | null;
  lastUpdatedAt: Iso | null;
  eeros: { id: Id; location: string; firmware: string | null }[];
  /** Unresponsive or incomplete in the last update. */
  stuckEeros: Id[];
};

export type ReleaseNotes = { version: string; releasedAt: Iso | null; title: string | null; features: string[] };

export type Admin = { id: Id; name: string | null; email: string | null; role: Role; isYou: boolean };
export type Invite = { id: Id; nickname: string | null; createdAt: Iso | null; expiresAt: Iso | null };
export type AdminList = { admins: Admin[]; invites: Invite[]; seatsUsed: number; seatsMax: 10 };

// ---------------------------------------------------------------------------
// Activity and notifications

export type EventCategory =
  | "devices"
  | "pause_block"
  | "schedules"
  | "eero_status"
  | "speed_tests"
  | "firmware"
  | "admin"
  | "ports_temperature"
  | "other";

export type NetworkEvent = {
  id: Id;
  at: Iso;
  category: EventCategory;
  /** Raw eero event_type, kept for filters. */
  type: string;
  title: string;
  detail: string | null;
  refs: { deviceId?: Id; eeroId?: Id; profileId?: Id; adminId?: Id };
};

export type EventPage = {
  events: NetworkEvent[];
  nextCursor: string | null;
  counts: Record<EventCategory, number>;
};

export type Notification = { id: Id; at: Iso; title: string; body: string; read: boolean };
export type NotificationPage = { notifications: Notification[]; unread: boolean; nextCursor: string | null };

export type NotificationSettings = {
  eero: Record<string, boolean>;
  push: { networkOffline: boolean; nodeOffline: boolean } | null;
  desktop: Record<string, boolean>;
};

// ---------------------------------------------------------------------------
// Diagnostics and support

export type Check = {
  id: string;
  label: string;
  status: "good" | "warning" | "problem" | "unknown";
  detail: string | null;
};

export type HealthReport = { overall: "good" | "warning" | "problem"; checks: Check[]; at: Iso };

export type DiagnosticsResult = {
  status: string | null;
  issueArea: string | null;
  results: { name: string; status: string; detail: string | null }[];
};

export type SupportInfo = {
  supportId: string | null;
  eero: { phone: string | null; email: string | null; helpUrl: string | null };
  isp: { name: string | null; phone: string | null; url: string | null } | null;
};

// ---------------------------------------------------------------------------
// App

export type AppInfo = {
  version: string;
  /** null under a plain Node test host. */
  electron: string | null;
  os: "darwin" | "win32" | "linux";
  arch: string;
  backend: BackendKind;
  sessionStorage: SessionStorageKind;
  /** "GNOME Keyring", "macOS Keychain", "Windows DPAPI". */
  keychainName: string | null;
  update: { available: boolean; version: string | null; channel: "auto" | "package_manager" } | null;
  configDir: string;
};

export type AppSettings = {
  lastNetworkId: Id | null;
  /** null = default app-like User-Agent. */
  userAgent: string | null;
  planMbps: Record<Id, PlanSpeed>;
  desktopNotifications: Record<string, boolean>;
  openOnLaunch: Id | null;
};

export type AuditEntry = {
  at: Iso;
  surface: "cli" | "mcp";
  id: string;
  effect: Effect;
  ok: boolean;
  code: string | null;
};

// ---------------------------------------------------------------------------
// Host events (the only push channel; never eero data, never the token)

export type HostEvent =
  | { type: "session.changed"; state: "signed_out" | "signed_in"; storage: SessionStorageKind }
  | { type: "network.selected"; networkId: Id }
  | { type: "update.ready"; version: string };
