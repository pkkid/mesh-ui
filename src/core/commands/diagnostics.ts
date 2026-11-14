/**
 * Troubleshooting (read side): `health.check`, `support.info` and
 * `support.report`. The health check is composed here from reads the app
 * already makes (network health and its issues, internet, eeros, updates);
 * it never runs active probes or posts a cloud diagnostics run. The report
 * is plain text with MACs, IPs, names and serials cut to their last four
 * characters, so it is safe to paste into a support chat. `diagnostics.run`
 * (the symptom chips) comes later.
 * See docs/architecture/commands.md#diagnostics-commandsdiagnosticsts and
 * docs/ux/pages/troubleshooting.md.
 */

import { z } from "zod";
import { formatDuration, formatMbps, formatRelative, MISSING } from "../format";
import type * as M from "../model";
import { POLL } from "../poll";
import { type AnyCommand, type CommandContext, defineCommand } from "../spec";
import { knownDevices } from "./device";
import { withTopology } from "./eero";
import { internetVerdict, speedRating } from "./internet";
import { healthIssues } from "./network";

// ---------------------------------------------------------------------------
// Health check

/** Points a check of each status takes off 100. One warning gives 86, as in the mockup. */
export const SCORE_COST: Record<M.Check["status"], number> = { good: 0, unknown: 5, warning: 14, problem: 30 };

export function healthScore(checks: Pick<M.Check, "status">[]): number {
  return Math.max(0, 100 - checks.reduce((sum, c) => sum + SCORE_COST[c.status], 0));
}

export function overallStatus(checks: Pick<M.Check, "status">[]): M.HealthReport["overall"] {
  if (checks.some((c) => c.status === "problem")) return "problem";
  return checks.some((c) => c.status === "warning") ? "warning" : "good";
}

/** Everything the health check reads. Optional reads are null when they failed. */
export type HealthInputs = {
  health: M.NetworkHealth;
  eeros: M.Eero[];
  internet: Omit<M.Internet, "verdict"> | null;
  updates: M.Updates | null;
};

const UNREADABLE = "Not available right now";

function internetCheck(h: M.NetworkHealth, i: HealthInputs["internet"], now: number): M.Check {
  const base = { id: "internet", label: "Internet" };
  const down = h.status === "offline" || h.internet.status === "offline" || i?.status === "offline";
  const isp = i?.isp.name ?? null;
  if (down) return { ...base, status: "problem", detail: `${isp ?? "Your internet"} is down` };
  if (!i) return { ...base, status: h.internet.status === "online" ? "good" : "unknown", detail: UNREADABLE };
  const verdict = internetVerdict(i, now);
  const test = i.lastSpeedTest;
  const speeds = test ? ` · ${formatMbps(test.downMbps)} down, ${formatMbps(test.upMbps)} up` : "";
  const detail = `${isp ?? "ISP"} up${speeds}`;
  if (verdict.kind === "slow") return { ...base, status: "warning", detail: `${detail}, slower than your plan` };
  if (h.internet.status === "degraded" || i.status === "degraded") return { ...base, status: "warning", detail: `${isp ?? "Internet"} is unsteady${speeds}` };
  return { ...base, status: "good", detail };
}

function dnsCheck(h: M.NetworkHealth, i: HealthInputs["internet"]): M.Check {
  const base = { id: "dns", label: "DNS resolution" };
  if (h.status === "offline" || h.internet.status === "offline") return { ...base, status: "problem", detail: "No internet to resolve names" };
  if (!i) return { ...base, status: "unknown", detail: UNREADABLE };
  if (i.dnsMode === "custom") return { ...base, status: "good", detail: i.dnsInUse.length ? `Custom DNS · ${i.dnsInUse.length} server${i.dnsInUse.length === 1 ? "" : "s"}` : "Custom DNS" };
  return { ...base, status: "good", detail: "ISP DNS" };
}

/** A WAN port speed: "10 Gbps", "2.5 Gbps", "100 Mbps". */
const wanSpeed = (mbps: number): string => (mbps >= 1000 ? `${Number((mbps / 1000).toFixed(1))} Gbps` : formatMbps(mbps));

