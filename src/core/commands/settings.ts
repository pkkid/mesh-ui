/**
 * Network settings commands: `settings.get`, every network-wide setting the
 * Advanced networking page shows, with Thread but never its secrets, and
 * `settings.impact`, what a change restarts and who drops, from IMPACT (the
 * one table of restart estimates every confirm, panel and result quotes).
 *
 * Internet-side writes (M5.2): DNS, DHCP, IPv6, WAN, connection mode, NAT
 * port mode, UPnP and SQM. Each reads the settings first: a change that
 * changes nothing is not sent (eero restarts the mesh on most `PUT
 * {net}/settings`), and NAT-only settings are bad_params in bridge mode.
 * Every disruptive one confirms with its `settings.impact` summary. The
 * address rules (`ipv4`, `dhcpProblem`, `wanStaticProblem`) are exported so
 * the page's sheets show the same messages before saving.
 * Wireless, mesh and Thread writes (M5.3): client steering, fast roaming,
 * MLO, legacy mode, power saving and its schedules, time zone, Simple Setup
 * and Thread, with `settings.thread.credentials` (sensitive, never cached)
 * and `settings.thread.reset` (destructive). See
 * docs/architecture/commands.md#settings-commandssettingsts and
 * #restart-estimates, and docs/ux/pages/advanced-networking.md.
 */

import { z } from "zod";
import { CommandError } from "../errors";
import type { DhcpInput, DnsInput, PowerSavingInput, ThreadInput, WanInput } from "../backend";
import type * as M from "../model";
import { type AnyCommand, type CommandContext, defineCommand, ref } from "../spec";
import { RESTART_ESTIMATE } from "./network";

/** Drops anything secret-looking a backend might add to Thread, so the result is safe to cache, log and show. */
function withoutSecrets(s: M.NetworkSettings): M.NetworkSettings {
  if (!s.thread) return s;
  const { enabled, credentialSync, name, channel, panId, xpanId, borderAgent, devices } = s.thread;
  return { ...s, thread: { enabled, credentialSync, name, channel, panId, xpanId, borderAgent, devices } };
}

// ---------------------------------------------------------------------------
// Impact

/** eero rebuilds the mesh after a `PUT {net}/settings` that touches routing (FF field report). */
export const SETTINGS_RESTART_ESTIMATE = "about 8 minutes";
/** A firmware install restarts every eero once it has the image (eero app copy). */
export const UPDATE_RESTART_ESTIMATE = "about 10 minutes";

type ImpactRule = {
  restarts: boolean;
  estimate: string | null;
  /** Upper bound in minutes, to pick the longest of several changes. */
  minutes: number;
  drops: M.ImpactDrops;
  /** What happens, without the device count (added in core). */
  what: string;
};

const restart = (what: string, estimate: string, minutes: number): ImpactRule => ({ restarts: true, estimate, minutes, drops: "all", what });
const quiet = (what: string, drops: M.ImpactDrops = "none"): ImpactRule => ({ restarts: false, estimate: null, minutes: 0, drops, what });

/**
 * Every write whose impact `settings.impact` can tell, by command id
 * (docs/architecture/commands.md#restart-estimates). Wave 2 stories add a row
 * when they add a write; a disruptive write with no row is a test failure.
 */
