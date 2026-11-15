/**
 * The Internet hero: the verdict built in core ("Ziply Fiber is fast and
 * steady"), connection status with gateway uptime, the last-test line, the
 * actions (Run speed test, Troubleshoot), the Download and Upload gauges and
 * the plan line that opens the plan sheet.
 * docs/ux/pages/internet.md (Layout 1, States).
 *
 * Also home to the speed test runner every Run speed test control shares
 * (Overview hero, this hero, Troubleshooting tools): `useSpeedTest` runs
 * `speedtest.run` and `watchSpeedTest` keeps a progress toast until the
 * result lands, then shows it.
 */
import { Flame, Gauge as GaugeIcon, LoaderCircle, Stethoscope } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";

import { Link, pathFor } from "~/app/router";
import { execute, invalidate, useQuery } from "~/app/useCommand";
import { type Gate, useWrite } from "~/app/useWrite";
import { Gauge } from "~/components/charts/Gauge";
import { Button } from "~/components/ui/button";
import { PageHeader } from "~/components/ui/hero";
import { GatedButton, useGate, useNow } from "~/components/ui/page";
import { Status } from "~/components/ui/status";
import { toast } from "~/components/ui/toast";
import { seriesColors } from "~/lib/chartColors";
import type { SpeedTestRun } from "../../../../core/commands/internet";
import { formatDuration, formatMbps, formatPlanShare, formatRelative, mbpsParts, networkClock } from "../../../../core/format";
import type { Id, Internet, Network, SpeedHistory } from "../../../../core/model";
import { TextLink } from "~/components/ui/text-link";
import { openPlanSheet } from "./PlanSheet";

// ---------------------------------------------------------------------------
// Speed test runner

/** First look, for a backend that posts the result at once (demo). */
const FIRST_LOOK_MS = 1_000;
/** How often the watcher reads the history once the result is due (core keeps these reads fresh). */
const WATCH_EVERY_MS = 5_000;
/** No result by then: "Speed test did not finish" (core frees the network at the same time). */
const GIVE_UP_MS = 3 * 60_000;

/** The network with a test running, one at a time per network like core. */
const running = new Map<Id, SpeedTestRun>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
let snapshot: ReadonlyMap<Id, SpeedTestRun> = new Map();
const setRunning = (id: Id, run: SpeedTestRun | null) => {
  if (run) running.set(id, run);
  else running.delete(id);
  snapshot = new Map(running);
  notify();
};

/** Tests already watched to the end, so a stale read cannot start a second watcher. */
const finished = new Set<string>();
const runKey = (run: SpeedTestRun) => `${run.networkId}|${run.startedAt}`;

/**
 * The test running on a network, if any. A test this window did not start
 * (the palette, a reload, the CLI in the same process) shows up in
 * `speedtest.history` as `running`; it is adopted with its own watcher.
 */
export function useRunningSpeedTest(networkId: Id | null | undefined): SpeedTestRun | null {
  const all = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => snapshot,
  );
  const history = useQuery<SpeedHistory>("speedtest.history", undefined, { enabled: Boolean(networkId) });
  const pending = history.data?.running ?? null;
  useEffect(() => {
    if (pending && pending.networkId === networkId) watchSpeedTest(pending);
  }, [pending, networkId]);
  return networkId ? (all.get(networkId) ?? null) : null;
}

/**
 * Shows "Testing internet speed" until the history has a result from this
 * test, then the result ("Speed test: 942 Mbps down, 918 Mbps up"). Reads
 * the tested network even if another one is selected meanwhile. Refreshes
 * the speed test and internet queries so heroes, chart and table update.
 */