function eeroCheck(e: M.Eero, h: M.NetworkHealth, i: HealthInputs["internet"], now: number): M.Check {
  const status = h.eeros.find((x) => x.id === e.id)?.status ?? e.status;
  const base = { id: `eero.${e.id}`, label: e.location };
  if (h.status === "offline" || status === "offline") {
    const seen = e.lastHeartbeat ? ` · last seen ${formatRelative(e.lastHeartbeat, now)}` : "";
    return { ...base, status: "problem", detail: `Offline${seen}` };
  }
  if (status === "updating") return { ...base, status: "warning", detail: "Updating" };
  if (status === "degraded") return { ...base, status: "warning", detail: "Degraded" };
  if (e.isGateway) {
    const wan = i?.gateway?.eeroId === e.id ? i.gateway.wanPortSpeedMbps : null;
    return { ...base, status: "good", detail: wan ? `Gateway · ${wanSpeed(wan)} WAN` : "Gateway" };
  }
  return { ...base, status: status === "online" ? "good" : "unknown", detail: status === "online" ? "Online" : "Status unknown" };
}

function meshCheck(h: M.NetworkHealth, eeros: M.Eero[]): M.Check {
  const base = { id: "mesh", label: "Mesh links" };
  if (h.status === "offline" || h.mesh.status === "offline") return { ...base, status: "problem", detail: "The mesh is offline" };
  const name = (id: M.Id | null) => eeros.find((e) => e.id === id)?.location ?? null;
  const weak = h.issues.filter((x) => x.kind === "weak_link");
  const first = weak[0];
  if (first) {
    const e = h.eeros.find((x) => x.id === first.eeroId);
    const to = name(first.upstreamId);
    const bars = e?.meshBars ?? null;
    const one = `${e?.location ?? name(first.eeroId) ?? "An eero"}${bars !== null ? ` ${bars} bar${bars === 1 ? "" : "s"}` : " weak link"}${to ? ` to ${to}` : ""}`;
    return { ...base, status: "warning", detail: weak.length > 1 ? `${one}, and ${weak.length - 1} more` : one };
  }
  const wireless = eeros.filter((e) => e.backhaul === "wireless").length;
  if (eeros.length <= 1) return { ...base, status: "good", detail: "One eero, no mesh links" };
  const down = h.eeros.filter((e) => e.status === "offline").length;
  if (down) return { ...base, status: "good", detail: "No weak links among the eeros online" };
  return { ...base, status: "good", detail: wireless ? "Every link is strong" : "Every eero is wired" };
}

function firmwareCheck(u: M.Updates | null, now: number): M.Check {
  const base = { id: "firmware", label: "Firmware" };
  if (!u) return { ...base, status: "unknown", detail: UNREADABLE };
  const current = u.current ?? MISSING;
  if (u.stuckEeros.length) return { ...base, status: "warning", detail: `${current} · ${u.stuckEeros.length} eero${u.stuckEeros.length === 1 ? "" : "s"} did not finish the last update` };
  switch (u.status) {
    case "installing":
      return { ...base, status: "good", detail: `Installing ${u.target ?? "an update"}` };
    case "scheduled":
      return { ...base, status: "good", detail: `${current} · ${u.target ?? "update"} ${u.scheduledAt ? formatRelative(u.scheduledAt, now) : "scheduled"}` };
    case "available":
      return { ...base, status: u.required ? "warning" : "good", detail: `${current} · ${u.target ?? "an update"} available${u.required ? ", required" : ""}` };
    default:
      return { ...base, status: "good", detail: `${current} · up to date` };
  }
}

/** The checks in page order: internet, DNS, each eero (gateway first), mesh links, firmware. */
export function healthChecks(input: HealthInputs, now: number): M.Check[] {
  const { health, eeros, internet, updates } = input;
  const ordered = [...eeros].sort((a, b) => Number(b.isGateway) - Number(a.isGateway) || (a.hop ?? 99) - (b.hop ?? 99));
  return [
    internetCheck(health, internet, now),
    dnsCheck(health, internet),
    ...ordered.map((e) => eeroCheck(e, health, internet, now)),
    meshCheck(health, eeros),
    firmwareCheck(updates, now),
  ];
}

