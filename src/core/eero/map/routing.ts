/**
 * Raw `GET {net}/routing` (plus the network's `dhcp` settings) to the model
 * `Routing`. Lenient: odd rows are skipped or given null fields, never a
 * throw. Sources: docs/eero-api/data-model.md#routing-get-networkrouting.
 */

import type * as M from "../../model";
import { type RawNetwork, type RawRouting, linkUrl } from "../raw";
import { compactMac, idFromUrl } from "../urls";

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : null);

export function protocol(v: unknown): M.Protocol {
  const p = typeof v === "string" ? v.toLowerCase() : "";
  return p === "udp" ? "udp" : p === "both" || p === "tcp_udp" || p === "tcp+udp" ? "both" : "tcp";
}

// ---------------------------------------------------------------------------
// LAN map

const toInt = (ip: string): number | null => {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return (((parts[0] as number) << 24) >>> 0) + ((parts[1] as number) << 16) + ((parts[2] as number) << 8) + (parts[3] as number);
};
const toIp = (n: number) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");

/**
 * eero's automatic LAN, as the eero app shows it: 192.168.4.0/22 with the
 * gateway at .4.1, a static range for reservations and the DHCP pool after it.
 */
const AUTOMATIC = { subnet: "192.168.4.0", mask: "255.255.252.0", start: "192.168.4.100", end: "192.168.7.254" };

/** The LAN map from `dhcp.custom`, or eero's automatic defaults. Leased count is filled in by core. */
export function mapLan(dhcp: RawNetwork["dhcp"] | undefined): M.LanMap | null {
  const c = dhcp?.mode === "custom" ? dhcp.custom : undefined;
  const subnetIp = toInt(c?.subnet_ip ?? AUTOMATIC.subnet);
  const maskInt = toInt(c?.subnet_mask ?? AUTOMATIC.mask);
  const start = toInt(c?.start_ip ?? AUTOMATIC.start);
  const end = toInt(c?.end_ip ?? AUTOMATIC.end);
  if (subnetIp === null || maskInt === null || start === null || end === null || end < start) return null;
  const wild = ~maskInt >>> 0;
  const hostBits = wild === 0 ? 0 : 32 - Math.clz32(wild);
  const network = (subnetIp & maskInt) >>> 0;
  const size = 2 ** hostBits;
  const gateway = network + 1;
  return {
    subnet: `${toIp(network)}/${32 - hostBits}`,
    size,
    gateway: toIp(gateway),
    pool: { start: toIp(start), end: toIp(end), size: end - start + 1, leased: 0 },
    // Addresses between the gateway and the pool: where reservations sit.
    staticRange: { start: toIp(gateway + 1), end: toIp(Math.max(gateway + 1, start - 1)) },
  };
}

// ---------------------------------------------------------------------------
// Routing

export function mapRouting(raw: RawRouting | null | undefined, dhcp: RawNetwork["dhcp"] | undefined): M.Routing {
  const known = (raw?.devices?.data ?? []).filter((d) => d && typeof d.mac === "string");
  const deviceByMac = new Map(known.map((d) => [compactMac(d.mac ?? ""), d.url ? idFromUrl(d.url) : compactMac(d.mac ?? "")]));

  const reservations: M.Reservation[] = (raw?.reservations?.data ?? []).flatMap((r) => {
    const mac = str(r?.mac);
    const ip = str(r?.ip);
    if (!r || !mac || !ip) return [];
    return [{ id: r.url ? idFromUrl(r.url) : compactMac(mac), deviceId: deviceByMac.get(compactMac(mac)) ?? null, name: str(r.description) ?? "", mac, ip, forwards: 0 }];
  });
  const resById = new Map(reservations.map((r) => [r.id, r]));
  const resByIp = new Map(reservations.map((r) => [r.ip, r]));

  const forwards: M.Forward[] = (raw?.forwards?.data ?? []).flatMap((f) => {
    if (!f) return [];
    const ip = str(f.ip);
    const resUrl = linkUrl(f.reservation);
    const res = (resUrl ? resById.get(idFromUrl(resUrl)) : undefined) ?? (ip ? resByIp.get(ip) : undefined);
    const external = str(f.gateway_port);
    if (!external) return [];
    if (res) res.forwards++;
    return [
      {
        id: f.url ? idFromUrl(f.url) : `${ip ?? ""}:${external}`,
        deviceId: res?.deviceId ?? null,
        name: str(f.description) ?? "",
        ip: ip ?? res?.ip ?? "",
        externalPort: external,
        internalPort: str(f.client_port) ?? external,
        protocol: protocol(f.protocol),
        enabled: f.enabled !== false,
      },
    ];
  });

  const pinholes: M.Pinhole[] = (raw?.pinholes?.data ?? []).flatMap((p) => {
    const port = str(p?.port);
    if (!p || !port) return [];
    const dev = typeof p.device === "string" ? { url: p.device } : (p.device ?? null);
    const devUrl = dev?.url ?? null;
    const devMac = dev && "mac" in dev ? str(dev.mac) : null;
    const deviceId = devMac ? (deviceByMac.get(compactMac(devMac)) ?? compactMac(devMac)) : devUrl ? idFromUrl(devUrl) : null;
    return [{ id: p.url ? idFromUrl(p.url) : `${deviceId ?? ""}:${port}`, deviceId, address: str(p.ip), port, protocol: protocol(p.protocol) }];
  });

  return { reservations, forwards, pinholes, lan: mapLan(dhcp) };
}
