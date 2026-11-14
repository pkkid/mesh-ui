/**
 * Maps raw eero network, permission and speed test shapes to the model.
 * Pure functions: no requests. Field sources are in
 * docs/architecture/data-model.md (Network; Internet, speed and usage).
 * A field eero did not send maps to null, never to 0, false or "".
 */

import type * as M from "../../model";
import type { RawAccount, RawEero, RawNetwork, RawPermissions, RawSpeedTest, RawSpeedValue } from "../raw";
import { idFromUrl } from "../urls";

/** Fields read here that raw.ts does not list yet (shapes partly unverified). */
type RawNetworkWan = RawNetwork & {
  pppoe_enabled?: boolean | null;
  ipv6_lease?: { ip?: string; address?: string; prefix?: string; prefix_delegation?: string; ipv6_prefix?: string } | null;
};

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);

/** Any date eero sends ("2026-11-12T03:00:00+0000" included) as ISO UTC, or null. */
export function toIso(v: unknown): M.Iso | null {
  if (typeof v !== "string" || !v) return null;
  let ms = Date.parse(v);
  // "+0000" without a colon is not ISO 8601; some engines refuse it.
  if (!Number.isFinite(ms)) ms = Date.parse(v.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** Network or health status words to the Status union. */
export function mapStatus(raw: unknown): M.Status {
  switch (typeof raw === "string" ? raw.toLowerCase() : "") {
    case "connected":
    case "online":
    case "green":
      return "online";
    case "offline":
    case "disconnected":
    case "red":
      return "offline";
    case "degraded":
    case "yellow":
      return "degraded";
    case "updating":
      return "updating";
    default:
      return "unknown";
  }
}

/** `owner`; `standard-admin` and other admin roles to `admin`. */
export function mapRole(raw: unknown): M.Role | null {
  const role = typeof raw === "string" ? raw.toLowerCase() : "";
  if (role === "owner") return "owner";
  if (role.includes("admin")) return "admin";
  return null;
}

/** Banner messages as plain strings; objects give their title or text. */
export function mapMessages(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const m of raw) {
    if (typeof m === "string" && m.trim()) out.push(m);
    else if (m && typeof m === "object") {
      const o = m as Record<string, unknown>;
      const text = str(o.title) ?? str(o.message) ?? str(o.text) ?? str(o.body);
      if (text) out.push(text);
    }
  }
  return out;
}

const eerosOf = (raw: RawNetwork): RawEero[] => (Array.isArray(raw.eeros?.data) ? raw.eeros.data : []);

const isWired = (e: RawEero) => e.wired === true || e.connection_type?.toUpperCase() === "WIRED";

function gatewayOf(eeros: RawEero[]): RawEero | null {
  return eeros.find((e) => e.gateway === true) ?? eeros.find((e) => e.is_primary_node === true) ?? null;
}

/**
 * `status` downgraded to degraded when any eero is red or the ISP is down.
 * See data-model.md (Network).
 */
export function networkStatus(raw: RawNetwork): M.Status {
  const status = mapStatus(raw.status);
  if (status !== "online") return status;
  const redEero = eerosOf(raw).some((e) => e.status === "red");
  return redEero || raw.health?.internet?.isp_up === false ? "degraded" : status;
}

/** The newest eero heartbeat, as "last seen" for an offline network. */
function lastSeen(raw: RawNetwork, status: M.Status): M.Iso | null {
  if (status !== "offline") return null;
  const beats = eerosOf(raw)
    .map((e) => toIso(e.last_heartbeat))
    .filter((t): t is string => t !== null)
    .sort();
  return beats[beats.length - 1] ?? null;
}

/** Role from `GET {net}/permissions`, else the account role. */
export function roleFor(perms: RawPermissions | null, account: RawAccount | null): M.Role | null {
  return mapRole(perms?.role) ?? mapRole(account?.role);
}

export function mapNetworkSummary(raw: RawNetwork, opts: { id?: M.Id; role: M.Role | null; name?: string | null; nickname?: string | null }): M.NetworkSummary {
  const status = networkStatus(raw);
  const eeros = raw.eeros;
  return {
    id: opts.id ?? idFromUrl(raw.url ?? ""),
    name: str(raw.name) ?? str(raw.display_name) ?? str(opts.name) ?? "",
    nickname: str(raw.nickname_label) ?? str(opts.nickname),
    role: opts.role,
    status,
    eeroCount: num(eeros?.count) ?? (Array.isArray(eeros?.data) ? eeros.data.length : null),
    devicesOnline: num(raw.clients?.count),
    isp: str(raw.geo_ip?.isp),
    updateAvailable: bool(raw.updates?.has_update),
    lastSeen: lastSeen(raw, status),
    selected: false,
  };
}

/** A network known only from the account list (its `GET {net}` failed). */
export function unknownNetworkSummary(id: M.Id, name: string | null, nickname: string | null, role: M.Role | null): M.NetworkSummary {
  return {
    id,
    name: name ?? "",
    nickname: str(nickname),
    role,
    status: "unknown",
    eeroCount: null,
    devicesOnline: null,
    isp: null,
    updateAvailable: null,
    lastSeen: null,
    selected: false,
  };
}

const CONNECTION_MODES: readonly M.ConnectionMode[] = ["nat", "bridged", "ipPassthrough"];

export function mapNetwork(raw: RawNetwork, opts: { id?: M.Id; role: M.Role | null }): M.Network {
  const summary = mapNetworkSummary(raw, opts);
  const mode = raw.connection?.mode;
  const capabilities: Record<string, boolean> = {};
  for (const [name, cap] of Object.entries(raw.capabilities ?? {})) {
    if (cap && typeof cap.capable === "boolean") capabilities[name] = cap.capable;
  }
  return {
    ...summary,
    timezone: str(raw.timezone?.value),
    connectionMode: CONNECTION_MODES.includes(mode as M.ConnectionMode) ? (mode as M.ConnectionMode) : null,
    gatewayUptimeSec: num(gatewayOf(eerosOf(raw))?.uptime?.since_last_reboot_s),
    lastReboot: toIso(raw.last_reboot),
    capabilities,
    messages: mapMessages(raw.messages),
    counts: { eeros: summary.eeroCount, devices: num(raw.clients?.count), profiles: num(raw.profiles?.count) },
  };
}

/** Derived from `GET {net}` only: health, the embedded eeros, messages. */
export function mapHealth(raw: RawNetwork): Omit<M.NetworkHealth, "issues"> {
  return {
    status: networkStatus(raw),
    internet: { status: mapStatus(raw.health?.internet?.status), ispUp: bool(raw.health?.internet?.isp_up) },
    mesh: { status: mapStatus(raw.health?.eero_network?.status) },
    eeros: eerosOf(raw).map((e) => {
      const wired = isWired(e);
      const meshBars = wired ? null : num(e.mesh_quality_bars);
      return {
        id: idFromUrl(e.url ?? ""),
        location: str(e.location) ?? str(e.serial) ?? "",
        status: mapStatus(e.status),
        meshBars,
        weakLink: !wired && meshBars !== null && meshBars <= 2,
      };
    }),
    messages: mapMessages(raw.messages),
  };
}

export function mapPermissions(raw: RawPermissions, fallbackRole: M.Role | null = null): M.Permissions {
  const can: Record<string, M.Permission> = {};
  for (const [area, p] of Object.entries(raw.permissions ?? {})) {
    if (area === "per_eero" || !p || typeof p !== "object" || Array.isArray(p)) continue;
    const v = p as { create?: unknown; read?: unknown; update?: unknown; delete?: unknown };
    can[area] = { read: v.read === true, create: v.create === true, update: v.update === true, delete: v.delete === true };
  }
  return { role: mapRole(raw.role) ?? fallbackRole, can };
}

// ---------------------------------------------------------------------------
// Internet and speed tests

/** A `{value, units}` speed in Mbps. */
function speedMbps(v: RawSpeedValue | undefined): number | null {
  const value = num(v?.value);
  if (value === null) return null;
  const units = (v?.units ?? "Mbps").toLowerCase();
  if (units.startsWith("g")) return value * 1000;
  if (units.startsWith("k")) return value / 1000;
  return value;
}

/** `"P2500"` (or `"2500"`) to 2500. */
export function portSpeedMbps(raw: unknown): number | null {
  if (typeof raw === "number") return num(raw);
  const m = typeof raw === "string" ? /^P?(\d+)$/i.exec(raw.trim()) : null;
  return m?.[1] ? Number(m[1]) : null;
}

/** RFC 1918, CGNAT (100.64/10) and link-local IPv4 addresses. */
export function isPrivateIpv4(ip: string | null | undefined): boolean {
  const m = ip ? /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(ip.trim()) : null;
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254);
}

