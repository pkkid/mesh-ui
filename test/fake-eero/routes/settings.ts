/**
 * Fake settings reads: `GET {net}/fast_transition`, `GET {net}/power_saving/schedules`,
 * `GET {net}/thread` (secrets included, as eero sends them; 404 on a network
 * without Thread) and `GET {net}/ac_compat`. Everything else, integrations
 * included, is on the network object. `GET {net}/power_saving` and
 * `GET {net}/proxied_nodes` answer 404, as on a real network.
 * Shapes: docs/eero-api/endpoints.md section 17.
 *
 * `PUT {net}/settings` (M5.2) takes the JSON keys of docs/eero-api/endpoints.md
 * section 4 and changes the network object in place, so the next `GET {net}`
 * shows them: `dns` (+ `ipv6.name_servers`), `dhcp`, `ipv6_upstream`, `lease`,
 * `pppoe`, `vlan` (string, "" for off), `connection`, `nat_port_randomization`,
 * `upnp`, `sqm`. A bad value answers 400 and changes nothing. A form `name`
 * (the Wi-Fi rename) goes to the route in ./wifi.ts, which owns it. The fake
 * keeps the PPPoE user name only; the password is in `fake.writes`.
 *
 * M5.3: `band_steering` and `timezone{value}` on `PUT {net}/settings`; JSON
 * `PUT {net}/fast_transition`, `{net}/mlo_mode` (400 on a network without
 * it), `{net}/power_saving` (`enable`, `power_saving_schedule_enabled`),
 * `{net}/auto_setup_mode` (`{mode}`: DEFAULT, ZTS, LTS or OFF; DEFAULT is
 * stored as LTS), `{net}/thread/enable` (`{enabled}`, Thread on or off) and
 * `{net}/thread` (`enable_credential_syncing`; `thread_enable` is accepted
 * and ignored, as the real API does); form `PUT
 * {net}/ac_compat` (`enabled`); `POST {net}/thread` makes new secrets; power
 * saving schedules are `POST`, `PUT` and `DELETE` under
 * `{net}/power_saving/schedules`. Thread writes on a network without Thread
 * answer 404.
 */

import { fail, FakeAnswer, ok, type Route, type RouteContext } from "../server";
import type { FakeNetwork } from "../state";
import { routes as wifiRoutes } from "./wifi";

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const isIp = (v: unknown): v is string => typeof v === "string" && (IPV4.test(v) || (v.includes(":") && /^[0-9a-fA-F:.]+$/.test(v)));
const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const bad = (error: string): never => {
  throw new FakeAnswer(fail(400, error));
};

const SETTINGS_KEYS = new Set(["dns", "ipv6", "dhcp", "ipv6_upstream", "lease", "pppoe", "vlan", "connection", "nat_port_randomization", "upnp", "sqm", "band_steering", "timezone"]);