export function watchSpeedTest(run: SpeedTestRun): void {
  if (running.has(run.networkId) || finished.has(runKey(run))) return;
  setRunning(run.networkId, run);
  const id = toast.progress("Testing internet speed", { detail: "Uses the WAN for about 30 s. The result shows in about a minute." });
  const started = Date.parse(run.startedAt);
  const due = Date.parse(run.resultAt);
  const done = () => {
    finished.add(runKey(run));
    setRunning(run.networkId, null);
    invalidate(["speedtest.", "internet.", "network.get"]);
  };
  const tick = async () => {
    // Core decides when the test is over (`running` back to null): a result
    // newer than any seen before the start, or the 3 minute give-up.
    const r = await execute<SpeedHistory>("speedtest.history", { networkId: run.networkId, range: "day", limit: 1 });
    const latest = r.ok ? r.result.tests[0] : undefined;
    // Checked first: past the give-up core clears `running` without a result.
    if (Date.now() - started >= GIVE_UP_MS) {
      toast.update(id, "error", { title: "Speed test did not finish", detail: "eero posted no result. Try again in a few minutes." });
      done();
      return;
    }
    if (r.ok && r.result.running === null && latest && Date.parse(latest.at) >= started - 10_000) {
      toast.update(id, "success", { title: `Speed test: ${formatMbps(latest.downMbps)} down, ${formatMbps(latest.upMbps)} up` });
      done();
      return;
    }
    // Before the result is due, wait for it; after, look every few seconds.
    setTimeout(() => void tick(), Math.max(WATCH_EVERY_MS, due - Date.now()));
  };
  setTimeout(() => void tick(), FIRST_LOOK_MS);
}

/**
 * Run speed test for one control: the write, the watcher, and a gate that
 * closes while the internet is down or a test is running on this network.
 */
export function useSpeedTest(): { run: () => Promise<void>; gate: Gate; testing: boolean; label: string } {
  const network = useQuery<Network>("network.get");
  const internet = useQuery<Internet>("internet.get");
  const write = useWrite<Record<string, never>, SpeedTestRun>("speedtest.run", { failure: "Couldn't start the speed test" });
  const permission = useGate({ area: "network" });
  const current = useRunningSpeedTest(network.data?.id);
  const testing = current !== null || write.running;
  const down = network.data?.status === "offline" || internet.data?.verdict?.kind === "down";
  const gate: Gate = down
    ? { allowed: false, reason: "Not available while the internet is down" }
    : testing
      ? { allowed: false, reason: "A speed test is running. Its result shows in about a minute." }
      : permission;
  const run = async () => {
    const r = await write.run({});
    if (r?.ok) watchSpeedTest(r.result);
  };
  return { run, gate, testing, label: testing ? "Testing..." : "Run speed test" };
}

/** The Run speed test button in a hero: primary, with a spinner while a test runs. */
export function RunSpeedTestButton({ variant }: { variant?: "default" | "outline" }) {
  const test = useSpeedTest();
  return (
    <GatedButton gate={test.gate} variant={variant} onClick={() => void test.run()}>
      {test.testing ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <GaugeIcon />}
      {test.label}
    </GatedButton>
  );
}

// ---------------------------------------------------------------------------
// Hero

