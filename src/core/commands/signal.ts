/**
 * The Signal page's commands (docs/ux/pages/signal.md), in their own file
 * like coverage.ts; the ids stay in the `wifi` area.
 *
 * - `wifi.health`: signal, speed, mesh links, radios and advice, worked out
 *   from the device and eero lists (no requests of its own).
 * - `wifi.insights`: eero's upgrade report joined to the device list: what
 *   each device supports against what it connects with, why some are held
 *   back, and every piece of advice.
 * - `wifi.history`: each device's signal as sampled while Mesh UI runs (eero
 *   keeps no history on free accounts), from ../signalHistory.ts.
 */

import { z } from "zod";
import type * as M from "../model";
import { POLL } from "../poll";
import { channelSpan, generationOf, GENERATION_ORDER, generationRank, maxRateMbps, median, SIGNAL_DBM, signalQuality, spansOverlap } from "../signal";
import { HISTORY, recordSignals, signalHistory } from "../signalHistory";
import { type AnyCommand, type CommandContext, defineCommand } from "../spec";
import { withTopology } from "./eero";

export { generationOf, HISTORY, recordSignals, SIGNAL_DBM, signalQuality };

/** At most this many devices in `weakest`. */
export const WEAKEST = 5;

/** The histogram's buckets: 5 dBm wide, from -90 to -40 (ends open). */
export const HISTOGRAM = { from: -90, to: -40, step: 5 } as const;

/** Thresholds of the advice rules. */
export const ADVICE = {
  /** A radio this busy (channel utilization, percent) is worth a look. */
  busyPct: 50,
  /** Retries above this percent with a signal at least `noisyDbm` point at interference. */
  noisyRetryPct: 10,
  noisyDbm: -70,
  /** A 2.4 GHz device at least this strong that supports 5 GHz is stuck. */
  stuckDbm: SIGNAL_DBM.good,
} as const;

const WIRELESS: M.WirelessBand[] = ["2.4", "5", "6"];
const BAND_WORD: Record<M.WirelessBand, string> = { "2.4": "2.4 GHz", "5": "5 GHz", "6": "6 GHz" };
const emptyQuality = (): Record<M.SignalQuality, number> => ({ excellent: 0, good: 0, fair: 0, weak: 0 });

type WirelessDevice = M.Device & { band: M.WirelessBand; signal: { dbm: number; bars: number | null } };