export function healthReport(input: HealthInputs, now: number): M.HealthReport {
  const checks = healthChecks(input, now);
  return { overall: overallStatus(checks), score: healthScore(checks), checks, at: new Date(now).toISOString() };
}

const settled = async <T>(p: Promise<T>): Promise<T | null> => p.catch(() => null);

async function readHealth(ctx: CommandContext): Promise<M.NetworkHealth> {
  const health = await ctx.backend.network.health(ctx.net);
  const needed = health.status === "offline" || health.eeros.some((e) => e.status === "offline" || e.weakLink);
  if (!needed) return { ...health, issues: [] };
  const [eeros, devices] = await Promise.all([ctx.backend.eero.list(ctx.net), ctx.backend.device.list(ctx.net)]);
  return { ...health, issues: healthIssues(health, eeros, knownDevices(devices, ctx.now())) };
}

/** Network health and eeros are required; internet and updates degrade to `unknown` checks. */
async function readInputs(ctx: CommandContext): Promise<HealthInputs> {
  const net = ctx.net;
  const [health, eeros, internet, updates, settings] = await Promise.all([
    readHealth(ctx),
    ctx.backend.eero.list(net),
    settled(ctx.backend.internet.get(net)),
    settled(ctx.backend.updates.get(net)),
    settled(ctx.settings.get()),
  ]);
  const plan = settings?.planMbps[net] ?? null;
  const test = internet?.lastSpeedTest ?? null;
  const rated = internet ? { ...internet, planMbps: plan, lastSpeedTest: test ? { ...test, rating: speedRating(test, plan) } : null } : null;
  return { health, eeros: withTopology(eeros), internet: rated, updates };
}

// ---------------------------------------------------------------------------
// Support report

/** A value cut to its last four characters ("***rage"); four or fewer characters are hidden whole. */
export function redact(value: string): string {
  const v = value.trim();
  return v.length <= 4 ? "***" : `***${v.slice(-4)}`;
}

/** A MAC to its last four hex digits ("***eeff"), whatever the separators. */
export const redactMac = (mac: string): string => redact(mac.replace(/[^0-9a-f]/gi, "").toLowerCase());

const MAC_RE = /\b[0-9a-f]{2}(?:[:-][0-9a-f]{2}){5}\b/gi;
const IS_MAC = /^[0-9a-f]{2}(?:[:-]?[0-9a-f]{2}){5}$/i;
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?\b/g;
// IPv6: eight full groups, or any form with "::" (needs a hex digit beside it, so times like 22:41:00 never match).
const IPV6_RE = /(?:\b(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}|(?:\b[0-9a-f]{1,4}:)+:(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4})*)?|::[0-9a-f]{1,4}(?::[0-9a-f]{1,4})*)(?:\/\d{1,3})?/gi;

/**
 * Scrubs a finished report: every known name, serial and address is cut to
 * its last four characters wherever it appears (longest first, so "Living
 * Room" goes before "Room"), then any MAC or IP pattern that is left.
 */
export function scrub(text: string, secrets: (string | null | undefined)[]): string {
  const known = [...new Set(secrets.map((s) => s?.trim() ?? "").filter((s) => s.length > 0))].sort((a, b) => b.length - a.length);
  // Known values become placeholders first, so the patterns below never cut an already redacted value again.
  const held: string[] = [];
  let out = text;
  for (const s of known) {
    if (!out.includes(s)) continue;
    held.push(IS_MAC.test(s) ? redactMac(s) : redact(s));
    out = out.split(s).join(`\u0000${held.length - 1}\u0000`);
  }
  out = out.replace(MAC_RE, redactMac).replace(IPV6_RE, (m) => redact(m)).replace(IPV4_RE, (m) => redact(m));
  return out.replace(/\u0000(\d+)\u0000/g, (_, i: string) => held[Number(i)] ?? "***");
}

export type ReportInputs = {
  now: number;
  app: { version: string; backend: M.BackendKind };
  supportId: string | null;
  network: M.Network | null;
  health: HealthInputs | null;
  report: M.HealthReport | null;
  devices: { online: number; total: number } | null;
  diagnostics: M.DiagnosticsResult | null;
};

