/**
 * The Overview status hero: network name and status, gateway uptime, ISP,
 * public IP, last speed test, the action row (Share Wi-Fi opens the Share
 * Wi-Fi sheet (QR, Copy password); Restart network confirms in the dialog,
 * then a progress toast until the eeros are back) and the two speed gauges, captioned with when the last test ran,
 * "View history" (Internet at Speed test history) and, without a plan, "Set
 * your internet plan" (the plan sheet).
 * docs/ux/pages/overview.md (Layout 1, States).
 */
import { RotateCcw, TriangleAlert } from "lucide-react";

import { Link, pathFor } from "~/app/router";
import { useQuery } from "~/app/useCommand";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Metric, PageHeader } from "~/components/ui/hero";
import { GatedButton, useNow } from "~/components/ui/page";
import { networkStatus, Status } from "~/components/ui/status";
import { TextLink } from "~/components/ui/text-link";
import { seriesColors } from "~/lib/chartColors";
import { formatDuration, formatRelative, networkClock } from "../../../../core/format";
import type { Internet, Network, NetworkHealth, SpeedHistory } from "../../../../core/model";
import { useRestartNetwork } from "~/features/eeros/NetworkActions";
import { ShareGuestButton, ShareWifiButton } from "~/features/wifi/ShareSheet";
import { SpeedGauge, useRunningSpeedTest } from "~/features/internet/InternetHero";
import { openPlanSheet, PlanSheet } from "~/features/internet/PlanSheet";

/** Icons inside buttons use the dim text colour; the label stays bright. */
const DIM_ICON = "[&_svg]:text-muted-foreground";

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
        flat
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
            {/* Outline buttons with dim icons (design-system.md, Buttons and links). */}
            <ShareWifiButton className={DIM_ICON} />
            <ShareGuestButton className={DIM_ICON} />
            <GatedButton variant="outline" className={DIM_ICON} gate={restart.gate} disabled={restart.write.running} onClick={() => void restart.run()}>
              <RotateCcw />
              Restart network…
            </GatedButton>
          </>
        }
        aside={
          <div className={offline ? "opacity-60" : undefined}>
            <div className="flex items-center gap-7">
              <SpeedGauge
                label="Download"
                value={latest?.downMbps ?? null}
                plan={plan?.down ?? null}
                fallbackMax={fallbackMax}
                size={168}
                color={seriesColors.download}
                loading={gaugesLoading || history.fading}
              />
              <SpeedGauge
                label="Upload"
                value={latest?.upMbps ?? null}
                plan={plan?.up ?? null}
                fallbackMax={fallbackMax}
                size={168}
                color={seriesColors.upload}
                loading={gaugesLoading || history.fading}
              />
            </div>
            {internet.data && (
              <div className="mt-3 flex flex-col items-center gap-0.5 text-3xs text-muted-foreground">
                <div>
                  {latest ? <>Last speed test {networkClock(tz).dateTime(latest.at)}</> : "No speed test yet"}
                  {" · "}
                  <TextLink to={pathFor("internet", { section: "history" })}>View history</TextLink>
                </div>
                {!plan && (
                  <div>
                    <TextLink onClick={openPlanSheet}>Set your internet plan</TextLink> to scale the gauges
                  </div>
                )}
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

