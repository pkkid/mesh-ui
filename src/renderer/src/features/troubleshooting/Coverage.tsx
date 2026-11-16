/**
 * Coverage and radios on Troubleshooting:
 * - Coverage scan (`coverage.scan`): link quality per room as 5 cells, the
 *   devices and eero serving it, eero's placement advice, Scan again
 *   (`refresh: true`), and a per-room placement test (`eero.placement.test`).
 * - Upgrade report (`coverage.upgrade_report`): devices by Wi-Fi generation
 *   as a donut with a legend, the eeros that hold devices back, eero's notes.
 * - Radio channels (`eero.list`): channel, width and busy share per band per
 *   eero. eero does not say whether auto channel selection is on
 *   (`Radio.autoChannel` stays null, M5.1 capture), so that column shows `-`.
 * A 404 from the 2.4 API hides the two reports.
 * docs/ux/pages/troubleshooting.md (Coverage scan, Upgrade report, Radio channels).
 */
import { useState } from "react";

import { useCommand, useQuery, type QueryState } from "~/app/useCommand";
import { useWrite } from "~/app/useWrite";
import { Button } from "~/components/ui/button";
import { Card, Empty, Section } from "~/components/ui/card";
import { Meter } from "~/components/ui/meter";
import { GatedButton, SectionError, useGate, useNow } from "~/components/ui/page";
import { Status, type StatusTone } from "~/components/ui/status";
import { Donut, DonutLegendRow } from "~/components/charts/Donut";
import { wifiGenerationColors } from "~/lib/chartColors";
import { cn } from "~/lib/utils";
import { formatCount, formatPercent, formatRelative, MISSING } from "../../../../core/format";
import type { CoverageScan, Eero, PlacementResult, Radio, UpgradeReport } from "../../../../core/model";

type Rating = NonNullable<PlacementResult["rating"]>;

const RATING: Record<Rating, { label: string; tone: StatusTone; fill: string }> = {
  poor: { label: "Poor", tone: "destructive", fill: "bg-destructive" },
  fair: { label: "Fair", tone: "warning", fill: "bg-warning" },
  good: { label: "Good", tone: "success", fill: "bg-success" },
  strong: { label: "Strong", tone: "success", fill: "bg-success" },
};

/** 0 to 100 to 1 to 5 cells and a rating word. */
const cellsOf = (q: number) => Math.max(1, Math.min(5, Math.ceil(q / 20)));
const ratingOf = (q: number): Rating => (q >= 80 ? "strong" : q >= 60 ? "good" : q >= 40 ? "fair" : "poor");

/** The 2.4 API is missing on this network: hide the report. */
const unsupported = (q: Pick<QueryState<unknown>, "error">) => q.error?.code === "eero_error" && q.error.detail?.status === 404;

