/**
 * Request inspection for the app's F12 dev tools panel
 * (docs/architecture/devtools.md).
 *
 * Off by default, and off means off: with no listener set, the eero client
 * pays one null check per request and the engine runs commands exactly as
 * before (no AsyncLocalStorage context). While a listener is set, each HTTP
 * attempt becomes an `InspectRecord`, sent to the listener when it starts
 * and again as it completes. Nothing is kept here once a record is sent:
 * the panel owns the list.
 *
 * What a record never holds: the session token or the pending sign-in token
 * (scrubbed from every header, body and URL), the `Cookie` and
 * `X-User-Token` headers' values, `Set-Cookie` session values, keys named
 * like a token in any body, or the sign-in verification code. Response
 * bodies are cut at RESPONSE_CAP_BYTES. Records live in memory only: they
 * are never written to disk, the request log or a log file.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export type InspectOutcome = "pending" | "ok" | "retry" | "refresh" | "error";

export type InspectRecord = {
  id: number;
  /** Epoch ms the attempt started (before waiting for a rate limit slot). */
  startedAt: number;
  method: string;
  /** The full URL, query included (no secrets ever travel in it). */
  url: string;
  /** The command that caused it ("device.list"), or null (a session refresh, a background read). */
  command: string | null;
  /** 0 for the first attempt; 1 and up for replays after a retry or refresh. */
  attempt: number;
  requestHeaders: Array<[string, string]>;
  requestBody: string | null;
  status: number | null;
  responseHeaders: Array<[string, string]>;
  /** Redacted, and cut at RESPONSE_CAP_BYTES (`truncated`). */
  responseBody: string | null;
  /** Bytes eero sent, before redaction or the cut. */
  responseBytes: number;
  truncated: boolean;
  /** queued: waiting for a rate limit slot; wait: until eero's headers; download: reading the body. */
  timing: { queuedMs: number; waitMs: number; downloadMs: number; totalMs: number } | null;
  outcome: InspectOutcome;
  eeroError: string | null;
  error: string | null;
};

export type InspectListener = (record: InspectRecord) => void;

export const RESPONSE_CAP_BYTES = 256 * 1024;
const HIDDEN = "(hidden)";

let listener: InspectListener | null = null;
let commandStore: AsyncLocalStorage<string> | null = null;
let nextId = 1;

/** Starts (a listener) or stops (null) inspection. */
export function setInspector(next: InspectListener | null): void {
  listener = next;
}

export const inspecting = (): boolean => listener !== null;

/** Runs a command with its id visible to the requests it makes, only while inspecting. */
export function withCommand<T>(id: string, run: () => T): T {
  if (!listener) return run();
  commandStore ??= new AsyncLocalStorage<string>();
  return commandStore.run(id, run);
}

/** One attempt being captured. */
export class Capture {
  readonly record: InspectRecord;
  private readonly secrets: string[];

  constructor(method: string, url: string, headers: Record<string, string>, body: string | undefined, attempt: number, secrets: Array<string | null>) {
    this.secrets = secrets.filter((s): s is string => typeof s === "string" && s.length >= 8);
    this.record = {
      id: nextId++,
      startedAt: Date.now(),
      method,
      url: this.scrub(url),
      command: commandStore?.getStore() ?? null,
      attempt,
      requestHeaders: Object.entries(headers).map(([k, v]) => [k, this.header(k, v)]),
      requestBody: body === undefined ? null : this.scrub(redactBody(body, REQUEST_KEYS)),
      status: null,
      responseHeaders: [],
      responseBody: null,
      responseBytes: 0,
      truncated: false,
      timing: null,
      outcome: "pending",
      eeroError: null,
      error: null,
    };
    this.emit();
  }

