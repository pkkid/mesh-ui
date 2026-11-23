/**
 * `wifi.history`'s store (docs/ux/pages/signal.md): each wireless device's
 * signal, sampled whenever a command reads the device list (`device.list`,
 * `wifi.health`, `wifi.insights`, `wifi.history`), at most every 20 seconds,
 * kept 4 hours in memory only (it holds device names, so it is never
 * written to disk). eero keeps no signal history on free accounts.
 */

import type { Backend } from "./backend";
import { isDemoBackend } from "./demo";
import type * as M from "./model";
import { median } from "./signal";
import type { CommandContext } from "./spec";

type WirelessDevice = M.Device & { band: M.WirelessBand; signal: { dbm: number; bars: number | null } };
const isWireless = (d: M.Device): d is WirelessDevice => d.connected && d.band !== null && d.band !== "wired" && typeof d.signal?.dbm === "number";

/** Samples closer together than this are skipped; older than `keepMs` are dropped. */
export const HISTORY = { minGapMs: 20_000, keepMs: 4 * 60 * 60_000, limit: 6 } as const;

type Track = { name: string; eeroId: M.Id | null; dbm: (number | null)[] };
type Store = { at: number[]; tracks: Map<M.Id, Track> };

/** One store per backend (an engine's lifetime) and network. Never persisted: it holds device names. */
const stores = new WeakMap<Backend, Map<M.Id, Store>>();

function storeFor(backend: Backend, net: M.Id): Store {
  let byNet = stores.get(backend);
  if (!byNet) stores.set(backend, (byNet = new Map()));
  let store = byNet.get(net);
  if (!store) byNet.set(net, (store = { at: [], tracks: new Map() }));
  return store;
}

function addSample(store: Store, at: number, devices: ReadonlyArray<{ id: M.Id; name: string; eeroId: M.Id | null; dbm: number | null }>): void {
  const last = store.at[store.at.length - 1];
  if (last !== undefined && at - last < HISTORY.minGapMs) return;
  const index = store.at.length;
  store.at.push(at);
  const seen = new Set<M.Id>();
  for (const d of devices) {
    if (d.dbm === null) continue;
    seen.add(d.id);
    let t = store.tracks.get(d.id);
    if (!t) store.tracks.set(d.id, (t = { name: d.name, eeroId: d.eeroId, dbm: Array(index).fill(null) }));
    t.name = d.name;
    t.eeroId = d.eeroId;
    t.dbm.push(d.dbm);
  }
  for (const [id, t] of store.tracks) if (!seen.has(id)) t.dbm.push(null);
  // Drop samples past the window, and devices with nothing left in it.
  const cut = store.at.findIndex((x) => at - x <= HISTORY.keepMs);
  if (cut > 0) {
    store.at.splice(0, cut);
    for (const [id, t] of store.tracks) {
      t.dbm.splice(0, cut);
      if (t.dbm.every((v) => v === null)) store.tracks.delete(id);
    }
  }
}

/**
 * Records a sample of every connected wireless device's signal. Called by
 * every command that reads the device list (device.list, wifi.health), so the
 * history grows while any page polls devices. In demo mode the first call
 * back-fills the demo's last hour.
 */
export function recordSignals(ctx: CommandContext, devices: ReadonlyArray<M.Device>): void {
  const net = ctx.networkId;
  if (!net) return;
  const store = storeFor(ctx.backend, net);
  const now = ctx.now();
  if (store.at.length === 0 && isDemoBackend(ctx.backend)) for (const s of ctx.backend.signalSeed(net, now)) addSample(store, s.at, s.devices);
  addSample(
    store,
    now,
    devices.filter(isWireless).map((d) => ({ id: d.id, name: d.name, eeroId: d.eeroId, dbm: d.signal.dbm })),
  );
}

/** Drops then rejoins: a run of nulls between two readings. */
function dropsOf(values: ReadonlyArray<number | null>): number {
  let drops = 0;
  let seen = false;
  let gap = false;
  for (const v of values) {
    if (v === null) {
      if (seen) gap = true;
    } else {
      if (gap) drops += 1;
      seen = true;
      gap = false;
    }
  }
  return drops;
}

export function signalHistory(ctx: CommandContext, minutes: number, limit: number, deviceId: M.Id | null): M.SignalHistory {
  const store = storeFor(ctx.backend, ctx.net);
  const now = ctx.now();
  const from = store.at.findIndex((x) => now - x <= minutes * 60_000);
  const start = from === -1 ? store.at.length : from;
  const at = store.at.slice(start);
  const rows = [...store.tracks]
    .filter(([id]) => deviceId === null || id === deviceId)
    .map(([id, t]) => {
      const dbm = t.dbm.slice(start);
      const values = dbm.filter((v): v is number => v !== null);
      return {
        deviceId: id,
        name: t.name,
        eeroId: t.eeroId,
        dbm,
        drops: dropsOf(dbm),
        medianDbm: median(values),
        minDbm: values.length ? Math.min(...values) : null,
        maxDbm: values.length ? Math.max(...values) : null,
      };
    })
    .filter((r) => r.medianDbm !== null)
    .sort((a, b) => b.drops - a.drops || (a.medianDbm ?? 0) - (b.medianDbm ?? 0) || a.name.localeCompare(b.name))
    .slice(0, limit);
  return {
    from: at.length ? new Date(at[0] as number).toISOString() : null,
    to: at.length ? new Date(at[at.length - 1] as number).toISOString() : null,
    samples: at.length,
    devices: rows,
    at: at.map((x) => new Date(x).toISOString()),
  };
}

