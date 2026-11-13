/**
 * State of the fake eero server: one account, two networks, and the
 * sessions it has issued. Created fresh per test (`createState()`), mutated
 * by routes so writes stick. Every name, MAC, IP and serial is invented.
 *
 * To extend: add a field to `FakeNetwork` (or `FakeState.extra` for
 * something small) and seed it in `seedNetworks`. Raw shapes come from
 * src/core/eero/raw.ts, so model changes break the fixtures at compile time.
 */

import type { RawAccount, RawDevice, RawEero, RawEvent, RawNetwork, RawPermissions, RawProfile, RawSpeedTest } from "../../src/core/eero/raw";

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
    updates: { has_update: seed.id === "100001", update_required: false, can_update_now: true, target_firmware: "7.11.0", preferred_update_hour: 3 },
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
  };
}
