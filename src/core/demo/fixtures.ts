/**
 * The demo fixtures: one invented account with three networks, matching the
 * approved mockups in docs/mockups/. Typed against model.ts, so a model
 * change that is not reflected here fails `pnpm typecheck`.
 *
 * Everything is invented. LAN addresses are 192.168.4.x, public addresses
 * use the documentation ranges (203.0.113.x, 198.51.100.x, 2001:db8::/32),
 * MACs use the locally administered prefix 02:4d:55 (private MACs 06:4d:55),
 * phone numbers use 555-01xx and the ASN is from the documentation range.
 *
 * Times are relative to `now` so "48 min ago" stays true whenever the demo
 * runs. Fields the backend derives from the lists (eero and device counts,
 * eero clients, profile devices and state, port attachments, the current
 * firmware, forwards per reservation, leased addresses, per-eero update
 * versions) are not stored here; see backend.ts.
 */

import type * as M from "../model";

// ---------------------------------------------------------------------------
// Shapes

/** How a device spreads its daily traffic over the hours of the day. */
export type UsagePattern = "evening" | "work" | "personal" | "kid" | "steady";

export type DeviceUsage = {
  /** Bytes on a typical day, both directions. */
  dailyBytes: number;
  /** Share of the bytes that are upload, 0 to 1. */
  upShare: number;
  pattern: UsagePattern;
};

/** A profile as stored: devices, online count, state and nextChange are derived. */
export type ProfileFixture = Pick<M.Profile, "id" | "name" | "paused" | "schedules">;

/** An eero as stored: client counts are derived from the device list. */
export type EeroFixture = Omit<M.Eero, "clients">;

/** A network as stored: counts, eero count, devices online and isp are derived. */
export type NetworkFixture = Omit<M.Network, "eeroCount" | "devicesOnline" | "isp" | "updateAvailable" | "selected" | "counts">;

/** An Ethernet port as stored: status, speed and attachment come from the devices and eeros. */
export type PortFixture = Pick<M.EeroPort, "number" | "name" | "supportedMbps" | "isWan" | "poe" | "mac" | "actions">;

/** The network's update state as stored: the current version and per-eero versions come from the eeros. */
export type UpdatesFixture = Omit<M.Updates, "current" | "eeros">;

/** The guest network as stored: online guests and device ids come from the devices with `ssid: "guest"`. */
export type GuestFixture = Pick<M.GuestNetwork, "enabled" | "name" | "security"> & { password: string | null };

/** Wi-Fi as stored: the SSID is the network name; bands and client counts come from the eeros and devices. */
export type WifiFixture = Pick<M.WifiSettings, "security" | "wpa2OnlyDevices" | "hide5g"> & { password: string };

/**
 * Settings as stored. DHCP comes from the LAN map, WAN and the ISP's DNS from
 * the internet fixture, and the connection mode and time zone from the network.
 */
export type SettingsFixture = Omit<M.NetworkSettings, "dhcp" | "wan" | "connectionMode" | "timezone" | "dns"> & {
  dns: Omit<M.NetworkSettings["dns"], "ispServers">;
};

export type NetworkData = {
  network: NetworkFixture;
  health: { internet: M.NetworkHealth["internet"]; mesh: M.NetworkHealth["mesh"]; messages: string[] };
  permissions: M.Permissions;
  internet: Omit<M.Internet, "planMbps" | "lastSpeedTest" | "verdict">;
  eeros: EeroFixture[];
  devices: M.Device[];
  profiles: ProfileFixture[];
  /** Newest first. */
  speedTests: M.SpeedTest[];
  /** Newest first. */
  events: M.NetworkEvent[];
  /** DHCP reservations; device.get reads its own. `forwards` is derived. */
  reservations: M.Reservation[];
  /** Port forwards, each on a reserved device. */
  forwards: M.Forward[];
  /** IPv6 firewall rules. */
  pinholes: M.Pinhole[];
  /** The LAN map; `pool.leased` is derived. Null in bridge mode. */
  lan: M.LanMap | null;
  /** Ethernet ports per eero id; an eero with no entry has none. */
  ports: Record<M.Id, PortFixture[]>;
  /** Installed versions per eero id, newest first, ending at its current firmware. */
  firmware: Record<M.Id, Omit<M.FirmwareEntry, "current">[]>;
  updates: UpdatesFixture;
  /** Typical traffic per device id. */
  usage: Record<M.Id, DeviceUsage>;
  guest: GuestFixture;
  wifi: WifiFixture;
  settings: SettingsFixture;
  /** Thread secrets; null when the network has no Thread. */
  threadCredentials: M.ThreadCredentials | null;
  /** The last cloud diagnostics run. */
  diagnostics: M.DiagnosticsResult;
  support: Omit<M.SupportInfo, "supportId">;
  admins: M.Admin[];
  /** Pending invites; empty for an admin, who cannot read them. */
  invites: M.Invite[];
  integrations: M.Integrations;
  /** Newest first. */
  notifications: M.Notification[];
  /** eero's notification switches, keys as eero sends them. */
  notificationSettings: Record<string, boolean>;
};

export type DemoFixtures = {
  account: M.Account;
  /** The login shown by auth.status, already masked. */
  login: string;
  networks: NetworkData[];
};

// ---------------------------------------------------------------------------
// Helpers

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const GB = 1e9;
const TZ = "America/Los_Angeles";

/** Seeded random in [0, 1); the same seed gives the same fixtures. */
/**
 * App settings a demo host starts with when it keeps settings in memory.
 * Settings are not backend state (the engine reads them from the host's
 * store), so they live here as data and the hosts seed `memorySettings` with
 * them. Maple Street has the mockup 02 plan (Fiber Gig, 1.2 Gbps both ways);
 * Lake Cabin and Mom's House have none, so the no-plan forms stay covered.
 */
export const DEMO_SETTINGS: Pick<M.AppSettings, "planMbps"> = {
  planMbps: { "4821907": { down: 1200, up: 1200 } },
};

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hex = (n: number) => n.toString(16).padStart(2, "0");
/** An invented MAC: locally administered prefix, then a block and a serial. */
const mac = (block: number, n: number, priv = false) => [priv ? "06" : "02", "4d", "55", hex(block), hex(n >> 8), hex(n & 0xff)].join(":");
const idOf = (m: string) => m.replace(/:/g, "");
/** fe80:: address built from a MAC the EUI-64 way. */
function linkLocal(m: string): string {
  const b = m.split(":").map((x) => Number.parseInt(x, 16));
  const w = (hi: number, lo: number) => ((hi << 8) | lo).toString(16);
  return `fe80::${w((b[0] ?? 0) ^ 2, b[1] ?? 0)}:${w(b[2] ?? 0, 0xff)}:${w(0xfe, b[3] ?? 0)}:${w(b[4] ?? 0, b[5] ?? 0)}`;
}

const SCHOOL_NIGHTS: M.Day[] = ["SUN", "MON", "TUE", "WED", "THU"];
const WEEKDAYS: M.Day[] = ["MON", "TUE", "WED", "THU", "FRI"];

const full: M.Permission = { read: true, create: true, update: true, delete: true };
const readOnly: M.Permission = { read: true, create: false, update: false, delete: false };
const readUpdate: M.Permission = { read: true, create: false, update: true, delete: false };

const OWNER: M.Permissions = {
  role: "owner",
  can: {
    network: full,
    eeros: full,
    devices: full,
    profiles: full,
    settings: full,
    updates: full,
    "network.admin_invites": full,
    "network.transfer": full,
  },
};

/** Admins see and pause everything but cannot restart, update or manage admins. */
const ADMIN: M.Permissions = {
  role: "admin",
  can: {
    network: readUpdate,
    eeros: readOnly,
    devices: { read: true, create: false, update: true, delete: false },
    profiles: full,
    settings: readUpdate,
    updates: readOnly,
    "network.admin_invites": readOnly,
    "network.transfer": { read: false, create: false, update: false, delete: false },
  },
};

const CAPABILITIES_FULL: Record<string, boolean> = {
  device_blacklist: true,
  device_management: true,
  device_usage: true,
  diagnostics: true,
  led_action: true,
  ipv6: true,
  ipv6_editable: true,
  sqm: true,
  band_steering: true,
  dns_caching: true,
  wpa3: true,
  thread_network: true,
  thread_keychain_sharing: true,
  power_saving: true,
  port_forward_range: true,
  pppoe: true,
  vlan: true,
  ownership_transfer: true,
  ip_passthrough: true,
  udp_speed_tests: true,
};

// ---------------------------------------------------------------------------
// Devices

type DeviceRow = {
  name: string;
  maker: string;
  model: string;
  type: M.DeviceType;
  cat: M.DeviceCategory;
  profile?: string;
  eero: string;
  band: M.Band;
  /** Signal bars 0 to 5 while connected. */
  bars?: number;
  ip: number | null;
  /** Typical live rates in Mbps. */
  rate?: [number, number];
  /** GB on a typical day and the upload share. */
  gb: number;
  up?: number;
  pattern: UsagePattern;
  hostname?: string;
  /** "offline" with minutes since last seen, or "blocked". */
  offlineMin?: number;
  blocked?: boolean;
  paused?: boolean;
  guest?: boolean;
  privateMac?: boolean;
  /** Minutes ago it was first seen; omitted means long ago. */
  newMin?: number;
  port?: [number, number];
};

