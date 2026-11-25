/**
 * device area of the eero backend: `GET {net}/devices` merged with
 * `GET {net}/blacklist`, `GET {device}`, and `POST {net}/burst_reporters`.
 * The once-a-minute burst rule is enforced in core (commands/device.ts);
 * this area only remembers when bursts happened, to stamp live rates.
 *
 * Live window (#254): eero's `usage` figures are live only for a few seconds
 * after `next_burst` and then decay towards zero (eero-api, live-verified
 * 2026-10-20). Reads inside `BURST_LIVE_SEC` take them as they are and
 * remember them; reads after it (the regular device poll, a write) show the
 * last live figures stamped with their burst, never the decayed ones.
 *
 * Writes (M4.4): pause, nickname, type and profile are one JSON
 * `PUT /2.3/networks/{id}/devices/{mac}` each (`/2.2/` answers 200 and drops
 * them). "No profile" is eero's `default: true` profile, so it sends that
 * profile's url. Block is `POST {net}/blacklist` form `mac`, unblock
 * `DELETE {net}/blacklist/{mac}`.
 *
 * Offline profile members (M5.R-fix6): on a real network `GET {net}/devices`
 * leaves out devices that are in a profile but have been offline a while,
 * while the profile's own `devices[]` still lists them as device rows
 * (capture 2026-11-14: two profiles had 6 members missing from the list).
 * The list adds them from `GET {net}/profiles`, offline and in that profile,
 * so a profile's devices and counts match the eero app on every surface.
 *
 * Echos that can do eero Built-in (real capture, 2026-11-24): `GET
 * {net}/devices` leaves out every Echo listed in the network's
 * `proxied_nodes`, while each one's `client_device_url` (`{net}/devices/{mac}`)
 * answers a full device row, `source` naming the eero or Echo it connects
 * through. The eero app lists them as connected devices, so the list reads
 * that row for each one not acting as an eero (an Echo with eero Built-in on
 * is an eero in `eero.list`, and its device row answers an error). One GET
 * per such Echo; a failed read leaves it out.
 */

import { BackendError } from "../../errors";
import type * as M from "../../model";
import { BURST_LEAD_SEC, BURST_LIVE_SEC } from "../../poll";
import { mapDevice, type RawDeviceFull } from "../map/device";
import { asList, linkUrl, type RawBlockWrite, type RawBurstResult, type RawDeviceWrite, type RawProfile } from "../raw";
import { compactMac, deviceWritePath, idFromUrl, networkPath } from "../urls";
import type { EeroArea } from "./index";
import { fetchNetwork } from "./network";
import { fetchRouting } from "./routing";

type Usage = RawDeviceFull["usage"];

/** The last live figures per network: their burst's time and each device's usage, by compact MAC. */
type Held = { at: string; byMac: Map<string, Usage> };

/** How long the hidden Echos' device rows are kept before they are read again. */
const ECHO_ROWS_MS = 60_000;

