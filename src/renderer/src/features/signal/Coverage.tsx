/**
 * The Signal page's two eero scans (docs/ux/pages/signal.md), moved here from
 * Troubleshooting:
 * - Coverage (`coverage.scan`): link quality per room as 5 cells, the devices
 *   and eero serving it, eero's placement advice, Scan again
 *   (`refresh: true`), and a per-room placement test (`eero.placement.test`).
 * - Upgrade report (`coverage.upgrade_report`): devices by the newest Wi-Fi
 *   generation they support, as a share bar with its legend, then the eeros
 *   that hold devices back and eero's notes.
 * Both are `/2.4/` reads: a 404 hides the section.
 */
import { useState } from "react";

import { useCommand, useQuery, type QueryState } from "~/app/useCommand";
import { useWrite } from "~/app/useWrite";
import { ShareBar } from "~/components/charts/ShareBar";
import { Button } from "~/components/ui/button";
import { Card, Empty, Section } from "~/components/ui/card";
import { Footnote, GatedButton, SectionError, useGate, useNow } from "~/components/ui/page";
import { Status, type StatusTone } from "~/components/ui/status";
import { wifiGenerationColors } from "~/lib/chartColors";
import { cn } from "~/lib/utils";
import { formatCount, formatPercent, formatRelative, MISSING } from "../../../../core/format";
import type { CoverageScan, Eero, PlacementResult, UpgradeReport } from "../../../../core/model";

type Rating = NonNullable<PlacementResult["rating"]>;

const RATING: Record<Rating, { label: string; tone: StatusTone; fill: string }> = {
  poor: { label: "Poor", tone: "destructive", fill: "bg-destructive" },
  fair: { label: "Fair", tone: "warning", fill: "bg-warning" },
  // Good and Strong are both fine, but each legend item needs its own marker: Good is the success colour softened.
  good: { label: "Good", tone: "success", fill: "bg-success/55" },
  strong: { label: "Strong", tone: "success", fill: "bg-success" },
};

/** 0 to 100 to 1 to 5 cells and a rating word. */
const cellsOf = (q: number) => Math.max(1, Math.min(5, Math.ceil(q / 20)));
const ratingOf = (q: number): Rating => (q >= 80 ? "strong" : q >= 60 ? "good" : q >= 40 ? "fair" : "poor");

/** The 2.4 API is missing on this network: hide the section. */
const unsupported = (q: Pick<QueryState<unknown>, "error">) => q.error?.code === "eero_error" && q.error.detail?.status === 404;

const TH = "px-4 py-2 font-normal";
const TD = "px-4 py-2.5";

