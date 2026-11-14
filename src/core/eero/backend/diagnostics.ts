/**
 * eero backend, diagnostics area: the last cloud diagnostics run
 * (`GET {net}/diagnostics`) and support contacts (`GET {net}/support`,
 * pinned to `/2.2/`, where the flat contact shape lives; 2.3 answers a
 * `contacts` list). `run` posts `{net}/diagnostics` and reads it until eero
 * has a result; the health check never does (it is built in core from
 * cached reads). The `/2.4/` scans live in `coverage.ts`.
 * See docs/architecture/commands.md (diagnostics).
 */

import { diagnosticsPending, mapDiagnostics, mapSupport } from "../map/diagnostics";
import type { RawDiagnostics, RawSupport } from "../raw";
import { networkPath } from "../urls";
import { coverage, waitFor } from "./coverage";
import type { EeroArea } from "./index";
import { networkLinks } from "./network";

export const diagnostics: EeroArea<"diagnostics"> = (ctx) => {
  const links = networkLinks(ctx);
  const pathOf = (id: string) => links.get(`net:${id}.diagnostics`, `${links.get(`net:${id}`, networkPath(id))}/diagnostics`);
  const read = async (id: string, share = true) => ctx.client.request<RawDiagnostics | null>({ method: "GET", path: pathOf(id), share });
  return {
    ...coverage(ctx),
    async latest(id) {
      return mapDiagnostics(await read(id));
    },
    async run(id, input) {
      const body: Record<string, string> = {};
      if (input.symptom) body.symptom = input.symptom;
      if (input.deviceId) body.device = input.deviceId;
      await ctx.client.request({ method: "POST", path: pathOf(id), body });
      // The first read waits one interval, so the previous run's result is not taken for this one.
      return mapDiagnostics(await waitFor(() => read(id, false), (r) => !diagnosticsPending(r), "diagnostics run"));
    },
    async support(id) {
      return mapSupport(await ctx.client.request<RawSupport | null>({ method: "GET", path: networkPath(id, "support") }));
    },
  };
};
