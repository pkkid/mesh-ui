/**
 * Internet "Earlier tests": the week's tests before the latest one, each
 * direction with a meter of the plan, and the verdict core rated it.
 * Export CSV saves `speedtest.history {format: "csv"}` through the host's
 * save dialog (`lib/saveFile.ts`). docs/ux/pages/internet.md (Layout 4).
 */
import { Check, Download } from "lucide-react";
import { useEffect, useState } from "react";

import { execute, useQuery } from "~/app/useCommand";
import { Button } from "~/components/ui/button";
import { Card, Empty, Section } from "~/components/ui/card";
import { Meter } from "~/components/ui/meter";
import { SectionError } from "~/components/ui/page";
import { seriesColors } from "~/lib/chartColors";
import { datedName, saveTextFile } from "~/lib/saveFile";
import { cn } from "~/lib/utils";
import { formatMbps, networkClock } from "../../../../core/format";
import type { Internet, Network, PlanSpeed, SpeedHistory, SpeedTest } from "../../../../core/model";

const VERDICT: Record<NonNullable<SpeedTest["rating"]>, { label: string; className: string }> = {
  great: { label: "Great", className: "text-foreground/80" },
  below_plan: { label: "Below plan", className: "text-warning" },
  poor: { label: "Poor", className: "text-destructive" },
};

/** The direction that pulled the rating down (the lower share of plan), when the test was not great. */
function weakSide(t: SpeedTest, plan: PlanSpeed | null): "down" | "up" | null {
  if (!plan || !t.rating || t.rating === "great") return null;
  const d = t.downMbps !== null && plan.down > 0 ? t.downMbps / plan.down : Number.POSITIVE_INFINITY;
  const u = t.upMbps !== null && plan.up > 0 ? t.upMbps / plan.up : Number.POSITIVE_INFINITY;
  return d <= u ? "down" : "up";
}

export function EarlierTests() {
  const history = useQuery<SpeedHistory>("speedtest.history", undefined, { poll: true });
  const internet = useQuery<Internet>("internet.get", undefined, { poll: true });
  const network = useQuery<Network>("network.get", undefined, { poll: true });

  const clock = networkClock(network.data?.timezone);
  const plan = internet.data?.planMbps ?? null;
  const rows = history.data?.tests.slice(1);

  const tools = <ExportCsvButton network={network.data?.name ?? null} />;

  return (
    <Section title="Earlier tests" subtitle="Before the latest result above" tools={tools}>
      {history.error && !history.data ? (
        <SectionError what="speed tests" error={history.error} onRetry={() => void history.refetch()} />
      ) : rows && rows.length === 0 ? (
        <Card>
          <Empty>No earlier speed tests in the last 7 days.</Empty>
        </Card>
      ) : (
        <Card>
          <table className={cn("w-full border-collapse text-[13px] transition-opacity", history.fading && "opacity-40")}>
            <thead>
              <tr className="border-b text-left text-muted-foreground text-xs">
                <th className="px-3 py-2 font-normal">When</th>
                <th className={cn("px-3 py-2 font-normal", plan && "w-1/2")}>Download</th>
                <th className={cn("px-3 py-2 font-normal", plan && "w-1/2")}>Upload</th>
                <th className={cn("px-3 py-2 font-normal", !plan && "w-full")}>
                  <span className="sr-only">Verdict</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows
                ? rows.map((t) => {
                    const weak = weakSide(t, plan);
                    const tone = t.rating === "poor" ? "text-destructive" : "text-warning";
                    return (
                      <tr key={t.at} className="border-border/50 border-b last:border-b-0 hover:bg-muted/50">
                        <td className="whitespace-nowrap px-3 py-2.5 font-medium">{clock.dateTime(t.at)}</td>
                        <SpeedCell value={t.downMbps} plan={plan?.down ?? null} label="Download" color={seriesColors.download} className={weak === "down" ? tone : undefined} />
                        <SpeedCell value={t.upMbps} plan={plan?.up ?? null} label="Upload" color={seriesColors.upload} className={weak === "up" ? tone : undefined} />
                        <td className={cn("whitespace-nowrap px-3 py-2.5 text-right text-xs", t.rating ? VERDICT[t.rating].className : "text-muted-foreground")}>
                          {t.rating ? VERDICT[t.rating].label : "-"}
                        </td>
                      </tr>
                    );
                  })
                : Array.from({ length: 4 }, (_, i) => (
                    <tr key={i} className="border-border/50 border-b last:border-b-0">
                      <td className="h-[41px]" colSpan={4} />
                    </tr>
                  ))}
            </tbody>
          </table>
        </Card>
      )}
    </Section>
  );
}

function SpeedCell({ value, plan, label, color, className }: { value: number | null; plan: number | null; label: string; color: string; className?: string }) {
  return (
    <td className="px-3 py-2.5">
      <div className="flex items-center gap-3">
        <span className={cn("w-[78px] shrink-0 font-medium tabular-nums", className)}>{formatMbps(value)}</span>
        {plan ? <Meter value={value} max={plan} color={color} label={`${label}, share of plan`} /> : null}
      </div>
    </td>
  );
}

/** "speed-tests-maple-street" from the network name; letters and digits only. */
function fileStem(stem: string, network: string | null): string {
  const slug = (network ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return slug ? `${stem}-${slug}` : stem;
}

/** Export CSV: the week's tests as CSV from core, saved where the user picks. */
function ExportCsvButton({ network }: { network: string | null }) {
  const [state, setState] = useState<{ kind: "idle" | "busy" } | { kind: "saved"; name: string } | { kind: "failed"; message: string }>({ kind: "idle" });
  useEffect(() => {
    if (state.kind !== "saved" && state.kind !== "failed") return;
    const t = setTimeout(() => setState({ kind: "idle" }), 2400);
    return () => clearTimeout(t);
  }, [state]);

  const run = async () => {
    setState({ kind: "busy" });
    const r = await execute<string>("speedtest.history", { range: "week", format: "csv" });
    if (!r.ok) return setState({ kind: "failed", message: r.error.message });
    const saved = await saveTextFile(datedName(fileStem("speed-tests", network), "csv"), r.result);
    if (saved.status === "saved") setState({ kind: "saved", name: saved.name });
    else if (saved.status === "failed") setState({ kind: "failed", message: saved.message });
    else setState({ kind: "idle" });
  };

  return (
    <Button
      size="xs"
      variant="outline"
      disabled={state.kind === "busy"}
      title={state.kind === "saved" ? `Saved ${state.name}` : state.kind === "failed" ? state.message : undefined}
      onClick={() => void run()}
    >
      {state.kind === "saved" ? <Check /> : <Download />}
      {state.kind === "saved" ? "CSV saved" : state.kind === "failed" ? "Couldn't save" : "Export CSV"}
    </Button>
  );
}
