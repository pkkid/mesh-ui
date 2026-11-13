/**
 * The mesh topology Map: an Internet node, the gateway, then each eero in a
 * column by hop count, with a link to its upstream. Layout is view code;
 * the graph (upstream, hop, quality) comes from `eero.list` and core.
 * docs/ux/pages/eeros.md (Layout 1, Notes).
 *
 * Reused by eero detail for a single eero's uplink: pass just that eero and
 * its upstream (columns are relative to the smallest hop given), and leave
 * out `internet` unless the eero is the gateway.
 */
import { Cable, Globe, Lamp, Router } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import type { Eero } from "../../../../core/model";

import { LINK_COLOR, LinkChip, type LinkLook, linkSpeed, uplinkLook } from "./LinkChip";

/** Coordinates are percent of the map box, so nodes (HTML) and links (SVG) agree. */
export type MapPoint = { x: number; y: number };
export type MapNode = MapPoint & { eero: Eero };
export type MapLink = { from: MapPoint; to: MapPoint; look: LinkLook; key: string; eeroId: string | null };

export type MeshLayout = { internet: MapPoint | null; nodes: MapNode[]; links: MapLink[] };

const INTERNET_X = 8;
const FIRST_X = 30;
const LAST_X = 89;
const MID_Y = 50;

/** Eeros whose upstream chain passes through an offline eero. */
export function behindOffline(eeros: ReadonlyArray<Eero>): Set<string> {
  const byId = new Map(eeros.map((e) => [e.id, e]));
  const out = new Set<string>();
  for (const e of eeros) {
    const seen = new Set([e.id]);
    let up = e.upstream ? byId.get(e.upstream) : undefined;
    while (up && !seen.has(up.id)) {
      if (up.status === "offline") {
        out.add(e.id);
        break;
      }
      seen.add(up.id);
      up = up.upstream ? byId.get(up.upstream) : undefined;
    }
  }
  return out;
}

/**
 * Places the nodes: one column per hop from left to right, nodes in a column
 * spread around the middle and ordered by their upstream's place, so links
 * cross as little as they can.
 */
export function layoutMesh(eeros: ReadonlyArray<Eero>, opts: { internet: boolean; wanMbps?: number | null; networkOffline?: boolean }): MeshLayout {
  const hopOf = (e: Eero) => (e.isGateway ? 0 : (e.hop ?? 1));
  const hops = [...new Set(eeros.map(hopOf))].sort((a, b) => a - b);
  const firstX = opts.internet ? FIRST_X : 12;
  const lastX = opts.internet || hops.length > 2 ? LAST_X : 88;
  const span = hops.length > 1 ? Math.min(30, (lastX - firstX) / (hops.length - 1)) : 0;
  const colX = (hop: number) => firstX + hops.indexOf(hop) * span;

  const placed = new Map<string, MapNode>();
  for (const hop of hops) {
    const column = eeros
      .filter((e) => hopOf(e) === hop)
      .sort((a, b) => {
        const ya = placed.get(a.upstream ?? "")?.y ?? MID_Y;
        const yb = placed.get(b.upstream ?? "")?.y ?? MID_Y;
        return ya - yb || a.location.localeCompare(b.location);
      });
    const n = column.length;
    const step = n > 1 ? Math.min(52, 64 / (n - 1)) : 0;
    column.forEach((e, i) => placed.set(e.id, { eero: e, x: colX(hop), y: MID_Y + (i - (n - 1) / 2) * step }));
  }

  const nodes = [...placed.values()];
  const gateway = nodes.find((n) => n.eero.isGateway) ?? null;
  const internet = opts.internet ? { x: INTERNET_X, y: gateway?.y ?? MID_Y } : null;
  const behind = behindOffline(eeros);
  const links: MapLink[] = [];

  if (internet && gateway) {
    const speed = linkSpeed(opts.wanMbps);
    const down = opts.networkOffline === true;
    links.push({
      key: "internet",
      eeroId: null,
      from: internet,
      to: gateway,
      look: { tone: down ? "muted" : "wired", dashed: down, label: down ? null : speed ? `${speed} WAN` : "WAN", kind: "wired", bars: null },
    });
  }
  for (const node of nodes) {
    if (node.eero.isGateway) continue;
    // No known upstream (or one not drawn here): it hangs off the gateway, as core counts hops.
    const parent = (node.eero.upstream ? placed.get(node.eero.upstream) : undefined) ?? gateway;
    if (!parent || parent === node) continue;
    links.push({
      key: node.eero.id,
      eeroId: node.eero.id,
      from: parent,
      to: node,
      look: uplinkLook(node.eero, { networkOffline: opts.networkOffline, behindOffline: behind.has(node.eero.id) }),
    });
  }
  return { internet, nodes, links };
}