type Radios = Partial<Record<M.Band, { channel: number; width: number }>>;

/** What a network's devices need to know about where they connect. */
type Lan = { block: number; subnet: string; v6: string | null; eeros: Record<string, M.Id>; eeroList: EeroFixture[]; profiles: Record<string, M.Id> };

function buildDevice(row: DeviceRow, n: number, now: number, lan: Lan): [M.Device, DeviceUsage] {
  const m = mac(lan.block, n, row.privateMac);
  const eeroId = row.blocked ? null : (lan.eeros[row.eero] ?? null);
  const connected = !row.blocked && row.offlineMin === undefined;
  const wireless = row.band !== "wired";
  const radio = lan.eeroList.find((e) => e.id === lan.eeros[row.eero])?.radios.find((r) => r.band === row.band);
  const bars = row.bars ?? 4;
  const dbm = [-90, -82, -74, -67, -60, -52][bars] ?? -60;
  const live = connected && wireless;
  const ipv4 = row.blocked || row.ip === null ? null : `${lan.subnet}.${row.ip}`;
  const device: M.Device = {
    id: idOf(m),
    name: row.name,
    nickname: row.name === row.hostname ? null : row.name,
    hostname: row.hostname ?? null,
    manufacturer: row.maker,
    model: row.model,
    type: row.type,
    category: row.cat,
    mac: m,
    privateMac: row.privateMac ?? false,
    ipv4,
    ipv6: ipv4 && lan.v6 && !row.privateMac ? [`${lan.v6}::${(row.ip ?? 0).toString(16)}`] : [],
    // EUI-64 style from the invented MAC (first byte with the local bit flipped).
    ipv6LinkLocal: ipv4 ? linkLocal(m) : null,
    connected,
    lastActive: new Date(now - (row.offlineMin ?? 0) * MIN).toISOString(),
    firstSeen: row.newMin !== undefined ? new Date(now - row.newMin * MIN).toISOString() : `2025-0${(n % 6) + 3}-0${(n % 8) + 1}T17:20:00Z`,
    ssid: row.guest ? "guest" : row.blocked ? null : "main",
    eeroId,
    band: connected ? row.band : null,
    channel: live ? (radio?.channel ?? null) : null,
    signal: live ? { dbm, bars } : null,
    link: live
      ? {
          rxMbps: row.band === "6" ? 2401 : row.band === "5" ? 1201 : 144,
          txMbps: row.band === "6" ? 2161 : row.band === "5" ? 1081 : 130,
          widthMhz: radio?.widthMhz ?? null,
          standard: row.band === "6" ? "Wi-Fi 6E" : row.band === "5" ? "Wi-Fi 6" : "Wi-Fi 4",
          snr: 20 + bars * 4,
          retryPct: bars >= 4 ? 0.2 : 1.8,
        }
      : null,
    wiredPort: connected && row.port && eeroId ? { eeroId, port: row.port[0], speedMbps: row.port[1] } : null,
    security: wireless ? (row.band === "6" ? "WPA3 Personal (SAE)" : "WPA2/WPA3 Personal") : null,
    paused: row.paused ?? false,
    blocked: row.blocked ?? false,
    profileId: row.profile ? (lan.profiles[row.profile] ?? null) : null,
    rates: null,
    reservation: null,
  };
  return [device, { dailyBytes: row.gb * GB, upShare: row.up ?? defaultUpShare[row.pattern], pattern: row.pattern }];
}

const defaultUpShare: Record<UsagePattern, number> = { evening: 0.02, work: 0.2, personal: 0.12, kid: 0.06, steady: 0.3 };

