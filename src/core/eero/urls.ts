/**
 * URL rules for the eero client: the one allowed origin, version prefixes,
 * device-write pinning, ids from links, and path redaction for logs.
 * See docs/architecture/eero-client.md (Request pipeline, API versions).
 */

import { BackendError } from "../errors";

/** eero's cloud API. The only origin release builds ever talk to. */
export const EERO_ORIGIN = "https://api-user.e2ro.com";

export type ApiVersion = "2.2" | "2.3" | "2.4";

const VERSION_PREFIX = /^\/2\.[234]\//;
const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])$/;

/**
 * Validates an injected origin. Only the fake eero server (loopback, http)
 * may replace the real one, so a bad config can never send the token to
 * another host.
 */
export function checkOrigin(origin: string): string {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new Error("The eero origin is not a valid URL.");
  }
  const normalized = url.origin;
  if (normalized === EERO_ORIGIN) return normalized;
  if (url.protocol === "http:" && LOOPBACK_HOST.test(url.hostname)) return normalized;
  throw new Error("The eero origin can only be the real eero API or a loopback fake server.");
}

/**
 * Resolves a path (`/2.2/account`) or an absolute URL handed back by eero
 * against the client's origin, optionally rewriting the version prefix, and
 * refuses anything outside that origin or outside `/2.2/`, `/2.3/`, `/2.4/`.
 */
export function resolveUrl(target: string, origin: string, version?: ApiVersion): URL {
  let url: URL;
  try {
    url = new URL(target, origin);
  } catch {
    throw refused();
  }
  if (url.origin !== origin || url.username || url.password) throw refused();
  if (!VERSION_PREFIX.test(url.pathname)) throw refused();
  if (version) url.pathname = withVersion(url.pathname, version);
  return url;
}

function refused(): BackendError {
  return new BackendError("eero_error", "Refused a request to an address outside eero's API.");
}

/** Rewrites the `/2.x/` prefix of a path. */
export function withVersion(path: string, version: ApiVersion): string {
  return VERSION_PREFIX.test(path) ? path.replace(VERSION_PREFIX, `/${version}/`) : `/${version}${path.startsWith("/") ? "" : "/"}${path}`;
}

/** The last path segment of an eero link: `/2.2/networks/123` gives `123`. */
export function idFromUrl(url: string): string {
  const path = url.split(/[?#]/)[0] ?? "";
  const parts = path.split("/").filter(Boolean);
  return decodeURIComponent(parts[parts.length - 1] ?? "");
}

/** `/2.2/networks/{id}`, the fallback when no link has been seen yet. */
export function networkPath(netId: string, sub?: string): string {
  const base = `/2.2/networks/${encodeURIComponent(netId)}`;
  return sub ? `${base}/${sub.replace(/^\//, "")}` : base;
}

/** MAC without separators, lower case, as eero uses in device links. */
export function compactMac(mac: string): string {
  return mac.replace(/[^0-9a-f]/gi, "").toLowerCase();
}

/**
 * Every device write goes here. `/2.2/` answers 200 and silently drops the
 * change, so device writes are pinned to `/2.3/`.
 */
export function deviceWritePath(netId: string, mac: string): string {
  return `/2.3/networks/${encodeURIComponent(netId)}/devices/${compactMac(mac)}`;
}

/** Remembers links eero hands back (`url`, `resources.*`) by key. */
export class Links {
  private readonly map = new Map<string, string>();

  set(key: string, url: string | null | undefined): void {
    if (url) this.map.set(key, url);
  }

  /** The remembered link, else the fallback. */
  get(key: string, fallback: string): string {
    return this.map.get(key) ?? fallback;
  }

  /** Stores every `resources` entry (string or `{url}`) under `${prefix}.${name}`. */
  addResources(prefix: string, resources: Record<string, unknown> | null | undefined): void {
    if (!resources) return;
    for (const [name, value] of Object.entries(resources)) {
      const url = typeof value === "string" ? value : value && typeof value === "object" ? (value as { url?: unknown }).url : null;
      if (typeof url === "string") this.set(`${prefix}.${name}`, url);
    }
  }
}

const WORD = /^[a-z][a-z_]*$/;
const HEX_MAC = /^[0-9a-f]{12}$/;

/**
 * A path safe for logs and error messages: the version and resource words
 * stay, every other segment (ids, MACs, serials) becomes `:id`, and the
 * query string is dropped.
 */
export function redactPath(pathOrUrl: string): string {
  let path = pathOrUrl;
  try {
    path = new URL(pathOrUrl, "http://x").pathname;
  } catch {
    path = pathOrUrl.split("?")[0] ?? "";
  }
  return path
    .split("/")
    .map((part, i) => (part === "" || (i === 1 && /^2\.\d$/.test(part)) || (WORD.test(part) && !HEX_MAC.test(part)) ? part : ":id"))
    .join("/");
}