const or = (v: string | number | boolean | null | undefined): string => (v === null || v === undefined || v === "" ? MISSING : String(v));
const STATUS_WORD: Record<M.Check["status"], string> = { good: "OK", warning: "WARNING", problem: "PROBLEM", unknown: "UNKNOWN" };

/** Every value the report must never show whole. */
function secretsOf(r: ReportInputs): (string | null | undefined)[] {
  const n = r.network;
  const i = r.health?.internet ?? null;
  const out: (string | null | undefined)[] = [n?.name, n?.nickname, n?.id];
  for (const e of r.health?.eeros ?? []) {
    out.push(e.location, e.serial, e.mac, e.ipv4, e.subnet, e.gatewayIp, ...e.ipv6, ...e.bssids.map((b) => b.mac));
  }
  if (i) out.push(i.publicIpv4, i.publicIpv6, i.ipv6Prefix, i.ispGateway, ...i.dnsInUse);
  return out;
}

/** The plain-text "Copy diagnostics report". Pure; `scrub` runs over the whole text last. */
export function supportReport(r: ReportInputs): string {
  const n = r.network;
  const h = r.health;
  const i = h?.internet ?? null;
  const eeros = h?.eeros ?? [];
  const name = (id: M.Id | null) => eeros.find((e) => e.id === id)?.location ?? MISSING;
  const lines: string[] = [
    "Mesh UI diagnostics report",
    `Generated: ${new Date(r.now).toISOString()}`,
    `App: Mesh UI ${r.app.version} (${r.app.backend} backend)`,
    `Support ID: ${or(r.supportId)}`,
    "Names, serials, MAC and IP addresses show only their last four characters.",
    "",
    "Network",
    `Name: ${or(n?.name)}`,
    `Status: ${or(n?.status)}`,
    `Connection mode: ${or(n?.connectionMode)}`,
    `Time zone: ${or(n?.timezone)}`,
    `eeros: ${or(eeros.length || n?.counts.eeros)}`,
    `Devices: ${r.devices ? `${r.devices.online} online of ${r.devices.total}` : MISSING}`,
    `Gateway uptime: ${formatDuration(n?.gatewayUptimeSec ?? null)}`,
    "",
    "Health check",
  ];
  if (r.report) {
    lines.push(`Overall: ${r.report.overall} (score ${r.report.score})`);
    for (const c of r.report.checks) lines.push(`[${STATUS_WORD[c.status]}] ${c.label}: ${or(c.detail)}`);
  } else lines.push(MISSING);
  lines.push("", "Internet");
  if (i) {
    lines.push(
      `Status: ${i.status}`,
      `ISP: ${or(i.isp.name)}`,
      `WAN type: ${or(i.wanType)}`,
      `Public IPv4: ${or(i.publicIpv4)}`,
      `Public IPv6: ${or(i.publicIpv6)}`,
      `ISP gateway: ${or(i.ispGateway)}`,
      `DNS: ${or(i.dnsMode)}${i.dnsInUse.length ? ` (${i.dnsInUse.join(", ")})` : ""}`,
      `Double NAT: ${or(i.doubleNat)}`,
      `Last speed test: ${i.lastSpeedTest ? `${formatMbps(i.lastSpeedTest.downMbps)} down, ${formatMbps(i.lastSpeedTest.upMbps)} up, ${formatRelative(i.lastSpeedTest.at, r.now)}` : MISSING}`,
    );
  } else lines.push(MISSING);
  lines.push("", "eeros");
  for (const e of eeros) {
    lines.push(
      `${e.location}${e.isGateway ? " (gateway)" : ""}`,
      `  Model: ${or(e.model)}, status ${e.status}, firmware ${or(e.firmware)}`,
      `  Backhaul: ${or(e.backhaul)}${e.meshBars !== null ? `, ${e.meshBars} bars` : ""}${e.upstream ? `, upstream ${name(e.upstream)}` : ""}`,
      `  Serial: ${or(e.serial)}, MAC: ${or(e.mac)}, IP: ${or(e.ipv4)}`,
      `  Clients: ${or(e.clients.total)}, uptime ${formatDuration(e.uptimeSec)}, last heartbeat ${formatRelative(e.lastHeartbeat, r.now)}`,
    );
  }
  if (!eeros.length) lines.push(MISSING);
  const u = h?.updates ?? null;
  lines.push("", "Firmware", u ? `Current: ${or(u.current)}, target: ${or(u.target)}, status: ${u.status}, stuck eeros: ${u.stuckEeros.length}` : MISSING);
  lines.push("", "Issues");
  const issues = h?.health.issues ?? [];
  for (const x of issues) lines.push(`${x.kind}: ${x.eeroId ? name(x.eeroId) : "network"}${x.upstreamId ? ` via ${name(x.upstreamId)}` : ""}, ${x.deviceIds.length} devices affected`);
  if (!issues.length) lines.push("None");
  for (const m of h?.health.messages ?? []) lines.push(`Message: ${m}`);
  const d = r.diagnostics;
  lines.push("", "Last cloud diagnostics", d ? `Status: ${or(d.status)}, issue area: ${or(d.issueArea)}` : MISSING);
  for (const x of d?.results ?? []) lines.push(`${x.name}: ${x.status}${x.detail ? `, ${x.detail}` : ""}`);
  return `${scrub(lines.join("\n"), secretsOf(r))}\n`;
}

