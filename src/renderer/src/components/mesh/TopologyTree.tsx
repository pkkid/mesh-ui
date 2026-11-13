/**
 * The topology as an indented list (the Map's Tree toggle): each eero under
 * its upstream, with backhaul, the link chip and status. Same data as the
 * Map (`eero.list`). docs/ux/pages/eeros.md (Layout 1).
 */
import { Globe } from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Card } from "~/components/ui/card";
import { networkStatus, Status } from "~/components/ui/status";
import { cn } from "~/lib/utils";
import type { Eero } from "../../../../core/model";

import { LinkChip, linkSpeed, uplinkLook } from "./LinkChip";
import { behindOffline, eeroIcon } from "./Topology";

type TreeRow = { eero: Eero; depth: number };

/** Depth-first rows: gateway first, children by location; orphans and loops land under the gateway. */
export function treeRows(eeros: ReadonlyArray<Eero>): TreeRow[] {
  const ids = new Set(eeros.map((e) => e.id));
  const gateway = eeros.find((e) => e.isGateway) ?? null;
  const parentOf = (e: Eero) => (e.isGateway ? null : e.upstream && ids.has(e.upstream) ? e.upstream : (gateway?.id ?? null));
  const kids = (id: string | null) => eeros.filter((e) => e !== gateway && parentOf(e) === id).sort((a, b) => a.location.localeCompare(b.location));
  const rows: TreeRow[] = [];
  const seen = new Set<string>();
  const walk = (e: Eero, depth: number) => {
    if (seen.has(e.id)) return;
    seen.add(e.id);
    rows.push({ eero: e, depth });
    for (const k of kids(e.id)) walk(k, depth + 1);
  };
  if (gateway) walk(gateway, 0);
  for (const e of kids(null)) walk(e, 0);
  // Anything left (a loop with no way to the gateway) still shows.
  for (const e of eeros) walk(e, gateway ? 1 : 0);
  return rows;
}

export type TopologyTreeProps = {
  eeros: ReadonlyArray<Eero>;
  internet: { label: string | null; wanMbps: number | null } | null;
  selectedId?: string | null;
  warnIds?: ReadonlySet<string>;
  onSelect?: (id: string) => void;
  onOpen?: (id: string) => void;
  networkOffline?: boolean;
  offlineDetail?: (e: Eero) => string | null;
  loading?: boolean;
  className?: string;
};

export function TopologyTree({ eeros, internet, selectedId, warnIds, onSelect, onOpen, networkOffline = false, offlineDetail, loading = false, className }: TopologyTreeProps) {
  const rows = treeRows(eeros);
  const behind = behindOffline(eeros);
  const offset = internet ? 1 : 0;
  const wan = linkSpeed(internet?.wanMbps);

  return (
    <Card className={cn("min-h-[430px] transition-opacity", loading && "opacity-40", className)}>
      <div role="tree" aria-label="Mesh topology">
        {internet && (
          <div role="treeitem" aria-selected={false} className="flex items-center gap-3 px-4 py-2.5">
            <span className="grid size-8 place-items-center rounded-lg border bg-muted text-muted-foreground [&_svg]:size-4">
              <Globe aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-medium text-[13px]">Internet</div>
              <div className="text-muted-foreground text-xs">{internet.label ?? "-"}</div>
            </div>
            {!networkOffline && <LinkChip look={{ tone: "wired", dashed: false, label: wan ? `${wan} WAN` : "WAN", kind: "wired", bars: null }} />}
          </div>
        )}
        {rows.map(({ eero: e, depth }) => {
          const Icon = eeroIcon(e);
          const offline = networkOffline || e.status === "offline";
          const status = offline ? networkStatus("offline") : warnIds?.has(e.id) ? networkStatus("degraded") : networkStatus(e.status);
          const look = e.isGateway ? null : uplinkLook(e, { networkOffline, behindOffline: behind.has(e.id) });
          const backhaul = e.isGateway ? "Gateway" : e.backhaul === "wired" ? "Wired backhaul" : e.backhaul === "wireless" ? "Wireless backhaul" : null;
          const detail = e.status === "offline" ? offlineDetail?.(e) : null;
          return (
            <div
              key={e.id}
              role="treeitem"
              aria-level={depth + offset + 1}
              aria-selected={selectedId === e.id}
              tabIndex={0}
              onClick={() => onSelect?.(e.id)}
              onDoubleClick={() => onOpen?.(e.id)}
              onKeyDown={(ev) => {
                if (ev.key === "Enter") onOpen?.(e.id);
                if (ev.key === " ") {
                  ev.preventDefault();
                  onSelect?.(e.id);
                }
              }}
              className={cn(
                "flex cursor-pointer items-center gap-3 border-t py-2.5 pe-4 outline-none hover:bg-muted/50 focus-visible:bg-muted/50",
                selectedId === e.id && "bg-muted/50",
              )}
              style={{ paddingInlineStart: 16 + (depth + offset) * 28 }}
            >
              <span
                className={cn(
                  "grid size-8 place-items-center rounded-lg border bg-card text-foreground/80 [&_svg]:size-4",
                  (offline || behind.has(e.id)) && "text-muted-foreground/60",
                  warnIds?.has(e.id) && !offline && "outline-2 outline-warning outline-dashed outline-offset-2",
                )}
              >
                <Icon aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 font-medium text-[13px]">
                  <span className="truncate">{e.location}</span>
                  {e.isGateway && <Badge variant="outline">Gateway</Badge>}
                </div>
                <div className="truncate text-muted-foreground text-xs">{[e.model, backhaul, detail].filter(Boolean).join(" · ") || "-"}</div>
              </div>
              {look && <LinkChip look={look} />}
              <Status tone={status.tone} className="w-20">
                {status.label}
              </Status>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