function QualityCells({ quality }: { quality: number | null }) {
  if (quality === null) return <span className="text-muted-foreground">{MISSING}</span>;
  const n = cellsOf(quality);
  const fill = RATING[ratingOf(quality)].fill;
  return (
    <span className="inline-flex gap-0.5" role="img" aria-label={`Link quality ${n} of 5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className={cn("h-3 w-2 rounded-[2px]", i < n ? fill : "bg-muted")} />
      ))}
    </span>
  );
}

/** A placement rating as a status dot and word, eero's advice as its tooltip. Shared with the eeros page's weak-link note. */
export function PlacementRating({ result }: { result: PlacementResult }) {
  const r = result.rating ? RATING[result.rating] : null;
  return (
    <span title={result.advice ?? undefined}>
      <Status tone={r?.tone ?? "muted"}>{r?.label ?? "No rating"}</Status>
    </span>
  );
}

/**
 * `eero.placement.test` through the write kit, with the gate, the eero being
 * tested and each eero's last result. Shared by the coverage table and the
 * eeros page's weak-link note.
 */
export function usePlacementTest() {
  const gate = useGate("eero.placement.test");
  const placement = useWrite<{ eero: string }, PlacementResult>("eero.placement.test", { failure: "Couldn't test placement" });
  const [results, setResults] = useState<Record<string, PlacementResult>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const test = async (id: string) => {
    setTesting(id);
    const r = await placement.run({ eero: id });
    setTesting(null);
    if (r?.ok) setResults((t) => ({ ...t, [id]: r.result }));
  };
  return { gate, results, testing, test };
}

function PlacementCell({ eero, result, testing, onTest, gate }: { eero: Eero | undefined; result: PlacementResult | undefined; testing: boolean; onTest: () => void; gate: ReturnType<typeof useGate> }) {
  if (testing) return <span className="text-muted-foreground text-xs">Testing...</span>;
  if (result) return <PlacementRating result={result} />;
  if (!eero || eero.isGateway) return null;
  return (
    <GatedButton gate={eero.status === "offline" ? { allowed: false, reason: `${eero.location} is offline` } : gate} size="xs" variant="ghost-muted" onClick={onTest}>
      Test
    </GatedButton>
  );
}

export function CoverageScanCard({ eeros }: { eeros: Eero[] | undefined }) {
  const query = useQuery<CoverageScan>("coverage.scan");
  const rescan = useCommand<{ refresh: boolean }, CoverageScan>("coverage.scan");
  const { gate, results: tests, testing, test } = usePlacementTest();
  const now = useNow();
  const scan = rescan.result ?? query.data;
  const scanning = rescan.running || (query.loading && !scan);

  if (unsupported(query) || unsupported(rescan)) return null;
  const error = rescan.error ?? query.error;
  const scanAgain = () => void rescan.run({ refresh: true });
  const nameOf = (id: string | null) => (id ? (eeros?.find((e) => e.id === id)?.location ?? MISSING) : MISSING);

  return (
    <Section
      title="Coverage scan"
      subtitle={scanning ? "Scanning..." : scan?.scannedAt ? `Scanned ${formatRelative(scan.scannedAt, now)}` : "Link quality per room"}
      tools={
        <Button size="xs" variant="outline" disabled={scanning} onClick={scanAgain}>
          {scanning ? "Scanning..." : scan?.rooms.length ? "Scan again" : "Scan now"}
        </Button>
      }
    >
      {error && !scan ? (
        <SectionError what="the coverage scan" error={error} onRetry={scanAgain} />
      ) : (
        <Card className={cn("transition-opacity", (query.fading || rescan.running) && "opacity-40")} data-coverage>
          {rescan.error && <div className="border-b px-4 py-2 text-destructive-foreground text-xs">Couldn't scan again: {rescan.error.message}</div>}
          {scan?.advice.length ? (
            <div className="border-b px-4 py-3 text-xs">
              {scan.advice.map((a) => (
                <p key={a}>{a}</p>
              ))}
            </div>
          ) : null}
          {scan && scan.rooms.length > 0 ? (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-4 py-2 font-normal">Room</th>
                  <th className="px-2 py-2 font-normal">Link</th>
                  <th className="px-2 py-2 text-right font-normal">Devices</th>
                  <th className="px-2 py-2 font-normal">Served by</th>
                  <th className="px-4 py-2 text-right font-normal">Placement</th>
                </tr>
              </thead>
              <tbody>
                {scan.rooms.map((r) => (
                  <tr key={r.eeroId} className="border-border/50 border-b last:border-0 hover:bg-muted/50">
                    <td className="max-w-40 truncate px-4 py-2 font-medium">{r.location}</td>
                    <td className="px-2 py-2">
                      <QualityCells quality={r.quality} />
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{r.devices === null ? MISSING : formatCount(r.devices)}</td>
                    <td className="max-w-32 truncate px-2 py-2 text-muted-foreground">{r.servedBy ? nameOf(r.servedBy) : "Gateway"}</td>
                    <td className="px-4 py-1.5 text-right">
                      <PlacementCell eero={eeros?.find((e) => e.id === r.eeroId)} result={tests[r.eeroId]} testing={testing === r.eeroId} onTest={() => void test(r.eeroId)} gate={gate} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty>{scanning ? "Scanning..." : "No scan yet."}</Empty>
          )}
          <div className="flex flex-wrap gap-3 border-t px-4 py-2 text-2xs text-muted-foreground">
            {(["poor", "fair", "good", "strong"] as const).map((k) => (
              <span key={k} className="inline-flex items-center gap-1.5">
                <span className={cn("size-2 rounded-[2px]", RATING[k].fill)} />
                {RATING[k].label}
              </span>
            ))}
          </div>
        </Card>
      )}
    </Section>
  );
}

const GEN_LABEL: Record<UpgradeReport["byGeneration"][number]["generation"], string> = {
  wifi7: "Wi-Fi 7",
  wifi6e: "Wi-Fi 6E",
  wifi6: "Wi-Fi 6",
  wifi5: "Wi-Fi 5",
  wifi4: "Wi-Fi 4 or older",
};

export function UpgradeReportCard({ eeros }: { eeros: Eero[] | undefined }) {
  const query = useQuery<UpgradeReport>("coverage.upgrade_report");
  const [active, setActive] = useState<string | null>(null);
  if (unsupported(query)) return null;
  const report = query.data;
  const total = report?.byGeneration.reduce((n, g) => n + g.devices, 0) ?? 0;
  const segments = (report?.byGeneration ?? []).map((g) => ({ label: GEN_LABEL[g.generation], value: g.devices, color: wifiGenerationColors[g.generation] }));
  const nameOf = (id: string) => eeros?.find((e) => e.id === id)?.location ?? "An eero";
  return (
    <Section title="Upgrade report" subtitle="Wi-Fi generation scan">
      {query.error && !report ? (
        <SectionError what="the upgrade report" error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <Card padded className={cn("flex flex-col gap-4 transition-opacity", query.fading && "opacity-40")} data-upgrade-report>
          {report && total === 0 ? (
            <Empty>No wireless devices to report on.</Empty>
          ) : (
            <div className="flex flex-wrap items-center gap-5">
              <Donut segments={segments} ariaLabel={`Devices by Wi-Fi generation, ${total} in all`} size={112} thickness={12} loading={!report} format={(v) => `${formatCount(v)} ${v === 1 ? "device" : "devices"}`} active={active} onActiveChange={setActive}>
                <span className="font-semibold text-xl tabular-nums">{report ? formatCount(total) : MISSING}</span>
                <span className="text-2xs text-muted-foreground">devices</span>
              </Donut>
              <div className="flex min-w-36 max-w-56 flex-1 flex-col gap-1.5 text-xs">
                {segments.map((s) => (
                  <DonutLegendRow key={s.label} label={s.label} color={s.color} active={active} onActiveChange={setActive}>
                    <span className="font-medium tabular-nums">{formatCount(s.value)}</span>
                  </DonutLegendRow>
                ))}
              </div>
            </div>
          )}
          {report && (report.limitingEeros.length > 0 || report.notes.length > 0) && (
            <ul className="flex flex-col gap-1 border-t pt-3 text-xs">
              {report.limitingEeros.map((e) => (
                <li key={e.eeroId}>
                  <span className="font-medium">{nameOf(e.eeroId)}</span> <span className="text-muted-foreground">· {e.reason}</span>
                </li>
              ))}
              {report.notes.map((n) => (
                <li key={n} className="text-muted-foreground">
                  {n}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </Section>
  );
}

const BANDS: { band: Radio["band"]; label: string }[] = [
  { band: "2.4", label: "2.4 GHz" },
  { band: "5", label: "5 GHz" },
  { band: "6", label: "6 GHz" },
];

function RadioCell({ radios }: { radios: Radio[] }) {
  if (!radios.length) return <span className="text-muted-foreground">{MISSING}</span>;
  return (
    <div className="flex flex-col gap-1.5">
      {radios.map((r, i) => (
        <div key={i} className="flex min-w-24 flex-col gap-1">
          <span className="tabular-nums">
            {r.channel ?? MISSING}
            <span className="text-muted-foreground"> · {r.widthMhz ? `${r.widthMhz} MHz` : MISSING}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <Meter value={r.utilization} label={`Channel ${r.channel ?? ""} busy`} warnAt={0.6} dangerAt={0.85} className="w-14" />
            <span className="text-2xs text-muted-foreground tabular-nums">{r.utilization === null ? MISSING : formatPercent(r.utilization)}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

const autoWord = (radios: Radio[]) => (radios.some((r) => r.autoChannel === true) ? "On" : radios.some((r) => r.autoChannel === false) ? "Off" : MISSING);

export function RadioChannels({ query }: { query: QueryState<Eero[]> }) {
  const eeros = query.data;
  return (
    <Section title="Radio channels" subtitle="Current radio state per eero">
      {query.error && !eeros ? (
        <SectionError what="the radios" error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <Card className={cn("overflow-x-auto transition-opacity", query.fading && "opacity-40")} data-radio-channels>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="px-4 py-2 font-normal">eero</th>
                {BANDS.map((b) => (
                  <th key={b.band} className="px-2 py-2 font-normal">
                    {b.label}
                  </th>
                ))}
                <th className="px-2 py-2 font-normal" title="eero does not report whether auto channel selection is on">
                  Auto channel
                </th>
                <th className="px-4 py-2 text-right font-normal">Clients</th>
              </tr>
            </thead>
            <tbody>
              {(eeros ?? []).map((e) => (
                <tr key={e.id} className="border-border/50 border-b align-top last:border-0 hover:bg-muted/50">
                  <td className="px-4 py-2.5">
                    <div className="font-medium">{e.location}</div>
                    <div className="text-2xs text-muted-foreground">{e.model ?? MISSING}</div>
                  </td>
                  {BANDS.map((b) => {
                    const radios = e.radios.filter((r) => r.band === b.band);
                    return (
                      <td key={b.band} className="px-2 py-2.5">
                        {b.band === "6" && !radios.length ? <span className="text-muted-foreground">No 6 GHz radio</span> : <RadioCell radios={radios} />}
                      </td>
                    );
                  })}
                  <td className="px-2 py-2.5 text-muted-foreground">{autoWord(e.radios)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatCount(e.clients.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t px-4 py-2 text-2xs text-muted-foreground">eero picks the channels; they are read only here. eero does not say whether auto channel selection is on, so it shows -.</p>
        </Card>
      )}
    </Section>
  );
}
