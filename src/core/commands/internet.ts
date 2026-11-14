/**
 * Internet connection and speed test commands. Plan speed comes from app
 * settings (set by the user with `internet.plan.set`, eero does not know it)
 * and speed test ratings are computed here against it, so every surface
 * agrees. `speedtest.run` starts a test (one at a time per network); its
 * result shows in the history about a minute later.
 * See docs/architecture/commands.md (internet, speed tests and usage) and
 * docs/ux/pages/internet.md.
 */

import { z } from "zod";
import type { Backend } from "../backend";
import { CommandError } from "../errors";
import { type CsvColumn, formatMbps, formatRelative, MISSING, toCsv } from "../format";
import type * as M from "../model";
import { POLL } from "../poll";
import { type AnyCommand, type CommandContext, defineCommand } from "../spec";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** A result at or above this share of the plan is "great". */
export const GREAT_SHARE = 0.75;

/** A result under this share of the plan is "poor". */
export const POOR_SHARE = 0.4;

/** The most tests one history call asks eero for (the 7-day window). */
export const SPEEDTEST_FETCH_LIMIT = 200;

/** About how long eero takes to post a result after `POST {net}/speedtest`. */
export const SPEEDTEST_RESULT_MS = 60_000;

/** A test with no result by then has failed; another may start. */
export const SPEEDTEST_GIVE_UP_MS = 3 * 60_000;

/** While a test runs, a history read without its result is kept only this long. */
const PENDING_RECHECK_MS = 5_000;

/** A result dated up to this long before the start still counts (eero's clock against ours). */
const CLOCK_SKEW_MS = 10_000;

/** What `speedtest.run` returns (and `speedtest.history` while it runs). */
export type SpeedTestRun = M.SpeedTestRun;

/**
 * Tests started and not yet seen in the history: backend to network to the
 * start time (engine clock) and the newest result read before it, which
 * cannot be this test's.
 */
const running = new WeakMap<Backend, Map<M.Id, { since: number; after: number }>>();

/** The newest result each history read saw, per backend and network. */
const newestSeen = new WeakMap<Backend, Map<M.Id, number>>();

const perBackend = <V>(map: WeakMap<Backend, Map<M.Id, V>>, backend: Backend): Map<M.Id, V> => {
  let m = map.get(backend);
  if (!m) map.set(backend, (m = new Map()));
  return m;
};

const runOf = (net: M.Id, since: number): SpeedTestRun => ({
  networkId: net,
  startedAt: new Date(since).toISOString(),
  resultAt: new Date(since + SPEEDTEST_RESULT_MS).toISOString(),
});

/** When the running test on `net` started, or null (none, or it gave up). */
function runningSince(ctx: CommandContext, net: M.Id): number | null {
  const tests = running.get(ctx.backend);
  const test = tests?.get(net);
  if (test === undefined) return null;
  if (ctx.now() - test.since >= SPEEDTEST_GIVE_UP_MS) {
    tests?.delete(net);
    return null;
  }
  return test.since;
}

/**
 * Called by every history read: once the running test's result is in, the
 * test is over and internet.get (its last test) is stale. Until then the
 * read expires after a few seconds, so the result shows soon after it lands.
 */
function checkRunning(ctx: CommandContext, net: M.Id, tests: M.SpeedTest[]): SpeedTestRun | null {
  const since = runningSince(ctx, net);
  const after = running.get(ctx.backend)?.get(net)?.after ?? Number.NEGATIVE_INFINITY;
  const newest = tests[0] ? Date.parse(tests[0].at) : null;
  if (newest !== null) perBackend(newestSeen, ctx.backend).set(net, newest);
  if (since === null) return null;
  if (tests.some((t) => Date.parse(t.at) >= since - CLOCK_SKEW_MS && Date.parse(t.at) > after)) {
    running.get(ctx.backend)?.delete(net);
    ctx.invalidate(["network"]);
    return null;
  }
  ctx.invalidate(["speedtest"], ctx.now() + PENDING_RECHECK_MS);
  return runOf(net, since);
}

