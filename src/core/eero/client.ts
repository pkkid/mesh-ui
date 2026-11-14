/**
 * EeroClient: the only code in Mesh UI that sends requests to eero. It owns
 * the session token (loaded from and saved to the host SecretStore), builds
 * requests (headers, body encodings, versions, origin check), applies the
 * rate limiter, refreshes the session on `error.session.refresh`, adopts
 * rotated `Set-Cookie: s=` tokens, and maps failures to BackendError codes.
 * It returns the raw `data` of eero's envelope; mapping to the model happens
 * in the backend areas. See docs/architecture/eero-client.md.
 *
 * The token never appears in a return value, an error message or a log entry.
 */

import type { AuthState, SecretStore } from "../backend";
import { BackendError, type BackendErrorCode } from "../errors";
import { parseRetryAfter, RateLimiter, rateLimited } from "./ratelimit";
import type { RawEnvelope, RawLoginResponse, RawVerifyResponse } from "./raw";
import { type ApiVersion, checkOrigin, EERO_ORIGIN, redactPath, resolveUrl } from "./urls";

export const DEFAULT_USER_AGENT = "eero-ios/2026.8.1 (iPhone; iOS 18.5)";
export const DEFAULT_TIMEOUT_MS = 30_000;
export const MAX_BODY_BYTES = 10 * 1024 * 1024;
/** Backoff before the first and second retry of a query (network error or 5xx). */
export const RETRY_BACKOFF_MS = [1_000, 4_000] as const;
/** Pause after a 429 that has no Retry-After. */
export const DEFAULT_RETRY_AFTER_MS = 30_000;
/**
 * How long a session GET answer is shared with identical GETs. One page load
 * runs many commands that each read `GET {net}`, its permissions or the
 * account; without sharing, two page loads spent the whole 80 a minute budget
 * and every later read queued for up to a minute. Far under every poll interval
 * (60 s and up), and any write or session change drops it.
 */
export const READ_SHARE_MS = 5_000;
/** Cap on a public (cookieless) answer such as the release notes manifest. */
export const MAX_PUBLIC_BYTES = 1024 * 1024;

export type Method = "GET" | "POST" | "PUT" | "DELETE";
/** json: JSON object; form: x-www-form-urlencoded; empty: the literal body `""`; none: no body. */
export type Encoding = "json" | "form" | "empty" | "none";
/** Only queries are retried. */
export type RequestEffect = "query" | "write";
/** Which token goes in the cookie: the session, the pending sign-in, or none. */
export type AuthMode = "session" | "pending" | "none";

export type QueryValue = string | number | boolean | null | undefined;

export type RequestSpec = {
  method: Method;
  /** A path (`/2.2/account`) or a link eero handed back. */
  path: string;
  /** Rewrites the version prefix, e.g. "2.3" for device writes. */
  version?: ApiVersion;
  query?: Record<string, QueryValue>;
  body?: Record<string, unknown>;
  /** Default: none for GET, json when there is a body, else empty. */
  encoding?: Encoding;
  /** Default: query for GET, write otherwise. */
  effect?: RequestEffect;
  /** Default: session. */
  auth?: AuthMode;
  /**
   * false: never take an answer that already came back; join only a read
   * still in flight (started at most a moment ago), else send a new one,
   * which later identical reads then share. For credential reads, so a
   * password changed elsewhere shows on the next reveal. Default true.
   */
  share?: boolean;
};

/** One line per HTTP attempt. Never holds a token, cookie, header or body. */
export type RequestLogEntry = {
  method: Method;
  /** Path with ids replaced by `:id`. */
  path: string;
  status: number | null;
  eeroError: string | null;
  ms: number;
  outcome: "ok" | "retry" | "refresh" | "error";
  code?: BackendErrorCode;
  message?: string;
};

export type EeroClientOptions = {
  secrets: SecretStore;
  /** null or absent: DEFAULT_USER_AGENT. */
  userAgent?: string | null;
  /** Dev and test only: a loopback fake eero server. */
  origin?: string;
  /** Tests only: an in-process fetch (the fake eero server's `fetch`). */
  fetch?: typeof fetch;
  limiter?: RateLimiter;
  timeoutMs?: number;
  /**
   * How long identical session GETs share one answer; 0 shares only while in
   * flight. Default READ_SHARE_MS, or 0 when `fetch` is injected, since those
   * tests change fake server state between reads.
   */
  readShareMs?: number;
  onLog?: (entry: RequestLogEntry) => void;
  /** Called when the session starts or ends (sign-in, sign-out, expiry). */
  onSessionChange?: (signedIn: boolean) => void;
};

