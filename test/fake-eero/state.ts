/**
 * State of the fake eero server: one account, two networks, and the
 * sessions it has issued. Created fresh per test (`createState()`), mutated
 * by routes so writes stick. Every name, MAC, IP and serial is invented.
 *
 * To extend: add a field to `FakeNetwork` (or `FakeState.extra` for
 * something small) and seed it in `seedNetworks`. Raw shapes come from
 * src/core/eero/raw.ts, so model changes break the fixtures at compile time.
 */

import type {
  RawAccount,
  RawAcCompat,
  RawAppEvent,
  RawConnections,
  RawDevice,
  RawEero,
  RawDiagnostics,
  RawEvent,
  RawFastTransition,
  RawFirmwareHistoryEntry,
  RawInvite,
  RawMember,
  RawNetwork,
  RawNotification,
  RawNotificationSettings,
  RawPermissions,
  RawPortInterface,
  RawPowerSavingSchedule,
  RawProfile,
  RawRouting,
  RawSpeedTest,
  RawSupport,
  RawThread,
  RawUpdates,
  RawWpa3PerBand,
} from "../../src/core/eero/raw";

/** The one code the fake sign-in accepts. */
export const FAKE_CODE = "123456";

export type FakeSession = {
  token: string;
  kind: "pending" | "session";
  login: string;
  /** Last resend, epoch ms. */
  resentAt: number | null;
};

export type FakeNetwork = {
  id: string;
  network: RawNetwork;
  permissions: RawPermissions;
  eeros: RawEero[];
  devices: RawDevice[];
  profiles: RawProfile[];
  speedtests: RawSpeedTest[];
  events: RawEvent[];
  /** Blocked MACs. */
  blacklist: string[];
  /** `GET {eero}/connections` per eero id. */
  connections: Record<string, RawConnections>;
  /** `GET /2.2/eeros/{id}/firmware_update/history` rows per eero id, newest first as eero sends them. */
  firmwareHistory: Record<string, RawFirmwareHistoryEntry[]>;
  /** `GET {net}/routing`. */
  routing: RawRouting;
  /** `GET {net}/updates`; the network's embedded `updates` is the same object. */
  updates: RawUpdates;
  // M3 reads, seeded in the shapes captured on a real network (2026-11-13). Routes come with each story.
  // The guest network (`GET {net}/guestnetwork`) is the network's embedded `guest_network`, password included.
  /** `GET {net}/wpa3_per_band`. */
  wpa3PerBand: RawWpa3PerBand;
  /** `GET {net}/fast_transition`. */
  fastTransition: RawFastTransition;
  /** `GET {net}/power_saving/schedules` answers `{schedules}`. */
  powerSavingSchedules: RawPowerSavingSchedule[];
  /** `GET {net}/thread`, secrets included; null: the route answers 404. */
  thread: RawThread | null;
  /** `GET {net}/ac_compat`. */
  acCompat: RawAcCompat;
  /** `GET {net}/app_events` rows in the captured shape, newest first. `events` above is the older guessed shape the current route serves until M3.6 moves to these. */
  appEvents: RawAppEvent[];
  /** `GET {net}/notifications_history` rows, newest first. */
  notificationsHistory: RawNotification[];
  /** `GET {net}/notifications/has_unread`. */
  hasUnread: boolean;
  /** `GET {net}/notifications`. */
  notificationSettings: RawNotificationSettings;
  /** `GET {net}/diagnostics`. */
  diagnostics: RawDiagnostics;
  /** `GET {net}/support` (`/2.2/`). */
  support: RawSupport;
  /** `GET {net}/members` answers `{members}`. */
  members: RawMember[];
  /** `GET {net}/invites`; null: the route answers 403 (an admin cannot read them). */
  invites: RawInvite[] | null;
};

