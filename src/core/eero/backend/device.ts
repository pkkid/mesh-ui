/**
 * device area of the eero backend: `GET {net}/devices` merged with
 * `GET {net}/blacklist`, `GET {device}`, and `POST {net}/burst_reporters`.
 * The once-a-minute burst rule is enforced in core (commands/device.ts);
 * this area only remembers when bursts happened, to stamp live rates.
 */

import { BackendError } from "../../errors";
import type * as M from "../../model";
import { mapDevice, type RawDeviceFull } from "../map/device";
import { asList, type RawBurstResult } from "../raw";
import { compactMac, networkPath } from "../urls";
import type { EeroArea } from "./index";

/** When the last two bursts per network were due, epoch ms. */
type Bursts = { last: number; prev: number | null };

export const device: EeroArea<"device"> = ({ client }) => {
  const bursts = new Map<M.Id, Bursts>();

  /** The time of the newest burst whose rates are in, or null when none is known. */
  const ratesAt = (net: M.Id): string | null => {
    const b = bursts.get(net);
    if (!b) return null;
    const now = Date.now();
    const at = b.last <= now ? b.last : b.prev;
    return at === null ? null : new Date(at).toISOString();
  };

  const blacklist = async (net: M.Id): Promise<RawDeviceFull[]> => {
    try {
      return asList<RawDeviceFull>(await client.request({ method: "GET", path: networkPath(net, "blacklist") }), "devices");
    } catch (err) {
      // Firmware without the blocklist answers 404 or 405: no blocked devices.
      if (err instanceof BackendError && err.code === "eero_error" && (err.detail?.status === 404 || err.detail?.status === 405)) return [];
      throw err;
    }
  };

  const list = async (net: M.Id): Promise<M.Device[]> => {
    const [devices, blocked] = await Promise.all([
      client.request({ method: "GET", path: networkPath(net, "devices") }).then((d) => asList<RawDeviceFull>(d, "devices")),
      blacklist(net),
    ]);
    const at = ratesAt(net);
    const blockedMacs = new Set(blocked.map((b) => compactMac(b.mac ?? "")).filter(Boolean));
    const out = devices.map((d) => mapDevice(d, { blocked: blockedMacs.has(compactMac(d.mac ?? "")), ratesAt: at }));
    const seen = new Set(out.map((d) => compactMac(d.mac)));
    for (const b of blocked) {
      const mac = compactMac(b.mac ?? "");
      if (!mac || seen.has(mac)) continue;
      seen.add(mac);
      out.push(mapDevice({ ...b, connected: false }, { blocked: true }));
    }
    return out;
  };

  return {
    list,

    async get(net, id) {
      try {
        const raw = await client.request<RawDeviceFull>({ method: "GET", path: networkPath(net, `devices/${compactMac(id) || encodeURIComponent(id)}`) });
        if (raw && typeof raw === "object") {
          const blocked = raw.blocked === true || raw.blacklisted === true;
          return mapDevice(raw, { blocked, ratesAt: ratesAt(net) });
        }
      } catch (err) {
        // Blocked devices may only be on the blocklist.
        if (!(err instanceof BackendError && err.detail?.status === 404)) throw err;
      }
      const found = (await list(net)).find((d) => d.id === id || compactMac(d.mac) === compactMac(id));
      if (!found) throw new BackendError("eero_error", "That device is not on this network.", { status: 404 });
      return found;
    },

    async requestBurst(net) {
      const raw = await client.request<RawBurstResult>({ method: "POST", path: networkPath(net, "burst_reporters"), encoding: "empty" });
      const parsed = raw?.next_burst ? Date.parse(raw.next_burst) : Number.NaN;
      const next = Number.isFinite(parsed) ? parsed : Date.now() + 12_000;
      const prev = bursts.get(net);
      bursts.set(net, { last: next, prev: prev ? (prev.last <= Date.now() ? prev.last : prev.prev) : null });
      return { nextBurstAt: new Date(next).toISOString() };
    },
  };
};
