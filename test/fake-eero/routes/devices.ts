/**
 * Fake device routes: `GET {net}/devices`, `GET {net}/devices/:mac`,
 * `GET {net}/blacklist` and `POST {net}/burst_reporters`. A burst sets live
 * `usage` on connected, unpaused devices and answers `next_burst` 12 s
 * ahead. Writes (M4.4): `PUT {net}/devices/:mac` JSON `{paused, nickname,
 * device_type, profile{url}}` saves only on `/2.3/`; on `/2.2/` it answers
 * 200 with the device unchanged, as eero does. `POST {net}/blacklist` form
 * `mac` blocks, `DELETE {net}/blacklist/:mac` unblocks. See
 * docs/eero-api/endpoints.md (devices).
 */

import type { RawDevice, RawProfile } from "../../../src/core/eero/raw";
import { fail, ok, type Route } from "../server";
import type { FakeNetwork } from "../state";

const compact = (mac: string) => mac.toLowerCase().replace(/[^0-9a-f]/g, "");
const BURST_LEAD_MS = 12_000;

/** Bursts per network id, for tests: `state.extra.bursts`. */
export type BurstLog = Record<string, number>;

const find = (net: FakeNetwork, mac: string) => net.devices.find((x) => compact(x.mac ?? "") === compact(mac));

/** Moves a device into a profile: its `profile` link and both profiles' `devices` lists. */
function moveTo(net: FakeNetwork, d: RawDevice, profile: RawProfile): void {
  for (const p of net.profiles) p.devices = (p.devices ?? []).filter((x) => x.url !== d.url);
  profile.devices = [...(profile.devices ?? []), { url: d.url, mac: d.mac, nickname: d.nickname, display_name: d.display_name, connected: d.connected }];
  d.profile = { url: profile.url, name: profile.name, paused: profile.paused };
}

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
    method: "PUT",
    path: "/networks/:net/devices/:mac",
    handle: ({ req, params, network }) => {
      const net = network(params.net ?? "");
      const d = find(net, params.mac ?? "");
      if (!d) return fail(404, "error.device.not.found");
      // eero answers a /2.2/ device write with 200 and drops it.
      if (req.version !== "2.3") return ok(d);
      const b = req.body;
      if ("paused" in b) {
        if (typeof b.paused !== "boolean") return fail(400, "error.request.invalid");
        d.paused = b.paused;
      }
      if ("nickname" in b) {
        if (b.nickname !== null && typeof b.nickname !== "string") return fail(400, "error.request.invalid");
        d.nickname = b.nickname === "" ? null : (b.nickname as string | null);
      }
      if ("device_type" in b) {
        if (typeof b.device_type !== "string") return fail(400, "error.request.invalid");
        d.device_type = b.device_type;
      }
      if ("profile" in b) {
        const url = (b.profile as { url?: unknown } | null)?.url;
        const profile = net.profiles.find((p) => p.url === url);
        if (!profile) return fail(400, "error.profile.not.found");
        moveTo(net, d, profile);
      }
      return ok(blocked(net, d) ? { ...d, blocked: true, connected: false } : d);
    },
  },
  {
    method: "POST",
    path: "/networks/:net/blacklist",
    handle: ({ req, params, network }) => {
      const net = network(params.net ?? "");
      const mac = typeof req.body.mac === "string" ? req.body.mac : "";
      if (!/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(mac)) return fail(400, "error.request.invalid");
      if (!net.blacklist.some((m) => compact(m) === compact(mac))) net.blacklist.push(mac);
      return ok(null);
    },
  },
  {
    method: "DELETE",
    path: "/networks/:net/blacklist/:mac",
    handle: ({ params, network }) => {
      const net = network(params.net ?? "");
      const before = net.blacklist.length;
      net.blacklist = net.blacklist.filter((m) => compact(m) !== compact(params.mac ?? ""));
      if (net.blacklist.length === before) return fail(404, "error.device.not.found");
      return ok(null);
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