export const IMPACT: Readonly<Record<string, ImpactRule>> = {
  "settings.dns.set": restart("Every eero restarts to apply the new DNS", SETTINGS_RESTART_ESTIMATE, 8),
  "settings.dhcp.set": restart("Every eero restarts to apply the new DHCP range, and devices get new addresses", SETTINGS_RESTART_ESTIMATE, 8),
  "settings.ipv6.set": restart("Every eero restarts to apply the IPv6 change", SETTINGS_RESTART_ESTIMATE, 8),
  "settings.wan.set": restart("Every eero restarts to reconnect to your ISP; wrong values keep the network offline", SETTINGS_RESTART_ESTIMATE, 8),
  "settings.connection_mode.set": restart("Every eero restarts in the new connection mode", SETTINGS_RESTART_ESTIMATE, 8),
  "settings.nat_randomization.set": restart("Every eero restarts to apply the NAT port mode", SETTINGS_RESTART_ESTIMATE, 8),
  "settings.mlo.set": restart("Every eero restarts to apply multi-link operation", RESTART_ESTIMATE.network, 3),
  "settings.legacy_mode.set": restart("Every eero restarts to apply legacy device mode", RESTART_ESTIMATE.network, 3),
  "wifi.security.set": restart("Every eero restarts to apply the new Wi-Fi security", RESTART_ESTIMATE.network, 3),
  "network.restart": restart("Every eero restarts", RESTART_ESTIMATE.network, 3),
  "updates.install": restart("Every eero installs the update and restarts", UPDATE_RESTART_ESTIMATE, 10),
  "wifi.name.set": quiet("Wireless devices drop and must rejoin with the new name", "wireless"),
  "wifi.password.set": quiet("Wireless devices drop and must rejoin with the new password", "wireless"),
  "settings.thread.reset": quiet("Every Thread accessory must be paired again", "thread"),
  "settings.thread.set": quiet("Thread accessories lose their border router while Thread is off", "thread"),
  "eero.port.action": quiet("The device on that port loses its connection or power", "port"),
  "settings.upnp.set": quiet("Nothing restarts"),
  "settings.sqm.set": quiet("Nothing restarts"),
  "settings.band_steering.set": quiet("Nothing restarts; some devices may roam to another band"),
  "settings.fast_transition.set": quiet("Nothing restarts"),
  "settings.power_saving.set": quiet("Nothing restarts"),
  "settings.timezone.set": quiet("Nothing restarts; schedules follow the new time zone"),
  "settings.simple_setup.set": quiet("Nothing restarts"),
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const isWireless = (d: M.Device) => d.band !== null && d.band !== "wired";

/** Pure: the impact of `ids` on a network whose devices are `devices`. Unknown ids are bad_params. */
export function settingsImpact(ids: string[], devices: M.Device[]): M.SettingsImpact {
  const online = devices.filter((d) => d.connected && !d.blocked);
  const changes = ids.map((id): M.ChangeImpact => {
    const rule = IMPACT[id];
    if (!rule) throw new CommandError("bad_params", `No impact is known for "${id}".`);
    const drop = rule.drops === "all" ? online : rule.drops === "wireless" ? online.filter((d) => isWireless(d) && d.ssid !== "guest") : [];
    const who =
      rule.drops === "all"
        ? `${plural(drop.length, "device")} online ${drop.length === 1 ? "loses" : "lose"} internet`
        : rule.drops === "wireless"
          ? `${plural(drop.length, "wireless device")} ${drop.length === 1 ? "drops" : "drop"}`
          : null;
    const summary = rule.restarts ? `${rule.what}: ${who} for ${rule.estimate}.` : `${rule.what}.`;
    return { id, restarts: rule.restarts, estimate: rule.estimate, drops: rule.drops, deviceIds: drop.map((d) => d.id), summary };
  });
  const longest = ids.map((id) => IMPACT[id]!).filter((r) => r.restarts).sort((a, b) => b.minutes - a.minutes)[0];
  return {
    changes,
    restarts: changes.some((c) => c.restarts),
    estimate: longest?.estimate ?? null,
    devicesOnline: online.length,
    deviceIds: [...new Set(changes.flatMap((c) => c.deviceIds))],
    summary: changes.map((c) => c.summary).join(" "),
  };
}

/** The impact of one write on the network in `ctx`, for its `needs_confirm` message. */
export async function impactOf(ctx: CommandContext, id: string): Promise<M.SettingsImpact> {
  return settingsImpact([id], await ctx.backend.device.list(ctx.net));
}

// ---------------------------------------------------------------------------
// Addresses: the rules the writes and the page's sheets share

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/** A dotted IPv4 address ("192.168.4.1"), no leading zeros. */
export const isIpv4 = (s: string): boolean => IPV4.test(s);

/** An IPv6 address in any standard form ("2001:db8::1", "::1", "::ffff:192.0.2.1"). No zone or prefix. */
export function isIpv6(s: string): boolean {
  if (!s.includes(":") || /[^0-9a-fA-F:.]/.test(s)) return false;
  const halves = s.split("::");
  if (halves.length > 2) return false;
  const groups = (part: string) => (part === "" ? [] : part.split(":"));
  const parts = halves.flatMap(groups);
  const last = parts.at(-1);
  let count = parts.length;
  if (last?.includes(".")) {
    if (!isIpv4(last)) return false;
    parts.pop();
    count += 1;
  }
  if (!parts.every((g) => /^[0-9a-fA-F]{1,4}$/.test(g))) return false;
  return halves.length === 2 ? count <= 7 : count === 8;
}

const ipNumber = (s: string) => s.split(".").reduce((n, o) => n * 256 + Number(o), 0);
const ipString = (n: number) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");

/** Prefix length of a contiguous IPv4 mask ("255.255.252.0" is 22), else null. */
export function maskPrefix(mask: string): number | null {
  if (!isIpv4(mask)) return null;
  const n = ipNumber(mask);
  const bits = 32 - Math.log2(0x1_0000_0000 - n);
  return Number.isInteger(bits) && bits >= 0 && bits <= 32 ? bits : null;
}

/** The private ranges (RFC 1918) a LAN may use. */
const PRIVATE: ReadonlyArray<[string, number]> = [
  ["10.0.0.0", 8],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
];

const inBlock = (ip: number, base: number, bits: number) => bits === 0 || Math.floor(ip / 2 ** (32 - bits)) === Math.floor(base / 2 ** (32 - bits));

/**
 * Why a custom DHCP range is wrong, keyed by field, or null when it is fine.
 * The subnet is a private network address with a /16 to /29 mask; eero's
 * router takes the first address; the pool sits after it, before the
 * broadcast address, start not after end.
 */
export function dhcpProblem(d: { subnetIp: string; subnetMask: string; startIp: string; endIp: string }): { field: "subnetIp" | "subnetMask" | "startIp" | "endIp"; message: string } | null {
  for (const field of ["subnetIp", "subnetMask", "startIp", "endIp"] as const) {
    if (!isIpv4(d[field])) return { field, message: "Enter an IPv4 address like 192.168.4.1." };
  }
  const bits = maskPrefix(d.subnetMask);
  if (bits === null) return { field: "subnetMask", message: "Not a subnet mask (like 255.255.255.0)." };
  if (bits < 16 || bits > 29) return { field: "subnetMask", message: "Use a mask from 255.255.0.0 (/16) to 255.255.255.248 (/29)." };
  const net = ipNumber(d.subnetIp);
  const size = 2 ** (32 - bits);
  if (net % size !== 0) return { field: "subnetIp", message: `Not the start of a /${bits} network: try ${ipString(net - (net % size))}.` };
  if (!PRIVATE.some(([base, b]) => bits >= b && inBlock(net, ipNumber(base), b))) {
    return { field: "subnetIp", message: "Use a private range: 10.x.x.x, 172.16.x.x to 172.31.x.x, or 192.168.x.x." };
  }
  const start = ipNumber(d.startIp);
  const end = ipNumber(d.endIp);
  const gateway = net + 1;
  const broadcast = net + size - 1;
  if (start <= gateway || start >= broadcast) return { field: "startIp", message: `Pick an address from ${ipString(gateway + 1)} to ${ipString(broadcast - 1)} (${ipString(gateway)} is the eero).` };
  if (end <= gateway || end >= broadcast) return { field: "endIp", message: `Pick an address from ${ipString(gateway + 1)} to ${ipString(broadcast - 1)}.` };
  if (end < start) return { field: "endIp", message: "The ending IP must not come before the starting IP." };
  return null;
}

/** Why a static WAN address is wrong, keyed by field, or null when it is fine. */
export function wanStaticProblem(s: { ip: string; mask: string; router: string }): { field: "ip" | "mask" | "router"; message: string } | null {
  for (const field of ["ip", "mask", "router"] as const) {
    if (!isIpv4(s[field])) return { field, message: "Enter an IPv4 address like 203.0.113.9." };
  }
  const bits = maskPrefix(s.mask);
  if (bits === null || bits < 8 || bits > 30) return { field: "mask", message: "Not a subnet mask (like 255.255.255.0)." };
  const size = 2 ** (32 - bits);
  const ip = ipNumber(s.ip);
  const router = ipNumber(s.router);
  const same = (n: number) => Math.floor(n / size) === Math.floor(ip / size);
  const host = (n: number) => n % size !== 0 && n % size !== size - 1;
  if (!host(ip)) return { field: "ip", message: "That is the network or broadcast address of this subnet." };
  if (!same(router)) return { field: "router", message: "The router must be in the same subnet as the IP address." };
  if (!host(router)) return { field: "router", message: "That is the network or broadcast address of this subnet." };
  if (ip === router) return { field: "router", message: "The router and the IP address must differ." };
  return null;
}

/** A zod issue on `path` for a problem found by one of the checks above. */
const issue = (ctx: z.RefinementCtx, path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });

