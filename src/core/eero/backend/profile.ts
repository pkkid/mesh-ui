/**
 * profile area of the eero backend: `GET {net}/profiles` and `GET {profile}`.
 * Schedules come from each profile's own `schedule[]`: `GET {profile}/schedules`
 * is a 404 on a real network although `resources.schedules` names it
 * (docs/eero-api/endpoints.md section 17).
 *
 * eero's own Unassigned group (eeroOS 7.12.4+) comes back as a profile with
 * `default: true`. It is not a person's profile: the list leaves it out, so
 * its devices count as Unassigned and the usage Unassigned series covers them.
 *
 * Writes (docs/eero-api/endpoints.md, Profiles): `POST {net}/profiles`,
 * `PUT {profile}` with JSON `{name}`, `{paused}` or `{devices: [{url}]}`
 * (which replaces the membership), and `DELETE {profile}`. Unassigned pause
 * is `PUT {default profile} {paused}`; a network without a default profile
 * (eeroOS before 7.12.4) pauses each unprofiled device on `/2.3/` instead.
 */

import { BackendError } from "../../errors";
import { mapProfile } from "../map/profile";
import { asList, type RawDevice, type RawProfile, type RawProfileWrite, linkUrl } from "../raw";
import { idFromUrl, networkPath } from "../urls";
import type { EeroArea } from "./index";

const isProfile = (raw: unknown): raw is RawProfile => !!raw && typeof raw === "object" && typeof (raw as RawProfile).url === "string";

export const profile: EeroArea<"profile"> = ({ client }) => {
  const path = (net: string, id: string) => networkPath(net, `profiles/${encodeURIComponent(id)}`);
  const devices = (net: string, ids: string[]) => Array.from(ids ?? [], (id) => ({ url: networkPath(net, `devices/${encodeURIComponent(id)}`) }));
  const get = async (net: string, id: string) => {
    const raw = await client.request<RawProfile>({ method: "GET", path: path(net, id) });
    if (!isProfile(raw)) throw new BackendError("eero_error", "That profile is not on this network.", { status: 404 });
    return mapProfile(raw);
  };
  /** eero answers a profile write with the profile; read it back if it does not. */
  const put = async (net: string, id: string, body: RawProfileWrite) => {
    const raw = await client.request<RawProfile>({ method: "PUT", path: path(net, id), body });
    return isProfile(raw) ? mapProfile(raw) : get(net, id);
  };
  return {
  async list(net) {
    const data = await client.request({ method: "GET", path: networkPath(net, "profiles") });
    return asList<RawProfile>(data, "profiles")
      .filter((p) => p.default !== true)
      .map((p) => mapProfile(p));
  },

  get,

  async create(net, input) {
    const body: RawProfileWrite = { name: input.name, paused: false, devices: devices(net, input.deviceIds) };
    const raw = await client.request<RawProfile>({ method: "POST", path: networkPath(net, "profiles"), body });
    if (isProfile(raw)) return mapProfile(raw);
    throw new BackendError("eero_error", "eero did not return the new profile.");
  },

  rename: (net, id, name) => put(net, id, { name }),
  setPaused: (net, id, paused) => put(net, id, { paused }),
  setDevices: (net, id, ids) => put(net, id, { devices: devices(net, ids) }),

  async remove(net, id) {
    await client.request({ method: "DELETE", path: path(net, id) });
  },

  async setUnassignedPaused(net, paused) {
    // The lookups are part of the write: a fresh answer (never a shared one) and no retry stall.
    const all = asList<RawProfile>(await client.request({ method: "GET", path: networkPath(net, "profiles"), effect: "write" }), "profiles");
    const group = all.find((p) => p.default === true && isProfile(p));
    if (group?.url) {
      await client.request({ method: "PUT", path: group.url, body: { paused } satisfies RawProfileWrite });
      return;
    }
    // No default profile: devices with no profile (or one the list does not have), one /2.3/ write each.
    const listed = new Set(all.flatMap((p) => (linkUrl(p.url) ? [idFromUrl(linkUrl(p.url) ?? "")] : [])));
    const rows = asList<RawDevice>(await client.request({ method: "GET", path: networkPath(net, "devices"), effect: "write" }), "devices");
    for (const d of rows) {
      const url = linkUrl(d.url);
      const profileUrl = linkUrl(d.profile?.url);
      if (!url || d.blacklisted === true || d.blocked === true || d.paused === paused) continue;
      if (profileUrl && listed.has(idFromUrl(profileUrl))) continue;
      await client.request({ method: "PUT", path: url, version: "2.3", body: { paused } });
    }
  },
  };
};
