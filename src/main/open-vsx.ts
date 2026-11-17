/**
 * Theme search and download from Open VSX (https://open-vsx.org), the open
 * VS Code extension registry, as T3 Code does it (apps/web/src/openVsxThemes.ts,
 * MIT). Runs in main so the renderer stays offline: its CSP and the window
 * lockdown are unchanged, and only trimmed theme colours cross IPC.
 *
 * Guards, after T3 Code:
 * - Only https://open-vsx.org is fetched; URLs from responses must point there.
 * - Only permissively licensed extensions (MIT, Apache-2.0, BSD, ...).
 * - Every response has a size cap and a timeout.
 * - The .vsix must match the sha256 Open VSX publishes for it.
 * - The zip is read with entry, size and ratio limits; theme paths may not
 *   leave the package; `include` chains are followed at most 8 deep.
 *
 * No Electron imports, so tests drive it with a fake fetch.
 */
import { createHash } from "node:crypto";
import { posix } from "node:path";

import { parse, type ParseError } from "jsonc-parser";

import {
  THEME_SEARCH_SORTS,
  type ThemeDownloadResult,
  type ThemeExtension,
  type ThemeFile,
  type ThemeSearchResult,
  type ThemeSearchSort,
} from "../shared/types";
import { trimVsCodeTheme } from "../shared/vscode-theme";
import { openZip, type ZipReader } from "./zip";

export const OPEN_VSX_ORIGIN = "https://open-vsx.org";
const PAGE_SIZE = 16;
const TIMEOUT_MS = 15_000;
const MAX_SEARCH_BYTES = 512 * 1024;
const MAX_JSON_BYTES = 256 * 1024;
const MAX_VSIX_BYTES = 20 * 1024 * 1024;
const MAX_THEMES = 40;
const MAX_INCLUDE_DEPTH = 8;
const ZIP_LIMITS = { maxEntries: 5_000, maxTotalBytes: 100 * 1024 * 1024, maxRatio: 200 };

export const SUPPORTED_LICENSES: ReadonlySet<string> = new Set([
  "0BSD",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "CC0-1.0",
  "ISC",
  "MIT",
  "MPL-2.0",
  "Unlicense",
]);

export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A URL from a response, kept only when it is https on open-vsx.org. */
export function trustedUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.toLowerCase() === "open-vsx.org" && !url.username && !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

const EXTENSION_ID = /^[a-z0-9][a-z0-9-]{0,62}\.[a-z0-9][a-z0-9._-]{0,127}$/i;
const SEGMENT = /^[a-z0-9][a-z0-9._-]{0,127}$/i;

function parseJson(text: string, what: string): unknown {
  const errors: ParseError[] = [];
  const value: unknown = parse(text, errors, { allowTrailingComma: true });
  if (errors.length > 0 || value === undefined) throw new Error(`${what} is not valid JSON.`);
  return value;
}

