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
 * M5.3 writes: `band_steering` through the same `PUT {net}/settings`; `PUT {net}/fast_transition`, `{net}/mlo_mode`,
 * `{net}/ac_compat` (form), `{net}/power_saving` (`enable`,
 * `power_saving_schedule_enabled`), `{net}/auto_setup_mode` (`{mode}`: `ZTS`
 * on, `DEFAULT` off, as eero's app sends), `{thread}/enable` (`{enabled}`,
 * Thread on or off; `thread_enable` on `{thread}` answers 200 and changes
 * nothing), `{thread}` (`enable_credential_syncing`); `POST
 * {net}/thread` regenerates the Thread credentials; power saving schedules
 * are `POST`, `PUT` and `DELETE` under `{net}/power_saving/schedules`.
 *
 * No `setTimezone` (M6.9), so `settings.timezone.set` sends nothing and
 * answers "not available yet" like every unbuilt write: `PUT {net}/settings` `{timezone: {value}}` (the only request any
 * client sends) answered 200 on a real network and kept the old zone
 * (M5.R-fix4, M5 review), and no client that tested a time zone write live
 * is known (endpoints.md section 20). Demo still applies it.
 * See docs/architecture/commands.md (settings) and docs/eero-api/endpoints.md
 * sections 4, 17 and 20.
 */

import { BackendError } from "../../errors";
import type * as M from "../../model";
import { mapPowerSavingSchedule, mapSettings, mapThreadCredentials } from "../map/settings";
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
  const threadPath = (id: string) => links.get(`net:${id}.thread`, `${base(id)}/thread`);
  const thread = (id: string) => readOptional<RawThread>(ctx, threadPath(id));

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

    // M5.3: wireless, mesh and Thread. Each has its own endpoint unless noted.
    setBandSteering: (id, enabled) => write(id, { band_steering: enabled }),
    setFastTransition: (id, enabled) => own(id, "PUT", "fast_transition", { fast_transition: enabled }),
    setMlo: (id, mode) => own(id, "PUT", "mlo_mode", { mlo_mode: mode }),
    setLegacyMode: (id, enabled) => own(id, "PUT", "ac_compat", { enabled }, "form"),
    setPowerSaving: (id, input) =>
      own(id, "PUT", "power_saving", {
        ...(input.enabled === undefined ? {} : { enable: input.enabled }),
        ...(input.scheduleEnabled === undefined ? {} : { power_saving_schedule_enabled: input.scheduleEnabled }),
      }),
    // eero's app sends ZTS for on and DEFAULT for off (eero stores DEFAULT as LTS). See map/settings.ts simpleSetup.
    setSimpleSetup: (id, enabled) => own(id, "PUT", "auto_setup_mode", { mode: enabled ? "ZTS" : "DEFAULT" }),
    async setThread(id, input) {
      // Two endpoints: on or off is `{thread}/enable` (SX, Eeronaut); `thread_enable` on `{thread}` is ignored by eero.
      if (input.enabled !== undefined) await ctx.client.request({ method: "PUT", path: `${threadPath(id)}/enable`, body: { enabled: input.enabled }, encoding: "json" });
      if (input.credentialSync !== undefined) await ctx.client.request({ method: "PUT", path: threadPath(id), body: { enable_credential_syncing: input.credentialSync }, encoding: "json" });
      return area.get(id);
    },
    async resetThread(id) {
      // Regenerates the credentials: every Thread accessory must re-pair.
      await ctx.client.request({ method: "POST", path: threadPath(id), encoding: "empty" });
    },
    async addPowerSavingSchedule(id, input) {
      const raw = await ctx.client.request<RawPowerSavingSchedule | null>({ method: "POST", path: `${base(id)}/power_saving/schedules`, body: scheduleBody(input), encoding: "json" });
      return savedSchedule(id, raw, input);
    },
    async updatePowerSavingSchedule(id, sid, input) {
      const raw = await ctx.client.request<RawPowerSavingSchedule | null>({ method: "PUT", path: `${base(id)}/power_saving/schedules/${sid}`, body: scheduleBody(input), encoding: "json" });
      return savedSchedule(id, raw, input, sid);
    },
    async removePowerSavingSchedule(id, sid) {
      await ctx.client.request({ method: "DELETE", path: `${base(id)}/power_saving/schedules/${sid}` });
    },
  };

  /** A write to one of the network's own endpoints (`{net}/fast_transition`), answered with the next `get`. */
  async function own(id: string, method: "PUT", path: string, body: Record<string, unknown>, encoding: "json" | "form" = "json") {
    await ctx.client.request({ method, path: `${base(id)}/${path}`, body, encoding });
    return area.get(id);
  }

  /** eero answers a schedule write with the schedule; if it sends none, find it in the next list by name. */
  async function savedSchedule(id: string, raw: RawPowerSavingSchedule | null, input: M.ScheduleInput, sid?: string): Promise<M.Schedule> {
    const mapped = raw && typeof raw === "object" ? mapPowerSavingSchedule(raw, 0) : null;
    if (mapped && (raw?.id !== undefined || raw?.url !== undefined)) return mapped;
    const list = asList<RawPowerSavingSchedule>(await ctx.client.request({ method: "GET", path: `${base(id)}/power_saving/schedules` }), "schedules");
    const found = list.map(mapPowerSavingSchedule).find((x) => x !== null && (sid ? x.id === sid : x.name === input.name));
    return found ?? { id: sid ?? "", ...input };
  }
};

/** eero's day names for power saving schedules: capitalized, full. */
export const POWER_DAY_NAMES: Record<M.Day, string> = { MON: "Monday", TUE: "Tuesday", WED: "Wednesday", THU: "Thursday", FRI: "Friday", SAT: "Saturday", SUN: "Sunday" };

/**
 * `{name, days, start_time, end_time, enabled}`. Days go as capitalized full
 * names ("Monday"): eero answers `MON` (FF and LD's form, never verified)
 * and "monday" with a bare 400 `error.form.errors`, and takes "Monday"
 * (Bretteroo/Eeronaut, checked on a live network; M5.R-fix4).
 */
/** Tolerates a missing input so the request (and eero's error) still happens. */
export const scheduleBody = ({ name, days, start, end, enabled } = {} as M.ScheduleInput) => ({ name, days: Array.from(days ?? [], (d) => POWER_DAY_NAMES[d] ?? d), start_time: start, end_time: end, enabled });

/**
 * Deleting the network (`DELETE {net}`), joined to the network area in
 * ./index.ts (as coverage joins the eero area), so M5.3 does not edit the
 * network file other stories own.
 */
export const networkDelete = (ctx: EeroContext): { remove(id: string): Promise<void> } => {
  const links = networkLinks(ctx);
  return {
    async remove(id) {
      await ctx.client.request({ method: "DELETE", path: links.get(`net:${id}`, networkPath(id)) });
    },
  };
};
