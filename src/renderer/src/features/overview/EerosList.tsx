/**
 * Overview "eeros": one row per eero with model, backhaul, device count, a
 * 24 h usage sparkline in that eero's series colour, and status.
 * docs/ux/pages/overview.md (Layout 3).
 */
import { Lamp, Router } from "lucide-react";

import { pathFor } from "~/app/router";
import { useQuery } from "~/app/useCommand";
import { Sparkline } from "~/components/charts/Sparkline";
import { Badge } from "~/components/ui/badge";
import { Card, Empty, Section } from "~/components/ui/card";
import { IconTile } from "~/components/ui/hero";
import { networkStatus, Status } from "~/components/ui/status";
import { entityColors, seriesColors } from "~/lib/chartColors";
import { cn } from "~/lib/utils";
import { formatCount } from "../../../../core/format";
import type { Eero, NetworkHealth, UsageSeries } from "../../../../core/model";

import { HeaderLink, PlaceholderRows, Row, RowList, SectionError } from "./OverviewView";

export function EerosList() {
  const eeros = useQuery<Eero[]>("eero.list", undefined, { poll: true });
  const health = useQuery<NetworkHealth>("network.health", undefined, { poll: true });
  // Same query as the By eero share bar on Day, so it is fetched once.
  const usage = useQuery<UsageSeries[]>("usage.get", { scope: "eero", range: "day" }, { poll: true });

  const list = eeros.data ?? [];
  const colors = entityColors(list.map((e) => e.id));
  const weak = new Set((health.data?.eeros ?? []).filter((e) => e.weakLink).map((e) => e.id));
  const series = new Map((usage.data ?? []).map((s) => [s.id, s]));

  return (
    <Section title="eeros" tools={<HeaderLink to={pathFor("eeros")} arrow>Topology</HeaderLink>}>
      {eeros.error && !eeros.data ? (
        <SectionError what="eeros" error={eeros.error} onRetry={() => void eeros.refetch()} />
      ) : !eeros.data ? (
        <PlaceholderRows count={4} />
      ) : list.length === 0 ? (
        <Card>
          <Empty>No eeros on this network.</Empty>
        </Card>
      ) : (
        <RowList className={cn("transition-opacity", eeros.fading && "opacity-40")}>
          {list.map((e) => {
            const status =
              e.status === "offline"
                ? networkStatus("offline")
                : weak.has(e.id)
                  ? networkStatus("degraded")
                  : networkStatus(e.status);
            const points = series.get(e.id)?.points ?? [];
            return (
              <Row key={e.id} to={pathFor("eero", { eeroId: e.id })}>
                <IconTile icon={/beacon/i.test(e.model ?? "") ? Lamp : Router} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 font-medium text-[13.5px]">
                    <span className="truncate">{e.location}</span>
                    {e.isGateway && <Badge variant="outline">Gateway</Badge>}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-1.5 text-muted-foreground text-xs">
                    {e.model && <span>{e.model}</span>}
                    {e.model && e.backhaul && <span>·</span>}
                    {e.backhaul === "wired" && <span>Ethernet</span>}
                    {e.backhaul === "wireless" && (
                      <>
                        <span>Wireless</span>
                        <MeshBars bars={e.meshBars} />
                      </>
                    )}
                    <span>·</span>
                    <span>
                      {formatCount(e.clients?.total)} {e.clients?.total === 1 ? "device" : "devices"}
                    </span>
                  </div>
                </div>
                <Sparkline
                  className="h-[26px] w-16 shrink-0 xl:w-[110px]"
                  values={points.map((p) => p.down + p.up)}
                  color={colors[e.id] ?? seriesColors.neutral}
                  loading={usage.fading}
                  ariaLabel={`${e.location}: data used per hour, last 24 hours`}
                />
                <Status tone={status.tone} className="shrink-0">
                  {status.label}
                </Status>
              </Row>
            );
          })}
        </RowList>
      )}
    </Section>
  );
}

/** Four mesh signal bars; 1 bar reads as destructive, 2 as warning (status colours). */
function MeshBars({ bars }: { bars: number | null }) {
  // eero reports 0 to 5; the mockup draws four.
  const n = bars === null ? 0 : Math.max(0, Math.min(4, Math.round((bars / 5) * 4)));
  const on = n === 1 ? "bg-destructive" : n === 2 ? "bg-warning" : "bg-foreground/70";
  return (
    <span className="inline-flex h-3 items-end gap-0.5" role="img" aria-label={bars === null ? "Mesh signal unknown" : `Mesh signal ${bars} of 5`}>
      {[4, 6.5, 9, 12].map((h, i) => (
        <i key={h} className={cn("w-[3px] rounded-[1px]", i < n ? on : "bg-border")} style={{ height: h }} />
      ))}
    </span>
  );
}
