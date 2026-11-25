/**
 * The Backend interface: what commands call instead of eero. Methods take ids
 * and model-shaped inputs and return model objects from model.ts. Two
 * implementations: `eero` (src/core/eero/backend) and `demo` (src/core/demo).
 * See docs/architecture/backends.md.
 *
 * Network-scoped methods take the network id first. Methods throw
 * `BackendError`, which the engine maps to an error code.
 *
 * The interface is split into one sub-interface per area, so each eero
 * backend area file implements exactly one of them. This file holds every
 * read through M3, the M4 writes and the M5 writes (M5.1 declares them all;
 * each wave 2 story builds its eero side).
 * Areas, and write methods, the eero backend has not built yet answer "not
 * available yet" (see composeBackend and partialArea).
 *
 * Writes take model-shaped inputs, apply the change, and return the changed
 * object as the next read would show it (or nothing when eero answers later,
 * e.g. a restart or a speed test). They never retry; the engine owns
 * confirmation, cache invalidation and the settle delay.
 */

import { BackendError } from "./errors";
import type * as M from "./model";

export { BackendError } from "./errors";

// ---------------------------------------------------------------------------
// Host contract

/**
 * Where the host keeps the session token (Electron safeStorage in the app
 * and CLI). Only the eero backend uses it; the token never leaves the
 * backend's process and is never returned by a command.
 */
export interface SecretStore {
  /** The saved token, or null. Deletes unreadable or plaintext files. */
  load(): Promise<string | null>;
  /** Saves when a real OS keychain exists; answers where it ended up. */
  save(token: string): Promise<M.SessionStorageKind>;
  clear(): Promise<void>;
  /** "keychain" when save would persist, else "memory". */
  storage(): Promise<M.SessionStorageKind>;
}

// ---------------------------------------------------------------------------
// Areas

/** Sign-in state as the backend sees it. The engine adds `backend`. */
export type AuthState = Omit<M.AuthStatus, "backend">;

export interface AuthBackend {
  status(): Promise<AuthState>;
  /** Sends a code to an email or E.164 phone; the session becomes pending. */
  start(login: string): Promise<void>;
  /** The session becomes signed in. A wrong code keeps it pending. */
  verify(code: string): Promise<void>;
  resend(): Promise<void>;
  /**
   * Signs in with an Amazon access token from the native OpenID+PKCE window.
   * Failed attempts must not overwrite a previous session.
   */
  amazonLogin(accessToken: string): Promise<void>;
  /** Clears the local session first, then tells eero, best effort. */
  logout(): Promise<void>;
}

/** Account push alert switches; eero wants both keys on every write. */
export type AccountPush = { networkOffline: boolean; nodeOffline: boolean };

/**
 * Account reads and writes. Writes answer once eero accepts them; core reads
 * `get` again for the result. The eero backend answers "not available yet"
 * until a live-tested source for each write is found (docs/eero-api/endpoints.md#20).
 */
export interface AccountBackend {
  get(): Promise<M.Account>;
  setName(name: string): Promise<void>;
  /** The new address stays unverified until `verifyEmail`. */
  setEmail(email: string): Promise<void>;
  verifyEmail(code: string): Promise<void>;
  /** E.164. Sends a code; the number stays unverified until `verifyPhone`. */
  setPhone(phone: string): Promise<void>;
  verifyPhone(code: string): Promise<void>;
  setConsents(marketingEmails: boolean): Promise<void>;
  setPush(push: AccountPush): Promise<void>;
  /** Deletes the account (`DELETE /2.2/account`). Cannot be undone; core signs out after. */
  remove(): Promise<void>;
}