const isWireless = (d: M.Device): d is WirelessDevice => d.connected && d.band !== null && d.band !== "wired" && typeof d.signal?.dbm === "number";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "A", "A and B", "A, B and C", "A, B and 3 more". */
export function nameList(names: ReadonlyArray<string>, max = 3): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length <= max) return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${names.slice(0, max - 1).join(", ")} and ${names.length - (max - 1)} more`;
}

const TONE_RANK: Record<M.SignalAdvice["tone"], number> = { destructive: 0, warning: 1, info: 2 };

/** Most useful first: problems before notes, then the advice that touches the most devices. */
export const byUsefulness = (a: M.SignalAdvice, b: M.SignalAdvice) => TONE_RANK[a.tone] - TONE_RANK[b.tone] || b.devices.length - a.devices.length || a.title.localeCompare(b.title);

function point(d: WirelessDevice): M.SignalPoint {
  const generation = generationOf(d.link?.standard, d.band);
  const rx = d.link?.rxMbps ?? null;
  const maxMbps = maxRateMbps(generation, d.link?.widthMhz ?? null, d.link?.streams ?? null);
  return {
    deviceId: d.id,
    name: d.name,
    eeroId: d.eeroId,
    band: d.band,
    dbm: d.signal.dbm,
    bars: d.signal.bars,
    quality: signalQuality(d.signal.dbm),
    rxMbps: rx,
    generation,
    retryPct: d.link?.retryPct ?? null,
    snr: d.link?.snr ?? null,
    maxMbps,
    headroomPct: rx !== null && maxMbps ? Math.min(100, Math.round((rx / maxMbps) * 100)) : null,
  };
}

const hopOf = (e: M.Eero) => (e.isGateway ? 0 : (e.hop ?? 1));

function meshNodes(eeros: ReadonlyArray<M.Eero>, points: ReadonlyArray<M.SignalPoint>): M.MeshNode[] {
  return [...eeros]
    .sort((a, b) => hopOf(a) - hopOf(b) || a.location.localeCompare(b.location))
    .map((e) => {
      const on = points.filter((p) => p.eeroId === e.id);
      return {
        eeroId: e.id,
        eero: e.location,
        model: e.model,
        isGateway: e.isGateway,
        status: e.status,
        backhaul: e.backhaul,
        upstream: e.upstream,
        hop: e.hop,
        meshBars: e.meshBars,
        meshQuality: e.meshQuality,
        devices: on.length,
        weak: on.filter((p) => p.quality === "weak").length,
        medianDbm: median(on.map((p) => p.dbm)),
      };
    });
}

// ---------------------------------------------------------------------------
// Advice from the device and eero lists

const ref = (p: M.SignalPoint) => ({ deviceId: p.deviceId, name: p.name });
const eeroRef = (e: M.Eero) => ({ eeroId: e.id, name: e.location });

function meshAdvice(eeros: ReadonlyArray<M.Eero>, points: ReadonlyArray<M.SignalPoint>): M.SignalAdvice[] {
  const byId = new Map(eeros.map((e) => [e.id, e]));
  const out: M.SignalAdvice[] = [];
  const flagged = new Set<string>();
  for (const e of eeros) {
    if (e.status === "offline" || e.backhaul !== "wireless" || (e.meshQuality !== "weak" && e.meshQuality !== "poor")) continue;
    flagged.add(e.id);
    const up = e.upstream ? byId.get(e.upstream) : undefined;
    const upName = up?.location ?? "the mesh";
    const on = points.filter((p) => p.eeroId === e.id);
    const weak = on.filter((p) => p.quality === "weak").sort((a, b) => a.dbm - b.dbm);
    const range = weak.length > 1 ? `${weak[weak.length - 1]?.dbm} to ${weak[0]?.dbm} dBm` : `${weak[0]?.dbm} dBm`;
    const devicesPart = weak.length
      ? `, and ${weak.length === on.length ? (on.length === 1 ? "its only device is" : `all ${on.length} of its devices are`) : `${weak.length} of its ${on.length} devices ${weak.length === 1 ? "is" : "are"}`} weak (${range})`
      : "";
    out.push({
      kind: "weak_mesh_link",
      tone: e.meshQuality === "poor" || weak.length > 0 ? "destructive" : "warning",
      title: `${e.location} has a weak mesh link`,
      detail: `Its Wi-Fi link to ${upName} is ${e.meshBars ?? 0} of 5 bars${devicesPart}. Moving it closer to ${upName}, or wiring it, helps everything connected through it.`,
      eeroId: e.id,
      devices: weak.map(ref),
      eeros: [eeroRef(e), ...(up ? [eeroRef(up)] : [])],
    });
  }
  for (const e of eeros) {
    if (flagged.has(e.id) || e.status === "offline") continue;
    const weak = points.filter((p) => p.eeroId === e.id && p.quality === "weak").sort((a, b) => a.dbm - b.dbm);
    if (!weak.length) continue;
    const one = weak.length === 1;
    out.push({
      kind: "weak_devices",
      tone: "warning",
      title: `${plural(weak.length, "weak device")} on ${e.location}`,
      detail: `${nameList(weak.map((p) => p.name))} ${one ? "is" : "are"} below ${SIGNAL_DBM.fair} dBm. Moving ${one ? "it" : "them"} closer to ${e.location}, or away from walls and metal, usually helps.`,
      eeroId: e.id,
      devices: weak.map(ref),
      eeros: [eeroRef(e)],
    });
  }
  return out;
}

/** Channel number words for a group of radios: "channel 1", "channels 36 and 44". */
const channelWords = (channels: number[]) => {
  const unique = [...new Set(channels)].sort((a, b) => a - b);
  return `${unique.length === 1 ? "channel" : "channels"} ${nameList(unique.map(String), 4)}`;
};

function channelAdvice(eeros: ReadonlyArray<M.Eero>): M.SignalAdvice[] {
  const out: M.SignalAdvice[] = [];
  const online = eeros.filter((e) => e.status !== "offline");
  for (const band of WIRELESS) {
    const radios = online.flatMap((e) => e.radios.filter((r) => r.band === band && r.channel !== null).map((r) => ({ eero: e, channel: r.channel as number, span: channelSpan(band, r.channel as number, r.widthMhz) })));
    // Groups of radios joined by overlap (union by scanning: few radios per network).
    const groups: (typeof radios)[] = [];
    for (const r of radios) {
      const hits = groups.filter((g) => g.some((x) => spansOverlap(x.span, r.span)));
      const merged = [r, ...hits.flat()];
      for (const h of hits) groups.splice(groups.indexOf(h), 1);
      groups.push(merged);
    }
    for (const g of groups) {
      const ids = new Set(g.map((x) => x.eero.id));
      if (ids.size < 2) continue;
      // A wireless eero shares its parent's channel for its own link: by design, so only other pairs count.
      const follows = g.filter((x) => x.eero.backhaul === "wireless" && x.eero.upstream && ids.has(x.eero.upstream));
      const independent = g.filter((x) => !follows.includes(x));
      if (new Set(independent.map((x) => x.eero.id)).size < 2) continue;
      const names = [...new Set(g.map((x) => x.eero.location))];
      const follower = follows[0];
      const parent = follower ? online.find((e) => e.id === follower.eero.upstream) : undefined;
      out.push({
        kind: "shared_channel",
        tone: "info",
        title: `${names.length} eeros share ${BAND_WORD[band]} ${channelWords(g.map((x) => x.channel))}`,
        detail: `${nameList(names, 4)} use overlapping channels, so they take turns on the air. eero picks channels itself${follower && parent ? `; ${follower.eero.location} follows ${parent.location} because it links to it over Wi-Fi, and wiring it would let it move` : ""}.`,
        eeroId: null,
        // About the eeros, not their devices: the page names the eeros.
        devices: [],
        eeros: [...new Map(g.map((x) => [x.eero.id, eeroRef(x.eero)])).values()],
      });
    }
  }
  return out;
}

function radioAdvice(eeros: ReadonlyArray<M.Eero>, points: ReadonlyArray<M.SignalPoint>): M.SignalAdvice[] {
  return eeros.flatMap((e) =>
    e.status === "offline"
      ? []
      : e.radios
          .filter((r): r is M.Radio & { band: M.WirelessBand; utilization: number } => r.band !== "wired" && r.utilization !== null && r.utilization >= ADVICE.busyPct)
          .map((r) => {
            const on = points.filter((p) => p.eeroId === e.id && p.band === r.band);
            return {
              kind: "busy_radio" as const,
              tone: "warning" as const,
              title: `${e.location} ${BAND_WORD[r.band]} is ${Math.round(r.utilization)}% busy`,
              detail: `A busy channel slows every device on it (${plural(on.length, "device")} here). Neighbouring networks count too; moving devices that can to another band helps.`,
              eeroId: e.id,
              devices: on.map(ref),
              eeros: [eeroRef(e)],
            };
          }),
  );
}

function noisyAdvice(points: ReadonlyArray<M.SignalPoint>): M.SignalAdvice[] {
  const noisy = points.filter((p) => p.retryPct !== null && p.retryPct >= ADVICE.noisyRetryPct && p.dbm >= ADVICE.noisyDbm).sort((a, b) => (b.retryPct ?? 0) - (a.retryPct ?? 0));
  if (!noisy.length) return [];
  const one = noisy.length === 1;
  return [
    {
      kind: "noisy_link",
      tone: "warning",
      title: `${plural(noisy.length, "device")} ${one ? "resends" : "resend"} a lot`,
      detail: `${nameList(noisy.map((p) => `${p.name} (${Math.round(p.retryPct ?? 0)}%)`))} ${one ? "resends" : "resend"} over ${ADVICE.noisyRetryPct}% of packets with a decent signal, which points at interference near ${one ? "it" : "them"} (a microwave, a cordless phone, a metal shelf) rather than distance.`,
      eeroId: null,
      devices: noisy.map(ref),
      eeros: [],
    },
  ];
}

// ---------------------------------------------------------------------------
// wifi.health

/** Works out `wifi.health` from the device and eero lists: no requests of its own. */
export function wifiHealth(devices: ReadonlyArray<M.Device>, eeros: ReadonlyArray<M.Eero>): M.WifiHealth {
  const names = new Map(eeros.map((e) => [e.id, e.location]));
  const wireless = devices.filter(isWireless);
  const points = wireless.map(point).sort((a, b) => a.dbm - b.dbm || a.name.localeCompare(b.name));
  const quality = emptyQuality();
  for (const p of points) quality[p.quality] += 1;

  const present = WIRELESS.filter((b) => eeros.some((e) => e.radios.some((r) => r.band === b)) || wireless.some((d) => d.band === b));
  const bands = present.map((band) => {
    const on = points.filter((p) => p.band === band);
    const q = emptyQuality();
    for (const p of on) q[p.quality] += 1;
    const speeds = on.map((p) => p.rxMbps).filter((v): v is number => typeof v === "number");
    return { band, devices: on.length, medianDbm: median(on.map((p) => p.dbm)), quality: q, medianMbps: median(speeds), bestMbps: speeds.length ? Math.max(...speeds) : null };
  });

  const weakest = points
    .slice(0, WEAKEST)
    .map((p) => ({ deviceId: p.deviceId, name: p.name, band: p.band, eeroId: p.eeroId, eero: p.eeroId ? (names.get(p.eeroId) ?? null) : null, dbm: p.dbm, bars: p.bars }));

  const gen = new Map<M.WifiGeneration, number>();
  for (const p of points) gen.set(p.generation, (gen.get(p.generation) ?? 0) + 1);
  const generations = GENERATION_ORDER.filter((g) => g !== "unknown" || gen.has("unknown")).map((generation) => ({ generation, devices: gen.get(generation) ?? 0 }));

  // One entry per radio: 5 GHz low and high are two radios on some eeros, so a band can appear twice.
  // eero Built-in devices (Echos) report no radios, so they have no row.
  const radios = eeros.filter((e) => e.kind !== "builtin").map((e) => ({
    eeroId: e.id,
    eero: e.location,
    model: e.model,
    devices: e.clients.total,
    bands: WIRELESS.flatMap((band) =>
      e.radios.filter((r) => r.band === band).map((r) => ({ band, channel: r.channel, widthMhz: r.widthMhz, utilization: r.utilization, txPowerDbm: r.txPowerDbm, devices: r.clients })),
    ),
  }));
  let busiest: M.WifiHealth["busiest"] = null;
  for (const row of radios)
    for (const b of row.bands)
      if (b.utilization !== null && (busiest === null || b.utilization > busiest.utilization)) busiest = { eeroId: row.eeroId, eero: row.eero, band: b.band, utilization: b.utilization };

  const histogram: M.WifiHealth["histogram"] = [];
  for (let dbm = HISTOGRAM.from; dbm < HISTOGRAM.to; dbm += HISTOGRAM.step) histogram.push({ dbm, devices: 0 });
  for (const p of points) {
    const i = Math.min(histogram.length - 1, Math.max(0, Math.floor((p.dbm - HISTOGRAM.from) / HISTOGRAM.step)));
    (histogram[i] as { devices: number }).devices += 1;
  }

  const mesh = meshNodes(eeros, points);
  const load = mesh.flatMap((n) => {
    const e = eeros.find((x) => x.id === n.eeroId);
    return present.map((band) => {
      const on = points.filter((p) => p.eeroId === n.eeroId && p.band === band);
      return { eeroId: n.eeroId, band, radio: !!e?.radios.some((r) => r.band === band), devices: on.length, medianDbm: median(on.map((p) => p.dbm)) };
    });
  });
  const advice = [...meshAdvice(eeros, points), ...radioAdvice(eeros, points), ...noisyAdvice(points), ...channelAdvice(eeros)].sort(byUsefulness);

  return { devices: points.length, medianDbm: median(points.map((p) => p.dbm)), quality, histogram, bands, weakest, generations, radios, busiest, points, mesh, load, advice };
}

// ---------------------------------------------------------------------------
// wifi.insights

type Supported = M.UpgradeReport["devices"][number]["generation"];

/** Joins the upgrade report to wifi.health: flows, held back devices and the advice that needs what devices support. */
export function wifiInsights(health: M.WifiHealth, eeros: ReadonlyArray<M.Eero>, report: M.UpgradeReport | null): M.WifiInsights {
  if (!report) return { report: false, flows: [], heldBack: [], advice: health.advice };
  const supports = new Map<string, Supported>(report.devices.map((d) => [d.deviceId, d.generation]));
  const byId = new Map(eeros.map((e) => [e.id, e]));
  const hasRadio = (eeroId: string | null, band: M.WirelessBand) => !!(eeroId && byId.get(eeroId)?.radios.some((r) => r.band === band));

  const flowMap = new Map<string, M.WifiInsights["flows"][number]>();
  const held = new Map<M.HeldBackReason, M.WifiInsights["heldBack"][number]["devices"]>();
  const stuck: M.SignalPoint[] = [];
  const noSix: M.SignalPoint[] = [];
  const nearSix: M.SignalPoint[] = [];
  for (const p of health.points) {
    const best: M.WifiGeneration = supports.get(p.deviceId) ?? p.generation;
    const key = `${best}>${p.generation}`;
    const flow = flowMap.get(key) ?? { supports: best, current: p.generation, devices: [] };
    flow.devices.push(ref(p));
    flowMap.set(key, flow);
    if (generationRank(best) <= generationRank(p.generation) || p.generation === "unknown") continue;
    const sixCapable = generationRank(best) >= generationRank("wifi6e");
    const reason: M.HeldBackReason =
      p.quality === "weak"
        ? "weak_signal"
        : p.band === "2.4" && hasRadio(p.eeroId, "5")
          ? "on_24"
          : sixCapable && p.band !== "6" && !hasRadio(p.eeroId, "6")
            ? "no_6ghz_radio"
            : sixCapable && p.band === "5"
              ? "on_5_near_6"
              : "other";
    held.set(reason, [...(held.get(reason) ?? []), { deviceId: p.deviceId, name: p.name, eeroId: p.eeroId }]);
    if (reason === "on_24" && p.dbm >= ADVICE.stuckDbm) stuck.push(p);
    if (reason === "no_6ghz_radio") noSix.push(p);
    if (reason === "on_5_near_6") nearSix.push(p);
  }

  const advice: M.SignalAdvice[] = [...health.advice];
  if (stuck.length) {
    const one = stuck.length === 1;
    const top = Math.max(...stuck.map((p) => p.rxMbps ?? 0));
    advice.push({
      kind: "stuck_on_24",
      tone: "warning",
      title: `${plural(stuck.length, "device")} stuck on 2.4 GHz`,
      detail: `${nameList(stuck.map((p) => p.name))} ${one ? "supports" : "support"} 5 GHz and ${one ? "has" : "have"} a strong signal, but ${one ? "links" : "link"} at ${top ? `${Math.round(top)} Mbps or less` : "2.4 GHz speeds"}. Forgetting the network on the device and joining again usually moves ${one ? "it" : "them"}.`,
      eeroId: null,
      devices: stuck.map(ref),
      eeros: [],
    });
  }
  if (noSix.length || nearSix.length) {
    const n = noSix.length + nearSix.length;
    const parts: string[] = [];
    if (noSix.length) {
      const where = [...new Set(noSix.map((p) => (p.eeroId ? byId.get(p.eeroId)?.location : null)).filter((x): x is string => !!x))];
      parts.push(`${nameList(noSix.map((p) => p.name))} ${noSix.length === 1 ? "supports" : "support"} Wi-Fi 6E, but ${nameList(where)} ${where.length === 1 ? "has" : "have"} no 6 GHz radio`);
    }
    if (nearSix.length) parts.push(`${nameList(nearSix.map((p) => p.name))} ${nearSix.length === 1 ? "is" : "are"} on 5 GHz beside a 6 GHz radio, often a setting on the device`);
    advice.push({
      kind: "could_use_6ghz",
      tone: "info",
      title: `${plural(n, "device")} could use 6 GHz`,
      detail: `${parts.join("; ")}.`,
      eeroId: null,
      devices: [...noSix, ...nearSix].map(ref),
      eeros: [],
    });
  }

  const flows = [...flowMap.values()].sort(
    (a, b) => GENERATION_ORDER.indexOf(a.supports) - GENERATION_ORDER.indexOf(b.supports) || GENERATION_ORDER.indexOf(a.current) - GENERATION_ORDER.indexOf(b.current),
  );
  const heldBack = [...held].map(([reason, devices]) => ({ reason, devices })).sort((a, b) => b.devices.length - a.devices.length || a.reason.localeCompare(b.reason));
  return { report: true, flows, heldBack, advice: advice.sort(byUsefulness) };
}

// ---------------------------------------------------------------------------
// Commands

async function readHealth(ctx: CommandContext): Promise<{ health: M.WifiHealth; eeros: M.Eero[] }> {
  const [devices, listed] = await Promise.all([ctx.backend.device.list(ctx.net), ctx.backend.eero.list(ctx.net)]);
  recordSignals(ctx, devices);
  // Hops and mesh quality are filled in by core, as eero.list does.
  const eeros = withTopology(listed);
  return { health: wifiHealth(devices, eeros), eeros };
}

/** The upgrade report, or null when eero's /2.4/ scan is missing (404) or fails: insights then leave it out. */
async function readReport(ctx: CommandContext): Promise<M.UpgradeReport | null> {
  try {
    return await ctx.backend.diagnostics.upgradeReport(ctx.net);
  } catch {
    return null;
  }
}

export const commands: AnyCommand[] = [
  defineCommand({
    id: "wifi.health",
    label: "Signal",
    description:
      "Signal, link speed and mesh of the connected wireless devices right now: devices per signal quality (excellent at -55 dBm or better, good to -65, fair to -75, weak below) and the median dBm, overall and per band; median and best link speed per band; the 5 weakest devices; a histogram per 5 dBm; devices per Wi-Fi generation; each eero's radios (channel, width, utilization, transmit power, devices) with the busiest; every device as a point (eero, band, dBm, link speed, generation, retries, SNR, the top rate its link allows); each eero's link to the mesh and its devices; devices per eero and band; and advice (weak mesh links, weak devices, busy radios, devices that resend a lot, eeros sharing channels). Read from the device and eero lists; no history.",
    icon: "activity",
    params: z.object({}),
    effect: "query",
    topic: "devices",
    poll: POLL.devices,
    run: async (ctx): Promise<M.WifiHealth> => (await readHealth(ctx)).health,
  }),
  defineCommand({
    id: "wifi.insights",
    label: "Signal insights",
    description:
      "eero's upgrade report joined to the device list: devices per pair of the newest Wi-Fi generation they support and the one they connect with, why devices connect below what they support (weak signal, on 2.4 GHz, no 6 GHz radio on their eero, on 5 GHz beside a 6 GHz radio), and every piece of advice, wifi.health's plus devices stuck on 2.4 GHz and devices that could use 6 GHz, most useful first. Reads the /2.4/ upgrade report once; without it, report is false and only wifi.health's advice is returned.",
    icon: "lightbulb",
    params: z.object({}),
    effect: "query",
    topic: "devices",
    run: async (ctx): Promise<M.WifiInsights> => {
      const [{ health, eeros }, report] = await Promise.all([readHealth(ctx), readReport(ctx)]);
      return wifiInsights(health, eeros, report);
    },
  }),
  defineCommand({
    id: "wifi.history",
    label: "Signal history",
    description:
      "Each wireless device's signal as Mesh UI sampled it while running (eero keeps no history on free accounts): a sample whenever the device list is read, at most every 20 seconds, kept for 4 hours in memory only. The devices that most need a look come first (most drops, then weakest). Empty in a one-off CLI run.",
    icon: "history",
    params: z.object({
      minutes: z.number().int().min(5).max(240).optional().describe("The window, 5 to 240 minutes. Default 60."),
      limit: z.number().int().min(1).max(50).optional().describe(`At most this many devices. Default ${HISTORY.limit}.`),
      device: z.string().optional().describe("Only this device (id, MAC or exact name)."),
    }),
    effect: "query",
    topic: "devices",
    poll: POLL.devices,
    run: async (ctx, p): Promise<M.SignalHistory> => {
      // Reading the list takes a sample now, so the chart ends at the present.
      recordSignals(ctx, await ctx.backend.device.list(ctx.net));
      const deviceId = p.device ? await ctx.resolve("device", p.device) : null;
      return signalHistory(ctx, p.minutes ?? 60, p.limit ?? HISTORY.limit, deviceId);
    },
  }),
];
