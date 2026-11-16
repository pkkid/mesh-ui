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
import { Cable, Globe, Lamp, Maximize, Minus, Plus, Router } from "lucide-react";
import { type KeyboardEvent, type PointerEvent, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import type { Eero } from "../../../../core/model";

import { LINK_COLOR, LinkChip, type LinkLook, linkSpeed, uplinkLook } from "./LinkChip";

/** Coordinates are percent of the map box, so nodes (HTML) and links (SVG) agree. */
export type MapPoint = { x: number; y: number };
export type MapNode = MapPoint & { eero: Eero };
export type MapLink = { from: MapPoint; to: MapPoint; look: LinkLook; key: string; eeroId: string | null };

/** `chip` is the wired clients chip under the gateway, when there is one. */
export type MeshLayout = { internet: MapPoint | null; nodes: MapNode[]; links: MapLink[]; chip: MapPoint | null };

/** The map card's height in px; the layout turns px extents into percent with it. */
export const MAP_HEIGHT_PX = 430;
/** The wired clients chip sits this far (percent) below the gateway. */
const CHIP_DROP = 36;

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
export function layoutMesh(
  eeros: ReadonlyArray<Eero>,
  opts: { internet: boolean; wanMbps?: number | null; networkOffline?: boolean; wiredChip?: boolean },
): MeshLayout {
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

  const unshifted = [...placed.values()];
  const firstGateway = unshifted.find((n) => n.eero.isGateway) ?? null;
  const rawInternet = opts.internet ? { x: INTERNET_X, y: firstGateway?.y ?? MID_Y } : null;
  const rawChip = opts.wiredChip && firstGateway ? { x: firstGateway.x, y: firstGateway.y + CHIP_DROP } : null;

  // Centre the whole drawing (nodes, their labels, Internet and the chip) in the box.
  const box = meshBounds({ internet: rawInternet, nodes: unshifted, links: [], chip: rawChip }, { w: 0, h: MAP_HEIGHT_PX });
  const xs = [...unshifted.map((n) => n.x), ...(rawInternet ? [rawInternet.x] : [])];
  const dx = xs.length ? 50 - (Math.min(...xs) + Math.max(...xs)) / 2 : 0;
  const dy = Number.isFinite(box.y0) ? MID_Y - ((box.y0 + box.y1) / 2 / MAP_HEIGHT_PX) * 100 : 0;
  const shift = <T extends MapPoint>(p: T): T => ({ ...p, x: p.x + dx, y: p.y + dy });
  for (const [id, n] of placed) placed.set(id, shift(n));

  const nodes = [...placed.values()];
  const gateway = nodes.find((n) => n.eero.isGateway) ?? null;
  const internet = rawInternet && shift(rawInternet);
  const chip = rawChip && shift(rawChip);
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
  return { internet, nodes, links, chip };
}

/** Room a node takes around its point, in px: half its label width, the puck above, puck and two label lines below. */
const NODE_ROOM = {
  sm: { half: 56, up: 23, down: 23 + 36 },
  md: { half: 64, up: 27, down: 27 + 36 },
  lg: { half: 64, up: 34, down: 34 + 36 },
} as const;
const CHIP_ROOM = { half: 96, up: 14, down: 14 };

/**
 * The px box the drawing takes in a map box of `w` by `h` px: every node with
 * its labels, the Internet node and the wired chip. A zero `w` measures
 * width by the points alone.
 */
export function meshBounds(layout: MeshLayout, size: { w: number; h: number }): { x0: number; x1: number; y0: number; y1: number } {
  const items: Array<{ at: MapPoint; room: { half: number; up: number; down: number } }> = [
    ...layout.nodes.map((n) => ({ at: n as MapPoint, room: NODE_ROOM[n.eero.isGateway ? "lg" : "md"] })),
    ...(layout.internet ? [{ at: layout.internet, room: NODE_ROOM.sm }] : []),
    ...(layout.chip ? [{ at: layout.chip, room: CHIP_ROOM }] : []),
  ];
  const out = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
  for (const { at, room } of items) {
    const x = (at.x / 100) * size.w;
    const y = (at.y / 100) * size.h;
    const half = size.w ? room.half : 0;
    out.x0 = Math.min(out.x0, x - half);
    out.x1 = Math.max(out.x1, x + half);
    out.y0 = Math.min(out.y0, y - room.up);
    out.y1 = Math.max(out.y1, y + room.down);
  }
  return out;
}

/** Zoom and pan of the map layer: `x`, `y` in px from the box centre, then `scale` about the centre. */
export type MapView = { scale: number; x: number; y: number };

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2;
const ZOOM_STEP = 1.25;
const FIT_PAD = 16;
/** Room the legend row takes at the bottom of the card. */
const LEGEND_PX = 32;

const clampZoom = (s: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, s));