export interface NetworkBackend {
  /** `selected` is filled in by core; backends may leave it false. */
  list(): Promise<M.NetworkSummary[]>;
  get(net: M.Id): Promise<M.Network>;
  /** `issues` are derived in core, so backends leave them out. */
  health(net: M.Id): Promise<Omit<M.NetworkHealth, "issues">>;
  permissions(net: M.Id): Promise<M.Permissions>;
  /** Reboots every eero (`POST {net}/reboot`). Answers once eero accepts it, not when the mesh is back. */
  restart(net: M.Id): Promise<void>;
  /** Deletes the network (`DELETE {net}`). Owner only; cannot be undone. */
  remove(net: M.Id): Promise<void>;
  /** The network's nickname (`nickname_label`); null clears it. For M6.9. */
  setNickname(net: M.Id, nickname: string | null): Promise<void>;
}

export type SpeedTestQuery = { from: M.Iso; to: M.Iso; limit: number };

export interface InternetBackend {
  /** `planMbps` comes from app settings and `verdict` is built in core; backends omit both. */
  get(net: M.Id): Promise<Omit<M.Internet, "planMbps" | "verdict">>;
  /** Newest first. `rating` is computed in core, so backends leave it null. */
  speedTests(net: M.Id, q: SpeedTestQuery): Promise<M.SpeedTest[]>;
  /** Starts a speed test (`POST {net}/speedtest`, 202). The result shows in `speedTests` about a minute later (demo: at once). */
  runSpeedTest(net: M.Id): Promise<void>;
}

export type UsageQuery = {
  scope: M.UsageScope;
  /** Required for eero, device and profile scopes; null for network and guest. */
  id: M.Id | null;
  range: M.UsageRange;
  from: M.Iso;
  to: M.Iso;
  cadence: M.UsageCadence;
  /** IANA zone the buckets are aligned to. */
  timezone: string;
};

export type BreakdownQuery = {
  by: M.UsageBreakdown["by"];
  range: M.UsageRange;
  from: M.Iso;
  to: M.Iso;
};

export interface UsageBackend {
  series(net: M.Id, q: UsageQuery): Promise<M.UsageSeries>;
  /** Rows unsorted and without filtering; core sorts and computes shares. */
  breakdown(net: M.Id, q: BreakdownQuery): Promise<M.UsageBreakdown>;
}

export interface EeroBackend {
  /** `hop` and `meshQuality` are filled in by core; backends may leave them null. eero Built-in devices (kind `builtin`) come after the eeros. */
  list(net: M.Id): Promise<M.Eero[]>;
  get(net: M.Id, eero: M.Id): Promise<M.Eero>;
  /** Ethernet ports, with attached devices or eeros joined by MAC. Empty list when eero reports none. */
  ports(net: M.Id, eero: M.Id): Promise<M.EeroPorts>;
  /** Installed versions, newest first, at most `limit`; the running one has `current: true`. */
  firmwareHistory(net: M.Id, eero: M.Id, limit: number): Promise<M.FirmwareEntry[]>;
  /** Sets the room name (`location`). */
  rename(net: M.Id, eero: M.Id, location: string): Promise<M.Eero>;
  /** Blinks the status light for `seconds` (default 30) (`led_cycle`). */
  find(net: M.Id, eero: M.Id, seconds?: number): Promise<void>;
  /** Status light on or off and brightness 0 to 100, through `resources.led_action` (form body). */
  setLed(net: M.Id, eero: M.Id, led: LedInput): Promise<M.Eero>;
  /** Beacon only; other eeros fail with `eero_error`. */
  setNightlight(net: M.Id, eero: M.Id, nightlight: M.Nightlight): Promise<M.Eero>;
  /** Reboots one eero (`POST {eero}/reboot`). */
  restart(net: M.Id, eero: M.Id): Promise<void>;
  /** One action on one port (`POST {eero}/ports/{n}/action`); core checks it is in the port's `actions[]`. Returns the ports as the next read shows them. */
  portAction(net: M.Id, eero: M.Id, port: number, action: M.PortAction): Promise<M.EeroPorts>;
  /** Removes the eero from the network (`DELETE {eero}`). Core refuses the gateway unless it is the only eero. */
  remove(net: M.Id, eero: M.Id): Promise<void>;
  /** Placement test (`POST`, then `GET /2.3/networks/{id}/placement_test/{serial}`). */
  placementTest(net: M.Id, eero: M.Id): Promise<M.PlacementResult>;
}

