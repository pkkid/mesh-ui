/**
 * The demo backend: every M1 read in `Backend` answered from an in-memory
 * copy of the fixtures. It never opens a socket, so `--demo` works offline.
 * See docs/architecture/backends.md (demo backend).
 *
 * Derived fields come from the lists, so they always agree: a network's eero
 * count and devices online, an eero's clients, a profile's devices and state,
 * health per eero, port attachments (from devices' wired ports), the current
 * firmware and forwards per reservation (leased addresses are counted in core). Usage is generated per device and hour from its typical
 * daily traffic, and every scope (network, eero, profile, guest, device) and
 * breakdown sums the same per-device hours, so totals add up everywhere.
 * Guests are the devices on the guest SSID, Wi-Fi bands merge the eeros'
 * radios, and settings take DHCP, WAN and the ISP's DNS from the LAN map and
 * internet fixtures.
 *
 * The `slow` and `errors` scenarios wrap every area but `auth`: reads and
 * writes wait `slowMs` first, or fail with `eero_error`, so loading and error
 * states can be shown while sign-in and scenario switching keep working.
 *
 * Writes (M4) change the in-memory fixtures, so pause, rename, block or guest
 * off show in the next read; derived fields (profile state, counts, rates)
 * follow on their own. Restarts show `updating` for RESTART_MS, then the old
 * status. Device writes on "Flaky Plug" fail, for error states.
 * `setScenario` rebuilds the fixtures, which undoes every write.
 */

import { AREA_NAMES, type Backend, type BackendAreas, type BreakdownQuery, type EventChunk, type NotificationChunk, type SpeedTestQuery, type UsageQuery, BackendError } from "../backend";
import { deviceCategory } from "../eero/map/device";
import type * as M from "../model";
import { createFixtures, type DemoFixtures, RELEASE_NOTES, type DeviceUsage, type NetworkData, type UsagePattern } from "./fixtures";
import { applyScenario, type ReadMode, type ScenarioName } from "./scenario";

export type DemoBackendOptions = {
  /** Epoch ms; injectable so tests are deterministic. */
  clock?: () => number;
  /** Seeds the filler events and the live-rate walk. */
  seed?: number;
  scenario?: ScenarioName;
  /** How long each read waits in the `slow` scenario, in ms. */
  slowMs?: number;
};

export interface DemoBackend extends Backend {
  readonly kind: "demo";
  scenario(): ScenarioName;
  /** Resets to pristine fixtures, then applies the scenario. */
  setScenario(name: ScenarioName): void;
}

export const isDemoBackend = (b: Backend): b is DemoBackend => b.kind === "demo" && typeof (b as Partial<DemoBackend>).setScenario === "function";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export const EVENT_PAGE_SIZE = 50;
export const NOTIFICATION_PAGE_SIZE = 50;
/** The `slow` scenario's delay per read. */
export const SLOW_READ_MS = 1_500;
const BURST_LEAD_MS = 3_000;
/** How long the demo's 2.4 GHz only window lasts (eero picks its own). */
export const HIDE_5G_MS = 20 * 60_000;
/** How long a demo restart shows `updating` before the eero or network is back (eero takes minutes). */
export const RESTART_MS = 5_000;
/** Device writes on this fixture fail with `eero_error`, so error states can be shown. */
export const FLAKY_DEVICE = "Flaky Plug";
const WRONG_CODE = "111111";

// ---------------------------------------------------------------------------
// Time zones

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Offset of `tz` from UTC at `ms`, in ms (Los Angeles in winter is -8 h). */
export function tzOffset(ms: number, tz: string): number {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
    formatters.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const local = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return local - Math.floor(ms / 1000) * 1000;
}

const floorTo = (ms: number, unit: number, tz: string) => {
  const off = tzOffset(ms, tz);
  const start = Math.floor((ms + off) / unit) * unit - off;
  // Across a DST change the offset at the start can differ by an hour.
  return start - (tzOffset(start, tz) - off);
};
/** Start of the local hour containing `ms`. */
export const hourStart = (ms: number, tz: string) => floorTo(ms, HOUR, tz);
/** Local midnight on the day containing `ms`. */
export const dayStart = (ms: number, tz: string) => floorTo(ms, DAY, tz);
const nextDay = (ms: number, tz: string) => dayStart(ms + DAY + 2 * HOUR, tz);

// ---------------------------------------------------------------------------
// Usage generation