/** Reads a response body, refusing more than `maxBytes`. */
async function readCapped(response: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error("Open VSX sent more than expected.");
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      void reader.cancel();
      throw new Error("Open VSX sent more than expected.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** Licences are compared case-insensitively, as SPDX ids are. */
function permissive(license: unknown): string | null {
  if (typeof license !== "string") return null;
  const wanted = license.trim().toLowerCase();
  return [...SUPPORTED_LICENSES].find((id) => id.toLowerCase() === wanted) ?? null;
}

function themeContributions(manifest: unknown): Array<Record<string, unknown>> {
  if (!isRecord(manifest) || !isRecord(manifest.contributes)) return [];
  const themes = manifest.contributes.themes;
  return Array.isArray(themes) ? themes.filter(isRecord) : [];
}

const appearanceOf = (uiTheme: unknown): ThemeFile["appearance"] =>
  uiTheme === "vs" || uiTheme === "hc-light" ? "light" : uiTheme === "vs-dark" || uiTheme === "hc-black" ? "dark" : null;

type Detail = { extension: ThemeExtension; manifestUrl: string; vsixUrl: string; sha256Url: string };

export function createOpenVsx(fetchImpl: FetchLike) {
  const get = async (url: string, maxBytes: number, signal?: AbortSignal): Promise<Buffer> => {
    if (!trustedUrl(url)) throw new Error("Refused a URL outside Open VSX.");
    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    const response = await fetchImpl(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    if (!response.ok) throw new Error(`Open VSX answered ${response.status}.`);
    return readCapped(response, maxBytes);
  };
  const getJson = async (url: string, maxBytes: number, what: string, signal?: AbortSignal) =>
    parseJson((await get(url, maxBytes, signal)).toString("utf8"), what);

  /** An extension's details; null when its licence is not one Mesh UI can use. */
  const detail = async (id: string, signal?: AbortSignal): Promise<Detail | null> => {
    const [namespace = "", name = ""] = id.split(/\.(.*)/s);
    if (!SEGMENT.test(namespace) || !SEGMENT.test(name)) throw new Error("That is not an extension id.");
    const value = await getJson(
      `${OPEN_VSX_ORIGIN}/api/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`,
      MAX_JSON_BYTES,
      "The extension details",
      signal,
    );
    if (!isRecord(value) || !isRecord(value.files)) throw new Error("Open VSX returned malformed details.");
    const license = permissive(value.license);
    if (!license) return null;
    const manifestUrl = trustedUrl(value.files.manifest);
    const vsixUrl = trustedUrl(value.files.download);
    const sha256Url = trustedUrl(value.files.sha256);
    const version = typeof value.version === "string" ? value.version.slice(0, 64) : "";
    if (!manifestUrl || !vsixUrl || !sha256Url || !version) throw new Error("Open VSX returned malformed details.");
    const text = (field: unknown, max: number) => (typeof field === "string" ? field.trim().slice(0, max) : "");
    return {
      extension: {
        id: `${namespace}.${name}`,
        name: text(value.displayName, 64) || name,
        publisher: namespace,
        description: text(value.description, 300),
        version,
        license,
        downloadCount: typeof value.downloadCount === "number" ? value.downloadCount : 0,
        themeCount: 0,
      },
      manifestUrl,
      vsixUrl,
      sha256Url,
    };
  };

  async function search(query: unknown, sort: unknown, signal?: AbortSignal): Promise<ThemeSearchResult> {
    try {
      const text = typeof query === "string" ? query.trim().slice(0, 100) : "";
      const sortBy: ThemeSearchSort = THEME_SEARCH_SORTS.includes(sort as ThemeSearchSort)
        ? (sort as ThemeSearchSort)
        : "downloadCount";
      const url = new URL(`${OPEN_VSX_ORIGIN}/api/-/search`);
      url.searchParams.set("query", text);
      url.searchParams.set("category", "Themes");
      url.searchParams.set("sortBy", sortBy);
      url.searchParams.set("sortOrder", "desc");
      url.searchParams.set("size", String(PAGE_SIZE));
      const value = await getJson(url.toString(), MAX_SEARCH_BYTES, "The search result", signal);
      const hits = isRecord(value) && Array.isArray(value.extensions) ? value.extensions.filter(isRecord) : [];
      const found = await Promise.all(
        hits.slice(0, PAGE_SIZE).map(async (hit): Promise<ThemeExtension | null> => {
          try {
            const id = `${hit.namespace}.${hit.name}`;
            if (!EXTENSION_ID.test(id)) return null;
            const d = await detail(id, signal);
            if (!d) return null;
            // The category also holds icon themes; only colour themes count.
            const manifest = await getJson(d.manifestUrl, MAX_JSON_BYTES, "The manifest", signal);
            if (permissive(isRecord(manifest) ? manifest.license : null) !== d.extension.license) return null;
            const themeCount = themeContributions(manifest).length;
            return themeCount > 0 ? { ...d.extension, themeCount } : null;
          } catch {
            return null;
          }
        }),
      );
      return { ok: true, extensions: found.filter((e): e is ThemeExtension => e !== null) };
    } catch (cause) {
      return { ok: false, message: messageOf(cause, "Open VSX could not be searched.") };
    }
  }

  async function download(extensionId: unknown, signal?: AbortSignal): Promise<ThemeDownloadResult> {
    try {
      if (typeof extensionId !== "string" || !EXTENSION_ID.test(extensionId)) {
        return { ok: false, message: "That is not an extension id." };
      }
      // Details are fetched again here: nothing from the renderer is trusted but the id.
      const d = await detail(extensionId, signal);
      if (!d) return { ok: false, message: "That extension's licence does not allow Mesh UI to use it." };
      const checksum = (await get(d.sha256Url, 1024, signal)).toString("utf8").trim().slice(0, 64).toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(checksum)) throw new Error("Open VSX returned no checksum for the package.");
      const vsix = await get(d.vsixUrl, MAX_VSIX_BYTES, signal);
      if (createHash("sha256").update(vsix).digest("hex") !== checksum) {
        throw new Error("The downloaded package does not match its checksum.");
      }
      const zip = openZip(vsix, ZIP_LIMITS);
      const manifest = parseJson(zip.read("extension/package.json", MAX_JSON_BYTES).toString("utf8"), "The manifest");
      if (permissive(isRecord(manifest) ? manifest.license : null) !== d.extension.license) {
        throw new Error("The package's licence does not match Open VSX.");
      }
      const contributions = themeContributions(manifest).slice(0, MAX_THEMES);
      const themes = contributions.flatMap((contribution): ThemeFile[] => {
        const path = packagePath(contribution.path, "extension/package.json");
        if (!path || !zip.has(path)) return [];
        let theme: Record<string, unknown>;
        try {
          theme = loadTheme(zip, path, new Set());
        } catch {
          return []; // One broken theme does not sink the rest.
        }
        const label = typeof contribution.label === "string" ? contribution.label.trim().slice(0, 48) : "";
        return [
          {
            label: label || (typeof theme.name === "string" ? theme.name.slice(0, 48) : d.extension.name),
            appearance: appearanceOf(contribution.uiTheme),
            theme: trimVsCodeTheme(theme),
          },
        ];
      });
      if (themes.length === 0) throw new Error("That extension has no colour themes.");
      return { ok: true, extension: { ...d.extension, themeCount: themes.length }, themes };
    } catch (cause) {
      return { ok: false, message: messageOf(cause, "The theme could not be downloaded.") };
    }
  }

  return { search, download };
}

const messageOf = (cause: unknown, fallback: string) =>
  cause instanceof Error && cause.name !== "AbortError" && cause.name !== "TimeoutError"
    ? cause.message
    : cause instanceof Error && cause.name === "TimeoutError"
      ? "Open VSX did not answer in time."
      : fallback;

/**
 * A path from the manifest or an `include`, resolved against the file that
 * names it. Null when it would leave the package's `extension/` folder.
 */
export function packagePath(value: unknown, from: string): string | null {
  if (typeof value !== "string" || value.length > 1024 || value.includes("\0") || value.includes("\\")) return null;
  if (value.startsWith("/") || /^[a-z]+:/i.test(value)) return null;
  const resolved = posix.normalize(posix.join(posix.dirname(from), value));
  return resolved.startsWith("extension/") && !resolved.includes("..") ? resolved : null;
}

/** A theme file with its `include` chain merged in (the including file wins). */
function loadTheme(zip: ZipReader, path: string, ancestors: Set<string>): Record<string, unknown> {
  if (ancestors.size >= MAX_INCLUDE_DEPTH) throw new Error("Theme includes are nested too deeply.");
  if (ancestors.has(path)) throw new Error("Theme includes contain a cycle.");
  const value = parseJson(zip.read(path, MAX_JSON_BYTES).toString("utf8"), path);
  if (!isRecord(value)) throw new Error(`${path} is not a theme.`);
  if (typeof value.include !== "string") return value;
  const includePath = packagePath(value.include, path);
  if (!includePath) throw new Error(`${path} includes a file outside the package.`);
  const base = loadTheme(zip, includePath, new Set([...ancestors, path]));
  return {
    ...base,
    ...value,
    colors: { ...(isRecord(base.colors) ? base.colors : {}), ...(isRecord(value.colors) ? value.colors : {}) },
  };
}
