/**
 * Error codes and the result envelope every surface gets back from
 * `engine.execute`. See docs/architecture/commands.md#results-and-error-codes.
 * Messages are short, plain English and safe to show: never a token, cookie,
 * header or raw response body.
 */

export const ERROR_CODES = [
  "unknown_command",
  "bad_params",
  "needs_confirm",
  "not_signed_in",
  "rate_limited",
  "eero_error",
  "network_error",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export type ErrorDetail = {
  /** HTTP status from eero. */
  status?: number;
  /** eero `meta.error`, e.g. "error.eero.offline". */
  eeroError?: string;
  /** For rate_limited. */
  retryAfterSec?: number;
  /** Ambiguous Ref. */
  matches?: { id: string; name: string }[];
  /** zod issues. */
  issues?: { path: string; message: string }[];
};

export type ExecuteError = { code: ErrorCode; message: string; detail?: ErrorDetail };

export type ExecuteResult<R = unknown> = { ok: true; result: R } | { ok: false; error: ExecuteError };

/** Codes a backend may throw. The engine adds the others itself. */
export type BackendErrorCode = "not_signed_in" | "rate_limited" | "eero_error" | "network_error" | "bad_params";

/** Thrown by backends (and the eero client). The engine maps it to a result. */
export class BackendError extends Error {
  readonly code: BackendErrorCode;
  readonly detail: ErrorDetail | undefined;

  constructor(code: BackendErrorCode, message: string, detail?: ErrorDetail) {
    super(message);
    this.name = "BackendError";
    this.code = code;
    this.detail = detail;
  }
}

/** Thrown by commands and the engine for any code, e.g. a Ref that matched nothing. */
export class CommandError extends Error {
  readonly code: ErrorCode;
  readonly detail: ErrorDetail | undefined;

  constructor(code: ErrorCode, message: string, detail?: ErrorDetail) {
    super(message);
    this.name = "CommandError";
    this.code = code;
    this.detail = detail;
  }
}

/** Message used when something unexpected was thrown; its text is never shown. */
export const UNEXPECTED_MESSAGE = "Something went wrong talking to eero.";

/** Maps anything thrown inside a command to a safe error. */
export function toExecuteError(err: unknown): ExecuteError {
  if (err instanceof BackendError || err instanceof CommandError) {
    return err.detail ? { code: err.code, message: err.message, detail: err.detail } : { code: err.code, message: err.message };
  }
  return { code: "eero_error", message: UNEXPECTED_MESSAGE };
}