export function InternetHero() {
  const network = useQuery<Network>("network.get", undefined, { poll: true });
  const internet = useQuery<Internet>("internet.get", undefined, { poll: true });
  const history = useQuery<SpeedHistory>("speedtest.history", undefined, { poll: true });
  const now = useNow();
  const testing = useRunningSpeedTest(network.data?.id) !== null;

  const n = network.data;
  const i = internet.data;
  const clock = networkClock(n?.timezone);
  const down = i?.verdict?.kind === "down" || n?.status === "offline";

  const latest = history.data?.tests[0] ?? i?.lastSpeedTest ?? null;
  const plan = i?.planMbps ?? null;
  // No plan set: the gauge max falls back to the best result in history.
  const best = Math.max(0, ...(history.data?.tests ?? []).flatMap((t) => [t.downMbps ?? 0, t.upMbps ?? 0]));
  const fallbackMax = best > 0 ? Math.ceil(best / 100) * 100 : 1000;
  // The gauges fade while a test runs and fill in with its result.
  const gaugesLoading = (history.loading && !history.data) || history.fading || testing;

  const status = !i ? undefined : down ? (
    <>
      <Status tone="destructive">Down</Status>
      {n?.lastSeen && <span>since {clock.dateTime(n.lastSeen)}</span>}
    </>
  ) : (
    <>
      <Status tone="success">Connected</Status>
      {n?.gatewayUptimeSec != null && (
        <span>
          Gateway up {formatDuration(n.gatewayUptimeSec)}
          {n.lastReboot && ` · since ${clock.dateTime(n.lastReboot)}`}
        </span>
      )}
    </>
  );

  const troubleshoot = (
    <Button variant={down ? "default" : "ghost"} render={<Link to={pathFor("troubleshooting")} />}>
      <Stethoscope />
      Troubleshoot
    </Button>
  );

  return (
    <PageHeader
      title={i?.verdict?.title ?? "-"}
      status={status}
      facts={
        i?.verdict?.detail ? (
          <span className="text-muted-foreground text-sm">{i.verdict.detail}</span>
        ) : !i && latest ? (
          <span className="text-muted-foreground text-sm">Last test {formatRelative(latest.at, now, n?.timezone ?? "UTC")}</span>
        ) : undefined
      }
      actions={
        down ? (
          <>
            {troubleshoot}
            <RunSpeedTestButton variant="outline" />
          </>
        ) : (
          <>
            <RunSpeedTestButton />
            {troubleshoot}
          </>
        )
      }
      aside={
        <div className={down ? "opacity-60" : undefined}>
          <div className="flex items-center gap-7">
            <SpeedGauge label="Download" value={latest?.downMbps ?? null} plan={plan?.down ?? null} fallbackMax={fallbackMax} size={164} color={seriesColors.download} loading={gaugesLoading} />
            <SpeedGauge label="Upload" value={latest?.upMbps ?? null} plan={plan?.up ?? null} fallbackMax={fallbackMax} size={164} color={seriesColors.upload} loading={gaugesLoading} />
          </div>
          {i && (
            <div className="text-center text-3xs text-muted-foreground">
              {plan ? `Plan ${plan.label ? `${plan.label}, ` : ""}${formatMbps(plan.down)} down, ${formatMbps(plan.up)} up` : "No plan set: gauges scale to your best result"}
              {" · "}
              <TextLink onClick={openPlanSheet}>{plan ? "Edit plan" : "Set plan"}</TextLink>
            </div>
          )}
        </div>
      }
    />
  );
}

/** With a plan the arc runs this far past it, so a result that beats the plan shows it. */
const PLAN_HEADROOM = 1.25;

/**
 * A speed test gauge (Overview and Internet heroes). With a plan it runs to
 * 125% of it, marks the plan on the arc and says "94% of plan" or, with a
 * solid flame in the over-plan colour, "9% over plan". Without one it scales
 * to `fallbackMax` (the best result) with no mark or line.
 */
export function SpeedGauge({
  label,
  value,
  plan,
  fallbackMax,
  color,
  loading,
  size,
}: {
  label: string;
  value: number | null;
  plan: number | null;
  fallbackMax: number;
  color: string;
  loading: boolean;
  size: number;
}) {
  const parts = mbpsParts(value);
  const share = formatPlanShare(value, plan);
  const max = plan && plan > 0 ? plan * PLAN_HEADROOM : fallbackMax;
  return (
    <Gauge
      label={label}
      value={value}
      max={max}
      mark={plan}
      color={color}
      text={parts.value}
      unit="Mbps"
      note={
        share && (
          <span className="inline-flex items-center gap-1">
            {share.over && <Flame aria-hidden className="size-2.75 fill-current" style={{ color: seriesColors.overPlan }} />}
            {share.text}
          </span>
        )
      }
      size={size}
      loading={loading}
      ariaLabel={
        value === null
          ? `${label}: no speed test yet`
          : share
            ? `${label}: ${parts.value} Mbps, ${share.text}`
            : `${label}: ${parts.value} Mbps of ${max} Mbps`
      }
    />
  );
}
