/**
 * The engine: the only way state changes or eero is called. Surfaces call
 * `execute(id, params)`; it looks up the spec, validates params, checks the
 * session, resolves the network, enforces confirmation, runs the command
 * (through a small query cache, with writes serialised per network) and
 * returns `{ ok, result }` or `{ ok: false, error }`. It never throws.
 * See docs/architecture/engine.md.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Backend } from "./backend";
import { CommandError, type ExecuteResult, toExecuteError } from "./errors";
import type { AppSettings, HostEvent, Id } from "./model";
import { TTL, type Topic } from "./poll";
import { type CommandInfo, createRegistry, type RegisteredCommand } from "./registry";
import {
  type AnyCommand,
  type CommandContext,
  type HostInfo,
  needsConfirm,
  type RefCandidate,
  type RefKind,
  type SettingsStore,
  type Surface,
} from "./spec";

export type EngineOptions = {
  backend: Backend;
  /** Defaults to every spec in src/core/commands. */
  commands?: AnyCommand[];
  /** Defaults to an in-memory store. */
  settings?: SettingsStore;
  surface?: Surface;
  host?: Partial<HostInfo>;
  /** Epoch ms; injectable for tests. */
  clock?: () => number;
};

export interface Engine {
  readonly backend: Backend;
  execute<R = unknown>(id: string, params?: unknown): Promise<ExecuteResult<R>>;
  /** The registry as JSON, for window.mesh.commands(), `mesh-ui commands` and MCP. */
  commands(): CommandInfo[];
  /** Host events (session.changed, network.selected). Returns an unsubscribe. */
  onEvent(listener: (event: HostEvent) => void): () => void;
  selectedNetworkId(): Id | null;
}

// ---------------------------------------------------------------------------
// Settings stores

export const DEFAULT_SETTINGS: AppSettings = {
  lastNetworkId: null,
  userAgent: null,
  planMbps: {},
  desktopNotifications: {},
  openOnLaunch: null,
};

export function memorySettings(initial: Partial<AppSettings> = {}): SettingsStore {
  let current: AppSettings = { ...DEFAULT_SETTINGS, ...initial };
  return {
    get: async () => current,
    update: async (patch) => {
      current = { ...current, ...patch };
      return current;
    },
  };
}

