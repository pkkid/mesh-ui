/**
 * The demo backend: every M1 read in `Backend` answered from an in-memory
 * copy of the fixtures. It never opens a socket, so `--demo` works offline.
 * See docs/architecture/backends.md (demo backend).
 *
 * Derived fields come from the lists, so they always agree: a network's eero
 * count and devices online, an eero's clients, a profile's devices and state,
 * health per eero. Usage is generated per device and hour from its typical
 * daily traffic, and every scope (network, eero, profile, guest, device) and
 * breakdown sums the same per-device hours, so totals add up everywhere.
 */

import { type Backend, type BreakdownQuery, type EventChunk, type SpeedTestQuery, type UsageQuery, BackendError } from "../backend";
import type * as M from "../model";
import { createFixtures, type DemoFixtures, type DeviceUsage, type NetworkData, type UsagePattern } from "./fixtures";
import { applyScenario, type ScenarioName } from "./scenario";

export type DemoBackendOptions = {
  /** Epoch ms; injectable so tests are deterministic. */
  clock?: () => number;
  /** Seeds the filler events and the live-rate walk. */
  seed?: number;
  scenario?: ScenarioName;
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
const BURST_LEAD_MS = 3_000;
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

  const reset = (name: ScenarioName) => {
    scenario = name;
    fx = createFixtures(now(), seed);
    const effect = applyScenario(fx, name, now());
    auth = { signedIn: effect.signedIn, pending: false, login: effect.signedIn ? fx.login : null };
    typical = new Map(fx.networks.flatMap((n) => n.devices.flatMap((d) => (d.rates ? [[d.id, d.rates] as const] : []))));
    walk = new Map();
    burstStep = 0;
  };
  reset(scenario);

  const signedIn = () => {
    if (!auth.signedIn) throw new BackendError("not_signed_in", "Not signed in to the demo account.");
  };

  const net = (id: M.Id): NetworkData => {
    signedIn();
    return fx.networks.find((n) => n.network.id === id) ?? notFound("network");
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

  const range = (q: { from: M.Iso; to: M.Iso }) => {
    const from = Date.parse(q.from);
    const to = Date.parse(q.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) throw new BackendError("bad_params", "Usage range needs a valid from before to.");
    return { from, to };
  };

  return {
    kind: "demo",
    scenario: () => scenario,
    setScenario: reset,

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
  };
}
