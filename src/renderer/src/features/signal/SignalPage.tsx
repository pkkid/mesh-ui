/**
 * Signal (docs/ux/pages/signal.md): how well the wireless devices
 * are connected right now. The flat hero (wireless devices, weak connections,
 * median signal, weakest device, busiest radio, Wi-Fi 6 or newer, with the
 * signal spread on the right), then Signal quality per band, Weakest
 * connections, Coverage, Wi-Fi generations beside the Upgrade report, Link
 * speed, and Radios.
 *
 * Most figures come from `wifi.health`, which core works out from the device
 * and eero lists the app already reads (no requests of its own, no history:
 * eero keeps utilisation history for eero Plus only). Coverage and the
 * Upgrade report are eero's own `/2.4/` scans (Coverage.tsx), moved here from
 * Troubleshooting.
 */
import type { ReactNode } from "react";

import { Link, pathFor } from "~/app/router";
import type { PageProps } from "~/app/routes";
import { useQuery } from "~/app/useCommand";
import { BarChart } from "~/components/charts/BarChart";
import { ShareBar } from "~/components/charts/ShareBar";
import { BandBadge, bandLabel } from "~/components/ui/band-badge";
import { Card, Empty, Section } from "~/components/ui/card";
import { Metric, PageHeader } from "~/components/ui/hero";
import { Footnote, SectionError } from "~/components/ui/page";
import { Status } from "~/components/ui/status";
import { SignalBars } from "~/features/devices/DeviceTable";
import { useTopBarUpdated } from "~/features/shell/TopBar";
import { bandColor, signalQualityColors, wifiGenerationColors } from "~/lib/chartColors";
import { cn } from "~/lib/utils";
import { HISTOGRAM, SIGNAL_DBM, signalQuality } from "../../../../core/commands/wifi";
import { formatCount, formatMbps, formatPercent, MISSING } from "../../../../core/format";
import type { Eero, SignalQuality, WifiGeneration, WifiHealth } from "../../../../core/model";
import { CoverageSection, UpgradeSection } from "./Coverage";

const QUALITIES: SignalQuality[] = ["excellent", "good", "fair", "weak"];

const QUALITY_LABEL: Record<SignalQuality, string> = {
  excellent: `Excellent (${SIGNAL_DBM.excellent} dBm or better)`,
  good: "Good",
  fair: "Fair",
  weak: `Weak (below ${SIGNAL_DBM.fair} dBm)`,
};

const SHORT_QUALITY: Record<SignalQuality, string> = { excellent: "Excellent", good: "Good", fair: "Fair", weak: "Weak" };

const GENERATION_LABEL: Record<WifiGeneration, string> = {
  wifi7: "Wi-Fi 7",
  wifi6e: "Wi-Fi 6E",
  wifi6: "Wi-Fi 6",
  wifi5: "Wi-Fi 5",
  wifi4: "Wi-Fi 4",
  unknown: "Unknown",
};

const plural = (n: number, one: string, many = `${one}s`) => `${formatCount(n)} ${n === 1 ? one : many}`;
const dbm = (v: number | null | undefined) => (v === null || v === undefined ? MISSING : `${v} dBm`);
const muted = (text: string) => <span className="font-normal text-muted-foreground text-xs"> · {text}</span>;

