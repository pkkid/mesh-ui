/**
 * The Internet hero: the verdict built in core ("Ziply Fiber is fast and
 * steady"), connection status with gateway uptime, the last-test line, the
 * actions and the Download and Upload gauges.
 * docs/ux/pages/internet.md (Layout 1, States).
 */
import { Gauge as GaugeIcon, Stethoscope } from "lucide-react";

import { Link, pathFor } from "~/app/router";
import { useQuery } from "~/app/useCommand";
import { Gauge } from "~/components/charts/Gauge";
import { Button } from "~/components/ui/button";
import { PageHeader } from "~/components/ui/hero";
import { ComingSoonButton, useNow } from "~/components/ui/page";
import { Status } from "~/components/ui/status";
import { seriesColors } from "~/lib/chartColors";
import { formatDuration, formatRelative, mbpsParts, networkClock } from "../../../../core/format";
import type { Internet, Network, SpeedHistory } from "../../../../core/model";

export function InternetHero() {
  const network = useQuery<Network>("network.get", undefined, { poll: true });
  const internet = useQuery<Internet>("internet.get", undefined, { poll: true });
  const history = useQuery<SpeedHistory>("speedtest.history", undefined, { poll: true });
  const now = useNow();

  const n = network.data;
  const i = internet.data;
  const clock = networkClock(n?.timezone);
  const down = i?.verdict?.kind === "down" || n?.status === "offline";

  const latest = history.data?.tests[0] ?? i?.lastSpeedTest ?? null;
  const plan = i?.planMbps ?? null;
  // No plan set: the gauge max falls back to the best result in history.
  const best = Math.max(0, ...(history.data?.tests ?? []).flatMap((t) => [t.downMbps ?? 0, t.upMbps ?? 0]));
  const fallbackMax = best > 0 ? Math.ceil(best / 100) * 100 : 1000;
  const gaugesLoading = (history.loading && !history.data) || history.fading;

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
            <ComingSoonButton variant="outline" title="Not available while the internet is down">
              <GaugeIcon />
              Run speed test
            </ComingSoonButton>
          </>
        ) : (
          <>
            <ComingSoonButton>
              <GaugeIcon />
              Run speed test
            </ComingSoonButton>
            {troubleshoot}
          </>
        )
      }
      aside={
        <div className={down ? "opacity-60" : undefined}>
          <div className="flex items-center gap-7">
            <SpeedGauge label="Download" value={latest?.downMbps ?? null} max={plan?.down ?? fallbackMax} color={seriesColors.download} loading={gaugesLoading} />
            <SpeedGauge label="Upload" value={latest?.upMbps ?? null} max={plan?.up ?? fallbackMax} color={seriesColors.upload} loading={gaugesLoading} />
          </div>
          {!plan && i && <div className="text-center text-3xs text-muted-foreground">No plan set: gauges scale to your best result</div>}
        </div>
      }
    />
  );
}

function SpeedGauge({ label, value, max, color, loading }: { label: string; value: number | null; max: number; color: string; loading: boolean }) {
  const parts = mbpsParts(value);
  return (
    <Gauge
      label={label}
      value={value}
      max={max}
      color={color}
      text={parts.value}
      unit="Mbps"
      size={164}
      loading={loading}
      ariaLabel={value === null ? `${label}: no speed test yet` : `${label}: ${parts.value} Mbps of ${max} Mbps`}
    />
  );
}
