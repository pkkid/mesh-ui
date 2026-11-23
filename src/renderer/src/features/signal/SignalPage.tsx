/**
 * Signal (docs/ux/pages/signal.md): how well the wireless devices are
 * connected and what would make it better. Read top to bottom: where things
 * connect (Mesh map beside Coverage scan), how well each device links (Signal and speed
 * beside Weakest connections), the airwaves (channels), load per radio beside
 * resent packets, stability over time (Signal history), what devices could
 * use (Wi-Fi generations beside What holds them back), and last what to fix
 * (Worth a look).
 *
 * Data: `wifi.health` (polled with the device list), `wifi.insights` (the
 * upgrade report joined in, on load), `wifi.history` (samples Mesh UI keeps
 * while running), `coverage.scan` and `eero.list`. The page only lays out
 * what those commands say; the rules behind the advice live in core.
 */
import { RefreshCw, Repeat } from "lucide-react";
import { useState } from "react";

import { Link, pathFor } from "~/app/router";
import type { PageProps } from "~/app/routes";
import { useCommand, useQuery } from "~/app/useCommand";
import { ShareBar } from "~/components/charts/ShareBar";
import { Button } from "~/components/ui/button";
import { Card, Empty, Section } from "~/components/ui/card";
import { Metric, PageHeader } from "~/components/ui/hero";
import { Footnote, GatedButton, SectionError, useNow } from "~/components/ui/page";
import { Status, StatusDot } from "~/components/ui/status";
import { SignalBars } from "~/features/devices/DeviceTable";
import { useTopBarUpdated } from "~/features/shell/TopBar";
import { bandColor, entityColors, signalQualityColors, wifiGenerationColors } from "~/lib/chartColors";
import { deviceIcon } from "~/lib/deviceIcons";
import { cn } from "~/lib/utils";
import { formatCount, formatMbps, formatPercent, formatRelative, MISSING } from "../../../../core/format";
import { ADVICE } from "../../../../core/commands/signal";
import type { CoverageScan, DeviceList, Eero, HeldBackReason, SignalAdvice, SignalHistory, SignalQuality, WifiHealth, WifiInsights } from "../../../../core/model";
import { generationRank, SIGNAL_DBM, signalQuality } from "../../../../core/signal";
import { Airwaves, BAND_WORD, dotColor, GENERATION_WORD, GenerationFlow, HistoryLines, MeshMap, QUALITY_WORD, RetryScatter, SignalScatter, SignalStrips } from "./charts";
import { PlacementCell, PlacementRating, QualityCells, unsupported, usePlacementTest } from "./Coverage";

const QUALITIES: SignalQuality[] = ["excellent", "good", "fair", "weak"];

const QUALITY_LEGEND: Record<SignalQuality, string> = {
  excellent: `Excellent (${SIGNAL_DBM.excellent} dBm or better)`,
  good: "Good",
  fair: "Fair",
  weak: `Weak (below ${SIGNAL_DBM.fair} dBm)`,
};

const plural = (n: number, one: string, many = `${one}s`) => `${formatCount(n)} ${n === 1 ? one : many}`;
const dbm = (v: number | null | undefined) => (v === null || v === undefined ? MISSING : `${v} dBm`);
const muted = (text: string) => <span className="font-normal text-muted-foreground text-xs"> · {text}</span>;

function Square({ color, round = false }: { color: string; round?: boolean }) {
  return <span aria-hidden className={cn("inline-block size-2 shrink-0", round ? "rounded-full" : "rounded-[2px]")} style={{ background: color }} />;
}

/** A device name that opens its page, in the dim link colour (buttons act, links go). */
function DeviceLink({ id, name, className }: { id: string; name: string; className?: string }) {
  return (
    <Link to={pathFor("device", { deviceId: id })} className={cn("outline-none transition-colors hover:text-foreground focus-visible:text-foreground", className)}>
      {name}
    </Link>
  );
}

const TH = "px-4 py-2 font-normal";
const TD = "px-4 py-2";

