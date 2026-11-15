/**
 * The eero request log: one JSON line per eero request (time, surface,
 * method, path with ids replaced by `:id`, HTTP status, eero error code,
 * time taken, outcome, and Mesh UI's error code and message when it failed),
 * appended to `eero-requests.jsonl` in the config dir. It holds no token,
 * cookie, header, body, query string, name, MAC or IP, so a user can attach
 * it to a bug report. When the file passes REQUEST_LOG_MAX_BYTES it moves to
 * `eero-requests.1.jsonl` (replacing the older one) and a new file starts.
 * See docs/architecture/security.md#eero-request-log.
 */

import { appendFile, mkdir, rename, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Surface } from "../spec";
import type { RequestLogEntry } from "./client";

export const REQUEST_LOG_FILE = "eero-requests.jsonl";
export const REQUEST_LOG_OLD_FILE = "eero-requests.1.jsonl";
export const REQUEST_LOG_MAX_BYTES = 1_000_000;

export type RequestLogLine = { time: string; surface: Surface } & RequestLogEntry;

export const requestLogPath = (configDir: string): string => join(configDir, REQUEST_LOG_FILE);

/**
 * A sink for the eero client's `onLog`. Writes run one at a time in order;
 * a failed write is dropped, never thrown, so logging can't break a request.
 */
export function fileRequestLog(
  path: string,
  surface: Surface,
  opts: { maxBytes?: number; now?: () => number } = {},
): ((entry: RequestLogEntry) => void) & { flush(): Promise<void> } {
  const maxBytes = opts.maxBytes ?? REQUEST_LOG_MAX_BYTES;
  const now = opts.now ?? Date.now;
  const old = join(dirname(path), REQUEST_LOG_OLD_FILE);
  let size: number | null = null;
  let queue: Promise<void> = Promise.resolve();

  const write = async (line: string) => {
    await mkdir(dirname(path), { recursive: true });
    if (size === null) size = await stat(path).then((s) => s.size, () => 0);
    if (size > 0 && size + line.length > maxBytes) {
      await rename(path, old);
      size = 0;
    }
    await appendFile(path, line, { mode: 0o600 });
    size += Buffer.byteLength(line);
  };

  const log = (entry: RequestLogEntry) => {
    const line: RequestLogLine = { time: new Date(now()).toISOString(), surface, ...entry };
    const text = `${JSON.stringify(line)}\n`;
    queue = queue.then(() => write(text)).catch(() => {
      size = null;
    });
  };
  return Object.assign(log, { flush: () => queue });
}
