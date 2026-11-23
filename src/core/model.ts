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
/** eero `device_type` as sent ("phone", "laptop_computer", ...); "generic" if absent. */
export type DeviceType = string;
export type PortAction =
  | "ENABLE_PORT"
  | "DISABLE_PORT"
  | "ENABLE_DATA"
  | "DISABLE_DATA"
  | "ENABLE_POE"
  | "DISABLE_POE"
  | "RESTART_POWER";
/** Each port action's opposite, for Undo and for the action eero lists once it applies. RESTART_POWER has none. */
export const INVERSE_PORT_ACTION: Readonly<Record<PortAction, PortAction | null>> = {
  ENABLE_PORT: "DISABLE_PORT",
  DISABLE_PORT: "ENABLE_PORT",
  ENABLE_DATA: "DISABLE_DATA",
  DISABLE_DATA: "ENABLE_DATA",
  ENABLE_POE: "DISABLE_POE",
  DISABLE_POE: "ENABLE_POE",
  RESTART_POWER: null,
};
/** day: the last 24 hours; week: the last 7 days; month: this calendar month so far (from the 1st, network time). */
export type UsageRange = "day" | "week" | "month";
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
  /** Problems worth a banner, derived in core from eeros and devices. */
  issues: HealthIssue[];
};

export type HealthIssueKind = "weak_link" | "eero_offline" | "network_offline";

export type HealthIssue = {
  kind: HealthIssueKind;
  /** The eero with the problem; null for network_offline. */
  eeroId: Id | null;
  /** That eero's parent in the mesh, when it has one. */
  upstreamId: Id | null;
  /** Devices on the affected eero (or network). */
  deviceIds: Id[];
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
  /** Computed in core against the plan: great (75% and up), below_plan, poor (under 40%). */
  rating: "great" | "below_plan" | "poor" | null;
};

/** The plan speed the person set (Mbps), with an optional name such as "Fiber Gig". */
export type PlanSpeed = { down: number; up: number; label?: string };

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
  /** The hero line, built in core; null until it has something to say. */
  verdict: InternetVerdict | null;
};

export type InternetVerdict = {
  /** steady: last test at 75% of the plan or more (or nothing to compare); slow: under it; down: no internet. `title` is only the provider name. */
  kind: "steady" | "slow" | "down";
  title: string;
  detail: string | null;
};

/** A speed test this app started that has no result yet (`speedtest.run`). */
export type SpeedTestRun = { networkId: Id; startedAt: Iso; resultAt: Iso };

export type SpeedHistory = {
  tests: SpeedTest[];
  avg7d: { downMbps: number | null; upMbps: number | null };
  /** The test started from this process that is still waiting for its result, else null. */
  running: SpeedTestRun | null;
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
  txPowerDbm: number | null;
  /** eero picks the channel itself. */
  autoChannel: boolean | null;
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
  /** Links from the gateway: 0 gateway, 1 its children, and so on. Filled in by core. */
  hop: number | null;
  /** From meshBars (4 to 5 excellent, 3 good, 2 weak, 0 to 1 poor); null when wired. Filled in by core. */
  meshQuality: MeshQuality | null;
  clients: { total: number | null; wired: number | null; wireless: number | null };
  bands: Band[];
  radios: Radio[];
  led: { on: boolean | null; brightness: number | null };
  /** Beacon only. */
  nightlight: Nightlight | null;
  ipv4: string | null;
  ipv6: string[];
  /** LAN subnet in CIDR, e.g. "192.168.4.0/22". */
  subnet: string | null;
  /** The LAN gateway address this eero uses. */
  gatewayIp: string | null;
  mac: string | null;
  bssids: { band: Band; mac: string }[];
  joined: Iso | null;
  uptimeSec: number | null;
  lastHeartbeat: Iso | null;
  powerSource: string | null;
  messages: string[];
};

/** A device or eero behind a port. */
export type PortAttachment = { deviceId: Id | null; eeroId: Id | null; name: string | null };

