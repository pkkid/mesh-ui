/**
 * eero backend, settings area: the network object (`GET {net}`, shared with
 * other reads) plus `GET {net}/fast_transition`, `GET {net}/power_saving/schedules`,
 * `GET {net}/thread` and `GET {net}/ac_compat`. A 403 or 404 on one of the
 * extra reads means "not on this network" (null), never an error. Power
 * saving itself is on the network object (`GET {net}/power_saving` is a 404).
 * Thread secrets are read only by `threadCredentials`. See
 * docs/architecture/commands.md (settings) and docs/eero-api/endpoints.md section 17.
 */

import { BackendError } from "../../errors";
import { mapSettings, mapThreadCredentials } from "../map/settings";
import { asList, type RawAcCompat, type RawFastTransition, type RawPowerSavingSchedule, type RawThread } from "../raw";
import { networkPath } from "../urls";
import type { EeroArea, EeroContext } from "./index";
import { fetchNetwork, networkLinks } from "./network";

/** A GET that answers null on 403, 404 or 405: the feature is not on this network or role. */
export async function readOptional<T>(ctx: EeroContext, path: string): Promise<T | null> {
  try {
    return (await ctx.client.request<T | null>({ method: "GET", path })) ?? null;
  } catch (err) {
    if (err instanceof BackendError && err.code === "eero_error" && [403, 404, 405].includes(Number(err.detail?.status))) return null;
    throw err;
  }
}

export const settings: EeroArea<"settings"> = (ctx) => {
  const links = networkLinks(ctx);
  const base = (id: string) => links.get(`net:${id}`, networkPath(id));
  const thread = (id: string) => readOptional<RawThread>(ctx, links.get(`net:${id}.thread`, `${base(id)}/thread`));

  return {
    async get(id) {
      const raw = await fetchNetwork(ctx, id);
      const [fastTransition, schedules, threadRaw, acCompat] = await Promise.all([
        readOptional<RawFastTransition>(ctx, `${base(id)}/fast_transition`),
        readOptional<unknown>(ctx, `${base(id)}/power_saving/schedules`).then((r) => asList<RawPowerSavingSchedule>(r, "schedules")),
        thread(id),
        readOptional<RawAcCompat>(ctx, `${base(id)}/ac_compat`),
      ]);
      return mapSettings(raw, { fastTransition, schedules, thread: threadRaw, acCompat });
    },

    async threadCredentials(id) {
      return mapThreadCredentials(await thread(id));
    },
  };
};
