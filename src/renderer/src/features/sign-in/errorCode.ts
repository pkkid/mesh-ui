/**
 * The eero error code and HTTP status behind a failed command, as a short
 * note for the sign-in screens ("error.session.invalid, HTTP 401"), so a
 * screenshot tells us what eero said. Null when there is nothing to add.
 */
import type { ExecuteError } from "../../../../core/errors";

export function errorCode(error: Pick<ExecuteError, "message" | "detail">): string | null {
  const { eeroError, status } = error.detail ?? {};
  const parts: string[] = [];
  // Unmapped eero errors already name the code in the message.
  if (eeroError && !error.message.includes(eeroError)) parts.push(eeroError);
  if (status !== undefined && !error.message.includes(String(status))) parts.push(`HTTP ${status}`);
  return parts.length ? parts.join(", ") : null;
}

/** The message with the code appended in brackets, when there is one. */
export function withErrorCode(message: string, error: Pick<ExecuteError, "message" | "detail">): string {
  const code = errorCode(error);
  return code ? `${message} (${code})` : message;
}