// ---------------------------------------------------------------------------
// Write helpers

/** NAT-only settings do nothing when another router hands out addresses. */
async function routedSettings(ctx: CommandContext, what: string): Promise<M.NetworkSettings> {
  const s = await ctx.backend.settings.get(ctx.net);
  if (s.connectionMode === "bridged" || s.connectionMode === "ipPassthrough") {
    throw new CommandError("bad_params", `${what} is off in ${s.connectionMode === "bridged" ? "bridge" : "IP passthrough"} mode: another router handles it.`);
  }
  return s;
}

/** A setting eero does not report here can not be written either. */
function reported<T>(value: T | null, what: string): T {
  if (value === null) throw new CommandError("bad_params", `${what} is not available on this network.`);
  return value;
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x.toLowerCase() === b[i]?.toLowerCase());

/** The DNS the write sends: the current settings with the params on top. */
function dnsTarget(s: M.NetworkSettings, p: { mode?: DnsInput["mode"]; servers?: string[]; ipv6Servers?: string[]; caching?: boolean }): DnsInput {
  const mode = p.mode ?? s.dns.mode;
  const servers = mode === "custom" ? (p.servers ?? s.dns.servers) : [];
  const ipv6Servers = mode === "custom" ? (p.ipv6Servers ?? s.dns.ipv6Servers) : [];
  if (mode === "custom" && servers.length === 0) throw new CommandError("bad_params", "Custom DNS needs at least one server.");
  return { mode, servers, ipv6Servers, caching: p.caching ?? s.dns.caching };
}

const dhcpUnchanged = (s: M.NetworkSettings, p: { mode: "automatic" | "custom"; subnetIp?: string; subnetMask?: string; startIp?: string; endIp?: string }) =>
  s.dhcp.mode === p.mode &&
  (p.mode === "automatic" || (s.dhcp.subnetIp === p.subnetIp && s.dhcp.subnetMask === p.subnetMask && s.dhcp.startIp === p.startIp && s.dhcp.endIp === p.endIp));

function wanTarget(s: M.NetworkSettings, p: { mode: WanInput["mode"]; static?: { ip: string; mask: string; router: string }; pppoe?: { username: string; password: string }; vlan?: number | null }): WanInput {
  return {
    mode: p.mode,
    static: p.mode === "static" && p.static ? p.static : null,
    pppoe: p.mode === "pppoe" && p.pppoe ? p.pppoe : null,
    vlan: p.vlan === undefined ? s.wan.vlan : p.vlan,
  };
}

/** PPPoE always sends: the password is write-only, so core cannot tell whether it changed. */
const wanUnchanged = (s: M.NetworkSettings, t: WanInput) =>
  t.mode !== "pppoe" &&
  s.wan.mode === t.mode &&
  s.wan.vlan === t.vlan &&
  (t.mode === "dhcp" || (s.wan.static?.ip === t.static?.ip && s.wan.static?.mask === t.static?.mask && s.wan.static?.router === t.static?.router));

const dnsUnchanged = (s: M.NetworkSettings, t: DnsInput) =>
  s.dns.mode === t.mode && sameList(s.dns.servers, t.servers) && sameList(s.dns.ipv6Servers, t.ipv6Servers) && s.dns.caching === t.caching;

/** What bridge or IP passthrough turns off, for the connection mode confirm. */
export const BRIDGE_OFF_FEATURES = "eero stops handing out addresses, and profiles, pausing, reservations, port forwards, UPnP, SQM and custom DNS stop working";

const ipList = (what: string, max: number, v6Only = false) =>
  z
    .array(
      z
        .string()
        .trim()
        .refine((s) => (v6Only ? isIpv6(s) : isIpv4(s) || isIpv6(s)), v6Only ? "Not an IPv6 address." : "Not an IPv4 or IPv6 address."),
    )
    .max(max, `${max} ${what} at most.`);

const dnsParams = z.object({
  mode: z.enum(["automatic", "custom"]).optional().describe("automatic uses the ISP's DNS; custom uses `servers`. Default: the current mode."),
  servers: ipList("servers", 4).optional().describe("Custom name servers, IPv4 or IPv6, 1 to 4. Default: the current ones."),
  ipv6Servers: ipList("IPv6 servers", 2, true).optional().describe("Custom IPv6 name servers, 0 to 2. Default: the current ones."),
  caching: z.boolean().optional().describe("Local DNS caching on the eeros. Default: unchanged."),
});