const PLAN_MAX_MBPS = 100_000;
const mbps = (dir: string) =>
  z
    .number()
    .positive(`The ${dir} speed must be more than 0 Mbps.`)
    .max(PLAN_MAX_MBPS, `The ${dir} speed is ${PLAN_MAX_MBPS.toLocaleString("en-US")} Mbps at most.`)
    .optional()
    .describe(`${dir[0]?.toUpperCase()}${dir.slice(1)} speed of the plan, in Mbps.`);

/**
 * "great" when every measured direction reaches 75% of the plan, "poor"
 * when any is under 40%, else "below_plan"; null without a plan or a
 * measurement.
 */
export function speedRating(test: Pick<M.SpeedTest, "downMbps" | "upMbps">, plan: M.PlanSpeed | null): M.SpeedTest["rating"] {
  if (!plan) return null;
  const shares: number[] = [];
  if (test.downMbps !== null && plan.down > 0) shares.push(test.downMbps / plan.down);
  if (test.upMbps !== null && plan.up > 0) shares.push(test.upMbps / plan.up);
  if (shares.length === 0) return null;
  const worst = Math.min(...shares);
  return worst >= GREAT_SHARE ? "great" : worst < POOR_SHARE ? "poor" : "below_plan";
}

const rate = (test: M.SpeedTest, plan: M.PlanSpeed | null): M.SpeedTest => ({ ...test, rating: speedRating(test, plan) });

async function planFor(ctx: { settings: { get(): Promise<M.AppSettings> } }, net: M.Id): Promise<M.PlanSpeed | null> {
  return (await ctx.settings.get()).planMbps[net] ?? null;
}

function average(values: (number | null)[]): number | null {
  const xs = values.filter((v): v is number => v !== null);
  return xs.length ? Math.round((xs.reduce((s, v) => s + v, 0) / xs.length) * 10) / 10 : null;
}

/**
 * The hero line on the Internet page, from the connection status, the last
 * test and the plan: "Ziply Fiber is down", "... is fast and steady" (last
 * test great), "... is slower than your plan" (below plan or poor), or "... is
 * up" when there is no test or no plan to compare with. `detail` words the
 * last test ("Last test 2 h ago hit 78% of your 1.2 Gbps plan").
 */
export function internetVerdict(i: Omit<M.Internet, "verdict">, now: number): M.InternetVerdict {
  const name = i.isp.name ?? "Your internet";
  if (i.status === "offline") return { kind: "down", title: `${name} is down`, detail: null };
  const test = i.lastSpeedTest;
  if (!test) return { kind: "steady", title: `${name} is up`, detail: "No speed test yet" };
  const when = `Last test ${formatRelative(test.at, now)}`;
  const plan = i.planMbps;
  const rating = speedRating(test, plan);
  if (!plan || !rating) {
    return { kind: "steady", title: `${name} is up`, detail: `${when} measured ${formatMbps(test.downMbps)} down, ${formatMbps(test.upMbps)} up` };
  }
  // Download when it was measured, else upload.
  const [value, full] = test.downMbps !== null && plan.down > 0 ? [test.downMbps, plan.down] : [test.upMbps ?? 0, plan.up];
  const detail = `${when} hit ${Math.round((value / full) * 100)}% of your ${formatMbps(full)} plan`;
  return rating === "great"
    ? { kind: "steady", title: `${name} is fast and steady`, detail }
    : { kind: "slow", title: `${name} is slower than your plan`, detail };
}

const or = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? MISSING : String(v));

const WAN_LABEL: Record<NonNullable<M.Internet["wanType"]>, string> = { dhcp: "DHCP", static: "Static", pppoe: "PPPoE" };

