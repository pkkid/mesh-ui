/**
 * The health check from `health.check`, in two parts:
 * - HealthHero: the flat page header. Title is what the check found ("1
 *   warning", "All checks passed"), the status line the overall word, facts
 *   for the checks passed, the first one to look at and when it ran, Run
 *   again (the polled `health.check` fetched past the engine cache, like the
 *   header Refresh; one run at a time, "Checking..." until it ends), and the
 *   score ring on the right.
 * - HealthChecks: the Checks section, a two-column grid of the checks
 *   (internet, DNS, each eero, mesh links, firmware): icon, name, detail,
 *   status, and a link to the fix for a failing one.
 * docs/ux/pages/troubleshooting.md (Hero, Checks).
 */
import { useState } from "react";
import { Check as CheckMark, Download, Globe, type LucideIcon, RefreshCw, Router, Search, Waypoints } from "lucide-react";

import { pathFor } from "~/app/router";
import type { RouteId } from "~/app/routes";
import { useQuery } from "~/app/useCommand";
import { Button } from "~/components/ui/button";
import { Card, Section } from "~/components/ui/card";
import { Metric, PageHeader } from "~/components/ui/hero";
import { SectionError, SectionLink, useNow } from "~/components/ui/page";
import { Status, type StatusTone } from "~/components/ui/status";
import { formatCount, formatRelative } from "../../../../core/format";
import { cn } from "~/lib/utils";
import type { ExecuteError } from "../../../../core/errors";
import type { Check, HealthReport } from "../../../../core/model";

const MARK: Record<Check["status"], { tone: StatusTone; word: string; text: string }> = {
  good: { tone: "success", word: "Good", text: "text-muted-foreground" },
  warning: { tone: "warning", word: "Warning", text: "text-warning-foreground" },
  problem: { tone: "destructive", word: "Problem", text: "text-destructive-foreground" },
  unknown: { tone: "muted", word: "Unknown", text: "text-muted-foreground" },
};

const OVERALL: Record<HealthReport["overall"], { word: string; tone: StatusTone; ring: string }> = {
  good: { word: "Good", tone: "success", ring: "stroke-success" },
  warning: { word: "Good", tone: "warning", ring: "stroke-warning" },
  problem: { word: "Needs attention", tone: "destructive", ring: "stroke-destructive" },
};

function checkIcon(id: string): LucideIcon {
  if (id === "internet") return Globe;
  if (id === "dns") return Search;
  if (id === "mesh") return Waypoints;
  if (id === "firmware") return Download;
  return Router;
}

/** Where a failing check's fix lives, and the link's words. */
const FIX: Partial<Record<string, { to: RouteId; label: string }>> = {
  firmware: { to: "updates", label: "View updates" },
  internet: { to: "internet", label: "View internet" },
  mesh: { to: "signal", label: "View coverage" },
};

const DIM_ICON = "[&_svg]:text-muted-foreground";