export function SignalPage(_props: PageProps) {
  const health = useQuery<WifiHealth>("wifi.health", undefined, { poll: true });
  const insights = useQuery<WifiInsights>("wifi.insights");
  // More than the default six, so a network with many dropouts shows them all; the list scrolls past seven.
  const history = useQuery<SignalHistory>("wifi.history", { limit: 20 }, { poll: true });
  const eeros = useQuery<Eero[]>("eero.list");
  useTopBarUpdated(health.fetchedAt);
  const h = health.data;
  const names = new Map((h?.mesh ?? []).map((n) => [n.eeroId, n.eero]));
  // One colour per eero, stable by id, as every other page's eero series.
  const colors = entityColors((h?.mesh ?? []).map((n) => n.eeroId));
  const loading = health.fading && !h;

  return (
    <>
      <Hero health={h} insights={insights.data} names={names} fading={loading} />
      {health.error && !h ? (
        <SectionError what="Signal" error={health.error} onRetry={() => void health.refetch()} />
      ) : (
        <div className="flex flex-col gap-14">
          <MeshSection health={h} eeros={eeros.data} colors={colors} loading={loading} />
          <SpeedSection health={h} names={names} loading={loading} />
          {/* Side by side, the two share rows (subgrid): headers, cards and footnotes line up, and the history card takes Airwaves' height. */}
          <div className="grid gap-x-7 gap-y-14 lg:grid-cols-2">
            <HistorySection history={history.data} loading={history.fading && !history.data} />
            <AirwavesSection health={h} colors={colors} loading={loading} />
          </div>
          {/* Each side takes its own height; the next row clears both. */}
          <div className="grid gap-x-7 gap-y-14 lg:grid-cols-2">
            <LoadSection health={h} loading={loading} />
            <RetriesSection health={h} names={names} loading={loading} />
          </div>
          <GenerationsSection health={h} insights={insights.data} loading={(insights.fading && !insights.data) || loading} />
          <AdviceSection advice={insights.data?.advice ?? h?.advice} loading={loading} />
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Hero

function Hero({ health: h, insights, names, fading }: { health: WifiHealth | undefined; insights: WifiInsights | undefined; names: Map<string, string>; fading: boolean }) {
  const weak = h?.quality.weak ?? 0;
  const fair = h?.quality.fair ?? 0;
  const wirelessLinks = (h?.mesh ?? []).filter((n) => n.backhaul === "wireless" && n.meshBars !== null).sort((a, b) => (a.meshBars ?? 0) - (b.meshBars ?? 0));
  const weakLinks = wirelessLinks.filter((n) => n.meshQuality === "weak" || n.meshQuality === "poor").length;
  const weakestLink = wirelessLinks[0];
  // Only devices that say which generation they link with count, so a network that does not report it reads "-", not 0%.
  const known = h ? h.points.filter((p) => p.generation !== "unknown").length : 0;
  const modern = h ? h.points.filter((p) => generationRank(p.generation) >= generationRank("wifi6")).length : 0;
  const couldBe = insights?.report && h ? insights.flows.filter((f) => f.current !== "unknown" && generationRank(f.supports) >= generationRank("wifi6")).reduce((n, f) => n + f.devices.length, 0) : null;
  return (
    <PageHeader
      flat
      data-slot="signal-hero"
      className={cn("transition-opacity [&>div:first-child]:gap-14", fading && "opacity-40")}
      title={h ? plural(h.devices, "wireless device") : "Signal"}
      status={
        h ? (
          <>
            {weak > 0 ? (
              <Status tone="warning">{plural(weak, "weak connection")}</Status>
            ) : h.devices > 0 ? (
              <Status tone="success">{fair > 0 ? "No weak connections" : "Every connection good"}</Status>
            ) : (
              <Status tone="muted">No wireless devices</Status>
            )}
            {fair > 0 && <span>{formatCount(fair)} fair</span>}
            {weakLinks > 0 && <span>{plural(weakLinks, "weak mesh link")}</span>}
          </>
        ) : null
      }
      facts={
        <div className="grid grid-cols-2 gap-x-10 gap-y-3">
          <Metric label="Median signal" value={h?.medianDbm != null ? <>{dbm(h.medianDbm)}{muted(QUALITY_WORD[signalQuality(h.medianDbm)].toLowerCase())}</> : null} />
          <Metric label="Weakest mesh link" value={h ? weakestLink ? <>{weakestLink.eero}{muted(`${weakestLink.meshBars} of 5 bars`)}</> : "All wired" : null} />
          <Metric label="Busiest radio" value={h?.busiest ? <>{h.busiest.eero}{muted(`${BAND_WORD[h.busiest.band]} · ${formatPercent(h.busiest.utilization)}`)}</> : null} />
          <Metric
            label="Wi-Fi 6 or newer"
            value={known > 0 ? <>{formatPercent((modern / known) * 100)}{couldBe !== null && couldBe > modern ? muted(`could be ${formatPercent((couldBe / known) * 100)}`) : null}</> : null}
          />
        </div>
      }
      aside={
        <div className="flex w-[26rem] flex-col gap-2">
          <div className="min-w-0">
            <h2 className="whitespace-nowrap font-semibold text-base text-foreground leading-7">Signal by eero</h2>
            <p className="truncate text-muted-foreground text-xs">A line per device in its band's colour, the tall line the median</p>
          </div>
          <SignalStrips health={h} names={names} />
        </div>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Worth a look

const TONE_DOT: Record<SignalAdvice["tone"], "destructive" | "warning" | "info"> = { destructive: "destructive", warning: "warning", info: "info" };
const SHOWN_DEVICES = 4;

function AdviceSection({ advice, loading }: { advice: SignalAdvice[] | undefined; loading: boolean }) {
  const placement = usePlacementTest();
  const description = !advice ? "-" : advice.length === 0 ? "Nothing to fix right now" : `${plural(advice.length, "thing")} that would help, most useful first`;
  return (
    <Section title="Worth a look" description={description} className="gap-[15px]">
      {advice && advice.length === 0 ? (
        <Card>
          <Empty>Nothing to fix right now.</Empty>
        </Card>
      ) : (
        <div className={cn("grid gap-3.5 transition-opacity md:grid-cols-2", loading && "opacity-40")} data-advice>
          {(advice ?? []).map((a) => (
            <Card key={`${a.kind}-${a.title}`} padded className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2 font-medium text-sm">
                <StatusDot tone={TONE_DOT[a.tone]} />
                {a.title}
              </div>
              <p className="text-muted-foreground text-xs leading-normal">{a.detail}</p>
              <div className="mt-1.5 flex items-center justify-between gap-3">
                <p className="min-w-0 text-muted-foreground text-xs">
                  {a.devices.length > 0
                    ? a.devices.slice(0, SHOWN_DEVICES).map((d, i) => (
                        <span key={d.deviceId}>
                          {i > 0 && ", "}
                          <DeviceLink id={d.deviceId} name={d.name} />
                        </span>
                      ))
                    : a.eeros.map((e, i) => (
                        <span key={e.eeroId}>
                          {i > 0 && ", "}
                          <Link to={pathFor("eero", { eeroId: e.eeroId })} className="outline-none transition-colors hover:text-foreground focus-visible:text-foreground">
                            {e.name}
                          </Link>
                        </span>
                      ))}
                  {a.devices.length > SHOWN_DEVICES && ` and ${a.devices.length - SHOWN_DEVICES} more`}
                </p>
                {a.kind === "weak_mesh_link" && a.eeroId && (
                  <span className="shrink-0">
                    {placement.testing === a.eeroId ? (
                      <span className="text-muted-foreground text-xs">Testing...</span>
                    ) : placement.results[a.eeroId] ? (
                      <PlacementRating result={placement.results[a.eeroId] as NonNullable<(typeof placement.results)[string]>} />
                    ) : (
                      <GatedButton gate={placement.gate} size="xs" variant="outline" onClick={() => void placement.test(a.eeroId as string)}>
                        Test placement
                      </GatedButton>
                    )}
                  </span>
                )}
              </div>
            </Card>
          ))}
          {!advice &&
            Array.from({ length: 2 }, (_, i) => (
              <Card key={i} padded className="h-28">
                <span />
              </Card>
            ))}
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Mesh map, Coverage scan

/** A line sample for the legend: wired solid, Wi-Fi dashed. */
function LineKey({ dashed = false }: { dashed?: boolean }) {
  return (
    <svg aria-hidden width="20" height="6">
      <line x1="0" y1="3" x2="20" y2="3" className="stroke-muted-foreground" strokeWidth="2" strokeDasharray={dashed ? "4 3" : undefined} />
    </svg>
  );
}

function MeshSection({ health: h, eeros, colors, loading }: { health: WifiHealth | undefined; eeros: Eero[] | undefined; colors: Record<string, string>; loading: boolean }) {
  const coverage = useQuery<CoverageScan>("coverage.scan");
  const rescan = useCommand<{ refresh: boolean }, CoverageScan>("coverage.scan");
  const placement = usePlacementTest();
  const now = useNow();
  const hasCoverage = !unsupported(coverage) && !unsupported(rescan);
  const scan = rescan.result ?? coverage.data;
  const scanning = rescan.running || (coverage.loading && !scan);
  const mesh = h?.mesh ?? [];
  const overWifi = mesh.filter((n) => n.backhaul === "wireless").length;
  const weak = mesh.filter((n) => n.meshQuality === "weak" || n.meshQuality === "poor").length;
  const description = !h ? "-" : [plural(mesh.length, "eero"), overWifi > 0 && `${formatCount(overWifi)} over Wi-Fi`, weak > 0 && plural(weak, "weak link")].filter(Boolean).join(", ");
  const scanDescription = !hasCoverage
    ? "Not available on this network"
    : scanning
      ? "Scanning..."
      : scan?.scannedAt
        ? `Scanned ${formatRelative(scan.scannedAt, now)}`
        : "Not scanned yet";
  return (
    // The map and the list side by side as two sections, each titled, as Signal and speed beside Weakest connections.
    <div className={cn("grid items-start gap-x-5 gap-y-14 transition-opacity lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]", loading && "opacity-40")}>
      <Section title="Mesh map" description={description} className="gap-[15px]">
        <MeshMap health={h} eeros={eeros} colors={colors} />
      </Section>
      <Section
        title="Coverage scan"
        description={scanDescription}
        className="gap-[15px]"
        tools={
          hasCoverage ? (
            <Button variant="outline" disabled={scanning} onClick={() => void rescan.run({ refresh: true })}>
              <RefreshCw className={cn(scanning && "animate-spin motion-reduce:animate-none")} />
              {scanning ? "Scanning..." : scan?.rooms.length ? "Scan again" : "Scan now"}
            </Button>
          ) : null
        }
      >
        <div className="flex flex-col gap-3">
          <Card className="flex flex-col" data-coverage>
            {rescan.error && <div className="border-b px-4 py-2 text-destructive-foreground text-xs">Couldn't scan again: {rescan.error.message}</div>}
            {hasCoverage && scan?.advice.length ? (
              <div className="border-border/60 border-b px-4 py-3 text-xs">
                {scan.advice.map((a) => (
                  <p key={a}>{a}</p>
                ))}
              </div>
            ) : null}
            <div className="divide-y divide-border/50">
              {mesh.map((n) => {
                const room = scan?.rooms.find((r) => r.eeroId === n.eeroId);
                const eero = eeros?.find((e) => e.id === n.eeroId);
                const up = n.upstream ? mesh.find((m) => m.eeroId === n.upstream)?.eero : null;
                const how = n.isGateway ? "Gateway" : n.backhaul === "wired" ? `Wired to ${up ?? "the mesh"}` : `Wi-Fi to ${up ?? "the mesh"}`;
                return (
                  <div key={n.eeroId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 px-4 py-2.5 transition-colors hover:bg-muted/50">
                    <span className="flex min-w-0 items-center gap-2 font-medium text-[13px]">
                      <Square round color={colors[n.eeroId] ?? "currentColor"} />
                      <Link to={pathFor("eero", { eeroId: n.eeroId })} className="truncate outline-none hover:underline focus-visible:underline">
                        {n.eero}
                      </Link>
                    </span>
                    <span className="text-right text-xs tabular-nums">
                      {plural(n.devices, "device")}
                      {n.weak > 0 && <span className="text-destructive-foreground"> · {formatCount(n.weak)} weak</span>}
                    </span>
                    <span className="truncate text-muted-foreground text-xs">
                      {n.model ?? MISSING} · {how}
                    </span>
                    <span className="flex items-center justify-end gap-2.5">
                      {/* Test (or its rating) before the cells, so the cells end at the same edge on every row. */}
                      {hasCoverage && <PlacementCell eero={eero} result={placement.results[n.eeroId]} testing={placement.testing === n.eeroId} onTest={() => void placement.test(n.eeroId)} gate={placement.gate} />}
                      {hasCoverage && room && <QualityCells quality={room.quality} />}
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>
          {/* One legend for both sides: device dots, coverage cells and placement ratings share the quality colours. */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 px-1 text-muted-foreground text-xs">
            {QUALITIES.map((q) => (
              <span key={q} className="inline-flex items-center gap-1.5">
                <Square round color={dotColor(q)} />
                {QUALITY_WORD[q]}
                {hasCoverage && q === "excellent" && " or strong"}
                {hasCoverage && q === "weak" && " or poor"}
              </span>
            ))}
            {/* Link styles on their own line, after the strength colours. */}
            <span aria-hidden className="basis-full" />
            <span className="inline-flex items-center gap-1.5">
              <LineKey />
              Wired
            </span>
            <span className="inline-flex items-center gap-1.5">
              <LineKey dashed />
              Wi-Fi link
            </span>
          </div>
        </div>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Signal and speed, Weakest connections

const WEAKEST_ROWS = 6;

function SpeedSection({ health: h, names, loading }: { health: WifiHealth | undefined; names: Map<string, string>; loading: boolean }) {
  const devices = useQuery<DeviceList>("device.list", undefined, { poll: true });
  const byId = new Map((devices.data?.devices ?? []).map((d) => [d.id, d]));
  const weak = h?.quality.weak ?? 0;
  const description = !h ? "-" : h.devices === 0 ? "No wireless devices" : [`Median ${dbm(h.medianDbm)}`, weak > 0 && `${formatCount(weak)} weak`].filter(Boolean).join(", ");
  const weakest = (h?.points ?? []).slice(0, WEAKEST_ROWS);
  return (
    <div className="grid items-start gap-x-5 gap-y-14 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Section title="Signal and speed" description={description} className="gap-[15px]">
        <Card className="flex flex-col">
          <div className={cn("grid border-border/60 border-b transition-opacity", loading && "opacity-40")} style={{ gridTemplateColumns: `repeat(${Math.max(1, h?.bands.length ?? 3)}, minmax(0, 1fr))` }}>
            {(h?.bands ?? []).map((b, i) => (
              <div key={b.band} className={cn("flex flex-col gap-0.5 px-4 py-2.5", i > 0 && "border-border/60 border-l")}>
                <span className="flex items-center gap-1.5 text-muted-foreground text-xs">
                  <Square color={bandColor(b.band)} />
                  {BAND_WORD[b.band]} · {plural(b.devices, "device")}
                </span>
                <span className="truncate font-medium text-sm tabular-nums" title="Median signal and link speed">
                  {dbm(b.medianDbm)}
                  <span className="font-normal text-muted-foreground text-xs"> · {formatMbps(b.medianMbps)}</span>
                </span>
                {b.devices > 0 ? (
                  <ShareBar hideLegend format={(v) => plural(v, "device")} segments={QUALITIES.map((q) => ({ label: QUALITY_WORD[q], value: b.quality[q], color: signalQualityColors[q] }))} className="mt-1.5" />
                ) : (
                  <span className="mt-1 text-3xs text-muted-foreground">No devices on this band</span>
                )}
              </div>
            ))}
          </div>
          <div className="px-4 pt-3 pb-2">
            <SignalScatter health={h} names={names} loading={loading} />
          </div>
        </Card>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-xs">
          {QUALITIES.map((q) => (
            <span key={q} className="inline-flex items-center gap-1.5">
              <Square round color={signalQualityColors[q]} />
              {QUALITY_LEGEND[q]}
            </span>
          ))}
        </div>
      </Section>
      <Section title="Weakest connections" description={!h ? "-" : h.points.length ? `The ${formatCount(weakest.length)} weakest of ${formatCount(h.points.length)}` : "No wireless devices"} className="gap-[15px]">
        <Card className={cn("divide-y divide-border/50 transition-opacity", loading && "opacity-40")}>
          {weakest.map((p) => {
            const Icon = deviceIcon(byId.get(p.deviceId));
            return (
              <div key={p.deviceId} className="grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-x-2.5 px-4 py-2 transition-colors hover:bg-muted/50">
                <Square round color={dotColor(p.quality)} />
                <Icon aria-hidden className="size-4 text-muted-foreground" />
                <span className="min-w-0">
                  <Link to={pathFor("device", { deviceId: p.deviceId })} className="block truncate font-medium text-[13px] outline-none hover:underline focus-visible:underline">
                    {p.name}
                  </Link>
                  <span className="block truncate text-muted-foreground text-xs">
                    {[p.eeroId && names.get(p.eeroId), BAND_WORD[p.band]].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="inline-flex items-center gap-2 whitespace-nowrap text-[13px] tabular-nums">
                  {dbm(p.dbm)}
                  <SignalBars bars={p.bars ?? 0} />
                </span>
              </div>
            );
          })}
          {h && h.points.length === 0 && <Empty>No wireless devices.</Empty>}
          {!h && <div className="h-72" />}
        </Card>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Airwaves

function AirwavesSection({ health: h, colors, loading }: { health: WifiHealth | undefined; colors: Record<string, string>; loading: boolean }) {
  const busiest = h?.busiest;
  const description = !h
    ? "-"
    : busiest
      ? `Busiest: ${busiest.eero} ${BAND_WORD[busiest.band]} at ${formatPercent(busiest.utilization)}${(busiest.utilization ?? 0) < ADVICE.busyPct ? ", plenty of room" : ""}`
      : "No eero reports how busy its channels are";
  return (
    <Section title="Airwaves" description={description} className="gap-[15px] lg:row-span-3 lg:grid lg:grid-rows-subgrid">
      <Card padded>
        {/* The eero legend inside the card, top right, so the subtitle keeps the header's width. */}
        <div className="mb-2 flex flex-wrap justify-end gap-x-4 gap-y-1 text-muted-foreground text-xs">
          {(h?.mesh ?? []).map((n) => (
            <span key={n.eeroId} className="inline-flex items-center gap-1.5">
              <Square color={colors[n.eeroId] ?? "currentColor"} />
              {n.eero}
            </span>
          ))}
        </div>
        <Airwaves health={h} colors={colors} loading={loading} />
      </Card>
      <Footnote>
        Width is the channel, height is how busy it is. eeros often share a channel by design; it only matters past {ADVICE.busyPct}% busy.
      </Footnote>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Devices per radio, Resent packets

function LoadSection({ health: h, loading }: { health: WifiHealth | undefined; loading: boolean }) {
  const bands = (h?.bands ?? []).map((b) => b.band);
  const cells = h?.load ?? [];
  const max = Math.max(1, ...cells.map((c) => c.devices));
  const top = [...cells].sort((a, b) => b.devices - a.devices)[0];
  const description = !h ? "-" : top && top.devices > 0 ? `Most: ${h.mesh.find((n) => n.eeroId === top.eeroId)?.eero ?? MISSING} ${BAND_WORD[top.band]}, ${plural(top.devices, "device")}` : "No wireless devices";
  return (
    <Section title="Devices per radio" description={description} className="gap-[15px] self-start">
      <Card className={cn("transition-opacity", loading && "opacity-40")}>
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b text-left text-muted-foreground text-xs">
              <th className={cn(TH, "w-full")}>eero</th>
              {bands.map((b) => (
                <th key={b} className={cn(TH, "text-center")}>
                  {BAND_WORD[b]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(h?.mesh ?? []).map((n) => (
              <tr key={n.eeroId} className="border-border/50 border-b transition-colors last:border-b-0 hover:bg-muted/50">
                <td className={cn(TD, "whitespace-nowrap font-medium")}>{n.eero}</td>
                {bands.map((b) => {
                  const c = cells.find((x) => x.eeroId === n.eeroId && x.band === b);
                  if (!c?.radio)
                    return (
                      <td key={b} className="px-2 py-1.5 text-center text-muted-foreground text-xs" title={`${n.eero} has no ${BAND_WORD[b]} radio`}>
                        {MISSING}
                      </td>
                    );
                  return (
                    <td key={b} className="px-2 py-1.5 text-center">
                      <span
                        className="inline-flex min-w-24 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-xs tabular-nums"
                        style={{ background: c.devices ? `color-mix(in srgb, ${bandColor(b)} ${Math.round(8 + (c.devices / max) * 46)}%, transparent)` : undefined }}
                        title={`${n.eero} ${BAND_WORD[b]}: ${plural(c.devices, "device")}${c.medianDbm === null ? "" : `, median ${c.medianDbm} dBm (${QUALITY_WORD[signalQuality(c.medianDbm)].toLowerCase()})`}`}
                      >
                        {formatCount(c.devices)}
                        {c.medianDbm !== null && <Square round color={dotColor(signalQuality(c.medianDbm))} />}
                        <span className="text-muted-foreground">{c.medianDbm === null ? MISSING : `${c.medianDbm} dBm`}</span>
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Footnote>
        Darker cells carry more devices. Best is devices spread across eeros with a good signal; one radio carrying most, or a fair or weak signal, is worth a look.
      </Footnote>
    </Section>
  );
}

function RetriesSection({ health: h, names, loading }: { health: WifiHealth | undefined; names: Map<string, string>; loading: boolean }) {
  const noisy = h?.advice.find((a) => a.kind === "noisy_link")?.devices ?? [];
  const flagged = new Set(noisy.map((d) => d.deviceId));
  const reported = (h?.points ?? []).some((p) => p.retryPct !== null);
  const empty = Boolean(h) && !reported;
  const description = !h ? "-" : !reported ? "No device reports it" : noisy.length ? `${plural(noisy.length, "device")} ${noisy.length === 1 ? "resends" : "resend"} a lot` : "No device resends much";
  return (
    // Without data the watermark card matches the panel beside it; with data it takes the height it needs.
    <Section title="Resent packets" description={description} className={cn("gap-[15px]", !empty && "self-start")}>
      {empty ? (
        <Card className="grid min-h-40 flex-1 place-items-center">
          <div aria-hidden className="flex items-center gap-3">
            <Repeat className="size-12 text-watermark" strokeWidth={1.6} />
            <span className="whitespace-nowrap font-semibold text-foreground/13 text-xl">No reports</span>
          </div>
        </Card>
      ) : (
        <>
          <Card padded>
            <RetryScatter health={h} names={names} flagged={flagged} loading={loading} />
          </Card>
          <Footnote>
            The share of each device's packets that had to be sent again, against its signal. Wi-Fi resends a packet that does not arrive; a few percent is normal. Above {ADVICE.noisyRetryPct}% with a decent signal points at interference near the device (a microwave, a
            crowded channel) rather than distance.
          </Footnote>
        </>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Signal history

function HistorySection({ history, loading }: { history: SignalHistory | undefined; loading: boolean }) {
  const minutes = history?.from && history.to ? Math.round((Date.parse(history.to) - Date.parse(history.from)) / 60_000) : 0;
  const dropped = (history?.devices ?? []).filter((d) => d.drops > 0).length;
  const description = !history ? "-" : history.samples < 2 ? "Recording" : [`Last ${minutes} minutes`, dropped > 0 ? `${plural(dropped, "device")} dropped off` : "no drops"].join(", ");
  return (
    <Section title="Signal history" description={description} className="gap-[15px] lg:row-span-3 lg:grid lg:grid-rows-subgrid">
      {/* On wide screens the list sits out of flow, so the row's height comes from Airwaves and the list scrolls inside it. */}
      <Card className="relative">
        <div className="px-4 py-2 lg:absolute lg:inset-0">
          <HistoryLines history={history} loading={loading} />
        </div>
      </Card>
      <Footnote>
        The dashed line is {SIGNAL_DBM.fair} dBm, below which a signal is weak.
      </Footnote>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Wi-Fi generations, What holds them back

const REASON: Record<HeldBackReason, { title: string; hint: string }> = {
  weak_signal: { title: "Weak signal", hint: "A stronger signal lets them link with something newer." },
  on_24: { title: "On 2.4 GHz", hint: "Joining the network again usually moves them to 5 GHz." },
  no_6ghz_radio: { title: "No 6 GHz radio on their eero", hint: "An eero with 6 GHz in that spot would let them use it." },
  on_5_near_6: { title: "On 5 GHz beside a 6 GHz radio", hint: "Often a setting on the device." },
  other: { title: "Other", hint: "The device picked an older link." },
};

function GenerationsSection({ health: h, insights, loading }: { health: WifiHealth | undefined; insights: WifiInsights | undefined; loading: boolean }) {
  const report = insights?.report === true;
  const held = (insights?.heldBack ?? []).reduce((n, g) => n + g.devices.length, 0);
  const known = h ? h.points.filter((p) => p.generation !== "unknown").length : 0;
  const modern = h ? h.points.filter((p) => generationRank(p.generation) >= generationRank("wifi6")).length : 0;
  const description = !h || !insights ? "-" : report ? (held > 0 ? `${plural(held, "device")} ${held === 1 ? "connects" : "connect"} below what ${held === 1 ? "it supports" : "they support"}` : "Every device uses the best it supports") : known ? `${formatPercent((modern / known) * 100)} connected with Wi-Fi 6 or newer` : "No device says which";
  const [open, setOpen] = useState<HeldBackReason | null>(null);
  if (insights && !report)
    return (
      <Section title="Wi-Fi generations" description={description} className="gap-[15px]">
        <Card padded>
          <ShareBar format={(v) => plural(v, "device")} segments={(h?.generations ?? []).map((g) => ({ label: GENERATION_WORD[g.generation], value: g.devices, color: wifiGenerationColors[g.generation] }))} />
        </Card>
      </Section>
    );
  const reasons = insights?.heldBack ?? [];
  return (
    <div className="grid items-start gap-x-5 gap-y-14 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Section title="Wi-Fi generations" description={description} className="gap-[15px]">
        <Card padded>
          <GenerationFlow insights={insights} loading={loading} />
        </Card>
      </Section>
      <Section title="What holds them back" when="upgradeReport" description={!insights ? "-" : held ? plural(reasons.length, "reason") : "Nothing"} className="gap-[15px]">
        <Card className={cn("divide-y divide-border/50 transition-opacity", loading && "opacity-40")}>
          {insights && held === 0 && <Empty>Every device connects with the best it supports.</Empty>}
          {reasons.map((g) => {
            const shown = open === g.reason ? g.devices : g.devices.slice(0, 3);
            return (
              <div key={g.reason} className="flex flex-col gap-0.5 px-4 py-2.5">
                <span className="flex justify-between gap-3 font-medium text-[13px]">
                  {REASON[g.reason].title}
                  <span className="text-muted-foreground text-xs tabular-nums">{formatCount(g.devices.length)}</span>
                </span>
                <span className="text-muted-foreground text-xs">
                  {shown.map((d, i) => (
                    <span key={d.deviceId}>
                      {i > 0 && ", "}
                      <DeviceLink id={d.deviceId} name={d.name} />
                    </span>
                  ))}
                  {g.devices.length > shown.length && (
                    <>
                      {" "}
                      <button type="button" className="outline-none transition-colors hover:text-foreground focus-visible:text-foreground" onClick={() => setOpen(g.reason)}>
                        and {g.devices.length - shown.length} more
                      </button>
                    </>
                  )}
                </span>
                <span className="text-3xs text-muted-foreground">{REASON[g.reason].hint}</span>
              </div>
            );
          })}
          {!insights && <div className="h-48" />}
        </Card>
      </Section>
    </div>
  );
}
