/**
 * The Overview status hero: network name and status, gateway uptime, ISP,
 * public IP, last speed test, the action row (Run speed test with a
 * progress toast until the result lands; Restart network confirms inline,
 * then a progress toast until the eeros are back) and the two speed gauges
 * ("Set your plan" opens the plan sheet).
 * docs/ux/pages/overview.md (Layout 1, States).
 */
import { PauseCircle, RotateCcw, Share2, TriangleAlert } from "lucide-react";

import { Link, pathFor } from "~/app/router";
import { useQuery } from "~/app/useCommand";
import { Gauge } from "~/components/charts/Gauge";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Metric, PageHeader } from "~/components/ui/hero";
import { WriteConfirm } from "~/components/ui/confirm";
import { ComingSoonButton, GatedButton, useNow } from "~/components/ui/page";
import { networkStatus, Status } from "~/components/ui/status";
import { seriesColors } from "~/lib/chartColors";
import { formatDuration, formatRelative, mbpsParts } from "../../../../core/format";
import type { Internet, Network, NetworkHealth, SpeedHistory } from "../../../../core/model";
import { useRestartNetwork } from "~/features/eeros/NetworkActions";
import { RunSpeedTestButton, useRunningSpeedTest } from "~/features/internet/InternetHero";
import { openPlanSheet, PlanSheet } from "~/features/internet/PlanSheet";

export function NetworkHero() {
  const network = useQuery<Network>("network.get", undefined, { poll: true });
  const health = useQuery<NetworkHealth>("network.health", undefined, { poll: true });
  const internet = useQuery<Internet>("internet.get", undefined, { poll: true });
  const history = useQuery<SpeedHistory>("speedtest.history", undefined, { poll: true });
  const now = useNow();
  const restart = useRestartNetwork();
  const testing = useRunningSpeedTest(network.data?.id) !== null;

  const n = network.data;
  const tz = n?.timezone ?? "UTC";
  const offline = n?.status === "offline";
  const bridged = n?.connectionMode === "bridged";

  // Status word and the cause beside it, from network.health when it has one.
  const eeros = health.data?.eeros ?? [];
  const downEero = offline ? undefined : eeros.find((e) => e.status === "offline");
  const weakEero = offline ? undefined : eeros.find((e) => e.weakLink && e.status !== "offline");
  const status = offline
    ? networkStatus("offline")
    : downEero || weakEero
      ? networkStatus("degraded")
      : networkStatus(health.data?.status ?? n?.status);

  const latest = history.data?.tests[0] ?? internet.data?.lastSpeedTest ?? null;
  const plan = internet.data?.planMbps ?? null;
  // No plan set: the gauge max falls back to the best result in history.
  const best = Math.max(0, ...(history.data?.tests ?? []).flatMap((t) => [t.downMbps ?? 0, t.upMbps ?? 0]));
  const fallbackMax = best > 0 ? Math.ceil(best / 100) * 100 : 1000;
  // The gauges fade while a test runs and fill in with its result.
  const gaugesLoading = (history.loading && !history.data) || testing;

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title={n?.name ?? "-"}
        status={
          n || health.data ? (
            <>
              <Status tone={status.tone}>{status.label}</Status>
              {offline ? (
                <span>Last seen {formatRelative(n?.lastSeen, now, tz)}</span>
              ) : downEero || weakEero ? (
                <Link to={pathFor("eeros")} className="hover:text-foreground hover:underline">
                  {downEero ? `${downEero.location} is offline` : `${weakEero?.location} has a weak link`}
                </Link>
              ) : n?.gatewayUptimeSec != null ? (
                <span>Gateway up {formatDuration(n.gatewayUptimeSec)}</span>
              ) : null}
            </>
          ) : undefined
        }
        facts={
          <>
            <Metric label="ISP" value={internet.data?.isp.name ?? n?.isp} />
            <Metric label="Public IP" value={internet.data?.publicIpv4} />
            <Metric label="Last speed test" value={latest ? formatRelative(latest.at, now, tz) : null} />
          </>
        }
        actions={
          <>
            <RunSpeedTestButton />
            <ComingSoonButton variant="outline">
              <Share2 />
              Share Wi-Fi
            </ComingSoonButton>
            {!bridged && (
              <ComingSoonButton variant="outline">
                <PauseCircle />
                Pause a profile
              </ComingSoonButton>
            )}
            <WriteConfirm write={restart.write} className="basis-full">
              <GatedButton variant="ghost" gate={restart.gate} disabled={restart.write.running} onClick={() => void restart.run()}>
                <RotateCcw />
                Restart network
              </GatedButton>
            </WriteConfirm>
          </>
        }
        aside={
          <div className={offline ? "opacity-60" : undefined}>
            <div className="flex items-center gap-7">
              <SpeedGauge
                label="Download"
                value={latest?.downMbps ?? null}
                max={plan?.down ?? fallbackMax}
                color={seriesColors.download}
                loading={gaugesLoading || history.fading}
              />
              <SpeedGauge
                label="Upload"
                value={latest?.upMbps ?? null}
                max={plan?.up ?? fallbackMax}
                color={seriesColors.upload}
                loading={gaugesLoading || history.fading}
              />
            </div>
            {!plan && internet.data && (
              <div className="text-center text-3xs text-muted-foreground">
                <button type="button" className="hover:text-foreground hover:underline" onClick={openPlanSheet}>
                  Set your plan
                </button>{" "}
                to scale the gauges
              </div>
            )}
          </div>
        }
      />
      {offline && (
        <Card padded className="flex items-center gap-3 text-sm">
          <TriangleAlert className="size-4 shrink-0 text-warning" />
          <span className="min-w-0 flex-1">
            {n?.name} is not reporting. Check the gateway's power and cable.
          </span>
          <Button size="sm" variant="outline" render={<Link to={pathFor("troubleshooting")} />}>
            Troubleshoot
          </Button>
        </Card>
      )}
      <PlanSheet />
    </div>
  );
}

function SpeedGauge({
  label,
  value,
  max,
  color,
  loading,
}: {
  label: string;
  value: number | null;
  max: number;
  color: string;
  loading: boolean;
}) {
  const parts = mbpsParts(value);
  return (
    <Gauge
      label={label}
      value={value}
      max={max}
      color={color}
      text={parts.value}
      unit="Mbps"
      size={168}
      loading={loading}
      ariaLabel={value === null ? `${label}: no speed test yet` : `${label}: ${parts.value} Mbps of ${max} Mbps`}
    />
  );
}
