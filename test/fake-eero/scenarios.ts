/**
 * Scenario switches for the fake eero server. A scenario matches requests
 * (method and path) and, for a number of times, either replaces the answer
 * (a status and `meta.error`), delays it, hangs it, or rotates the session
 * token on an otherwise normal answer. Tests switch them per test:
 *
 *   fake.scenarios.sessionRefresh();            // next request: 401 error.session.refresh
 *   fake.scenarios.rateLimit({ retryAfter: 2 }); // next request: 429 Retry-After: 2
 */

export type Method = "GET" | "POST" | "PUT" | "DELETE";

export type Match = {
  method?: Method;
  /** A substring or pattern of the full path, e.g. "/2.2/account" or /\/devices\//. */
  path?: string | RegExp;
  /** Return false to skip a request. */
  when?: (req: { method: string; path: string }) => boolean;
};

export type Replacement = {
  status: number;
  error?: string;
  data?: unknown;
  headers?: Record<string, string>;
  /** Raw response body instead of an envelope. */
  body?: string;
};

export type ScenarioEffect = {
  replace?: Replacement;
  /** Never answer (until the client aborts or the server closes). */
  hang?: boolean;
  /** Wait before answering, in ms (fake timers apply). */
  delayMs?: number;
  /** Issue a new session token for this answer via `Set-Cookie: s=`. */
  rotateToken?: boolean;
};

export type Scenario = { match: Match; times: number; effect: ScenarioEffect };

const NOT_LOGIN = (req: { path: string }) => !/\/login(\/|$)|\/logout$/.test(req.path);

export class Scenarios {
  private list: Scenario[] = [];

  /** Adds a scenario. `times` defaults to 1; use Infinity for "always". */
  add(match: Match, effect: ScenarioEffect, times = 1): this {
    this.list.push({ match, times, effect });
    return this;
  }

  clear(): void {
    this.list = [];
  }

  /** Combined effects of every scenario matching this request; consumes one use of each. */
  take(req: { method: string; path: string }): ScenarioEffect {
    const out: ScenarioEffect = {};
    for (const s of this.list) {
      if (s.times <= 0 || !matches(s.match, req)) continue;
      s.times--;
      if (s.effect.replace && !out.replace) out.replace = s.effect.replace;
      if (s.effect.hang) out.hang = true;
      if (s.effect.delayMs) out.delayMs = (out.delayMs ?? 0) + s.effect.delayMs;
      if (s.effect.rotateToken) out.rotateToken = true;
    }
    this.list = this.list.filter((s) => s.times > 0);
    return out;
  }

  // -------------------------------------------------------------------------
  // Named switches

  /** 401 `error.session.refresh` on the next `times` non-login requests. */
  sessionRefresh(times = 1, match: Match = {}): this {
    return this.fail(401, "error.session.refresh", { when: NOT_LOGIN, ...match }, times);
  }

  /** The refresh call itself fails, so the session is gone. */
  refreshFails(error = "error.session.expired"): this {
    return this.fail(401, error, { method: "POST", path: "/login/refresh" }, Infinity);
  }

  /** The next matching answer carries `Set-Cookie: s=<new token>`. */
  rotateToken(match: Match = {}, times = 1): this {
    return this.add({ when: NOT_LOGIN, ...match }, { rotateToken: true }, times);
  }

  /** 429 with `Retry-After` (seconds or an HTTP date; omit for none). */
  rateLimit(opts: { retryAfter?: number | string; match?: Match; times?: number } = {}): this {
    const headers: Record<string, string> = opts.retryAfter === undefined ? {} : { "Retry-After": String(opts.retryAfter) };
    return this.add(opts.match ?? {}, { replace: { status: 429, error: "error.rate.limit", headers } }, opts.times ?? 1);
  }

  /** Any status and `meta.error`. */
  fail(status: number, error: string | undefined, match: Match = {}, times = 1): this {
    return this.add(match, { replace: error ? { status, error } : { status } }, times);
  }

  /** Never answers: proves the client's timeout. */
  hang(match: Match = {}, times = 1): this {
    return this.add(match, { hang: true }, times);
  }

  /** Answers normally after `ms`. */
  delay(ms: number, match: Match = {}, times = Infinity): this {
    return this.add(match, { delayMs: ms }, times);
  }
}

function matches(m: Match, req: { method: string; path: string }): boolean {
  if (m.method && m.method !== req.method) return false;
  if (typeof m.path === "string" && !req.path.includes(m.path)) return false;
  if (m.path instanceof RegExp && !m.path.test(req.path)) return false;
  if (m.when && !m.when(req)) return false;
  return true;
}