/** The plain-text block behind "Copy details" on the Internet page. */
export function internetText(i: M.Internet): string {
  const place = [i.isp.city, i.isp.region, i.isp.country].filter(Boolean).join(", ");
  const gw = i.gateway;
  const lines = [
    "Internet provider",
    `ISP: ${or(i.isp.name)}`,
    `Organisation: ${or(i.isp.org)}`,
    `ASN: ${or(i.isp.asn)}`,
    `Location: ${or(place)}`,
    `Plan: ${i.planMbps ? `${formatMbps(i.planMbps.down)} down / ${formatMbps(i.planMbps.up)} up (set by you)` : MISSING}`,
    "",
    "Addressing",
    `WAN type: ${i.wanType ? WAN_LABEL[i.wanType] : MISSING}`,
    `Public IPv4: ${or(i.publicIpv4)}`,
    `Public IPv6: ${or(i.publicIpv6)}`,
    `IPv6 prefix: ${or(i.ipv6Prefix)}`,
    `ISP gateway: ${or(i.ispGateway)}`,
    `DNS in use: ${i.dnsInUse.length ? i.dnsInUse.join(", ") : MISSING}${i.dnsMode ? ` (${i.dnsMode})` : ""}`,
    `Double NAT: ${i.doubleNat === null ? MISSING : i.doubleNat ? "Detected" : "Not detected"}`,
    `Gateway: ${gw ? `${gw.location}${gw.model ? ` (${gw.model})` : ""}, WAN port ${formatMbps(gw.wanPortSpeedMbps)}` : MISSING}`,
  ];
  return `${lines.join("\n")}\n`;
}

const RATING_LABEL: Record<NonNullable<M.SpeedTest["rating"]>, string> = { great: "Great", below_plan: "Below plan", poor: "Poor" };

const SPEED_CSV: CsvColumn<M.SpeedTest>[] = [
  { header: "When", value: (t) => t.at },
  { header: "Download (Mbps)", value: (t) => t.downMbps },
  { header: "Upload (Mbps)", value: (t) => t.upMbps },
  { header: "Verdict", value: (t) => (t.rating ? RATING_LABEL[t.rating] : null) },
];

