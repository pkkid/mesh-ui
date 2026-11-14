/**
 * eero backend, diagnostics area: the last cloud diagnostics run
 * (`GET {net}/diagnostics`) and support contacts (`GET {net}/support`,
 * pinned to `/2.2/`, where the flat contact shape lives; 2.3 answers a
 * `contacts` list). Never posts: the health check is built in core from
 * cached reads. See docs/architecture/commands.md (diagnostics).
 */

import { mapDiagnostics, mapSupport } from "../map/diagnostics";
import type { RawDiagnostics, RawSupport } from "../raw";
import { networkPath } from "../urls";
import type { EeroArea } from "./index";
import { networkLinks } from "./network";

export const diagnostics: EeroArea<"diagnostics"> = (ctx) => {
  const links = networkLinks(ctx);
  return {
    async latest(id) {
      const path = links.get(`net:${id}.diagnostics`, `${links.get(`net:${id}`, networkPath(id))}/diagnostics`);
      return mapDiagnostics(await ctx.client.request<RawDiagnostics | null>({ method: "GET", path }));
    },
    async support(id) {
      return mapSupport(await ctx.client.request<RawSupport | null>({ method: "GET", path: networkPath(id, "support") }));
    },
  };
};
