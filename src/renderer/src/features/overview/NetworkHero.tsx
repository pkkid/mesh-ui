/**
 * The Overview status hero: network name and status, gateway uptime, ISP,
 * public IP, last speed test, the action row and the two speed gauges.
 * docs/ux/pages/overview.md (Layout 1, States).
 */
import { Gauge as GaugeIcon, PauseCircle, RotateCcw, Share2, TriangleAlert } from "lucide-react";

import { Link, pathFor } from "~/app/router";
import { useQuery } from "~/app/useCommand";
import { Gauge } from "~/components/charts/Gauge";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Metric, PageHeader } from "~/components/ui/hero";
import { networkStatus, Status } from "~/components/ui/status";
import { seriesColors } from "~/lib/chartColors";
import { formatDuration, formatRelative, mbpsParts } from "../../../../core/format";
import type { Internet, Network, NetworkHealth, SpeedHistory } from "../../../../core/model";

import { ComingSoonButton, useNow } from "./OverviewView";

export function NetworkHero() {
  const network = useQuery<Network>("network.get", undefined, { poll: true });
  const health = useQuery<NetworkHealth>("network.health", undefined, { poll: true });
  const internet = useQuery<Internet>("internet.get", undefined, { poll: true });
  const history = useQuery<SpeedHistory>("speedtest.history", undefined, { poll: true });
  const now = useNow();

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
  const gaugesLoading = history.loading && !history.data;

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
            <ComingSoonButton>
              <GaugeIcon />
              Run speed test
            </ComingSoonButton>
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
            <ComingSoonButton variant="ghost">
              <RotateCcw />
              Restart network
            </ComingSoonButton>
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
                <Link to={pathFor("internet")} className="hover:text-foreground hover:underline">
                  Set your plan
                </Link>{" "}
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