/** Applies one JSON settings write to a copy of the network, then swaps it in, so a 400 changes nothing. */
function applySettings(net: FakeNetwork, body: Record<string, unknown>): Record<string, unknown> {
  const keys = Object.keys(body);
  if (keys.length === 0 || keys.some((k) => !SETTINGS_KEYS.has(k))) bad("error.settings.invalid");
  const n = structuredClone(net.network);
  const routed = n.connection?.mode === "nat" || n.connection?.mode === undefined;

  if ("dns" in body) {
    const dns = obj(body.dns) ?? bad("error.dns.invalid");
    if (dns.mode !== "automatic" && dns.mode !== "custom") bad("error.dns.mode.invalid");
    const ips = obj(dns.custom)?.ips ?? [];
    if (!Array.isArray(ips) || ips.length > 4 || !ips.every(isIp)) bad("error.dns.custom.invalid");
    if (dns.mode === "custom" && (ips as string[]).length === 0) bad("error.dns.custom.required");
    if (dns.caching !== undefined && !isBool(dns.caching)) bad("error.dns.caching.invalid");
    n.dns = { ...n.dns, mode: dns.mode as string, custom: { ips: ips as string[] }, ...(isBool(dns.caching) ? { caching: dns.caching } : {}) };
  }
  if ("ipv6" in body) {
    const ns = obj(obj(body.ipv6)?.name_servers) ?? bad("error.ipv6.invalid");
    const custom = ns.custom ?? [];
    if ((ns.mode !== "automatic" && ns.mode !== "custom") || !Array.isArray(custom) || !custom.every(isIp)) bad("error.ipv6.name_servers.invalid");
    n.ipv6 = { name_servers: { mode: ns.mode as string, custom: custom as string[] } };
  }
  if ("dhcp" in body) {
    if (!routed) bad("error.network.bridged");
    const dhcp = obj(body.dhcp) ?? bad("error.dhcp.invalid");
    if (dhcp.mode === "automatic") n.dhcp = { mode: "automatic" };
    else if (dhcp.mode === "custom") {
      const c = obj(dhcp.custom) ?? bad("error.dhcp.custom.required");
      const fields = ["subnet_ip", "subnet_mask", "start_ip", "end_ip"] as const;
      if (!fields.every((f) => typeof c[f] === "string" && IPV4.test(c[f] as string))) bad("error.dhcp.custom.invalid");
      n.dhcp = { mode: "custom", custom: { subnet_ip: c.subnet_ip as string, subnet_mask: c.subnet_mask as string, start_ip: c.start_ip as string, end_ip: c.end_ip as string } };
    } else bad("error.dhcp.mode.invalid");
  }
  if ("ipv6_upstream" in body) {
    if (!isBool(body.ipv6_upstream)) bad("error.ipv6_upstream.invalid");
    n.ipv6_upstream = body.ipv6_upstream as boolean;
  }
  if ("lease" in body) {
    const lease = obj(body.lease) ?? bad("error.lease.invalid");
    if (lease.mode === "static") {
      const st = obj(lease.static) ?? bad("error.lease.static.required");
      if (![st.ip, st.mask, st.router].every((v) => typeof v === "string" && IPV4.test(v))) bad("error.lease.static.invalid");
      n.lease = { ...n.lease, mode: "static", static: { ip: st.ip, mask: st.mask, router: st.router } };
      n.wan_type = "Static";
    } else if (lease.mode === "dhcp") {
      n.lease = { ...n.lease, mode: "dhcp", static: null };
      n.wan_type = "DHCP";
    } else bad("error.lease.mode.invalid");
  }
  if ("pppoe" in body) {
    const pppoe = obj(body.pppoe) ?? bad("error.pppoe.invalid");
    if (!isBool(pppoe.enabled)) bad("error.pppoe.invalid");
    if (pppoe.enabled) {
      const cred = obj(pppoe.credentials) ?? bad("error.pppoe.credentials.required");
      if (typeof cred.username !== "string" || cred.username === "" || typeof cred.password !== "string" || cred.password === "") bad("error.pppoe.credentials.invalid");
      n.pppoe_enabled = true;
      n.pppoe_username = cred.username as string;
      n.wan_type = "PPPoE";
    } else {
      n.pppoe_enabled = false;
      n.pppoe_username = null;
    }
  }
  if ("vlan" in body) {
    const v = body.vlan;
    if (v === "" || v === null) n.vlan = null;
    else if (typeof v === "string" && /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 4094) n.vlan = Number(v);
    else bad("error.vlan.invalid");
  }
  if ("connection" in body) {
    const mode = obj(body.connection)?.mode;
    if (mode !== "nat" && mode !== "bridged" && mode !== "ipPassthrough") bad("error.connection.mode.invalid");
    n.connection = { mode: mode as string };
  }
  for (const key of ["nat_port_randomization", "upnp", "sqm"] as const) {
    if (!(key in body)) continue;
    if (!isBool(body[key])) bad(`error.${key}.invalid`);
    if (key !== "sqm" && !routed) bad("error.network.bridged");
    n[key] = body[key] as boolean;
  }
  if ("band_steering" in body) {
    if (!isBool(body.band_steering)) bad("error.band_steering.invalid");
    n.band_steering = body.band_steering as boolean;
  }
  if ("timezone" in body) {
    const tz = obj(body.timezone)?.value;
    if (typeof tz !== "string" || !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(tz)) bad("error.timezone.invalid");
    n.timezone = { ...(obj(n.timezone) ?? {}), value: tz as string };
  }
  net.network = n;
  return body;
}

/** A JSON body for one of the network's own endpoints, or 400. */
function jsonBody(ctx: RouteContext): Record<string, unknown> {
  if (ctx.req.encoding !== "json") bad("error.encoding");
  return ctx.req.body;
}

