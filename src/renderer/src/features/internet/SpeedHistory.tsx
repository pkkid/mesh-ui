/**
 * Internet "Speed test history": Month / All toggle, Export CSV of
 * that range, 7-day averages against the plan, the gateway-to-ISP note and
 * one dotted point per test. Export CSV saves `speedtest.history {format:
 * "csv"}` through the host's save dialog (`lib/saveFile.ts`).
 * docs/ux/pages/internet.md (Layout 3). Tests, ratings and averages come
 * from `speedtest.history`.
 */
import { ArrowDown, ArrowUp, Check, Download, Info } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { execute, useQuery } from "~/app/useCommand";
import { Button } from "~/components/ui/button";
import { AreaChart } from "~/components/charts/AreaChart";
import { Section } from "~/components/ui/card";
import { Meter } from "~/components/ui/meter";
import { SectionError } from "~/components/ui/page";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "~/components/ui/select";
import { seriesColors } from "~/lib/chartColors";
import { datedName, saveTextFile } from "~/lib/saveFile";
import { cn } from "~/lib/utils";
import { formatCount, formatMbps, formatPercent, networkClock } from "../../../../core/format";
import type { Internet, Network, SpeedHistory as History } from "../../../../core/model";

const RANGES = [
  { value: "month", label: "Last month" },
  { value: "all", label: "All results" },
] as const;

type HistoryRange = (typeof RANGES)[number]["value"];

/** Subtitle and screen reader wording per range. eero keeps about a year of tests, at most 100 per read. */
const RANGE_TEXT: Record<HistoryRange, string> = { month: "Last 30 days", all: "All eero returns" };

/**
 * `speedtest.history` params for a range. No Week: eero tests every 1 to 3
 * days, so a week holds only 2 to 5 points (the hero still reads the week).
 */
function historyParams(range: HistoryRange): { range: HistoryRange; limit: number } {
  return { range, limit: 200 };
}

