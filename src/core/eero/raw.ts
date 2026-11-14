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
  /** The WAN lease. eero sends no lease or renew time (real capture, 2026-11-13). */
  lease?: { mode?: string; dhcp?: { ip?: string; mask?: string; router?: string } | null; static?: unknown };
  dhcp?: { mode?: string; custom?: { subnet_ip?: string; subnet_mask?: string; start_ip?: string; end_ip?: string } };
  dns?: { mode?: string; caching?: boolean; parent?: { ips?: string[] }; custom?: { ips?: string[] } | null };
  upnp?: boolean;
  ipv6_upstream?: boolean;
  band_steering?: boolean;
  wpa3?: boolean;
  sqm?: boolean;
  thread?: boolean;
  power_saving?: boolean;
  /** The main Wi-Fi password, sent in the clear (real capture, 2026-11-13). Only sensitive reads may map it. */
  password?: string;
  /** e.g. "multi"; absent when the network has no Wi-Fi 7 multi-link. */
  mlo_mode?: string;
  wireless_mode?: string;
  /** eero Simple Setup state as a string. */
  auto_setup_mode?: string;
  nat_port_randomization?: boolean;
  power_saving_schedule_enabled?: boolean;
  ipv6?: { name_servers?: { mode?: string; custom?: string[] } };
  pppoe_enabled?: boolean | null;
  pppoe_username?: string | null;
  vlan?: number | null;
  /** Empty object when no flag is set; `hide_5g` while 2.4 GHz only is on. */
  temporary_flags?: { hide_5g?: boolean | { value?: boolean; expires_on?: string | null } };
  /** null when HomeKit was never set up. */
  homekit?: { enabled?: boolean } | null;
  amazon_account_linked?: boolean;
  /** Amazon Frustration-Free Setup. */
  ffs?: boolean;
  alexa_skill?: boolean;
  /** eero Built-in: partner devices acting as eeros (`GET {net}/proxied_nodes` is a 404). */
  proxied_nodes?: { enabled?: boolean; devices?: RawProxiedNode[] };
  guest_network?: RawGuestNetwork;
  updates?: RawUpdates;
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
  /**
   * The parent of a wireless eero. eero sends its `name` (the parent's
   * `location`) and a node id that is not an eero id; no url (real capture,
   * 2026-11-13). `url` is read only if eero ever sends it.
   */
  ethernet_status?: { wiredInternet?: boolean; segmentId?: string; statuses?: RawEthernetPortStatus[] } | null;
  wireless_upstream_node?: { url?: string; name?: string; primary_mesh_radio?: string; node_or_proxied_node_id?: number; is_proxied_node?: boolean } | null;
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

/** One device behind a port: `EERO_DEVICE` (metadata `location, model, model_name, url`) or `CLIENT_DEVICE` (`display_name, device_type, url`). */
export type RawPortConnection = {
  type?: string;
  metadata?: { url?: string; location?: string; model?: string; model_name?: string; display_name?: string; device_type?: string; advanced_attributes?: { connection_type?: string } };
};

/** `GET resources.connections` (normally `{eero}/connections`). Shape from a real capture (2026-11-13). */
export type RawPortInterface = {
  interface_number?: number;
  name?: string | null;
  /** "DATA_CONNECTED", "WAN" seen; other values (down, disabled) not yet. */
  port_status?: string;
  /** "P2500", "P1000"; absent when the link is down. */
  negotiated_speed?: string | null;
  supported_speed?: string | null;
  /** "UNKNOWN" on both real ports, the WAN port included. */
  network_type?: string;
  poe_status?: string | null;
  ethernet_address?: string;
  /** True on the port toward the internet or the parent eero. */
  is_upstream?: boolean;
  /**
   * What is plugged in: `WAN_SOURCE` on the WAN port, `MULTIPLE_DEVICES`
   * with `metadata.multiple_devices.connections[]` behind a switch.
   */
  connection_status?: {
    type?: string;
    metadata?: RawPortConnection["metadata"] & { multiple_devices?: { connections?: RawPortConnection[] } };
  } | null;
  actions?: { type?: string; position?: number }[];
};

export type RawConnections = {
  ports?: { layout?: string | { layout_type?: string; position_rank_order?: number[] }; interfaces?: RawPortInterface[] };
  node_actions?: { type?: string }[];
  wireless_devices?: { type?: string; metadata?: { display_name?: string; device_type?: string; url?: string } }[];
  provide_device_power?: boolean;
};

/**
 * One row of `GET /2.2/eeros/{id}/firmware_update/history`, whose `data` is
 * `{data: [row], meta: {has_more}}`, newest first (real capture, 2026-11-13).
 * `firmware_version` is the build string, the eero's `os_version` plus
 * `+build`.
 */
