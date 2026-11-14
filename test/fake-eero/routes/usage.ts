/**
 * Fake data usage routes: the network, per eero, device and profile charts,
 * the breakdown and the per-eero list. Bytes are generated per device and
 * hour from a hash of its MAC, so every view sums the same device-hours and
 * agrees. Like a free eero account, nothing older than 7 days (or later than
 * now) comes back. Shapes: docs/eero-api/data-model.md (Charts). The
 * breakdown follows a real capture (2026-11-13, key paths and types only):
 * `{start, end, upload, download, eeros, devices, unprofiled, profiles}`,
 * profile rows `{profile_id: number, profile_name, upload, download}` with
 * no row for eero's default (Unassigned) profile. The per-eero list shape is
 * not verified against eero yet.
 */

import type { RawDevice } from "../../../src/core/eero/raw";
import { FakeAnswer, fail, ok, type Route, type RouteContext } from "../server";
import type { FakeNetwork } from "../state";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const HISTORY_MS = 7 * DAY;

/** Relative traffic per UTC hour; evenings are busiest. */
const HOURLY = [3, 2, 1, 1, 1, 1, 2, 3, 4, 4, 4, 5, 5, 5, 5, 6, 6, 7, 9, 10, 10, 9, 7, 5];

function hash01(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 4294967296;
}

/** Bytes one device moved in the UTC hour starting at `hour` (epoch ms, on the hour). */
export function fakeDeviceHour(d: RawDevice, hour: number): { down: number; up: number } {
  if (!d.connected || d.paused || d.blocked) return { down: 0, up: 0 };
  const key = d.mac ?? "";
  const scale = 20_000_000 + Math.floor(hash01(key) * 200_000_000);
  const weight = HOURLY[new Date(hour).getUTCHours()] ?? 1;
  const jitter = 0.75 + 0.5 * hash01(`${key}|${hour}`);
  const total = Math.round(scale * weight * jitter);
  const up = Math.round(total * 0.12);
  return { down: total - up, up };
}

type Window = { start: number; end: number };

function window(ctx: RouteContext, needCadence: boolean): Window & { step: number } {
  const { req, state } = ctx;
  if (req.encoding !== "none") throw new FakeAnswer(fail(400, "error.request.body.not.allowed"));
  const start = Date.parse(req.query.get("start") ?? "");
  const end = Date.parse(req.query.get("end") ?? "");
  const cadence = req.query.get("cadence");
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new FakeAnswer(fail(400, "error.params.invalid"));
  if (needCadence && cadence !== "hourly" && cadence !== "daily") throw new FakeAnswer(fail(400, "error.params.invalid"));
  const now = state.now();
  return { start, end: Math.min(end, now), step: cadence === "daily" ? DAY : HOUR };
}

/** Bytes the devices moved in [from, to), whole UTC hours, inside the kept history. */
function sum(devices: RawDevice[], from: number, to: number, now: number): { down: number; up: number } {
  const out = { down: 0, up: 0 };
  const floor = now - HISTORY_MS;
  for (let h = Math.floor(from / HOUR) * HOUR; h < to; h += HOUR) {
    if (h < floor || h > now) continue;
    for (const d of devices) {
      const b = fakeDeviceHour(d, h);
      out.down += b.down;
      out.up += b.up;
    }
  }
  return out;
}

/** A chart answer, buckets from `start` in `step`s, history-limited like a free account. */
function chart(ctx: RouteContext, net: FakeNetwork, devices: RawDevice[]) {
  const w = window(ctx, true);
  const now = ctx.state.now();
  const down: { time: string; value: number }[] = [];
  const up: { time: string; value: number }[] = [];
  for (let b = w.start; b < w.end; b += w.step) {
    if (b + w.step <= now - HISTORY_MS) continue;
    const s = sum(devices, b, Math.min(b + w.step, w.end), now);
    const time = new Date(b).toISOString();
    down.push({ time, value: s.down });
    up.push({ time, value: s.up });
  }
  const total = (xs: { value: number }[]) => xs.reduce((n, x) => n + x.value, 0);
  return ok({
    network_id: Number(net.id),
    start: new Date(w.start).toISOString(),
    end: new Date(w.end).toISOString(),
    series: [
      { type: "download", sum: total(down), values: down },
      { type: "upload", sum: total(up), values: up },
    ],
  });
}

