/**
 * The F12 dev tools panel's view logic (docs/architecture/devtools.md): its
 * open state, the record list it keeps, filtering and the words it shows.
 * All of it is renderer view state; the records come from main over
 * `window.mesh.devtools` only while the panel records.
 */
import { useSyncExternalStore } from "react";

import { useShortcut } from "~/lib/shortcuts";

import type { InspectRecord } from "../../../../core/eero/inspect";

// ---------------------------------------------------------------------------
// Open state (F12)

let open = false;
const listeners = new Set<() => void>();

export function setDevToolsOpen(next: boolean): void {
  if (open === next) return;
  open = next;
  listeners.forEach((l) => l());
}

export const toggleDevTools = (): void => setDevToolsOpen(!open);

export function useDevToolsOpen(): boolean {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => open,
  );
}

/** F12 by default (rebindable in Settings) opens and closes the panel, as in browsers. */
export function useDevToolsShortcut(): void {
  useShortcut("devtools.toggle", toggleDevTools);
}

// ---------------------------------------------------------------------------
// Records

/** The most requests the panel keeps; older ones drop off. */
export const MAX_RECORDS = 300;

/** Adds or updates a record (same id), newest last, keeping at most MAX_RECORDS. */
export function upsertRecord(list: readonly InspectRecord[], record: InspectRecord): InspectRecord[] {
  const at = list.findIndex((r) => r.id === record.id);
  if (at >= 0) {
    const next = list.slice();
    next[at] = record;
    return next;
  }
  const next = [...list, record];
  return next.length > MAX_RECORDS ? next.slice(next.length - MAX_RECORDS) : next;
}

export const isError = (r: InspectRecord): boolean => r.outcome === "error" || (r.status !== null && r.status >= 400);

/** The path and query, without the origin. */
export function requestPath(r: InspectRecord): string {
  try {
    const u = new URL(r.url);
    return u.pathname + u.search;
  } catch {
    return r.url;
  }
}

/** Matches the filter text against method, path, command and status. */
export function matches(r: InspectRecord, query: string, errorsOnly: boolean): boolean {
  if (errorsOnly && !isError(r)) return false;
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return `${r.method} ${requestPath(r)} ${r.command ?? ""} ${r.status ?? ""} ${r.eeroError ?? ""}`.toLowerCase().includes(q);
}

/** The small tag after a path: what the client did with this attempt. */
export function tagFor(r: InspectRecord): string | null {
  if (r.outcome === "pending") return "pending";
  if (r.outcome === "refresh") return "refreshed";
  if (r.outcome === "retry") return r.status === 429 ? "rate limited" : "retry";
  if (r.status === null && r.outcome === "error") return "no response";
  if (r.attempt > 0) return "replay";
  return null;
}

/** "412 ms", "1.2 s", "-". */
export function formatMs(ms: number | null | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "-";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}
