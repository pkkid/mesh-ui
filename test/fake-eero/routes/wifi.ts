/**
 * Fake main Wi-Fi writes (M4.7), changing the network in place so the next
 * `GET {net}` and `GET {net}/wpa3_per_band` show them. Requests as in
 * docs/eero-api/endpoints.md and src/core/eero/backend/wifi.ts:
 *
 * - `PUT {net}/settings`, form `name` (1 to 32 bytes): renames the SSID.
 * - `PUT {net}/password`, form `password` (8 to 63 printable ASCII).
 * - `PUT {net}/wpa3_per_band`, JSON `{band_2_4_ghz?, band_5_ghz?}`; a 6 GHz
 *   key is refused (always WPA3), as is a network without the endpoint.
 * - `PUT {net}/temporary_flags/hide_5g` `{value: true}` sets the flag with an
 *   expiry (eero picks it; the fake uses 20 minutes), `DELETE` clears it.
 *
 * Every write is also recorded in `fake.writes` by the server.
 */

import { fail, ok, type Route } from "../server";

const MODES = new Set(["WPA2", "WPA2_WPA3", "WPA3"]);
const HIDE_5G_MS = 20 * 60_000;

export const routes: Route[] = [
  {
    method: "PUT",
    path: "/networks/:net/settings",
    handle: ({ req, params, network }) => {
      const net = network(params.net ?? "");
      const name = req.body.name;
      if (typeof name !== "string" || name.trim() === "" || new TextEncoder().encode(name).length > 32) return fail(400, "error.network.name.invalid");
      net.network.name = name;
      return ok({ name });
    },
  },
  {
    method: "PUT",
    path: "/networks/:net/password",
    handle: ({ req, params, network }) => {
      const net = network(params.net ?? "");
      const password = req.body.password;
      if (typeof password !== "string" || !/^[\x20-\x7E]{8,63}$/.test(password)) return fail(400, "error.network.password.invalid");
      net.network.password = password;
      return ok(null);
    },
  },
  {
    method: "PUT",
    path: "/networks/:net/wpa3_per_band",
    handle: ({ req, params, network }) => {
      const net = network(params.net ?? "");
      if (!net.wpa3PerBand) return fail(404, "error.not.found");
      if ("band_6_ghz" in req.body) return fail(400, "error.wpa3.band_6_ghz.fixed");
      const next = { ...net.wpa3PerBand };
      for (const key of ["band_2_4_ghz", "band_5_ghz"] as const) {
        const v = req.body[key];
        if (v === undefined) continue;
        if (typeof v !== "string" || !MODES.has(v.toUpperCase())) return fail(400, "error.wpa3.mode.invalid");
        next[key] = v;
      }
      net.wpa3PerBand = next;
      return ok(next);
    },
  },
  {
    method: "PUT",
    path: "/networks/:net/temporary_flags/hide_5g",
    handle: ({ req, params, state, network }) => {
      const net = network(params.net ?? "");
      if (req.body.value !== true && req.body.value !== "true") return fail(400, "error.temporary_flags.invalid");
      const flag = { value: true, expires_on: new Date(state.now() + HIDE_5G_MS).toISOString() };
      net.network.temporary_flags = { ...net.network.temporary_flags, hide_5g: flag };
      return ok(flag);
    },
  },
  {
    method: "DELETE",
    path: "/networks/:net/temporary_flags/hide_5g",
    handle: ({ params, network }) => {
      const net = network(params.net ?? "");
      const { hide_5g: _gone, ...rest } = net.network.temporary_flags ?? {};
      net.network.temporary_flags = rest;
      return ok(null);
    },
  },
];