function QualityCells({ quality }: { quality: number | null }) {
  if (quality === null) return <span className="text-muted-foreground">{MISSING}</span>;
  const n = cellsOf(quality);
  const fill = RATING[ratingOf(quality)].fill;
  return (
    <span className="inline-flex gap-0.5 align-middle" role="img" aria-label={`Link quality ${n} of 5`}>
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

/** Coverage: how well each eero reaches the mesh, room by room, from eero's coverage scan. */
export function CoverageSection({ eeros }: { eeros: Eero[] | undefined }) {
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
  const weak = scan?.rooms.filter((r) => r.quality !== null && r.quality < 40).length ?? 0;
  const description = scanning
    ? "Scanning..."
    : !scan?.rooms.length
      ? "Link quality between eeros, per room"
      : // Zero counts are left out ("4 rooms, 1 poor, ..."), as every subtitle does.
        [`${formatCount(scan.rooms.length)} rooms`, weak > 0 && `${formatCount(weak)} poor`, scan.scannedAt && `scanned ${formatRelative(scan.scannedAt, now)}`].filter(Boolean).join(", ");

  return (
    <Section
      title="Coverage" when="coverage"
      description={description}
      className="gap-[15px]"
      tools={
        <Button variant="outline" disabled={scanning} onClick={scanAgain}>
          {scanning ? "Scanning..." : scan?.rooms.length ? "Scan again" : "Scan now"}
        </Button>
      }
    >
      {error && !scan ? (
        <SectionError what="the coverage scan" error={error} onRetry={scanAgain} />
      ) : (
        <>
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
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="border-b text-left text-muted-foreground text-xs">
                    <th className={cn(TH, "w-full")}>Room</th>
                    <th className={TH}>Link</th>
                    <th className={cn(TH, "text-right")}>Devices</th>
                    <th className={TH}>Served by</th>
                    <th className={cn(TH, "text-right")}>Placement</th>
                  </tr>
                </thead>
                <tbody>
                  {scan.rooms.map((r) => (
                    <tr key={r.eeroId} className="border-border/50 border-b transition-colors last:border-b-0 hover:bg-muted/50">
                      <td className={cn(TD, "font-medium")}>{r.location}</td>
                      <td className={TD}>
                        <QualityCells quality={r.quality} />
                      </td>
                      <td className={cn(TD, "text-right tabular-nums")}>{r.devices === null ? MISSING : formatCount(r.devices)}</td>
                      <td className={cn(TD, "whitespace-nowrap text-muted-foreground")}>{r.servedBy ? nameOf(r.servedBy) : "Gateway"}</td>
                      <td className="whitespace-nowrap px-4 py-1.5 text-right">
                        <PlacementCell eero={eeros?.find((e) => e.id === r.eeroId)} result={tests[r.eeroId]} testing={testing === r.eeroId} onTest={() => void test(r.eeroId)} gate={gate} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty>{scanning ? "Scanning..." : "No scan yet."}</Empty>
            )}
          </Card>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-xs">
            {(["poor", "fair", "good", "strong"] as const).map((k) => (
              <span key={k} className="inline-flex items-center gap-1.5">
                <span aria-hidden className={cn("size-2 rounded-[2px]", RATING[k].fill)} />
                {RATING[k].label}
              </span>
            ))}
          </div>
        </>
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

/** Upgrade report: what the devices could use (the newest Wi-Fi they support), beside Wi-Fi generations' what they use now. */
export function UpgradeSection({ eeros, className }: { eeros: Eero[] | undefined; className?: string }) {
  const query = useQuery<UpgradeReport>("coverage.upgrade_report");
  if (unsupported(query)) return null;
  const report = query.data;
  const total = report?.byGeneration.reduce((n, g) => n + g.devices, 0) ?? 0;
  const modern = report?.byGeneration.filter((g) => g.generation === "wifi7" || g.generation === "wifi6e" || g.generation === "wifi6").reduce((n, g) => n + g.devices, 0) ?? 0;
  const nameOf = (id: string) => eeros?.find((e) => e.id === id)?.location ?? "An eero";
  const description = !report ? "-" : total === 0 ? "No wireless devices scanned" : `${formatPercent((modern / total) * 100)} support Wi-Fi 6 or newer`;
  return (
    <Section title="Upgrade report" when="upgradeReport" description={description} className={cn("gap-[15px]", className)}>
      {query.error && !report ? (
        <SectionError what="the upgrade report" error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <Card padded className={cn("flex flex-1 flex-col gap-4 transition-opacity", query.fading && "opacity-40")} data-upgrade-report>
          {report && total === 0 ? (
            <Empty>No wireless devices to report on.</Empty>
          ) : (
            <ShareBar
              format={(v) => `${formatCount(v)} ${v === 1 ? "device" : "devices"}`}
              segments={(report?.byGeneration ?? []).map((g) => ({ label: GEN_LABEL[g.generation], value: g.devices, color: wifiGenerationColors[g.generation] }))}
            />
          )}
          {/* The eeros that hold devices back are data, so they stay in the card. */}
          {report && report.limitingEeros.length > 0 && (
            <ul className="flex flex-col gap-1 border-border/50 border-t pt-3 text-xs">
              {report.limitingEeros.map((e) => (
                <li key={e.eeroId}>
                  <span className="font-medium">{nameOf(e.eeroId)}</span> <span className="text-muted-foreground">· {e.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      {/* eero's notes explain the figures, so they go under the card (design-system.md, Footnotes). */}
      {report && report.notes.length > 0 && <Footnote>{report.notes.join(" ")}</Footnote>}
    </Section>
  );
}