// Maple Street, 38 devices: 31 online (12 Living Room, 9 Office, 7 Upstairs
// Hall, 3 Garage), 5 offline, 2 blocked. Online by band: 11 on 2.4 GHz, 10
// on 5 GHz, 6 on 6 GHz, 4 wired. 3 paused (Leo's), 2 guests (1 online), 3 new this week.
const MAPLE_DEVICES: DeviceRow[] = [
  // Computers and personal
  { name: "Alex's MacBook Pro", maker: "Apple", model: "MacBook Pro 14 (M4 Pro)", type: "laptop", cat: "computers", profile: "alex", eero: "of", band: "6", bars: 5, ip: 23, rate: [38.4, 6.1], gb: 86, up: 0.26, pattern: "work", hostname: "Alexs-MacBook-Pro" },
  { name: "Alex's iPhone", maker: "Apple", model: "iPhone 17 Pro", type: "phone", cat: "phones_tablets", profile: "alex", eero: "of", band: "6", bars: 5, ip: 131, rate: [2.1, 0.4], gb: 7.4, pattern: "personal" },
  { name: "Alex's iPad Pro", maker: "Apple", model: "iPad Pro 13", type: "tablet", cat: "phones_tablets", profile: "alex", eero: "of", band: "6", bars: 5, ip: 144, rate: [0.3, 0.1], gb: 1.9, pattern: "personal" },
  { name: "Alex's Apple Watch", maker: "Apple", model: "Watch Ultra 3", type: "watch", cat: "phones_tablets", profile: "alex", eero: "of", band: "5", bars: 4, ip: 152, rate: [0, 0], gb: 0.2, pattern: "personal" },
  { name: "Office iMac", maker: "Apple", model: "iMac 24", type: "desktop", cat: "computers", profile: "alex", eero: "of", band: "wired", ip: 20, rate: [4.6, 1.2], gb: 14, pattern: "work", port: [1, 2500] },
  { name: "Synology NAS", maker: "Synology", model: "DS923+", type: "nas", cat: "computers", profile: "alex", eero: "lr", band: "wired", ip: 10, rate: [11.8, 22.3], gb: 56, up: 0.48, pattern: "steady", port: [2, 10000] },
  { name: "Jamie's iPhone", maker: "Apple", model: "iPhone 16", type: "phone", cat: "phones_tablets", profile: "jamie", eero: "lr", band: "6", bars: 5, ip: 133, rate: [6.2, 0.8], gb: 19, pattern: "personal" },
  { name: "Jamie's ThinkPad", maker: "Lenovo", model: "ThinkPad X1", type: "laptop", cat: "computers", profile: "jamie", eero: "of", band: "5", bars: 4, ip: 127, rate: [12.4, 3.9], gb: 31, pattern: "work" },
  { name: "Jamie's iPad", maker: "Apple", model: "iPad Air", type: "tablet", cat: "phones_tablets", profile: "jamie", eero: "of", band: "6", bars: 5, ip: 146, rate: [0.9, 0.1], gb: 4.6, pattern: "evening" },
  { name: "Mia's iPad", maker: "Apple", model: "iPad 11", type: "tablet", cat: "phones_tablets", profile: "mia", eero: "up", band: "5", bars: 5, ip: 161, rate: [5.4, 0.3], gb: 9.8, pattern: "kid" },
  { name: "Mia's Chromebook", maker: "Acer", model: "Chromebook Spin", type: "laptop", cat: "computers", profile: "mia", eero: "up", band: "5", bars: 4, ip: 162, rate: [1.2, 0.2], gb: 5.1, pattern: "kid" },
  { name: "Mia's Kindle", maker: "Amazon", model: "Kindle Paperwhite", type: "ereader", cat: "phones_tablets", profile: "mia", eero: "up", band: "2.4", bars: 4, ip: 163, rate: [0, 0], gb: 0.1, pattern: "kid" },
  { name: "Leo's Fire HD", maker: "Amazon", model: "Fire HD 10", type: "tablet", cat: "phones_tablets", profile: "leo", eero: "up", band: "5", bars: 4, ip: 171, gb: 1.4, pattern: "kid", paused: true },
  { name: "Grandma's iPad", maker: "Apple", model: "iPad mini", type: "tablet", cat: "phones_tablets", eero: "lr", band: "5", bars: 5, ip: 188, rate: [3.3, 0.2], gb: 2.7, pattern: "personal", newMin: 2 * 24 * 60 + 300, guest: true },
  { name: "HP LaserJet", maker: "HP", model: "LaserJet Pro M404", type: "printer", cat: "computers", eero: "of", band: "2.4", bars: 3, ip: 15, rate: [0, 0], gb: 0.02, pattern: "work" },
  // Entertainment
  { name: "Living Room TV", maker: "Samsung", model: "QN90D", type: "tv", cat: "entertainment", eero: "lr", band: "wired", ip: 12, rate: [58.2, 0.6], gb: 142, up: 0.008, pattern: "evening", port: [3, 1000] },
  { name: "PlayStation 5", maker: "Sony", model: "PS5 Slim", type: "game_console", cat: "entertainment", eero: "lr", band: "5", bars: 5, ip: 14, rate: [0.4, 0.1], gb: 48, up: 0.06, pattern: "evening" },
  { name: "Apple TV Den", maker: "Apple", model: "Apple TV 4K", type: "media_streamer", cat: "entertainment", eero: "lr", band: "6", bars: 5, ip: 116, rate: [24.6, 0.3], gb: 26, pattern: "evening" },
  { name: "Sonos Kitchen", maker: "Sonos", model: "Era 100", type: "speaker", cat: "entertainment", eero: "lr", band: "5", bars: 4, ip: 117, rate: [0.3, 0], gb: 0.8, pattern: "evening" },
  { name: "Sonos Living Room", maker: "Sonos", model: "Arc", type: "speaker", cat: "entertainment", eero: "lr", band: "5", bars: 5, ip: 118, rate: [0.2, 0], gb: 0.6, pattern: "evening" },
  { name: "Leo's Switch", maker: "Nintendo", model: "Switch 2", type: "game_console", cat: "entertainment", profile: "leo", eero: "lr", band: "5", bars: 4, ip: 172, gb: 2.8, pattern: "kid", paused: true },
  // Smart home
  { name: "Nest Thermostat", maker: "Google", model: "Nest Thermostat", type: "thermostat", cat: "smart_home", eero: "lr", band: "2.4", bars: 4, ip: 181, rate: [0, 0], gb: 0.05, pattern: "steady", newMin: 48 },
  { name: "Hue Bridge", maker: "Signify", model: "Hue Bridge", type: "smart_hub", cat: "smart_home", eero: "lr", band: "wired", ip: 30, rate: [0, 0], gb: 0.1, pattern: "steady", port: [4, 100] },
  { name: "Kitchen Echo", maker: "Amazon", model: "Echo (4th Gen)", type: "speaker", cat: "smart_home", eero: "lr", band: "2.4", bars: 4, ip: 183, rate: [0.1, 0], gb: 0.4, pattern: "personal" },
  { name: "Desk Lamp", maker: "Signify", model: "Hue Go", type: "light", cat: "smart_home", eero: "of", band: "2.4", bars: 4, ip: 190, rate: [0, 0], gb: 0.01, pattern: "steady" },
  { name: "Hallway Smoke Alarm", maker: "Google", model: "Nest Protect", type: "smoke_alarm", cat: "smart_home", eero: "up", band: "2.4", bars: 4, ip: 191, rate: [0, 0], gb: 0.01, pattern: "steady" },
  { name: "Bedroom Air Purifier", maker: "Levoit", model: "Core 400S", type: "air_purifier", cat: "smart_home", eero: "up", band: "2.4", bars: 3, ip: 192, rate: [0, 0], gb: 0.02, pattern: "steady" },
  { name: "Hallway Motion Sensor", maker: "Aqara", model: "Motion Sensor P2", type: "sensor", cat: "smart_home", eero: "up", band: "2.4", bars: 3, ip: 193, rate: [0, 0], gb: 0.01, pattern: "steady" },
  { name: "Ring Doorbell", maker: "Ring", model: "Video Doorbell Pro 2", type: "doorbell", cat: "smart_home", eero: "ga", band: "2.4", bars: 2, ip: 95, rate: [0.2, 1.1], gb: 3.2, up: 0.8, pattern: "steady" },
  { name: "Garage Door Opener", maker: "Chamberlain", model: "myQ Smart Garage", type: "garage", cat: "smart_home", eero: "ga", band: "2.4", bars: 2, ip: 196, rate: [0, 0], gb: 0.01, pattern: "steady" },
  // Fails writes on purpose (see docs/architecture/backends.md).
  { name: "Flaky Plug", maker: "Kasa", model: "Smart Plug Mini", type: "plug", cat: "smart_home", eero: "ga", band: "2.4", bars: 1, ip: 197, rate: [0, 0], gb: 0.01, pattern: "steady" },
  // Recently online
  { name: "Mia's iPhone", maker: "Apple", model: "iPhone 15", type: "phone", cat: "phones_tablets", profile: "mia", eero: "up", band: "5", ip: 164, gb: 2.3, pattern: "kid", offlineMin: 120 },
  { name: "Jamie's Apple Watch", maker: "Apple", model: "Watch Series 11", type: "watch", cat: "phones_tablets", profile: "jamie", eero: "lr", band: "5", ip: 147, gb: 0.1, pattern: "personal", offlineMin: 40 },
  { name: "Leo's Chromebook", maker: "Lenovo", model: "Chromebook Duet", type: "laptop", cat: "computers", profile: "leo", eero: "up", band: "5", ip: 173, gb: 0, pattern: "kid", offlineMin: 300, paused: true },
  { name: "Jamie's Peloton", maker: "Peloton", model: "Bike+", type: "fitness", cat: "other", profile: "jamie", eero: "lr", band: "5", ip: 149, gb: 0.5, pattern: "personal", offlineMin: 26 * 60 },
  { name: "Sam's Pixel", maker: "Google", model: "Pixel 9", type: "phone", cat: "phones_tablets", eero: "lr", band: "5", ip: 201, gb: 0.6, pattern: "personal", offlineMin: 3 * 24 * 60, guest: true, privateMac: true },
  // Blocked
  { name: "android-7f3a", maker: "Unknown manufacturer", model: "Unknown", type: "generic", cat: "other", eero: "ga", band: "2.4", ip: null, gb: 0, pattern: "steady", blocked: true, offlineMin: 14 * 24 * 60, privateMac: true, hostname: "android-7f3a" },
  { name: "ESP_3A9F21", maker: "Espressif", model: "ESP32", type: "generic", cat: "other", eero: "ga", band: "2.4", ip: null, gb: 0, pattern: "steady", blocked: true, offlineMin: 3 * 24 * 60, newMin: 3 * 24 * 60 + 40, hostname: "ESP_3A9F21" },
];

const LAKE_DEVICES: DeviceRow[] = [
  { name: "Cabin Thermostat", maker: "ecobee", model: "Smart Thermostat Premium", type: "thermostat", cat: "smart_home", eero: "lc", band: "2.4", ip: 40, gb: 0.05, pattern: "steady", offlineMin: 2 * 24 * 60 },
  { name: "Cabin Camera", maker: "Wyze", model: "Cam v4", type: "camera", cat: "smart_home", eero: "lc", band: "2.4", ip: 41, gb: 2, up: 0.85, pattern: "steady", offlineMin: 2 * 24 * 60 },
  { name: "Cabin Fire TV", maker: "Amazon", model: "Fire TV Stick 4K", type: "media_streamer", cat: "entertainment", eero: "lc", band: "5", ip: 42, gb: 0.4, pattern: "evening", offlineMin: 9 * 24 * 60 },
];

const MOM_DEVICES: DeviceRow[] = [
  { name: "Rose's iPhone", maker: "Apple", model: "iPhone 14", type: "phone", cat: "phones_tablets", eero: "ki", band: "5", bars: 4, ip: 21, rate: [1.4, 0.2], gb: 3.1, pattern: "personal" },
  { name: "Rose's iPad", maker: "Apple", model: "iPad 10", type: "tablet", cat: "phones_tablets", eero: "ki", band: "5", bars: 4, ip: 22, rate: [3.8, 0.2], gb: 6.4, pattern: "evening" },
  { name: "Kitchen Radio", maker: "Amazon", model: "Echo Dot (5th Gen)", type: "speaker", cat: "smart_home", eero: "ki", band: "2.4", bars: 4, ip: 23, rate: [0.1, 0], gb: 0.3, pattern: "personal" },
  { name: "Den TV", maker: "TCL", model: "Q6 Roku TV", type: "tv", cat: "entertainment", eero: "de", band: "5", bars: 3, ip: 24, rate: [14.2, 0.3], gb: 24, up: 0.01, pattern: "evening" },
  { name: "Den Printer", maker: "Brother", model: "HL-L2350DW", type: "printer", cat: "computers", eero: "de", band: "2.4", bars: 3, ip: 25, rate: [0, 0], gb: 0.01, pattern: "work" },
  { name: "Rose's Laptop", maker: "Dell", model: "Inspiron 14", type: "laptop", cat: "computers", eero: "de", band: "5", bars: 3, ip: 26, rate: [2.2, 0.6], gb: 4.2, pattern: "work" },
  { name: "Front Porch Camera", maker: "Arlo", model: "Essential", type: "camera", cat: "smart_home", eero: "de", band: "2.4", bars: 2, ip: 27, rate: [0.1, 0.9], gb: 2.4, up: 0.85, pattern: "steady" },
  { name: "Kitchen Plug", maker: "Kasa", model: "Smart Plug Mini", type: "plug", cat: "smart_home", eero: "ki", band: "2.4", bars: 4, ip: 28, rate: [0, 0], gb: 0.01, pattern: "steady" },
  { name: "Living Room Speaker", maker: "Sonos", model: "One SL", type: "speaker", cat: "entertainment", eero: "ki", band: "wired", ip: 29, rate: [0.2, 0], gb: 0.7, pattern: "evening", port: [2, 1000] },
  { name: "Visitor Phone", maker: "Samsung", model: "Galaxy S24", type: "phone", cat: "phones_tablets", eero: "ki", band: "5", ip: 40, gb: 0.9, pattern: "personal", offlineMin: 5 * 24 * 60, privateMac: true },
  { name: "Old Kindle", maker: "Amazon", model: "Kindle", type: "ereader", cat: "phones_tablets", eero: "de", band: "2.4", ip: 41, gb: 0.02, pattern: "evening", offlineMin: 4 * 24 * 60 },
];