export type EeroPort = {
  number: number;
  name: string | null;
  status: "up" | "down" | "disabled";
  speedMbps: number | null;
  supportedMbps: number | null;
  isWan: boolean;
  poe: "on" | "off" | null;
  mac: string | null;
  /** One-line summary: the eero behind it, else the only device, else "N devices" with no ids. */
  attached: PortAttachment | null;
  /** Everything behind the port (several behind a switch), eeros first. Empty when nothing is plugged in or for the WAN port. */
  attachments: PortAttachment[];
  /** PortAction values eero allows on this port. */
  actions: PortAction[];
};

export type EeroPorts = { eeroId: Id; ports: EeroPort[] };

/** A port's one-line summary from its attachments: an eero if one is there, else the only device, else "N devices" with no ids. */
export function portSummary(list: ReadonlyArray<PortAttachment>): PortAttachment | null {
  const eero = list.find((a) => a.eeroId !== null);
  if (eero) return eero;
  if (list.length === 1 && list[0]) return list[0];
  return list.length > 1 ? { deviceId: null, eeroId: null, name: `${list.length} devices` } : null;
}

export type MeshQuality = "excellent" | "good" | "weak" | "poor";

/** One installed version, newest first; `current` marks the running one. */
export type FirmwareEntry = { version: string; installedAt: Iso | null; current: boolean };

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

export type DeviceRates = {
  downMbps: number;
  upMbps: number;
  at: Iso;
  /** device.list only: this device's share of the network's current traffic (down plus up), 0 to 100; absent when nothing is moving. */
  sharePct?: number;
};

export type Device = {
  /** MAC without colons. */
  id: Id;
  name: string;
  nickname: string | null;
  hostname: string | null;
  manufacturer: string | null;
  model: string | null;
  type: DeviceType;
  /**
   * A guess from the model, hostname or manufacturer when `type` is
   * "generic" (most devices); null otherwise. Icons use it; `type` stays
   * eero's value.
   */
  inferredType: DeviceType | null;
  /** From `inferredType` when there is one, else from `type`. */
  category: DeviceCategory;
  mac: string;
  privateMac: boolean;
  ipv4: string | null;
  ipv6: string[];
  /** fe80:: address, when eero reports one. */
  ipv6LinkLocal: string | null;
  connected: boolean;
  lastActive: Iso | null;
  /** eero's `first_active`: when the device's current stretch of activity began (it restarts when the device rejoins after a while away, or the eeros restart), not when it first ever joined. */
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
  /** Every device counted once, by the eero it is on (null: none, e.g. blocked). Largest first; sums to total. */
  byEero: { eeroId: Id | null; count: number }[];
  /** By profile (null: Unassigned). Largest first; sums to total. */
  byProfile: { profileId: Id | null; count: number }[];
  /** By manufacturer (null: unknown). Largest first; sums to total. */
  byManufacturer: { manufacturer: string | null; count: number }[];
  /** Devices eero announced as new (its New Device notification, `device.new`) in the last 7 days, newest first. */
  newThisWeek: Id[];
  /** When the newest of those was announced; null when there are none. */
  newestAt: Iso | null;
  rates: DeviceRateTotals | null;
};

/** Live rate totals over devices with fresh rates (device.list summary). */
export type DeviceRateTotals = {
  downMbps: number;
  upMbps: number;
  /** Devices with any traffic right now. */
  active: number;
  at: Iso;
  /** Per band, over connected devices: rate totals, share of traffic (down plus up) and share of connected devices, 0 to 100; null when there is nothing to share. */
  byBand: Record<Band, { downMbps: number; upMbps: number; trafficPct: number | null; devicePct: number | null }>;
  /** The Wi-Fi band carrying the most traffic, for the "6 GHz carries 41% of traffic with 19% of devices" line; null with no Wi-Fi traffic. */
  topBand: Exclude<Band, "wired"> | null;
};

export type DeviceList = { devices: Device[]; summary: DeviceSummary };

