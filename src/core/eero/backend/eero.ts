/**
 * eero area of the eero backend: `GET {net}/eeros`, `GET {eero}`,
 * `GET resources.connections` (ports) and
 * `GET /2.2/eeros/{id}/firmware_update/history`. Writes (M4.8): rename
 * (`PUT {eero}` form `location`), status light (`PUT resources.led_action`
 * form), find (`POST /2.2/eeros/{serial}/led_cycle` form), nightlight
 * (`PUT {nightlight.url}` JSON) and restart (`POST resources.reboot`).
 */

import { BackendError } from "../../errors";
import type * as M from "../../model";
import { mapDevice, type RawDeviceFull } from "../map/device";
import { type Lan, lanOf, mapEero, mapFirmwareHistory, mapPorts, portConnections, type RawEeroFull } from "../map/eero";
import { asList, linkUrl, type RawConnections, type RawEero, type RawFirmwareHistoryEntry, type RawLedWrite, type RawNetwork, type RawNightlightWrite } from "../raw";
import { idFromUrl, networkPath } from "../urls";
import type { EeroArea } from "./index";

const eeroPath = (id: string) => `/2.2/eeros/${encodeURIComponent(id)}`;

/** History rows asked for in one read. eero may return them oldest first, so core sorts and trims. */
const HISTORY_PAGE = 50;

/** Blink colours and pace for find, as the eero app sends them. */
const FIND_COLORS = ["blue", "white"];

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

  const get = async (net: M.Id, id: M.Id): Promise<M.Eero> => {
    // The list names a wireless parent (eero sends only its location); eero.get reads it too, so the client shares the read.
    const [raw, rawNet, peers] = await Promise.all([rawGet(net, id), network(net), rawList(net).catch((err: unknown) => {
      if (err instanceof BackendError && err.code === "eero_error") return [] as RawEeroFull[];
      throw err;
    })]);
    // The gateway address comes from the gateway eero; a single read only knows it when this is the gateway.
    // eero.get fills it from the list for the others.
    const lan: Lan = lanOf(rawNet, [raw as RawEero]);
    return mapEero(raw, lan, peers);
  };

  return {
    async list(net) {
      const [raws, rawNet] = await Promise.all([rawList(net), network(net)]);
      const lan = lanOf(rawNet, raws);
      return raws.map((r) => mapEero(r, lan, raws));
    },

    get,

    async ports(net, id) {
      const raw = await rawGet(net, id);
      const path = linkUrl(raw.resources?.connections) ?? `${eeroPath(id)}/connections`;
      const conn = await client.request<RawConnections>({ method: "GET", path });
      const owner = mapEero(raw).id || id;
      const interfaces = conn?.ports?.interfaces ?? [];
      // Join only when something is plugged in: two more reads otherwise wasted.
      if (!interfaces.some((p) => portConnections(p).length > 0)) return mapPorts(owner, conn, { devices: [], eeros: [] });
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

    // Writes check the eero is on this network first (one GET), then send to the link eero gave.

    async rename(net, id, location) {
      const raw = await rawGet(net, id);
      await client.request({ method: "PUT", path: linkUrl(raw.url) ?? eeroPath(id), body: { location }, encoding: "form" });
      return { ...(await get(net, id)), location };
    },

    async find(net, id, seconds = 30) {
      const raw = await rawGet(net, id);
      // No led_cycle link is published (capture 2026-11-13); the clients address it by serial.
      const key = typeof raw.serial === "string" && raw.serial ? raw.serial : id;
      await client.request({
        method: "POST",
        path: `/2.2/eeros/${encodeURIComponent(key)}/led_cycle`,
        body: { "colors[]": FIND_COLORS, duration: seconds, time_per_color: 1 },
        encoding: "form",
      });
    },

    async setLed(net, id, led) {
      const raw = await rawGet(net, id);
      const body: RawLedWrite = {};
      if (led.on !== undefined) body.led_on = led.on;
      if (led.brightness !== undefined) body.led_brightness = led.brightness;
      // A JSON PUT to {eero} is silently ignored; only the led_action link with a form body sticks.
      await client.request({ method: "PUT", path: linkUrl(raw.resources?.led_action) ?? `${eeroPath(id)}/led`, body, encoding: "form" });
      const e = await get(net, id);
      return { ...e, led: { on: led.on ?? e.led.on, brightness: led.brightness ?? e.led.brightness } };
    },

    async setNightlight(net, id, n) {
      const raw = await rawGet(net, id);
      if (!raw.nightlight) throw new BackendError("eero_error", "This eero has no nightlight.", { status: 400 });
      const body: RawNightlightWrite = {
        enabled: n.mode !== "off",
        brightness_percentage: n.brightness ?? 50,
        schedule: { enabled: n.mode === "schedule", on: n.on ?? "20:00", off: n.off ?? "07:00" },
      };
      await client.request({ method: "PUT", path: linkUrl(raw.nightlight.url) ?? `${eeroPath(id)}/nightlight/settings`, body, encoding: "json" });
      return { ...(await get(net, id)), nightlight: { ...n } };
    },

    async restart(net, id) {
      const raw = await rawGet(net, id);
      await client.request({ method: "POST", path: linkUrl(raw.resources?.reboot) ?? `${eeroPath(id)}/reboot`, encoding: "empty" });
    },
  };
};