/** Either or both. */
export type LedInput = { on?: boolean; brightness?: number };

export interface DeviceBackend {
  /** Includes blocked devices (merged from the blacklist). */
  list(net: M.Id): Promise<M.Device[]>;
  get(net: M.Id, device: M.Id): Promise<M.Device>;
  /** Asks eero for a burst of live rates. Core enforces once a minute. */
  requestBurst(net: M.Id): Promise<M.BurstResult>;
  // Writes go to `/2.3/networks/{id}/devices/{mac}` (2.2 answers 200 and drops them).
  setPaused(net: M.Id, device: M.Id, paused: boolean): Promise<M.Device>;
  /** null clears the nickname, so eero's own name shows again. */
  rename(net: M.Id, device: M.Id, nickname: string | null): Promise<M.Device>;
  setType(net: M.Id, device: M.Id, type: M.DeviceType): Promise<M.Device>;
  /** null: out of every profile. eero keeps such devices in its `default: true` profile, which the model shows as Unassigned. */
  setProfile(net: M.Id, device: M.Id, profile: M.Id | null): Promise<M.Device>;
  /** Block (`POST {net}/blacklist`) or unblock (`DELETE {net}/blacklist/{mac}`). */
  setBlocked(net: M.Id, device: M.Id, blocked: boolean): Promise<M.Device>;
}

export interface ProfileBackend {
  /** `nextChange` is computed in core; backends may leave it null. */
  list(net: M.Id): Promise<M.Profile[]>;
  get(net: M.Id, profile: M.Id): Promise<M.Profile>;
  /** A new profile holding `deviceIds` (moved out of their old profiles). */
  create(net: M.Id, input: ProfileInput): Promise<M.Profile>;
  rename(net: M.Id, profile: M.Id, name: string): Promise<M.Profile>;
  setPaused(net: M.Id, profile: M.Id, paused: boolean): Promise<M.Profile>;
  /** Exactly these devices: listed ones move in, others leave to Unassigned. */
  setDevices(net: M.Id, profile: M.Id, deviceIds: M.Id[]): Promise<M.Profile>;
  /** Its devices become Unassigned. */
  remove(net: M.Id, profile: M.Id): Promise<void>;
  /** Pauses or resumes the Unassigned devices (eero's `default: true` profile). */
  setUnassignedPaused(net: M.Id, paused: boolean): Promise<void>;
  /** Schedules are written through `{profile}/schedules`; the GET there is a 404, so reads come from the profile. */
  addSchedule(net: M.Id, profile: M.Id, schedule: M.ScheduleInput): Promise<M.Schedule>;
  updateSchedule(net: M.Id, profile: M.Id, schedule: M.Id, input: M.ScheduleInput): Promise<M.Schedule>;
  removeSchedule(net: M.Id, profile: M.Id, schedule: M.Id): Promise<void>;
}

export type ProfileInput = { name: string; deviceIds: M.Id[] };

/** A reservation to add: core resolves the device to its MAC and validates the address. */
export type ReservationInput = { mac: string; ip: string; description: string };

/** A forward to add, on the device's reserved address (core adds the reservation first when there is none). */
export type ForwardInput = {
  ip: string;
  externalPort: string;
  internalPort: string;
  protocol: M.Protocol;
  description: string;
  enabled: boolean;
};

export type PinholeInput = { deviceId: M.Id; protocol: M.Protocol; port: string };

export interface RoutingBackend {
  /** Reservations, forwards and pinholes joined to devices, plus the LAN map. */
  get(net: M.Id): Promise<M.Routing>;
  // M5 writes. Each returns the changed row as the next `get` shows it.
  addReservation(net: M.Id, input: ReservationInput): Promise<M.Reservation>;
  updateReservation(net: M.Id, reservation: M.Id, input: Partial<Omit<ReservationInput, "mac">>): Promise<M.Reservation>;
  /** `removeForwards`: also delete the forwards on that address (`?delete_forwards=`). */
  removeReservation(net: M.Id, reservation: M.Id, removeForwards: boolean): Promise<void>;
  addForward(net: M.Id, input: ForwardInput): Promise<M.Forward>;
  updateForward(net: M.Id, forward: M.Id, input: Partial<ForwardInput>): Promise<M.Forward>;
  removeForward(net: M.Id, forward: M.Id): Promise<void>;
  addPinhole(net: M.Id, input: PinholeInput): Promise<M.Pinhole>;
  removePinhole(net: M.Id, pinhole: M.Id): Promise<void>;
}