/** settings.json in the config dir: read once, written atomically on change. */
export function fileSettings(path: string): SettingsStore {
  let current: Promise<AppSettings> | null = null;
  let writing: Promise<unknown> = Promise.resolve();
  const load = async (): Promise<AppSettings> => {
    try {
      const raw: unknown = JSON.parse(await readFile(path, "utf8"));
      return raw && typeof raw === "object" ? { ...DEFAULT_SETTINGS, ...(raw as Partial<AppSettings>) } : { ...DEFAULT_SETTINGS };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  };
  const save = async (s: AppSettings) => {
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(s, null, 2)}\n`, { mode: 0o600 });
    await rename(tmp, path);
  };
  return {
    get: () => (current ??= load()),
    update: async (patch) => {
      const next = { ...(await (current ??= load())), ...patch };
      current = Promise.resolve(next);
      writing = writing.then(() => save(next)).catch(() => undefined);
      await writing;
      return next;
    },
  };
}

// ---------------------------------------------------------------------------
// Query cache

type CacheEntry = { promise: Promise<unknown>; topic: Topic; expires: number };

function createCache(now: () => number) {
  const entries = new Map<string, CacheEntry>();
  /** Topic to the time cached data fetched before it becomes stale. */
  const staleAt = new Map<Topic, number>();

  return {
    get<T>(key: string, topic: Topic, ttlSec: number, load: () => Promise<T>): Promise<T> {
      const hit = entries.get(key);
      if (hit && now() < hit.expires) return hit.promise as Promise<T>;
      const fetchedAt = now();
      const entry: CacheEntry = { promise: load(), topic, expires: Number.POSITIVE_INFINITY };
      entries.set(key, entry);
      entry.promise.then(
        () => {
          const floor = staleAt.get(topic);
          const cap = floor !== undefined && fetchedAt < floor ? floor : Number.POSITIVE_INFINITY;
          entry.expires = Math.min(entry.expires, fetchedAt + ttlSec * 1000, cap);
        },
        () => {
          if (entries.get(key) === entry) entries.delete(key);
        },
      );
      return entry.promise as Promise<T>;
    },
    invalidate(topics: Topic[], at: number) {
      for (const topic of topics) {
        if (at > now()) staleAt.set(topic, Math.max(staleAt.get(topic) ?? 0, at));
        for (const e of entries.values()) if (e.topic === topic) e.expires = Math.min(e.expires, at);
      }
    },
    clear() {
      entries.clear();
      staleAt.clear();
    },
  };
}

const stableJson = (v: unknown): string =>
  JSON.stringify(v, (_k, val: unknown) =>
    val && typeof val === "object" && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : val,
  );

// ---------------------------------------------------------------------------
// Refs

const norm = (s: string) => s.trim().toLowerCase();
const macKey = (s: string) => norm(s).replace(/[:-]/g, "");

/** An id or exact case-insensitive name to one id. */
export function matchRef(ref: string, candidates: RefCandidate[], kind = "item"): Id {
  const want = norm(ref);
  const byId = candidates.filter((c) => norm(c.id) === want || macKey(c.id) === macKey(ref));
  if (byId.length === 1 && byId[0]) return byId[0].id;
  const byName = candidates.filter((c) => c.names.some((n) => typeof n === "string" && norm(n) === want));
  const ids = [...new Set(byName.map((c) => c.id))];
  if (ids.length === 1 && ids[0]) return ids[0];
  if (ids.length > 1) {
    const matches = byName.map((c) => ({ id: c.id, name: c.names.find((n): n is string => typeof n === "string") ?? c.id }));
    throw new CommandError("bad_params", `"${ref}" matches ${ids.length} ${kind}s; use an id.`, { matches });
  }
  throw new CommandError("bad_params", `No ${kind} matches "${ref}".`);
}

// ---------------------------------------------------------------------------
// Engine

export function createEngine(opts: EngineOptions): Engine {
  const { backend } = opts;
  const now = opts.clock ?? Date.now;
  const settings = opts.settings ?? memorySettings();
  const surface = opts.surface ?? "ui";
  const host: HostInfo = { version: "0.0.0", electron: null, configDir: null, keychainName: null, ...opts.host };
  const registry = createRegistry(opts.commands, { backend: backend.kind });
  const cache = createCache(now);
  const listeners = new Set<(e: HostEvent) => void>();
  const writeQueues = new Map<string, Promise<unknown>>();
  let selected: Id | null | undefined; // undefined until read from settings

  const emit = (event: HostEvent) => {
    for (const l of listeners) {
      try {
        l(event);
      } catch {
        // A listener failing must not break the command.
      }
    }
  };

  const listNetworks = () => cache.get("account|ref:network", "account", TTL.account, () => backend.network.list());

  const selectedId = async (): Promise<Id | null> => {
    if (selected === undefined) selected = (await settings.get()).lastNetworkId;
    return selected;
  };

  const setSelected = async (id: Id, announce: boolean) => {
    const changed = selected !== id;
    selected = id;
    await settings.update({ lastNetworkId: id });
    if (announce || changed) emit({ type: "network.selected", networkId: id });
  };

  /** `networkId` param, else the selection, else the first network. */
  const resolveNetwork = async (ref: string | undefined): Promise<Id> => {
    const list = await listNetworks();
    const candidates = list.map((n) => ({ id: n.id, names: [n.name, n.nickname] }));
    if (ref) return matchRef(ref, candidates, "network");
    const current = await selectedId();
    if (current && list.some((n) => n.id === current)) return current;
    const first = list[0];
    if (!first) throw new CommandError("bad_params", "This account has no networks.");
    await setSelected(first.id, false);
    return first.id;
  };

  const refSources: Record<RefKind, (net: Id | null) => Promise<RefCandidate[]>> = {
    network: async () => (await listNetworks()).map((n) => ({ id: n.id, names: [n.name, n.nickname] })),
    eero: async (net) =>
      (await cache.get(`eeros|${net}|ref:eero`, "eeros", TTL.eeros, () => backend.eero.list(need(net)))).map((e) => ({
        id: e.id,
        names: [e.location, e.serial, e.mac],
      })),
    device: async (net) =>
      (await cache.get(`devices|${net}|ref:device`, "devices", TTL.devices, () => backend.device.list(need(net)))).map((d) => ({
        id: d.id,
        names: [d.name, d.nickname, d.hostname, d.mac],
      })),
    profile: async (net) =>
      (await cache.get(`profiles|${net}|ref:profile`, "profiles", TTL.profiles, () => backend.profile.list(need(net)))).map((p) => ({
        id: p.id,
        names: [p.name],
      })),
  };

  function need(net: Id | null): Id {
    if (!net) throw new CommandError("bad_params", "No network selected.");
    return net;
  }

  const makeContext = (networkId: Id | null): CommandContext => ({
    backend,
    surface,
    host,
    settings,
    networkId,
    get net() {
      return need(networkId);
    },
    get selectedNetworkId() {
      return selected ?? null;
    },
    selectNetwork: (id) => setSelected(id, true),
    resolve: async (kind, ref) => matchRef(ref, await refSources[kind](networkId), kind),
    match: matchRef,
    now,
    invalidate: (topics, atMs) => cache.invalidate(topics, atMs ?? now()),
    emit,
  });

  const runCommand = async (cmd: RegisteredCommand, params: Record<string, unknown>): Promise<unknown> => {
    const { spec, scope } = cmd;
    const { networkId: netRef, confirm, ...rest } = params as { networkId?: string; confirm?: boolean };

    if (scope !== "app" && !spec.id.startsWith("auth.")) {
      const status = await backend.auth.status();
      if (!status.signedIn) throw new CommandError("not_signed_in", "Not signed in.");
    }

    const networkId = scope === "network" ? await resolveNetwork(netRef) : ((await selectedId()) ?? null);
    const ctx = makeContext(networkId);

    if (needsConfirm(spec.effect) && confirm !== true) {
      const fallback =
        spec.effect === "destructive"
          ? `${spec.label}: this cannot be undone. Pass confirm: true to continue.`
          : `${spec.label}: this interrupts the network. Pass confirm: true to continue.`;
      const message = spec.confirmMessage ? await spec.confirmMessage(ctx, rest) : fallback;
      throw new CommandError("needs_confirm", message);
    }

    if (spec.effect === "query") {
      const ttl = typeof spec.ttl === "function" ? spec.ttl(rest) : (spec.ttl ?? (spec.topic ? TTL[spec.topic] : 0));
      if (!spec.topic || spec.sensitive || ttl <= 0) return spec.run(ctx, rest);
      const key = `${spec.topic}|${networkId}|${spec.id}|${stableJson(rest)}`;
      return cache.get(key, spec.topic, ttl, () => spec.run(ctx, rest));
    }

    const queueKey = networkId ?? "_";
    const previous = writeQueues.get(queueKey) ?? Promise.resolve();
    const result = previous.then(() => spec.run(ctx, rest));
    writeQueues.set(
      queueKey,
      result.catch(() => undefined),
    );
    try {
      return await result;
    } finally {
      // Also after a failure: a write that timed out may still have landed.
      if (spec.invalidates?.length) cache.invalidate(spec.invalidates, now());
    }
  };

  return {
    backend,
    commands: () => registry.describe(),
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    selectedNetworkId: () => selected ?? null,
    async execute<R>(id: string, params?: unknown): Promise<ExecuteResult<R>> {
      const cmd = registry.get(id);
      if (!cmd) return { ok: false, error: { code: "unknown_command", message: `Unknown command "${id}".` } };

      const parsed = cmd.schema.safeParse(params ?? {});
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message }));
        const first = issues[0];
        const message = first ? `Invalid params: ${first.path ? `${first.path}: ` : ""}${first.message}` : "Invalid params.";
        return { ok: false, error: { code: "bad_params", message, detail: { issues } } };
      }

      try {
        const result = (await runCommand(cmd, parsed.data as Record<string, unknown>)) as R;
        return { ok: true, result };
      } catch (err) {
        const error = toExecuteError(err);
        if (error.code === "not_signed_in" && !(err instanceof CommandError)) {
          // The backend found the session dead: drop every cached answer.
          cache.clear();
          emit({ type: "session.changed", state: "signed_out", storage: "memory" });
        }
        return { ok: false, error };
      }
    },
  };
}