function wanType(raw: RawNetworkWan): M.Internet["wanType"] {
  if (raw.pppoe_enabled === true) return "pppoe";
  for (const v of [raw.wan_type, raw.lease?.mode]) {
    const t = typeof v === "string" ? v.toLowerCase() : "";
    if (t === "dhcp" || t === "static" || t === "pppoe") return t;
  }
  return null;
}

/** `speed` on the network: the latest test. `rating` is left for core. */
export function mapLastSpeedTest(raw: RawNetwork): M.SpeedTest | null {
  const at = toIso(raw.speed?.date);
  if (!at) return null;
  return { at, downMbps: speedMbps(raw.speed?.down), upMbps: speedMbps(raw.speed?.up), rating: null };
}

/** The connection details from `GET {net}`; the gateway from its eeros (embedded or `GET {net}/eeros`). */
export function mapInternet(raw: RawNetwork, eeros: RawEero[] = eerosOf(raw)): Omit<M.Internet, "planMbps" | "verdict"> {
  const r = raw as RawNetworkWan;
  const geo = raw.geo_ip;
  const asn = geo?.asn as unknown;
  const wanIp = str(raw.ip_settings?.public_ip) ?? str(raw.wan_ip);
  const dnsMode = raw.dns?.mode === "custom" ? "custom" : raw.dns?.mode === "automatic" ? "automatic" : null;
  const dnsIps = (dnsMode === "custom" ? raw.dns?.custom?.ips : raw.dns?.parent?.ips) ?? [];
  const gw = gatewayOf(eeros);
  // A port without carrier still reports a speed ("P10"), so only a linked WAN port counts.
  const wanPort = gw?.ethernet_status?.statuses?.find((s) => s.isWanPort === true && s.hasCarrier !== false);
  const doubleNat = bool(raw.ip_settings?.double_nat) ?? (str(raw.wan_ip) ? isPrivateIpv4(raw.wan_ip) : null);
  const v6 = r.ipv6_lease && typeof r.ipv6_lease === "object" ? r.ipv6_lease : null;
  return {
    status: mapStatus(raw.health?.internet?.status),
    isp: {
      name: str(geo?.isp),
      org: str(geo?.org),
      asn: typeof asn === "number" ? `AS${asn}` : str(asn),
      city: str(geo?.city),
      region: str(geo?.regionName) ?? str(geo?.region),
      country: str(geo?.countryCode) ?? str(geo?.countryName),
    },
    publicIpv4: wanIp,
    publicIpv6: str(v6?.ip) ?? str(v6?.address),
    ipv6Prefix: str(v6?.prefix_delegation) ?? str(v6?.prefix) ?? str(v6?.ipv6_prefix),
    wanType: wanType(r),
    ispGateway: str(raw.gateway_ip) ?? str(raw.lease?.dhcp?.router),
    vlan: null,
    dnsInUse: dnsIps.filter((ip): ip is string => typeof ip === "string" && ip !== ""),
    dnsMode,
    doubleNat,
    gateway: gw
      ? {
          eeroId: idFromUrl(gw.url ?? ""),
          location: str(gw.location) ?? "",
          model: str(gw.model),
          wanPortSpeedMbps: portSpeedMbps(wanPort?.speed),
        }
      : null,
    lastSpeedTest: mapLastSpeedTest(raw),
  };
}

/** `GET {net}/speedtest` rows, newest first. Rows without a valid date are dropped. */
export function mapSpeedTests(rows: RawSpeedTest[]): M.SpeedTest[] {
  const out: M.SpeedTest[] = [];
  for (const row of rows) {
    const at = toIso(row.date);
    if (at) out.push({ at, downMbps: num(row.down_mbps), upMbps: num(row.up_mbps), rating: null });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}
