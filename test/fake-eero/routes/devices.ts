/**
 * Fake device routes: `GET {net}/devices`, `GET {net}/devices/:mac`,
 * `GET {net}/blacklist` and `POST {net}/burst_reporters`. A burst sets live
 * `usage` on connected, unpaused devices and answers `next_burst` 12 s
 * ahead. See docs/eero-api/endpoints.md (devices).
 */

import type { RawDevice } from "../../../src/core/eero/raw";
import { fail, ok, type Route } from "../server";
import type { FakeNetwork } from "../state";

const compact = (mac: string) => mac.toLowerCase().replace(/[^0-9a-f]/g, "");
const BURST_LEAD_MS = 12_000;

/** Bursts per network id, for tests: `state.extra.bursts`. */
export type BurstLog = Record<string, number>;

const blocked = (net: FakeNetwork, d: RawDevice) => net.blacklist.some((m) => compact(m) === compact(d.mac ?? ""));

export const routes: Route[] = [
  {
    method: "GET",
    path: "/networks/:net/devices",
    handle: ({ params, network }) => {
      const net = network(params.net ?? "");
      return ok(net.devices.map((d) => (blocked(net, d) ? { ...d, blocked: true, connected: false } : d)));
    },
  },
  {
    method: "GET",
    path: "/networks/:net/devices/:mac",
    handle: ({ params, network }) => {
      const net = network(params.net ?? "");
      const d = net.devices.find((x) => compact(x.mac ?? "") === compact(params.mac ?? ""));
      if (!d) return fail(404, "error.device.not.found");
      return ok(blocked(net, d) ? { ...d, blocked: true, connected: false } : d);
    },
  },
  {
    method: "GET",
    path: "/networks/:net/blacklist",
    handle: ({ params, network }) => {
      const net = network(params.net ?? "");
      return ok(
        net.blacklist.map((m) => {
          const known = net.devices.find((d) => compact(d.mac ?? "") === compact(m));
          return known ? { ...known, blocked: true, connected: false } : { mac: m, blacklisted: true, connected: false, url: `/2.2/networks/${net.id}/devices/${compact(m)}` };
        }),
      );
    },
  },
  {
    method: "POST",
    path: "/networks/:net/burst_reporters",
    handle: ({ params, network, state }) => {
      const net = network(params.net ?? "");
      const log = ((state.extra.bursts as BurstLog | undefined) ??= {});
      log[net.id] = (log[net.id] ?? 0) + 1;
      net.devices.forEach((d, i) => {
        d.usage = d.connected && !d.paused && !blocked(net, d) ? { down_mbps: 10 + i * 5.5, up_mbps: 1 + i * 0.5 } : null;
      });
      return ok({ next_burst: new Date(state.now() + BURST_LEAD_MS).toISOString() });
    },
  },
];