/** Result of device.rates.refresh. */
export type BurstResult = { nextBurstAt: Iso };

/** One device a bulk write could not change; `device` is the ref as given. */
export type DeviceWriteFailure = { device: string; id: Id | null; name: string | null; code: string; message: string };

/** A bulk device write (pause, resume, profile, block, unblock): the changed devices, in order, and the ones that failed. */
export type DeviceBulkResult = { devices: Device[]; failed: DeviceWriteFailure[] };

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

/** A schedule to add or replace; eero assigns the id. */
export type ScheduleInput = Omit<Schedule, "id">;

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
export type UnassignedDevices = {
  deviceIds: Id[];
  devicesOnline: number;
  paused: boolean;
  /** Unassigned's scheduled pauses (eero's default profile); none before eeroOS 7.12.4. */
  schedules: Schedule[];
};

/** One pause on today's lane, in minutes after midnight in the network time zone (`start < end`, 0 to 1440). */
export type PauseSegment = {
  start: number;
  end: number;
  /** A schedule's span, or a manual pause that lasts until resumed. */
  kind: "scheduled" | "manual";
  label: string;
  scheduleId: Id | null;
};

/** Today's pauses per profile (and Unassigned, `profileId: null`), for the Profiles page lanes. */
export type PausesToday = {
  /** Today's date in the network time zone, "YYYY-MM-DD". */
  date: string;
  /** IANA zone the minutes are in; null when the network has none (then UTC). */
  timezone: string | null;
  /** Minutes after midnight when this was computed. */
  now: number;
  lanes: { profileId: Id | null; segments: PauseSegment[] }[];
};

/** Result of profile.list. */
export type ProfileList = { profiles: Profile[]; unassigned: UnassignedDevices; today: PausesToday };

/** Result of profile.get: the profile and its lane of today's pauses (as in `profile.list`). */
export type ProfileDetail = Profile & { today: Omit<PausesToday, "lanes"> & { segments: PauseSegment[] } };

// ---------------------------------------------------------------------------
// Guest and Wi-Fi

