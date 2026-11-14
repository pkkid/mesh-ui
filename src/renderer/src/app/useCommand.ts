/**
 * The renderer's only data path: hooks over `window.mesh.execute`.
 *
 * - `useQuery(id, params, { poll })` runs a query, shares the result between
 *   every component asking for the same id and params, keeps the last data
 *   while refetching, and polls on the interval the registry reports for the
 *   command (from src/core/poll.ts), stretched while the window is hidden.
 * - `useCommand(id)` runs a command on demand (writes, or a query the user
 *   triggers) and, after a successful write, refetches the queries it affects.
 *
 * `execute` never throws: the bridge returns `{ ok, result }` or
 * `{ ok: false, error }` and anything that goes wrong in between becomes a
 * `network_error`. Until the Electron host exposes the engine (M1.4) the
 * bridge below falls back to a stub that answers every call with an error, so
 * the shell renders its empty and missing states.
 * See docs/architecture/ui.md#data-access.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import type { ExecuteError, ExecuteResult } from "../../../core/errors";
import type { HostEvent } from "../../../core/model";
import { pollDelayMs } from "../../../core/poll";
import type { CommandInfo } from "../../../core/registry";

// ---------------------------------------------------------------------------
// Bridge

/** The engine half of `window.mesh`, as the preload exposes it from M1.4. */
export type MeshBridge = {
  execute(id: string, params?: unknown): Promise<ExecuteResult>;
  commands(): Promise<CommandInfo[]>;
  /** Host events (session.changed, network.selected). Returns an unsubscribe. */
  on?(listener: (event: HostEvent) => void): () => void;
};

const NOT_CONNECTED: ExecuteError = {
  code: "network_error",
  message: "Mesh UI is not connected to its engine yet.",
};

/** Used until the preload exposes `execute`. Every call fails the same way. */
const STUB_BRIDGE: MeshBridge = {
  execute: async () => ({ ok: false, error: NOT_CONNECTED }),
  commands: async () => [],
};

export function bridge(): MeshBridge {
  const mesh = (window as { mesh?: Partial<MeshBridge> }).mesh;
  return typeof mesh?.execute === "function" && typeof mesh.commands === "function"
    ? (mesh as MeshBridge)
    : STUB_BRIDGE;
}

/** Whether the real engine is behind `window.mesh` (false while the stub answers). */
export const engineConnected = (): boolean => bridge() !== STUB_BRIDGE;

const sessionListeners = new Set<(expired: boolean) => void>();

/**
 * Set from the moment the user runs `auth.logout` here until the next sign-in,
 * so the sign-out it causes (its session.changed event and the not_signed_in
 * answers from polls) is not reported as an expired session.
 */
let signedOutByUser = false;

const endSession = () => sessionListeners.forEach((l) => l(!signedOutByUser));

/**
 * Called whenever the session ends: a command reports `not_signed_in` or the
 * host says it signed out. `expired` is false when the user's own sign-out in
 * this window caused it. Returns an unsubscribe.
 */