export function SpeedHistory({ id }: { id?: string }) {
  const [range, setRange] = useState<HistoryRange>("all");
  const history = useQuery<History>("speedtest.history", historyParams(range), { poll: true });
  const internet = useQuery<Internet>("internet.get", undefined, { poll: true });
  const network = useQuery<Network>("network.get", undefined, { poll: true });

  const clock = networkClock(network.data?.timezone);
  // Oldest first; a test missing either direction is left off the chart rather than drawn as 0.
  const tests = (history.data?.tests ?? []).filter((t) => t.downMbps !== null && t.upMbps !== null).reverse();
  const plan = internet.data?.planMbps ?? null;
  const avg = history.data?.avg7d;
  const isp = internet.data?.isp.name ?? "your ISP";
  const count = history.data ? `${formatCount(history.data.tests.length)} ${history.data.tests.length === 1 ? "test" : "tests"}` : null;
  const oldest = history.data?.tests.at(-1)?.at;
  // Short, window first, comma joined: "Since Fri Oct 31, 100 tests" or "30 days, 12 tests".
  const span = range === "all" ? (oldest ? `Since ${clock.day(oldest)}` : null) : "30 days";
  const description = [span, count].filter(Boolean).join(", ") || "-";
  const fade = history.fading ? "opacity-40" : undefined;

  return (
    <Section
      id={id}
      title="Speed test history"
      description={description}
      className="gap-[15px]"
      tools={
        <div className="flex items-center gap-2">
          <ExportCsvButton network={network.data?.name ?? null} range={range} />
          {/* A dropdown, not a Segmented toggle, like Overview's Data usage range (design-system.md). */}
          <Select items={RANGES} value={range} onValueChange={(v) => v && setRange(v)}>
            <SelectTrigger size="tool" aria-label="Range">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {RANGES.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
      }
    >
      {history.error && !history.data ? (
        <SectionError what="speed tests" error={history.error} onRetry={() => void history.refetch()} />
      ) : (
        <div className="grid gap-7 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
          <div className="flex flex-col gap-4">
            <div className={cn("flex flex-col gap-4 transition-opacity", fade)}>
              <Average
                icon={<ArrowDown className="size-[15px]" style={{ color: seriesColors.download }} />}
                label="Download"
                color={seriesColors.download}
                value={avg?.downMbps ?? null}
                plan={plan?.down ?? null}
              />
              <Average
                icon={<ArrowUp className="size-[15px]" style={{ color: seriesColors.upload }} />}
                label="Upload"
                color={seriesColors.upload}
                value={avg?.upMbps ?? null}
                plan={plan?.up ?? null}
              />
            </div>
            <div className="h-px bg-border" />
            <div className="flex gap-2 text-muted-foreground text-xs">
              <Info className="mt-px size-3.5 shrink-0" />
              <span>
                Values show 7d average. Tests run from the gateway to your ISP, so they show what {isp} delivers, not Wi-Fi speed in a
                room.
              </span>
            </div>
          </div>
          <AreaChart
            series={[
              { id: "down", label: "Download", color: seriesColors.download, values: tests.map((t) => t.downMbps as number) },
              { id: "up", label: "Upload", color: seriesColors.upload, values: tests.map((t) => t.upMbps as number) },
            ]}
            labels={tests.map((t) => clock.day(t.at))}
            tooltipLabels={tests.map((t) => clock.dateTime(t.at))}
            format={(v) => formatMbps(v)}
            max={plan ? Math.max(plan.down, plan.up) : null}
            total={false}
            loading={history.loading && (!history.data || history.fading)}
            emptyText="No speed tests in this window."
            dots={tests.length <= 40}
            ariaLabel={`Speed test results, ${RANGE_TEXT[range].toLowerCase()}, download and upload`}
          />
        </div>
      )}
    </Section>
  );
}

function Average({ icon, label, color, value, plan }: { icon: ReactNode; label: string; color: string; value: number | null; plan: number | null }) {
  const share = value !== null && plan ? (value / plan) * 100 : null;
  return (
    // The share of plan sits after the value, "540 Mbps (108%)", like the Overview series rows; no line under the meter.
    <div>
      <div className="flex items-center justify-between gap-3 text-[13px]">
        <span className="flex min-w-0 items-center gap-2">
          {icon}
          <span className="truncate">{label}</span>
        </span>
        <span className="shrink-0 whitespace-nowrap tabular-nums">
          <span className="font-medium">{formatMbps(value)}</span>
          {share !== null && <span className="ms-1 text-muted-foreground text-xs">({formatPercent(share)})</span>}
        </span>
      </div>
      <Meter className="mt-2" value={plan ? value : null} max={plan ?? 100} color={color} label={`${label}, 7-day average, share of plan`} />
    </div>
  );
}

/** "speed-tests-maple-street" from the network name; letters and digits only. */
function fileStem(stem: string, network: string | null): string {
  const slug = (network ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return slug ? `${stem}-${slug}` : stem;
}

/** Export CSV: the window's tests as CSV from core, saved where the user picks. */
function ExportCsvButton({ network, range }: { network: string | null; range: HistoryRange }) {
  const [state, setState] = useState<{ kind: "idle" | "busy" } | { kind: "saved"; name: string } | { kind: "failed"; message: string }>({ kind: "idle" });
  useEffect(() => {
    if (state.kind !== "saved" && state.kind !== "failed") return;
    const t = setTimeout(() => setState({ kind: "idle" }), 2400);
    return () => clearTimeout(t);
  }, [state]);

  const run = async () => {
    setState({ kind: "busy" });
    const r = await execute<string>("speedtest.history", { ...historyParams(range), format: "csv" });
    if (!r.ok) return setState({ kind: "failed", message: r.error.message });
    const saved = await saveTextFile(datedName(fileStem("speed-tests", network), "csv"), r.result);
    if (saved.status === "saved") setState({ kind: "saved", name: saved.name });
    else if (saved.status === "failed") setState({ kind: "failed", message: saved.message });
    else setState({ kind: "idle" });
  };

  return (
    <Button
      variant="outline"
      // Icons inside buttons are dim (design-system.md, Buttons and links).
      className="[&_svg]:text-muted-foreground"
      disabled={state.kind === "busy"}
      title={state.kind === "saved" ? `Saved ${state.name}` : state.kind === "failed" ? state.message : undefined}
      onClick={() => void run()}
    >
      {state.kind === "saved" ? <Check /> : <Download />}
      {state.kind === "saved" ? "CSV saved" : state.kind === "failed" ? "Couldn't save" : "Export CSV…"}
    </Button>
  );
}
