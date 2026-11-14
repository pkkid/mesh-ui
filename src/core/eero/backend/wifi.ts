/**
 * wifi area of the eero backend. `get` reads `GET {net}`, `GET {net}/wpa3_per_band`,
 * `GET {net}/eeros` and `GET {net}/devices` (the same paths other areas read,
 * so a page load shares them) and never maps the password. `credentials`
 * takes the name and password from `GET {net}`, which sends the password in
 * the clear (real capture, 2026-11-13); core builds the `WIFI:` payload.
 */

import { BackendError } from "../../errors";
import { mapDevice, type RawDeviceFull } from "../map/device";
import type { RawEeroFull } from "../map/eero";
import { mapWifi } from "../map/wifi";
import { asList, type RawNetwork, type RawWpa3PerBand } from "../raw";
import { networkPath } from "../urls";
import type { EeroArea } from "./index";

const isMissing = (err: unknown) => err instanceof BackendError && err.code === "eero_error" && (err.detail?.status === 404 || err.detail?.status === 405);

export const wifi: EeroArea<"wifi"> = ({ client }) => {
  const network = async (net: string): Promise<RawNetwork> => {
    const raw = await client.request<RawNetwork | null>({ method: "GET", path: networkPath(net) });
    if (!raw || typeof raw !== "object") throw new BackendError("eero_error", "eero sent no data for this network.");
    return raw;
  };

  return {
    async get(net) {
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
    },

    async credentials(net) {
      const raw = await network(net);
      const password = typeof raw.password === "string" && raw.password !== "" ? raw.password : null;
      return { ssid: typeof raw.name === "string" ? raw.name : "", password };
    },
  };
};
