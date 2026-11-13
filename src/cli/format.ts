/**
 * Output for `mesh-ui`: JSON (exactly what `engine.execute` returned) and
 * tables for people at a terminal. Values use the shared formatters in
 * src/core/format.ts so a quantity reads the same as in the app. See
 * docs/architecture/cli.md#output-formats.
 */

import { formatBytes, formatMbps, formatRelative, MISSING } from "../core/format";
import type { ExecuteError } from "../core/errors";

export type Style = { color: boolean };

const ansi = (code: string) => (s: string, style: Style) => (style.color ? `\u001b[${code}m${s}\u001b[0m` : s);
export const bold = ansi("1");
export const dim = ansi("2");
export const red = ansi("31");

export const MASK = "********";

/** Keys that hold a credential in a `sensitive` command's result. */
const SECRET_KEY = /pass(word|phrase)?|secret|psk|token|key$/i;

/** Masks credential fields, recursively. Only used for table output. */
export function maskSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskSensitive);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        SECRET_KEY.test(k) && v !== null && v !== undefined && typeof v !== "object" ? MASK : maskSensitive(v),
      ]),
    );
  }
  return value;
}

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** One value as a table cell. Nested values are summarised; use json for detail. */
export function cell(key: string, value: unknown, now: number): string {
  if (value === null || value === undefined || value === "") return MISSING;
  if (Array.isArray(value)) return `${value.length} ${value.length === 1 ? "item" : "items"}`;
  if (typeof value === "object") {
    const n = Object.keys(value).length;
    return `${n} ${n === 1 ? "field" : "fields"}`;
  }
  if (typeof value === "number") {
    if (/mbps$/i.test(key)) return formatMbps(value);
    if (/bytes$/i.test(key)) return formatBytes(value);
    return String(value);
  }
  if (typeof value === "string" && ISO_TIME.test(value) && (/(At|Seen|Time)$/.test(key) || key === "at")) {
    return formatRelative(value, now);
  }
  return String(value);
}

const isScalar = (v: unknown) => v === null || v === undefined || typeof v !== "object";

/** Header text from a camelCase key: `devicesOnline` to `DEVICES ONLINE`. */
const header = (key: string) => key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toUpperCase();

function columns(rows: Record<string, unknown>[], max = 6): string[] {
  const keys: string[] = [];
  for (const row of rows) {
    for (const [k, v] of Object.entries(row)) {
      if (keys.length >= max) return keys;
      if (!keys.includes(k) && isScalar(v)) keys.push(k);
    }
  }
  return keys;
}

/** Left-aligned columns separated by two spaces; numbers right-aligned. */
export function renderGrid(head: string[], rows: string[][], style: Style, rightAlign: boolean[] = []): string {
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (cells: string[]) =>
    cells
      .map((c, i) => (rightAlign[i] ? c.padStart(widths[i] ?? 0) : c.padEnd(widths[i] ?? 0)))
      .join("  ")
      .trimEnd();
  const out = head.length ? [bold(line(head), style)] : [];
  for (const r of rows) out.push(line(r));
  return `${out.join("\n")}\n`;
}

/** A command result as a table: arrays of objects as columns, objects as key value rows. */
export function renderTable(result: unknown, style: Style, now: number): string {
  if (Array.isArray(result)) {
    if (result.length === 0) return "No results.\n";
    if (result.every((r) => r && typeof r === "object" && !Array.isArray(r))) {
      const rows = result as Record<string, unknown>[];
      const keys = columns(rows);
      const cells = rows.map((r) => keys.map((k) => cell(k, r[k], now)));
      const numeric = keys.map((k) => rows.every((r) => typeof r[k] === "number" || r[k] == null));
      return renderGrid(keys.map(header), cells, style, numeric);
    }
    return `${result.map((v) => cell("", v, now)).join("\n")}\n`;
  }
  if (result && typeof result === "object") {
    const entries = Object.entries(result as Record<string, unknown>);
    if (entries.length === 0) return "No fields.\n";
    const width = Math.max(...entries.map(([k]) => k.length));
    return `${entries.map(([k, v]) => `${dim(k.padEnd(width), style)}  ${cell(k, v, now)}`).join("\n")}\n`;
  }
  if (result === undefined) return "Done.\n";
  return `${cell("", result, now)}\n`;
}

/** One line on stderr for table output: `error needs_confirm: ...`. */
export function errorLine(error: ExecuteError, style: Style): string {
  return `${red("error", style)} ${error.code}: ${error.message}\n`;
}

export const json = (value: unknown) => `${JSON.stringify(value)}\n`;
export const prettyJson = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
