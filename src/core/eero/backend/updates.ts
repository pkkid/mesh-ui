/**
 * eero backend, updates area: `GET {net}/updates` plus `GET {net}/eeros` for
 * the per-eero versions, which the updates object does not carry.
 */

import { mapEero, type RawEeroFull } from "../map/eero";
import { mapUpdates } from "../map/updates";
import { asList, type RawUpdates } from "../raw";
import { networkPath } from "../urls";
import type { EeroArea } from "./index";
import { networkLinks } from "./network";

export const updates: EeroArea<"updates"> = (ctx) => {
  const links = networkLinks(ctx);
  const base = (id: string) => links.get(`net:${id}`, networkPath(id));

  return {
    async get(id) {
      const [raw, eeros] = await Promise.all([
        ctx.client.request<RawUpdates | null>({ method: "GET", path: links.get(`net:${id}.updates`, `${base(id)}/updates`) }),
        ctx.client.request<unknown>({ method: "GET", path: links.get(`net:${id}.eeros`, `${base(id)}/eeros`) }),
      ]);
      return mapUpdates(raw, asList<RawEeroFull>(eeros, "eeros").map((e) => mapEero(e)));
    },
  };
};
