/**
 * device area of the eero backend: `GET {net}/devices` merged with
 * `GET {net}/blacklist`, `GET {device}`, and `POST {net}/burst_reporters`.
 * The once-a-minute burst rule is enforced in core (commands/device.ts);
 * this area only remembers when bursts happened, to stamp live rates.
 *
 * Writes (M4.4): pause, nickname, type and profile are one JSON
 * `PUT /2.3/networks/{id}/devices/{mac}` each (`/2.2/` answers 200 and drops
 * them). "No profile" is eero's `default: true` profile, so it sends that
 * profile's url. Block is `POST {net}/blacklist` form `mac`, unblock
 * `DELETE {net}/blacklist/{mac}`.
 */

import { BackendError } from "../../errors";
import type * as M from "../../model";
import { mapDevice, type RawDeviceFull } from "../map/device";
import { asList, linkUrl, type RawBlockWrite, type RawBurstResult, type RawDeviceWrite, type RawProfile } from "../raw";
import { compactMac, deviceWritePath, idFromUrl, networkPath } from "../urls";
import type { EeroArea } from "./index";
import { fetchRouting } from "./routing";

/** When the last two bursts per network were due, epoch ms. */
type Bursts = { last: number; prev: number | null };

export const device: EeroArea<"device"> = (ctx) => {
  const { client } = ctx;
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

  /** The device's DHCP reservation from `GET {net}/routing`, matched on MAC. Bridge mode or a failed read: none. */
  const reservationFor = async (net: M.Id, mac: string): Promise<M.Device["reservation"]> => {
    if (!mac) return null;
    try {
      const r = (await fetchRouting(ctx, net))?.reservations?.data?.find((x) => compactMac(x?.mac ?? "") === compactMac(mac));
      return r?.ip ? { id: r.url ? idFromUrl(r.url) : compactMac(mac), ip: r.ip } : null;
    } catch {
      return null;
    }
  };

  const getOne = async (net: M.Id, id: M.Id): Promise<M.Device> => {
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
  };

  /** A device id is its compact MAC on eero; anything else is looked up. */
  const macOf = async (net: M.Id, id: M.Id): Promise<string> => (/^[0-9a-f]{12}$/i.test(id) ? id.toLowerCase() : (await getOne(net, id)).mac);

  /** One device write; the answer is mapped when eero sends the device back, else read again. */
  const write = async (net: M.Id, id: M.Id, body: RawDeviceWrite): Promise<M.Device> => {
    const mac = await macOf(net, id);
    const raw = await client.request<RawDeviceFull>({ method: "PUT", path: deviceWritePath(net, mac), body, encoding: "json" });
    if (raw && typeof raw === "object" && (raw.url || raw.mac)) {
      const blocked = raw.blocked === true || raw.blacklisted === true;
      return mapDevice(raw, { blocked, ratesAt: ratesAt(net) });
    }
    return getOne(net, mac);
  };

  /** eero's own Unassigned group: the profile flagged `default: true`. */
  const defaultProfileUrl = async (net: M.Id): Promise<string> => {
    const profiles = asList<RawProfile>(await client.request({ method: "GET", path: networkPath(net, "profiles") }), "profiles");
    const url = linkUrl(profiles.find((p) => p?.default === true)?.url);
    if (!url) throw new BackendError("eero_error", "This network has no Unassigned group to move the device to.");
    return url;
  };

  return {
    list,

    async get(net, id) {
      const d = await getOne(net, id);
      return { ...d, reservation: await reservationFor(net, d.mac) };
    },

    async requestBurst(net) {
      const raw = await client.request<RawBurstResult>({ method: "POST", path: networkPath(net, "burst_reporters"), encoding: "empty" });
      const parsed = raw?.next_burst ? Date.parse(raw.next_burst) : Number.NaN;
      const next = Number.isFinite(parsed) ? parsed : Date.now() + 12_000;
      const prev = bursts.get(net);
      bursts.set(net, { last: next, prev: prev ? (prev.last <= Date.now() ? prev.last : prev.prev) : null });
      return { nextBurstAt: new Date(next).toISOString() };
    },

    setPaused: (net, id, paused) => write(net, id, { paused }),
    rename: (net, id, nickname) => write(net, id, { nickname }),
    setType: (net, id, type) => write(net, id, { device_type: type }),

    async setProfile(net, id, profile) {
      const url = profile === null ? await defaultProfileUrl(net) : networkPath(net, `profiles/${encodeURIComponent(profile)}`);
      return write(net, id, { profile: { url } });
    },

    async setBlocked(net, id, blocked) {
      const d = await getOne(net, id);
      if (!d.mac) throw new BackendError("eero_error", "That device has no MAC address to block.");
      if (blocked) {
        const body: RawBlockWrite = { mac: d.mac };
        await client.request({ method: "POST", path: networkPath(net, "blacklist"), body, encoding: "form" });
      } else {
        await client.request({ method: "DELETE", path: networkPath(net, `blacklist/${compactMac(d.mac)}`), encoding: "none" });
      }
      return getOne(net, d.id);
    },
  };
};
