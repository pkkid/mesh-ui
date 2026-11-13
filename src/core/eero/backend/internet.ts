/**
 * eero backend, internet area: connection details from `GET {net}` (gateway
 * from its embedded eeros, else `GET {net}/eeros`) and speed test history
 * from `GET {net}/speedtest`. Plan speed and ratings are added in core.
 */

import { mapInternet, mapSpeedTests } from "../map/network";
import { asList, type RawEero, type RawSpeedTest } from "../raw";
import { networkPath } from "../urls";
import type { EeroArea } from "./index";
import { fetchNetwork, networkLinks } from "./network";

export const internet: EeroArea<"internet"> = (ctx) => {
  const links = networkLinks(ctx);
  const base = (id: string) => links.get(`net:${id}`, networkPath(id));

  return {
    async get(id) {
      const raw = await fetchNetwork(ctx, id);
      let eeros = asList<RawEero>(raw.eeros);
      if (eeros.length === 0) {
        eeros = asList<RawEero>(await ctx.client.request({ method: "GET", path: links.get(`net:${id}.eeros`, `${base(id)}/eeros`) }));
      }
      return mapInternet(raw, eeros);
    },

    async speedTests(id, q) {
      const rows = await ctx.client.request<unknown>({
        method: "GET",
        path: links.get(`net:${id}.speedtest`, `${base(id)}/speedtest`),
        query: { startTime: q.from, endTime: q.to, limit: q.limit },
      });
      return mapSpeedTests(asList<RawSpeedTest>(rows)).slice(0, Math.max(0, q.limit));
    },
  };
};
