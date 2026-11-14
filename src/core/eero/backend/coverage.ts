/**
 * Placement and coverage on the eero backend (M5.8): the `/2.4/` coverage
 * and Wi-Fi generation scans (diagnostics area) and the `/2.3/` placement
 * test (eero area, merged in `index.ts` so `eero.ts` stays with its own
 * story). The placement test posts, then reads the same path until eero
 * has a rating. See docs/architecture/commands.md (eero).
 */

import { BackendError } from "../../errors";
import type * as M from "../../model";
import { mapCoverageScan, mapGenerationScan, mapPlacement, placementPending } from "../map/diagnostics";
import type { RawCoverageScan, RawEero, RawGenerationScan, RawPlacementTest } from "../raw";
import type { EeroContext } from "./index";

/** How long a placement test or diagnostics run is waited for. Tests shorten it. */
export const WAIT = { intervalMs: 3_000, timeoutMs: 120_000 };

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Reads `read` every `WAIT.intervalMs` (first after one interval) until `done`; fails `eero_error` after `WAIT.timeoutMs`. */
export async function waitFor<T>(read: () => Promise<T>, done: (v: T) => boolean, what: string): Promise<T> {
  const until = Date.now() + WAIT.timeoutMs;
  for (;;) {
    await sleep(WAIT.intervalMs);
    const v = await read();
    if (done(v)) return v;
    if (Date.now() >= until) throw new BackendError("eero_error", `eero did not finish the ${what} in time. Try again in a few minutes.`);
  }
}

const scanPath = (net: M.Id, scan: string) => `/2.4/networks/${encodeURIComponent(net)}/placement/${scan}?allDevices=true`;

export const coverage = ({ client }: EeroContext) => ({
  async coverageScan(net: M.Id): Promise<M.CoverageScan> {
    return mapCoverageScan(await client.request<RawCoverageScan | null>({ method: "GET", path: scanPath(net, "wifi_coverage_scan") }));
  },
  async upgradeReport(net: M.Id): Promise<M.UpgradeReport> {
    return mapGenerationScan(await client.request<RawGenerationScan | null>({ method: "GET", path: scanPath(net, "wifi_generation_scan") }));
  },
});

export const placement = ({ client }: EeroContext) => ({
  async placementTest(net: M.Id, eero: M.Id): Promise<M.PlacementResult> {
    const raw = await client.request<RawEero>({ method: "GET", path: `/2.2/eeros/${encodeURIComponent(eero)}` });
    // The clients address the test by serial; the eero id is the fallback, as for led_cycle.
    const key = typeof raw?.serial === "string" && raw.serial ? raw.serial : eero;
    const path = `/2.3/networks/${encodeURIComponent(net)}/placement_test/${encodeURIComponent(key)}`;
    const started = await client.request<RawPlacementTest | null>({ method: "POST", path });
    // Done once eero stops saying it is running and sends a rating or any final status.
    const ready = (r: RawPlacementTest | null) => !!r && !placementPending(r) && (mapPlacement(eero, r).rating !== null || !!r.status);
    const result = ready(started) ? started : await waitFor(() => client.request<RawPlacementTest | null>({ method: "GET", path, share: false }), ready, "placement test");
    return mapPlacement(eero, result);
  },
});