export type RawFirmwareHistoryEntry = {
  id?: string;
  timestamp?: string;
  finished_at?: string | null;
  firmware_version?: string;
  previous_version?: string | null;
  /** "completed" seen. */
  status?: string;
  /** "manual", "automatic". */
  update_type?: string;
  duration_seconds?: number;
  /** "Success" seen. */
  outcome?: string;
  update_status?: string;
  failure_reason?: string | null;
};

/** One port in an eero's `ethernet_status.statuses` (real capture, 2026-11-13). */
export type RawEthernetPortStatus = {
  interfaceNumber?: number;
  hasCarrier?: boolean;
  /** "P1000", "P10". */
  speed?: string;
  /** The port labelled WAN; on a wired satellite, the one toward its parent. */
  isWanPort?: boolean;
  isLte?: boolean;
  /** False on every real port, the wired satellite's uplink included. */
  isLeafWiredToUpstream?: boolean;
  /** The eero on the other end, when it is one: `{type: "EERO", metadata: {port, port_name, location, url}}`. */
  neighbor?: { type?: string; metadata?: { url?: string; location?: string; port?: number; port_name?: string } } | null;
  port_name?: string;
};

// ---------------------------------------------------------------------------
// Routing (`GET {net}/routing`)

export type RawReservation = { url?: string; description?: string; mac?: string; ip?: string; public_static_ip?: string | null };
export type RawForward = { url?: string; description?: string; ip?: string; gateway_port?: string | number; client_port?: string | number; protocol?: string; enabled?: boolean; reservation?: RawLink };
export type RawPinhole = { url?: string; device?: (RawRef & { mac?: string }) | string; ip?: string; protocol?: string; port?: string | number };

export type RawRouting = {
  url?: string;
  devices?: { url?: string; data?: { url?: string; mac?: string; nickname?: string | null }[] };
  reservations?: { url?: string; data?: RawReservation[] };
  forwards?: { url?: string; data?: RawForward[] };
  pinholes?: { url?: string; data?: RawPinhole[] };
};

// ---------------------------------------------------------------------------
// Updates (`GET {net}/updates`, also embedded in the network as `updates`)

