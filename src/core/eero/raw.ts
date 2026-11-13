/**
 * Raw eero response shapes, limited to the fields Mesh UI reads. Every field
 * is optional because shapes vary by firmware, model, role and User-Agent.
 * Only the eero client, the mappers in src/core/eero/map and the fake eero
 * server use these; commands never see them.
 * Field reference: docs/eero-api/data-model.md.
 */

export type RawEnvelope<T = unknown> = {
  meta?: { code?: number; server_time?: string; error?: string };
  data?: T | null;
};

/** A link given as a string or `{url}`. */
export type RawLink = string | { url?: string };

export type RawRef = { url?: string; name?: string };

// ---------------------------------------------------------------------------
// Auth

export type RawLoginResponse = { user_token?: string };
export type RawVerifyResponse = { user_token?: string; session_token?: string; name?: string; log_id?: string };

// ---------------------------------------------------------------------------
// Account

export type RawAccountNetworkRef = {
  url?: string;
  name?: string;
  created?: string;
  nickname_label?: string | null;
  access_expires_on?: string | null;
};

export type RawAccount = {
  name?: string;
  email?: { value?: string; verified?: boolean };
  phone?: { value?: string; country_code?: string; national_number?: string; verified?: boolean };
  log_id?: string;
  networks?: { count?: number; data?: RawAccountNetworkRef[] };
  role?: string;
  premium_status?: string;
  push_settings?: { networkOffline?: boolean; nodeOffline?: boolean };
  auth?: { type?: "email" | "phone" | "amazon" | string };
  can_transfer?: boolean;
};

// ---------------------------------------------------------------------------
// Network

export type RawSpeedValue = { value?: number; units?: string };

export type RawCapability = { capable?: boolean; requirements?: Record<string, boolean> };

export type RawNetwork = {
  url?: string;
  name?: string;
  display_name?: string;
  nickname_label?: string | null;
  owner?: string;
  status?: string;
  health?: {
    internet?: { status?: string; isp_up?: boolean };
    eero_network?: { status?: string };
  };
  messages?: unknown[];
  last_reboot?: string | null;
  timezone?: { value?: string; geo_ip?: string };
  created?: string;
  speed?: { status?: string; date?: string; down?: RawSpeedValue; up?: RawSpeedValue };
  geo_ip?: { isp?: string; org?: string; asn?: number; city?: string; region?: string; regionName?: string; countryCode?: string; countryName?: string; timezone?: string };
  ip_settings?: { public_ip?: string; double_nat?: boolean };
  gateway_ip?: string;
  wan_ip?: string;
  wan_type?: string;
  connection?: { mode?: "nat" | "bridged" | "ipPassthrough" | string };
  lease?: { mode?: string; dhcp?: { ip?: string; mask?: string; router?: string } };
  dhcp?: { mode?: string; custom?: { subnet_ip?: string; subnet_mask?: string; start_ip?: string; end_ip?: string } };
  dns?: { mode?: string; caching?: boolean; parent?: { ips?: string[] }; custom?: { ips?: string[] } };
  upnp?: boolean;
  ipv6_upstream?: boolean;
  band_steering?: boolean;
  wpa3?: boolean;
  sqm?: boolean;
  thread?: boolean;
  power_saving?: boolean;
  guest_network?: { url?: string; name?: string; enabled?: boolean };
  updates?: {
    has_update?: boolean;
    update_required?: boolean;
    can_update_now?: boolean;
    target_firmware?: string;
    update_status?: string | null;
    scheduled_update_time?: string | null;
    preferred_update_hour?: number | null;
  };
  capabilities?: Record<string, RawCapability>;
  resources?: Record<string, RawLink>;
  eeros?: { count?: number; data?: RawEero[] };
  clients?: { count?: number; url?: string };
  profiles?: { count?: number; url?: string };
};

export type RawPermissions = {
  role?: string;
  permissions?: Record<string, { create?: boolean; read?: boolean; update?: boolean; delete?: boolean }> & { per_eero?: unknown[] };
};

export type RawSpeedTest = { date?: string; down_mbps?: number; up_mbps?: number };

// ---------------------------------------------------------------------------
// eero nodes