/**
 * The Fit view: the whole drawing centred in the box with padding, shrunk
 * when it does not fit (down to ZOOM_MIN) and never blown up past 100%.
 */
export function fitView(layout: MeshLayout, size: { w: number; h: number }, reserveBottom = 0): MapView {
  if (!size.w || !size.h || layout.nodes.length + (layout.internet ? 1 : 0) === 0) return { scale: 1, x: 0, y: 0 };
  const b = meshBounds(layout, size);
  const top = FIT_PAD;
  const bottom = size.h - FIT_PAD - reserveBottom;
  const scale = clampZoom(Math.min(1, (size.w - 2 * FIT_PAD) / (b.x1 - b.x0), (bottom - top) / (b.y1 - b.y0)));
  const cx = (b.x0 + b.x1) / 2 - size.w / 2;
  const cy = (b.y0 + b.y1) / 2 - size.h / 2;
  return { scale, x: -scale * cx, y: (top + bottom) / 2 - size.h / 2 - scale * cy };
}

/** Zooms by `factor`, keeping the point `at` (px from the box centre) still. */
export function zoomAt(view: MapView, factor: number, at: MapPoint = { x: 0, y: 0 }): MapView {
  const scale = clampZoom(view.scale * factor);
  const k = scale / view.scale;
  return { scale, x: at.x - k * (at.x - view.x), y: at.y - k * (at.y - view.y) };
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
  /**
   * Zoom (Ctrl or Cmd + wheel, pinch, + / - / Fit buttons, + - 0 keys) and pan
   * (drag). Off by default; the eeros page Map turns it on.
   */
  interactive?: boolean;
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
  interactive = false,
  className,
}: TopologyProps) {
  const layout = layoutMesh(eeros, { internet: internet !== null, wanMbps: internet?.wanMbps, networkOffline, wiredChip: Boolean(wiredChip) });
  const gateway = layout.nodes.find((n) => n.eero.isGateway);
  const behind = behindOffline(eeros);
  const names = eeros.map((e) => e.location).join(", ");
  const nav = useMapNav(layout, interactive, legend ? LEGEND_PX : 0);

  return (
    <div
      ref={nav.boxRef}
      role="group"
      aria-label={`Mesh topology: ${names || "no eeros yet"}`}
      {...(interactive
        ? {
            tabIndex: 0,
            "aria-keyshortcuts": "+ - 0",
            "aria-description": "Drag to pan, Ctrl or Command and scroll to zoom, 0 to fit",
            onKeyDown: nav.onKeyDown,
            onPointerDown: nav.onPointerDown,
            onPointerMove: nav.onPointerMove,
            onPointerUp: nav.onPointerEnd,
            onPointerCancel: nav.onPointerEnd,
            onClickCapture: nav.onClickCapture,
          }
        : {})}
      className={cn(
        "relative h-[430px] overflow-hidden rounded-(--card-radius) border bg-card",
        interactive && "select-none outline-none focus-visible:ring-2 focus-visible:ring-ring",
        interactive && (nav.dragging ? "cursor-grabbing" : "cursor-grab"),
        className,
      )}
    >
      <div
        className="absolute inset-0 origin-center"
        style={nav.view ? { transform: `translate(${nav.view.x}px, ${nav.view.y}px) scale(${nav.view.scale})` } : undefined}
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
          {gateway && wiredChip && layout.chip && <path d={`M${gateway.x},${gateway.y + 20} L${gateway.x},${layout.chip.y - 6}`} stroke={LINK_COLOR.wired} strokeWidth={1.5} opacity={0.6} fill="none" vectorEffect="non-scaling-stroke" />}
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
          {wiredChip && layout.chip && (
            <div
              className="absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-[10px] border bg-muted px-2.5 py-[5px] text-xs"
              style={{ left: `${layout.chip.x}%`, top: `${layout.chip.y}%` }}
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
      </div>

      {interactive && (
        <div data-map-controls className="absolute top-2.5 right-2.5 flex items-center gap-0.5 rounded-(--control-radius) border bg-card p-0.5">
          <Button variant="ghost-muted" size="icon-xs" aria-label="Zoom out" title="Zoom out (-)" disabled={nav.zoom <= ZOOM_MIN} onClick={nav.zoomOut}>
            <Minus />
          </Button>
          <Button variant="ghost-muted" size="icon-xs" aria-label="Zoom in" title="Zoom in (+)" disabled={nav.zoom >= ZOOM_MAX} onClick={nav.zoomIn}>
            <Plus />
          </Button>
          <Button variant="ghost-muted" size="icon-xs" aria-label="Fit" title="Fit (0)" onClick={nav.fit}>
            <Maximize />
          </Button>
        </div>
      )}

      {legend && (
        <>
          <div className="absolute bottom-2 left-2.5 flex flex-wrap gap-x-4 gap-y-1.5 rounded-md bg-card px-1.5 py-1 text-muted-foreground text-xs">
            <LegendItem color={LINK_COLOR.wired}>Wired</LegendItem>
            <LegendItem color={LINK_COLOR.success}>Good (3 to 5 bars)</LegendItem>
            <LegendItem color={LINK_COLOR.warning}>Weak</LegendItem>
            <LegendItem color={LINK_COLOR.destructive}>Poor</LegendItem>
          </div>
          <div className="absolute right-2 bottom-2 rounded-md bg-card px-1.5 py-1 text-2xs text-muted-foreground">Dashed lines are wireless backhaul</div>
        </>
      )}
    </div>
  );
}

const FIT_NONE: MapView = { scale: 1, x: 0, y: 0 };

/** A drag shorter than this (px) is still a click. */
const DRAG_SLOP = 4;

/** Zoom and pan state for the interactive Map; `view` is null when it is off. */
function useMapNav(layout: MeshLayout, enabled: boolean, reserveBottom: number) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  // null follows Fit, so the map refits on resize and new data until the user zooms or pans.
  const [manual, setManual] = useState<MapView | null>(null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ id: number; x: number; y: number; from: MapView; moved: boolean } | null>(null);
  const swallowClick = useRef(false);

  const view = enabled ? (manual ?? fitView(layout, size, reserveBottom)) : null;
  const viewRef = useRef(view);
  viewRef.current = view;

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!enabled || !el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [enabled]);

  // Ctrl or Cmd + wheel (and trackpad pinch, which arrives as Ctrl + wheel) zooms
  // about the pointer; a plain wheel scrolls the page. Needs a non-passive listener.
  useEffect(() => {
    const el = boxRef.current;
    if (!enabled || !el) return;
    const onWheel = (ev: WheelEvent) => {
      if ((!ev.ctrlKey && !ev.metaKey) || !viewRef.current) return;
      ev.preventDefault();
      const r = el.getBoundingClientRect();
      const delta = ev.deltaY * (ev.deltaMode === 1 ? 16 : 1);
      const rate = Math.abs(delta) < 50 ? 0.01 : 0.002; // pinch sends small steps, a wheel big ones
      const at = { x: ev.clientX - r.left - r.width / 2, y: ev.clientY - r.top - r.height / 2 };
      setManual((m) => zoomAt(m ?? viewRef.current ?? FIT_NONE, Math.exp(-delta * rate), at));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [enabled]);

  // Functional updates, so several steps before a re-render all count.
  const zoomBy = (factor: number) => setManual((m) => zoomAt(m ?? viewRef.current ?? FIT_NONE, factor));

  return {
    boxRef,
    view,
    dragging,
    zoom: view?.scale ?? 1,
    zoomIn: () => zoomBy(ZOOM_STEP),
    zoomOut: () => zoomBy(1 / ZOOM_STEP),
    fit: () => setManual(null),
    onKeyDown: (ev: KeyboardEvent<HTMLDivElement>) => {
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      if (ev.key === "+" || ev.key === "=") zoomBy(ZOOM_STEP);
      else if (ev.key === "-" || ev.key === "_") zoomBy(1 / ZOOM_STEP);
      else if (ev.key === "0") setManual(null);
      else return;
      ev.preventDefault();
    },
    onPointerDown: (ev: PointerEvent<HTMLDivElement>) => {
      swallowClick.current = false;
      if (ev.button !== 0 || !viewRef.current || (ev.target as Element).closest("[data-map-controls]")) return;
      drag.current = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, from: viewRef.current, moved: false };
    },
    onPointerMove: (ev: PointerEvent<HTMLDivElement>) => {
      const d = drag.current;
      if (!d || d.id !== ev.pointerId) return;
      const dx = ev.clientX - d.x;
      const dy = ev.clientY - d.y;
      if (!d.moved) {
        if (Math.hypot(dx, dy) < DRAG_SLOP) return;
        d.moved = true;
        ev.currentTarget.setPointerCapture(ev.pointerId);
        setDragging(true);
      }
      setManual({ ...d.from, x: d.from.x + dx, y: d.from.y + dy });
    },
    onPointerEnd: (ev: PointerEvent<HTMLDivElement>) => {
      const d = drag.current;
      if (!d || d.id !== ev.pointerId) return;
      drag.current = null;
      // A drag that started on a node must not also select it.
      swallowClick.current = d.moved;
      setDragging(false);
    },
    onClickCapture: (ev: { stopPropagation: () => void; preventDefault: () => void }) => {
      if (!swallowClick.current) return;
      swallowClick.current = false;
      ev.stopPropagation();
      ev.preventDefault();
    },
  };
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
