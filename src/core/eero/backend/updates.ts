/**
 * eero backend, updates area: `GET {net}/updates` plus `GET {net}/eeros` for
 * the per-eero versions, which the updates object does not carry, and the
 * release notes from `updates.manifest_resource`, an absolute URL outside
 * the eero API that the client fetches without the session.
 */

import type * as M from "../../model";
import { mapEero, type RawEeroFull } from "../map/eero";
import { toIso } from "../map/network";
import { mapUpdates } from "../map/updates";
import { asList, type RawUpdates } from "../raw";
import { networkPath } from "../urls";
import type { EeroArea } from "./index";
import { networkLinks } from "./network";

/** One firmware entry of the manifest, per the clients: `{title, os_version, release_date, features}`. */
export type RawReleaseEntry = {
  title?: string | null;
  os_version?: string | null;
  version?: string | null;
  release_date?: string | number | null;
  features?: unknown;
};

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

/** A feature line given as a string or `{title, description}`; anything else is dropped. */
function featureLine(f: unknown): string | null {
  if (typeof f === "string") return text(f);
  if (f && typeof f === "object") {
    const o = f as Record<string, unknown>;
    const title = text(o.title) ?? text(o.name);
    const body = text(o.description) ?? text(o.text) ?? text(o.body);
    if (title && body) return `${title}: ${body}`;
    return title ?? body;
  }
  return null;
}

/** `v7.13.0-1234` and `7.13.0` are the same release: no leading v, no build suffix. */
export const releaseKey = (v: string | null): string | null => (v ? v.trim().toLowerCase().replace(/^v/, "").replace(/-.*$/, "") : null);

/**
 * Maps the manifest to `ReleaseNotes`. The real manifest is `{target,
 * history[]}`, each `{title, os_version, release_date, features: string[]}`.
 * With a wanted version (the update target, else the current firmware) the
 * entry is the target or history entry of that version, leading v and build
 * suffix ignored, or null when none is. Without one: `target`, else the
 * object itself. Lenient: unknown fields are ignored, at most 50 features.
 */
export function mapReleaseNotes(raw: unknown, wanted: string | null): M.ReleaseNotes | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const lists = [raw, obj.history, obj.firmwares, obj.releases, obj.data].filter(Array.isArray) as unknown[][];
  const entries = lists.flat().filter((e): e is RawReleaseEntry => !!e && typeof e === "object");
  const target = obj.target && typeof obj.target === "object" ? (obj.target as RawReleaseEntry) : null;
  const key = (e: RawReleaseEntry) => releaseKey(text(e.os_version) ?? text(e.version));
  const entry =
    wanted !== null
      ? ([target, ...entries, obj as RawReleaseEntry].find((e) => e && key(e) === releaseKey(wanted)) ?? null)
      : (target ?? (Array.isArray(raw) ? (entries[0] ?? null) : (obj as RawReleaseEntry)));
  if (!entry) return null;
  const version = text(entry.os_version) ?? text(entry.version) ?? wanted;
  if (!version) return null;
  const features = (Array.isArray(entry.features) ? entry.features : []).map(featureLine).filter((f): f is string => f !== null).slice(0, 50);
  const date = entry.release_date;
  const releasedAt = typeof date === "number" ? new Date(date < 1e12 ? date * 1000 : date).toISOString() : toIso(date ?? null);
  return { version, releasedAt, title: text(entry.title), features };
}

export const updates: EeroArea<"updates"> = (ctx) => {
  const links = networkLinks(ctx);
  const base = (id: string) => links.get(`net:${id}`, networkPath(id));
  const readUpdates = (id: string) => ctx.client.request<RawUpdates | null>({ method: "GET", path: links.get(`net:${id}.updates`, `${base(id)}/updates`) });

  const read = async (id: string) => {
    const [raw, eeros] = await Promise.all([readUpdates(id), ctx.client.request<unknown>({ method: "GET", path: links.get(`net:${id}.eeros`, `${base(id)}/eeros`) })]);
    return { raw, updates: mapUpdates(raw, asList<RawEeroFull>(eeros, "eeros").map((e) => mapEero(e))) };
  };

  return {
    get: async (id) => (await read(id)).updates,
    async notes(id) {
      const { raw, updates: u } = await read(id);
      const manifest = text(raw?.manifest_resource);
      if (!manifest) return null;
      // The release being installed, else the one running now.
      const wanted = u.target ?? u.current;
      return mapReleaseNotes(await ctx.client.fetchPublic<unknown>(manifest), wanted);
    },
  };
};
