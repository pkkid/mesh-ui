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
 *   `wifi_generation_scan`: `/2.4/` only, instant reads in the real shapes
 *   captured 2026-11-14 (device rows split by link health, and device rows
 *   grouped by numeric Wi-Fi version), built from the devices and eeros.
 * The placement test shape is not captured (docs/eero-api/endpoints.md
 * section 5); it follows the fields the mapper reads.
 * Shapes: docs/eero-api/endpoints.md sections 5, 10 and 17.
 */

import type { RawDevice, RawEero } from "../../../src/core/eero/raw";
import { fail, ok, type Route } from "../server";
import type { FakeNetwork, FakeState } from "../state";

/** Reads that answer "running" after a diagnostics POST, so callers must wait. */
export const RUN_READS = 2;
const SYMPTOMS = new Set(["internet_slow", "internet_offline", "connection_drops", "eeros_red"]);

type Pending = { reads: number };
const pending = (state: FakeState, key: string): Pending | undefined => state.extra[key] as Pending | undefined;

/** A device below this `connectivity.score` (0 to 1) is in the coverage scan's unhealthy list. */
export const WEAK_SCORE = 0.5;

/** A fake device's Wi-Fi version: 7 from a fixture field, else 6 on 6 GHz, 6 on 5 GHz, 4 on 2.4 GHz. */
const deviceVersion = (d: RawDevice & { wifi_version?: number }): number => d.wifi_version ?? (String(d.interface?.frequency ?? "").startsWith("2") ? 4 : 6);
/** An eero's Wi-Fi version from its model name ("eero Max 7", "eero 6+", "eero Beacon"). */
const eeroVersion = (e: RawEero): number => (/\b7\b/.test(e.model ?? "") ? 7 : /\b6/.test(e.model ?? "") ? 6 : 5);

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
    // Real shape (captured 2026-11-14): an instant read, connected wireless devices split by link health.
    method: "GET",
    path: "/networks/:net/placement/wifi_coverage_scan",
    versions: ["2.4"],
    handle: ({ params, network }) => {
      const net = network(params.net ?? "");
      const wireless = net.devices.filter((d) => d.connected && d.wireless !== false);
      const weakLink = (d: RawDevice) => (d.connectivity?.score ?? 1) < WEAK_SCORE;
      return ok({
        healthy_devices: wireless.filter((d) => !weakLink(d)),
        unhealthy_devices: wireless.filter(weakLink),
        network_id: Number(net.id),
        debug: { recommendation: "Fake recommendation text", reason: "Fake reason text" },
      });
    },
  },
  {
    // Real shape (captured 2026-11-14): device rows grouped by numeric wifi_version (no 6E), eeros counted the same way.
    method: "GET",
    path: "/networks/:net/placement/wifi_generation_scan",
    versions: ["2.4"],
    handle: ({ params, network }) => {
      const net = network(params.net ?? "");
      const byVersion = new Map<number, RawDevice[]>();
      for (const d of net.devices) {
        if (!d.connected || d.wireless === false) continue;
        const v = deviceVersion(d);
        byVersion.set(v, [...(byVersion.get(v) ?? []), d]);
      }
      const eeroVersions = new Map<number, number>();
      for (const e of net.eeros) eeroVersions.set(eeroVersion(e), (eeroVersions.get(eeroVersion(e)) ?? 0) + 1);
      return ok({
        network_wifi_version: Math.min(...eeroVersions.keys()),
        devices_per_wifi_version: [...byVersion].map(([wifi_version, devices]) => ({ wifi_version, devices })),
        eeros_per_wifi_version: [...eeroVersions].map(([wifi_version, count]) => ({ wifi_version, count })),
        network_id: Number(net.id),
        debug: { recommendation: "Fake recommendation text", reason: "Fake reason text" },
      });
    },
  },
];
