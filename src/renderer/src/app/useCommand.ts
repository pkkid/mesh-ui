/**
 * The renderer's only data path: hooks over `window.mesh.execute`.
 *
 * - `useQuery(id, params, { poll })` runs a query, shares the result between
 *   every component asking for the same id and params, keeps the last data
 *   while refetching, and polls on the interval the registry reports for the
 *   command (from src/core/poll.ts), stretched while the window is hidden.
 *   Opening a view whose polled data is older than its interval refetches.
 * - `useCommand(id)` runs a command on demand (writes, or a query the user
 *   triggers) and, after a successful write, refetches the queries it affects.
 * - `refreshAll()` (the header Refresh, Ctrl+R) refetches every mounted query
 *   once with `{ fresh: true }`, so the engine reads eero instead of its
 *   cache. `useRefresh()` gives the button its running state.
 *
 * `execute` never throws: the bridge returns `{ ok, result }` or
 * `{ ok: false, error }` and anything that goes wrong in between becomes a
 * `network_error`. Until the Electron host exposes the engine (M1.4) the
 * bridge below falls back to a stub that answers every call with an error, so
 * the shell renders its empty and missing states.
 * See docs/architecture/ui.md#data-access.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import type { ExecuteOptions } from "../../../core/engine";
import type { ExecuteError, ExecuteResult } from "../../../core/errors";
import type { HostEvent } from "../../../core/model";
import { pollDelayMs } from "../../../core/poll";
import type { CommandInfo } from "../../../core/registry";

// ---------------------------------------------------------------------------
// Bridge

/** The engine half of `window.mesh`, as the preload exposes it from M1.4. */
export type MeshBridge = {
  execute(id: string, params?: unknown, options?: ExecuteOptions): Promise<ExecuteResult>;
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

const sessionListeners = new Set<(expired: boolean, error?: ExecuteError) => void>();

/**
 * Set from the moment the user runs `auth.logout` here until the next sign-in,
 * so the sign-out it causes (its session.changed event and the not_signed_in
 * answers from polls) is not reported as an expired session.
 */
let signedOutByUser = false;

const endSession = (error?: ExecuteError) => sessionListeners.forEach((l) => l(!signedOutByUser, error));

/**
 * Called whenever the session ends: a command reports `not_signed_in` or the
 * host says it signed out. `expired` is false when the user's own sign-out in
 * this window caused it; `error` is the `not_signed_in` answer, when one did.
 * Returns an unsubscribe.
 */
export function onSessionEnded(listener: (expired: boolean, error?: ExecuteError) => void): () => void {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

/** Runs a command. `{ fresh: true }` skips the engine cache for a query. Never throws. */
export async function execute<R = unknown>(id: string, params?: unknown, options?: ExecuteOptions): Promise<ExecuteResult<R>> {
  if (id === "auth.logout") signedOutByUser = true;
  let res: ExecuteResult<R>;
  try {
    res = (await (options?.fresh ? bridge().execute(id, params, options) : bridge().execute(id, params))) as ExecuteResult<R>;
  } catch (err) {
    res = { ok: false, error: { code: "network_error", message: err instanceof Error ? err.message : String(err) } };
  }
  if (id === "auth.logout" && !res.ok) signedOutByUser = false;
  if (id === "auth.login.verify" && res.ok) signedOutByUser = false;
  if (!res.ok && res.error.code === "not_signed_in") endSession(res.error);
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
  /** The in-flight request skips the engine cache. */
  inflightFresh: boolean;
  listeners: Set<() => void>;
  /** Mounted readers with `enabled` on: what Refresh fetches. */
  active: number;
  /** Set when a write made the data stale; the next poll or mount refetches. */
  stale: boolean;
  /** Interval in seconds of each mounted reader that polls. One timer serves them all. */
  pollers: number[];
  /** The poll timer, and the interval it was set for. */
  pollTimer: ReturnType<typeof setTimeout> | undefined;
  pollSec: number | null;
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
    entry = { id, params, snapshot: EMPTY, inflight: null, inflightFresh: false, listeners: new Set(), active: 0, stale: true, pollers: [], pollTimer: undefined, pollSec: null };
    entries.set(key, entry);
  }
  return entry;
}

function update(entry: Entry, patch: Partial<QuerySnapshot<unknown>>) {
  entry.snapshot = { ...entry.snapshot, ...patch };
  entry.listeners.forEach((l) => l());
}

/**
 * Fetches an entry, merging with a request already in flight. A `fresh`
 * fetch skips the engine cache; it joins an in-flight fresh request, and
 * waits for a plain one (which may be a cached answer) before asking again.
 */
function fetchEntry(entry: Entry, fresh = false): Promise<void> {
  if (entry.inflight && (!fresh || entry.inflightFresh)) return entry.inflight;
  if (entry.inflight) return entry.inflight.then(() => fetchEntry(entry, true));
  update(entry, { loading: true });
  entry.stale = false;
  entry.inflightFresh = fresh;
  entry.inflight = execute(entry.id, entry.params, fresh ? { fresh } : undefined).then((res) => {
    entry.inflight = null;
    entry.inflightFresh = false;
    if (res.ok) update(entry, { data: res.result, error: null, loading: false, fetchedAt: Date.now() });
    else update(entry, { error: res.error, loading: false });
  });
  return entry.inflight;
}

/** Subscribes to one query's snapshot. Returns an unsubscribe. */
function watchQuery(id: string, params: unknown, listener: () => void): () => void {
  const entry = entryFor(id, params);
  entry.listeners.add(listener);
  return () => void entry.listeners.delete(listener);
}

/**
 * Marks an enabled reader of a query as mounted (what `useQuery` does while
 * `enabled`), so Refresh fetches it. Returns the unmount.
 */
export function mountQuery(id: string, params: unknown): () => void {
  const entry = entryFor(id, params);
  entry.active++;
  return () => void entry.active--;
}

// ---------------------------------------------------------------------------
// Refresh (header button, Ctrl+R / Cmd+R / F5, palette)

let refreshing: Promise<void> | null = null;
const refreshListeners = new Set<() => void>();

/**
 * Refetches every query on screen (any entry with a mounted, enabled reader:
 * the page, the sidebar, the topbar) once, skipping the engine cache. Calls while one
 * runs get the same promise and start nothing. Errors land on each query, so
 * sections show their usual error notes.
 */
export function refreshAll(): Promise<void> {
  if (refreshing) return refreshing;
  // Disabled readers (waiting for an id or valid input) are left alone.
  const mounted = [...entries.values()].filter((e) => e.active > 0);
  refreshing = Promise.all(mounted.map((e) => fetchEntry(e, true))).then(() => {
    refreshing = null;
    refreshListeners.forEach((l) => l());
  });
  refreshListeners.forEach((l) => l());
  return refreshing;
}

/** True while `refreshAll` runs. */
export const isRefreshing = (): boolean => refreshing !== null;

/** The header Refresh state: `refreshing` while a refresh runs, and `refresh` to start one. */
export function useRefresh(): { refreshing: boolean; refresh: () => Promise<void> } {
  const busy = useSyncExternalStore(
    (l) => (refreshListeners.add(l), () => refreshListeners.delete(l)),
    isRefreshing,
  );
  return { refreshing: busy, refresh: refreshAll };
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
  // The routing lists share one routing read in core, and device detail shows a device's reservation.
  reservation: ["forward.", "pinhole.", "device."],
  forward: ["reservation.", "pinhole.", "device."],
  pinhole: ["reservation.", "forward.", "device."],
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
const isVisible = () => typeof document === "undefined" || document.visibilityState === "visible";

// ---------------------------------------------------------------------------
// Polling: one timer per query, however many readers poll it

/** Sets the entry's poll timer for its shortest reader interval (stretched while hidden or rate limited). */
function schedulePoll(entry: Entry): void {
  clearTimeout(entry.pollTimer);
  entry.pollTimer = undefined;
  entry.pollSec = entry.pollers.length > 0 ? Math.min(...entry.pollers) : null;
  const sec = entry.pollSec;
  if (sec === null) return;
  const err = entry.snapshot.error;
  const wait =
    err?.code === "rate_limited" && err.detail?.retryAfterSec
      ? Math.max(err.detail.retryAfterSec, sec)
      : isVisible()
        ? sec
        : Math.max(sec, HIDDEN_POLL_SEC);
  const timer = setTimeout(async () => {
    await fetchEntry(entry);
    // A reader may have rescheduled meanwhile; only the live timer carries on.
    if (entry.pollTimer === timer) schedulePoll(entry);
  }, pollDelayMs(wait));
  entry.pollTimer = timer;
}

let visibilityHooked = false;

/** When the window shows again, every polled query fetches now and restarts its timer. */
function hookVisibility(): void {
  if (visibilityHooked || typeof document === "undefined") return;
  visibilityHooked = true;
  document.addEventListener("visibilitychange", () => {
    if (!isVisible()) return;
    for (const entry of entries.values()) {
      if (entry.pollers.length === 0) continue;
      clearTimeout(entry.pollTimer);
      entry.pollTimer = undefined;
      void fetchEntry(entry).then(() => entry.pollTimer === undefined && schedulePoll(entry));
    }
  });
}

/**
 * Polls a query every `sec` seconds until the returned stop is called (what
 * `useQuery` does with `poll`). Readers of the same id and params share one
 * timer at the shortest interval any of them asks for, so a query shown by
 * five components still reaches the engine once per interval. Does not fetch
 * on start; the mount does that.
 */
export function pollQuery(id: string, params: unknown, sec: number): () => void {
  hookVisibility();
  const entry = entryFor(id, params);
  entry.pollers.push(sec);
  // Keep a running countdown unless this reader wants a shorter interval.
  if (entry.pollTimer === undefined || entry.pollSec === null || sec < entry.pollSec) schedulePoll(entry);
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    entry.pollers.splice(entry.pollers.indexOf(sec), 1);
    if (entry.pollers.length === 0) {
      clearTimeout(entry.pollTimer);
      entry.pollTimer = undefined;
      entry.pollSec = null;
    }
  };
}

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
  /**
   * Fetches again now and resolves with the new snapshot; `{ fresh: true }`
   * skips the engine cache (a "Check again" or "Run again" button).
   */
  refetch: (options?: { fresh?: boolean }) => Promise<QuerySnapshot<R>>;
};

