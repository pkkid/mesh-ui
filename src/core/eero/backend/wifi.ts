/**
 * wifi area of the eero backend. `get` reads `GET {net}`, `GET {net}/wpa3_per_band`,
 * `GET {net}/eeros` and `GET {net}/devices` (the same paths other areas read,
 * so a page load shares them) and never maps the password. `credentials`
 * takes the name and password from `GET {net}`, which sends the password in
 * the clear (real capture, 2026-11-13); core builds the `WIFI:` payload.
 *
 * Writes (docs/eero-api/endpoints.md): name `PUT {net}/settings` form `name`;
 * password `PUT {net}/password` form `password`; security
 * `PUT {net}/wpa3_per_band` JSON with only the bands given (6 GHz is always
 * WPA3, never sent); 2.4 GHz only `PUT {net}/temporary_flags/hide_5g` JSON
 * `{value: true}`, off `DELETE` with no body. Each returns the next read.
 */

import { BackendError } from "../../errors";
import type * as M from "../../model";
import { mapDevice, type RawDeviceFull } from "../map/device";
import type { RawEeroFull } from "../map/eero";
import { mapWifi } from "../map/wifi";
import { asList, type RawHide5gWrite, type RawNetwork, type RawPasswordWrite, type RawWpa3PerBand } from "../raw";
import { networkPath } from "../urls";
import type { EeroArea } from "./index";

const isMissing = (err: unknown) => err instanceof BackendError && err.code === "eero_error" && (err.detail?.status === 404 || err.detail?.status === 405);

export const wifi: EeroArea<"wifi"> = ({ client }) => {
  // share false: a credential read never takes a finished shared GET {net}, so a reveal never shows an old password.
  const network = async (net: string, share = true): Promise<RawNetwork> => {
    const raw = await client.request<RawNetwork | null>({ method: "GET", path: networkPath(net), share });
    if (!raw || typeof raw !== "object") throw new BackendError("eero_error", "eero sent no data for this network.");
    return raw;
  };

  const get = async (net: string): Promise<M.WifiSettings> => {
    const [raw, wpa3, eeros, devices] = await Promise.all([
      network(net),
      // Older firmware has no per band endpoint; the network's `wpa3` switch stands in.
      client.request<RawWpa3PerBand | null>({ method: "GET", path: networkPath(net, "wpa3_per_band") }).catch((err: unknown) => {
        if (isMissing(err)) return null;
        throw err;
      }),
      client.request({ method: "GET", path: networkPath(net, "eeros") }).then((d) => asList<RawEeroFull>(d, "eeros")),
      client.request({ method: "GET", path: networkPath(net, "devices") }).then((d) => asList<RawDeviceFull>(d, "devices")),
    ]);
    return mapWifi(raw, wpa3, eeros, devices.map((d) => mapDevice(d)));
  };

  const RAW_BAND = { "2.4": "band_2_4_ghz", "5": "band_5_ghz" } as const;

  return {
    get,

    async credentials(net) {
      const raw = await network(net, false);
      const password = typeof raw.password === "string" && raw.password !== "" ? raw.password : null;
      return { ssid: typeof raw.name === "string" ? raw.name : "", password };
    },

    async setName(net, ssid) {
      await client.request({ method: "PUT", path: networkPath(net, "settings"), body: { name: ssid }, encoding: "form" });
      return get(net);
    },

    async setPassword(net, password) {
      const body: RawPasswordWrite = { password };
      await client.request({ method: "PUT", path: networkPath(net, "password"), body, encoding: "form" });
      return get(net);
    },

    async setSecurity(net, security) {
      const body: RawWpa3PerBand = {};
      for (const band of ["2.4", "5"] as const) {
        const mode = security[band];
        if (mode) body[RAW_BAND[band]] = mode;
      }
      await client.request({ method: "PUT", path: networkPath(net, "wpa3_per_band"), body, encoding: "json" });
      return get(net);
    },

    async setHide5g(net, enabled) {
      const path = networkPath(net, "temporary_flags/hide_5g");
      const body: RawHide5gWrite = { value: true };
      await client.request(enabled ? { method: "PUT", path, body, encoding: "json" } : { method: "DELETE", path });
      return get(net);
    },
  };
};