// ---------------------------------------------------------------------------
// Support info

async function supportInfo(ctx: CommandContext): Promise<M.SupportInfo> {
  const net = ctx.net;
  const [support, account, internet] = await Promise.all([ctx.backend.diagnostics.support(net), settled(ctx.backend.account.get()), settled(ctx.backend.internet.get(net))]);
  // eero names no ISP contact on most networks; the ISP's name still helps.
  const ispName = internet?.isp.name ?? null;
  const isp = support.isp ?? (ispName ? { name: ispName, phone: null, url: null } : null);
  return { supportId: account?.id || null, ...support, isp };
}

const empty = z.object({});

export const commands: AnyCommand[] = [
  defineCommand({
    id: "health.check",
    label: "Network health check",
    description:
      "Checks internet, DNS, each eero, mesh links and firmware, each good, warning, problem or unknown with a one-line detail, plus an overall status and a 0 to 100 score. Built from the app's normal reads; runs no active probes.",
    icon: "stethoscope",
    params: empty,
    effect: "query",
    topic: "network",
    poll: POLL.network,
    run: async (ctx): Promise<M.HealthReport> => healthReport(await readInputs(ctx), ctx.now()),
  }),

  defineCommand({
    id: "support.info",
    label: "Get help",
    description: "Support contacts for this network (eero's phone and links, the ISP when known) and the Support ID to quote.",
    icon: "life-buoy",
    params: empty,
    effect: "query",
    topic: "diagnostics",
    run: (ctx): Promise<M.SupportInfo> => supportInfo(ctx),
  }),

  defineCommand({
    id: "support.report",
    label: "Copy diagnostics report",
    description:
      "A plain-text report of the network, health check, internet, eeros, firmware and the last cloud diagnostics, for a support chat. MACs, IPs, names and serials show only their last four characters; it never holds the session token.",
    icon: "clipboard-copy",
    params: empty,
    effect: "query",
    async run(ctx): Promise<string> {
      const net = ctx.net;
      const now = ctx.now();
      const [inputs, network, account, devices, diagnostics] = await Promise.all([
        settled(readInputs(ctx)),
        settled(ctx.backend.network.get(net)),
        settled(ctx.backend.account.get()),
        settled(ctx.backend.device.list(net)),
        settled(ctx.backend.diagnostics.latest(net)),
      ]);
      const known = devices ? knownDevices(devices, now) : null;
      return supportReport({
        now,
        app: { version: ctx.host.version, backend: ctx.backend.kind },
        supportId: account?.id || null,
        network,
        health: inputs,
        report: inputs ? healthReport(inputs, now) : null,
        devices: known ? { online: known.filter((d) => d.connected).length, total: known.length } : null,
        diagnostics,
      });
    },
  }),
];