export type FakeState = {
  account: RawAccount;
  /** By network id, in account order. */
  networks: Map<string, FakeNetwork>;
  sessions: Map<string, FakeSession>;
  /** Free-form room for areas that need a little extra state. */
  extra: Record<string, unknown>;
  now(): number;
  /** A new opaque token, e.g. "fake-session-3". */
  nextToken(kind: FakeSession["kind"]): string;
};

export type StateOptions = { now?: () => number };

export function createState(options: StateOptions = {}): FakeState {
  let counter = 0;
  const networks = new Map<string, FakeNetwork>();
  for (const net of seedNetworks()) networks.set(net.id, net);
  return {
    account: seedAccount([...networks.values()]),
    networks,
    sessions: new Map(),
    extra: {},
    now: options.now ?? (() => Date.now()),
    nextToken: (kind) => `fake-${kind}-${++counter}-${Math.random().toString(36).slice(2, 10)}`,
  };
}

/** Starts a signed-in session and returns its token (tests seed the client's SecretStore with it). */
export function addSession(state: FakeState, login = "alex@example.com"): string {
  const token = state.nextToken("session");
  state.sessions.set(token, { token, kind: "session", login, resentAt: null });
  return token;
}

// ---------------------------------------------------------------------------
// Seed

const MAC_PREFIX = "0a:1b:2c";
const mac = (n: number) => `${MAC_PREFIX}:00:${Math.floor(n / 256).toString(16).padStart(2, "0")}:${(n % 256).toString(16).padStart(2, "0")}`;
const compact = (m: string) => m.replace(/:/g, "");
const iso = (s: string) => `2026-11-${s}Z`;

function seedAccount(nets: FakeNetwork[]): RawAccount {
  return {
    name: "Alex Kim",
    email: { value: "alex@example.com", verified: true },
    phone: { value: "+15550100142", country_code: "1", national_number: "5550100142", verified: true },
    log_id: "FAKE0LOG01",
    role: "owner",
    premium_status: "inactive",
    push_settings: { networkOffline: true, nodeOffline: true },
    auth: { type: "email" },
    can_transfer: true,
    networks: {
      count: nets.length,
      data: nets.map((n) => ({ url: n.network.url, name: n.network.name, created: n.network.created, nickname_label: n.network.nickname_label ?? null, access_expires_on: null })),
    },
  };
}

/** `up`: index of the parent eero (default the gateway, index 0). */
type EeroSeed = { id: string; serial: string; location: string; model: string; gateway?: boolean; status?: string; bars?: number; wired?: boolean; up?: number; clients: number };
type DeviceSeed = { n: number; name: string | null; host: string; type: string; eero: number; band: "2.4" | "5" | "6" | "wired"; online?: boolean; paused?: boolean; profile?: number; guest?: boolean };

function seedNetworks(): FakeNetwork[] {
  return [
    buildNetwork({
      id: "100001",
      name: "Maple Street",
      role: "owner",
      status: "connected",
      eeros: [
        { id: "500001", serial: "FAKE00LR0001", location: "Living Room", model: "eero Max 7", gateway: true, wired: true, clients: 5 },
        { id: "500002", serial: "FAKE00OF0002", location: "Office", model: "eero Pro 7", bars: 5, clients: 2 },
        { id: "500003", serial: "FAKE00UH0003", location: "Upstairs Hall", model: "eero 7", wired: true, clients: 1 },
        { id: "500004", serial: "FAKE00GA0004", location: "Garage", model: "eero Beacon", status: "yellow", bars: 1, up: 1, clients: 0 },
      ],
      profiles: ["Alex", "Jamie", "Mia", "Leo"],
      devices: [
        { n: 1, name: "Alex's Phone", host: "alex-phone", type: "phone", eero: 0, band: "5", profile: 0 },
        { n: 2, name: "Alex's Laptop", host: "alex-laptop", type: "laptop_computer", eero: 1, band: "6", profile: 0 },
        { n: 3, name: "Jamie's Phone", host: "jamie-phone", type: "phone", eero: 0, band: "5", profile: 1 },
        { n: 4, name: "Mia's Tablet", host: "mia-tablet", type: "tablet", eero: 2, band: "5", profile: 2 },
        { n: 5, name: "Leo's Switch", host: "leo-switch", type: "game_console", eero: 0, band: "2.4", paused: true, profile: 3 },
        { n: 6, name: "Living Room TV", host: "living-tv", type: "television", eero: 0, band: "wired" },
        { n: 7, name: null, host: "esp-plug-07", type: "plug", eero: 1, band: "2.4", guest: true },
        { n: 8, name: "Old Printer", host: "printer", type: "printer", eero: 0, band: "2.4", online: false },
      ],
    }),
    buildNetwork({
      id: "100002",
      name: "Lake Cabin",
      role: "standard-admin",
      status: "offline",
      eeros: [{ id: "500010", serial: "FAKE00LC0010", location: "Cabin", model: "eero 6+", gateway: true, wired: true, status: "red", clients: 0 }],
      profiles: [],
      devices: [
        { n: 101, name: "Cabin Camera", host: "cam-01", type: "security_camera", eero: 0, band: "2.4", online: false },
        { n: 102, name: "Thermostat", host: "thermo", type: "thermostat", eero: 0, band: "2.4", online: false },
      ],
    }),
  ];
}

