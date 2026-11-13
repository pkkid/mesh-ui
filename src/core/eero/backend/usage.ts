/**
 * eero backend: data usage. Every call is a GET with query parameters only
 * (eero rejects a GET body). See docs/architecture/commands.md (usage.get,
 * usage.breakdown) and docs/eero-api/endpoints.md section 9.
 */

import { BackendError, type BreakdownQuery, type UsageQuery } from "../../backend";
import type * as M from "../../model";
import { mapBreakdownRow, mapUsagePoints, type RawUsageRow, usageTotals } from "../map/usage";
import { asList, type RawUsage } from "../raw";
import { compactMac, networkPath } from "../urls";
import type { EeroArea } from "./index";

function seriesPath(net: M.Id, q: UsageQuery): string {
  const need = (what: string): string => {
    if (!q.id) throw new BackendError("bad_params", `Usage for one ${what} needs its id.`);
    return encodeURIComponent(q.id);
  };
  switch (q.scope) {
    case "network":
      return networkPath(net, "data_usage");
    case "eero":
      return networkPath(net, `data_usage/eeros/${need("eero")}`);
    case "device":
      return networkPath(net, `data_usage/devices/${compactMac(need("device"))}`);
    case "profile":
      return networkPath(net, `data_usage/profiles/${need("profile")}`);
    case "guest":
      throw new BackendError("eero_error", "Guest network usage is not available from eero yet.");
  }
}

export const usage: EeroArea<"usage"> = ({ client }) => ({
  async series(net, q) {
    const raw = await client.request<RawUsage>({
      method: "GET",
      path: seriesPath(net, q),
      query: { start: q.from, end: q.to, cadence: q.cadence, timezone: q.timezone },
    });
    const points = mapUsagePoints(raw);
    return { scope: q.scope, id: q.id, range: q.range, cadence: q.cadence, points, total: usageTotals(raw), busiest: null, todaySoFar: null };
  },

  async breakdown(net, q: BreakdownQuery) {
    const window = { start: q.from, end: q.to };
    const [rowsData, network] = await Promise.all([
      q.by === "eero"
        ? client.request<unknown>({ method: "GET", path: networkPath(net, "data_usage/eeros"), query: { ...window, cadence: "daily" } })
        : client.request<unknown>({ method: "GET", path: networkPath(net, "data_usage/breakdown"), query: window }),
      client.request<RawUsage>({ method: "GET", path: networkPath(net, "data_usage"), query: { ...window, cadence: "daily" } }),
    ]);
    const key = q.by === "device" ? "devices" : q.by === "profile" ? "profiles" : "eeros";
    const rows = asList<RawUsageRow>(rowsData, key).map((r) => mapBreakdownRow(r, q.by));
    const total = usageTotals(network);
    if (q.by === "profile") {
      // eero lists only real profiles; the rest of the network is Unassigned, as in the demo backend.
      const down = Math.max(0, total.down - rows.reduce((n, r) => n + r.down, 0));
      const up = Math.max(0, total.up - rows.reduce((n, r) => n + r.up, 0));
      if (down + up > 0) rows.push({ id: null, name: "Unassigned", down, up, share: 0 });
    }
    return { range: q.range, by: q.by, rows, total };
  },
});