// ---------------------------------------------------------------------------
// eeros

type EeroRow = {
  key: string;
  id: M.Id;
  location: string;
  model: string;
  modelNumber: string;
  serial: string;
  gateway?: boolean;
  upstream?: string;
  meshBars?: number;
  bands: M.Band[];
  radios: Radios;
  ip: string;
  v6?: string;
  firmware: string;
  updateAvailable: boolean;
  status?: M.Status;
  uptimeMin: number;
  joined: M.Iso;
  ledBrightness?: number;
  nightlight?: M.Nightlight;
  endOfLife?: M.Eero["endOfLife"];
  heartbeatMin?: number;
  /** Bands with a channel set by hand (auto channel off). */
  manual?: M.WirelessBand[];
  subnet: string;
  gatewayIp: string;
};

const TX_POWER: Record<M.WirelessBand, number> = { "2.4": 20, "5": 23, "6": 24 };

function buildEero(row: EeroRow, block: number, n: number, now: number, ids: Record<string, string>): EeroFixture {
  const m = mac(block, n);
  const base = m.slice(0, -2);
  const wireless = (row.bands.filter((b) => b !== "wired") as M.WirelessBand[]);
  return {
    id: row.id,
    serial: row.serial,
    location: row.location,
    model: row.model,
    modelNumber: row.modelNumber,
    isGateway: row.gateway ?? false,
    status: row.status ?? "online",
    firmware: row.firmware,
    updateAvailable: row.updateAvailable,
    endOfLife: row.endOfLife ?? null,
    backhaul: row.gateway ? "wired" : "wireless",
    meshBars: row.gateway ? null : (row.meshBars ?? null),
    upstream: row.upstream ? (ids[row.upstream] ?? null) : null,
    hop: null,
    meshQuality: null,
    bands: row.bands,
    radios: wireless.map((band) => ({
      band,
      channel: row.status === "offline" ? null : (row.radios[band]?.channel ?? null),
      widthMhz: row.status === "offline" ? null : (row.radios[band]?.width ?? null),
      utilization: row.status === "offline" ? null : band === "2.4" ? 34 : band === "5" ? 21 : 9,
      clients: null,
      txPowerDbm: row.status === "offline" ? null : TX_POWER[band],
      autoChannel: !(row.manual ?? []).includes(band),
    })),
    led: { on: row.status !== "offline" ? true : null, brightness: row.ledBrightness ?? 100 },
    nightlight: row.nightlight ?? null,
    ipv4: row.ip,
    ipv6: row.v6 ? [row.v6] : [],
    subnet: row.subnet,
    gatewayIp: row.gatewayIp,
    mac: m,
    // Offsets stay inside this eero's 16-address block, so no BSSID equals another eero's MAC.
    bssids: wireless.map((band, i) => ({ band, mac: `${base}${hex((n & 0xff) + [8, 12, 14][i]!)}` })),
    joined: row.joined,
    uptimeSec: row.status === "offline" ? null : row.uptimeMin * 60,
    lastHeartbeat: new Date(now - (row.heartbeatMin ?? 0) * MIN).toISOString(),
    powerSource: row.model === "eero Beacon" ? "outlet" : "adapter",
    messages: [],
  };
}

// ---------------------------------------------------------------------------
// Events

type EventSeed = { min: number; category: M.EventCategory; type: string; title: string; detail?: string; refs?: M.NetworkEvent["refs"] };

const EVENT_TEMPLATES: Record<Exclude<M.EventCategory, "other">, { type: string; title: (d: string, e: string) => string; detail: (d: string, e: string) => string }[]> = {
  devices: [
    { type: "device_connected", title: (d) => `${d} connected`, detail: (_d, e) => `${e} · main network` },
    { type: "device_disconnected", title: (d) => `${d} disconnected`, detail: (_d, e) => `Last seen on ${e}` },
  ],
  pause_block: [{ type: "device_paused", title: (d) => `${d} paused`, detail: () => "Paused from Mesh UI" }],
  schedules: [{ type: "profile_schedule_started", title: () => "Schedule started: Homework for Mia", detail: () => "Mia · 4 devices paused until 6:00 PM" }],
  eero_status: [{ type: "eero_channel_changed", title: (_d, e) => `${e} changed channel`, detail: (_d, e) => `${e} · 2.4 GHz channel changed 1 to 6` }],
  speed_tests: [{ type: "speedtest_completed", title: () => "Speed test finished", detail: () => "Ziply Fiber · automatic test" }],
  firmware: [{ type: "firmware_checked", title: () => "Checked for eeroOS updates", detail: () => "eeroOS 7.13.0 available" }],
  admin: [{ type: "admin_setting_changed", title: () => "Jamie Kim changed a setting", detail: () => "Band steering left on" }],
  ports_temperature: [{ type: "ethernet_port_up", title: (_d, e) => `Ethernet port on ${e} came up`, detail: (_d, e) => `${e} · 1 Gbps` }],
};

/** Filler events so every category has a realistic count over 7 days. */
function fillerEvents(rng: () => number, counts: Record<Exclude<M.EventCategory, "other">, number>, devices: M.Device[], eeros: EeroFixture[], startMin: number): EventSeed[] {
  const out: EventSeed[] = [];
  const pick = <T>(list: T[]): T => list[Math.floor(rng() * list.length)] as T;
  for (const [category, count] of Object.entries(counts) as [Exclude<M.EventCategory, "other">, number][]) {
    for (let i = 0; i < count; i++) {
      const tpl = pick(EVENT_TEMPLATES[category]);
      const device = pick(devices.filter((d) => !d.blocked));
      const eero = pick(eeros);
      out.push({
        min: startMin + Math.floor(rng() * (7 * 24 * 60 - startMin)),
        category,
        type: tpl.type,
        title: tpl.title(device.name, eero.location),
        detail: tpl.detail(device.name, eero.location),
        refs: category === "devices" || category === "pause_block" ? { deviceId: device.id } : { eeroId: eero.id },
      });
    }
  }
  return out;
}

function toEvents(seeds: EventSeed[], now: number, prefix: string): M.NetworkEvent[] {
  return seeds
    .map((s) => ({ ...s, at: now - s.min * MIN }))
    .sort((a, b) => b.at - a.at)
    .map((s, i) => ({
      id: `${prefix}-${String(i + 1).padStart(4, "0")}`,
      at: new Date(s.at).toISOString(),
      category: s.category,
      type: s.type,
      title: s.title,
      detail: s.detail ?? null,
      refs: s.refs ?? {},
    }));
}

// ---------------------------------------------------------------------------
// Speed tests

function speedTests(now: number, rows: [hoursAgo: number, down: number | null, up: number | null][]): M.SpeedTest[] {
  return rows
    .map(([h, downMbps, upMbps]) => ({ at: new Date(now - h * HOUR).toISOString(), downMbps, upMbps, rating: null }))
    .sort((a, b) => b.at.localeCompare(a.at));
}

// ---------------------------------------------------------------------------
// Ports, firmware, routing

type PortSpec = [number: number, supportedMbps: number, opts?: { wan?: boolean; poe?: boolean }];

/** Port specs for one eero. Port MACs follow the eero's own invented MAC. */
function portsOf(eero: EeroFixture, specs: PortSpec[]): PortFixture[] {
  const base = eero.mac ? eero.mac.slice(0, -2) : null;
  const last = eero.mac ? Number.parseInt(eero.mac.slice(-2), 16) : 0;
  return specs.map(([number, supportedMbps, o]) => ({
    number,
    name: o?.wan ? "WAN" : null,
    supportedMbps,
    isWan: o?.wan ?? false,
    poe: o?.poe ? "on" : null,
    mac: base ? `${base}${hex((last + 0x40 + number) & 0xff)}` : null,
    actions: o?.wan ? [] : o?.poe ? ["DISABLE_PORT", "DISABLE_POE", "RESTART_POWER"] : ["DISABLE_PORT"],
  }));
}

/** Installed versions newest first, from [version, days ago]; drops any before the eero joined. */
function firmwareOf(eero: EeroFixture, now: number, steps: [string, number][]): Omit<M.FirmwareEntry, "current">[] {
  const joined = eero.joined ? Date.parse(eero.joined) : Number.NEGATIVE_INFINITY;
  return steps.map(([version, days]) => ({ version, at: now - days * DAY })).filter((s) => s.at >= joined).map((s) => ({ version: s.version, installedAt: new Date(s.at).toISOString() }));
}