type Exchange<T> = { data: T; cookieToken: string | null };

type SharedRead = { promise: Promise<Exchange<unknown>>; expires: number };

type Attempt = {
  status: number;
  envelope: RawEnvelope | null;
  cookieToken: string | null;
  retryAfter: string | null;
};

/** 401 codes that mean "refresh and replay once". */
const REFRESH_ERRORS = new Set(["error.session.refresh", "error.session.invalid"]);
const DEAD_SESSION_ERRORS = new Set(["error.session.expired", "error.session.invalid", "error.session.revoked", "error.session.refresh"]);
const WRONG_CODE_ERRORS = /^error\.(code\.invalid|verification\.)/;
const BAD_PARAM_ERRORS = new Set(["error.reservation.ip.invalid", "error.assignment.ip.unavailable", "error.login.invalid"]);
const NOT_AVAILABLE_ERRORS = new Set(["error.eero.not.capable", "error.network.unavailable"]);
const COOKIE_TOKEN = /(?:^|,\s*)s=([^; ,]+)/;
const RETIRED_TOKEN = /^eero-web-/;

export class EeroClient {
  readonly origin: string;
  readonly limiter: RateLimiter;
  private readonly secrets: SecretStore;
  private readonly userAgent: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  private readonly readShareMs: number;
  /** Session GETs in flight or answered in the last readShareMs, by URL. */
  private readonly shared = new Map<string, SharedRead>();
  private readonly onLog: ((entry: RequestLogEntry) => void) | undefined;
  private readonly onSessionChange: ((signedIn: boolean) => void) | undefined;

  private token: string | null = null;
  private loaded: Promise<void> | null = null;
  private pendingToken: string | null = null;
  private login: string | null = null;
  private refreshing: Promise<void> | null = null;

  constructor(options: EeroClientOptions) {
    this.origin = options.origin ? checkOrigin(options.origin) : EERO_ORIGIN;
    this.secrets = options.secrets;
    this.userAgent = options.userAgent?.trim() || DEFAULT_USER_AGENT;
    this.fetchFn = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.limiter = options.limiter ?? new RateLimiter();
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.readShareMs = options.readShareMs ?? (options.fetch ? 0 : READ_SHARE_MS);
    this.onLog = options.onLog;
    this.onSessionChange = options.onSessionChange;
  }

  /** Sends one request (with refresh, retries and rate limits) and returns eero's `data`. */
  async request<T = unknown>(spec: RequestSpec): Promise<T> {
    return (await this.exchange<T>(spec)).data;
  }