export interface UpdatesBackend {
  get(net: M.Id): Promise<M.Updates>;
  /** Release notes of the target (or current) eeroOS; null when eero names no manifest. */
  notes(net: M.Id): Promise<M.ReleaseNotes | null>;
  /** Installs the target eeroOS now (`POST {net}/updates`); every eero restarts. */
  install(net: M.Id): Promise<void>;
  /** 0 to 23, network time (`POST {net}/updates/preferred_update_hour`). */
  setPreferredHour(net: M.Id, hour: number): Promise<M.Updates>;
}

export type EventChunk = { events: M.NetworkEvent[]; nextCursor: string | null };

export interface EventsBackend {
  /** One page, newest first. `cursor` is the `nextCursor` of the previous page. */
  list(net: M.Id, cursor: string | null): Promise<EventChunk>;
}

/** A Wi-Fi name and its password (null: an open network). Sensitive: only the share and reveal commands read it. */
export type WifiCredentials = { ssid: string; password: string | null };

export interface GuestBackend {
  /** No password, only `hasPassword`; `online` and `deviceIds` come from the devices on the guest network. */
  get(net: M.Id): Promise<M.GuestNetwork>;
  /** Sensitive. Core builds the `WIFI:` payload. */
  credentials(net: M.Id): Promise<WifiCredentials>;
  setEnabled(net: M.Id, enabled: boolean): Promise<M.GuestNetwork>;
  rename(net: M.Id, name: string): Promise<M.GuestNetwork>;
  /** null makes the guest network open. */
  setPassword(net: M.Id, password: string | null): Promise<M.GuestNetwork>;
}

export interface WifiBackend {
  /** No password. Bands merge every eero's radios; clients come from the devices. */
  get(net: M.Id): Promise<M.WifiSettings>;
  /** Sensitive. Core builds the `WIFI:` payload. */
  credentials(net: M.Id): Promise<WifiCredentials>;
  /** The SSID, which is also the network's name. */
  setName(net: M.Id, ssid: string): Promise<M.WifiSettings>;
  setPassword(net: M.Id, password: string): Promise<M.WifiSettings>;
  /** Only the bands given change (`PUT {net}/wpa3_per_band`). */
  setSecurity(net: M.Id, security: Partial<Record<M.WirelessBand, M.Security>>): Promise<M.WifiSettings>;
  /** 2.4 GHz only on (`PUT {net}/temporary_flags/hide_5g`) or off (`DELETE`). eero sets the expiry. */
  setHide5g(net: M.Id, enabled: boolean): Promise<M.WifiSettings>;
}

export type DnsInput = { mode: "automatic" | "custom"; servers: string[]; ipv6Servers: string[]; caching: boolean | null };
/** `custom` needs every address; core validates the range. */
export type DhcpInput = { mode: "automatic" | "custom"; subnetIp: string | null; subnetMask: string | null; startIp: string | null; endIp: string | null };
/** The PPPoE password is write-only: never cached or returned. */
export type WanInput = {
  mode: M.NetworkSettings["wan"]["mode"];
  static: { ip: string; mask: string; router: string } | null;
  pppoe: { username: string; password: string } | null;
  vlan: number | null;
};
export type PowerSavingInput = { enabled?: boolean; scheduleEnabled?: boolean };
export type ThreadInput = { enabled?: boolean; credentialSync?: boolean };
export type MloMode = NonNullable<M.NetworkSettings["mlo"]>;