/** Relative traffic per local hour, 0 to 23. Normalised below. */
const PATTERNS: Record<UsagePattern, number[]> = {
  evening: [3, 1, 0.5, 0.3, 0.3, 0.3, 0.5, 1, 1, 1, 1, 1.5, 2, 2, 2, 2.5, 3, 4, 6, 8, 9, 9, 7, 5],
  work: [0.3, 0.2, 0.1, 0.1, 0.1, 0.2, 0.5, 2, 5, 7, 8, 8, 6, 7, 8, 8, 7, 5, 3, 2, 1.5, 1, 0.6, 0.4],
  personal: [0.5, 0.2, 0.1, 0.1, 0.1, 0.4, 2, 4, 3, 2, 2, 2, 3, 2, 2, 2, 2, 3, 4, 5, 5, 4, 2.5, 1],
  kid: [0, 0, 0, 0, 0, 0, 0, 1, 1, 0.5, 0.5, 0.5, 1, 1, 1, 3, 4, 5, 6, 6, 5, 2, 0, 0],
  steady: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
};
const WEIGHTS = Object.fromEntries(
  Object.entries(PATTERNS).map(([k, v]) => {
    const sum = v.reduce((a, b) => a + b, 0);
    return [k, v.map((x) => x / sum)];
  }),
) as Record<UsagePattern, number[]>;

/** FNV-1a: a stable hash of a string into [0, 1). */
function hash01(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 4294967296;
}

type Bytes = { down: number; up: number };

/**
 * Bytes a device moved in [start, start + 1 h). Pure in its inputs, so every
 * scope that sums these agrees. Only the elapsed part of the current hour
 * counts, and nothing before first seen or after last active.
 */
function deviceHour(d: M.Device, u: DeviceUsage | undefined, start: number, now: number, tz: string): Bytes {
  if (!u || u.dailyBytes <= 0 || d.blocked) return { down: 0, up: 0 };
  const from = Math.max(start, d.firstSeen ? Date.parse(d.firstSeen) : start);
  const until = Math.min(start + HOUR, now, d.connected ? now : d.lastActive ? Date.parse(d.lastActive) : now);
  if (until <= from) return { down: 0, up: 0 };
  const localHour = new Date(start + tzOffset(start, tz)).getUTCHours();
  const localDay = new Date(start + tzOffset(start, tz)).toISOString().slice(0, 10);
  const dayFactor = 0.8 + 0.4 * hash01(`${d.id}|${localDay}`);
  const total = u.dailyBytes * (WEIGHTS[u.pattern][localHour] ?? 0) * dayFactor * ((until - from) / HOUR);
  const up = Math.round(total * u.upShare);
  return { down: Math.round(total) - up, up };
}