export function onSessionEnded(listener: (expired: boolean) => void): () => void {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

/** Runs a command. Never throws. */
export async function execute<R = unknown>(id: string, params?: unknown): Promise<ExecuteResult<R>> {
  if (id === "auth.logout") signedOutByUser = true;
  let res: ExecuteResult<R>;
  try {
    res = (await bridge().execute(id, params)) as ExecuteResult<R>;
  } catch (err) {
    res = { ok: false, error: { code: "network_error", message: err instanceof Error ? err.message : String(err) } };
  }
  if (id === "auth.logout" && !res.ok) signedOutByUser = false;
  if (id === "auth.login.verify" && res.ok) signedOutByUser = false;
  if (!res.ok && res.error.code === "not_signed_in") endSession();
  return res;
}

/**
 * Follows host events: a sign-out elsewhere (for example by the CLI) ends the
 * session here, and a network switch refetches everything. Returns an
 * unsubscribe; does nothing while the stub bridge answers.
 */
export function followHostEvents(): () => void {
  const mesh = bridge();
  if (typeof mesh.on !== "function") return () => {};
  return mesh.on((event) => {
    if (event.type === "session.changed" && event.state === "signed_in") signedOutByUser = false;
    if (event.type === "session.changed" && event.state === "signed_out") endSession();
    if (event.type === "network.selected") invalidate();
  });
}

// ---------------------------------------------------------------------------
// Registry

let registry: CommandInfo[] | null = null;
let registryLoad: Promise<CommandInfo[]> | null = null;
const registryListeners = new Set<() => void>();

function loadRegistry(): Promise<CommandInfo[]> {
  registryLoad ??= bridge()
    .commands()
    .catch(() => [] as CommandInfo[])
    .then((list) => {
      registry = list;
      registryListeners.forEach((l) => l());
      return list;
    });
  return registryLoad;
}

/** One command's registry entry (effect, label), loading the registry if needed. */
export async function commandInfo(id: string): Promise<CommandInfo | undefined> {
  return (registry ?? (await loadRegistry())).find((c) => c.id === id);
}

/** Forgets the loaded registry (tests that swap the bridge). */
export function resetRegistry(): void {
  registry = null;
  registryLoad = null;
}

/** The command registry (`window.mesh.commands()`), or null while it loads. */
export function useCommands(): CommandInfo[] | null {
  const list = useSyncExternalStore(
    (l) => (registryListeners.add(l), () => registryListeners.delete(l)),
    () => registry,
  );
  useEffect(() => void loadRegistry(), []);
  return list;
}

// ---------------------------------------------------------------------------
// Query store

export type QuerySnapshot<R> = {
  data: R | undefined;
  error: ExecuteError | null;
  /** A request is in flight (first load or refetch). */
  loading: boolean;
  /** Epoch ms of the last successful result. */
  fetchedAt: number | null;
};

type Entry = {
  id: string;
  params: unknown;
  snapshot: QuerySnapshot<unknown>;
  inflight: Promise<void> | null;
  listeners: Set<() => void>;
  /** Set when a write made the data stale; the next poll or mount refetches. */
  stale: boolean;
};

const EMPTY: QuerySnapshot<never> = { data: undefined, error: null, loading: false, fetchedAt: null };
const entries = new Map<string, Entry>();

/** Stable key for id plus params, independent of key order. */
export function queryKey(id: string, params?: unknown): string {
  const sort = (v: unknown): unknown =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>)
            .filter(([, x]) => x !== undefined)
            .sort(([a], [b]) => (a < b ? -1 : 1))
            .map(([k, x]) => [k, sort(x)]),
        )
      : Array.isArray(v)
        ? v.map(sort)
        : v;
  return `${id} ${JSON.stringify(sort(params ?? {}))}`;
}

function entryFor(id: string, params: unknown): Entry {
  const key = queryKey(id, params);
  let entry = entries.get(key);
  if (!entry) {
    entry = { id, params, snapshot: EMPTY, inflight: null, listeners: new Set(), stale: true };
    entries.set(key, entry);
  }
  return entry;
}

function update(entry: Entry, patch: Partial<QuerySnapshot<unknown>>) {
  entry.snapshot = { ...entry.snapshot, ...patch };
  entry.listeners.forEach((l) => l());
}

/** Fetches an entry, merging with a request already in flight. */
function fetchEntry(entry: Entry): Promise<void> {
  if (entry.inflight) return entry.inflight;
  update(entry, { loading: true });
  entry.stale = false;
  entry.inflight = execute(entry.id, entry.params).then((res) => {
    entry.inflight = null;
    if (res.ok) update(entry, { data: res.result, error: null, loading: false, fetchedAt: Date.now() });
    else update(entry, { error: res.error, loading: false });
  });
  return entry.inflight;
}

/**
 * Marks queries stale and refetches the ones on screen. With no argument,
 * everything (after switching network). Otherwise queries whose id starts with
 * one of the prefixes ("device." or "network.get").
 */
export function invalidate(prefixes?: ReadonlyArray<string>): void {
  for (const entry of entries.values()) {
    if (prefixes && !prefixes.some((p) => entry.id === p || entry.id.startsWith(p))) continue;
    entry.stale = true;
    if (entry.listeners.size > 0) void fetchEntry(entry);
  }
}

/** Areas whose cached queries also change when a command in the key area writes. */
const RELATED: Record<string, ReadonlyArray<string>> = {
  device: ["profile.", "eero."],
  profile: ["device."],
  eero: ["device.", "network."],
  guest: ["device."],
};

/** What a successful write makes stale: its own area, related areas and network.get. */
export function affectedBy(id: string): ReadonlyArray<string> | undefined {
  const area = id.split(".")[0] ?? id;
  if (id === "network.select" || area === "auth") return undefined;
  return [`${area}.`, "network.get", ...(RELATED[area] ?? [])];
}

