/**
 * Fake profile routes: `GET {net}/profiles` and `GET {profile}`. Like the
 * real API, `GET {profile}/schedules` is a 404 (docs/eero-api/endpoints.md
 * section 17); schedules live on the profile's own `schedule[]`.
 *
 * Writes (M4.5): `POST {net}/profiles` JSON `{name, paused, devices: [{url}]}`,
 * `PUT {profile}` JSON `{name}`, `{paused}` or `{devices}` (replaces the
 * membership; devices that leave go to the `default: true` profile), and
 * `DELETE {profile}` (its devices go to the default profile, unpaused). A
 * paused profile pauses its devices, as eero does. Every write is also in
 * `fake.writes`.
 */

import type { RawDevice, RawProfile } from "../../../src/core/eero/raw";
import { fail, ok, type Route, type RouteContext } from "../server";
import type { FakeNetwork } from "../state";

const find = ({ params, network }: RouteContext) => {
  const net = network(params.net ?? "");
  return net.profiles.find((p) => p.url === `${net.network.url}/profiles/${params.id}`) ?? null;
};

const last = (url: string) => url.split(/[?#]/)[0]?.split("/").filter(Boolean).at(-1) ?? "";

/** The devices a `devices: [{url}]` body names, or null when one is unknown. */
function devicesOf(net: FakeNetwork, body: unknown): RawDevice[] | null {
  if (!Array.isArray(body)) return null;
  const out: RawDevice[] = [];
  for (const item of body) {
    const url = item && typeof item === "object" ? (item as { url?: unknown }).url : null;
    const d = typeof url === "string" ? net.devices.find((x) => last(x.url ?? "") === last(url)) : undefined;
    if (!d) return null;
    if (!out.includes(d)) out.push(d);
  }
  return out;
}

/** Moves a device into `to` (or out of every profile when null), carrying the new profile's pause. */
function move(net: FakeNetwork, d: RawDevice, to: RawProfile | null, wasPaused: boolean) {
  for (const p of net.profiles) p.devices = (p.devices ?? []).filter((x) => x.url !== d.url);
  if (to) to.devices?.push({ url: d.url, mac: d.mac, nickname: d.nickname, display_name: d.display_name, connected: d.connected });
  d.profile = to ? { url: to.url ?? "", name: to.name, paused: to.paused } : null;
  if (to?.paused) d.paused = true;
  else if (wasPaused) d.paused = false;
}

const fallback = (net: FakeNetwork) => net.profiles.find((p) => p.default === true) ?? null;

/** Exactly `devices` in `p`; the rest of its devices go to the default profile. */
function setMembers(net: FakeNetwork, p: RawProfile, devices: RawDevice[]) {
  const leaving = net.devices.filter((d) => d.profile?.url === p.url && !devices.includes(d));
  for (const d of leaving) move(net, d, fallback(net) === p ? null : fallback(net), p.paused === true);
  for (const d of devices) if (d.profile?.url !== p.url) move(net, d, p, false);
}

function setPaused(net: FakeNetwork, p: RawProfile, paused: boolean) {
  p.paused = paused;
  p.state = { ...p.state, value: paused ? "paused" : "active" };
  for (const d of net.devices) {
    if (d.profile?.url !== p.url) continue;
    d.paused = paused;
    d.profile = { ...d.profile, paused };
  }
}

const badName = (v: unknown) => typeof v !== "string" || v.trim() === "";

export const routes: Route[] = [
  {
    method: "GET",
    path: "/networks/:net/profiles",
    handle: ({ params, network }) => ok(network(params.net ?? "").profiles),
  },
  {
    method: "GET",
    path: "/networks/:net/profiles/:id",
    handle: (ctx) => {
      const p = find(ctx);
      return p ? ok(p) : fail(404, "error.profile.not.found");
    },
  },
  {
    method: "GET",
    path: "/networks/:net/profiles/:id/schedules",
    handle: () => fail(404, "error.not.found"),
  },
  {
    method: "POST",
    path: "/networks/:net/profiles",
    handle: ({ req, params, network, state }) => {
      const net = network(params.net ?? "");
      const { name, devices: list } = req.body;
      if (badName(name)) return fail(400, "error.profile.name.invalid");
      const devices = devicesOf(net, list ?? []);
      if (!devices) return fail(400, "error.device.not.found");
      const id = state.nextId();
      const url = `${net.network.url}/profiles/${id}`;
      const p: RawProfile = { url, name: String(name).trim(), paused: false, default: false, state: { value: "active" }, devices: [], schedule: [], resources: { schedules: `${url}/schedules` } };
      net.profiles.push(p);
      setMembers(net, p, devices);
      return ok(p);
    },
  },
  {
    method: "PUT",
    path: "/networks/:net/profiles/:id",
    handle: (ctx) => {
      const net = ctx.network(ctx.params.net ?? "");
      const p = find(ctx);
      if (!p) return fail(404, "error.profile.not.found");
      const { name, paused, devices: list } = ctx.req.body;
      if (name !== undefined) {
        if (badName(name)) return fail(400, "error.profile.name.invalid");
        p.name = String(name).trim();
        for (const d of net.devices) if (d.profile?.url === p.url) d.profile = { ...d.profile, name: p.name };
      }
      if (list !== undefined) {
        const devices = devicesOf(net, list);
        if (!devices) return fail(400, "error.device.not.found");
        setMembers(net, p, devices);
      }
      if (typeof paused === "boolean") setPaused(net, p, paused);
      return ok(p);
    },
  },
  {
    method: "DELETE",
    path: "/networks/:net/profiles/:id",
    handle: (ctx) => {
      const net = ctx.network(ctx.params.net ?? "");
      const p = find(ctx);
      if (!p) return fail(404, "error.profile.not.found");
      if (p.default) return fail(400, "error.profile.default");
      setMembers(net, p, []);
      net.profiles = net.profiles.filter((x) => x !== p);
      return ok(null);
    },
  },
];