export type RawEero = {
  url?: string;
  serial?: string;
  location?: string;
  model?: string;
  model_number?: string;
  gateway?: boolean;
  is_primary_node?: boolean;
  status?: "green" | "yellow" | "red" | string;
  state?: string;
  heartbeat_ok?: boolean;
  last_heartbeat?: string;
  joined?: string;
  last_reboot?: string | null;
  uptime?: { since_last_reboot_s?: number; since_cloud_connection_s?: number };
  os?: string;
  os_version?: string;
  update_available?: boolean;
  ip_address?: string;
  mac_address?: string;
  bands?: string[];
  wired?: boolean;
  connection_type?: string;
  using_wan?: boolean;
  mesh_quality_bars?: number;
  wireless_upstream_node?: { url?: string; location?: string } | null;
  connected_clients_count?: number;
  connected_wired_clients_count?: number;
  connected_wireless_clients_count?: number;
  led_on?: boolean;
  led_brightness?: number;
  nightlight?: { url?: string; enabled?: boolean; brightness_percentage?: number; schedule?: { enabled?: boolean; on?: string; off?: string } } | null;
  provides_wifi?: boolean;
  messages?: unknown[];
  network?: RawRef & { created?: string };
  resources?: Record<string, RawLink>;
};

// ---------------------------------------------------------------------------
// Devices

export type RawDevice = {
  url?: string;
  mac?: string;
  nickname?: string | null;
  hostname?: string | null;
  display_name?: string | null;
  manufacturer?: string | null;
  model_name?: string | null;
  device_type?: string | null;
  ip?: string | null;
  ips?: string[];
  ipv4?: string | null;
  ipv6_addresses?: (string | { address?: string })[];
  connected?: boolean;
  wireless?: boolean;
  connection_type?: string;
  source?: { location?: string; is_gateway?: boolean; url?: string; model?: string; display_name?: string; serial_number?: string };
  interface?: { frequency?: string; frequency_unit?: string };
  channel?: number;
  ssid?: string;
  subnet_kind?: string;
  is_guest?: boolean;
  is_private?: boolean;
  connectivity?: {
    signal?: string;
    signal_avg?: string;
    score?: number;
    score_bars?: number;
    rx_bitrate?: string;
    frequency?: number;
  };
  usage?: { down_mbps?: number; up_mbps?: number } | null;
  last_active?: string | null;
  first_active?: string | null;
  paused?: boolean;
  blocked?: boolean;
  blacklisted?: boolean;
  profile?: (RawRef & { paused?: boolean }) | null;
};

export type RawBurstResult = { next_burst?: string };

// ---------------------------------------------------------------------------
// Profiles

export type RawSchedule = { url?: string; name?: string; days?: string[]; start?: string; end?: string; enabled?: boolean };

export type RawProfile = {
  url?: string;
  name?: string;
  paused?: boolean;
  default?: boolean;
  state?: { value?: string; schedule?: unknown };
  devices?: RawDevice[];
  schedule?: RawSchedule[];
  resources?: Record<string, RawLink>;
};

// ---------------------------------------------------------------------------
// Usage and events

export type RawUsageValue = { time?: string; value?: number };
export type RawUsageSeries = { type?: "download" | "upload" | string; sum?: number; values?: RawUsageValue[] };
export type RawUsage = { network_id?: number | string; start?: string; end?: string; series?: RawUsageSeries[] };

export type RawBreakdownRow = {
  url?: string;
  mac?: string;
  id?: string | number;
  name?: string;
  nickname?: string;
  display_name?: string;
  hostname?: string;
  device_type?: string;
  download?: number;
  upload?: number;
};
export type RawBreakdown = { devices?: RawBreakdownRow[]; profiles?: RawBreakdownRow[]; eeros?: RawBreakdownRow[] };

export type RawEvent = {
  id?: string | number;
  event_type?: string;
  title?: string;
  message?: string;
  created?: string;
  timestamp?: string;
  device?: RawRef & { mac?: string };
  eero?: RawRef & { serial?: string };
  profile?: RawRef;
};

// ---------------------------------------------------------------------------
// Helpers

/**
 * Lenient list parsing. eero answers lists as a bare array, `{ data: [...] }`
 * or a named key (`devices`, `members`, `invites`, `schedules`). Anything
 * else is an empty list.
 */
export function asList<T>(data: unknown, key?: string): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (key && Array.isArray(obj[key])) return obj[key] as T[];
    if (Array.isArray(obj.data)) return obj.data as T[];
    if (key && obj[key] && typeof obj[key] === "object") return asList<T>(obj[key]);
  }
  return [];
}

/** The url of a link given as a string or `{url}`. */
export function linkUrl(link: RawLink | null | undefined): string | null {
  if (!link) return null;
  if (typeof link === "string") return link;
  return typeof link.url === "string" ? link.url : null;
}
