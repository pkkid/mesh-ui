/**
 * profile area of the eero backend: `GET {net}/profiles` and `GET {profile}`.
 * Schedules come from each profile's own `schedule[]`: `GET {profile}/schedules`
 * is a 404 on a real network although `resources.schedules` names it
 * (docs/eero-api/endpoints.md section 17).
 *
 * eero's own Unassigned group (eeroOS 7.12.4+) comes back as a profile with
 * `default: true`. It is not a person's profile: the list leaves it out, so
 * its devices count as Unassigned and the usage Unassigned series covers them.
 */

import { BackendError } from "../../errors";
import { mapProfile } from "../map/profile";
import { asList, type RawProfile } from "../raw";
import { networkPath } from "../urls";
import type { EeroArea } from "./index";

export const profile: EeroArea<"profile"> = ({ client }) => ({
  async list(net) {
    const data = await client.request({ method: "GET", path: networkPath(net, "profiles") });
    return asList<RawProfile>(data, "profiles")
      .filter((p) => p.default !== true)
      .map((p) => mapProfile(p));
  },

  async get(net, id) {
    const raw = await client.request<RawProfile>({ method: "GET", path: networkPath(net, `profiles/${encodeURIComponent(id)}`) });
    if (!raw || typeof raw !== "object") throw new BackendError("eero_error", "That profile is not on this network.", { status: 404 });
    return mapProfile(raw);
  },
});