/** A smooth S curve from one node to the next, in map percent units. */
const curve = (a: MapPoint, b: MapPoint) => {
  const mx = (a.x + b.x) / 2;
  return `M${a.x},${a.y} C${mx},${a.y} ${mx},${b.y} ${b.x},${b.y}`;
};

export const eeroIcon = (e: Pick<Eero, "model">) => (/beacon/i.test(e.model ?? "") ? Lamp : Router);

export type TopologyProps = {
  eeros: ReadonlyArray<Eero>;
  /** The Internet node: label under it ("Ziply Fiber") and the WAN port speed; null hides it. */
  internet: { label: string | null; wanMbps: number | null } | null;
  /** Wired clients chip under the gateway ("3 wired: NAS, PS5, Hue Bridge"); null hides it. */
  wiredChip?: string | null;
  selectedId?: string | null;
  /** eeros drawn with a dashed warning outline (weak links). */
  warnIds?: ReadonlySet<string>;
  onSelect?: (id: string) => void;
  onOpen?: (id: string) => void;
  /** The network is not reporting: every node muted, links grey and dashed. */
  networkOffline?: boolean;
  /** Second line under an offline node ("last seen 2:16 AM"). */
  offlineDetail?: (e: Eero) => string | null;
  /** Shows the legend row at the bottom. */
  legend?: boolean;
  loading?: boolean;
  className?: string;
};

