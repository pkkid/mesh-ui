/**
 * Overview "eeros": one row per eero with name and Gateway badge, model and
 * backhaul, status with mesh bars and device count, and a 24 h usage
 * sparkline in that eero's series colour.
 * docs/ux/pages/overview.md (Layout 3).
 */
import { Lamp, Router } from "lucide-react";

import { pathFor } from "~/app/router";
import { useQuery } from "~/app/useCommand";
import { Sparkline } from "~/components/charts/Sparkline";
import { MeshBars } from "~/components/mesh/LinkChip";
import { Badge } from "~/components/ui/badge";
import { Card, Empty, Section } from "~/components/ui/card";
import { IconTile } from "~/components/ui/hero";
import { HeaderLink, PlaceholderRows, Row, RowList, SectionError } from "~/components/ui/page";
import { networkStatus, Status } from "~/components/ui/status";
import { entityColors, seriesColors } from "~/lib/chartColors";
import { cn } from "~/lib/utils";
import { formatCount } from "../../../../core/format";
import type { Eero, NetworkHealth, UsageSeries } from "../../../../core/model";

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
        // Rows share the list's columns (subgrid) so every sparkline has the
        // same width: up to 110px, giving up width before the text does.
        <RowList
          className={cn(
            "grid grid-cols-[auto_minmax(min-content,1fr)_minmax(0,110px)] transition-opacity",
            eeros.fading && "opacity-40",
          )}
        >
          {list.map((e) => {
            const status =
              e.status === "offline"
                ? networkStatus("offline")
                : weak.has(e.id)
                  ? networkStatus("degraded")
                  : networkStatus(e.status);
            const points = series.get(e.id)?.points ?? [];
            return (
              // Three lines: name and Gateway badge; model and connection;
              // status, mesh bars and devices. The sparkline sits right of
              // lines 2 and 3 so line 1 keeps the full width for the name.
              <Row
                key={e.id}
                to={pathFor("eero", { eeroId: e.id })}
                className="col-span-3 grid grid-cols-subgrid grid-rows-[auto_auto_auto] gap-y-0.5"
              >
                <IconTile icon={/beacon/i.test(e.model ?? "") ? Lamp : Router} className="row-span-3" />
                <div className="col-span-2 flex min-w-0 items-center gap-2 font-medium text-[13.5px]">
                  <span className="truncate">{e.location}</span>
                  {e.isGateway && (
                    <Badge variant="outline" className="shrink-0">
                      Gateway
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-x-1.5 whitespace-nowrap text-muted-foreground text-xs">
                  {e.model && <span>{e.model}</span>}
                  {e.model && e.backhaul && <span>·</span>}
                  {e.backhaul === "wired" && <span>Ethernet</span>}
                  {e.backhaul === "wireless" && <span>Wireless</span>}
                </div>
                {/* Hidden when the column leaves it under 40px (very narrow cards). */}
                <div className="@container row-span-2 self-stretch">
                  <Sparkline
                    className="hidden h-full @min-[2.5rem]:block"
                    values={points.map((p) => p.down + p.up)}
                    color={colors[e.id] ?? seriesColors.neutral}
                    loading={usage.fading}
                    ariaLabel={`${e.location}: data used per hour, last 24 hours`}
                  />
                </div>
                <div className="flex items-center gap-x-1.5 whitespace-nowrap text-muted-foreground text-xs">
                  <Status tone={status.tone} className="shrink-0">
                    {status.label}
                  </Status>
                  {e.backhaul === "wireless" && (
                    <>
                      <span>·</span>
                      <MeshBars bars={e.meshBars} />
                    </>
                  )}
                  <span>·</span>
                  <span className="whitespace-nowrap">
                    {formatCount(e.clients?.total)} {e.clients?.total === 1 ? "device" : "devices"}
                  </span>
                </div>
              </Row>
            );
          })}
        </RowList>
      )}
    </Section>
  );
}