const FADE_DELAY_MS = 150;

export function useQuery<R = unknown>(id: string, params?: unknown, options: QueryOptions = {}): QueryState<R> {
  const { poll = false, enabled = true } = options;
  const key = queryKey(id, params);
  const entry = entryFor(id, params);
  const snapshot = useSyncExternalStore(
    (l) => watchQuery(id, params, l),
    () => entry.snapshot,
  ) as QuerySnapshot<R>;
  const commands = useCommands();

  const intervalSec =
    poll === true ? (commands?.find((c) => c.id === id)?.poll ?? null) : typeof poll === "number" ? poll : null;

  // Fetch on mount (or when the key changes) and poll while mounted.
  useEffect(() => {
    if (!enabled) return;
    const current = entryFor(id, params);
    const unmount = mountQuery(id, params);
    // A polled query older than its interval (the page was closed meanwhile) refetches on open.
    const fetchedAt = current.snapshot.fetchedAt;
    const old = intervalSec !== null && fetchedAt !== null && Date.now() - fetchedAt >= intervalSec * 1000;
    if (current.stale || fetchedAt === null || old) void fetchEntry(current);
    if (intervalSec === null) return unmount;

    const stop = pollQuery(id, params, intervalSec);
    return () => {
      stop();
      unmount();
    };
    // `params` is covered by `key`.
  }, [key, enabled, intervalSec]);

  const fading = useFade(snapshot.loading);
  const refetch = useCallback((options?: { fresh?: boolean }) => {
    const current = entryFor(id, params);
    return fetchEntry(current, options?.fresh === true).then(() => current.snapshot as QuerySnapshot<R>);
  }, [key]);

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
 * Runs a command on demand. Confirmation is the caller's job: show the
 * confirm dialog first, then pass `confirm: true` for disruptive and
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