/**
 * Settings writes (M5.2, M5.3). Each returns `NetworkSettings` as the next
 * `get` shows it, except schedules (the schedule) and Thread reset (nothing).
 * Most go through `PUT {net}/settings` and restart the mesh; core decides
 * which via `settings.impact`, the backend only sends.
 */
export interface SettingsBackend {
  /** Thread secrets are never part of this result. */
  get(net: M.Id): Promise<M.NetworkSettings>;
  /** Sensitive: the Thread network key and friends. Null when the network has no Thread. */
  threadCredentials(net: M.Id): Promise<M.ThreadCredentials | null>;
  setDns(net: M.Id, dns: DnsInput): Promise<M.NetworkSettings>;
  setDhcp(net: M.Id, dhcp: DhcpInput): Promise<M.NetworkSettings>;
  setIpv6(net: M.Id, enabled: boolean): Promise<M.NetworkSettings>;
  setWan(net: M.Id, wan: WanInput): Promise<M.NetworkSettings>;
  setConnectionMode(net: M.Id, mode: M.ConnectionMode): Promise<M.NetworkSettings>;
  setNatRandomization(net: M.Id, randomized: boolean): Promise<M.NetworkSettings>;
  setUpnp(net: M.Id, enabled: boolean): Promise<M.NetworkSettings>;
  setSqm(net: M.Id, enabled: boolean): Promise<M.NetworkSettings>;
  setBandSteering(net: M.Id, enabled: boolean): Promise<M.NetworkSettings>;
  setFastTransition(net: M.Id, enabled: boolean): Promise<M.NetworkSettings>;
  setMlo(net: M.Id, mode: MloMode): Promise<M.NetworkSettings>;
  setPowerSaving(net: M.Id, input: PowerSavingInput): Promise<M.NetworkSettings>;
  addPowerSavingSchedule(net: M.Id, schedule: M.ScheduleInput): Promise<M.Schedule>;
  updatePowerSavingSchedule(net: M.Id, schedule: M.Id, input: M.ScheduleInput): Promise<M.Schedule>;
  removePowerSavingSchedule(net: M.Id, schedule: M.Id): Promise<void>;
  setLegacyMode(net: M.Id, enabled: boolean): Promise<M.NetworkSettings>;
  /** IANA zone. */
  setTimezone(net: M.Id, timezone: string): Promise<M.NetworkSettings>;
  setSimpleSetup(net: M.Id, enabled: boolean): Promise<M.NetworkSettings>;
  setThread(net: M.Id, input: ThreadInput): Promise<M.NetworkSettings>;
  /** New Thread credentials; every Thread device must re-pair. */
  resetThread(net: M.Id): Promise<void>;
}

export type DiagnosticsInput = { symptom: DiagnosticsSymptom | null; deviceId: M.Id | null };
export type DiagnosticsSymptom = "internet_slow" | "internet_offline" | "connection_drops" | "eeros_red";

export interface DiagnosticsBackend {
  /** The last cloud diagnostics run (`GET {net}/diagnostics`). The health check is built in core. */
  latest(net: M.Id): Promise<M.DiagnosticsResult>;
  /** Support contacts; `supportId` comes from the account in core. */
  support(net: M.Id): Promise<Omit<M.SupportInfo, "supportId">>;
  /** Starts a cloud run (`POST {net}/diagnostics`) and answers with its result once eero has one. */
  run(net: M.Id, input: DiagnosticsInput): Promise<M.DiagnosticsResult>;
  /** `/2.4/` coverage scan, a read the eero side builds in M5.8. */
  coverageScan(net: M.Id): Promise<M.CoverageScan>;
  /** `/2.4/` Wi-Fi generation scan, a read the eero side builds in M5.8. */
  upgradeReport(net: M.Id): Promise<M.UpgradeReport>;
}

export type InviteInput = { nickname: string | null; email: string | null };
export type InviteCreated = { invite: M.Invite; inviteUrl: string; expiresAt: M.Iso | null };
/** Exactly one of `email` or `phone`: where eero sends the transfer. */
export type TransferInput = { name: string; email: string | null; phone: string | null };