export function Topology({
  eeros,
  internet,
  wiredChip,
  selectedId,
  warnIds,
  onSelect,
  onOpen,
  networkOffline = false,
  offlineDetail,
  legend = true,
  loading = false,
  className,
}: TopologyProps) {
  const layout = layoutMesh(eeros, { internet: internet !== null, wanMbps: internet?.wanMbps, networkOffline });
  const gateway = layout.nodes.find((n) => n.eero.isGateway);
  const behind = behindOffline(eeros);
  const names = eeros.map((e) => e.location).join(", ");

  return (
    <div
      role="group"
      aria-label={`Mesh topology: ${names || "no eeros yet"}`}
      className={cn("relative h-[430px] overflow-hidden rounded-(--card-radius) border bg-card", className)}
    >
      <svg aria-hidden className="absolute inset-0 size-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        {layout.links.map((l) => (
          <path
            key={l.key}
            d={curve(l.from, l.to)}
            fill="none"
            stroke={LINK_COLOR[l.look.tone]}
            strokeWidth={l.look.kind === "wireless" && l.look.bars !== null && l.look.bars <= 2 ? 2 : 2.5}
            strokeDasharray={l.look.dashed ? (l.look.kind === "wireless" && (l.look.bars ?? 5) <= 2 ? "3 5" : "7 5") : undefined}
            vectorEffect="non-scaling-stroke"
            className="transition-opacity"
          />
        ))}
        {gateway && wiredChip && <path d={`M${gateway.x},${gateway.y + 20} L${gateway.x},${gateway.y + 30}`} stroke={LINK_COLOR.wired} strokeWidth={1.5} opacity={0.6} fill="none" vectorEffect="non-scaling-stroke" />}
      </svg>

      <div className={cn("absolute inset-0 transition-opacity", loading && "opacity-40")}>
        {layout.internet && (
          <MapNodeView at={layout.internet} size="sm" name="Internet" detail={internet?.label ?? "-"} muted={networkOffline}>
            <Globe />
          </MapNodeView>
        )}
        {layout.nodes.map((n) => {
          const Icon = eeroIcon(n.eero);
          const offline = n.eero.status === "offline";
          const detail = offline
            ? (offlineDetail?.(n.eero) ?? "Offline")
            : [n.eero.model, n.eero.isGateway ? "Gateway" : null].filter(Boolean).join(" · ") || "-";
          return (
            <MapNodeView
              key={n.eero.id}
              at={n}
              name={n.eero.location}
              detail={detail}
              size={n.eero.isGateway ? "lg" : "md"}
              selected={selectedId === n.eero.id}
              warn={warnIds?.has(n.eero.id) ?? false}
              muted={networkOffline || offline || behind.has(n.eero.id)}
              offline={offline || networkOffline}
              onClick={onSelect ? () => onSelect(n.eero.id) : undefined}
              onDoubleClick={onOpen ? () => onOpen(n.eero.id) : undefined}
            >
              <Icon />
            </MapNodeView>
          );
        })}
        {gateway && wiredChip && (
          <div
            className="absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-[10px] border bg-muted px-2.5 py-[5px] text-xs"
            style={{ left: `${gateway.x}%`, top: `${Math.min(88, gateway.y + 36)}%` }}
          >
            <Cable aria-hidden className="size-3.5" style={{ color: LINK_COLOR.wired }} />
            <span className="max-w-80 truncate">{wiredChip}</span>
          </div>
        )}
        {layout.links.map((l) =>
          l.look.label ? (
            <LinkChip
              key={l.key}
              look={l.look}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${(l.from.x + l.to.x) / 2}%`, top: `${(l.from.y + l.to.y) / 2}%` }}
            />
          ) : null,
        )}
      </div>

      {legend && (
        <>
          <div className="absolute bottom-3 left-4 flex flex-wrap gap-x-4 gap-y-1.5 text-muted-foreground text-xs">
            <LegendItem color={LINK_COLOR.wired}>Wired</LegendItem>
            <LegendItem color={LINK_COLOR.success}>Good (3 to 5 bars)</LegendItem>
            <LegendItem color={LINK_COLOR.warning}>Weak</LegendItem>
            <LegendItem color={LINK_COLOR.destructive}>Poor</LegendItem>
          </div>
          <div className="absolute right-3.5 bottom-3 text-2xs text-muted-foreground">Dashed lines are wireless backhaul</div>
        </>
      )}
    </div>
  );
}

function LegendItem({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <i aria-hidden className="size-2 rounded-[2px]" style={{ background: color }} />
      {children}
    </span>
  );
}

const PUCK_PX = { sm: 46, md: 54, lg: 68 } as const;

const PUCK = {
  sm: "size-[46px] rounded-[14px] [&_svg]:size-5",
  md: "size-[54px] rounded-[16px] [&_svg]:size-6",
  lg: "size-[68px] rounded-[20px] [&_svg]:size-[30px]",
} as const;

function MapNodeView({
  at,
  name,
  detail,
  size = "md",
  selected = false,
  warn = false,
  muted = false,
  offline = false,
  onClick,
  onDoubleClick,
  children,
}: {
  at: MapPoint;
  name: string;
  detail: string;
  size?: "sm" | "md" | "lg";
  selected?: boolean;
  warn?: boolean;
  muted?: boolean;
  offline?: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
  children: ReactNode;
}) {
  const interactive = onClick !== undefined;
  const Tag = interactive ? "button" : "div";
  return (
    <Tag
      {...(interactive ? { type: "button" as const, "aria-pressed": selected } : {})}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={cn(
        "absolute flex -translate-x-1/2 flex-col items-center gap-1.5 rounded-xl text-center outline-none",
        interactive && "cursor-pointer focus-visible:ring-2 focus-visible:ring-ring",
      )}
      // The puck's centre sits on the point, so links meet the puck, not the labels.
      style={{ left: `${at.x}%`, top: `calc(${at.y}% - ${PUCK_PX[size] / 2}px)` }}
    >
      <span
        className={cn(
          "grid place-items-center border bg-card text-foreground/80 outline-offset-4",
          PUCK[size],
          warn && !offline && "outline-2 outline-warning outline-dashed",
          selected && "outline-2 outline-muted-foreground/60 outline-solid",
          muted && "text-muted-foreground/60",
        )}
      >
        {children}
      </span>
      <span className={cn("whitespace-nowrap font-semibold text-[12.5px]", muted && "text-muted-foreground")}>{name}</span>
      <span className={cn("-mt-1 whitespace-nowrap text-[11px] text-muted-foreground", offline && "text-destructive-foreground")}>{detail}</span>
    </Tag>
  );
}