export type GuestNetwork = {
  enabled: boolean;
  name: string | null;
  /** False: an open guest network. The password itself is only in guest.share. */
  hasPassword: boolean;
  /** Guests connected now. */
  online: number;
  /** Every device seen on the guest network, connected or not. */
  deviceIds: Id[];
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

/** Signal quality buckets on the Signal page, from each device's dBm (see SIGNAL_DBM in commands/wifi.ts). */
export type SignalQuality = "excellent" | "good" | "fair" | "weak";
/** Wi-Fi generations as the health page counts them; `unknown` when a device does not say. */
export type WifiGeneration = "wifi7" | "wifi6e" | "wifi6" | "wifi5" | "wifi4" | "unknown";

/**
 * `wifi.health`: signal, link speed, Wi-Fi generations and radio airtime of the
 * connected wireless devices and eeros right now, worked out in core from the
 * device and eero lists (no history: eero keeps that for eero Plus only).
 */
export type WifiHealth = {
  /** Connected wireless devices that report a signal. */
  devices: number;
  medianDbm: number | null;
  /** Devices per quality bucket, the whole network. */
  quality: Record<SignalQuality, number>;
  /** Devices per 5 dBm, from -90 (and below) to -40 (and above), weakest first: the spread of signal. */
  histogram: { dbm: number; devices: number }[];
  bands: {
    band: WirelessBand;
    devices: number;
    medianDbm: number | null;
    quality: Record<SignalQuality, number>;
    /** Link speed (download, eero to device), median and best. */
    medianMbps: number | null;
    bestMbps: number | null;
  }[];
  /** The weakest connected wireless devices, weakest first (at most 5). */
  weakest: { deviceId: Id; name: string; band: WirelessBand; eeroId: Id | null; eero: string | null; dbm: number; bars: number | null }[];
  /** Every generation once, newest first, then unknown. */
  generations: { generation: WifiGeneration; devices: number }[];
  /** One row per eero (its model and connected devices), then one entry per radio, by band: 5 GHz low and high are two entries. */
  radios: { eeroId: Id; eero: string; model: string | null; devices: number | null; bands: { band: WirelessBand; channel: number | null; widthMhz: number | null; utilization: number | null; txPowerDbm: number | null; devices: number | null }[] }[];
  /** The radio with the highest channel utilisation now, if any reports one. */
  busiest: { eeroId: Id; eero: string; band: WirelessBand; utilization: number } | null;
};

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

/** Who a change takes down: every device, wireless ones, Thread accessories, one port's device, or nobody. */
export type ImpactDrops = "all" | "wireless" | "thread" | "port" | "none";

/** One change in `settings.impact`. */
export type ChangeImpact = {
  /** The write command id (`settings.dns.set`). */
  id: string;
  /** Every eero restarts to apply it. */
  restarts: boolean;
  /** Outage estimate ("about 8 minutes"), null when nothing restarts. */
  estimate: string | null;
  drops: ImpactDrops;
  /** Online devices that drop (none listed for `thread` and `port`: eero does not report those). */
  deviceIds: Id[];
  /** One sentence for the confirm, the impact panel and the CLI. */
  summary: string;
};

/** `settings.impact`: what a set of changes restarts and who drops, before the confirm. */
export type SettingsImpact = {
  changes: ChangeImpact[];
  /** Any change restarts the network. */
  restarts: boolean;
  /** The longest estimate among the changes, null when none restarts. */
  estimate: string | null;
  devicesOnline: number;
  /** Online devices any change drops, each once. */
  deviceIds: Id[];
  /** The changes' summaries joined: every disruptive setting's `needs_confirm` message. */
  summary: string;
};

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

/** Everything from one `GET {net}/routing`. Bridge mode: empty lists and a null lan. */
export type Routing = {
  reservations: Reservation[];
  forwards: Forward[];
  pinholes: Pinhole[];
  lan: LanMap | null;
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

/** Average traffic per hour of day (network time) and the quietest 3-hour window, for the preferred update time. */
export type QuietHours = {
  range: UsageRange;
  /** 24 rows, hour 0 to 23. `avg` is bytes (down plus up) per hour; null when no sample fell in that hour. */
  hours: { hour: number; avg: number | null }[];
  /** Window length in hours (eero's update window). */
  windowHours: number;
  /** Start hour (0 to 23) of the quietest window, which may wrap past midnight; null without a full day of samples. */
  quietest: { start: number; avg: number } | null;
  busiest: { hour: number; avg: number } | null;
  /** Only when asked with `start`: the mean of that window, null when an hour of it has no data. */
  selected?: { start: number; avg: number | null };
};

/** A member of the network. eero sends no email for members (captured M3.1), so there is none here. */
export type Admin = { id: Id; name: string | null; role: Role; isYou: boolean };
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

/** A row action on the Activity stream: `assign_profile` and `unblock` act on `refs.deviceId`, `resume` on `refs.profileId`. */
export type EventAction = "assign_profile" | "resume" | "unblock";

export type NetworkEvent = {
  id: Id;
  at: Iso;
  category: EventCategory;
  /** Raw eero event_type, kept for filters. */
  type: string;
  title: string;
  detail: string | null;
  refs: { deviceId?: Id; eeroId?: Id; profileId?: Id; adminId?: Id };
  /**
   * `events.list`: the write this row offers, on the device or profile in
   * `refs` (Assign profile, Resume, Unblock). It says what the event was, not
   * the current state: the UI shows it only while the target still needs it.
   */
  action?: EventAction;
  /** `events.list {grouped: true}`: older events of the same type and title folded into this row, newest first. */
  grouped?: NetworkEvent[];
};

export type EventPage = {
  events: NetworkEvent[];
  nextCursor: string | null;
  counts: Record<EventCategory, number>;
};

/** day: the last 24 hours; week: the last 7 days; kept: what the backend has kept, at most 24 hours (eero sends only its last ~15 minutes). */
export type EventSummaryRange = "day" | "week" | "kept";
/** minutes: a step picked from the span (range kept), in `step`. */
export type EventBucket = "hour" | "day" | "minutes";

/** One device, eero or profile in the Activity "Most active" list. */
export type EventTopEntity = {
  kind: "device" | "eero" | "profile";
  id: Id;
  name: string;
  count: number;
  /** Its newest event. */
  last: Iso;
  /** The category most of its events have: the colour of its bar. */
  category: EventCategory;
};

/** `events.summary`: totals for the Activity hero, legend and chart. */
export type EventSummary = {
  range: EventSummaryRange;
  bucket: EventBucket;
  /** Window start (network time zone aligned) and end (now). */
  from: Iso;
  to: Iso;
  total: number;
  /** total over the days in the range (1 or 7). */
  dailyAverage: number;
  /** Events in the same length of time just before `from`; null when history does not reach back that far. */
  prior: number | null;
  /** (total - prior) / prior, as a fraction; null when prior is null or 0. */
  change: number | null;
  counts: Record<EventCategory, number>;
  /** One per hour or day of the window, oldest first; `at` is the bucket start. */
  buckets: { at: Iso; total: number; counts: Record<EventCategory, number> }[];
  /**
   * The oldest event read, whatever the filters (null: none). On eero, which
   * sends only its last ~15 minutes, this is how far back the backend's event
   * log reaches, so the Activity hero says "since 9:41 AM".
   */
  earliest: Iso | null;
  /** Bucket length in minutes: 60 for hour, 1440 for day, picked from the span for range kept. */
  step: number;
  /** Range kept only: the devices, eeros and profiles with the most events (at most 4), most first. */
  top?: EventTopEntity[];
  /** Range kept only: how many more devices, eeros and profiles have events. */
  topMore?: number;
  /** The page budget ran out before the window start, so counts are a lower bound. */
  partial: boolean;
};

export type Notification = {
  id: Id;
  at: Iso;
  title: string;
  body: string;
  read: boolean;
  /** eero `category` as sent; null when absent. */
  category: string | null;
  /** The device a notification is about (from `meta.device_url`). */
  refs: { deviceId?: Id };
};
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

export type HealthReport = {
  overall: "good" | "warning" | "problem";
  /** 0 to 100, built in core from the check statuses. */
  score: number;
  checks: Check[];
  at: Iso;
};

export type DiagnosticsResult = {
  status: string | null;
  issueArea: string | null;
  results: { name: string; status: string; detail: string | null }[];
};

/** `diagnostics.run`: eero's cloud result, the symptom asked about and next steps built in core. */
export type Diagnosis = DiagnosticsResult & {
  symptom: "internet_slow" | "internet_offline" | "connection_drops" | "eeros_red" | null;
  /** Plain sentences, most useful first; empty when there is nothing to do. */
  steps: string[];
  at: Iso;
};

export type SupportInfo = {
  supportId: string | null;
  /** Who answers support for this network (`name` in `{net}/support`), usually eero. */
  eero: {
    name: string | null;
    phone: string | null;
    email: string | null;
    helpUrl: string | null;
    contactUrl: string | null;
    emailFormUrl: string | null;
  };
  isp: { name: string | null; phone: string | null; url: string | null } | null;
};

// ---------------------------------------------------------------------------
// Integrations

export type IntegrationId = "homekit" | "amazon" | "builtin" | "smart_home_hub" | "ffs";

export type Integration = {
  /** False when eero reports no support for it here (a 403 or 404 counts as unavailable, not an error). */
  available: boolean;
  /** null when unavailable or unknown. */
  enabled: boolean | null;
  /** One line of context, e.g. "2 Echo devices extend your network". */
  detail: string | null;
};

export type Integrations = Record<IntegrationId, Integration>;

// ---------------------------------------------------------------------------
// App

/** How this copy of Mesh UI was installed (src/main/install-kind.ts). */
export type InstallKind = "dev" | "mac" | "nsis" | "portable" | "appimage" | "deb" | "rpm";

export type UpdateChannel = "latest" | "beta";

/** `available`: a newer version exists but this copy cannot install it itself (an unsigned macOS build); download it by hand. */
export type UpdateState = "off" | "idle" | "checking" | "available" | "downloading" | "ready" | "error" | "unsupported";

/** The auto-updater's state (docs/platform/build-and-release.md#auto-update). */
export type UpdateStatus = {
  /** `unsupported`: this install kind or host does not update itself (deb, rpm, portable, dev, the CLI). */
  state: UpdateState;
  /** The version found or downloaded; null when none. */
  version: string | null;
  channel: UpdateChannel;
  checkedAt: Iso | null;
  /** Download progress 0..1 while `downloading`, else null. */
  progress: number | null;
  /** One line when `state` is `error`. */
  error: string | null;
};

/** The `mesh-ui` command on PATH (docs/platform/build-and-release.md#cli-launcher). */
export type CliStatus = {
  /** A launcher exists at `path`. */
  installed: boolean;
  path: string | null;
  /** `mesh-ui` resolves on PATH. */
  onPath: boolean;
  /** `app.cli.install` can put it there (macOS and AppImage; installers do it themselves). */
  canInstall: boolean;
  /** Installed, but pointing at an app that moved or was replaced. */
  reinstall: boolean;
  /**
   * A line to paste into a terminal that puts the launcher's folder on PATH,
   * when it is not on PATH yet (on macOS the bundle's `bin`, no admin needed).
   */
  pathLine: string | null;
};

export type AppInfo = {
  version: string;
  /** null under a plain Node test host. */
  electron: string | null;
  os: "darwin" | "win32" | "linux";
  arch: string;
  backend: BackendKind;
  /** The eero backend is talking to the local fake eero server (dev:fake, --fake). Always false for live and demo. */
  fakeServer: boolean;
  sessionStorage: SessionStorageKind;
  /** "GNOME Keyring", "macOS Keychain", "Windows DPAPI". */
  keychainName: string | null;
  install: InstallKind;
  update: UpdateStatus;
  /** null where the host cannot tell (the CLI and MCP hosts, tests): only the window installs the CLI. */
  cli: CliStatus | null;
  /**
   * Whether this desktop can show a system tray icon (Keep running in the
   * tray). null where the host has no window (the CLI and MCP hosts, tests).
   */
  tray: boolean | null;
  /** Start at login (`app.startup.set`). null where the host has no window (the CLI and MCP hosts, tests). */
  startup: StartupStatus | null;
  configDir: string;
};

/** Whether Mesh UI opens when the user signs in to the computer, as the OS records it. */
export type StartupStatus = {
  /** false for a development build: it would register the bare Electron binary. */
  supported: boolean;
  enabled: boolean;
};

export type AppSettings = {
  lastNetworkId: Id | null;
  /** null = default app-like User-Agent. */
  userAgent: string | null;
  planMbps: Record<Id, PlanSpeed>;
  desktopNotifications: Record<string, boolean>;
  openOnLaunch: Id | null;
  /** Check for updates 10 s after launch and every 6 h (default true). */
  autoUpdate: boolean;
  /** Default `latest`. */
  updateChannel: UpdateChannel;
  /** Closing (and on Windows and Linux minimizing) hides the window to the system tray, so desktop alerts keep arriving (default false). */
  runInTray: boolean;
};

/** One CLI or MCP command from the audit log, as Settings lists it. */
export type AuditEntry = {
  at: Iso;
  surface: "cli" | "mcp";
  id: string;
  /** null for an unknown command id. */
  effect: Effect | null;
  ok: boolean;
  code: string | null;
};

/** `app.audit.list`: the audit log summarised for the CLI and agents panel. */
export type AuditList = {
  /** Newest first, at most `limit`. */
  entries: AuditEntry[];
  /** The last 7 local days, oldest first, `date` as YYYY-MM-DD. */
  week: { date: string; count: number }[];
  /** Commands this week (the sum of `week`). */
  weekTotal: number;
  /** Commands this week refused with `needs_confirm`. */
  needsConfirm: number;
  /** Newest MCP command, or null when MCP was never used. */
  mcpLastAt: Iso | null;
};

// ---------------------------------------------------------------------------
// Conversations (eero's assistant chat). See docs/ux/pages/conversations.md.

/** A past chat in the history list. */
export type ConversationSummary = { id: Id; title: string; createdAt: Iso | null };

/** A starter prompt: `label` on the chip, `prompt` sent when it is clicked. */
export type ConversationSuggestion = { label: string; prompt: string };

/** One step eero took while answering: a tool call or a reasoning note. `text` is what eero said about it, if anything. */
export type ConversationStep = { kind: "tool" | "reasoning"; text: string | null };

/** A label and value on an assistant card ("Status", "Online"). */
export type ConversationCardRow = { label: string; value: string };

/** One thing in a chat, in order. */
export type ConversationItem =
  | { kind: "user"; id: string; text: string }
  /** eero's answer. Plain text with light Markdown (bold, lists, code). `done` once eero marks it finished. */
  | { kind: "reply"; id: string; text: string; done: boolean }
  /** What eero did while working, grouped between two messages. */
  | { kind: "steps"; id: string; steps: ConversationStep[] }
  /** eero asks before it changes something. `id` is eero's interrupt id; `answer` stays null until someone answers. */
  | { kind: "permission"; id: string; question: string; tools: string[]; answer: "approved" | "declined" | null }
  /** An inline card (a device, an eero, contacts). `choices` are replies that send as a message. */
  | { kind: "card"; id: string; title: string; type: string | null; rows: ConversationCardRow[]; contacts: ConversationCardRow[]; choices: string[] }
  | { kind: "error"; id: string; message: string };

/** A whole chat: `id` is null for one not started yet. */
export type Conversation = { id: Id | null; title: string | null; items: ConversationItem[] };

/** What one turn (a message, or an answer to a permission ask) added. */
export type ConversationTurn = {
  conversationId: Id | null;
  /** This turn's items only, the user's message first. */
  items: ConversationItem[];
  /** eero stopped to ask permission: the id of the open ask. */
  waitingFor: string | null;
};

/**
 * One thing read from eero's reply stream, already mapped from eero's shape.
 * Backends hand these to core, and core builds the chat from them
 * (`applyEvent` in src/core/conversation.ts), for live replies and history alike.
 */
export type ConversationEvent =
  | { type: "conversation"; id: Id }
  | { type: "user"; id: string | null; text: string }
  /**
   * `append` false replaces the text (eero's InitialMessage), true adds to it (MessageDelta).
   * `merge`: eero did not say which (a plain `message` event): text that starts with what is
   * there already replaces it, anything else is added.
   */
  | { type: "text"; messageId: string | null; text: string; append: boolean; merge?: true }
  | { type: "finished"; messageId: string | null }
  | { type: "step"; step: ConversationStep }
  | { type: "permission"; id: string; question: string; tools: string[] }
  | { type: "answer"; id: string | null; approved: boolean }
  /** `card` null removes the card with this id. */
  | { type: "card"; id: string; card: Omit<Extract<ConversationItem, { kind: "card" }>, "kind" | "id"> | null }
  | { type: "error"; message: string };

// ---------------------------------------------------------------------------
// Host events (the only push channel; never the token, and eero data only for a chat reply as it streams)

export type HostEvent =
  | { type: "session.changed"; state: "signed_out" | "signed_in"; storage: SessionStorageKind }
  | { type: "network.selected"; networkId: Id }
  | { type: "update.changed"; status: UpdateStatus }
  /** A chat reply so far, while `conversation.send` (or approve, decline) runs. `turn` is the caller's `turnId`. */
  | { type: "conversation.progress"; turn: string; networkId: Id; conversationId: Id | null; items: ConversationItem[] };
