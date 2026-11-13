/**
 * The eero request budget, shared by every caller in the process: at most
 * 80 requests per rolling minute and 4 in flight, writes serialised, and a
 * global pause after a 429. Timers come from the globals at call time, so
 * tests drive it with fake timers. See docs/architecture/eero-client.md#rate-limits.
 */

import { BackendError } from "../errors";

export type LimiterOptions = {
  /** Requests per rolling window. Default 80. */
  perWindow?: number;
  /** Window length in ms. Default 60 000. */
  windowMs?: number;
  /** Requests in flight at once. Default 4. */
  maxInFlight?: number;
  /** A 429 pause longer than this fails new requests instead of blocking. Default 20 000. */
  maxWaitMs?: number;
};

type Waiter = { resolve: (release: () => void) => void; reject: (err: unknown) => void };

export class RateLimiter {
  readonly perWindow: number;
  readonly windowMs: number;
  readonly maxInFlight: number;
  readonly maxWaitMs: number;

  private readonly started: number[] = [];
  private readonly queue: Waiter[] = [];
  private inFlight = 0;
  private pausedUntil = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(options: LimiterOptions = {}) {
    this.perWindow = options.perWindow ?? 80;
    this.windowMs = options.windowMs ?? 60_000;
    this.maxInFlight = options.maxInFlight ?? 4;
    this.maxWaitMs = options.maxWaitMs ?? 20_000;
  }

  /**
   * Waits for a slot for one HTTP attempt and returns its release function.
   * Fails with `rate_limited` when a 429 pause has more than `maxWaitMs` left.
   */
  acquire(): Promise<() => void> {
    const left = this.pausedUntil - Date.now();
    if (left > this.maxWaitMs) return Promise.reject(rateLimited(Math.ceil(left / 1000)));
    return new Promise((resolve, reject) => {
      this.queue.push({ resolve, reject });
      this.pump();
    });
  }

  /** Runs `fn` after every earlier write has finished: writes go one at a time, in order. */
  serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.writeChain.then(fn, fn);
    this.writeChain = run.catch(() => undefined);
    return run;
  }

  /** Pauses every request (after a 429) for `ms`. */
  pause(ms: number): void {
    this.pausedUntil = Math.max(this.pausedUntil, Date.now() + ms);
    this.pump();
  }

  /** Remaining pause in ms, 0 when not paused. */
  pausedFor(): number {
    return Math.max(0, this.pausedUntil - Date.now());
  }

  private pump(): void {
    const now = Date.now();
    while (this.started.length && (this.started[0] ?? 0) <= now - this.windowMs) this.started.shift();

    while (this.queue.length && this.inFlight < this.maxInFlight && this.started.length < this.perWindow && now >= this.pausedUntil) {
      const waiter = this.queue.shift() as Waiter;
      this.inFlight++;
      this.started.push(now);
      let released = false;
      waiter.resolve(() => {
        if (released) return;
        released = true;
        this.inFlight--;
        this.pump();
      });
    }

    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.queue.length || this.inFlight >= this.maxInFlight) return;
    const nextWindow = this.started.length >= this.perWindow ? (this.started[0] ?? now) + this.windowMs : now;
    const wakeAt = Math.max(nextWindow, this.pausedUntil);
    if (wakeAt > now) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.pump();
      }, wakeAt - now);
    }
  }
}

export function rateLimited(retryAfterSec: number): BackendError {
  return new BackendError("rate_limited", `eero is limiting requests. Try again in ${retryAfterSec} s.`, { retryAfterSec });
}

/** `Retry-After` as seconds or an HTTP date, in ms. null when absent or unreadable. */
export function parseRetryAfter(header: string | null, now = Date.now()): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.round(Number(trimmed) * 1000);
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}