export interface AdminsBackend {
  /** Seats are counted in core. Invites a role cannot read are an empty list, not an error. */
  list(net: M.Id): Promise<Pick<M.AdminList, "admins" | "invites">>;
  createInvite(net: M.Id, input: InviteInput): Promise<InviteCreated>;
  cancelInvite(net: M.Id, invite: M.Id): Promise<void>;
  remove(net: M.Id, admin: M.Id): Promise<void>;
  /** Hands the network to someone else (`POST {net}/transfer`). Owner only; cannot be undone. */
  transfer(net: M.Id, input: TransferInput): Promise<void>;
}

export interface IntegrationsBackend {
  get(net: M.Id): Promise<M.Integrations>;
  setBuiltin(net: M.Id, enabled: boolean): Promise<M.Integrations>;
  /** Starts Zigbee discovery on the Smart Home Hub; pairing finishes in the Alexa app. */
  discoverZigbee(net: M.Id): Promise<void>;
  unlinkAmazon(net: M.Id): Promise<M.Integrations>;
}

export type NotificationChunk = { notifications: M.Notification[]; nextCursor: string | null };

export interface NotificationsBackend {
  /** One page, newest first. `cursor` is the `nextCursor` of the previous page. */
  list(net: M.Id, cursor: string | null): Promise<NotificationChunk>;
  /** eero's own "has unread" flag. */
  unread(net: M.Id): Promise<boolean>;
  /** eero's notification switches, keys as sent (`device.new`). Push and desktop choices are added in core. */
  settings(net: M.Id): Promise<Record<string, boolean>>;
  /** Network-wide: eero keeps only `has_unread`, no per-row read flag. */
  markRead(net: M.Id): Promise<void>;
  /** Saves eero's switches (`PUT {net}/notifications` with the full merged map, keys as sent). Returns the map as the next read shows it. */
  setSettings(net: M.Id, settings: Record<string, boolean>): Promise<Record<string, boolean>>;
}

// ---------------------------------------------------------------------------
// The whole backend

export interface BackendAreas {
  auth: AuthBackend;
  account: AccountBackend;
  network: NetworkBackend;
  internet: InternetBackend;
  usage: UsageBackend;
  eero: EeroBackend;
  device: DeviceBackend;
  profile: ProfileBackend;
  events: EventsBackend;
  routing: RoutingBackend;
  updates: UpdatesBackend;
  guest: GuestBackend;
  wifi: WifiBackend;
  settings: SettingsBackend;
  diagnostics: DiagnosticsBackend;
  admins: AdminsBackend;
  integrations: IntegrationsBackend;
  notifications: NotificationsBackend;
}

export type AreaName = keyof BackendAreas;

/**
 * The write methods of each area (M4 and M5), plus the M5 reads whose eero
 * side lands with their story (coverage scan, upgrade report, placement
 * test). The eero backend may leave any of them out until its story builds
 * it (see `EeroArea` and `partialArea`); the demo backend implements them all.
 */
export const WRITE_METHODS = {
  account: ["setName", "setEmail", "verifyEmail", "setPhone", "verifyPhone", "setConsents", "setPush", "remove"],
  network: ["restart", "remove", "setNickname"],
  internet: ["runSpeedTest"],
  eero: ["rename", "find", "setLed", "setNightlight", "restart", "portAction", "remove", "placementTest"],
  device: ["setPaused", "rename", "setType", "setProfile", "setBlocked"],
  profile: ["create", "rename", "setPaused", "setDevices", "remove", "setUnassignedPaused", "addSchedule", "updateSchedule", "removeSchedule"],
  routing: ["addReservation", "updateReservation", "removeReservation", "addForward", "updateForward", "removeForward", "addPinhole", "removePinhole"],
  updates: ["install", "setPreferredHour"],
  guest: ["setEnabled", "rename", "setPassword"],
  wifi: ["setName", "setPassword", "setSecurity", "setHide5g"],
  settings: [
    "setDns",
    "setDhcp",
    "setIpv6",
    "setWan",
    "setConnectionMode",
    "setNatRandomization",
    "setUpnp",
    "setSqm",
    "setBandSteering",
    "setFastTransition",
    "setMlo",
    "setPowerSaving",
    "addPowerSavingSchedule",
    "updatePowerSavingSchedule",
    "removePowerSavingSchedule",
    "setLegacyMode",
    "setTimezone",
    "setSimpleSetup",
    "setThread",
    "resetThread",
  ],
  diagnostics: ["run", "coverageScan", "upgradeReport"],
  admins: ["createInvite", "cancelInvite", "remove", "transfer"],
  integrations: ["setBuiltin", "discoverZigbee", "unlinkAmazon"],
  notifications: ["markRead", "setSettings"],
} as const satisfies { [K in AreaName]?: readonly (keyof BackendAreas[K])[] };

