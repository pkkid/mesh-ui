/** profile area of the eero backend: `GET {net}/profiles`, `GET {profile}` and `{profile}/schedules`. */

import { BackendError } from "../../errors";
import { mapProfile, type RawScheduleFull } from "../map/profile";
import { asList, linkUrl, type RawProfile } from "../raw";
import { networkPath } from "../urls";
import type { EeroArea } from "./index";

export const profile: EeroArea<"profile"> = ({ client }) => ({
  async list(net) {
    const data = await client.request({ method: "GET", path: networkPath(net, "profiles") });
    // The list embeds each profile's schedule[]; no request per profile.
    return asList<RawProfile>(data, "profiles").map((p) => mapProfile(p));
  },

  async get(net, id) {
    const url = networkPath(net, `profiles/${encodeURIComponent(id)}`);
    const raw = await client.request<RawProfile>({ method: "GET", path: url });
    if (!raw || typeof raw !== "object") throw new BackendError("eero_error", "That profile is not on this network.", { status: 404 });
    let schedules: RawScheduleFull[] | null = null;
    try {
      const path = linkUrl(raw.resources?.schedules) ?? `${linkUrl(raw.url) ?? url}/schedules`;
      schedules = asList<RawScheduleFull>(await client.request({ method: "GET", path }), "schedules");
    } catch (err) {
      // Older firmware has no schedules endpoint; the profile's own schedule[] stands in.
      if (!(err instanceof BackendError && (err.detail?.status === 404 || err.detail?.status === 405))) throw err;
    }
    return mapProfile(raw, schedules);
  },
});