export type RawUpdates = {
  has_update?: boolean;
  update_required?: boolean;
  can_update_now?: boolean;
  target_firmware?: string | null;
  update_to_firmware?: string | null;
  min_required_firmware?: string | null;
  update_status?: string | null;
  scheduled_update_time?: string | null;
  preferred_update_hour?: number | null;
  last_update_started?: string | null;
  last_user_update?: { unresponsive_eeros?: RawLink[]; incomplete_eeros?: RawLink[] } | null;
  manifest_resource?: string | null;
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
/**
 * A `data_usage/breakdown` profile row. Real capture (2026-11-13, key paths
 * and types only): no `url`, `id` or `name`, only these four keys. eero's
 * default (Unassigned) profile had no row.
 */
export type RawProfileUsageRow = { profile_id?: number | string; profile_name?: string; download?: number; upload?: number };

/**
 * `GET {net}/data_usage/breakdown?start&end`. Real capture (2026-11-13):
 * `{start, end, upload, download, eeros[], devices[], unprofiled[], profiles[]}`;
 * `unprofiled` rows are device rows.
 */
export type RawBreakdown = {
  start?: string;
  end?: string;
  download?: number;
  upload?: number;
  devices?: RawBreakdownRow[];
  unprofiled?: RawBreakdownRow[];
  profiles?: RawProfileUsageRow[];
  eeros?: RawBreakdownRow[];
};

// ---------------------------------------------------------------------------
// Guest, Wi-Fi and settings reads (real capture, 2026-11-13: key paths and types only)

/** `GET {net}/guestnetwork`, also embedded as the network's `guest_network`. `password` is in the clear. */
export type RawGuestNetwork = { url?: string; name?: string; password?: string | null; enabled?: boolean; resources?: { password?: string } };

/** `GET {net}/wpa3_per_band`. Only these two keys came back; values `WPA2` / `WPA2_WPA3` / `WPA3` per the clients (case varies). */
export type RawWpa3PerBand = { band_2_4_ghz?: string; band_5_ghz?: string; band_6_ghz?: string };

/** `GET {net}/fast_transition`. */
export type RawFastTransition = { fast_transition?: boolean };

/** One power saving schedule. The capture's list was empty; fields from the clients. */
export type RawPowerSavingSchedule = { url?: string; id?: string | number; name?: string; days?: string[]; start_time?: string; end_time?: string; enabled?: boolean };

/** `GET {net}/power_saving/schedules`. */
export type RawPowerSavingSchedules = { schedules?: RawPowerSavingSchedule[] };

/** `GET {net}/thread`. `master_key` and `commissioning_credential` are secrets; no `active_operational_dataset` came back. */
export type RawThread = {
  url?: string;
  enabled?: boolean;
  enable_credential_syncing?: boolean;
  name?: string;
  xpan_id?: string;
  pan_id?: string;
  channel?: number;
  master_key?: string;
  commissioning_credential?: string;
  active_operational_dataset?: string;
  border_agent?: { ip?: string; port?: number };
};

/** `GET {net}/ac_compat` (legacy device mode). */
export type RawAcCompat = { enabled?: boolean };

/** One device in `proxied_nodes.devices[]` (eero Built-in). */
export type RawProxiedNode = {
  url?: string;
  client_device_url?: string;
  mac_address?: string;
  ip_address?: string;
  display_name?: string;
  model_name?: string;
  manufacturer?: string;
  status?: string;
  enabled?: boolean;
  is_meshing?: boolean;
  is_guest?: boolean;
  blocked?: boolean;
  paused?: boolean;
  serial?: string;
  os?: string;
  os_version?: string;
  first_seen?: string;
  profile?: RawRef;
};

// ---------------------------------------------------------------------------
// Events and notifications (real capture, 2026-11-13)

/** One row of `GET {net}/app_events`, which answers `{events: [...]}`. */
export type RawAppEvent = { hash?: string; timestamp_ms?: number; description?: string; category?: string };
export type RawAppEvents = { events?: RawAppEvent[] };

/** One row of `GET {net}/notifications_history`, which answers `{notifications: [...]}`. No read flag per row. */
export type RawNotification = {
  uuid?: string;
  category?: string;
  title?: string;
  body?: string;
  created_at?: string;
  meta?: { device_url?: string; network_url?: string };
};
export type RawNotificationsHistory = { notifications?: RawNotification[] };

/** `GET {net}/notifications`: a flat map, keys with dots (`device.new`). */
export type RawNotificationSettings = Record<string, boolean>;

/** `GET {net}/notifications/has_unread`: an object or a bare bool (clients). */
export type RawHasUnread = { has_unread?: boolean } | boolean;

// ---------------------------------------------------------------------------
// Diagnostics, support, admins (real capture, 2026-11-13)

/** `GET {net}/diagnostics`. Only `status` came back; `issue_area` and `results` per the clients, after a run. */
export type RawDiagnostics = { status?: string; issue_area?: string | null; results?: { name?: string; status?: string; detail?: string | null }[] };

/** `GET {net}/support` on `/2.2/`. */
export type RawSupport = { support_phone?: string; contact_url?: string; help_url?: string; email_web_form_url?: string; name?: string };

/** One row of `GET {net}/members`, which answers `{members: [...]}`. No email came back. */
export type RawMember = { user_id?: number; user_role?: string; user_name?: string; user_tags?: string[] };
export type RawMembers = { members?: RawMember[] };

/** One row of `GET {net}/invites` (a bare array; empty in the capture, fields per the clients). */
export type RawInvite = { invite_id?: string | number; invite_nickname?: string | null; created?: string; expires?: string | null };

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

// ---------------------------------------------------------------------------
// Write bodies (M4). Request shapes from docs/eero-api/endpoints.md and the
// open source clients; none was sent to a real network. Each wave-2 story
// confirms its own against the fake server's recorded request.

/**
 * `PUT /2.3/networks/{id}/devices/{mac}`, JSON, one or more fields (2.2
 * answers 200 and drops the change). `profile` is `{url}` of a profile; on a
 * real network every device has one, Unassigned being the `default: true`
 * profile (capture 2026-11-13).
 */
export type RawDeviceWrite = { paused?: boolean; nickname?: string | null; device_type?: string; profile?: { url: string } };

/** `POST {net}/blacklist`, form. Unblock is `DELETE {net}/blacklist/{mac}`, no body. */
export type RawBlockWrite = { mac: string };

/** `POST {net}/profiles` (create: all three) or `PUT {profile}` (any one), JSON. `devices` replaces the whole list. */
export type RawProfileWrite = { name?: string; paused?: boolean; devices?: { url: string }[] };

/** `POST {profile}/schedules` or `PUT {schedule url}`, JSON. `end` before `start` wraps past midnight. */
export type RawScheduleWrite = { name: string; days: string[]; start: string; end: string; enabled: boolean };

/** `PUT {net}/guestnetwork`, form. The password has its own path: `PUT {net}/guestnetwork/password` (form `password`), `DELETE` to make it open. */
export type RawGuestWrite = { enabled?: boolean; name?: string };

/** `PUT {net}/password`, form (8 to 63 printable ASCII). */
export type RawPasswordWrite = { password: string };

/** `PUT resources.led_action` (normally `/2.2/eeros/{id}/led`), form: either field. A JSON PUT to `{eero}` does nothing. */
export type RawLedWrite = { led_on?: boolean; led_brightness?: number };

/** `PUT {eero}/nightlight/settings`, JSON. Beacon only. */
export type RawNightlightWrite = { enabled: boolean; brightness_percentage: number; schedule: { enabled: boolean; on: string; off: string } };

/** `PUT {net}/temporary_flags/hide_5g`, JSON or form; off is `DELETE` with no body. */
export type RawHide5gWrite = { value: true };
