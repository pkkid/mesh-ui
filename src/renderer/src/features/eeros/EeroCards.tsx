/**
 * "Your eeros": a card per eero (Grid) with the radio table, or one row per
 * eero (List) with per-band client counts. Find is disabled until
 * `eero.find` lands. docs/ux/pages/eeros.md (Layout 2).
 */
import { ChevronRight, Lightbulb } from "lucide-react";

import { Link, pathFor } from "~/app/router";
import { eeroIcon } from "~/components/mesh/Topology";
import { RadioTable, wirelessRadios } from "~/components/mesh/RadioTable";
import { Badge } from "~/components/ui/badge";
import { BandBadge } from "~/components/ui/band-badge";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { IconTile } from "~/components/ui/hero";
import { ComingSoonButton, Row, RowList } from "~/components/ui/page";
import { type StatusTone, Status } from "~/components/ui/status";
import { cn } from "~/lib/utils";
import { formatCount, formatDuration } from "../../../../core/format";
import type { Eero } from "../../../../core/model";

export type EeroStatusWord = { tone: StatusTone; label: string };

export type EeroCardsProps = {
  eeros: ReadonlyArray<Eero>;
  view: "grid" | "list";
  statusOf: (e: Eero) => EeroStatusWord;
  /** "last seen 2:16 AM" for an offline eero. */
  offlineDetail: (e: Eero) => string | null;
  /** A refetch has run for 150 ms: fade the figures. */
  fading?: boolean;
};

/** "eero Max 7 · 192.168.4.1 · up 23 d 4 h", or the last-seen line when offline (no uptime). */
function facts(e: Eero, offlineDetail: (e: Eero) => string | null): string {
  const up = e.status === "offline" || e.uptimeSec === null ? offlineDetail(e) : `up ${formatDuration(e.uptimeSec)}`;
  return [e.model, e.ipv4, up].filter(Boolean).join(" · ") || "-";
}

export function EeroCards({ eeros, view, statusOf, offlineDetail, fading = false }: EeroCardsProps) {
  if (view === "list") {
    return (
      <RowList className={cn("transition-opacity", fading && "opacity-40")}>
        {eeros.map((e) => {
          const status = statusOf(e);
          const radios = wirelessRadios(e);
          return (
            <Row key={e.id} to={pathFor("eero", { eeroId: e.id })}>
              <IconTile icon={eeroIcon(e)} />
              <div className="min-w-0 flex-1">
                <Title eero={e} />
                <div className="truncate text-muted-foreground text-xs">{facts(e, offlineDetail)}</div>
              </div>
              <div className="hidden items-center gap-3 md:flex">
                {radios.map((r) => (
                  <span key={r.band} className="inline-flex items-center gap-1.5 text-xs">
                    <BandBadge band={r.band} />
                    <span className="w-5 font-medium tabular-nums">{formatCount(r.clients)}</span>
                  </span>
                ))}
                {(e.clients.wired ?? 0) > 0 && (
                  <span className="inline-flex items-center gap-1.5 text-xs">
                    <BandBadge band="wired" />
                    <span className="w-5 font-medium tabular-nums">{formatCount(e.clients.wired)}</span>
                  </span>
                )}
              </div>
              <Status tone={status.tone} className="w-20">
                {status.label}
              </Status>
              <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
            </Row>
          );
        })}
      </RowList>
    );
  }

  return (
    <div className={cn("grid gap-3.5 transition-opacity lg:grid-cols-2", fading && "opacity-40")}>
      {eeros.map((e) => {
        const status = statusOf(e);
        const to = pathFor("eero", { eeroId: e.id });
        return (
          <Card key={e.id}>
            <div className="flex items-center gap-3 px-[18px] pt-4 pb-3">
              <IconTile icon={eeroIcon(e)} size="lg" />
              <div className="min-w-0 flex-1">
                <Link to={to} className="outline-none hover:underline focus-visible:underline">
                  <Title eero={e} large />
                </Link>
                <div className="truncate text-muted-foreground text-xs">{facts(e, offlineDetail)}</div>
              </div>
              <Status tone={status.tone}>{status.label}</Status>
              <ComingSoonButton size="xs" variant="outline">
                <Lightbulb />
                Find
              </ComingSoonButton>
              <Button size="icon-xs" variant="outline" title="Details" aria-label={`${e.location} details`} render={<Link to={to} />}>
                <ChevronRight />
              </Button>
            </div>
            <div className="border-t px-[18px] pt-3 pb-3.5">
              <RadioTable eero={e} />
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function Title({ eero, large = false }: { eero: Eero; large?: boolean }) {
  return (
    <span className={cn("flex min-w-0 items-center gap-2 font-medium", large ? "text-[15px]" : "text-[13.5px]")}>
      <span className="truncate">{eero.location}</span>
      {eero.isGateway && (
        <Badge variant="outline" className="shrink-0">
          Gateway
        </Badge>
      )}
    </span>
  );
}
