/** eero area of the eero backend: `GET {net}/eeros` and `GET {eero}`. */

import { notAvailable } from "../../backend";
import { BackendError } from "../../errors";
import { mapEero, type RawEeroFull } from "../map/eero";
import { asList, linkUrl } from "../raw";
import { idFromUrl, networkPath } from "../urls";
import type { EeroArea } from "./index";

const eeroPath = (id: string) => `/2.2/eeros/${encodeURIComponent(id)}`;

export const eero: EeroArea<"eero"> = ({ client }) => ({
  async list(net) {
    const data = await client.request({ method: "GET", path: networkPath(net, "eeros") });
    return asList<RawEeroFull>(data, "eeros").map(mapEero);
  },

  async get(net, id) {
    const raw = await client.request<RawEeroFull>({ method: "GET", path: eeroPath(id) });
    const owner = linkUrl(raw?.network?.url);
    // eero ids are global; refuse an eero that belongs to another network.
    if (!raw || (owner && idFromUrl(owner) !== net)) throw new BackendError("eero_error", "That eero is not on this network.", { status: 404 });
    return mapEero(raw);
  },

  // Built by M2.6.
  ports: () => notAvailable("eero", "eero", "ports"),
  firmwareHistory: () => notAvailable("eero", "eero", "firmwareHistory"),
});