const dhcpParams = z
  .object({
    mode: z.enum(["automatic", "custom"]).describe("automatic: eero's default range. custom: the subnet and pool below."),
    subnetIp: z.string().trim().optional().describe("custom: network address of the LAN, a private range (192.168.4.0)."),
    subnetMask: z.string().trim().optional().describe("custom: subnet mask, /16 to /29 (255.255.252.0)."),
    startIp: z.string().trim().optional().describe("custom: first address eero hands out."),
    endIp: z.string().trim().optional().describe("custom: last address eero hands out."),
  })
  .superRefine((p, ctx) => {
    const fields = ["subnetIp", "subnetMask", "startIp", "endIp"] as const;
    if (p.mode === "automatic") {
      for (const f of fields) if (p[f] !== undefined) issue(ctx, [f], "Only a custom range takes addresses.");
      return;
    }
    const missing = fields.filter((f) => !p[f]);
    for (const f of missing) issue(ctx, [f], "Required for a custom range.");
    if (missing.length) return;
    const problem = dhcpProblem(p as Record<(typeof fields)[number], string>);
    if (problem) issue(ctx, [problem.field], problem.message);
  });

const wanParams = z
  .object({
    mode: z.enum(["dhcp", "static", "pppoe"]).describe("How the gateway eero gets its internet address."),
    static: z
      .object({ ip: z.string().trim(), mask: z.string().trim(), router: z.string().trim() })
      .strict()
      .optional()
      .describe("static only: the address, subnet mask and router your ISP gave you."),
    pppoe: z
      .object({
        username: z.string().trim().min(1, "Enter the PPPoE user name.").max(128),
        password: z.string().min(1, "Enter the PPPoE password.").max(128),
      })
      .strict()
      .optional()
      .describe("pppoe only: the user name and password from your ISP. The password is never returned or logged."),
    vlan: z
      .number()
      .int()
      .min(1, "VLAN IDs run from 1 to 4094.")
      .max(4094, "VLAN IDs run from 1 to 4094.")
      .nullable()
      .optional()
      .describe("ISP VLAN tag, 1 to 4094; null turns it off. Default: unchanged."),
  })
  .superRefine((p, ctx) => {
    if (p.mode === "static") {
      if (!p.static) return issue(ctx, ["static"], "A static IP needs the address, mask and router.");
      const problem = wanStaticProblem(p.static);
      if (problem) issue(ctx, ["static", problem.field], problem.message);
    } else if (p.static) issue(ctx, ["static"], "Only static mode takes a static address.");
    if (p.mode === "pppoe" && !p.pppoe) issue(ctx, ["pppoe"], "PPPoE needs the user name and password.");
    if (p.mode !== "pppoe" && p.pppoe) issue(ctx, ["pppoe"], "Only PPPoE mode takes PPPoE credentials.");
  });

const toggle = (what: string) => z.object({ enabled: z.boolean().describe(`true turns ${what} on, false off.`) });

/** The confirm for one disruptive settings write: its impact, or that nothing changes. */
async function confirmText(ctx: CommandContext, id: string, unchanged: boolean, lead = ""): Promise<string> {
  if (unchanged) return "Nothing changes, so nothing restarts.";
  return `${lead}${(await impactOf(ctx, id)).summary}`;
}

// ---------------------------------------------------------------------------
// Wireless, mesh and Thread helpers (M5.3)

/** A live toggle: refuse a setting eero does not report, skip an unchanged one. */
async function liveToggle(ctx: CommandContext, pick: (s: M.NetworkSettings) => boolean | null, what: string, enabled: boolean, write: () => Promise<M.NetworkSettings>): Promise<M.NetworkSettings> {
  const s = await ctx.backend.settings.get(ctx.net);
  if (reported(pick(s), what) === enabled) return withoutSecrets(s);
  return withoutSecrets(await write());
}

/** Thread, or bad_params on a network without it. */
function withThread(s: M.NetworkSettings): NonNullable<M.NetworkSettings["thread"]> {
  if (!s.thread) throw new CommandError("bad_params", "This network has no Thread border router.");
  return s.thread;
}

/** An IANA time zone this runtime knows ("America/New_York", "UTC"). */
export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(tz);
  } catch {
    return false;
  }
}