  /** eero answered. `outcome` is provisional; the client's retry logic may set it again. */
  response(status: number, headers: Headers, text: string, timing: { queuedMs: number; waitMs: number; downloadMs: number }): void {
    const r = this.record;
    r.status = status;
    r.responseHeaders = headerList(headers).map(([k, v]) => [k, this.header(k, v)]);
    r.responseBytes = Buffer.byteLength(text, "utf8");
    const body = this.scrub(redactBody(text, RESPONSE_KEYS));
    r.truncated = Buffer.byteLength(body, "utf8") > RESPONSE_CAP_BYTES;
    r.responseBody = r.truncated ? Buffer.from(body, "utf8").subarray(0, RESPONSE_CAP_BYTES).toString("utf8") : body;
    r.timing = { ...timing, totalMs: Date.now() - r.startedAt };
    r.outcome = status >= 200 && status < 300 ? "ok" : "error";
    this.emit();
  }

  /** No answer (timeout, network failure). */
  fail(message: string): void {
    const r = this.record;
    r.error = this.scrub(message);
    r.outcome = "error";
    r.timing ??= { queuedMs: 0, waitMs: Date.now() - r.startedAt, downloadMs: 0, totalMs: Date.now() - r.startedAt };
    this.emit();
  }

  /** The client's verdict on this attempt (ok, retry, refresh, error). */
  settle(outcome: Exclude<InspectOutcome, "pending">, eeroError: string | null, message?: string): void {
    const r = this.record;
    r.outcome = outcome;
    r.eeroError = eeroError;
    if (message) r.error = this.scrub(message);
    this.emit();
  }

  private header(name: string, value: string): string {
    const key = name.toLowerCase();
    if (key === "cookie") return value.replace(/(^|;\s*)s=[^;]*/g, `$1s=${HIDDEN}`);
    if (key === "x-user-token") return HIDDEN;
    if (key === "set-cookie") return value.replace(/(^|,\s*)s=[^;,]*/g, `$1s=${HIDDEN}`);
    return this.scrub(value);
  }

  private scrub(text: string): string {
    let out = text;
    for (const s of this.secrets) out = out.split(s).join(HIDDEN);
    return out;
  }

  private emit(): void {
    // A listener removed mid-request gets nothing more.
    listener?.({ ...this.record, requestHeaders: [...this.record.requestHeaders], responseHeaders: [...this.record.responseHeaders] });
  }
}

/** A Capture for one attempt, or null while not inspecting (the only cost when off). */
export function beginCapture(
  method: string,
  url: string,
  headers: Record<string, string>,
  body: string | undefined,
  attempt: number,
  secrets: Array<string | null>,
): Capture | null {
  return listener ? new Capture(method, url, headers, body, attempt, secrets) : null;
}

/** Keys hidden in request bodies: tokens, the verification code, passwords. */
const REQUEST_KEYS = /token|^code$|password/i;
/** Keys hidden in response bodies: tokens. */
const RESPONSE_KEYS = /token/i;

/** Hides matching keys in a JSON or form body; anything else comes back unchanged. */
export function redactBody(text: string, keys: RegExp): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.stringify(redactValue(JSON.parse(trimmed), keys));
    } catch {
      return text;
    }
  }
  if (/^[^=&\s]+=[^&]*(&[^=&\s]+=[^&]*)*$/.test(trimmed)) {
    const form = new URLSearchParams(trimmed);
    for (const k of [...form.keys()]) if (keys.test(k)) form.set(k, HIDDEN);
    return form.toString();
  }
  return text;
}

function redactValue(v: unknown, keys: RegExp): unknown {
  if (Array.isArray(v)) return v.map((x) => redactValue(x, keys));
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, keys.test(k) && x !== null && typeof x !== "object" ? HIDDEN : redactValue(x, keys)]));
  }
  return v;
}

function headerList(headers: Headers): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  headers.forEach((value, key) => {
    if (key !== "set-cookie") out.push([key, value]);
  });
  const cookies = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  for (const c of cookies) out.push(["set-cookie", c]);
  return out;
}
