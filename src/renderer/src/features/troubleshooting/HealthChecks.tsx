/**
 * The health check hero from `health.check`: a score ring with the status
 * summary, Run again, and a grid of checks (internet, DNS, each eero, mesh
 * links, firmware), each with its mark, icon, name and one-line detail.
 * The symptom chips need `diagnostics.run` and are disabled for now.
 * docs/ux/pages/troubleshooting.md (Health check hero), mockup 16.
 */
import { CircleCheck, CircleHelp, CircleX, Download, Globe, type LucideIcon, RefreshCw, Router, Search, TriangleAlert, Waypoints } from "lucide-react";

import { Link, pathFor } from "~/app/router";
import type { RouteId } from "~/app/routes";
import type { QueryState } from "~/app/useCommand";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { ComingSoonButton, SectionError } from "~/components/ui/page";
import { cn } from "~/lib/utils";
import type { Check, HealthReport } from "../../../../core/model";

const MARK: Record<Check["status"], { icon: LucideIcon; className: string; word: string }> = {
  good: { icon: CircleCheck, className: "text-success-foreground", word: "Good" },
  warning: { icon: TriangleAlert, className: "text-warning-foreground", word: "Warning" },
  problem: { icon: CircleX, className: "text-destructive-foreground", word: "Problem" },
  unknown: { icon: CircleHelp, className: "text-muted-foreground", word: "Unknown" },
};

const OVERALL: Record<HealthReport["overall"], { word: string; ring: string }> = {
  good: { word: "Good", ring: "stroke-success" },
  warning: { word: "Good", ring: "stroke-warning" },
  problem: { word: "Needs attention", ring: "stroke-destructive" },
};

function checkIcon(id: string): LucideIcon {
  if (id === "internet") return Globe;
  if (id === "dns") return Search;
  if (id === "mesh") return Waypoints;
  if (id === "firmware") return Download;
  return Router;
}

/** Where a failing check's fix lives. */
const FIX: Partial<Record<string, RouteId>> = { firmware: "updates", internet: "internet", mesh: "eeros" };

const SYMPTOMS = ["My connection drops", "My internet is slow", "My internet is offline", "My eero's light is red"];

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

function summary(report: HealthReport): string {
  const warnings = report.checks.filter((c) => c.status === "warning").length;
  const problems = report.checks.filter((c) => c.status === "problem").length;
  const parts = [problems && `${problems} problem${problems === 1 ? "" : "s"}`, warnings && `${warnings} warning${warnings === 1 ? "" : "s"}`].filter(Boolean);
  return parts.length ? parts.join(", ") : "All checks passed";
}

function CheckRow({ check }: { check: Check }) {
  const mark = MARK[check.status];
  const Icon = checkIcon(check.id);
  const Mark = mark.icon;
  const fix = check.status === "warning" || check.status === "problem" ? FIX[check.id] : undefined;
  return (
    <div className="flex min-w-0 items-center gap-3 px-4 py-3" data-check={check.id} data-status={check.status}>
      <Mark className={cn("size-4 shrink-0", mark.className)} aria-label={mark.word} />
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-sm">{check.label}</div>
        <div className={cn("truncate text-xs", check.status === "good" || check.status === "unknown" ? "text-muted-foreground" : mark.className)} title={check.detail ?? undefined}>
          {check.detail ?? "-"}
        </div>
      </div>
      {fix && (
        <Link to={pathFor(fix)} className="shrink-0 text-muted-foreground text-xs hover:text-foreground hover:underline">
          Fix
        </Link>
      )}
    </div>
  );
}

export function HealthChecks({ query, offline }: { query: QueryState<HealthReport>; offline: boolean }) {
  const report = query.data;
  if (query.error && !report) return <SectionError what="the health check" error={query.error} onRetry={() => void query.refetch()} />;
  const count = report?.checks.length;
  return (
    <Card padded className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-6">
        <div className="flex flex-col items-center gap-2">
          <ScoreRing report={report} loading={query.fading} />
          <div className="text-center">
            <div className="font-medium text-sm">{report ? OVERALL[report.overall].word : "-"}</div>
            <div className={cn("text-xs", report && report.overall !== "good" ? MARK[report.overall].className : "text-muted-foreground")}>{report ? summary(report) : "Checking"}</div>
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="font-medium text-base">Network health check</h2>
          <p className="text-muted-foreground text-xs">{count ? `${count} checks` : "Checks"} across internet, DNS, eeros, mesh links and firmware, from what eero last reported.</p>
          <div className="mt-2">
            <Button size="sm" onClick={() => void query.refetch()} disabled={query.loading}>
              <RefreshCw className={cn(query.loading && "animate-spin")} />
              Run again
            </Button>
          </div>
        </div>
      </div>
      {/* The grid sits 1px low inside a clipping frame, so the last row's bottom border never doubles the frame's. */}
      <div className={cn("overflow-hidden rounded-(--control-radius) border transition-opacity", query.fading && "opacity-40")}>
        <div className="-mb-px grid sm:grid-cols-2">
          {report
            ? report.checks.map((c) => (
                <div key={c.id} className="border-b sm:odd:border-r">
                  <CheckRow check={c} />
                </div>
              ))
            : Array.from({ length: 6 }, (_, i) => <div key={i} className="h-[60px] border-b sm:odd:border-r" />)}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="me-1 text-muted-foreground text-xs">Something specific?</span>
        {SYMPTOMS.map((s) => (
          <ComingSoonButton key={s} size="xs" variant={offline && s === "My internet is offline" ? "secondary" : "outline"}>
            {s}
          </ComingSoonButton>
        ))}
      </div>
    </Card>
  );
}