const DAYS = new Set(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]);
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** A power saving schedule body (`{name, days, start_time, end_time, enabled}`), or 400. */
function scheduleOf(body: Record<string, unknown>): { name: string; days: string[]; start_time: string; end_time: string; enabled: boolean } {
  const { name, days, start_time, end_time, enabled } = body;
  if (typeof name !== "string" || name.trim() === "") bad("error.schedule.name.invalid");
  if (!Array.isArray(days) || days.length === 0 || !days.every((d) => typeof d === "string" && DAYS.has(d))) bad("error.schedule.days.invalid");
  if (typeof start_time !== "string" || !HHMM.test(start_time) || typeof end_time !== "string" || !HHMM.test(end_time)) bad("error.schedule.time.invalid");
  if (enabled !== undefined && !isBool(enabled)) bad("error.schedule.enabled.invalid");
  return { name: name as string, days: days as string[], start_time: start_time as string, end_time: end_time as string, enabled: enabled !== false };
}

const AUTO_SETUP_MODES = new Set(["DEFAULT", "ZTS", "LTS", "OFF"]);

const renameRoute = wifiRoutes.find((r) => r.method === "PUT" && r.path === "/networks/:net/settings");

let threadSeq = 0;

export const routes: Route[] = [
  {
    method: "PUT",
    path: "/networks/:net/fast_transition",
    handle: (ctx) => {
      const v = jsonBody(ctx).fast_transition;
      if (!isBool(v)) bad("error.fast_transition.invalid");
      ctx.network(ctx.params.net ?? "").fastTransition = { fast_transition: v as boolean };
      return ok({ fast_transition: v });
    },
  },
  {
    method: "PUT",
    path: "/networks/:net/mlo_mode",
    handle: (ctx) => {
      const v = jsonBody(ctx).mlo_mode;
      const net = ctx.network(ctx.params.net ?? "");
      if (net.network.mlo_mode === undefined) bad("error.mlo_mode.unsupported");
      if (v !== "disabled" && v !== "single" && v !== "multi") bad("error.mlo_mode.invalid");
      net.network.mlo_mode = v as string;
      return ok({ mlo_mode: v });
    },
  },
  {
    method: "PUT",
    path: "/networks/:net/ac_compat",
    handle: ({ req, params, network }) => {
      if (req.encoding !== "form") bad("error.encoding");
      const v = String(req.body.enabled);
      if (v !== "true" && v !== "false") bad("error.ac_compat.invalid");
      network(params.net ?? "").acCompat = { enabled: v === "true" };
      return ok({ enabled: v === "true" });
    },
  },
  {
    method: "PUT",
    path: "/networks/:net/power_saving",
    handle: (ctx) => {
      const body = jsonBody(ctx);
      const keys = Object.keys(body);
      if (keys.length === 0 || keys.some((k) => k !== "enable" && k !== "power_saving_schedule_enabled") || !keys.every((k) => isBool(body[k]))) bad("error.power_saving.invalid");
      const n = ctx.network(ctx.params.net ?? "").network;
      if (isBool(body.enable)) n.power_saving = body.enable;
      if (isBool(body.power_saving_schedule_enabled)) n.power_saving_schedule_enabled = body.power_saving_schedule_enabled;
      return ok({ power_saving: n.power_saving, power_saving_schedule_enabled: n.power_saving_schedule_enabled });
    },
  },
  {
    method: "POST",
    path: "/networks/:net/power_saving/schedules",
    handle: (ctx) => {
      const net = ctx.network(ctx.params.net ?? "");
      const s = scheduleOf(jsonBody(ctx));
      const id = Math.max(0, ...net.powerSavingSchedules.map((x) => Number(x.id) || 0)) + 1;
      const saved = { url: `${net.network.url}/power_saving/schedules/${id}`, id, ...s };
      net.powerSavingSchedules.push(saved);
      return ok(saved);
    },
  },
  {
    method: "PUT",
    path: "/networks/:net/power_saving/schedules/:id",
    handle: (ctx) => {
      const net = ctx.network(ctx.params.net ?? "");
      const i = net.powerSavingSchedules.findIndex((x) => String(x.id) === ctx.params.id);
      if (i < 0) return fail(404, "error.schedule.not_found");
      const saved = { ...net.powerSavingSchedules[i], ...scheduleOf(jsonBody(ctx)) };
      net.powerSavingSchedules[i] = saved;
      return ok(saved);
    },
  },
  {
    method: "DELETE",
    path: "/networks/:net/power_saving/schedules/:id",
    handle: ({ params, network }) => {
      const net = network(params.net ?? "");
      if (!net.powerSavingSchedules.some((x) => String(x.id) === params.id)) return fail(404, "error.schedule.not_found");
      net.powerSavingSchedules = net.powerSavingSchedules.filter((x) => String(x.id) !== params.id);
      return ok(null);
    },
  },
  {
    method: "PUT",
    path: "/networks/:net/auto_setup_mode",
    handle: (ctx) => {
      const mode = jsonBody(ctx).mode;
      if (typeof mode !== "string" || !AUTO_SETUP_MODES.has(mode)) bad("error.auto_setup_mode.invalid");
      // As eero does: DEFAULT is a request, and eero stores (and answers) LTS for it.
      const stored = mode === "DEFAULT" ? "LTS" : (mode as string);
      ctx.network(ctx.params.net ?? "").network.auto_setup_mode = stored;
      return ok({ mode: stored });
    },
  },
  {
    // Thread on or off. eero's own switch, as SX and Eeronaut send it.
    method: "PUT",
    path: "/networks/:net/thread/enable",
    handle: (ctx) => {
      const body = jsonBody(ctx);
      const net = ctx.network(ctx.params.net ?? "");
      if (!net.thread) return fail(404, "error.thread.not_found");
      if (Object.keys(body).some((k) => k !== "enabled") || !isBool(body.enabled)) bad("error.thread.invalid");
      net.thread.enabled = body.enabled as boolean;
      net.network.thread = body.enabled as boolean;
      return ok({ enabled: body.enabled });
    },
  },
  {
    // Credential sharing. Like the real API, `thread_enable` here answers 200 and changes nothing
    // (seen on a real network in the M5 review; Eeronaut found the same).
    method: "PUT",
    path: "/networks/:net/thread",
    handle: (ctx) => {
      const body = jsonBody(ctx);
      const net = ctx.network(ctx.params.net ?? "");
      if (!net.thread) return fail(404, "error.thread.not_found");
      const keys = Object.keys(body);
      if (keys.length === 0 || keys.some((k) => k !== "thread_enable" && k !== "enable_credential_syncing") || !keys.every((k) => isBool(body[k]))) bad("error.thread.invalid");
      if (isBool(body.enable_credential_syncing)) net.thread.enable_credential_syncing = body.enable_credential_syncing;
      const { master_key: _k, commissioning_credential: _c, ...shown } = net.thread;
      return ok(shown);
    },
  },
  {
    method: "POST",
    path: "/networks/:net/thread",
    handle: ({ params, network }) => {
      const net = network(params.net ?? "");
      if (!net.thread) return fail(404, "error.thread.not_found");
      const n = String(++threadSeq).padStart(4, "0");
      net.thread = { ...net.thread, master_key: `fake-thread-master-key-reset-${n}`, commissioning_credential: `fake-thread-pskc-reset-${n}`, xpan_id: `fa4e${n}fa4e${n}` };
      return ok(null);
    },
  },
  {
    method: "PUT",
    path: "/networks/:net/settings",
    handle: (ctx: RouteContext) => {
      const { req, params, network } = ctx;
      if ("name" in req.body) {
        if (!renameRoute) return fail(404, "error.not.found");
        return renameRoute.handle(ctx);
      }
      if (req.encoding !== "json") return fail(400, "error.settings.encoding");
      // The PPPoE password is write-only, as in eero: the answer never echoes it.
      const applied = applySettings(network(params.net ?? ""), req.body);
      const { pppoe: _p, ...rest } = applied;
      return ok(rest);
    },
  },
  {
    method: "GET",
    path: "/networks/:net/fast_transition",
    handle: ({ params, network }) => ok(network(params.net ?? "").fastTransition),
  },
  {
    method: "GET",
    path: "/networks/:net/power_saving/schedules",
    handle: ({ params, network }) => ok({ schedules: network(params.net ?? "").powerSavingSchedules }),
  },
  {
    method: "GET",
    path: "/networks/:net/power_saving",
    handle: () => fail(404, "error.not_found"),
  },
  {
    method: "GET",
    path: "/networks/:net/thread",
    handle: ({ params, network }) => {
      const thread = network(params.net ?? "").thread;
      return thread ? ok(thread) : fail(404, "error.thread.not_found");
    },
  },
  {
    method: "GET",
    path: "/networks/:net/ac_compat",
    handle: ({ params, network }) => ok(network(params.net ?? "").acCompat),
  },
  {
    method: "GET",
    path: "/networks/:net/proxied_nodes",
    handle: () => fail(404, "error.not_found"),
  },
];
