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
import type { AuditList, Effect } from "./model";
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

/** The 7 local days ending today, oldest first, as YYYY-MM-DD. */
export function weekDays(nowMs: number): string[] {
  const days: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(nowMs);
    d.setDate(d.getDate() - i);
    days.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  }
  return days;
}

/**
 * Reads `audit.jsonl` into the App & account summary (`app.audit.list`).
 * Stub until M6.6: answers an empty week, so the command and its callers
 * are in place. `path` is null when the host has no config dir.
 */
export async function readAudit(_path: string | null, opts: { now: number; limit: number }): Promise<AuditList> {
  return { entries: [], week: weekDays(opts.now).map((date) => ({ date, count: 0 })), weekTotal: 0, needsConfirm: 0, mcpLastAt: null };
}