function buildNetwork(seed: { id: string; name: string; role: string; status: string; eeros: EeroSeed[]; profiles: string[]; devices: DeviceSeed[] }): FakeNetwork {
  const netUrl = `/2.2/networks/${seed.id}`;
  const eeros: RawEero[] = seed.eeros.map((e, i) => ({
    url: `/2.2/eeros/${e.id}`,
    serial: e.serial,
    location: e.location,
    model: e.model,
    model_number: `FK${String(i + 1).padStart(4, "0")}`,
    gateway: e.gateway ?? false,
    is_primary_node: e.gateway ?? false,
    status: e.status ?? "green",
    state: e.status === "red" ? "OFFLINE" : "ONLINE",
    heartbeat_ok: e.status !== "red",
    last_heartbeat: iso("12T18:00:00"),
    joined: iso("01T12:00:00"),
    last_reboot: iso("05T03:00:00"),
    uptime: { since_last_reboot_s: 7 * 86_400 },
    os: "eeroOS",
    os_version: "7.10.1",
    update_available: seed.id === "100001",
    ip_address: `192.168.4.${i + 1}`,
    mac_address: mac(900 + i),
    bands: ["band_2_4GHz", "band_5GHz", "band_6GHz"],
    wired: e.wired ?? false,
    connection_type: e.wired ? "WIRED" : "WIRELESS",
    using_wan: e.gateway ?? false,
    mesh_quality_bars: e.bars ?? 5,
    ethernet_status: ethernetStatus(e, seed.eeros),
    // As eero sends it: the parent's location as `name` and a node id that is not an eero id; no url.
    wireless_upstream_node: e.gateway || e.wired ? null : { name: seed.eeros[e.up ?? 0]?.location ?? "", primary_mesh_radio: "band_5GHz", node_or_proxied_node_id: 9000 + (e.up ?? 0), is_proxied_node: false },
    connected_clients_count: e.clients,
    connected_wired_clients_count: e.gateway ? 1 : 0,
    connected_wireless_clients_count: Math.max(0, e.clients - (e.gateway ? 1 : 0)),
    led_on: true,
    led_brightness: 100,
    nightlight: e.model === "eero Beacon" ? { url: `/2.2/eeros/${e.id}/nightlight/settings`, enabled: false, brightness_percentage: 50, schedule: { enabled: false, on: "20:00", off: "07:00" } } : null,
    provides_wifi: true,
    network: { url: netUrl, name: seed.name },
    resources: { led_action: `/2.2/eeros/${e.id}/led`, reboot: `/2.2/eeros/${e.id}/reboot`, connections: `/2.2/eeros/${e.id}/connections` },
  }));

  const profiles: RawProfile[] = seed.profiles.map((name, i) => ({
    url: `${netUrl}/profiles/${700 + i}`,
    name,
    paused: name === "Leo",
    default: false,
    state: { value: name === "Leo" ? "paused" : "active" },
    devices: [],
    // Mia: the LD day form and FF's lowercase day names with seconds, so the mapper sees both.
    schedule:
      name === "Mia"
        ? [
            { url: `${netUrl}/profiles/${700 + i}/schedules/1`, name: "Bedtime", days: ["MON", "TUE", "WED", "THU", "SUN"], start: "21:00", end: "07:00", enabled: true },
            { url: `${netUrl}/profiles/${700 + i}/schedules/2`, name: "Homework", days: ["monday", "friday"], start: "16:00:00", end: "18:00:00", enabled: false },
          ]
        : [],
    resources: { schedules: `${netUrl}/profiles/${700 + i}/schedules` },
  }));

  // Reserved devices (see seedRouting) keep static-range addresses (.4.20 to .4.99); the rest take DHCP leases from the pool (.4.100 up).
  const reservedSeeds = new Set([seed.devices.find((d) => d.band === "wired"), seed.devices.find((d) => d.type === "laptop_computer")]);
  const devices: RawDevice[] = seed.devices.map((d) => {
    const m = mac(d.n);
    const ip = reservedSeeds.has(d) ? `192.168.4.${20 + (d.n % 80)}` : `192.168.4.${100 + (d.n % 150)}`;
    const eero = seed.eeros[d.eero];
    const profile = d.profile === undefined ? null : profiles[d.profile];
    const wired = d.band === "wired";
    const device: RawDevice = {
      url: `${netUrl}/devices/${compact(m)}`,
      mac: m,
      nickname: d.name,
      hostname: d.host,
      display_name: d.name ?? d.host,
      manufacturer: "Example Corp",
      model_name: null,
      device_type: d.type,
      ip,
      ips: [ip],
      connected: d.online ?? true,
      wireless: !wired,
      connection_type: wired ? "wired" : "wireless",
      source: eero ? { location: eero.location, is_gateway: eero.gateway ?? false, url: `/2.2/eeros/${eero.id}`, model: eero.model, serial_number: eero.serial } : {},
      interface: wired ? {} : { frequency: d.band, frequency_unit: "GHz" },
      ssid: seed.name,
      subnet_kind: d.guest ? "guest" : "main",
      is_guest: d.guest ?? false,
      is_private: false,
      connectivity: wired ? {} : { signal: "-52 dBm", signal_avg: "-54 dBm", score: 0.9, score_bars: 4, rx_bitrate: "866.7 Mbit/s" },
      usage: null,
      last_active: iso("12T17:55:00"),
      first_active: iso("01T12:30:00"),
      paused: d.paused ?? false,
      blocked: false,
      profile: profile ? { url: profile.url, name: profile.name, paused: profile.paused } : null,
    };
    if (profile) profile.devices?.push({ url: device.url, mac: m, nickname: d.name, display_name: device.display_name, connected: device.connected });
    return device;
  });

  const online = devices.filter((d) => d.connected).length;
  const maple = seed.id === "100001";
  const updates: RawUpdates = {
    has_update: maple,
    update_required: false,
    can_update_now: true,
    target_firmware: maple ? "7.11.0" : null,
    update_to_firmware: maple ? "7.11.0" : null,
    min_required_firmware: "7.8.0",
    update_status: maple ? "available" : "up_to_date",
    scheduled_update_time: null,
    preferred_update_hour: 3,
    last_update_started: iso("05T03:00:00"),
    last_user_update: { unresponsive_eeros: [], incomplete_eeros: [] },
    manifest_resource: null,
  };
  const network: RawNetwork = {
    url: netUrl,
    name: seed.name,
    display_name: seed.name,
    nickname_label: null,
    owner: "Alex Kim",
    status: seed.status,
    health: {
      internet: { status: seed.status === "offline" ? "disconnected" : "connected", isp_up: seed.status !== "offline" },
      eero_network: { status: seed.status === "offline" ? "disconnected" : "connected" },
    },
    messages: [],
    last_reboot: iso("05T03:00:00"),
    timezone: { value: "America/New_York" },
    created: "2025-03-14T15:00:00Z",
    speed: { status: "success", date: iso("12T03:00:00"), down: { value: 912.4, units: "Mbps" }, up: { value: 40.2, units: "Mbps" } },
    geo_ip: { isp: "Example Fiber", org: "Example Fiber", city: "Springfield", region: "NY", countryCode: "US", timezone: "America/New_York" },
    ip_settings: { public_ip: "203.0.113.9", double_nat: false },
    gateway_ip: "203.0.113.1",
    wan_ip: "203.0.113.9",
    wan_type: "DHCP",
    connection: { mode: "nat" },
    dhcp: { mode: "automatic" },
    dns: { mode: "automatic", caching: true, parent: { ips: ["203.0.113.53"] }, custom: { ips: [] } },
    upnp: true,
    ipv6_upstream: false,
    band_steering: true,
    wpa3: false,
    sqm: false,
    thread: seed.id === "100001",
    power_saving: maple,
    power_saving_schedule_enabled: maple,
    password: maple ? "fake-main-pass-01" : "fake-cabin-pass-02",
    mlo_mode: maple ? "multi" : undefined,
    wireless_mode: "auto",
    auto_setup_mode: "enabled",
    nat_port_randomization: false,
    ipv6: { name_servers: { mode: "automatic", custom: [] } },
    pppoe_enabled: null,
    pppoe_username: null,
    vlan: null,
    temporary_flags: {},
    homekit: null,
    amazon_account_linked: maple,
    ffs: true,
    alexa_skill: false,
    proxied_nodes: {
      enabled: maple,
      devices: maple
        ? [{ url: `${netUrl}/proxied_nodes/${compact(mac(990))}`, client_device_url: `${netUrl}/devices/${compact(mac(990))}`, mac_address: mac(990), ip_address: "192.168.4.190", display_name: "Kitchen Echo", model_name: "Echo (4th Gen)", manufacturer: "Example Corp", status: "connected", enabled: true, is_meshing: true, is_guest: false, blocked: false, paused: false, serial: "FAKEECHO0001", os: "FireOS", os_version: "1.0", first_seen: iso("01T12:00:00") }]
        : [],
    },
    // As eero sends it: the password is in the clear here and in GET {net}/guestnetwork.
    guest_network: maple
      ? { url: `${netUrl}/guestnetwork`, name: `${seed.name} Guest`, password: "fake-guest-pass-01", enabled: true, resources: { password: `${netUrl}/guestnetwork/password` } }
      : { url: `${netUrl}/guestnetwork`, name: `${seed.name} Guest`, password: "fake-guest-pass-02", enabled: false, resources: { password: `${netUrl}/guestnetwork/password` } },
    updates,
    capabilities: {
      device_blacklist: { capable: true },
      led_action: { capable: true },
      thread_network: { capable: seed.id === "100001" },
      sqm: { capable: true },
      wpa3: { capable: true },
      historical_usage: { capable: true },
    },
    resources: {
      devices: `${netUrl}/devices`,
      eeros: `${netUrl}/eeros`,
      profiles: `${netUrl}/profiles`,
      settings: `${netUrl}/settings`,
      reboot: `${netUrl}/reboot`,
      speedtest: `${netUrl}/speedtest`,
      guestnetwork: `${netUrl}/guestnetwork`,
      updates: `${netUrl}/updates`,
      device_blacklist: `${netUrl}/blacklist`,
      burst_reporters: `${netUrl}/burst_reporters`,
      routing: `${netUrl}/routing`,
    },
    eeros: { count: eeros.length, data: eeros },
    clients: { count: online, url: `${netUrl}/devices` },
    profiles: { count: profiles.length, url: `${netUrl}/profiles` },
  };

  const full = { create: true, read: true, update: true, delete: true };
  const readOnly = { create: false, read: true, update: false, delete: false };
  return {
    id: seed.id,
    network,
    permissions: {
      role: seed.role,
      permissions: seed.role === "owner" ? { eeros: full, network: full, "network.transfer": full } : { eeros: full, network: full, "network.transfer": readOnly },
    },
    eeros,
    devices,
    profiles,
    speedtests: [
      { date: "2026-11-12T03:00:00+0000", down_mbps: 912.4, up_mbps: 40.2 },
      { date: "2026-11-11T03:00:00+0000", down_mbps: 884.1, up_mbps: 39.7 },
      { date: "2026-11-10T03:00:00+0000", down_mbps: 901.9, up_mbps: 41.0 },
    ],
    events: seed.id !== "100001" ? [] : [
      { id: 1, event_type: "device.connected", title: "Alex's Phone connected", created: iso("12T17:50:00") },
      { id: 2, event_type: "profile.paused", title: "Leo was paused", created: iso("12T16:00:00") },
      { id: 3, event_type: "eero.offline", title: "Garage went offline", created: iso("12T09:15:00") },
    ],
    blacklist: [],
    connections: Object.fromEntries(seed.eeros.map((e, i) => [e.id, seedConnections(e, i, devices)])),
    firmwareHistory: Object.fromEntries(
      eeros.map((e) => [
        e.url?.split("/").pop() ?? "",
        // Newest first, as eero sends it; `firmware_version` is os_version plus a build tail.
        [
          historyRow(3, `${e.os_version}+20261105-0300-1.prod.fake`, "7.9.2+20260901-0300-1.prod.fake", iso("05T03:00:00")),
          historyRow(2, "7.9.2+20260901-0300-1.prod.fake", "7.8.0+20260701-0300-1.prod.fake", "2026-09-01T03:00:00Z"),
          historyRow(1, "7.8.0+20260701-0300-1.prod.fake", null, "2026-07-01T03:00:00Z"),
        ],
      ]),
    ),
    routing: seedRouting(netUrl, maple ? devices : []),
    updates,
    wpa3PerBand: maple ? { band_2_4_ghz: "WPA2_WPA3", band_5_ghz: "WPA2_WPA3" } : { band_2_4_ghz: "WPA2", band_5_ghz: "WPA2" },
    fastTransition: { fast_transition: maple },
    powerSavingSchedules: maple ? [{ url: `${netUrl}/power_saving/schedules/1`, id: 1, name: "Overnight", days: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"], start_time: "01:00", end_time: "06:00", enabled: true }] : [],
    thread: maple
      ? { url: `${netUrl}/thread`, enabled: true, enable_credential_syncing: true, name: "FakeThread", xpan_id: "fa4efa4efa4efa4e", pan_id: "0xfa4e", channel: 15, master_key: "fake-thread-master-key-0000000001", commissioning_credential: "fake-thread-pskc-0000000000000001", border_agent: { ip: "192.168.4.1", port: 49191 } }
      : null,
    acCompat: { enabled: false },
    appEvents: maple
      ? [
          { hash: "fake-ev-3", timestamp_ms: Date.parse(iso("12T17:50:00")), description: "Alex's Phone connected", category: "device" },
          { hash: "fake-ev-2", timestamp_ms: Date.parse(iso("12T16:00:00")), description: "Leo was paused", category: "profile" },
          { hash: "fake-ev-1", timestamp_ms: Date.parse(iso("12T09:15:00")), description: "Garage went offline", category: "eero" },
        ]
      : [],
    notificationsHistory: maple
      ? [
          { uuid: "fake-nt-2", category: "device", title: "New device joined", body: "Alex's Laptop joined Maple Street.", created_at: iso("12T17:40:00"), meta: { device_url: devices[1]?.url, network_url: netUrl } },
          { uuid: "fake-nt-1", category: "eero", title: "Garage is offline", body: "Garage stopped checking in.", created_at: iso("12T09:15:00"), meta: { network_url: netUrl } },
        ]
      : [{ uuid: "fake-nt-3", category: "network", title: "Lake Cabin is offline", body: "Lake Cabin stopped checking in.", created_at: iso("10T08:00:00"), meta: { network_url: netUrl } }],
    hasUnread: maple,
    // Every key the capture showed, eero Plus ones included (core leaves those out).
    notificationSettings: {
      "device.new": true,
      "device.restrict.new.private": false,
      "network.updated": true,
      "premium.activity.weeklyReport": false,
      "network.dataUsageReport": false,
      "permissions.updates": true,
      "backup.internet.status.change": false,
      "backup.wan.change": false,
      "port.security.blocked": true,
      "network.scheduledUpdate.earlyNotification": true,
      "network.scheduledUpdate.lateNotification": false,
    },
    // Only `status` came back from a real network that had not run diagnostics.
    diagnostics: { status: maple ? "completed" : "idle" },
    support: { support_phone: "+18775550123", contact_url: "https://support.example.com/contact", help_url: "https://support.example.com/help", email_web_form_url: "https://support.example.com/email", name: "eero" },
    members: maple
      ? [
          { user_id: 1001, user_role: "owner", user_name: "Alex Kim", user_tags: [] },
          { user_id: 1002, user_role: "admin", user_name: "Jamie Kim", user_tags: [] },
        ]
      : [
          { user_id: 1003, user_role: "owner", user_name: "Rose Kim", user_tags: [] },
          { user_id: 1001, user_role: "admin", user_name: "Alex Kim", user_tags: [] },
        ],
    // Lake Cabin is an admin network for the fake account: invites answer 403 there.
    invites: maple ? [{ invite_id: "fake-inv-1", invite_nickname: "Sam", created: iso("12T14:30:00") }] : null,
  };
}

/**
 * `ethernet_status` as eero sends it: two ports. The gateway's WAN-labelled
 * port has carrier but no neighbour; a wired satellite has its parent as an
 * EERO neighbour on its WAN-labelled port, with `isLeafWiredToUpstream`
 * false (as on the real network).
 */
function ethernetStatus(e: EeroSeed, all: EeroSeed[]): NonNullable<RawEero["ethernet_status"]> {
  const parent = all[e.up ?? 0];
  const uplinkWired = !e.gateway && e.wired && e.status !== "red" && parent;
  // A port with no link still reports a speed ("P10"), so readers must check hasCarrier.
  const linked = (e.gateway || e.wired) && e.status !== "red";
  const row = (n: number, wan: boolean) => ({
    interfaceNumber: n,
    hasCarrier: Boolean(linked),
    speed: linked ? (wan && e.gateway ? "P2500" : "P1000") : "P10",
    isWanPort: wan,
    isLte: false,
    isLeafWiredToUpstream: false,
    neighbor: wan && uplinkWired ? { type: "EERO", metadata: { port: 1, port_name: "LAN", location: parent.location, url: `/2.2/eeros/${parent.id}` } } : null,
    port_name: wan ? "WAN" : "LAN",
  });
  return { wiredInternet: Boolean(e.gateway || e.wired), segmentId: "1", statuses: [row(0, false), row(1, true)] };
}

/** One `firmware_update/history` row in eero's shape; finished a minute after it started. */
function historyRow(n: number, version: string, previous: string | null, started: string): RawFirmwareHistoryEntry {
  return {
    id: `fw-${n}`,
    timestamp: started,
    firmware_version: version,
    previous_version: previous,
    status: "completed",
    update_type: n % 2 ? "automatic" : "manual",
    duration_seconds: 60,
    outcome: "Success",
    update_status: "completed",
    failure_reason: null,
    finished_at: new Date(Date.parse(started) + 60_000).toISOString(),
  };
}

/** Ports per eero: the gateway has a WAN port and every wired device on it; leaves have idle ports; a Beacon has none. */
function seedConnections(e: EeroSeed, i: number, devices: RawDevice[]): RawConnections {
  if (e.model === "eero Beacon") return { ports: { layout: "none", interfaces: [] }, node_actions: [], wireless_devices: [] };
  const wired = devices.filter((d) => d.wireless === false && d.connected && d.source?.url === `/2.2/eeros/${e.id}`);
  // As eero sends it: network_type "UNKNOWN" on every port (WAN too), port_status DATA_CONNECTED or WAN,
  // and what is plugged in under connection_status.
  const port = (n: number, extra: Partial<RawPortInterface>): RawPortInterface => ({
    interface_number: n,
    name: `Port ${n}`,
    port_status: "NOT_CONNECTED",
    negotiated_speed: null,
    supported_speed: "P2500",
    network_type: "UNKNOWN",
    poe_status: null,
    ethernet_address: mac(950 + i * 4 + n),
    is_upstream: false,
    connection_status: null,
    actions: [{ type: "DISABLE_PORT", position: 0 }],
    ...extra,
  });
  const interfaces: RawPortInterface[] = [];
  if (e.gateway) {
    interfaces.push(port(1, { name: "WAN", port_status: "WAN", negotiated_speed: "P2500", is_upstream: true, connection_status: { type: "WAN_SOURCE", metadata: { advanced_attributes: { connection_type: "WIRED" } } }, actions: [] }));
  }
  wired.forEach((d, k) =>
    interfaces.push(
      port(interfaces.length + 1, {
        port_status: "DATA_CONNECTED",
        negotiated_speed: "P1000",
        connection_status: { type: "MULTIPLE_DEVICES", metadata: { multiple_devices: { connections: [{ type: "CLIENT_DEVICE", metadata: { display_name: d.display_name ?? undefined, device_type: d.device_type ?? undefined, url: d.url, advanced_attributes: { connection_type: "WIRED" } } }] } } },
        actions: [{ type: "DISABLE_PORT", position: 0 }, { type: k === 0 ? "RESTART_POWER" : "DISABLE_DATA", position: 1 }],
      }),
    ),
  );
  while (interfaces.length < 2) interfaces.push(port(interfaces.length + 1, {}));
  return { ports: { layout: { layout_type: "TWO_PORT_A", position_rank_order: interfaces.map((_, k) => k) }, interfaces }, node_actions: [{ type: "POWER_CYCLE_ALL_PORTS_AND_REBOOT" }], wireless_devices: [] };
}

/** One reservation and forward on the first wired device, one on the first laptop, and an IPv6 pinhole. buildNetwork keeps these two on static-range addresses. */
function seedRouting(netUrl: string, devices: RawDevice[]): RawRouting {
  const picks = [devices.find((d) => d.wireless === false), devices.find((d) => d.device_type === "laptop_computer")].filter((d): d is RawDevice => !!d);
  return {
    url: `${netUrl}/routing`,
    devices: { url: `${netUrl}/devices`, data: picks.map((d) => ({ url: d.url, mac: d.mac, nickname: d.nickname ?? null })) },
    reservations: { url: `${netUrl}/reservations`, data: picks.map((d, i) => ({ url: `${netUrl}/reservations/${300 + i}`, description: d.display_name ?? "", mac: d.mac, ip: d.ip ?? undefined, public_static_ip: null })) },
    forwards: {
      url: `${netUrl}/forwards`,
      data: picks.map((d, i) => ({ url: `${netUrl}/forwards/${400 + i}`, description: i === 0 ? "Media server" : "Web dev server", ip: d.ip ?? undefined, gateway_port: i === 0 ? "32400" : "8080", client_port: i === 0 ? "32400" : "8080", protocol: i === 0 ? "tcp" : "both", enabled: i === 0 })),
    },
    pinholes: { url: `${netUrl}/pinholes`, data: picks.slice(1).map((d, i) => ({ url: `${netUrl}/pinholes/${500 + i}`, device: { url: d.url, mac: d.mac }, ip: "2001:db8:100:1::22", protocol: "tcp", port: "443" })) },
  };
}