const DAY_ORDER: M.Day[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const hhmmParam = z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour HH:MM, 00:00 to 23:59.");
/** The same schedule rules as profile.schedule.* (commands/profile.ts). */
const scheduleFields = {
  name: z.string().trim().min(1, "Enter a name.").max(32, "Use 32 characters or fewer.").describe("Schedule name, 1 to 32 characters."),
  days: z
    .array(z.enum(DAY_ORDER))
    .min(1, "Pick at least one day.")
    .max(14)
    .transform((days) => DAY_ORDER.filter((d) => days.includes(d)))
    .describe("Days the schedule starts on, MON to SUN. Order and repeats do not matter."),
  start: hhmmParam.describe("When power saving starts, HH:MM in the network time zone."),
  end: hhmmParam.describe("When it ends, HH:MM. Before start wraps past midnight (into the next day)."),
};

const fieldError = (path: string, message: string) => new CommandError("bad_params", message, { issues: [{ path, message }] });

/** The settings, or bad_params when the network has no power saving. */
async function powerSaving(ctx: CommandContext): Promise<M.NetworkSettings> {
  const s = await ctx.backend.settings.get(ctx.net);
  if (s.powerSaving.enabled === null && s.powerSaving.scheduleEnabled === null) throw new CommandError("bad_params", "Power saving is not available on this network.");
  return s;
}

function findPowerSchedule(list: M.Schedule[], ref: string): M.Schedule {
  const r = ref.trim();
  const byId = list.find((s) => s.id === r);
  if (byId) return byId;
  const named = list.filter((s) => s.name.toLowerCase() === r.toLowerCase());
  if (named.length === 1 && named[0]) return named[0];
  if (named.length > 1) throw fieldError("schedule", `${named.length} power saving schedules are named ${r}; use the id.`);
  throw fieldError("schedule", `No power saving schedule ${r}.`);
}

/** Start and end must differ, and names are unique (a changed name only). */
function checkPowerSchedule(list: M.Schedule[], input: M.ScheduleInput, self: M.Schedule | null): void {
  if (input.start === input.end) throw fieldError("end", "End must differ from start.");
  if (self && self.name.toLowerCase() === input.name.toLowerCase()) return;
  if (list.some((s) => s.id !== self?.id && s.name.toLowerCase() === input.name.toLowerCase())) throw fieldError("name", `A power saving schedule is already named ${input.name}.`);
}

export const commands: AnyCommand[] = [
  defineCommand({
    id: "settings.get",
    label: "Network settings",
    description:
      "Every network-wide setting: DNS, DHCP and NAT, IPv6, ISP (WAN) settings, connection mode, UPnP, SQM, client steering, fast roaming, multi-link operation, power saving with its schedules, legacy device mode, eero Simple Setup and Thread. Thread secrets (network key, PSKc) are never included. null means eero did not report the setting for this network.",
    icon: "sliders-horizontal",
    params: z.object({}),
    effect: "query",
    topic: "settings",
    run: async (ctx): Promise<M.NetworkSettings> => withoutSecrets(await ctx.backend.settings.get(ctx.net)),
  }),
  defineCommand({
    id: "settings.impact",
    label: "Impact of a settings change",
    description:
      "What one or more changes do before they are confirmed: whether every eero restarts, the outage estimate, and the online devices that drop. `summary` is each disruptive write's confirm message. Changes are command ids (`settings.dns.set`); params are accepted for later use and do not change the estimate yet.",
    icon: "triangle-alert",
    params: z.object({
      changes: z
        .array(z.object({ id: z.string().trim().min(1), params: z.record(z.string(), z.unknown()).optional() }).strict())
        .min(1)
        .max(20)
        .describe("The writes to estimate, by command id."),
    }),
    effect: "query",
    topic: "settings",
    // Device counts change by the minute; a stale estimate is still the right copy, but keep it short.
    ttl: 30,
    run: async (ctx, p): Promise<M.SettingsImpact> => settingsImpact(p.changes.map((c) => c.id), await ctx.backend.device.list(ctx.net)),
  }),

  // --- Internet-side writes (M5.2) ------------------------------------------
  defineCommand({
    id: "settings.dns.set",
    label: "Change DNS",
    description:
      "Sets the network's DNS: the ISP's servers (automatic) or custom ones, optional IPv6 servers, and local DNS caching. Omitted fields keep their current value. eero restarts every eero to apply it, about 8 minutes offline.",
    icon: "server",
    params: dnsParams,
    effect: "disruptive",
    gate: { area: "settings", bridgeOff: true },
    invalidates: ["settings", "network"],
    confirmMessage: async (ctx, p) => {
      const s = await routedSettings(ctx, "DNS");
      return confirmText(ctx, "settings.dns.set", dnsUnchanged(s, dnsTarget(s, p)));
    },
    run: async (ctx, p): Promise<M.NetworkSettings> => {
      const s = await routedSettings(ctx, "DNS");
      const target = dnsTarget(s, p);
      if (dnsUnchanged(s, target)) return withoutSecrets(s);
      return withoutSecrets(await ctx.backend.settings.setDns(ctx.net, target));
    },
  }),
  defineCommand({
    id: "settings.dhcp.set",
    label: "Change DHCP range",
    description:
      "Sets who hands out addresses on the LAN: eero's automatic range, or a custom private subnet and pool. eero restarts every eero to apply it, about 8 minutes offline, and devices get new addresses. Use settings.connection_mode.set for bridge mode.",
    icon: "network",
    params: dhcpParams,
    effect: "disruptive",
    gate: { area: "settings", bridgeOff: true },
    invalidates: ["settings", "network", "routing", "devices"],
    confirmMessage: async (ctx, p) => {
      const s = await routedSettings(ctx, "DHCP");
      return confirmText(ctx, "settings.dhcp.set", dhcpUnchanged(s, p));
    },
    run: async (ctx, p): Promise<M.NetworkSettings> => {
      const s = await routedSettings(ctx, "DHCP");
      if (dhcpUnchanged(s, p)) return withoutSecrets(s);
      const input: DhcpInput =
        p.mode === "custom"
          ? { mode: "custom", subnetIp: p.subnetIp ?? null, subnetMask: p.subnetMask ?? null, startIp: p.startIp ?? null, endIp: p.endIp ?? null }
          : { mode: "automatic", subnetIp: null, subnetMask: null, startIp: null, endIp: null };
      return withoutSecrets(await ctx.backend.settings.setDhcp(ctx.net, input));
    },
  }),
  defineCommand({
    id: "settings.ipv6.set",
    label: "Turn IPv6 on or off",
    description: "Turns IPv6 from the ISP on or off for the whole network. eero restarts every eero to apply it, about 8 minutes offline.",
    icon: "globe",
    params: toggle("IPv6"),
    effect: "disruptive",
    gate: { area: "settings", bridgeOff: true },
    invalidates: ["settings", "network"],
    confirmMessage: async (ctx, p) => confirmText(ctx, "settings.ipv6.set", (await routedSettings(ctx, "IPv6")).ipv6.enabled === p.enabled, p.enabled ? "IPv6 turns on. " : "IPv6 turns off. "),
    run: async (ctx, p): Promise<M.NetworkSettings> => {
      const s = await routedSettings(ctx, "IPv6");
      if (s.ipv6.enabled === p.enabled) return withoutSecrets(s);
      return withoutSecrets(await ctx.backend.settings.setIpv6(ctx.net, p.enabled));
    },
  }),
  defineCommand({
    id: "settings.wan.set",
    label: "Change ISP settings",
    description:
      "Sets how the gateway eero connects to the ISP: DHCP, a static IP (address, mask, router) or PPPoE (user name and password), and the ISP VLAN tag. Only change these when the ISP asks: wrong values keep the network offline. eero restarts every eero, about 8 minutes. The PPPoE password is never returned or logged.",
    icon: "cable",
    params: wanParams,
    effect: "disruptive",
    gate: { area: "settings", bridgeOff: true },
    invalidates: ["settings", "network"],
    confirmMessage: async (ctx, p) => {
      const s = await routedSettings(ctx, "ISP settings");
      return confirmText(ctx, "settings.wan.set", wanUnchanged(s, wanTarget(s, p)));
    },
    run: async (ctx, p): Promise<M.NetworkSettings> => {
      const s = await routedSettings(ctx, "ISP settings");
      const input = wanTarget(s, p);
      if (wanUnchanged(s, input)) return withoutSecrets(s);
      return withoutSecrets(await ctx.backend.settings.setWan(ctx.net, input));
    },
  }),
  defineCommand({
    id: "settings.connection_mode.set",
    label: "Change connection mode",
    description: `Sets how eero routes: nat (eero is the router), bridged (another router handles addressing) or ipPassthrough. In bridge or IP passthrough mode ${BRIDGE_OFF_FEATURES}. eero restarts every eero, about 8 minutes offline.`,
    icon: "router",
    params: z.object({ mode: z.enum(["nat", "bridged", "ipPassthrough"]).describe("nat, bridged or ipPassthrough.") }),
    effect: "disruptive",
    gate: { area: "settings" },
    invalidates: ["settings", "network", "routing", "devices", "profiles", "integrations"],
    confirmMessage: async (ctx, p) => {
      const s = await ctx.backend.settings.get(ctx.net);
      const lead = p.mode === "nat" ? "eero becomes the router again. " : `In ${p.mode === "bridged" ? "bridge" : "IP passthrough"} mode ${BRIDGE_OFF_FEATURES}. `;
      return confirmText(ctx, "settings.connection_mode.set", s.connectionMode === p.mode, lead);
    },
    run: async (ctx, p): Promise<M.NetworkSettings> => {
      const s = await ctx.backend.settings.get(ctx.net);
      if (s.connectionMode === p.mode) return withoutSecrets(s);
      return withoutSecrets(await ctx.backend.settings.setConnectionMode(ctx.net, p.mode));
    },
  }),
  defineCommand({
    id: "settings.nat_randomization.set",
    label: "Change NAT port mode",
    description: "Randomized picks unpredictable outbound ports; direct (false) suits most games. eero restarts every eero to apply it, about 8 minutes offline.",
    icon: "shuffle",
    params: z.object({ randomized: z.boolean().describe("true: randomized ports. false: direct.") }),
    effect: "disruptive",
    gate: { area: "settings", bridgeOff: true },
    invalidates: ["settings", "network"],
    confirmMessage: async (ctx, p) => {
      const s = await routedSettings(ctx, "NAT port mode");
      return confirmText(ctx, "settings.nat_randomization.set", reported(s.natRandomization, "NAT port mode") === p.randomized);
    },
    run: async (ctx, p): Promise<M.NetworkSettings> => {
      const s = await routedSettings(ctx, "NAT port mode");
      if (reported(s.natRandomization, "NAT port mode") === p.randomized) return withoutSecrets(s);
      return withoutSecrets(await ctx.backend.settings.setNatRandomization(ctx.net, p.randomized));
    },
  }),
  defineCommand({
    id: "settings.upnp.set",
    label: "Turn UPnP on or off",
    description: "UPnP lets consoles and apps open ports on their own. Applies without a restart.",
    icon: "plug",
    params: toggle("UPnP"),
    effect: "write",
    gate: { area: "settings", bridgeOff: true },
    invalidates: ["settings"],
    run: async (ctx, p): Promise<M.NetworkSettings> => {
      const s = await routedSettings(ctx, "UPnP");
      if (reported(s.upnp, "UPnP") === p.enabled) return withoutSecrets(s);
      return withoutSecrets(await ctx.backend.settings.setUpnp(ctx.net, p.enabled));
    },
  }),
  defineCommand({
    id: "settings.sqm.set",
    label: "Optimize for conferencing and gaming",
    description: "Smart queue management (SQM) keeps calls and games smooth while others download. Applies without a restart.",
    icon: "gauge",
    params: toggle("SQM"),
    effect: "write",
    gate: { area: "settings", bridgeOff: true },
    invalidates: ["settings"],
    run: async (ctx, p): Promise<M.NetworkSettings> => {
      const s = await routedSettings(ctx, "SQM");
      if (reported(s.sqm, "SQM") === p.enabled) return withoutSecrets(s);
      return withoutSecrets(await ctx.backend.settings.setSqm(ctx.net, p.enabled));
    },
  }),
  // --- Wireless, mesh and Thread writes (M5.3) -------------------------------
  defineCommand({
    id: "settings.band_steering.set",
    label: "Turn client steering on or off",
    description: "Client steering nudges devices to the best eero and band. Applies without a restart; some devices may roam.",
    icon: "waypoints",
    params: toggle("client steering"),
    effect: "write",
    gate: { area: "settings" },
    invalidates: ["settings"],
    run: (ctx, p) => liveToggle(ctx, (s) => s.bandSteering, "Client steering", p.enabled, () => ctx.backend.settings.setBandSteering(ctx.net, p.enabled)),
  }),
  defineCommand({
    id: "settings.fast_transition.set",
    label: "Turn fast roaming on or off",
    description: "Fast roaming (802.11r) lets phones and laptops hand over between eeros faster. A few older devices may not connect with it on. Applies without a restart.",
    icon: "fast-forward",
    params: toggle("fast roaming"),
    effect: "write",
    gate: { area: "settings" },
    invalidates: ["settings"],
    run: (ctx, p) => liveToggle(ctx, (s) => s.fastTransition, "Fast roaming", p.enabled, () => ctx.backend.settings.setFastTransition(ctx.net, p.enabled)),
  }),
  defineCommand({
    id: "settings.mlo.set",
    label: "Change multi-link operation",
    description: `Wi-Fi 7 multi-link operation: disabled, single or multi. Only on networks that report it. Every eero restarts, ${RESTART_ESTIMATE.network}.`,
    icon: "layers",
    params: z.object({ mode: z.enum(["disabled", "single", "multi"]).describe("disabled, single (one link) or multi (several bands at once).") }),
    effect: "disruptive",
    gate: { area: "settings" },
    invalidates: ["settings", "network", "wifi"],
    confirmMessage: async (ctx, p) => confirmText(ctx, "settings.mlo.set", reported((await ctx.backend.settings.get(ctx.net)).mlo, "Multi-link operation") === p.mode),
    run: async (ctx, p): Promise<M.NetworkSettings> => {
      const s = await ctx.backend.settings.get(ctx.net);
      if (reported(s.mlo, "Multi-link operation") === p.mode) return withoutSecrets(s);
      return withoutSecrets(await ctx.backend.settings.setMlo(ctx.net, p.mode));
    },
  }),
  defineCommand({
    id: "settings.legacy_mode.set",
    label: "Turn legacy device mode on or off",
    description: `Connects older devices that cannot detect Wi-Fi 6 (802.11ac compatibility). Every eero restarts, ${RESTART_ESTIMATE.network}.`,
    icon: "history",
    params: toggle("legacy device mode"),
    effect: "disruptive",
    gate: { area: "settings" },
    invalidates: ["settings", "network", "wifi"],
    confirmMessage: async (ctx, p) =>
      confirmText(ctx, "settings.legacy_mode.set", reported((await ctx.backend.settings.get(ctx.net)).legacyMode, "Legacy device mode") === p.enabled, p.enabled ? "Legacy device mode turns on. " : "Legacy device mode turns off. "),
    run: async (ctx, p): Promise<M.NetworkSettings> => {
      const s = await ctx.backend.settings.get(ctx.net);
      if (reported(s.legacyMode, "Legacy device mode") === p.enabled) return withoutSecrets(s);
      return withoutSecrets(await ctx.backend.settings.setLegacyMode(ctx.net, p.enabled));
    },
  }),
  defineCommand({
    id: "settings.power_saving.set",
    label: "Change power saving",
    description: "Eco efficiency (`enabled`) and the power saving schedule (`scheduleEnabled`). Omitted fields keep their value. Applies without a restart; Wi-Fi blips for a few seconds when a schedule starts.",
    icon: "leaf",
    params: z
      .object({
        enabled: z.boolean().optional().describe("Eco efficiency on or off."),
        scheduleEnabled: z.boolean().optional().describe("Run the power saving schedules."),
      })
      .refine((p) => p.enabled !== undefined || p.scheduleEnabled !== undefined, { message: "Give enabled, scheduleEnabled or both." }),
    effect: "write",
    gate: { area: "settings" },
    invalidates: ["settings"],
    run: async (ctx, p): Promise<M.NetworkSettings> => {
      const s = await ctx.backend.settings.get(ctx.net);
      const ps = s.powerSaving;
      if (p.enabled !== undefined) reported(ps.enabled, "Power saving");
      if (p.scheduleEnabled !== undefined) reported(ps.scheduleEnabled, "The power saving schedule");
      const input: PowerSavingInput = {
        ...(p.enabled !== undefined && p.enabled !== ps.enabled ? { enabled: p.enabled } : {}),
        ...(p.scheduleEnabled !== undefined && p.scheduleEnabled !== ps.scheduleEnabled ? { scheduleEnabled: p.scheduleEnabled } : {}),
      };
      if (Object.keys(input).length === 0) return withoutSecrets(s);
      return withoutSecrets(await ctx.backend.settings.setPowerSaving(ctx.net, input));
    },
  }),
  defineCommand({
    id: "settings.power_schedule.add",
    label: "Add power saving schedule",
    description: "Adds a power saving schedule: radios drop to 1x1 from start to end on the chosen days, in the network time zone. An end before the start wraps past midnight.",
    icon: "calendar-plus",
    params: z.object({ ...scheduleFields, enabled: z.boolean().optional().describe("Default true. Off keeps the schedule without running it.") }),
    effect: "write",
    gate: { area: "settings" },
    invalidates: ["settings"],
    run: async (ctx, p): Promise<M.Schedule> => {
      const s = await powerSaving(ctx);
      const input: M.ScheduleInput = { name: p.name, days: p.days, start: p.start, end: p.end, enabled: p.enabled ?? true };
      checkPowerSchedule(s.powerSaving.schedules, input, null);
      return ctx.backend.settings.addPowerSavingSchedule(ctx.net, input);
    },
  }),
  defineCommand({
    id: "settings.power_schedule.update",
    label: "Edit power saving schedule",
    description: "Changes a power saving schedule by id or name. Fields left out keep their value; enabled: false keeps it without running it.",
    icon: "calendar-clock",
    params: z.object({
      schedule: ref("schedule"),
      name: scheduleFields.name.optional(),
      days: scheduleFields.days.optional(),
      start: scheduleFields.start.optional(),
      end: scheduleFields.end.optional(),
      enabled: z.boolean().optional(),
    }),
    effect: "write",
    gate: { area: "settings" },
    invalidates: ["settings"],
    run: async (ctx, p): Promise<M.Schedule> => {
      const list = (await powerSaving(ctx)).powerSaving.schedules;
      const s = findPowerSchedule(list, p.schedule);
      const input: M.ScheduleInput = { name: p.name ?? s.name, days: p.days ?? s.days, start: p.start ?? s.start, end: p.end ?? s.end, enabled: p.enabled ?? s.enabled };
      checkPowerSchedule(list, input, s);
      return ctx.backend.settings.updatePowerSavingSchedule(ctx.net, s.id, input);
    },
  }),
  defineCommand({
    id: "settings.power_schedule.remove",
    label: "Delete power saving schedule",
    description: "Removes a power saving schedule by id or name. The result holds the removed schedule, so it can be added back.",
    icon: "calendar-x",
    params: z.object({ schedule: ref("schedule") }),
    effect: "write",
    gate: { area: "settings", op: "delete" },
    invalidates: ["settings"],
    run: async (ctx, p): Promise<{ removed: M.Id; schedule: M.Schedule }> => {
      const s = findPowerSchedule((await powerSaving(ctx)).powerSaving.schedules, p.schedule);
      await ctx.backend.settings.removePowerSavingSchedule(ctx.net, s.id);
      return { removed: s.id, schedule: s };
    },
  }),
  defineCommand({
    id: "settings.timezone.set",
    label: "Change time zone",
    description: "Sets the network time zone (IANA, like America/New_York). Schedules (pauses, power saving) and the network clock follow it. Applies without a restart.",
    icon: "clock",
    params: z.object({ timezone: z.string().trim().min(1).refine(isTimeZone, "Not a time zone. Use an IANA name like America/New_York.").describe("IANA time zone, like America/New_York.") }),
    effect: "write",
    gate: { area: "settings" },
    invalidates: ["settings", "network", "profiles"],
    run: async (ctx, p): Promise<M.NetworkSettings> => {
      const s = await ctx.backend.settings.get(ctx.net);
      if (s.timezone === p.timezone) return withoutSecrets(s);
      return withoutSecrets(await ctx.backend.settings.setTimezone(ctx.net, p.timezone));
    },
  }),
  defineCommand({
    id: "settings.simple_setup.set",
    label: "Turn eero Simple Setup on or off",
    description: "eero Simple Setup adds new eero 6 or newer units automatically when they are plugged in by Ethernet. Applies without a restart.",
    icon: "wand-sparkles",
    params: toggle("eero Simple Setup"),
    effect: "write",
    gate: { area: "settings" },
    invalidates: ["settings"],
    run: (ctx, p) => liveToggle(ctx, (s) => s.simpleSetup, "eero Simple Setup", p.enabled, () => ctx.backend.settings.setSimpleSetup(ctx.net, p.enabled)),
  }),
  defineCommand({
    id: "settings.thread.set",
    label: "Change Thread",
    description:
      "Turns the Thread border router on or off (`enabled`) and sharing Thread credentials with phone keychains (`credentialSync`). Omitted fields keep their value. Thread accessories lose their border router while Thread is off.",
    icon: "share-2",
    params: z
      .object({
        enabled: z.boolean().optional().describe("Thread border router on or off."),
        credentialSync: z.boolean().optional().describe("Share Thread credentials with iOS and Android keychains."),
      })
      .refine((p) => p.enabled !== undefined || p.credentialSync !== undefined, { message: "Give enabled, credentialSync or both." }),
    effect: "write",
    gate: { area: "settings" },
    invalidates: ["settings"],
    run: async (ctx, p): Promise<M.NetworkSettings> => {
      const s = await ctx.backend.settings.get(ctx.net);
      const t = withThread(s);
      if (p.credentialSync !== undefined) reported(t.credentialSync, "Credential sharing");
      const input: ThreadInput = {
        ...(p.enabled !== undefined && p.enabled !== t.enabled ? { enabled: p.enabled } : {}),
        ...(p.credentialSync !== undefined && p.credentialSync !== t.credentialSync ? { credentialSync: p.credentialSync } : {}),
      };
      if (Object.keys(input).length === 0) return withoutSecrets(s);
      return withoutSecrets(await ctx.backend.settings.setThread(ctx.net, input));
    },
  }),
  defineCommand({
    id: "settings.thread.credentials",
    label: "Reveal Thread credentials",
    description:
      "Sensitive: the Thread network key, PSKc and active operational dataset (null when eero does not send one), to add a Thread device by hand or copy the dataset. Never cached or logged; the CLI table masks them without --reveal.",
    icon: "key-round",
    params: z.object({}),
    effect: "query",
    sensitive: true,
    run: async (ctx): Promise<M.ThreadCredentials> => {
      const creds = await ctx.backend.settings.threadCredentials(ctx.net);
      if (!creds) throw new CommandError("bad_params", "This network has no Thread credentials.");
      return creds;
    },
  }),
  defineCommand({
    id: "settings.thread.reset",
    label: "Regenerate Thread credentials",
    description: "Makes a new Thread network key. Every Thread accessory must be paired again. Cannot be undone.",
    icon: "key-round",
    params: z.object({}),
    effect: "destructive",
    gate: { area: "settings" },
    invalidates: ["settings"],
    confirmMessage: async (ctx) => {
      const t = withThread(await ctx.backend.settings.get(ctx.net));
      return `Makes new credentials for ${t.name ?? "the Thread network"}. ${(await impactOf(ctx, "settings.thread.reset")).summary} This cannot be undone.`;
    },
    run: async (ctx): Promise<{ networkId: M.Id; reset: true }> => {
      withThread(await ctx.backend.settings.get(ctx.net));
      await ctx.backend.settings.resetThread(ctx.net);
      return { networkId: ctx.net, reset: true };
    },
  }),
];