export const commands: AnyCommand[] = [
  defineCommand({
    id: "internet.get",
    label: "Internet connection",
    description: "ISP, public IPs, WAN type, DNS in use, double NAT, the gateway and its WAN port, your plan speed and the last speed test. `format: \"text\"` returns the Copy details block.",
    icon: "globe",
    params: z.object({ format: z.enum(["json", "text"]).default("json") }),
    effect: "query",
    topic: "network",
    poll: POLL.network,
    async run(ctx, p): Promise<M.Internet | string> {
      const net = ctx.net;
      const [raw, plan] = await Promise.all([ctx.backend.internet.get(net), planFor(ctx, net)]);
      const rated = { ...raw, planMbps: plan, lastSpeedTest: raw.lastSpeedTest ? rate(raw.lastSpeedTest, plan) : null };
      const internet: M.Internet = { ...rated, verdict: internetVerdict(rated, ctx.now()) };
      return p.format === "text" ? internetText(internet) : internet;
    },
  }),

  defineCommand({
    id: "speedtest.history",
    label: "Speed test history",
    description:
      "Speed tests newest first for the last day or week, rated against your plan, plus 7-day averages and `running` (a test started with speedtest.run that has no result yet, else null). `format: \"csv\"` returns the Export CSV file.",
    icon: "gauge",
    params: z.object({
      range: z.enum(["day", "week"]).default("week"),
      limit: z.number().int().min(1).max(200).default(50),
      format: z.enum(["json", "csv"]).default("json"),
    }),
    effect: "query",
    topic: "speedtest",
    async run(ctx, p): Promise<M.SpeedHistory | string> {
      const net = ctx.net;
      const now = ctx.now();
      const from = now - 7 * DAY_MS;
      const [week, plan] = await Promise.all([
        ctx.backend.internet.speedTests(net, { from: new Date(from).toISOString(), to: new Date(now).toISOString(), limit: SPEEDTEST_FETCH_LIMIT }),
        planFor(ctx, net),
      ]);
      const sorted = [...week].sort((a, b) => b.at.localeCompare(a.at));
      const pending = checkRunning(ctx, net, sorted);
      const since = p.range === "day" ? now - DAY_MS : from;
      const tests = sorted.filter((t) => Date.parse(t.at) >= since).slice(0, p.limit).map((t) => rate(t, plan));
      if (p.format === "csv") return toCsv(tests, SPEED_CSV);
      return {
        tests,
        avg7d: { downMbps: average(sorted.map((t) => t.downMbps)), upMbps: average(sorted.map((t) => t.upMbps)) },
        running: pending,
      };
    },
  }),

  defineCommand({
    id: "speedtest.run",
    label: "Run speed test",
    description:
      "Starts a speed test from the gateway to the internet; it uses the WAN for about 30 s. Answers once eero accepts it: the result shows in speedtest.history and internet.get about a minute later (resultAt). One test at a time per network; another start is refused with rate_limited until the result shows or 3 minutes pass.",
    icon: "gauge",
    params: z.object({}),
    effect: "write",
    invalidates: ["speedtest", "network"],
    async run(ctx): Promise<SpeedTestRun> {
      const net = ctx.net;
      const since = runningSince(ctx, net);
      if (since !== null) {
        const retryAfterSec = Math.max(1, Math.ceil((since + SPEEDTEST_GIVE_UP_MS - ctx.now()) / 1000));
        throw new CommandError("rate_limited", "A speed test is already running on this network. Its result shows in about a minute.", { retryAfterSec });
      }
      await ctx.backend.internet.runSpeedTest(net);
      const now = ctx.now();
      perBackend(running, ctx.backend).set(net, { since: now, after: newestSeen.get(ctx.backend)?.get(net) ?? Number.NEGATIVE_INFINITY });
      // Reads made before the result is due expire when it is.
      ctx.invalidate(["speedtest", "network"], now + SPEEDTEST_RESULT_MS);
      return runOf(net, now);
    },
  }),

  defineCommand({
    id: "internet.plan.set",
    label: "Set internet plan",
    description:
      "Saves the plan speed you pay for (download and up Mbps, optional name) for this network, or `clear: true` removes it. Stored in Mesh UI's settings, not on eero; gauges, meters and speed test ratings compare against it. Returns the plan, or null after clear.",
    icon: "gauge",
    params: z.object({
      down: mbps("download"),
      up: mbps("upload"),
      label: z.string().trim().max(40, "The plan name is 40 characters at most.").optional().describe('A name for the plan, e.g. "Fiber Gig".'),
      clear: z.literal(true).optional().describe("Removes the plan instead of setting it."),
    }),
    effect: "write",
    invalidates: ["network", "speedtest"],
    async run(ctx, p): Promise<M.PlanSpeed | null> {
      const net = ctx.net;
      const { [net]: previous, ...others } = (await ctx.settings.get()).planMbps;
      if (p.clear) {
        if (p.down !== undefined || p.up !== undefined || p.label !== undefined) {
          throw new CommandError("bad_params", "Pass either clear, or down and up, not both.");
        }
        if (previous) await ctx.settings.update({ planMbps: others });
        return null;
      }
      const missing = (["down", "up"] as const).filter((k) => p[k] === undefined);
      if (missing.length) {
        throw new CommandError("bad_params", "Pass both down and up (Mbps), or clear: true.", {
          issues: missing.map((k) => ({ path: k, message: `Enter the ${k === "down" ? "download" : "upload"} speed.` })),
        });
      }
      const plan: M.PlanSpeed = { down: p.down as number, up: p.up as number, ...(p.label ? { label: p.label } : {}) };
      await ctx.settings.update({ planMbps: { ...others, [net]: plan } });
      return plan;
    },
  }),
];
