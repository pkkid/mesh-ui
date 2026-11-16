/**
 * The audit log: one JSON line per CLI or MCP command (time, surface, id,
 * effect, ok or error code, params with secrets removed), appended to
 * `audit.jsonl` in the config dir and capped at AUDIT_MAX_LINES. Results are
 * never logged, so no token, password or `WIFI:` payload can reach it.
 * The engine writes it; see docs/architecture/security.md#audit-log.
 */

import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ErrorCode, ExecuteResult } from "./errors";
import type { AuditList, Effect, AuditEntry as ModelAuditEntry } from "./model";
import type { Surface } from "./spec";

/** The file keeps the newest this many lines. */
export const AUDIT_MAX_LINES = 1_000;

export type AuditEntry = {
  /** ISO time the command finished. */
  time: string;
  surface: Surface;
  id: string;
  /** null for an unknown command. */
  effect: Effect | null;
  ok: boolean;
  /** The error code when not ok. */
  code?: ErrorCode;
  /** The params as given, secrets removed. */
  params: unknown;
};

export interface AuditLog {
  append(entry: AuditEntry): Promise<void>;
}

/** Keys whose values are secrets: passwords, codes, tokens, keys. Matched case-insensitively. */
const SECRET_KEY = /password|passphrase|passcode|^psk$|secret|token|cookie|credential|^code$|^(api_?)?key$/i;
/** A Wi-Fi QR payload carries the password. */
const WIFI_PAYLOAD = /^\s*WIFI:/i;
const REMOVED = "[removed]";
const MAX_DEPTH = 6;

/** A copy of `value` with secret fields and `WIFI:` strings replaced by "[removed]". */
export function redactParams(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return WIFI_PAYLOAD.test(value) ? REMOVED : value;
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return REMOVED;
  if (Array.isArray(value)) return value.map((v) => redactParams(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEY.test(k) && v !== null && v !== undefined ? REMOVED : redactParams(v, depth + 1);
  }
  return out;
}

export function auditEntry(e: {
  time: number;
  surface: Surface;
  id: string;
  effect: Effect | null;
  params: unknown;
  outcome: ExecuteResult<unknown>;
}): AuditEntry {
  return {
    time: new Date(e.time).toISOString(),
    surface: e.surface,
    id: e.id,
    effect: e.effect,
    ok: e.outcome.ok,
    ...(e.outcome.ok ? {} : { code: e.outcome.error.code }),
    params: redactParams(e.params ?? {}),
  };
}

/** Appends to a JSONL file (mode 600), keeping only the newest `maxLines` lines. */
export function fileAudit(path: string, maxLines = AUDIT_MAX_LINES): AuditLog {
  let lines: number | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  const countLines = async () => {
    try {
      return (await readFile(path, "utf8")).split("\n").filter(Boolean).length;
    } catch {
      return 0;
    }
  };

  const write = async (entry: AuditEntry) => {
    await mkdir(dirname(path), { recursive: true });
    lines ??= await countLines();
    await appendFile(path, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
    lines++;
    if (lines > maxLines) {
      const kept = (await readFile(path, "utf8")).split("\n").filter(Boolean).slice(-maxLines);
      const tmp = `${path}.${process.pid}.tmp`;
      await writeFile(tmp, `${kept.join("\n")}\n`, { mode: 0o600 });
      await rename(tmp, path);
      lines = kept.length;
    }
  };

  return {
    append(entry) {
      const next = queue.then(() => write(entry));
      queue = next.catch(() => undefined);
      return next;
    },
  };
}

/** Keeps entries in memory (tests). */
export function memoryAudit(): AuditLog & { entries: AuditEntry[] } {
  const entries: AuditEntry[] = [];
  return {
    entries,
    append: async (entry) => {
      entries.push(entry);
    },
  };
}

/** A local day as YYYY-MM-DD. */
const localDay = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** The 7 local days ending today, oldest first, as YYYY-MM-DD. */
export function weekDays(nowMs: number): string[] {
  const days: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(nowMs);
    d.setDate(d.getDate() - i);
    days.push(localDay(d.getTime()));
  }
  return days;
}

const EFFECTS: readonly Effect[] = ["query", "write", "disruptive", "destructive"];

/** One audit line as Account & Settings lists it, or null when it is malformed. Params are never read. */
function parseLine(line: string): (ModelAuditEntry & { ms: number }) | null {
  let v: unknown;
  try {
    v = JSON.parse(line);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object") return null;
  const e = v as Record<string, unknown>;
  const ms = typeof e.time === "string" ? Date.parse(e.time) : Number.NaN;
  if (!Number.isFinite(ms) || (e.surface !== "cli" && e.surface !== "mcp") || typeof e.id !== "string" || !e.id || typeof e.ok !== "boolean") return null;
  const effect = typeof e.effect === "string" && (EFFECTS as readonly unknown[]).includes(e.effect) ? (e.effect as Effect) : null;
  return { at: new Date(ms).toISOString(), ms, surface: e.surface, id: e.id, effect, ok: e.ok, code: typeof e.code === "string" ? e.code : null };
}

/**
 * Reads `audit.jsonl` into the Account & Settings summary (`app.audit.list`):
 * this week's commands newest first (at most `limit`), the count per local
 * day, how many were refused with `needs_confirm`, and the newest MCP
 * command at any age. Reads only the newest AUDIT_MAX_LINES lines, skips
 * malformed ones and never reads params or results. `path` is null when the
 * host has no config dir; a missing file is an empty log.
 */
export async function readAudit(path: string | null, opts: { now: number; limit: number }): Promise<AuditList> {
  const days = weekDays(opts.now);
  const counts = new Map(days.map((d) => [d, 0]));
  let text = "";
  if (path) {
    try {
      text = await readFile(path, "utf8");
    } catch {
      text = "";
    }
  }
  const lines = text.split("\n").filter((l) => l.trim()).slice(-AUDIT_MAX_LINES);
  const week: (ModelAuditEntry & { ms: number })[] = [];
  let mcpLast: number | null = null;
  for (const line of lines) {
    const e = parseLine(line);
    if (!e) continue;
    if (e.surface === "mcp" && (mcpLast === null || e.ms > mcpLast)) mcpLast = e.ms;
    const day = localDay(e.ms);
    const n = counts.get(day);
    if (n === undefined) continue;
    counts.set(day, n + 1);
    week.push(e);
  }
  week.sort((a, b) => b.ms - a.ms);
  return {
    entries: week.slice(0, opts.limit).map(({ ms: _ms, ...e }) => e),
    week: days.map((date) => ({ date, count: counts.get(date) ?? 0 })),
    weekTotal: week.length,
    needsConfirm: week.filter((e) => e.code === "needs_confirm").length,
    mcpLastAt: mcpLast === null ? null : new Date(mcpLast).toISOString(),
  };
}
