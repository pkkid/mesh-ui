/**
 * eero area of the eero backend: `GET {net}/eeros`, `GET {eero}`,
 * `GET resources.connections` (ports) and
 * `GET /2.2/eeros/{id}/firmware_update/history`.
 */

import { BackendError } from "../../errors";
import type * as M from "../../model";
import { mapDevice, type RawDeviceFull } from "../map/device";
import { type Lan, lanOf, mapEero, mapFirmwareHistory, mapPorts, type RawEeroFull } from "../map/eero";
import { asList, linkUrl, type RawConnections, type RawEero, type RawFirmwareHistoryEntry, type RawNetwork } from "../raw";
import { idFromUrl, networkPath } from "../urls";
import type { EeroArea } from "./index";

const eeroPath = (id: string) => `/2.2/eeros/${encodeURIComponent(id)}`;

/** History rows asked for in one read. eero may return them oldest first, so core sorts and trims. */
const HISTORY_PAGE = 50;

const isMissing = (err: unknown) => err instanceof BackendError && err.code === "eero_error" && (err.detail?.status === 404 || err.detail?.status === 405);

export const eero: EeroArea<"eero"> = ({ client }) => {
  /** The network object for its DHCP and connection mode; null if eero refuses it (the eero fields then stay null). */
  const network = async (net: M.Id): Promise<RawNetwork | null> => {
    try {
      return await client.request<RawNetwork>({ method: "GET", path: networkPath(net) });
    } catch (err) {
      if (err instanceof BackendError && err.code === "eero_error") return null;
      throw err;
    }
  };

  const rawList = async (net: M.Id) => asList<RawEeroFull>(await client.request({ method: "GET", path: networkPath(net, "eeros") }), "eeros");

  /** One raw eero, refused when it belongs to another network (eero ids are global). */
  const rawGet = async (net: M.Id, id: M.Id): Promise<RawEeroFull> => {
    const raw = await client.request<RawEeroFull>({ method: "GET", path: eeroPath(id) });
    const owner = linkUrl(raw?.network?.url);
    if (!raw || (owner && idFromUrl(owner) !== net)) throw new BackendError("eero_error", "That eero is not on this network.", { status: 404 });
    return raw;
  };

  return {
    async list(net) {
      const [raws, rawNet] = await Promise.all([rawList(net), network(net)]);
      const lan = lanOf(rawNet, raws);
      return raws.map((r) => mapEero(r, lan));
    },

    async get(net, id) {
      const [raw, rawNet] = await Promise.all([rawGet(net, id), network(net)]);
      // The gateway address comes from the gateway eero; a single read only knows it when this is the gateway.
      // eero.get fills it from the list for the others.
      const lan: Lan = lanOf(rawNet, [raw as RawEero]);
      return mapEero(raw, lan);
    },

    async ports(net, id) {
      const raw = await rawGet(net, id);
      const path = linkUrl(raw.resources?.connections) ?? `${eeroPath(id)}/connections`;
      const conn = await client.request<RawConnections>({ method: "GET", path });
      const owner = mapEero(raw).id || id;
      const interfaces = conn?.ports?.interfaces ?? [];
      // Join only when something is plugged in: two more reads otherwise wasted.
      if (!interfaces.some((p) => p.neighbor)) return mapPorts(owner, conn, { devices: [], eeros: [] });
      const [devices, eeros] = await Promise.all([
        client.request({ method: "GET", path: networkPath(net, "devices") }).then((d) => asList<RawDeviceFull>(d, "devices").map((r) => mapDevice(r))),
        rawList(net).then((list) => list.map((e) => mapEero(e))),
      ]);
      return mapPorts(owner, conn, { devices, eeros });
    },

    async firmwareHistory(net, id, limit) {
      const raw = await rawGet(net, id);
      let rows: RawFirmwareHistoryEntry[];
      try {
        const data = await client.request({ method: "GET", path: `${eeroPath(id)}/firmware_update/history`, query: { limit: HISTORY_PAGE, offset: 0 } });
        rows = asList<RawFirmwareHistoryEntry>(data, "history");
      } catch (err) {
        // Some eeros have no history endpoint: no entries rather than an error.
        if (isMissing(err)) return [];
        throw err;
      }
      return mapFirmwareHistory(rows, mapEero(raw).firmware).slice(0, Math.max(0, limit));
    },
  };
};