/** The next 02:00 in Los Angeles standard time (10:00 UTC), for a scheduled update. */
const nextUpdateWindow = (now: number) => Math.ceil((now - 10 * HOUR) / DAY) * DAY + 10 * HOUR;

// ---------------------------------------------------------------------------
// Wave 2 reads: guest, Wi-Fi, settings, support, admins, integrations, notifications

const ALL_DAYS: M.Day[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

/** eero's notification switches, minus the eero Plus ones (out of scope). Keys as eero sends them. */
const NOTIFICATION_KEYS = [
  "device.new",
  "device.restrict.new.private",
  "network.updated",
  "network.dataUsageReport",
  "permissions.updates",
  "port.security.blocked",
  "network.scheduledUpdate.earlyNotification",
  "network.scheduledUpdate.lateNotification",
] as const;

const notificationSwitches = (off: string[] = []): Record<string, boolean> => Object.fromEntries(NOTIFICATION_KEYS.map((k) => [k, !off.includes(k)]));

const EERO_SUPPORT: Omit<M.SupportInfo, "supportId">["eero"] = {
  name: "eero",
  phone: "+18775550123",
  email: "support@example.com",
  helpUrl: "https://support.example.com/eero",
  contactUrl: "https://support.example.com/eero/contact",
  emailFormUrl: "https://support.example.com/eero/email",
};

const integration = (available: boolean, enabled: boolean | null, detail: string | null = null): M.Integration => ({ available, enabled: available ? enabled : null, detail });

type NotificationSeed = { min: number; title: string; body: string; read: boolean; category: string; deviceId?: M.Id };

function toNotifications(seeds: NotificationSeed[], now: number, prefix: string): M.Notification[] {
  return seeds
    .slice()
    .sort((a, b) => a.min - b.min)
    .map((n, i) => ({
      id: `${prefix}-n${String(i + 1).padStart(3, "0")}`,
      at: new Date(now - n.min * MIN).toISOString(),
      title: n.title,
      body: n.body,
      read: n.read,
      category: n.category,
      refs: n.deviceId ? { deviceId: n.deviceId } : {},
    }));
}

// ---------------------------------------------------------------------------
// The fixture set

const roundToMinute = (ms: number) => Math.floor(ms / MIN) * MIN;

/** Builds a fresh copy of every fixture. `now` is epoch ms; `seed` fixes filler. */
export function createFixtures(nowMs: number, seed = 42): DemoFixtures {
  const now = roundToMinute(nowMs);
  const rng = mulberry32(seed);
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString();

  // --- Maple Street ------------------------------------------------------
  const mapleIds = { lr: "80011", of: "80012", up: "80013", ga: "80014" };
  const mapleEeros = [
    buildEero({ key: "lr", id: mapleIds.lr, location: "Living Room", model: "eero Max 7", modelNumber: "S040001", serial: "MU0DEMO0000011", gateway: true, bands: ["2.4", "5", "6", "wired"], radios: { "2.4": { channel: 6, width: 20 }, "5": { channel: 149, width: 80 }, "6": { channel: 37, width: 160 } }, ip: "192.168.4.1", v6: "2001:db8:4a1c:7e00::1", firmware: "7.12.1", updateAvailable: true, uptimeMin: 23 * 24 * 60 + 4 * 60, joined: "2025-03-03T17:05:00Z", subnet: "192.168.4.0/22", gatewayIp: "192.168.4.1" }, 0xe0, 0x1000, now, mapleIds),
    buildEero({ key: "of", id: mapleIds.of, location: "Office", model: "eero Pro 7", modelNumber: "S030001", serial: "MU0DEMO0000012", upstream: "lr", meshBars: 5, bands: ["2.4", "5", "6", "wired"], radios: { "2.4": { channel: 1, width: 20 }, "5": { channel: 36, width: 80 }, "6": { channel: 69, width: 160 } }, ip: "192.168.4.22", v6: "2001:db8:4a1c:7e00::22", firmware: "7.12.1", updateAvailable: true, uptimeMin: 33 * 60, joined: "2025-03-03T17:12:00Z", ledBrightness: 60, manual: ["5"], subnet: "192.168.4.0/22", gatewayIp: "192.168.4.1" }, 0xe0, 0x1010, now, mapleIds),
    buildEero({ key: "up", id: mapleIds.up, location: "Upstairs Hall", model: "eero 7", modelNumber: "S020001", serial: "MU0DEMO0000013", upstream: "lr", meshBars: 4, bands: ["2.4", "5", "wired"], radios: { "2.4": { channel: 11, width: 20 }, "5": { channel: 44, width: 80 } }, ip: "192.168.4.24", v6: "2001:db8:4a1c:7e00::24", firmware: "7.12.1", updateAvailable: true, uptimeMin: 23 * 24 * 60 + 3 * 60, joined: "2025-03-03T17:18:00Z", subnet: "192.168.4.0/22", gatewayIp: "192.168.4.1" }, 0xe0, 0x1020, now, mapleIds),
    buildEero({ key: "ga", id: mapleIds.ga, location: "Garage", model: "eero Beacon", modelNumber: "B010001", serial: "MU0DEMO0000014", upstream: "of", meshBars: 2, bands: ["2.4", "5"], radios: { "2.4": { channel: 1, width: 20 }, "5": { channel: 36, width: 80 } }, ip: "192.168.4.26", v6: "2001:db8:4a1c:7e00::26", firmware: "7.12.1", updateAvailable: true, uptimeMin: 2 * 24 * 60 + 12 * 60, joined: "2025-06-14T19:40:00Z", nightlight: { mode: "ambient", brightness: 40, on: null, off: null }, subnet: "192.168.4.0/22", gatewayIp: "192.168.4.1" }, 0xe0, 0x1030, now, mapleIds),
  ];
  const mapleProfileIds = { alex: "9101", jamie: "9102", mia: "9103", leo: "9104" };
  const mapleBuilt = MAPLE_DEVICES.map((row, i) => buildDevice(row, i + 1, now, { block: 0x10, subnet: "192.168.4", v6: "2001:db8:4a1c:7e00", eeros: mapleIds, eeroList: mapleEeros, profiles: mapleProfileIds }));
  const mapleDevices = mapleBuilt.map(([d]) => d);
  const deviceId = (name: string) => mapleDevices.find((d) => d.name === name)?.id;

  const mapleEvents: EventSeed[] = [
    { min: 25, category: "pause_block", type: "profile_paused", title: "Profile Leo paused by Alex Kim", detail: "Leo · 3 devices paused: Leo's Switch, Leo's Fire HD, Leo's Chromebook · until resumed", refs: { profileId: mapleProfileIds.leo, adminId: "7001" } },
    { min: 48, category: "devices", type: "device_new", title: "New device joined: Nest Thermostat", detail: "Living Room · 2.4 GHz · 192.168.4.181 · Unassigned", refs: { deviceId: deviceId("Nest Thermostat"), eeroId: mapleIds.lr } },
    { min: 120, category: "speed_tests", type: "speedtest_completed", title: "Speed test: 942 down / 918 up Mbps", detail: "Ziply Fiber · run from Mesh UI" },
    { min: 180, category: "firmware", type: "firmware_update_scheduled", title: "eeroOS 7.13.0 scheduled for tonight", detail: "Installs tonight, 2 AM to 5 AM · network restarts" },
    { min: 220, category: "eero_status", type: "eero_mesh_quality_changed", title: "Garage mesh link dropped to 2 bars", detail: "Garage · upstream Office · 5 GHz backhaul", refs: { eeroId: mapleIds.ga } },
    { min: 460, category: "schedules", type: "profile_schedule_ended", title: "Schedule ended: Bedtime for Mia", detail: "Mia · 4 devices resumed · next start today 9:00 PM", refs: { profileId: mapleProfileIds.mia } },
    { min: 490, category: "admin", type: "admin_invite_sent", title: "Alex Kim invited sam@example.com as admin", detail: "Invite pending · expires in 2 days", refs: { adminId: "7001" } },
    { min: 18 * 60, category: "schedules", type: "profile_schedule_started", title: "Schedule started: Bedtime for Mia", detail: "Mia · 4 devices paused until 7:00 AM", refs: { profileId: mapleProfileIds.mia } },
    { min: 36 * 60, category: "firmware", type: "firmware_update_installed", title: "eeroOS 7.12.1 installed on all 4 eeros", detail: "Scheduled update window 2 AM to 5 AM · network restarted" },
    { min: 36 * 60 - 3, category: "ports_temperature", type: "ethernet_port_up", title: "Ethernet port 1 on Living Room online at 10 Gbps", detail: "Living Room · WAN · after restart", refs: { eeroId: mapleIds.lr } },
    { min: 2 * 24 * 60 + 300, category: "devices", type: "device_new", title: "New device joined: Grandma's iPad", detail: "Living Room · 5 GHz · Unassigned", refs: { deviceId: deviceId("Grandma's iPad"), eeroId: mapleIds.lr } },
    { min: 2 * 24 * 60 + 12 * 60, category: "eero_status", type: "eero_online", title: "Garage is back online", detail: "Garage · offline for 4 min · 3 devices reconnected", refs: { eeroId: mapleIds.ga } },
    { min: 2 * 24 * 60 + 12 * 60 + 4, category: "eero_status", type: "eero_offline", title: "Garage went offline", detail: "Garage · eero Beacon", refs: { eeroId: mapleIds.ga } },
    { min: 3 * 24 * 60, category: "pause_block", type: "device_blocked", title: "Device blocked: ESP_3A9F21", detail: "Was on Garage 2.4 GHz · blocked from all networks", refs: { deviceId: deviceId("ESP_3A9F21") } },
    { min: 3 * 24 * 60 + 40, category: "devices", type: "device_new", title: "New device joined: ESP_3A9F21", detail: "Garage · 2.4 GHz · Unassigned", refs: { deviceId: deviceId("ESP_3A9F21"), eeroId: mapleIds.ga } },
    { min: 4 * 24 * 60, category: "admin", type: "guest_password_changed", title: "Jamie Kim changed the guest network password", detail: "Maple Street Guest · 2 guest devices disconnected", refs: { adminId: "7002" } },
    { min: 4 * 24 * 60 + 500, category: "ports_temperature", type: "eero_temperature_high", title: "Office temperature high, back to normal after 22 min", detail: "Office · no throttling", refs: { eeroId: mapleIds.of } },
    { min: 5 * 24 * 60, category: "other", type: "network_report_ready", title: "Weekly network report is ready", detail: "Maple Street · last 7 days" },
    { min: 6 * 24 * 60, category: "other", type: "account_signin", title: "Signed in from Mesh UI", detail: "Desktop app" },
  ];
  const mapleFiller = fillerEvents(rng, { devices: 166, pause_block: 25, schedules: 26, eero_status: 43, speed_tests: 13, firmware: 7, admin: 29, ports_temperature: 85 }, mapleDevices, mapleEeros, 60);

  const maple: NetworkData = {
    network: {
      id: "4821907",
      name: "Maple Street",
      nickname: null,
      role: "owner",
      status: "online",
      lastSeen: null,
      timezone: TZ,
      connectionMode: "nat",
      gatewayUptimeSec: (23 * 24 * 60 + 4 * 60) * 60,
      lastReboot: iso((23 * 24 * 60 + 4 * 60) * MIN),
      capabilities: { ...CAPABILITIES_FULL },
      messages: [],
    },
    health: { internet: { status: "online", ispUp: true }, mesh: { status: "online" }, messages: [] },
    permissions: OWNER,
    internet: {
      status: "online",
      isp: { name: "Ziply Fiber", org: "Northwest Fiber, LLC", asn: "AS64500", city: "Kirkland", region: "WA", country: "US" },
      publicIpv4: "203.0.113.48",
      publicIpv6: "2001:db8:4a1c:7e00::1",
      ipv6Prefix: "2001:db8:4a1c:7e00::/56",
      wanType: "dhcp",
      ispGateway: "203.0.113.1",
      vlan: null,
      dnsInUse: ["203.0.113.53", "203.0.113.54"],
      dnsMode: "automatic",
      doubleNat: false,
      gateway: { eeroId: mapleIds.lr, location: "Living Room", model: "eero Max 7", wanPortSpeedMbps: 10000 },
    },
    eeros: mapleEeros,
    devices: mapleDevices,
    profiles: [
      { id: mapleProfileIds.alex, name: "Alex", paused: false, schedules: [] },
      { id: mapleProfileIds.jamie, name: "Jamie", paused: false, schedules: [] },
      {
        id: mapleProfileIds.mia,
        name: "Mia",
        paused: false,
        schedules: [
          { id: "9201", name: "Bedtime", days: SCHOOL_NIGHTS, start: "21:00", end: "07:00", enabled: true },
          { id: "9202", name: "Homework", days: WEEKDAYS, start: "16:00", end: "18:00", enabled: true },
          { id: "9203", name: "Weekend lights out", days: ["FRI", "SAT"], start: "23:00", end: "09:00", enabled: false },
        ],
      },
      { id: mapleProfileIds.leo, name: "Leo", paused: true, schedules: [] },
    ],
    speedTests: speedTests(now, [
      [2, 942, 918], [14, 931, 912], [26, 925, 905], [35, 948, 931], [44, 914, 887],
      [55, 936, 919], [66, 702, 846], [78, 921, 902], [90, 939, 922], [101, 928, 911],
      [112, 917, 896], [124, 944, 925], [136, 910, 889], [150, 933, 914], [161, 926, 908],
      [190, 934, 910], [230, 921, 899], [282, 655, 801], [330, 940, 921], [390, 929, 905],
      [450, 918, 894], [520, 937, 916], [600, 912, 890], [680, 930, 909],
    ]),
    events: [],
    reservations: [],
    forwards: [],
    pinholes: [],
    lan: {
      subnet: "192.168.4.0/22",
      size: 1024,
      gateway: "192.168.4.1",
      pool: { start: "192.168.4.100", end: "192.168.7.254", size: 923, leased: 0 },
      staticRange: { start: "192.168.4.2", end: "192.168.4.99" },
    },
    ports: {
      [mapleIds.lr]: portsOf(mapleEeros[0] as EeroFixture, [[1, 10000, { wan: true }], [2, 10000], [3, 2500], [4, 2500]]),
      [mapleIds.of]: portsOf(mapleEeros[1] as EeroFixture, [[1, 5000], [2, 5000]]),
      [mapleIds.up]: portsOf(mapleEeros[2] as EeroFixture, [[1, 2500], [2, 2500]]),
    },
    firmware: Object.fromEntries(mapleEeros.map((e) => [e.id, firmwareOf(e, now, [["7.12.1", 1.5], ["7.11.4", 41], ["7.10.2", 97], ["7.9.0", 160]])])),
    updates: {
      status: "scheduled",
      target: "7.13.0",
      canUpdateNow: true,
      required: false,
      scheduledAt: new Date(nextUpdateWindow(now)).toISOString(),
      preferredHour: 2,
      lastUpdatedAt: iso(36 * HOUR),
      stuckEeros: [],
    },
    usage: Object.fromEntries(mapleBuilt.map(([d, u]) => [d.id, u])),
    guest: { enabled: true, name: "Maple Street Guest", password: "lemon-harbor-42", security: { "2.4": "WPA2_WPA3", "5": "WPA2_WPA3", "6": "WPA3" } },
    wifi: {
      password: "maple-cedar-orbit-27",
      security: { "2.4": "WPA2_WPA3", "5": "WPA2_WPA3", "6": "WPA3" },
      // Old 2.4 GHz gear that would drop if the network went WPA3 only.
      wpa2OnlyDevices: ["HP LaserJet", "Garage Door Opener", "Flaky Plug"].flatMap((name) => mapleDevices.find((d) => d.name === name)?.id ?? []),
      hide5g: { active: false, expiresAt: null },
    },
    settings: {
      dns: { mode: "automatic", servers: [], ipv6Servers: [], caching: true },
      ipv6: { enabled: true },
      natRandomization: false,
      upnp: true,
      sqm: false,
      bandSteering: true,
      fastTransition: true,
      mlo: "multi",
      legacyMode: false,
      simpleSetup: true,
      powerSaving: {
        enabled: true,
        scheduleEnabled: true,
        schedules: [
          { id: "9301", name: "Overnight", days: ALL_DAYS, start: "01:00", end: "06:00", enabled: true },
          { id: "9302", name: "Weekday daytime", days: WEEKDAYS, start: "09:30", end: "15:00", enabled: false },
        ],
      },
      thread: { enabled: true, credentialSync: true, name: "MapleThread", channel: 15, panId: "0x4d55", xpanId: "4d55dead0000beef", borderAgent: "192.168.4.1:49191", devices: 6 },
    },
    threadCredentials: { networkKey: "00112233445566778899aabbccddeeff", pskc: "445f2b5ca6f2a93a55ce570a70efeecb", dataset: null },
    diagnostics: {
      status: "completed",
      issueArea: "mesh",
      results: [
        { name: "Internet", status: "good", detail: "Ziply Fiber is up; DNS answers in 9 ms" },
        { name: "Mesh", status: "warning", detail: "Garage has a weak link to Office (2 bars)" },
        { name: "eeros", status: "good", detail: "All 4 eeros checked in within the last minute" },
      ],
    },
    support: { eero: EERO_SUPPORT, isp: { name: "Ziply Fiber", phone: "+18665550144", url: "https://isp.example.com/ziply/support" } },
    admins: [
      { id: "7001", name: "Alex Kim", email: "alex@example.com", role: "owner", isYou: true },
      { id: "7002", name: "Jamie Kim", email: "jamie@example.com", role: "admin", isYou: false },
    ],
    // Matches the "Alex Kim invited sam@example.com" event 490 minutes ago; invites last 48 hours.
    invites: [{ id: "7101", nickname: "Sam", createdAt: iso(490 * MIN), expiresAt: iso(490 * MIN - 48 * HOUR) }],
    integrations: {
      homekit: integration(true, false),
      amazon: integration(true, true, "Linked to an Amazon account"),
      builtin: integration(true, true, "1 Echo extends your network"),
      smart_home_hub: integration(false, null, "Needs an eero with a Zigbee radio"),
      ffs: integration(true, true),
    },
    notifications: toNotifications(
      [
        { min: 25, title: "Leo is paused", body: "Alex Kim paused Leo's 3 devices until resumed.", read: false, category: "profile" },
        { min: 48, title: "New device joined", body: "Nest Thermostat joined Maple Street on Living Room.", read: false, category: "device", deviceId: deviceId("Nest Thermostat") },
        { min: 180, title: "Update tonight", body: "eeroOS 7.13.0 installs tonight between 2 AM and 5 AM.", read: false, category: "network" },
        { min: 220, title: "Weak link on Garage", body: "Garage dropped to 2 bars from Office. Moving it closer may help.", read: true, category: "eero" },
        { min: 2 * 24 * 60 + 12 * 60 + 4, title: "Garage is offline", body: "Garage stopped checking in. It came back 4 minutes later.", read: true, category: "eero" },
        { min: 3 * 24 * 60 + 40, title: "New device joined", body: "ESP_3A9F21 joined Maple Street on Garage.", read: true, category: "device", deviceId: deviceId("ESP_3A9F21") },
      ],
      now,
      "ms",
    ),
    notificationSettings: notificationSwitches(["network.dataUsageReport"]),
  };
  const reserved = ["Alex's MacBook Pro", "Synology NAS", "PlayStation 5", "Office iMac", "HP LaserJet", "Living Room TV", "Hue Bridge", "Ring Doorbell"];
  const forwardRows: [device: string, name: string, external: string, internal: string, protocol: M.Protocol, enabled: boolean][] = [
    ["Alex's MacBook Pro", "Web dev server", "8080", "8080", "tcp", true],
    ["Alex's MacBook Pro", "Syncthing", "22000", "22000", "both", true],
    ["Alex's MacBook Pro", "Game server", "27015-27030", "27015-27030", "udp", false],
    ["Synology NAS", "Plex Media Server", "32400", "32400", "tcp", true],
    ["PlayStation 5", "PSN party chat", "3478-3480", "3478-3480", "both", true],
  ];
  const byName = (name: string) => mapleDevices.find((x) => x.name === name);
  maple.forwards = forwardRows.flatMap(([name, desc, externalPort, internalPort, protocol, enabled], i) => {
    const d = byName(name);
    return d?.ipv4 ? [{ id: `96${String(i + 1).padStart(2, "0")}`, deviceId: d.id, name: desc, ip: d.ipv4, externalPort, internalPort, protocol, enabled }] : [];
  });
  maple.reservations = reserved.flatMap((name, i) => {
    const d = byName(name);
    const forwards = maple.forwards.filter((f) => f.deviceId === d?.id).length;
    return d?.ipv4 ? [{ id: `95${String(i + 1).padStart(2, "0")}`, deviceId: d.id, name: d.name, mac: d.mac, ip: d.ipv4, forwards }] : [];
  });
  maple.pinholes = ([["Synology NAS", "443", "tcp"], ["PlayStation 5", "3074", "udp"]] as const).flatMap(([name, port, protocol], i) => {
    const d = byName(name);
    return d ? [{ id: `97${String(i + 1).padStart(2, "0")}`, deviceId: d.id, address: d.ipv6[0] ?? null, port, protocol }] : [];
  });
  maple.events = toEvents([...mapleEvents, ...mapleFiller], now, "ms");

  // --- Lake Cabin: offline, owner, one eero -----------------------------
  const lakeIds = { lc: "81021" };
  const lakeOfflineMin = 2 * 24 * 60;
  const lakeEeros = [
    buildEero({ key: "lc", id: lakeIds.lc, location: "Great Room", model: "eero 6+", modelNumber: "N010001", serial: "MU0DEMO0000021", gateway: true, bands: ["2.4", "5", "wired"], radios: { "2.4": { channel: 6, width: 20 }, "5": { channel: 149, width: 80 } }, ip: "192.168.4.1", firmware: "7.11.4", updateAvailable: false, status: "offline", uptimeMin: 0, joined: "2024-07-02T20:10:00Z", heartbeatMin: lakeOfflineMin, endOfLife: { expired: false, date: "2029-12-31T00:00:00Z" }, subnet: "192.168.4.0/24", gatewayIp: "192.168.4.1" }, 0xe1, 0x2000, now, lakeIds),
  ];
  const lakeBuilt = LAKE_DEVICES.map((row, i) => buildDevice(row, i + 1, now, { block: 0x11, subnet: "192.168.4", v6: null, eeros: lakeIds, eeroList: lakeEeros, profiles: {} }));
  const lake: NetworkData = {
    network: {
      id: "5130264",
      name: "Lake Cabin",
      nickname: null,
      role: "owner",
      status: "offline",
      lastSeen: iso(lakeOfflineMin * MIN),
      timezone: TZ,
      connectionMode: "nat",
      gatewayUptimeSec: null,
      lastReboot: iso(40 * DAY),
      capabilities: { ...CAPABILITIES_FULL, sqm: false },
      messages: ["Your network has been offline for 2 days."],
    },
    health: { internet: { status: "offline", ispUp: null }, mesh: { status: "offline" }, messages: ["Lake Cabin is offline. Check power and the modem at the cabin."] },
    permissions: OWNER,
    internet: {
      status: "offline",
      isp: { name: "Cedar Valley Wireless", org: "Cedar Valley Wireless Co.", asn: "AS64501", city: "Lake Wren", region: "WA", country: "US" },
      publicIpv4: "198.51.100.77",
      publicIpv6: null,
      ipv6Prefix: null,
      wanType: "dhcp",
      ispGateway: "198.51.100.1",
      vlan: null,
      dnsInUse: ["198.51.100.53"],
      dnsMode: "automatic",
      doubleNat: false,
      gateway: { eeroId: lakeIds.lc, location: "Great Room", model: "eero 6+", wanPortSpeedMbps: null },
    },
    eeros: lakeEeros,
    devices: lakeBuilt.map(([d]) => d),
    profiles: [],
    speedTests: speedTests(now, [[60, 182, 21], [120, 176, 19], [200, 190, 22]]),
    events: toEvents(
      [
        { min: lakeOfflineMin, category: "eero_status", type: "network_offline", title: "Lake Cabin went offline", detail: "Great Room · last heartbeat", refs: { eeroId: lakeIds.lc } },
        { min: lakeOfflineMin + 10, category: "devices", type: "device_disconnected", title: "Cabin Camera disconnected", detail: "Last seen on Great Room" },
        { min: 4 * 24 * 60, category: "speed_tests", type: "speedtest_completed", title: "Speed test: 176 down / 19 up Mbps", detail: "Cedar Valley Wireless · automatic test" },
        { min: 9 * 24 * 60, category: "devices", type: "device_disconnected", title: "Cabin Fire TV disconnected", detail: "Last seen on Great Room" },
      ],
      now,
      "lc",
    ),
    reservations: [],
    forwards: [],
    pinholes: [],
    lan: {
      subnet: "192.168.4.0/24",
      size: 256,
      gateway: "192.168.4.1",
      pool: { start: "192.168.4.20", end: "192.168.4.254", size: 235, leased: 0 },
      staticRange: { start: "192.168.4.2", end: "192.168.4.19" },
    },
    ports: { [lakeIds.lc]: portsOf(lakeEeros[0] as EeroFixture, [[1, 1000, { wan: true }], [2, 1000]]) },
    firmware: Object.fromEntries(lakeEeros.map((e) => [e.id, firmwareOf(e, now, [["7.11.4", 52], ["7.10.2", 97], ["7.9.0", 160]])])),
    updates: {
      status: "up_to_date",
      target: null,
      canUpdateNow: false,
      required: false,
      scheduledAt: null,
      preferredHour: 3,
      lastUpdatedAt: iso(52 * DAY),
      stuckEeros: [],
    },
    usage: Object.fromEntries(lakeBuilt.map(([d, u]) => [d.id, u])),
    // An open guest network: no password, so no security either.
    guest: { enabled: true, name: "Lake Cabin Guest", password: null, security: { "2.4": null, "5": null, "6": null } },
    wifi: { password: "cabin-loon-quiet-31", security: { "2.4": "WPA2", "5": "WPA2", "6": null }, wpa2OnlyDevices: [], hide5g: { active: false, expiresAt: null } },
    settings: {
      dns: { mode: "automatic", servers: [], ipv6Servers: [], caching: true },
      ipv6: { enabled: false },
      natRandomization: false,
      upnp: true,
      sqm: null,
      bandSteering: true,
      fastTransition: false,
      mlo: null,
      legacyMode: false,
      simpleSetup: false,
      powerSaving: { enabled: false, scheduleEnabled: false, schedules: [] },
      thread: { enabled: false, credentialSync: false, name: null, channel: null, panId: null, xpanId: null, borderAgent: null, devices: null },
    },
    threadCredentials: null,
    diagnostics: { status: null, issueArea: null, results: [] },
    support: { eero: EERO_SUPPORT, isp: null },
    admins: [{ id: "7001", name: "Alex Kim", email: "alex@example.com", role: "owner", isYou: true }],
    invites: [],
    integrations: {
      homekit: integration(true, false),
      amazon: integration(true, false),
      builtin: integration(true, false),
      smart_home_hub: integration(false, null, "Needs an eero with a Zigbee radio"),
      ffs: integration(true, false),
    },
    notifications: toNotifications([{ min: lakeOfflineMin, title: "Lake Cabin is offline", body: "Lake Cabin stopped checking in. Check power and the modem.", read: false, category: "network" }], now, "lc"),
    notificationSettings: notificationSwitches(),
  };

  // --- Mom's House: admin role, bridge mode, no Thread or nightlight ------
  const momIds = { ki: "82031", de: "82032" };
  const momEeros = [
    buildEero({ key: "ki", id: momIds.ki, location: "Kitchen", model: "eero 6+", modelNumber: "N010001", serial: "MU0DEMO0000031", gateway: true, bands: ["2.4", "5", "wired"], radios: { "2.4": { channel: 11, width: 20 }, "5": { channel: 44, width: 80 } }, ip: "192.168.1.40", firmware: "7.12.1", updateAvailable: true, uptimeMin: 9 * 24 * 60, joined: "2023-11-25T22:00:00Z", subnet: "192.168.1.0/24", gatewayIp: "192.168.1.1" }, 0xe2, 0x3000, now, momIds),
    buildEero({ key: "de", id: momIds.de, location: "Den", model: "eero 6", modelNumber: "M010001", serial: "MU0DEMO0000032", upstream: "ki", meshBars: 4, bands: ["2.4", "5"], radios: { "2.4": { channel: 1, width: 20 }, "5": { channel: 157, width: 80 } }, ip: "192.168.1.41", firmware: "7.12.1", updateAvailable: true, uptimeMin: 9 * 24 * 60, joined: "2023-11-25T22:10:00Z", endOfLife: { expired: false, date: "2028-06-30T00:00:00Z" }, subnet: "192.168.1.0/24", gatewayIp: "192.168.1.1" }, 0xe2, 0x3010, now, momIds),
  ];
  const momBuilt = MOM_DEVICES.map((row, i) => buildDevice(row, i + 1, now, { block: 0x12, subnet: "192.168.1", v6: null, eeros: momIds, eeroList: momEeros, profiles: {} }));
  const momDevices = momBuilt.map(([d]) => d);
  const mom: NetworkData = {
    network: {
      id: "6092118",
      name: "Kim Home",
      nickname: "Mom's House",
      role: "admin",
      status: "online",
      lastSeen: null,
      timezone: "America/Los_Angeles",
      connectionMode: "bridged",
      gatewayUptimeSec: 9 * 24 * 60 * 60,
      lastReboot: iso(9 * DAY),
      capabilities: { ...CAPABILITIES_FULL, thread_network: false, thread_keychain_sharing: false, sqm: false, ipv6_editable: false, ownership_transfer: false, power_saving: false },
      messages: ["Bridge mode is on: profiles, port forwards and reservations are handled by your router."],
    },
    health: { internet: { status: "online", ispUp: true }, mesh: { status: "online" }, messages: [] },
    permissions: ADMIN,
    internet: {
      status: "online",
      isp: { name: "Harbor Cable", org: "Harbor Cable Communications", asn: "AS64502", city: "Port Alder", region: "WA", country: "US" },
      publicIpv4: "198.51.100.140",
      publicIpv6: null,
      ipv6Prefix: null,
      wanType: "dhcp",
      ispGateway: "192.168.1.1",
      vlan: null,
      dnsInUse: ["192.168.1.1"],
      dnsMode: "automatic",
      doubleNat: null,
      gateway: { eeroId: momIds.ki, location: "Kitchen", model: "eero 6+", wanPortSpeedMbps: 1000 },
    },
    eeros: momEeros,
    devices: momDevices,
    profiles: [],
    speedTests: speedTests(now, [[20, 412, 22], [70, 398, 21], [140, 405, 23], [260, 388, 20]]),
    events: toEvents(
      [
        { min: 90, category: "firmware", type: "firmware_update_available", title: "Update available: eeroOS 7.13.0", detail: "An admin with owner rights can install it" },
        { min: 20 * 60, category: "speed_tests", type: "speedtest_completed", title: "Speed test: 412 down / 22 up Mbps", detail: "Harbor Cable · automatic test" },
        ...fillerEvents(rng, { devices: 30, pause_block: 0, schedules: 0, eero_status: 4, speed_tests: 0, firmware: 0, admin: 1, ports_temperature: 3 }, momDevices, momEeros, 120),
      ],
      now,
      "mh",
    ),
    // Bridge mode: the router does reservations and forwards.
    reservations: [],
    forwards: [],
    pinholes: [],
    lan: null,
    ports: {
      [momIds.ki]: portsOf(momEeros[0] as EeroFixture, [[1, 1000, { wan: true }], [2, 1000]]),
      [momIds.de]: portsOf(momEeros[1] as EeroFixture, [[1, 1000], [2, 1000]]),
    },
    firmware: Object.fromEntries(momEeros.map((e) => [e.id, firmwareOf(e, now, [["7.12.1", 9], ["7.11.4", 44], ["7.10.2", 99]])])),
    updates: {
      status: "available",
      target: "7.13.0",
      canUpdateNow: true,
      required: false,
      scheduledAt: null,
      preferredHour: 3,
      lastUpdatedAt: iso(9 * DAY),
      stuckEeros: [],
    },
    usage: Object.fromEntries(momBuilt.map(([d, u]) => [d.id, u])),
    // eero has no guest network in bridge mode.
    guest: { enabled: false, name: "Kim Home Guest", password: "garden-gate-19", security: { "2.4": "WPA2_WPA3", "5": "WPA2_WPA3", "6": null } },
    wifi: { password: "rose-garden-tea-55", security: { "2.4": "WPA2_WPA3", "5": "WPA2_WPA3", "6": null }, wpa2OnlyDevices: momDevices.filter((d) => d.name === "Den Printer").map((d) => d.id), hide5g: { active: false, expiresAt: null } },
    settings: {
      dns: { mode: "automatic", servers: [], ipv6Servers: [], caching: null },
      ipv6: { enabled: null },
      natRandomization: null,
      upnp: null,
      sqm: null,
      bandSteering: true,
      fastTransition: false,
      mlo: null,
      legacyMode: false,
      simpleSetup: false,
      powerSaving: { enabled: null, scheduleEnabled: null, schedules: [] },
      thread: null,
    },
    threadCredentials: null,
    diagnostics: { status: "completed", issueArea: null, results: [{ name: "Internet", status: "good", detail: "Harbor Cable is up" }] },
    support: { eero: EERO_SUPPORT, isp: { name: "Harbor Cable", phone: "+15035550175", url: "https://isp.example.com/harbor/support" } },
    // Alex is an admin here; Rose owns the network. Admins cannot read invites.
    admins: [
      { id: "7201", name: "Rose Kim", email: "rose@example.com", role: "owner", isYou: false },
      { id: "7001", name: "Alex Kim", email: "alex@example.com", role: "admin", isYou: true },
    ],
    invites: [],
    integrations: {
      homekit: integration(false, null, "Not available in bridge mode"),
      amazon: integration(true, false),
      builtin: integration(false, null, "Not available in bridge mode"),
      smart_home_hub: integration(false, null, "Needs an eero with a Zigbee radio"),
      ffs: integration(true, true),
    },
    notifications: toNotifications([{ min: 90, title: "Update available", body: "eeroOS 7.13.0 is ready. The owner can install it.", read: true, category: "network" }], now, "mh"),
    notificationSettings: notificationSwitches(["permissions.updates"]),
  };

  // Typical live rates, set on connected devices that are not paused.
  for (const [rows, data] of [[MAPLE_DEVICES, maple], [MOM_DEVICES, mom]] as const) {
    rows.forEach((row, i) => {
      const d = data.devices[i];
      if (d && row.rate && d.connected && !d.paused) d.rates = { downMbps: row.rate[0], upMbps: row.rate[1], at: new Date(now).toISOString() };
    });
  }

  return {
    account: {
      id: "K4M9QZ",
      name: "Alex Kim",
      email: { value: "alex@example.com", verified: true },
      phone: { value: "+15550100142", verified: false },
      authType: "email",
      marketingEmails: false,
      push: { networkOffline: true, nodeOffline: true },
      canTransfer: true,
      networkCount: 3,
    },
    login: "al***@example.com",
    networks: [maple, lake, mom],
  };
}

