/**
 * eero backend, settings area: the network object (`GET {net}`, shared with
 * other reads) plus `GET {net}/fast_transition`, `GET {net}/power_saving/schedules`,
 * `GET {net}/thread` and `GET {net}/ac_compat`. A 403 or 404 on one of the
 * extra reads means "not on this network" (null), never an error. Power
 * saving itself is on the network object (`GET {net}/power_saving` is a 404).
 * Thread secrets are read only by `threadCredentials`.
 *
 * Writes (M5.2) are one JSON `PUT {net}/settings` each, as in
 * docs/eero-api/endpoints.md section 4: `dns` (+ `ipv6.name_servers`),
 * `dhcp`, `ipv6_upstream`, `lease` + `pppoe` + `vlan` (string, "" for off),
 * `connection`, `nat_port_randomization`, `upnp`, `sqm`. Each answers with the
 * next `get` (a write drops every shared read). Core skips unchanged writes.
 * See docs/architecture/commands.md (settings) and docs/eero-api/endpoints.md
 * sections 4 and 17.
 */

import { BackendError } from "../../errors";
import { mapSettings, mapThreadCredentials } from "../map/settings";
import { asList, type RawAcCompat, type RawFastTransition, type RawPowerSavingSchedule, type RawThread } from "../raw";
import type { DhcpInput, DnsInput, WanInput } from "../../backend";
import { networkPath } from "../urls";
import type { EeroArea, EeroContext } from "./index";
import { fetchNetwork, networkLinks } from "./network";

/** A GET that answers null on 403, 404 or 405: the feature is not on this network or role. */
export async function readOptional<T>(ctx: EeroContext, path: string): Promise<T | null> {
  try {
    return (await ctx.client.request<T | null>({ method: "GET", path })) ?? null;
  } catch (err) {
    if (err instanceof BackendError && err.code === "eero_error" && [403, 404, 405].includes(Number(err.detail?.status))) return null;
    throw err;
  }
}

/** `PUT {net}/settings` JSON bodies. eero takes the VLAN as a string ("" turns it off). */
export function dnsBody(dns: DnsInput): Record<string, unknown> {
  return {
    dns: { mode: dns.mode, ...(dns.caching === null ? {} : { caching: dns.caching }), custom: { ips: dns.servers } },
    ipv6: { name_servers: { mode: dns.mode === "custom" && dns.ipv6Servers.length > 0 ? "custom" : "automatic", custom: dns.ipv6Servers } },
  };
}

export function dhcpBody(dhcp: DhcpInput): Record<string, unknown> {
  if (dhcp.mode === "automatic") return { dhcp: { mode: "automatic" } };
  return { dhcp: { mode: "custom", custom: { subnet_ip: dhcp.subnetIp, subnet_mask: dhcp.subnetMask, start_ip: dhcp.startIp, end_ip: dhcp.endIp } } };
}

export function wanBody(wan: WanInput): Record<string, unknown> {
  const vlan = wan.vlan === null ? "" : String(wan.vlan);
  if (wan.mode === "pppoe") return { lease: { mode: "dhcp" }, pppoe: { enabled: true, credentials: { username: wan.pppoe?.username, password: wan.pppoe?.password } }, vlan };
  const lease = wan.mode === "static" ? { mode: "static", static: wan.static } : { mode: "dhcp" };
  return { lease, pppoe: { enabled: false }, vlan };
}

export const settings: EeroArea<"settings"> = (ctx) => {
  const links = networkLinks(ctx);
  const base = (id: string) => links.get(`net:${id}`, networkPath(id));
  const put = (id: string, body: Record<string, unknown>) => ctx.client.request({ method: "PUT", path: networkPath(id, "settings"), body, encoding: "json" });
  const thread = (id: string) => readOptional<RawThread>(ctx, links.get(`net:${id}.thread`, `${base(id)}/thread`));

  const area = {
    async get(id: string) {
      const raw = await fetchNetwork(ctx, id);
      const [fastTransition, schedules, threadRaw, acCompat] = await Promise.all([
        readOptional<RawFastTransition>(ctx, `${base(id)}/fast_transition`),
        readOptional<unknown>(ctx, `${base(id)}/power_saving/schedules`).then((r) => asList<RawPowerSavingSchedule>(r, "schedules")),
        thread(id),
        readOptional<RawAcCompat>(ctx, `${base(id)}/ac_compat`),
      ]);
      return mapSettings(raw, { fastTransition, schedules, thread: threadRaw, acCompat });
    },

    async threadCredentials(id: string) {
      return mapThreadCredentials(await thread(id));
    },
  };
  const write = async (id: string, body: Record<string, unknown>) => {
    await put(id, body);
    return area.get(id);
  };

  return {
    ...area,
    setDns: (id, dns) => write(id, dnsBody(dns)),
    setDhcp: (id, dhcp) => write(id, dhcpBody(dhcp)),
    setIpv6: (id, enabled) => write(id, { ipv6_upstream: enabled }),
    setWan: (id, wan) => write(id, wanBody(wan)),
    setConnectionMode: (id, mode) => write(id, { connection: { mode } }),
    setNatRandomization: (id, randomized) => write(id, { nat_port_randomization: randomized }),
    setUpnp: (id, enabled) => write(id, { upnp: enabled }),
    setSqm: (id, enabled) => write(id, { sqm: enabled }),
  };
};
