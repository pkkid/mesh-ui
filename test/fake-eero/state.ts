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
  RawConnections,
  RawDevice,
  RawEero,
  RawEvent,
  RawFirmwareHistoryEntry,
  RawNetwork,
  RawPermissions,
  RawPortInterface,
  RawProfile,
  RawRouting,
  RawSpeedTest,
  RawUpdates,
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
  /** `GET /2.2/eeros/{id}/firmware_update/history` per eero id, oldest first (as seeded; mappers sort). */
  firmwareHistory: Record<string, RawFirmwareHistoryEntry[]>;
  /** `GET {net}/routing`. */
  routing: RawRouting;
  /** `GET {net}/updates`; the network's embedded `updates` is the same object. */
  updates: RawUpdates;
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

type EeroSeed = { id: string; serial: string; location: string; model: string; gateway?: boolean; status?: string; bars?: number; wired?: boolean; clients: number };
type DeviceSeed = { n: number; name: string | null; host: string; type: string; eero: number; band: "2.4" | "5" | "6" | "wired"; online?: boolean; paused?: boolean; profile?: number };

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
        { id: "500003", serial: "FAKE00UH0003", location: "Upstairs Hall", model: "eero 7", bars: 4, clients: 1 },
        { id: "500004", serial: "FAKE00GA0004", location: "Garage", model: "eero Beacon", status: "yellow", bars: 1, clients: 0 },
      ],
      profiles: ["Alex", "Jamie", "Mia", "Leo"],
      devices: [
        { n: 1, name: "Alex's Phone", host: "alex-phone", type: "phone", eero: 0, band: "5", profile: 0 },
        { n: 2, name: "Alex's Laptop", host: "alex-laptop", type: "laptop_computer", eero: 1, band: "6", profile: 0 },
        { n: 3, name: "Jamie's Phone", host: "jamie-phone", type: "phone", eero: 0, band: "5", profile: 1 },
        { n: 4, name: "Mia's Tablet", host: "mia-tablet", type: "tablet", eero: 2, band: "5", profile: 2 },
        { n: 5, name: "Leo's Switch", host: "leo-switch", type: "game_console", eero: 0, band: "2.4", paused: true, profile: 3 },
        { n: 6, name: "Living Room TV", host: "living-tv", type: "television", eero: 0, band: "wired" },
        { n: 7, name: null, host: "esp-plug-07", type: "plug", eero: 1, band: "2.4" },
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
    wireless_upstream_node: e.wired ? null : { url: `/2.2/eeros/${seed.eeros[0]?.id}`, location: seed.eeros[0]?.location ?? "" },
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
    schedule: name === "Mia" ? [{ url: `${netUrl}/profiles/${700 + i}/schedules/1`, name: "Bedtime", days: ["MON", "TUE", "WED", "THU", "SUN"], start: "21:00", end: "07:00", enabled: true }] : [],
    resources: { schedules: `${netUrl}/profiles/${700 + i}/schedules` },
  }));

  const devices: RawDevice[] = seed.devices.map((d) => {
    const m = mac(d.n);
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
      ip: `192.168.4.${20 + (d.n % 200)}`,
      ips: [`192.168.4.${20 + (d.n % 200)}`],
      connected: d.online ?? true,
      wireless: !wired,
      connection_type: wired ? "wired" : "wireless",
      source: eero ? { location: eero.location, is_gateway: eero.gateway ?? false, url: `/2.2/eeros/${eero.id}`, model: eero.model, serial_number: eero.serial } : {},
      interface: wired ? {} : { frequency: d.band, frequency_unit: "GHz" },
      ssid: seed.name,
      subnet_kind: "main",
      is_guest: false,
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
    power_saving: false,
    guest_network: { url: `${netUrl}/guestnetwork`, name: `${seed.name} Guest`, enabled: false },
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
        [
          { os_version: "7.8.0", installed: "2026-07-01T03:00:00Z" },
          { os_version: "7.9.2", installed: "2026-09-01T03:00:00Z" },
          { os_version: e.os_version, installed: iso("05T03:00:00") },
        ],
      ]),
    ),
    routing: seedRouting(netUrl, maple ? devices : []),
    updates,
  };
}

/** Ports per eero: the gateway has a WAN port and every wired device on it; leaves have idle ports; a Beacon has none. */
function seedConnections(e: EeroSeed, i: number, devices: RawDevice[]): RawConnections {
  if (e.model === "eero Beacon") return { ports: { layout: "none", interfaces: [] }, node_actions: [], wireless_devices: [] };
  const wired = devices.filter((d) => d.wireless === false && d.connected && d.source?.url === `/2.2/eeros/${e.id}`);
  const port = (n: number, extra: Partial<RawPortInterface>): RawPortInterface => ({
    interface_number: n,
    name: `Port ${n}`,
    port_status: "DOWN",
    negotiated_speed: null,
    supported_speed: "P2500",
    network_type: "LAN",
    poe_status: null,
    ethernet_address: mac(950 + i * 4 + n),
    actions: [{ type: "DISABLE_PORT" }],
    ...extra,
  });
  const interfaces: RawPortInterface[] = [];
  if (e.gateway) interfaces.push(port(1, { name: "WAN", port_status: "UP", negotiated_speed: "P2500", network_type: "WAN", actions: [] }));
  wired.forEach((d, k) =>
    interfaces.push(port(interfaces.length + 1, { port_status: "UP", negotiated_speed: "P1000", neighbor: { type: "DEVICE", metadata: { url: d.url, mac: d.mac, display_name: d.display_name ?? undefined } }, actions: [{ type: "DISABLE_PORT" }, { type: k === 0 ? "RESTART_POWER" : "DISABLE_DATA" }] })),
  );
  while (interfaces.length < 2) interfaces.push(port(interfaces.length + 1, {}));
  return { ports: { layout: "horizontal", interfaces }, node_actions: [{ type: "POWER_CYCLE_ALL_PORTS_AND_REBOOT" }], wireless_devices: [] };
}

/** One reservation and forward on the first wired device, one on the first laptop, and an IPv6 pinhole. */
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