export function SignalPage(_props: PageProps) {
  const health = useQuery<WifiHealth>("wifi.health", undefined, { poll: true });
  // Names, models and status for the coverage table and the upgrade report's eeros (cached: wifi.health reads it too).
  const eeros = useQuery<Eero[]>("eero.list");
  useTopBarUpdated(health.fetchedAt);
  const h = health.data;
  const fade = cn("transition-opacity", health.fading && "opacity-40");

  return (
    <>
      <HealthHero health={h} fading={health.fading && !h} />
      {health.error && !h ? (
        <SectionError what="Signal" error={health.error} onRetry={() => void health.refetch()} />
      ) : (
        <div className="flex flex-col gap-14">
          <SignalQualitySection health={h} className={fade} />
          <WeakestSection health={h} className={fade} />
          <CoverageSection eeros={eeros.data} />
          {/* What devices use now beside what they could use: the two read together. */}
          <div className="grid gap-x-7 gap-y-14 lg:grid-cols-2">
            <GenerationsSection health={h} className={fade} />
            <UpgradeSection eeros={eeros.data} />
          </div>
          <LinkSpeedSection health={h} className={fade} />
          <RadiosSection health={h} className={fade} />
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Hero

/**
 * The flat page header: the wireless device count, whether any connection is
 * weak, the median signal, the weakest device, the busiest radio and the share
 * on Wi-Fi 6 or newer, with the signal spread chart on the right.
 */
function HealthHero({ health: h, fading }: { health: WifiHealth | undefined; fading: boolean }) {
  const weak = h?.quality.weak ?? 0;
  const fair = h?.quality.fair ?? 0;
  const worst = h?.weakest[0];
  const modern = h ? h.generations.filter((g) => g.generation === "wifi7" || g.generation === "wifi6e" || g.generation === "wifi6").reduce((n, g) => n + g.devices, 0) : 0;
  return (
    <PageHeader
      flat
      data-slot="signal-hero"
      // 56px between the facts and the signal spread, as Devices and Profiles do beside their charts.
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
          </>
        ) : null
      }
      facts={
        <>
          <Metric label="Median signal" value={h?.medianDbm != null ? <>{dbm(h.medianDbm)}{muted(SHORT_QUALITY[signalQuality(h.medianDbm)].toLowerCase())}</> : null} />
          <Metric label="Weakest device" value={worst ? <>{worst.name}{muted(dbm(worst.dbm))}</> : null} />
          <Metric label="Busiest radio" value={h?.busiest ? <>{h.busiest.eero}{muted(`${bandLabel(h.busiest.band)} · ${formatPercent(h.busiest.utilization)}`)}</> : null} />
          <Metric label="Wi-Fi 6 or newer" value={h && h.devices > 0 ? formatPercent((modern / h.devices) * 100) : null} />
        </>
      }
      aside={<SignalSpread health={h} />}
    />
  );
}

/** The hero's right-hand column: devices per 5 dBm, each bar in its quality's colour, bare like Activity's chart. */
function SignalSpread({ health: h }: { health: WifiHealth | undefined }) {
  const buckets = h?.histogram ?? [];
  const label = (d: number, i: number) => (i === 0 ? `${HISTOGRAM.from + HISTOGRAM.step} dBm or weaker` : i === buckets.length - 1 ? `${d} dBm or stronger` : `${d} to ${d + HISTOGRAM.step} dBm`);
  return (
    <div data-slot="signal-spread" className="flex w-[28rem] flex-col gap-2">
      <div className="min-w-0">
        <h2 className="whitespace-nowrap font-semibold text-base text-foreground leading-7">Signal spread</h2>
        <p className="truncate text-muted-foreground text-xs">{h ? `Devices per ${HISTOGRAM.step} dBm, median ${dbm(h.medianDbm)}` : "-"}</p>
      </div>
      <BarChart
        className="mt-1"
        heightClassName="h-28"
        hideYLabels
        hideGrid
        zeroStubs
        // One series per quality, each holding only its own buckets, so every bar takes its bucket's colour.
        series={QUALITIES.map((q) => ({
          id: q,
          label: SHORT_QUALITY[q],
          color: signalQualityColors[q],
          values: buckets.map((b) => (signalQuality(b.dbm) === q ? b.devices : 0)),
        }))}
        labels={buckets.map((b) => `${b.dbm} dBm`)}
        tooltipLabels={buckets.map((b, i) => label(b.dbm, i))}
        format={(v) => formatCount(Math.round(v))}
        total={false}
        ariaLabel={h ? `Wireless devices per ${HISTOGRAM.step} dBm of signal, median ${dbm(h.medianDbm)}` : "Signal spread"}
        loading={!h}
        emptyText="No wireless devices."
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sections

type SectionArgs = { health: WifiHealth | undefined; className: string };

function Square({ color }: { color: string }) {
  return <span aria-hidden className="inline-block size-2 shrink-0 rounded-[2px]" style={{ background: color }} />;
}

/** Signal quality: per band a share bar of devices by quality and the band's median, with one legend under the card. */
function SignalQualitySection({ health: h, className }: SectionArgs) {
  const weak = h?.quality.weak ?? 0;
  const description = !h ? "-" : h.devices === 0 ? "No wireless devices" : [`Median ${dbm(h.medianDbm)}`, weak > 0 && `${plural(weak, "device")} weak`].filter(Boolean).join(", ");
  return (
    <Section title="Signal quality" description={description} className="gap-[15px]">
      <Card className={cn("divide-y divide-border/50", className)}>
        {(h?.bands ?? []).map((b) => (
          <div key={b.band} className="grid grid-cols-[6rem_minmax(0,1fr)_9rem] items-center gap-4 px-4 py-3">
            <span className="flex items-center gap-2 font-medium text-sm">
              <Square color={bandColor(b.band)} />
              {bandLabel(b.band)}
            </span>
            {b.devices > 0 ? (
              <ShareBar hideLegend format={(v) => plural(v, "device")} segments={QUALITIES.map((q) => ({ label: SHORT_QUALITY[q], value: b.quality[q], color: signalQualityColors[q] }))} />
            ) : (
              <span className="text-muted-foreground text-xs">No devices on this band</span>
            )}
            <span className="text-right text-muted-foreground text-xs tabular-nums">
              median <b className="font-medium text-foreground">{dbm(b.medianDbm)}</b>
            </span>
          </div>
        ))}
        {h && h.bands.length === 0 && <Empty>No wireless devices.</Empty>}
      </Card>
      <div className={cn("flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-xs", className)}>
        {QUALITIES.map((q) => (
          <span key={q} className="inline-flex items-center gap-1.5">
            <Square color={signalQualityColors[q]} />
            {QUALITY_LABEL[q]}
            <b className="font-medium text-foreground tabular-nums">{formatCount(h?.quality[q] ?? 0)}</b>
          </span>
        ))}
      </div>
    </Section>
  );
}

const TH = "px-4 py-2 font-normal";
const TD = "px-4 py-2.5";

/** Weakest connections: the five weakest devices, linked to their pages. */
function WeakestSection({ health: h, className }: SectionArgs) {
  const weak = (h?.weakest ?? []).filter((w) => signalQuality(w.dbm) === "weak");
  // The eero most weak devices are on, for the subtitle.
  const byEero = new Map<string, number>();
  for (const w of weak) if (w.eero) byEero.set(w.eero, (byEero.get(w.eero) ?? 0) + 1);
  const most = [...byEero.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const description = !h ? "-" : weak.length === 0 ? `None below ${SIGNAL_DBM.fair} dBm` : [`${plural(h.quality.weak, "device")} below ${SIGNAL_DBM.fair} dBm`, most && `most on ${most}`].filter(Boolean).join(", ");
  return (
    <Section title="Weakest connections" description={description} className="gap-[15px]">
      <Card className={className}>
        {h && h.weakest.length === 0 ? (
          <Empty>No wireless devices.</Empty>
        ) : (
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b text-left text-muted-foreground text-xs">
                <th className={cn(TH, "w-full")}>Device</th>
                <th className={TH}>Band</th>
                <th className={TH}>eero</th>
                <th className={cn(TH, "text-right")}>Signal</th>
              </tr>
            </thead>
            <tbody>
              {(h?.weakest ?? []).map((w) => (
                <tr key={w.deviceId} className="border-border/50 border-b transition-colors last:border-b-0 hover:bg-muted/50">
                  <td className={TD}>
                    <Link to={pathFor("device", { deviceId: w.deviceId })} className="font-medium outline-none hover:underline focus-visible:underline">
                      {w.name}
                    </Link>
                  </td>
                  <td className={TD}>
                    <BandBadge band={w.band} />
                  </td>
                  <td className={cn(TD, "whitespace-nowrap")}>{w.eero ?? MISSING}</td>
                  <td className={cn(TD, "whitespace-nowrap text-right tabular-nums")}>
                    <span className="inline-flex items-center gap-2">
                      {dbm(w.dbm)}
                      <SignalBars bars={w.bars ?? 0} />
                    </span>
                  </td>
                </tr>
              ))}
              {!h &&
                Array.from({ length: 5 }, (_, i) => (
                  <tr key={i} className="border-border/50 border-b last:border-b-0">
                    <td className="h-[45px]" colSpan={4} />
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </Card>
    </Section>
  );
}

/** Wi-Fi generations: a share bar of devices by the Wi-Fi standard they are connected with now, with its legend. */
function GenerationsSection({ health: h, className }: SectionArgs) {
  const known = (h?.generations ?? []).filter((g) => g.generation !== "unknown").reduce((n, g) => n + g.devices, 0);
  const modern = (h?.generations ?? []).filter((g) => g.generation === "wifi7" || g.generation === "wifi6e" || g.generation === "wifi6").reduce((n, g) => n + g.devices, 0);
  const description = !h ? "-" : known === 0 ? "No device says which" : `${formatPercent((modern / known) * 100)} connected with Wi-Fi 6 or newer`;
  return (
    <Section title="Wi-Fi generations" description={description} className="gap-[15px]">
      <Card padded className={cn("flex-1", className)}>
        <ShareBar
          format={(v) => plural(v, "device")}
          segments={(h?.generations ?? []).map((g) => ({ label: GENERATION_LABEL[g.generation], value: g.devices, color: wifiGenerationColors[g.generation] }))}
        />
      </Card>
    </Section>
  );
}

/** Link speed: each band's median and best link speed (eero to device). */
function LinkSpeedSection({ health: h, className }: SectionArgs) {
  const best = [...(h?.bands ?? [])].filter((b) => b.bestMbps !== null).sort((a, b) => (b.bestMbps ?? 0) - (a.bestMbps ?? 0))[0];
  const description = !h ? "-" : best ? `Best ${formatMbps(best.bestMbps)}, on ${bandLabel(best.band)}` : "No link speeds reported";
  return (
    <Section title="Link speed" description={description} className="gap-[15px]">
      <Card className={cn("flex-1", className)}>
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b text-left text-muted-foreground text-xs">
              <th className={cn(TH, "w-full")}>Band</th>
              <th className={cn(TH, "text-right")}>Median</th>
              <th className={cn(TH, "text-right")}>Best</th>
            </tr>
          </thead>
          <tbody>
            {(h?.bands ?? []).map((b) => (
              <tr key={b.band} className="border-border/50 border-b last:border-b-0">
                <td className={TD}>
                  <span className="flex items-center gap-2">
                    <Square color={bandColor(b.band)} />
                    {bandLabel(b.band)}
                  </span>
                </td>
                <td className={cn(TD, "whitespace-nowrap text-right tabular-nums")}>{formatMbps(b.medianMbps)}</td>
                <td className={cn(TD, "whitespace-nowrap text-right text-muted-foreground tabular-nums")}>{formatMbps(b.bestMbps)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </Section>
  );
}

/**
 * Radios: each eero's radios by band, how busy each channel is right now
 * (eero's channel utilisation), the channel and its width, and the eero's
 * devices. The cell is tinted in the band's colour in proportion to the
 * utilisation, a heatmap. 5 GHz low and high radios stack in one cell.
 */
function RadiosSection({ health: h, className }: SectionArgs) {
  const bands = (h?.bands ?? []).map((b) => b.band);
  const description = !h ? "-" : h.busiest ? `Busiest: ${h.busiest.eero} ${bandLabel(h.busiest.band)} at ${formatPercent(h.busiest.utilization)}` : "No eero reports channel utilisation";
  const cell = (row: WifiHealth["radios"][number], band: (typeof bands)[number]): ReactNode => {
    const rs = row.bands.filter((x) => x.band === band);
    if (!rs.length) return <span className="block py-1.5 text-muted-foreground text-xs" title={`${row.eero} has no ${bandLabel(band)} radio`}>{MISSING}</span>;
    return (
      <span className="flex flex-col gap-1">
        {rs.map((r, i) => {
          const u = r.utilization;
          return (
            <span
              key={i}
              className="flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1.5 text-xs tabular-nums"
              title={`${row.eero} ${bandLabel(band)}: ${u === null ? "utilisation not reported" : `${formatPercent(u)} busy`}, channel ${r.channel ?? MISSING}${r.widthMhz ? ` at ${r.widthMhz} MHz` : ""}${r.devices !== null ? `, ${plural(r.devices, "device")}` : ""}${r.txPowerDbm !== null ? `, ${r.txPowerDbm} dBm transmit power` : ""}`}
              style={u === null ? undefined : { background: `color-mix(in srgb, ${bandColor(band)} ${Math.max(6, Math.min(60, u))}%, transparent)` }}
            >
              {u === null ? MISSING : formatPercent(u)}
              <span className="text-muted-foreground">
                ch {r.channel ?? MISSING}
                {r.widthMhz ? ` · ${r.widthMhz} MHz` : ""}
              </span>
            </span>
          );
        })}
      </span>
    );
  };
  return (
    <Section title="Radios" description={description} className="gap-[15px]">
      <Card className={cn("overflow-x-auto", className)} data-radios>
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b text-left text-muted-foreground text-xs">
              <th className={cn(TH, "w-full")}>eero</th>
              {bands.map((b) => (
                <th key={b} className={cn(TH, "min-w-40 text-center")}>
                  {bandLabel(b)}
                </th>
              ))}
              <th className={cn(TH, "text-right")}>Devices</th>
            </tr>
          </thead>
          <tbody>
            {(h?.radios ?? []).map((row) => (
              <tr key={row.eeroId} className="border-border/50 border-b last:border-b-0">
                <td className={cn(TD, "align-top")}>
                  <div className="font-medium">{row.eero}</div>
                  <div className="text-muted-foreground text-xs">{row.model ?? MISSING}</div>
                </td>
                {bands.map((b) => (
                  <td key={b} className="px-2 py-1.5 text-center align-top">
                    {cell(row, b)}
                  </td>
                ))}
                <td className={cn(TD, "align-top text-right tabular-nums")}>{row.devices === null ? MISSING : formatCount(row.devices)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Footnote>How busy each radio's channel is right now (eero's channel utilisation), refreshed every minute. eero picks the channels itself, and keeps a history only for eero Plus.</Footnote>
    </Section>
  );
}