// ---------------------------------------------------------------------------
// Visibility

const HIDDEN_POLL_SEC = 300;
const isVisible = () => document.visibilityState === "visible";

// ---------------------------------------------------------------------------
// Hooks

export type QueryOptions = {
  /**
   * `true` polls on the registry's interval for this command, a number polls
   * every that many seconds, `false` (default) fetches once per mount.
   */
  poll?: boolean | number;
  /** `false` skips the query (for example until an id is known). */
  enabled?: boolean;
};

export type QueryState<R> = QuerySnapshot<R> & {
  /**
   * True once a request has been in flight for 150 ms. Fade figures to
   * `opacity-40` while it is set; never show a spinner in page content.
   */
  fading: boolean;
  refetch: () => Promise<void>;
};

const FADE_DELAY_MS = 150;

export function useQuery<R = unknown>(id: string, params?: unknown, options: QueryOptions = {}): QueryState<R> {
  const { poll = false, enabled = true } = options;
  const key = queryKey(id, params);
  const entry = entryFor(id, params);
  const snapshot = useSyncExternalStore(
    (l) => (entry.listeners.add(l), () => entry.listeners.delete(l)),
    () => entry.snapshot,
  ) as QuerySnapshot<R>;
  const commands = useCommands();

  const intervalSec =
    poll === true ? (commands?.find((c) => c.id === id)?.poll ?? null) : typeof poll === "number" ? poll : null;

  // Fetch on mount (or when the key changes) and poll while mounted.
  useEffect(() => {
    if (!enabled) return;
    const current = entryFor(id, params);
    if (current.stale || current.snapshot.fetchedAt === null) void fetchEntry(current);
    if (intervalSec === null) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const schedule = () => {
      const err = current.snapshot.error;
      const wait =
        err?.code === "rate_limited" && err.detail?.retryAfterSec
          ? Math.max(err.detail.retryAfterSec, intervalSec)
          : isVisible()
            ? intervalSec
            : Math.max(intervalSec, HIDDEN_POLL_SEC);
      timer = setTimeout(async () => {
        await fetchEntry(current);
        if (!cancelled) schedule();
      }, pollDelayMs(wait));
    };
    const onVisible = () => {
      if (!isVisible()) return;
      clearTimeout(timer);
      void fetchEntry(current).then(() => !cancelled && schedule());
    };
    schedule();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // `params` is covered by `key`.
  }, [key, enabled, intervalSec]);

  const fading = useFade(snapshot.loading);
  const refetch = useCallback(() => fetchEntry(entryFor(id, params)), [key]);

  return { ...snapshot, fading, refetch };
}

/** True after `active` has been true for FADE_DELAY_MS. */
function useFade(active: boolean): boolean {
  const [fading, setFading] = useState(false);
  useEffect(() => {
    if (!active) {
      setFading(false);
      return;
    }
    const t = setTimeout(() => setFading(true), FADE_DELAY_MS);
    return () => clearTimeout(t);
  }, [active]);
  return fading;
}

export type CommandState<P, R> = {
  /** Runs the command. Resolves with the result envelope; never throws. */
  run: (params?: P) => Promise<ExecuteResult<R>>;
  running: boolean;
  /** The last result, until the next run or reset. */
  result: R | undefined;
  error: ExecuteError | null;
  reset: () => void;
};

/**
 * Runs a command on demand. Confirmation is the caller's job: show the inline
 * confirm or dialog first, then pass `confirm: true` for disruptive and
 * destructive commands. A `needs_confirm` error comes back like any other.
 */
export function useCommand<P = Record<string, unknown>, R = unknown>(id: string): CommandState<P, R> {
  const [state, setState] = useState<{ running: boolean; result: R | undefined; error: ExecuteError | null }>({
    running: false,
    result: undefined,
    error: null,
  });
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(
    async (params?: P) => {
      setState((s) => ({ ...s, running: true, error: null }));
      const res = await execute<R>(id, params);
      if (res.ok) {
        const info = registry?.find((c) => c.id === id);
        if (info?.effect !== "query") invalidate(affectedBy(id));
      }
      if (mounted.current) {
        setState(
          res.ok
            ? { running: false, result: res.result, error: null }
            : { running: false, result: undefined, error: res.error },
        );
      }
      return res;
    },
    [id],
  );
  const reset = useCallback(() => setState({ running: false, result: undefined, error: null }), []);

  return { run, ...state, reset };
}
