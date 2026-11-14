/**
 * Fake diagnostics, placement and coverage:
 * - `GET {net}/diagnostics` (only `status` until a run, as on a real network)
 *   and `GET {net}/support` in its `/2.2/` shape.
 * - `POST {net}/diagnostics` JSON `{symptom?, device?}` starts a run: the
 *   next `RUN_READS` reads answer `{status: "running"}`, then the result,
 *   built from the eeros (offline, weak mesh links) and the internet status.
 * - `POST` then `GET /2.3/networks/{id}/placement_test/{serial}`: running for
 *   one read, then `{status: "complete", rating}` from the eero's mesh bars.
 *   `/2.3/` only.
 * - `GET /2.4/networks/{id}/placement/wifi_coverage_scan` and
 *   `wifi_generation_scan`: `/2.4/` only, built from the eeros and devices.
 * The placement and scan shapes are not captured (docs/eero-api/endpoints.md
 * section 5); these follow the fields the mapper reads.
 * Shapes: docs/eero-api/endpoints.md sections 5, 10 and 17.
 */

import type { RawEero } from "../../../src/core/eero/raw";
import { fail, ok, type Route } from "../server";
import type { FakeNetwork, FakeState } from "../state";

/** Reads that answer "running" after a diagnostics POST, so callers must wait. */
export const RUN_READS = 2;
const SYMPTOMS = new Set(["internet_slow", "internet_offline", "connection_drops", "eeros_red"]);

type Pending = { reads: number };
const pending = (state: FakeState, key: string): Pending | undefined => state.extra[key] as Pending | undefined;

const offline = (e: RawEero) => e.status === "red" || e.heartbeat_ok === false;
const weak = (e: RawEero) => !e.gateway && e.wired !== true && (e.mesh_quality_bars ?? 5) <= 2;

function runResult(net: FakeNetwork) {
  const down = net.eeros.filter(offline);
  const thin = net.eeros.filter(weak);
  const internetUp = net.network.health?.internet?.status !== "disconnected";
  const results = [
    { name: "Internet", status: internetUp ? "pass" : "fail", detail: internetUp ? "The gateway reaches the internet" : "The gateway has no internet" },
    { name: "Mesh", status: thin.length ? "warning" : "pass", detail: thin.length ? `${thin.length} eero with a weak link` : "Every link is good" },
    { name: "eeros", status: down.length ? "fail" : "pass", detail: down.length ? `${down.length} eero offline` : "Every eero checked in" },
  ];
  return { status: "completed", issue_area: !internetUp ? "internet" : down.length ? "eeros" : thin.length ? "mesh" : null, results };
}

const RATING = ["POOR", "POOR", "POOR", "FAIR", "GOOD", "EXCELLENT"];

export const routes: Route[] = [
  {
    method: "GET",
    path: "/networks/:net/diagnostics",
    handle: ({ params, network, state }) => {
      const net = network(params.net ?? "");
      const run = pending(state, `diagnostics:${net.id}`);
      if (run && run.reads > 0) {
        run.reads -= 1;
        if (run.reads === 0) {
          net.diagnostics = runResult(net);
          delete state.extra[`diagnostics:${net.id}`];
        }
      }
      return ok(net.diagnostics);
    },
  },
  {
    method: "POST",
    path: "/networks/:net/diagnostics",
    handle: ({ req, params, network, state }) => {
      const net = network(params.net ?? "");
      const symptom = req.body.symptom;
      if (symptom !== undefined && !SYMPTOMS.has(String(symptom))) return fail(400, "error.diagnostics.invalid_symptom");
      net.diagnostics = { status: "running" };
      state.extra[`diagnostics:${net.id}`] = { reads: RUN_READS } satisfies Pending;
      return ok(null, 202);
    },
  },
  {
    method: "GET",
    path: "/networks/:net/support",
    // 2.3 answers a `contacts` list instead; the client pins this read to 2.2.
    versions: ["2.2"],
    handle: ({ params, network }) => ok(network(params.net ?? "").support),
  },
  {
    method: "POST",
    path: "/networks/:net/placement_test/:serial",
    versions: ["2.3"],
    handle: ({ params, network, state }) => {
      const net = network(params.net ?? "");
      if (!net.eeros.some((e) => e.serial === params.serial)) return fail(404, "error.eero.not_found");
      state.extra[`placement:${net.id}:${params.serial}`] = { reads: 1 } satisfies Pending;
      return ok({ status: "running" }, 202);
    },
  },
  {
    method: "GET",
    path: "/networks/:net/placement_test/:serial",
    versions: ["2.3"],
    handle: ({ params, network, state }) => {
      const net = network(params.net ?? "");
      const e = net.eeros.find((x) => x.serial === params.serial);
      if (!e) return fail(404, "error.eero.not_found");
      const key = `placement:${net.id}:${params.serial}`;
      const run = pending(state, key);
      if (run && run.reads > 0) {
        run.reads -= 1;
        return ok({ status: "running" });
      }
      delete state.extra[key];
      const bars = e.gateway || e.wired ? 5 : (e.mesh_quality_bars ?? 0);
      return ok({ status: "complete", rating: RATING[bars], recommendation: bars <= 2 ? { message: `Move ${e.location} closer to the eero it connects through.` } : null });
    },
  },
  {
    method: "GET",
    path: "/networks/:net/placement/wifi_coverage_scan",
    versions: ["2.4"],
    handle: ({ params, network, state }) => {
      const net = network(params.net ?? "");
      const parent = (e: RawEero) => (e.gateway ? null : (net.eeros.find((x) => x.location === e.wireless_upstream_node?.name)?.url ?? null));
      return ok({
        scanned_at: new Date(state.now()).toISOString(),
        eeros: net.eeros.map((e) => ({
          url: e.url,
          location: e.location,
          bars: offline(e) ? null : e.gateway || e.wired ? 5 : (e.mesh_quality_bars ?? null),
          device_count: offline(e) ? null : (e.connected_clients_count ?? 0),
          served_by: parent(e),
        })),
        recommendations: net.eeros.filter(weak).map((e) => ({ message: `Adjust eero placement. ${e.location} sits too far from the eero it connects through.` })),
      });
    },
  },
  {
    method: "GET",
    path: "/networks/:net/placement/wifi_generation_scan",
    versions: ["2.4"],
    handle: ({ params, network }) => {
      const net = network(params.net ?? "");
      const counts: Record<string, number> = {};
      for (const d of net.devices) {
        if (!d.connected || d.wireless === false) continue;
        const f = d.interface?.frequency ?? "";
        const key = f.startsWith("6") ? "WIFI_6E" : f.startsWith("5") ? "WIFI_6" : f.startsWith("2") ? "WIFI_4" : null;
        if (key) counts[key] = (counts[key] ?? 0) + 1;
      }
      const old = net.eeros.filter((e) => !(e.bands ?? []).some((b) => b.includes("6")));
      return ok({
        generations: counts,
        limiting_eeros: old.map((e) => ({ url: e.url, reason: "No 6 GHz radio" })),
        insights: ["2.4 GHz only devices such as plugs and sensors are fine where they are."],
      });
    },
  },
];