function ScoreRing({ report, loading }: { report: HealthReport | undefined; loading: boolean }) {
  const size = 132;
  const thickness = 12;
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const score = report?.score ?? null;
  return (
    <div className={cn("relative shrink-0 transition-opacity", loading && "opacity-40")} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={score === null ? "Health score not available yet" : `Health score ${score} out of 100`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={thickness} className="stroke-muted" />
        {score !== null && report && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={thickness}
            strokeDasharray={`${(c * score) / 100} ${c}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            className={OVERALL[report.overall].ring}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-semibold text-3xl tabular-nums">{score ?? "-"}</span>
        <span className="text-muted-foreground text-xs">Health</span>
      </div>
    </div>
  );
}

const plural = (n: number, one: string) => `${formatCount(n)} ${n === 1 ? one : `${one}s`}`;

/** "2 problems, 1 warning", or null when every check passed. */
function findings(report: HealthReport): string | null {
  const warnings = report.checks.filter((c) => c.status === "warning").length;
  const problems = report.checks.filter((c) => c.status === "problem").length;
  const parts = [problems && plural(problems, "problem"), warnings && plural(warnings, "warning")].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

/**
 * The health check with Run checks again: `health.check` polled, and the button
 * refetches it with `{ fresh: true }` (a plain refetch was answered from the
 * engine's cache and looked like nothing happened).
 */
export function useHealthCheck() {
  const query = useQuery<HealthReport>("health.check", undefined, { poll: true });
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<ExecuteError | null>(null);
  const runAgain = () => {
    if (running) return;
    setRunning(true);
    setError(null);
    void query.refetch({ fresh: true }).then((snap) => {
      setRunning(false);
      setError(snap.error);
    });
  };
  return { query, report: query.data, running, error, runAgain };
}

type Health = ReturnType<typeof useHealthCheck>;

export function HealthHero({ health }: { health: Health }) {
  const { query, report, runAgain, running } = health;
  const now = useNow();
  const passed = report?.checks.filter((c) => c.status === "good").length ?? 0;
  const first = report?.checks.find((c) => c.status === "problem") ?? report?.checks.find((c) => c.status === "warning");
  return (
    <PageHeader
      flat
      data-slot="health-hero"
      className={cn("transition-opacity", query.fading && !report && "opacity-40")}
      title={report ? (findings(report) ?? "All checks passed") : "Troubleshooting"}
      status={
        report ? (
          <>
            <Status tone={OVERALL[report.overall].tone}>{OVERALL[report.overall].word}</Status>
            <span>From what eero last reported</span>
          </>
        ) : null
      }
      facts={
        <>
          <Metric label="Checks passed" value={report ? `${formatCount(passed)} of ${formatCount(report.checks.length)}` : null} />
          <Metric label="Look at first" value={report ? (first ? first.label : "Nothing") : null} />
          <Metric label="Last check" value={report ? formatRelative(report.at, now) : null} />
        </>
      }
      actions={
        <>
          <Button variant="outline" className={DIM_ICON} onClick={runAgain} disabled={running} aria-busy={running} data-run-again>
            <RefreshCw className={cn(running && "animate-spin motion-reduce:animate-none")} />
            {running ? "Checking..." : "Run checks again"}
          </Button>
          {health.error && <span className="self-center text-destructive-foreground text-xs">Couldn't run the check again: {health.error.message}</span>}
        </>
      }
      aside={<ScoreRing report={report} loading={query.fading || running} />}
    />
  );
}

function CheckRow({ check }: { check: Check }) {
  const mark = MARK[check.status];
  const Icon = checkIcon(check.id);
  const fix = check.status === "warning" || check.status === "problem" ? FIX[check.id] : undefined;
  return (
    <div className="flex min-w-0 items-center gap-3 px-4 py-3" data-check={check.id} data-status={check.status}>
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-sm">{check.label}</div>
        <div className={cn("truncate text-xs", mark.text)} title={check.detail ?? undefined}>
          {check.detail ?? "-"}
        </div>
      </div>
      {fix ? (
        <SectionLink to={pathFor(fix.to)}>{fix.label}</SectionLink>
      ) : check.status === "good" ? (
        // A passing check gets a green check mark in place of the status dot, with its word.
        <span className="inline-flex items-center gap-1.5 text-foreground/80 text-xs">
          <CheckMark aria-hidden className="size-3.5 text-success-foreground" strokeWidth={2.5} />
          Good
        </span>
      ) : (
        <Status tone={mark.tone}>{mark.word}</Status>
      )}
    </div>
  );
}

/** The Checks section: every check in a two-column grid. */
export function HealthChecks({ health }: { health: Health }) {
  const { query, report, runAgain, running } = health;
  if (query.error && !report) return <SectionError what="the health check" error={query.error} onRetry={runAgain} />;
  const description = report ? `${plural(report.checks.length, "check")}, ${findings(report) ?? "all passed"}` : "-";
  return (
    <Section title="Checks" description={description} className="gap-[15px]">
      {/* The grid sits 1px low inside the clipping card, so the last row's bottom border never doubles the card's. */}
      <Card className={cn("overflow-hidden transition-opacity", (query.fading || running) && "opacity-40")}>
        <div className="-mb-px grid sm:grid-cols-2">
          {report
            ? report.checks.map((c) => (
                <div key={c.id} className="border-border/50 border-b sm:odd:border-r">
                  <CheckRow check={c} />
                </div>
              ))
            : Array.from({ length: 6 }, (_, i) => <div key={i} className="h-[61px] border-border/50 border-b sm:odd:border-r" />)}
        </div>
      </Card>
    </Section>
  );
}