function sumHours(devices: M.Device[], data: NetworkData, from: number, to: number, now: number, tz: string): Bytes {
  const out = { down: 0, up: 0 };
  for (let h = hourStart(from, tz); h < to; h += HOUR) {
    for (const d of devices) {
      const b = deviceHour(d, data.usage[d.id], h, now, tz);
      out.down += b.down;
      out.up += b.up;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The backend

const clone = <T>(v: T): T => structuredClone(v);

/** Dotted mask for a prefix length: 22 gives 255.255.252.0. */
function prefixMask(bits: number): string {
  const n = bits <= 0 ? 0 : (0xffffffff << (32 - Math.min(32, bits))) >>> 0;
  return [24, 16, 8, 0].map((s) => (n >>> s) & 0xff).join(".");
}

const WIRELESS: M.WirelessBand[] = ["2.4", "5", "6"];
const uniqueSorted = (xs: (number | null)[]) => [...new Set(xs.filter((x): x is number => x !== null))].sort((a, b) => a - b);

function notFound(what: string): never {
  throw new BackendError("eero_error", `No ${what} with that id.`, { status: 404 });
}

export function createDemoBackend(opts: DemoBackendOptions = {}): DemoBackend {
  const now = opts.clock ?? Date.now;
  const seed = opts.seed ?? 42;

  let scenario: ScenarioName = opts.scenario ?? "default";
  let fx: DemoFixtures;
  let auth: { signedIn: boolean; pending: boolean; login: string | null };
  /** Typical rates per device id, and the walk factor applied on top. */
  let typical: Map<M.Id, M.DeviceRates>;
  let walk: Map<M.Id, number>;
  let burstStep = 0;
  /** Ids for profiles and schedules the demo creates. */
  let writeSeq = 0;
  /** Whether a device was connected before it was blocked, so unblocking puts it back. */
  let beforeBlock: Map<M.Id, boolean>;
  /** Restarts in progress: the status to go back to, and when. Keyed by eero id or `net:<id>`. */
  let restarting: Map<string, { until: number; status: M.Status }>;
  let flaky: Set<M.Id>;
  let reads: ReadMode = "normal";
  const slowMs = opts.slowMs ?? SLOW_READ_MS;

  const reset = (name: ScenarioName) => {
    scenario = name;
    fx = createFixtures(now(), seed);
    const effect = applyScenario(fx, name, now());
    auth = { signedIn: effect.signedIn, pending: false, login: effect.signedIn ? fx.login : null };
    reads = effect.reads;
    typical = new Map(fx.networks.flatMap((n) => n.devices.flatMap((d) => (d.rates ? [[d.id, d.rates] as const] : []))));
    walk = new Map();
    burstStep = 0;
    writeSeq = 0;
    beforeBlock = new Map();
    restarting = new Map();
    flaky = new Set(fx.networks.flatMap((n) => n.devices.filter((d) => d.name === FLAKY_DEVICE).map((d) => d.id)));
  };
  reset(scenario);

  const signedIn = () => {
    if (!auth.signedIn) throw new BackendError("not_signed_in", "Not signed in to the demo account.");
  };

  const net = (id: M.Id): NetworkData => {
    signedIn();
    const data = fx.networks.find((n) => n.network.id === id) ?? notFound("network");
    settleRestarts(data);
    return data;
  };

  /** Brings back eeros (and the network) whose restart has run its course. */
  const settleRestarts = (data: NetworkData) => {
    if (!restarting.size) return;
    const t = now();
    for (const e of data.eeros) {
      const r = restarting.get(e.id);
      if (r && r.until <= t) {
        e.status = r.status;
        restarting.delete(e.id);
      }
    }
    const r = restarting.get(`net:${data.network.id}`);
    if (r && r.until <= t) {
      data.network.status = r.status;
      restarting.delete(`net:${data.network.id}`);
    }
  };

  const tzOf = (data: NetworkData) => data.network.timezone ?? "UTC";

  // --- derived views ------------------------------------------------------

  const rates = (d: M.Device): M.DeviceRates | null => {
    const base = typical.get(d.id);
    if (!base || !d.connected || d.paused || d.blocked) return null;
    const f = walk.get(d.id) ?? 1;
    const r1 = (n: number) => Math.round(n * f * 10) / 10;
    return { downMbps: r1(base.downMbps), upMbps: r1(base.upMbps), at: new Date(now()).toISOString() };
  };

  const deviceView = (d: M.Device): M.Device => ({ ...clone(d), rates: rates(d), reservation: null });

  const eeroView = (data: NetworkData, e: NetworkData["eeros"][number]): M.Eero => {
    const on = data.devices.filter((d) => d.connected && d.eeroId === e.id);
    const wired = on.filter((d) => d.band === "wired").length;
    return {
      ...clone(e),
      clients: { total: on.length, wired, wireless: on.length - wired },
      radios: e.radios.map((r) => ({ ...r, clients: e.status === "offline" ? null : on.filter((d) => d.band === r.band).length })),
    };
  };

  const profileView = (data: NetworkData, p: NetworkData["profiles"][number]): M.Profile => {
    const devices = data.devices.filter((d) => d.profileId === p.id);
    return {
      id: p.id,
      name: p.name,
      state: p.paused ? "paused" : p.schedules.some((s) => s.enabled) ? "scheduled" : "active",
      paused: p.paused,
      deviceIds: devices.map((d) => d.id),
      devicesOnline: devices.filter((d) => d.connected).length,
      schedules: clone(p.schedules),
      nextChange: null,
    };
  };

  const eeroIn = (data: NetworkData, eeroId: M.Id) => data.eeros.find((x) => x.id === eeroId) ?? notFound("eero");

  /** Ports with status, speed and attachment from the devices wired to them. */
  const portsView = (data: NetworkData, eeroId: M.Id): M.EeroPorts => {
    const e = eeroIn(data, eeroId);
    const up = e.status !== "offline";
    const wanUp = up && data.internet.status === "online";
    const ports = (data.ports[e.id] ?? []).map((p): M.EeroPort => {
      const d = data.devices.find((x) => x.connected && x.wiredPort?.eeroId === e.id && x.wiredPort.port === p.number);
      const live = p.isWan ? wanUp : up && !!d;
      const speed = p.isWan ? (data.internet.gateway?.eeroId === e.id ? data.internet.gateway.wanPortSpeedMbps : null) : (d?.wiredPort?.speedMbps ?? null);
      return {
        ...clone(p),
        status: live ? "up" : "down",
        speedMbps: live ? speed : null,
        attached: d && up ? { deviceId: d.id, eeroId: null, name: d.name } : null,
      };
    });
    return { eeroId: e.id, ports };
  };

  const summary = (data: NetworkData): M.NetworkSummary => {
    const n = data.network;
    return {
      id: n.id,
      name: n.name,
      nickname: n.nickname,
      role: n.role,
      status: n.status,
      eeroCount: data.eeros.length,
      devicesOnline: data.devices.filter((d) => d.connected).length,
      isp: data.internet.isp.name,
      updateAvailable: data.eeros.some((e) => e.updateAvailable),
      lastSeen: n.lastSeen,
      selected: false,
    };
  };

  const guestView = (data: NetworkData): M.GuestNetwork => {
    const guests = data.devices.filter((d) => d.ssid === "guest");
    return {
      enabled: data.guest.enabled,
      name: data.guest.name,
      hasPassword: data.guest.password !== null,
      online: data.guest.enabled ? guests.filter((d) => d.connected).length : 0,
      deviceIds: guests.map((d) => d.id),
      security: clone(data.guest.security),
    };
  };

  /** Bands every eero radio offers, with channels and widths merged and clients from the devices. */
  const wifiView = (data: NetworkData): M.WifiSettings => {
    const on = data.devices.filter((d) => d.connected && d.band !== null && d.band !== "wired");
    const bands = WIRELESS.flatMap((band) => {
      const radios = data.eeros.flatMap((e) => e.radios.filter((r) => r.band === band));
      if (!radios.length) return [];
      return [{
        band,
        // A band is on while any eero is broadcasting on it (offline eeros report no channel).
        on: radios.some((r) => r.channel !== null),
        clients: on.filter((d) => d.band === band).length,
        widthsMhz: uniqueSorted(radios.map((r) => r.widthMhz)),
        channels: uniqueSorted(radios.map((r) => r.channel)),
      }];
    });
    return {
      ssid: data.network.name,
      hasPassword: true,
      security: clone(data.wifi.security),
      wpa2OnlyDevices: [...data.wifi.wpa2OnlyDevices],
      bands,
      // eero ends the 2.4 GHz only window on its own.
      hide5g: data.wifi.hide5g.active && data.wifi.hide5g.expiresAt !== null && Date.parse(data.wifi.hide5g.expiresAt) <= now() ? { active: false, expiresAt: null } : clone(data.wifi.hide5g),
      wirelessClients: on.length,
    };
  };

  const settingsView = (data: NetworkData): M.NetworkSettings => {
    const s = data.settings;
    const lan = data.lan;
    const bridged = data.network.connectionMode === "bridged" || lan === null;
    const [subnetIp, bits] = lan ? (lan.subnet.split("/") as [string, string]) : [null, null];
    return {
      ...clone(s),
      dns: { ...clone(s.dns), ispServers: s.dns.mode === "automatic" ? [...data.internet.dnsInUse] : [] },
      dhcp: bridged
        ? { mode: "bridged", subnetIp: null, subnetMask: null, gateway: null, startIp: null, endIp: null }
        : { mode: "automatic", subnetIp, subnetMask: bits ? prefixMask(Number(bits)) : null, gateway: lan.gateway, startIp: lan.pool.start, endIp: lan.pool.end },
      wan: { mode: data.internet.wanType ?? "dhcp", static: null, pppoeUsername: null, vlan: data.internet.vlan },
      connectionMode: data.network.connectionMode,
      timezone: data.network.timezone,
    };
  };

  /** Devices whose traffic counts toward a usage scope. */
  const scopeDevices = (data: NetworkData, scope: M.UsageScope, id: M.Id | null): M.Device[] => {
    switch (scope) {
      case "network":
        return data.devices;
      case "guest":
        return data.devices.filter((d) => d.ssid === "guest");
      case "device":
        return data.devices.filter((d) => d.id === id).length ? data.devices.filter((d) => d.id === id) : notFound("device");
      case "eero":
        if (!data.eeros.some((e) => e.id === id)) notFound("eero");
        return data.devices.filter((d) => d.eeroId === id);
      case "profile":
        if (!data.profiles.some((p) => p.id === id)) notFound("profile");
        return data.devices.filter((d) => d.profileId === id);
    }
  };

  // --- writes -------------------------------------------------------------
  // Each write changes the fixtures in place, so the next read shows it, and
  // returns what that read would. setScenario rebuilds the fixtures.

  const deviceIn = (data: NetworkData, deviceId: M.Id) => data.devices.find((x) => x.id === deviceId) ?? notFound("device");
  const profileIn = (data: NetworkData, profileId: M.Id) => data.profiles.find((x) => x.id === profileId) ?? notFound("profile");
  const nextId = (prefix: string) => `${prefix}${++writeSeq}`;

  const changeDevice = async (id: M.Id, deviceId: M.Id, change: (d: M.Device, data: NetworkData) => void): Promise<M.Device> => {
    const data = net(id);
    const d = deviceIn(data, deviceId);
    if (flaky.has(d.id)) throw new BackendError("eero_error", "The eero this device is on did not answer.", { status: 503, eeroError: "error.eero.offline" });
    change(d, data);
    return areas.device.get(id, deviceId);
  };

  const changeProfile = (id: M.Id, profileId: M.Id, change: (p: NetworkData["profiles"][number], data: NetworkData) => void): M.Profile => {
    const data = net(id);
    const p = profileIn(data, profileId);
    change(p, data);
    return profileView(data, p);
  };

  /** Exactly `deviceIds` in the profile; devices that leave become Unassigned. */
  const assign = (data: NetworkData, profileId: M.Id, deviceIds: M.Id[]) => {
    for (const deviceId of deviceIds) deviceIn(data, deviceId);
    for (const d of data.devices) {
      if (deviceIds.includes(d.id)) d.profileId = profileId;
      else if (d.profileId === profileId) d.profileId = null;
    }
  };

  const scheduleIn = (p: NetworkData["profiles"][number], scheduleId: M.Id) => p.schedules.find((x) => x.id === scheduleId) ?? notFound("schedule");

  const changeEero = (id: M.Id, eeroId: M.Id, change: (e: NetworkData["eeros"][number]) => void): M.Eero => {
    const data = net(id);
    const e = eeroIn(data, eeroId);
    change(e);
    return eeroView(data, e);
  };

  /** An online eero goes `updating` for RESTART_MS, then back; an offline one cannot be reached. */
  const restartEero = (e: NetworkData["eeros"][number]) => {
    if (e.status === "offline") return;
    if (!restarting.has(e.id)) restarting.set(e.id, { until: 0, status: e.status });
    restarting.get(e.id)!.until = now() + RESTART_MS;
    e.status = "updating";
    e.uptimeSec = 0;
  };

  const range = (q: { from: M.Iso; to: M.Iso }) => {
    const from = Date.parse(q.from);
    const to = Date.parse(q.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) throw new BackendError("bad_params", "Usage range needs a valid from before to.");
    return { from, to };
  };

  const areas: BackendAreas = {
    auth: {
      status: async () => ({ signedIn: auth.signedIn, pending: auth.pending, login: auth.login, storage: "memory" }),
      start: async (login) => {
        const value = login.trim();
        const email = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
        if (!email && !/^\+[1-9]\d{6,14}$/.test(value)) throw new BackendError("bad_params", "Enter an email address or a phone number in +1 format.");
        auth = { signedIn: false, pending: true, login: email ? `${value.slice(0, 2)}***@${value.split("@")[1]}` : `${value.slice(0, 2)}******${value.slice(-2)}` };
      },
      verify: async (code) => {
        if (!auth.pending) throw new BackendError("bad_params", "Start sign-in first: no code was sent.");
        if (code === WRONG_CODE) throw new BackendError("eero_error", "That code didn't work.", { status: 401, eeroError: "error.auth.code.invalid" });
        if (!/^\d{6}$/.test(code)) throw new BackendError("bad_params", "The code is 6 digits.");
        auth = { signedIn: true, pending: false, login: auth.login };
      },
      resend: async () => {
        if (!auth.pending) throw new BackendError("bad_params", "Start sign-in first: no code was sent.");
      },
      logout: async () => {
        auth = { signedIn: false, pending: false, login: null };
      },
    },

    account: {
      get: async () => {
        signedIn();
        return clone(fx.account);
      },
    },

    network: {
      list: async () => {
        signedIn();
        fx.networks.forEach(settleRestarts);
        return fx.networks.map(summary);
      },
      get: async (id) => {
        const data = net(id);
        const { network: n } = data;
        return {
          ...summary(data),
          timezone: n.timezone,
          connectionMode: n.connectionMode,
          gatewayUptimeSec: n.gatewayUptimeSec,
          lastReboot: n.lastReboot,
          capabilities: clone(n.capabilities),
          messages: clone(n.messages),
          counts: { eeros: data.eeros.length, devices: data.devices.length, profiles: data.profiles.length },
        };
      },
      health: async (id) => {
        const data = net(id);
        return {
          status: data.network.status,
          internet: clone(data.health.internet),
          mesh: clone(data.health.mesh),
          eeros: data.eeros.map((e) => ({
            id: e.id,
            location: e.location,
            status: e.status,
            meshBars: e.meshBars,
            weakLink: e.backhaul === "wireless" && e.meshBars !== null && e.meshBars <= 2,
          })),
          messages: clone(data.health.messages),
        };
      },
      permissions: async (id) => clone(net(id).permissions),
      restart: async (id) => {
        const data = net(id);
        const key = `net:${id}`;
        if (!restarting.has(key)) restarting.set(key, { until: 0, status: data.network.status });
        restarting.get(key)!.until = now() + RESTART_MS;
        data.network.status = "updating";
        data.network.lastReboot = new Date(now()).toISOString();
        data.network.gatewayUptimeSec = 0;
        data.eeros.forEach(restartEero);
      },
    },

    internet: {
      get: async (id) => {
        const data = net(id);
        return { ...clone(data.internet), lastSpeedTest: clone(data.speedTests[0] ?? null) };
      },
      speedTests: async (id, q: SpeedTestQuery) => {
        const data = net(id);
        const { from, to } = range(q);
        return clone(data.speedTests.filter((t) => Date.parse(t.at) >= from && Date.parse(t.at) <= to).slice(0, Math.max(0, q.limit)));
      },
      runSpeedTest: async (id) => {
        const data = net(id);
        // The demo answers at once, near the last result (eero takes about a minute).
        const last = data.speedTests[0];
        const jitter = 0.97 + 0.06 * hash01(`${seed}|speed|${data.speedTests.length}`);
        const r = (n: number | null | undefined, fallback: number) => Math.round((n ?? fallback) * jitter);
        data.speedTests.unshift({ at: new Date(now()).toISOString(), downMbps: r(last?.downMbps, 500), upMbps: r(last?.upMbps, 50), rating: null });
      },
    },

    usage: {
      series: async (id, q: UsageQuery) => {
        const data = net(id);
        const { from, to } = range(q);
        const devices = scopeDevices(data, q.scope, q.id);
        const tz = q.timezone || tzOf(data);
        const t = now();
        const points: M.UsagePoint[] = [];
        const start = q.cadence === "hourly" ? hourStart(from, tz) : dayStart(from, tz);
        for (let b = start; b < to && b <= t; ) {
          const end = q.cadence === "hourly" ? b + HOUR : nextDay(b, tz);
          points.push({ at: new Date(b).toISOString(), ...sumHours(devices, data, b, end, t, tz) });
          b = end;
        }
        const total = points.reduce((s, p) => ({ down: s.down + p.down, up: s.up + p.up }), { down: 0, up: 0 });
        const busiest = points.reduce<M.UsagePoint | null>((best, p) => (p.down + p.up > (best ? best.down + best.up : 0) ? p : best), null);
        const today = sumHours(devices, data, dayStart(t, tz), t, t, tz);
        return { scope: q.scope, id: q.id, range: q.range, cadence: q.cadence, points, total, busiest: clone(busiest), todaySoFar: today.down + today.up };
      },
      breakdown: async (id, q: BreakdownQuery) => {
        const data = net(id);
        const { from, to } = range(q);
        const tz = tzOf(data);
        const t = now();
        const row = (rowId: M.Id | null, name: string, devices: M.Device[]): M.UsageBreakdownRow => ({ id: rowId, name, ...sumHours(devices, data, from, to, t, tz), share: 0 });
        let rows: M.UsageBreakdownRow[];
        if (q.by === "device") {
          rows = data.devices.map((d) => row(d.id, d.name, [d])).filter((r) => r.down + r.up > 0);
        } else if (q.by === "eero") {
          rows = data.eeros.map((e) => row(e.id, e.location, data.devices.filter((d) => d.eeroId === e.id)));
        } else {
          rows = data.profiles.map((p) => row(p.id, p.name, data.devices.filter((d) => d.profileId === p.id)));
          const unassigned = data.devices.filter((d) => d.profileId === null);
          if (unassigned.length) rows.push(row(null, "Unassigned", unassigned));
        }
        const total = sumHours(data.devices, data, from, to, t, tz);
        return { range: q.range, by: q.by, rows, total };
      },
    },

    eero: {
      list: async (id) => {
        const data = net(id);
        return data.eeros.map((e) => eeroView(data, e));
      },
      get: async (id, eeroId) => {
        const data = net(id);
        const e = data.eeros.find((x) => x.id === eeroId) ?? notFound("eero");
        return eeroView(data, e);
      },
      ports: async (id, eeroId) => portsView(net(id), eeroId),
      firmwareHistory: async (id, eeroId, limit) => {
        const data = net(id);
        const e = eeroIn(data, eeroId);
        const list = (data.firmware[e.id] ?? []).slice(0, Math.max(0, limit));
        return list.map((f, i) => ({ ...f, current: i === 0 && f.version === e.firmware }));
      },
      rename: async (id, eeroId, location) => changeEero(id, eeroId, (e) => (e.location = location)),
      find: async (id, eeroId) => {
        eeroIn(net(id), eeroId);
      },
      setLed: async (id, eeroId, led) =>
        changeEero(id, eeroId, (e) => {
          e.led = { on: led.on ?? e.led.on, brightness: led.brightness ?? e.led.brightness };
        }),
      setNightlight: async (id, eeroId, nightlight) =>
        changeEero(id, eeroId, (e) => {
          if (!e.nightlight) throw new BackendError("eero_error", "This eero has no nightlight.", { status: 400 });
          e.nightlight = clone(nightlight);
        }),
      restart: async (id, eeroId) => {
        const e = eeroIn(net(id), eeroId);
        if (e.status === "offline") throw new BackendError("eero_error", `${e.location} is offline, so it cannot restart.`, { status: 400 });
        restartEero(e);
      },
    },

    routing: {
      get: async (id) => {
        const data = net(id);
        return {
          reservations: data.reservations.map((r) => ({ ...clone(r), forwards: data.forwards.filter((f) => f.deviceId === r.deviceId).length })),
          forwards: clone(data.forwards),
          pinholes: clone(data.pinholes),
          // pool.leased is counted in core (commands/routing.ts), as for the eero backend.
          lan: data.lan ? { ...clone(data.lan), pool: { ...data.lan.pool, leased: 0 } } : null,
        };
      },
    },

    updates: {
      get: async (id) => {
        const data = net(id);
        const gateway = data.eeros.find((e) => e.isGateway) ?? data.eeros[0];
        return {
          ...clone(data.updates),
          current: gateway?.firmware ?? null,
          eeros: data.eeros.map((e) => ({ id: e.id, location: e.location, firmware: e.firmware })),
        };
      },
      notes: async (id) => {
        const data = net(id);
        const version = data.updates.target ?? (data.eeros.find((e) => e.isGateway) ?? data.eeros[0])?.firmware ?? null;
        const notes = version ? RELEASE_NOTES[version] : undefined;
        return notes ? clone(notes) : null;
      },
    },

    device: {
      list: async (id) => net(id).devices.map(deviceView),
      get: async (id, deviceId) => {
        const data = net(id);
        const d = data.devices.find((x) => x.id === deviceId) ?? notFound("device");
        const r = data.reservations.find((x) => x.deviceId === d.id);
        return { ...deviceView(d), reservation: r ? { id: r.id, ip: r.ip } : null };
      },
      requestBurst: async (id) => {
        const data = net(id);
        burstStep++;
        for (const d of data.devices) {
          if (!typical.has(d.id)) continue;
          const step = (hash01(`${seed}|${d.id}|${burstStep}`) - 0.5) * 0.3;
          walk.set(d.id, Math.min(1.6, Math.max(0.4, (walk.get(d.id) ?? 1) + step)));
        }
        return { nextBurstAt: new Date(now() + BURST_LEAD_MS).toISOString() };
      },
      setPaused: (id, deviceId, paused) => changeDevice(id, deviceId, (d) => (d.paused = paused)),
      rename: (id, deviceId, nickname) =>
        changeDevice(id, deviceId, (d) => {
          d.nickname = nickname;
          d.name = nickname ?? d.hostname ?? d.model ?? d.manufacturer ?? d.mac;
        }),
      setType: (id, deviceId, type) =>
        changeDevice(id, deviceId, (d) => {
          d.type = type;
          d.category = deviceCategory(type);
        }),
      setProfile: (id, deviceId, profileId) =>
        changeDevice(id, deviceId, (d, data) => {
          if (profileId !== null) profileIn(data, profileId);
          d.profileId = profileId;
        }),
      setBlocked: (id, deviceId, blocked) =>
        changeDevice(id, deviceId, (d) => {
          if (blocked === d.blocked) return;
          d.blocked = blocked;
          if (blocked) {
            beforeBlock.set(d.id, d.connected);
            d.connected = false;
          } else {
            d.connected = beforeBlock.get(d.id) ?? false;
            beforeBlock.delete(d.id);
          }
        }),
    },

    profile: {
      list: async (id) => {
        const data = net(id);
        return data.profiles.map((p) => profileView(data, p));
      },
      get: async (id, profileId) => {
        const data = net(id);
        const p = data.profiles.find((x) => x.id === profileId) ?? notFound("profile");
        return profileView(data, p);
      },
      create: async (id, input) => {
        const data = net(id);
        const p = { id: nextId("demo-profile-"), name: input.name, paused: false, schedules: [] };
        assign(data, p.id, input.deviceIds);
        data.profiles.push(p);
        return profileView(data, p);
      },
      rename: async (id, profileId, name) => changeProfile(id, profileId, (p) => (p.name = name)),
      setPaused: async (id, profileId, paused) =>
        changeProfile(id, profileId, (p, data) => {
          // eero pauses every device in the profile with it, as the fixtures show.
          p.paused = paused;
          for (const d of data.devices) if (d.profileId === p.id) d.paused = paused;
        }),
      setDevices: async (id, profileId, deviceIds) => changeProfile(id, profileId, (p, data) => assign(data, p.id, deviceIds)),
      remove: async (id, profileId) => {
        const data = net(id);
        const p = profileIn(data, profileId);
        assign(data, p.id, []);
        data.profiles = data.profiles.filter((x) => x.id !== p.id);
      },
      setUnassignedPaused: async (id, paused) => {
        // Unassigned: devices in no profile (eero's default profile).
        for (const d of net(id).devices) if (d.profileId === null && !d.blocked) d.paused = paused;
      },
      addSchedule: async (id, profileId, input) => {
        const s: M.Schedule = { id: nextId("demo-schedule-"), ...clone(input) };
        profileIn(net(id), profileId).schedules.push(s);
        return clone(s);
      },
      updateSchedule: async (id, profileId, scheduleId, input) => {
        const s = scheduleIn(profileIn(net(id), profileId), scheduleId);
        Object.assign(s, clone(input), { id: s.id });
        return clone(s);
      },
      removeSchedule: async (id, profileId, scheduleId) => {
        const p = profileIn(net(id), profileId);
        scheduleIn(p, scheduleId);
        p.schedules = p.schedules.filter((x) => x.id !== scheduleId);
      },
    },

    events: {
      list: async (id, cursor): Promise<EventChunk> => {
        const data = net(id);
        const offset = cursor === null ? 0 : Number(cursor);
        if (!Number.isInteger(offset) || offset < 0) throw new BackendError("bad_params", "That events cursor is not valid.");
        const events = clone(data.events.slice(offset, offset + EVENT_PAGE_SIZE));
        const next = offset + EVENT_PAGE_SIZE;
        return { events, nextCursor: next < data.events.length ? String(next) : null };
      },
    },

    guest: {
      get: async (id) => guestView(net(id)),
      credentials: async (id) => {
        const data = net(id);
        return { ssid: data.guest.name ?? `${data.network.name} Guest`, password: data.guest.password };
      },
      setEnabled: async (id, enabled) => {
        const data = net(id);
        data.guest.enabled = enabled;
        return guestView(data);
      },
      rename: async (id, name) => {
        const data = net(id);
        data.guest.name = name;
        return guestView(data);
      },
      setPassword: async (id, password) => {
        const data = net(id);
        const wasOpen = data.guest.password === null;
        data.guest.password = password;
        // Open has no security; a password brings back the main network's.
        if (password === null) data.guest.security = { "2.4": null, "5": null, "6": null };
        else if (wasOpen) data.guest.security = clone(data.wifi.security);
        return guestView(data);
      },
    },

    wifi: {
      get: async (id) => wifiView(net(id)),
      credentials: async (id) => {
        const data = net(id);
        return { ssid: data.network.name, password: data.wifi.password };
      },
      setName: async (id, ssid) => {
        const data = net(id);
        data.network.name = ssid;
        return wifiView(data);
      },
      setPassword: async (id, password) => {
        const data = net(id);
        data.wifi.password = password;
        return wifiView(data);
      },
      setSecurity: async (id, security) => {
        const data = net(id);
        for (const band of WIRELESS) {
          const next = security[band];
          // A band no eero has stays null.
          if (next && data.wifi.security[band] !== null) data.wifi.security[band] = next;
        }
        // A guest network with a password follows the main network's security.
        if (data.guest.password !== null) data.guest.security = clone(data.wifi.security);
        return wifiView(data);
      },
      setHide5g: async (id, enabled) => {
        const data = net(id);
        data.wifi.hide5g = enabled ? { active: true, expiresAt: new Date(now() + HIDE_5G_MS).toISOString() } : { active: false, expiresAt: null };
        return wifiView(data);
      },
    },

    settings: {
      get: async (id) => settingsView(net(id)),
      threadCredentials: async (id) => clone(net(id).threadCredentials),
    },

    diagnostics: {
      latest: async (id) => clone(net(id).diagnostics),
      support: async (id) => clone(net(id).support),
    },

    admins: {
      list: async (id) => {
        const data = net(id);
        return { admins: clone(data.admins), invites: clone(data.invites) };
      },
    },

    integrations: {
      get: async (id) => clone(net(id).integrations),
    },

    notifications: {
      list: async (id, cursor): Promise<NotificationChunk> => {
        const data = net(id);
        const offset = cursor === null ? 0 : Number(cursor);
        if (!Number.isInteger(offset) || offset < 0) throw new BackendError("bad_params", "That notifications cursor is not valid.");
        const next = offset + NOTIFICATION_PAGE_SIZE;
        return { notifications: clone(data.notifications.slice(offset, next)), nextCursor: next < data.notifications.length ? String(next) : null };
      },
      unread: async (id) => net(id).notifications.some((n) => !n.read),
      settings: async (id) => clone(net(id).notificationSettings),
      markRead: async (id) => {
        for (const n of net(id).notifications) n.read = true;
      },
    },
  };

  /** Every method of an area, behind the scenario's read mode. `auth` is never wrapped. */
  const gated = <T extends object>(area: T): T =>
    new Proxy(area, {
      get(target, key, receiver) {
        const value = Reflect.get(target, key, receiver);
        if (typeof value !== "function") return value;
        return async (...args: unknown[]) => {
          if (reads === "errors") throw new BackendError("eero_error", "eero did not answer (demo errors scenario).", { status: 503 });
          if (reads === "slow") await new Promise((r) => setTimeout(r, slowMs));
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    });

  const wrapped = Object.fromEntries(AREA_NAMES.map((name) => [name, name === "auth" ? areas.auth : gated(areas[name])])) as unknown as BackendAreas;

  return {
    kind: "demo",
    scenario: () => scenario,
    setScenario: reset,
    ...wrapped,
  };
}