export const device: EeroArea<"device"> = (ctx) => {
  const { client } = ctx;
  /** When the newest burst per network is due, epoch ms. */
  const bursts = new Map<M.Id, number>();
  const held = new Map<M.Id, Held>();

  /** The last read's usage per network, by MAC, to count changes for the request log. */
  const lastRead = new Map<M.Id, Map<string, string>>();

  const isLive = (net: M.Id): boolean => {
    const due = bursts.get(net);
    const now = Date.now();
    return due !== undefined && now >= due && now <= due + BURST_LIVE_SEC * 1000;
  };

  /**
   * Device rows with the usage to show and its burst time. A read inside a
   * burst's live window that has any traffic is taken as read and
   * remembered. Otherwise (outside the window, or a read where every device
   * is at zero because the figures have not landed or have decayed) each
   * row carries the last live figures, none for a device that had none.
   */
  const withRates = (net: M.Id, raws: RawDeviceFull[], list = false): { rows: RawDeviceFull[]; ratesAt: string | null } => {
    const due = bursts.get(net);
    const on = raws.filter((d) => d.connected === true);
    const rate = (d: RawDeviceFull) => (Number(d.usage?.down_mbps) || 0) + (Number(d.usage?.up_mbps) || 0);
    const nonZero = on.filter((d) => rate(d) > 0).length;
    const live = due !== undefined && isLive(net) && nonZero > 0;
    if (list && due !== undefined) {
      const prev = lastRead.get(net);
      const now = new Map(on.map((d) => [compactMac(d.mac ?? ""), `${d.usage?.down_mbps}/${d.usage?.up_mbps}`]));
      const changed = prev ? [...now].filter(([k, v]) => prev.get(k) !== v).length : on.length;
      lastRead.set(net, now);
      client.note("GET", networkPath(net, "devices"), { sinceDueSec: Math.round((Date.now() - due) / 100) / 10, connected: on.length, nonZero, changed, held: live });
    }
    if (due !== undefined && live) {
      const at = new Date(due).toISOString();
      const prev = held.get(net);
      const h: Held = prev?.at === at ? prev : { at, byMac: new Map() };
      for (const d of raws) {
        const mac = compactMac(d.mac ?? "");
        if (mac && d.connected === true && d.usage) h.byMac.set(mac, d.usage);
      }
      held.set(net, h);
      return { rows: raws, ratesAt: at };
    }
    const h = held.get(net);
    if (!h) return { rows: raws, ratesAt: null };
    return { rows: raws.map((d) => ({ ...d, usage: h.byMac.get(compactMac(d.mac ?? "")) ?? null })), ratesAt: h.at };
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

  /** Profile members as device rows, each pointing at its profile. A failed read adds none: the device list still loads. */
  const profileMembers = async (net: M.Id): Promise<RawDeviceFull[]> => {
    try {
      const profiles = asList<RawProfile>(await client.request({ method: "GET", path: networkPath(net, "profiles") }), "profiles");
      return profiles.flatMap((p) => {
        const url = linkUrl(p?.url);
        if (!url) return [];
        return (p.devices ?? []).map((d): RawDeviceFull => ({ ...d, connected: d.connected === true, profile: d.profile ?? { url } }));
      });
    } catch {
      return [];
    }
  };

  /** The hidden Echos' rows per network, read at most once a minute: many queries read the device list each poll. */
  const echoMemo = new Map<M.Id, { at: number; writes: number; rows: Promise<RawDeviceFull[]> }>();

  /** Device rows for the Echos `GET {net}/devices` leaves out: capable of eero Built-in but not acting as an eero. */
  const echoRows = (net: M.Id, listed: RawDeviceFull[]): Promise<RawDeviceFull[]> => {
    const listedMacs = new Set(listed.map((d) => compactMac(d.mac ?? "")).filter(Boolean));
    const keep = (rows: RawDeviceFull[]) => rows.filter((d) => !listedMacs.has(compactMac(d.mac ?? "")));
    const hit = echoMemo.get(net);
    // Kept a minute, and dropped after a device, profile or block write (it may have changed them).
    if (hit && hit.writes === client.deviceWrites && Date.now() - hit.at < ECHO_ROWS_MS) return hit.rows.then(keep);
    const rows = (async () => {
      let nodes;
      try {
        nodes = (await fetchNetwork(ctx, net)).proxied_nodes?.devices ?? [];
      } catch {
        return [];
      }
      const missing = nodes.filter((n) => n.enabled !== true && n.is_meshing !== true && n.client_device_url);
      const read = await Promise.all(
        missing.map((n) =>
          client
            .request<RawDeviceFull>({ method: "GET", path: n.client_device_url as string })
            .then((d) => (d && typeof d === "object" && (d.url || d.mac) ? [d] : []))
            .catch(() => [] as RawDeviceFull[]),
        ),
      );
      return read.flat();
    })();
    echoMemo.set(net, { at: Date.now(), writes: client.deviceWrites, rows });
    return rows.then(keep);
  };

  const list = async (net: M.Id): Promise<M.Device[]> => {
    const [listedOnly, blocked, members] = await Promise.all([
      // While a burst is live each read must reach eero, not take the client's 5 s shared answer.
      client.request({ method: "GET", path: networkPath(net, "devices"), share: !isLive(net) }).then((d) => asList<RawDeviceFull>(d, "devices")),
      blacklist(net),
      profileMembers(net),
    ]);
    const listed = [...listedOnly, ...(await echoRows(net, listedOnly))];
    // Members the device list left out (offline a while), once each, after the listed ones. Matched on MAC or link id.
    const keysOf = (d: RawDeviceFull) => [compactMac(d.mac ?? ""), idFromUrl(linkUrl(d.url) ?? "")].filter(Boolean);
    const known = new Set(listed.flatMap(keysOf));
    const devices = [...listed];
    for (const m of members) {
      const keys = keysOf(m);
      if (keys.length === 0 || keys.some((k) => known.has(k))) continue;
      for (const k of keys) known.add(k);
      devices.push(m);
    }
    const { rows, ratesAt } = withRates(net, devices, true);
    const blockedMacs = new Set(blocked.map((b) => compactMac(b.mac ?? "")).filter(Boolean));
    const out = rows.map((d) => mapDevice(d, { blocked: blockedMacs.has(compactMac(d.mac ?? "")), ratesAt }));
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
      const raw = await client.request<RawDeviceFull>({ method: "GET", path: networkPath(net, `devices/${compactMac(id) || encodeURIComponent(id)}`), share: !isLive(net) });
      if (raw && typeof raw === "object") {
        const blocked = raw.blocked === true || raw.blacklisted === true;
        const { rows, ratesAt } = withRates(net, [raw]);
        return mapDevice(rows[0] ?? raw, { blocked, ratesAt });
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
      const { rows, ratesAt } = withRates(net, [raw]);
      return mapDevice(rows[0] ?? raw, { blocked, ratesAt });
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
      // eero's next_burst is often about now; the figures land about BURST_LEAD_SEC after the POST.
      const posted = Date.now();
      const next = Math.max(Number.isFinite(parsed) ? parsed : 0, posted + BURST_LEAD_SEC * 1000);
      bursts.set(net, next);
      const sec = (t: number) => Math.round((t - posted) / 100) / 10;
      client.note("POST", networkPath(net, "burst_reporters"), { nextBurstSec: Number.isFinite(parsed) ? sec(parsed) : null, dueSec: sec(next) });
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