export type WriteMethod<K extends AreaName> = K extends keyof typeof WRITE_METHODS ? (typeof WRITE_METHODS)[K][number] : never;

/** An area with every read and any subset of its writes. */
export type PartialWrites<K extends AreaName> = Omit<BackendAreas[K], WriteMethod<K>> & Partial<Pick<BackendAreas[K], Extract<WriteMethod<K>, keyof BackendAreas[K]>>>;

export const AREA_NAMES: readonly AreaName[] = [
  "auth",
  "account",
  "network",
  "internet",
  "usage",
  "eero",
  "device",
  "profile",
  "events",
  "routing",
  "updates",
  "guest",
  "wifi",
  "settings",
  "diagnostics",
  "admins",
  "integrations",
  "notifications",
];

export interface Backend extends BackendAreas {
  readonly kind: M.BackendKind;
  /** True when the eero backend talks to the local fake eero server (an injected origin). Unset for live and demo. */
  readonly fake?: true;
}

/** The rejection an unbuilt method gives: `eero_error` "<area>.<method> is not available in the <kind> backend yet". */
export function notAvailable(kind: M.BackendKind, area: AreaName, method: string): Promise<never> {
  return Promise.reject(new BackendError("eero_error", `${area}.${method} is not available in the ${kind} backend yet.`));
}

/**
 * An area whose every method throws `eero_error` "not available yet". Used to
 * fill areas that a backend does not implement yet, so the engine still runs.
 */
export function unimplementedArea<K extends AreaName>(kind: M.BackendKind, area: K): BackendAreas[K] {
  return new Proxy({} as BackendAreas[K], {
    get(_target, method) {
      if (typeof method !== "string") return undefined;
      return () => notAvailable(kind, area, method);
    },
  });
}

/**
 * An area with some writes built: any write in WRITE_METHODS that `impl`
 * lacks answers "not available yet". The eero backend wraps every area in it, so an M4 write
 * lands one method at a time without the rest failing typecheck.
 */
export function partialArea<K extends AreaName>(kind: M.BackendKind, area: K, impl: PartialWrites<K>): BackendAreas[K] {
  const writes: readonly string[] = (WRITE_METHODS as Partial<Record<AreaName, readonly string[]>>)[area] ?? [];
  return new Proxy(impl as BackendAreas[K], {
    get(target, method, receiver) {
      const value = Reflect.get(target, method, receiver);
      // Only declared writes fall back; anything else stays as the area has it.
      if (value !== undefined || typeof method !== "string" || !writes.includes(method)) return value;
      return () => notAvailable(kind, area, method);
    },
  });
}

/** Builds a Backend from the areas given (writes optional, see `partialArea`), filling the rest with `unimplementedArea`. */
export function composeBackend(kind: M.BackendKind, areas: { [K in AreaName]?: PartialWrites<K> }): Backend {
  const full = { kind } as { kind: M.BackendKind } & Record<AreaName, unknown>;
  for (const name of AREA_NAMES) {
    const given = areas[name] as PartialWrites<AreaName> | undefined;
    full[name] = given ? partialArea(kind, name, given) : unimplementedArea(kind, name);
  }
  return full as Backend;
}