const lastSegment = (url: string | undefined) => (url ?? "").split("/").filter(Boolean).pop() ?? "";
const compact = (mac: string | undefined) => (mac ?? "").replace(/:/g, "").toLowerCase();

export const routes: Route[] = [
  {
    method: "GET",
    path: "/networks/:net/data_usage",
    handle: (ctx) => {
      const net = ctx.network(ctx.params.net ?? "");
      return chart(ctx, net, net.devices);
    },
  },
  {
    method: "GET",
    path: "/networks/:net/data_usage/eeros/:eero",
    handle: (ctx) => {
      const net = ctx.network(ctx.params.net ?? "");
      const id = ctx.params.eero ?? "";
      if (!net.eeros.some((e) => lastSegment(e.url) === id)) return fail(404, "error.eero.not.found");
      return chart(ctx, net, net.devices.filter((d) => lastSegment(d.source?.url) === id));
    },
  },
  {
    method: "GET",
    path: "/networks/:net/data_usage/devices/:mac",
    handle: (ctx) => {
      const net = ctx.network(ctx.params.net ?? "");
      const device = net.devices.find((d) => compact(d.mac) === compact(ctx.params.mac));
      if (!device) return fail(404, "error.device.not.found");
      return chart(ctx, net, [device]);
    },
  },
  {
    method: "GET",
    path: "/networks/:net/data_usage/profiles/:profile",
    handle: (ctx) => {
      const net = ctx.network(ctx.params.net ?? "");
      const id = ctx.params.profile ?? "";
      if (!net.profiles.some((p) => lastSegment(p.url) === id)) return fail(404, "error.profile.not.found");
      return chart(ctx, net, net.devices.filter((d) => lastSegment(d.profile?.url) === id));
    },
  },
  {
    method: "GET",
    path: "/networks/:net/data_usage/breakdown",
    handle: (ctx) => {
      const net = ctx.network(ctx.params.net ?? "");
      const w = window(ctx, false);
      const now = ctx.state.now();
      const people = net.profiles.filter((p) => p.default !== true);
      const used = net.devices.map((d) => ({ d, s: sum([d], w.start, w.end, now) })).filter(({ s }) => s.down + s.up > 0);
      const row = ({ d, s }: (typeof used)[number]) => ({ url: d.url, mac: d.mac, nickname: d.nickname, display_name: d.display_name, hostname: d.hostname, device_type: d.device_type, download: s.down, upload: s.up });
      const devices = used.map(row);
      const unprofiled = used.filter(({ d }) => !people.some((p) => p.url === d.profile?.url)).map(row);
      // Only people's profiles: eero sends no row for its default (Unassigned) group.
      const profiles = people.map((p) => {
        const s = sum(
          net.devices.filter((d) => d.profile?.url === p.url),
          w.start,
          w.end,
          now,
        );
        return { profile_id: Number(lastSegment(p.url)), profile_name: p.name, upload: s.up, download: s.down };
      });
      const all = sum(net.devices, w.start, w.end, now);
      return ok({ start: new Date(w.start).toISOString(), end: new Date(w.end).toISOString(), upload: all.up, download: all.down, devices, unprofiled, profiles });
    },
  },
  {
    method: "GET",
    path: "/networks/:net/data_usage/eeros",
    handle: (ctx) => {
      const net = ctx.network(ctx.params.net ?? "");
      const w = window(ctx, false);
      const now = ctx.state.now();
      const eeros = net.eeros.map((e) => {
        const s = sum(
          net.devices.filter((d) => d.source?.url === e.url),
          w.start,
          w.end,
          now,
        );
        return { url: e.url, location: e.location, download: s.down, upload: s.up };
      });
      return ok({ eeros });
    },
  },
];