  /**
   * GETs a public JSON document outside eero's API, such as the release notes
   * manifest (`updates.manifest_resource`). It never carries the session:
   * no cookie, no token header. https only (the fake server's own loopback
   * origin is the one exception, for dev and tests), no credentials in the
   * URL, no redirects, the usual timeout and a 1 MB cap that stops reading
   * as soon as it is passed. Not rate limited: it is not the eero API.
   */
  async fetchPublic<T = unknown>(target: string): Promise<T> {
    let url: URL;
    try {
      url = new URL(target);
    } catch {
      throw publicRefused();
    }
    const fakeOrigin = this.origin !== EERO_ORIGIN && url.origin === this.origin;
    if ((url.protocol !== "https:" && !fakeOrigin) || url.username || url.password) throw publicRefused();
    const started = Date.now();
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    let status: number | null = null;
    try {
      const headers = { Accept: "application/json", "User-Agent": this.userAgent };
      const response = await this.fetchFn(url.href, { method: "GET", headers, credentials: "omit", redirect: "error", signal: controller.signal });
      status = response.status;
      if (!isOk(response.status)) {
        await response.body?.cancel().catch(() => undefined);
        throw new BackendError("eero_error", `eero's release notes answered ${response.status}.`, { status: response.status });
      }
      const text = await readCapped(response, MAX_PUBLIC_BYTES);
      let parsed: T;
      try {
        parsed = JSON.parse(text) as T;
      } catch {
        throw new BackendError("eero_error", "eero sent release notes Mesh UI could not read.");
      }
      this.onLog?.({ method: "GET", path: url.origin, status, eeroError: null, ms: Date.now() - started, outcome: "ok" });
      return parsed;
    } catch (err) {
      const e =
        err instanceof BackendError
          ? err
          : timedOut
            ? new BackendError("network_error", `eero's release notes did not answer within ${Math.round(this.timeoutMs / 1000)} s.`)
            : new BackendError("network_error", "Could not reach eero's release notes.");
      this.onLog?.({ method: "GET", path: url.origin, status, eeroError: null, ms: Date.now() - started, outcome: "error", code: e.code, message: e.message });
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  // -------------------------------------------------------------------------
  // Session

  /** Sign-in state. Never includes the token. */
  async status(): Promise<AuthState> {
    await this.ensureLoaded();
    return {
      signedIn: this.token !== null,
      pending: this.pendingToken !== null,
      login: this.login ? maskLogin(this.login) : null,
      storage: await this.secrets.storage(),
    };
  }

  /** Sends a code to an email or E.164 phone. The session becomes pending. */
  async startLogin(login: string): Promise<void> {
    const value = login.trim();
    if (!value) throw new BackendError("bad_params", "Enter the email or phone number of your eero account.");
    const { data, cookieToken } = await this.exchange<RawLoginResponse | null>({
      method: "POST",
      path: "/2.2/login",
      body: { login: value },
      encoding: "form",
      auth: "none",
    });
    const pending = data?.user_token ?? cookieToken;
    if (!pending) throw new BackendError("eero_error", "eero did not start the sign-in. Try again.");
    this.pendingToken = pending;
    this.login = value;
  }

  /** Verifies the code. On success the pending token becomes the session; a wrong code keeps it pending. */
  async verifyLogin(code: string): Promise<void> {
    const { data, cookieToken } = await this.exchange<RawVerifyResponse | null>({
      method: "POST",
      path: "/2.2/login/verify",
      body: { code: code.trim() },
      encoding: "form",
      auth: "pending",
    });
    const session = cookieToken ?? data?.user_token ?? data?.session_token ?? this.pendingToken;
    this.pendingToken = null;
    if (!session || RETIRED_TOKEN.test(session)) {
      throw new BackendError("eero_error", "eero gave a sign-in that Mesh UI cannot use. Try signing in again.");
    }
    this.token = session;
    this.shared.clear();
    this.loaded = Promise.resolve();
    await this.secrets.save(session);
    this.onSessionChange?.(true);
  }

  /** Asks eero to send the code again. */
  async resendLogin(): Promise<void> {
    const { data, cookieToken } = await this.exchange<RawLoginResponse | null>({
      method: "POST",
      path: "/2.2/login/resend",
      encoding: "empty",
      auth: "pending",
    });
    const next = cookieToken ?? data?.user_token;
    if (next) this.pendingToken = next;
  }

  /** Clears the local session first, then tells eero, best effort. */
  async logout(): Promise<void> {
    await this.ensureLoaded();
    const token = this.token;
    const wasSignedIn = token !== null;
    this.token = null;
    this.pendingToken = null;
    this.login = null;
    this.shared.clear();
    await this.secrets.clear();
    if (wasSignedIn) this.onSessionChange?.(false);
    if (!token) return;
    try {
      await this.limiter.serial(() => this.attempt({ method: "POST", path: "/2.2/logout", encoding: "empty" }, token));
    } catch {
      // Best effort: the local session is already gone.
    }
  }

  // -------------------------------------------------------------------------
  // Pipeline

  private async exchange<T>(spec: RequestSpec): Promise<Exchange<T>> {
    const effect = spec.effect ?? (spec.method === "GET" ? "query" : "write");
    if (effect === "write") {
      // A write may change anything a shared read holds: drop them before and after.
      this.shared.clear();
      return this.limiter.serial(() => this.withRetries<T>(spec, effect)).finally(() => this.shared.clear());
    }
    if (spec.method !== "GET" || (spec.auth ?? "session") !== "session") return this.withRetries<T>(spec, effect);
    return this.sharedRead<T>(spec);
  }

  /**
   * Identical session GETs share one request while it is in flight and for
   * readShareMs after it succeeds. Each caller gets its own copy of the data.
   */
  private async sharedRead<T>(spec: RequestSpec): Promise<Exchange<T>> {
    let key: string;
    try {
      key = requestUrl(spec, this.origin).href;
    } catch {
      // A refused url: let the normal path log and map it.
      return this.withRetries<T>(spec, "query");
    }
    const now = Date.now();
    for (const [k, e] of this.shared) if (e.expires <= now) this.shared.delete(k);
    let entry = this.shared.get(key);
    // A credential read never takes a finished answer, only one still in flight.
    if (entry && spec.share === false && entry.expires !== Number.POSITIVE_INFINITY) entry = undefined;
    if (!entry) {
      const fresh: SharedRead = { promise: this.withRetries<unknown>(spec, "query"), expires: Number.POSITIVE_INFINITY };
      entry = fresh;
      this.shared.set(key, fresh);
      fresh.promise.then(
        () => {
          fresh.expires = Date.now() + this.readShareMs;
          if (this.readShareMs <= 0 && this.shared.get(key) === fresh) this.shared.delete(key);
        },
        () => {
          if (this.shared.get(key) === fresh) this.shared.delete(key);
        },
      );
    }
    const { data, cookieToken } = await entry.promise;
    return { data: structuredClone(data) as T, cookieToken };
  }

  private async withRetries<T>(spec: RequestSpec, effect: RequestEffect): Promise<Exchange<T>> {
    const auth = spec.auth ?? "session";
    let retries = 0;
    let refreshed = false;
    let reread = false;
    for (;;) {
      const token = await this.tokenFor(auth);
      const started = Date.now();
      let res: Attempt;
      try {
        res = await this.attempt(spec, token);
      } catch (err) {
        const canRetry = effect === "query" && retries < RETRY_BACKOFF_MS.length && err instanceof BackendError && err.code === "network_error";
        this.log(spec, null, null, started, canRetry ? "retry" : "error", err);
        if (!canRetry) throw err;
        await sleep(RETRY_BACKOFF_MS[retries++] ?? 0);
        continue;
      }

      if (auth === "session" && res.cookieToken) await this.adopt(res.cookieToken);

      const eeroError = res.envelope?.meta?.error ?? null;
      const metaCode = res.envelope?.meta?.code;
      const status = isOk(res.status) && typeof metaCode === "number" && !isOk(metaCode) ? metaCode : res.status;

      if (eeroError === "error.too.many.resends") {
        const err = new BackendError("rate_limited", "eero only sends a new code once a minute. Wait and try again.", { retryAfterSec: 60, status, eeroError });
        this.log(spec, status, eeroError, started, "error", err);
        throw err;
      }

      if (status === 429 || eeroError === "error.rate.limit") {
        const waitMs = parseRetryAfter(res.retryAfter) ?? DEFAULT_RETRY_AFTER_MS;
        this.limiter.pause(waitMs);
        const canRetry = effect === "query" && retries < RETRY_BACKOFF_MS.length && waitMs <= this.limiter.maxWaitMs;
        const err = rateLimited(Math.ceil(waitMs / 1000));
        this.log(spec, status, eeroError, started, canRetry ? "retry" : "error", err);
        if (!canRetry) throw err;
        retries++;
        continue;
      }

      // Another process (the app or a CLI) may have rotated the session: adopt the stored token and replay once.
      if (auth === "session" && (status === 401 || status === 419) && token && !reread) {
        reread = true;
        if (await this.adoptStored(token)) {
          this.log(spec, status, eeroError, started, "retry");
          continue;
        }
      }

      if (auth === "session" && status === 401 && eeroError && REFRESH_ERRORS.has(eeroError) && !refreshed && token) {
        this.log(spec, status, eeroError, started, "refresh");
        refreshed = true;
        await this.refresh(token);
        continue;
      }

      if (effect === "query" && status >= 500 && retries < RETRY_BACKOFF_MS.length) {
        this.log(spec, status, eeroError, started, "retry");
        await sleep(RETRY_BACKOFF_MS[retries++] ?? 0);
        continue;
      }

      if (isOk(status)) {
        this.log(spec, status, eeroError, started, "ok");
        return { data: (res.envelope?.data ?? null) as T, cookieToken: res.cookieToken };
      }

      const err = mapError(status, eeroError, spec.method, redactPath(spec.path));
      this.log(spec, status, eeroError, started, "error", err);
      if (err.code === "not_signed_in") {
        if (auth === "session") await this.endSession();
        if (auth === "pending") this.pendingToken = null;
      }
      throw err;
    }
  }

  /** One HTTP attempt: limiter slot, headers, body, timeout, envelope. */
  private async attempt(spec: RequestSpec, token: string | null): Promise<Attempt> {
    const url = requestUrl(spec, this.origin);

    const encoding = spec.encoding ?? (spec.method === "GET" ? "none" : spec.body ? "json" : "empty");
    if (spec.method === "GET" && (encoding !== "none" || spec.body)) throw new Error("GET requests take query parameters, never a body.");

    const headers: Record<string, string> = {
      Accept: "application/json",
      "X-Accept-Language": "en-US",
      "User-Agent": this.userAgent,
    };
    if (token) {
      headers.Cookie = `s=${token}`;
      headers["X-User-Token"] = token;
    }
    let body: string | undefined;
    if (encoding === "json") {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(spec.body ?? {});
    } else if (encoding === "form") {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = formBody(spec.body ?? {});
    } else if (encoding === "empty") {
      headers["Content-Type"] = "application/json";
      body = '""';
    }

    const release = await this.limiter.acquire();
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    let response: Response;
    let text: string;
    try {
      response = await this.fetchFn(url.href, { method: spec.method, headers, body, redirect: "error", signal: controller.signal });
      text = await readBody(response);
    } catch (err) {
      if (err instanceof BackendError) throw err;
      throw timedOut
        ? new BackendError("network_error", `eero did not answer within ${Math.round(this.timeoutMs / 1000)} s.`)
        : new BackendError("network_error", "Could not reach eero. Check your internet connection.");
    } finally {
      clearTimeout(timer);
      release();
    }

    let envelope: RawEnvelope | null = null;
    if (text.trim()) {
      try {
        const parsed: unknown = JSON.parse(text);
        envelope = parsed && typeof parsed === "object" ? (parsed as RawEnvelope) : null;
      } catch {
        if (isOk(response.status)) throw new BackendError("eero_error", "eero sent a response Mesh UI could not read.", { status: response.status });
      }
    }
    return { status: response.status, envelope, cookieToken: cookieToken(response.headers), retryAfter: response.headers.get("retry-after") };
  }

  /** Single flight: concurrent 401s share one refresh; a request whose token was already replaced just replays. */
  private async refresh(usedToken: string): Promise<void> {
    if (this.refreshing) return this.refreshing;
    if (this.token !== usedToken) return;
    this.refreshing = this.runRefresh(usedToken).finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async runRefresh(token: string): Promise<void> {
    const spec: RequestSpec = { method: "POST", path: "/2.2/login/refresh", encoding: "empty" };
    const started = Date.now();
    let res: Attempt;
    try {
      res = await this.attempt(spec, token);
    } catch (err) {
      this.log(spec, null, null, started, "error", err);
      throw err;
    }
    const eeroError = res.envelope?.meta?.error ?? null;
    if (!isOk(res.status)) {
      const err = new BackendError("not_signed_in", "Your eero session has ended. Sign in again.", { status: res.status, ...(eeroError ? { eeroError } : {}) });
      this.log(spec, res.status, eeroError, started, "error", err);
      await this.endSession();
      throw err;
    }
    this.log(spec, res.status, eeroError, started, "ok");
    const data = res.envelope?.data as RawLoginResponse | null | undefined;
    const next = res.cookieToken ?? data?.user_token ?? null;
    if (next) await this.adopt(next);
  }

  private async adopt(next: string): Promise<void> {
    if (next === this.token || RETIRED_TOKEN.test(next)) return;
    this.token = next;
    await this.secrets.save(next);
  }

  /**
   * Re-reads the SecretStore after a 401. True when a different token is now
   * current (saved by another process, or already replaced here), so the
   * request should replay with it before refreshing or giving up.
   */
  private async adoptStored(usedToken: string): Promise<boolean> {
    if (this.token !== null && this.token !== usedToken) return true;
    let saved: string | null;
    try {
      saved = await this.secrets.load();
    } catch {
      return false;
    }
    if (!saved || saved === usedToken || RETIRED_TOKEN.test(saved)) return false;
    // Another request may have changed the token while the store was read.
    if (this.token !== usedToken) return this.token !== null;
    this.token = saved;
    this.shared.clear();
    return true;
  }

  private async endSession(): Promise<void> {
    const was = this.token !== null;
    this.token = null;
    this.shared.clear();
    await this.secrets.clear();
    if (was) this.onSessionChange?.(false);
  }

  private async tokenFor(auth: AuthMode): Promise<string | null> {
    if (auth === "none") return null;
    if (auth === "pending") {
      if (!this.pendingToken) throw new BackendError("not_signed_in", "No sign-in is in progress. Start again with your email or phone.");
      return this.pendingToken;
    }
    await this.ensureLoaded();
    if (!this.token) throw new BackendError("not_signed_in", "Not signed in to eero.");
    return this.token;
  }

  private ensureLoaded(): Promise<void> {
    this.loaded ??= (async () => {
      const saved = await this.secrets.load();
      if (saved && RETIRED_TOKEN.test(saved)) {
        await this.secrets.clear();
        return;
      }
      if (this.token === null) this.token = saved;
    })();
    return this.loaded;
  }

  private log(spec: RequestSpec, status: number | null, eeroError: string | null, started: number, outcome: RequestLogEntry["outcome"], err?: unknown): void {
    if (!this.onLog) return;
    const entry: RequestLogEntry = { method: spec.method, path: redactPath(spec.path), status, eeroError, ms: Date.now() - started, outcome };
    if (err instanceof BackendError) {
      entry.code = err.code;
      entry.message = err.message;
    }
    this.onLog(entry);
  }
}

// ---------------------------------------------------------------------------
// Helpers

function isOk(status: number): boolean {
  return status >= 200 && status < 300;
}

/** The full URL of a request, query included. */
function requestUrl(spec: RequestSpec, origin: string): URL {
  const url = resolveUrl(spec.path, origin, spec.version);
  for (const [key, value] of Object.entries(spec.query ?? {})) {
    if (value !== null && value !== undefined) url.searchParams.set(key, String(value));
  }
  return url;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Form body: booleans as true/false, arrays as repeated keys, null skipped. */
export function formBody(body: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    if (value === null || value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, String(item));
  }
  return params.toString();
}

function cookieToken(headers: Headers): string | null {
  const all = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  const joined = all.length ? all.join(", ") : (headers.get("set-cookie") ?? "");
  return COOKIE_TOKEN.exec(joined)?.[1] ?? null;
}

async function readBody(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw tooLarge();
  }
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) throw tooLarge();
  return text;
}

/** Reads at most `max` bytes, cancelling the stream as soon as it is passed. */
async function readCapped(response: Response, max: number): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > max) {
    await response.body?.cancel().catch(() => undefined);
    throw tooLarge();
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function publicRefused(): BackendError {
  return new BackendError("eero_error", "Refused to fetch release notes from an address that is not https.");
}

function tooLarge(): BackendError {
  return new BackendError("eero_error", "eero sent a response that is too large.");
}

/** "alex@example.com" -> "al***@example.com", "+15550100142" -> "***0142". */
export function maskLogin(login: string): string {
  const at = login.indexOf("@");
  if (at > 0) return `${login.slice(0, Math.min(2, at))}***${login.slice(at)}`;
  return `***${login.slice(-4)}`;
}

/** Maps a failed eero answer to a BackendError. Messages never include bodies, headers or tokens. */
export function mapError(status: number, eeroError: string | null, method: string, path: string): BackendError {
  const detail = { status, ...(eeroError ? { eeroError } : {}) };
  const e = eeroError ?? "";
  if (WRONG_CODE_ERRORS.test(e)) return new BackendError("eero_error", "That code is not right. Check it and try again.", detail);
  if (DEAD_SESSION_ERRORS.has(e) || status === 401 || status === 419) {
    return new BackendError("not_signed_in", "Your eero session has ended. Sign in again.", detail);
  }
  if (BAD_PARAM_ERRORS.has(e)) return new BackendError("bad_params", `eero rejected a value (${e}).`, detail);
  if (e === "error.app.version.blocked") {
    return new BackendError("eero_error", "eero refused this app's User-Agent. Set userAgent in settings.json to a current eero app string.", detail);
  }
  if (e === "error.eero.offline") return new BackendError("eero_error", "eero says that eero is offline.", detail);
  if (status === 402 || e.startsWith("error.premium")) {
    return new BackendError("eero_error", "This needs eero Plus, which Mesh UI does not support.", detail);
  }
  if (status === 403) return new BackendError("eero_error", "Your role on this network can't change this.", detail);
  if (status === 404 || status === 405 || NOT_AVAILABLE_ERRORS.has(e)) {
    return new BackendError("eero_error", "This isn't available on this network or eero model.", detail);
  }
  return new BackendError("eero_error", `eero answered ${status}${e ? ` (${e})` : ""} for ${method} ${path}.`, detail);
}
