/**
 * The Signal page's charts (docs/ux/pages/signal.md). Hand-written SVG in the
 * chart kit's style (docs/design/design-system.md, Charts): horizontal
 * gridlines only, muted 10px labels, series colours from chartColors.ts, the
 * shared tooltip surface, opacity-only transitions. Every chart draws from
 * `wifi.health`, `wifi.insights` or `wifi.history`; none works anything out
 * that a command owns, only where things go on screen.
 *
 * Dot charts measure their box and draw at 1:1 (`useWidth`), so dots stay
 * round; line strips stretch with non-scaling strokes.
 */
import { type ReactNode, type PointerEvent as ReactPointerEvent, useLayoutEffect, useRef, useState } from "react";

import { Link, pathFor } from "~/app/router";
import { linePath } from "~/components/charts/curve";
import { niceScale } from "~/components/charts/scale";
import { FloatingTooltip } from "~/components/charts/Tooltip";
import { LINK_COLOR, LinkChip, uplinkLook } from "~/components/mesh/LinkChip";
import { fitBounds, MapControls, useMapNav } from "~/components/mesh/Topology";
import { bandColor, signalQualityColors, wifiGenerationColors } from "~/lib/chartColors";
import { cn } from "~/lib/utils";
import { formatCount, formatMbps, formatPercent, MISSING } from "../../../../core/format";
import type { Eero, MeshNode, SignalHistory, SignalPoint, SignalQuality, WifiGeneration, WifiHealth, WifiInsights, WirelessBand } from "../../../../core/model";
import { BAND_SPAN, channelMhz, channelSpan, SIGNAL_DBM } from "../../../../core/signal";

// ---------------------------------------------------------------------------
// Shared pieces

/** The dBm axis every signal chart uses: weak on the left, strong on the right. */
export const DBM_AXIS = { from: -90, to: -40 } as const;
const clampDbm = (v: number) => Math.max(DBM_AXIS.from, Math.min(DBM_AXIS.to, v));
const dbmShare = (v: number) => (clampDbm(v) - DBM_AXIS.from) / (DBM_AXIS.to - DBM_AXIS.from);

export const QUALITY_WORD: Record<SignalQuality, string> = { excellent: "Excellent", good: "Good", fair: "Fair", weak: "Weak" };
export const BAND_WORD: Record<WirelessBand, string> = { "2.4": "2.4 GHz", "5": "5 GHz", "6": "6 GHz" };
export const GENERATION_WORD: Record<WifiGeneration, string> = { wifi7: "Wi-Fi 7", wifi6e: "Wi-Fi 6E", wifi6: "Wi-Fi 6", wifi5: "Wi-Fi 5", wifi4: "Wi-Fi 4", unknown: "Unknown" };

/** One colour per quality across the page: success for excellent, a neutral for good, warning and danger for fair and weak. */
export const dotColor = (q: SignalQuality) => signalQualityColors[q];

/** The width of an element, kept up to date. */
function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

type Tip = { x: number; y: number; body: ReactNode } | null;

/** A tooltip that follows the pointer, on the shared surface (FloatingTooltip). */
function useTip() {
  const [tip, setTip] = useState<Tip>(null);
  const show = (e: { clientX: number; clientY: number }, body: ReactNode) => setTip({ x: e.clientX, y: e.clientY, body });
  const hide = () => setTip(null);
  const node = tip ? <FloatingTooltip at={{ pointer: { x: tip.x, y: tip.y } }}>{tip.body}</FloatingTooltip> : null;
  return { show, hide, node };
}

/** Tooltip body: a muted heading, then label and value rows. */
export function TipBody({ title, rows, children }: { title?: ReactNode; rows?: ReadonlyArray<[ReactNode, ReactNode, string?]>; children?: ReactNode }) {
  return (
    <div className="flex min-w-36 flex-col gap-0.5">
      {title !== undefined && <div className="mb-0.5 text-muted-foreground">{title}</div>}
      {rows?.map(([label, value, color], i) => (
        <div key={i} className="flex items-center justify-between gap-3">
          <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
            {color && <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: color }} />}
            <span className="truncate">{label}</span>
          </span>
          <span className="text-foreground tabular-nums">{value}</span>
        </div>
      ))}
      {children}
    </div>
  );
}

const deviceTip = (p: SignalPoint, eero: string | undefined) => (
  <TipBody
    title={
      <>
        <span className="font-medium text-foreground">{p.name}</span>
        {eero ? ` · ${eero}` : ""}
      </>
    }
    rows={[
      ["Signal", `${p.dbm} dBm, ${QUALITY_WORD[p.quality].toLowerCase()}`, dotColor(p.quality)],
      ["Band", BAND_WORD[p.band], bandColor(p.band)],
      ["Link speed", formatMbps(p.rxMbps)],
    ]}
  />
);

/** Up to `max` names with "and N more", for tooltips over crowded spots. */
const someNames = (names: string[], max = 6) => (names.length <= max ? names : [...names.slice(0, max), `and ${names.length - max} more`]);

const AXIS_TEXT = "fill-muted-foreground text-[10px] tabular-nums";

// ---------------------------------------------------------------------------
// Hero: signal by eero

/**
 * One strip per eero: a thin line per device at its dBm, in its band's
 * colour, over the quality zones, with a taller line at the eero's median.
 * Lines, not dots, so a network of 200 devices still reads: crowded stretches
 * just get denser.
 */
export function SignalStrips({ health, names }: { health: WifiHealth | undefined; names: Map<string, string> }) {
  const tip = useTip();
  const rows = (health?.mesh ?? []).filter((n) => n.devices > 0);
  const zones: [number, number, SignalQuality][] = [
    [DBM_AXIS.from, SIGNAL_DBM.fair, "weak"],
    [SIGNAL_DBM.fair, SIGNAL_DBM.good, "fair"],
    [SIGNAL_DBM.good, SIGNAL_DBM.excellent, "good"],
    [SIGNAL_DBM.excellent, DBM_AXIS.to, "excellent"],
  ];
  const move = (e: ReactPointerEvent<SVGSVGElement>, node: MeshNode) => {
    const box = e.currentTarget.getBoundingClientRect();
    const dbm = DBM_AXIS.from + ((e.clientX - box.left) / box.width) * (DBM_AXIS.to - DBM_AXIS.from);
    const near = (health?.points ?? []).filter((p) => p.eeroId === node.eeroId && Math.abs(clampDbm(p.dbm) - dbm) <= 2);
    if (!near.length) return tip.hide();
    const at = Math.round(near.reduce((n, p) => n + p.dbm, 0) / near.length);
    tip.show(e, <TipBody title={`${node.eero} · about ${at} dBm`} rows={someNames(near.map((p) => p.name)).map((n) => [n, ""])} />);
  };
  return (
    <div data-slot="signal-strips" className="flex flex-col gap-1.5" role="img" aria-label="Each wireless device's signal, one strip per eero">
      <div className="grid grid-cols-[6.5rem_minmax(0,1fr)_2rem] gap-x-3">
        <span />
        <div className="relative h-4">
          {zones.map(([a, b, q]) => (
            <span key={q} className={cn("absolute top-0 -translate-x-1/2 text-3xs", q === "weak" ? "text-destructive-foreground" : "text-muted-foreground")} style={{ left: `${((dbmShare(a) + dbmShare(b)) / 2) * 100}%` }}>
              {QUALITY_WORD[q]}
            </span>
          ))}
        </div>
        <span />
      </div>
      {rows.map((node) => (
        <div key={node.eeroId} className="grid grid-cols-[6.5rem_minmax(0,1fr)_2rem] items-center gap-x-3">
          <span className="truncate text-xs" title={names.get(node.eeroId)}>
            {node.eero}
          </span>
          <svg viewBox="0 0 1000 24" preserveAspectRatio="none" className="h-6 w-full" onPointerMove={(e) => move(e, node)} onPointerLeave={tip.hide}>
            <rect x={0} width={1000} y={3} height={18} rx={3} className="fill-foreground/4" />
            <rect x={0} width={dbmShare(SIGNAL_DBM.fair) * 1000} y={3} height={18} className="fill-destructive/10" />
            {(health?.points ?? [])
              .filter((p) => p.eeroId === node.eeroId)
              .map((p) => (
                <line key={p.deviceId} x1={dbmShare(p.dbm) * 1000} x2={dbmShare(p.dbm) * 1000} y1={5} y2={19} stroke={bandColor(p.band)} strokeWidth={2} strokeOpacity={0.85} vectorEffect="non-scaling-stroke" />
              ))}
            {node.medianDbm !== null && <line x1={dbmShare(node.medianDbm) * 1000} x2={dbmShare(node.medianDbm) * 1000} y1={0} y2={24} className="stroke-foreground" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
          </svg>
          <span className="text-right text-muted-foreground text-xs tabular-nums">{formatCount(node.devices)}</span>
        </div>
      ))}
      {!health && <div className="h-24" />}
      <div className="grid grid-cols-[6.5rem_minmax(0,1fr)_2rem] gap-x-3 text-3xs text-muted-foreground tabular-nums">
        <span />
        <div className="flex justify-between">
          <span>{DBM_AXIS.from} dBm</span>
          <span>{SIGNAL_DBM.good} dBm</span>
          <span>{DBM_AXIS.to} dBm</span>
        </div>
        <span />
      </div>
      {tip.node}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mesh map

const MAP_H = 380;
/** Room under each eero's outer ring for its name. */
const LABEL_H = 22;

type Placed = { node: MeshNode; x: number; y: number };

/** eeros in columns by hop from the gateway, each column spread down the box and ordered by its upstream's place. */
function placeMesh(mesh: ReadonlyArray<MeshNode>, width: number): { placed: Placed[]; radius: number } {
  const hopOf = (n: MeshNode) => (n.isGateway ? 0 : (n.hop ?? 1));
  const hops = [...new Set(mesh.map(hopOf))].sort((a, b) => a - b);
  const cols = hops.length;
  const tallest = Math.max(1, ...hops.map((h) => mesh.filter((n) => hopOf(n) === h).length));
  const colGap = cols > 1 ? (width - 40) / cols : width;
  const rowGap = (MAP_H - 20) / tallest;
  const radius = Math.max(30, Math.min(80, colGap * 0.42, (rowGap - LABEL_H) * 0.48));
  const placed = new Map<string, Placed>();
  hops.forEach((hop, c) => {
    const x = cols > 1 ? 20 + colGap * (c + 0.5) : width / 2;
    const column = mesh
      .filter((n) => hopOf(n) === hop)
      .sort((a, b) => (placed.get(a.upstream ?? "")?.y ?? 0) - (placed.get(b.upstream ?? "")?.y ?? 0) || a.eero.localeCompare(b.eero));
    const step = (MAP_H - 20) / column.length;
    // Stagger lone eeros a little so links do not run flat through the next eero's devices; the name sits under the ring.
    const stagger = column.length === 1 && c > 0 ? (c % 2 ? -0.08 : 0.08) * MAP_H : 0;
    column.forEach((node, i) => placed.set(node.eeroId, { node, x, y: 10 + step * (i + 0.5) - LABEL_H / 2 + stagger }));
  });
  return { placed: [...placed.values()], radius };
}

/**
 * The mesh as a map: each eero with its devices around it, nearer for a
 * stronger signal, and its link to the eero it connects through (wired solid,
 * Wi-Fi dashed, weak links in the warning colour, as the eeros page draws
 * them). The dashed red ring is -75 dBm: dots outside it are weak. Zooms and
 * pans as the eeros page Map does (drag, Ctrl or Command and scroll, + - 0).
 */
export function MeshMap({ health, eeros, colors }: { health: WifiHealth | undefined; eeros: ReadonlyArray<Eero> | undefined; colors: Record<string, string> }) {
  const tip = useTip();
  const mesh = health?.mesh ?? [];
  const nav = useMapNav((size) => {
    const { placed: p, radius: r } = placeMesh(mesh, size.w);
    if (!p.length) return { scale: 1, x: 0, y: 0 };
    return fitBounds({ x0: Math.min(...p.map((q) => q.x)) - r, x1: Math.max(...p.map((q) => q.x)) + r, y0: Math.min(...p.map((q) => q.y)) - r, y1: Math.max(...p.map((q) => q.y)) + r + LABEL_H }, size);
  }, true);
  const width = nav.size.w;
  const { placed, radius } = placeMesh(mesh, width || 600);
  const at = new Map(placed.map((p) => [p.node.eeroId, p]));
  const inner = Math.min(16, radius * 0.3);
  const rad = (dbm: number) => inner + (1 - dbmShare(dbm)) * (radius - inner);
  const crowded = (health?.points.length ?? 0) > 120;
  const eeroOf = (id: string) => eeros?.find((e) => e.id === id);
  return (
    <div
      ref={nav.boxRef}
      role="group"
      aria-label="Mesh map: each eero, its link to the mesh, and its devices placed by signal strength"
      tabIndex={0}
      aria-keyshortcuts="+ - 0"
      aria-description="Drag to pan, Ctrl or Command and scroll to zoom, 0 to fit"
      onKeyDown={nav.onKeyDown}
      onPointerDown={nav.onPointerDown}
      onPointerMove={nav.onPointerMove}
      onPointerUp={nav.onPointerEnd}
      onPointerCancel={nav.onPointerEnd}
      onClickCapture={nav.onClickCapture}
      className={cn(
        "relative w-full select-none overflow-hidden rounded-(--card-radius) border border-border/60 bg-card/40 shadow-xs/5 outline-none focus-visible:ring-2 focus-visible:ring-ring",
        nav.dragging ? "cursor-grabbing" : "cursor-grab",
      )}
      style={{ height: MAP_H }}
    >
      <div className="absolute inset-0 origin-center" style={nav.view ? { transform: `translate(${nav.view.x}px, ${nav.view.y}px) scale(${nav.view.scale})` } : undefined}>
        {width > 0 && (
          <svg width={width} height={MAP_H} viewBox={`0 0 ${width} ${MAP_H}`} className="absolute inset-0 overflow-visible">
            {placed.map(({ node, x, y }) => (
              <g key={`r${node.eeroId}`}>
                <circle cx={x} cy={y} r={rad(SIGNAL_DBM.good)} fill="none" className="stroke-border" />
                <circle cx={x} cy={y} r={rad(SIGNAL_DBM.fair)} fill="none" className="stroke-destructive/35" strokeDasharray="3 3" />
              </g>
            ))}
            {placed.map(({ node, x, y }) => {
              const up = node.upstream ? at.get(node.upstream) : undefined;
              const e = eeroOf(node.eeroId);
              if (!up || !e) return null;
              const look = uplinkLook(e);
              return <line key={`l${node.eeroId}`} x1={up.x} y1={up.y} x2={x} y2={y} stroke={LINK_COLOR[look.tone]} strokeWidth={2} strokeDasharray={look.dashed ? "5 4" : undefined} />;
            })}
            {placed.map(({ node, x, y }) => {
              const on = (health?.points ?? []).filter((p) => p.eeroId === node.eeroId);
              return on.map((p, i) => {
                const a = -Math.PI / 2 + (i / on.length) * Math.PI * 2 + 0.3;
                const r = rad(p.dbm);
                return (
                  <circle
                    key={p.deviceId}
                    cx={x + Math.cos(a) * r}
                    cy={y + Math.sin(a) * r}
                    r={crowded ? 2.5 : 3.5}
                    fill={dotColor(p.quality)}
                    onPointerMove={(ev) => tip.show(ev, deviceTip(p, node.eero))}
                    onPointerLeave={tip.hide}
                  />
                );
              });
            })}
            {placed.map(({ node, x, y }) => (
              <g
                key={`n${node.eeroId}`}
                onPointerMove={(ev) =>
                  tip.show(
                    ev,
                    <TipBody
                      title={
                        <>
                          <span className="font-medium text-foreground">{node.eero}</span>
                          {node.model ? ` · ${node.model}` : ""}
                        </>
                      }
                      rows={[
                        ["Devices", formatCount(node.devices)],
                        ["Weak", formatCount(node.weak)],
                        ["Median signal", node.medianDbm === null ? MISSING : `${node.medianDbm} dBm`],
                      ]}
                    />,
                  )
                }
                onPointerLeave={tip.hide}
              >
                <circle cx={x} cy={y} r={11} className="fill-card" stroke={colors[node.eeroId]} strokeWidth={2.5} />
                {node.isGateway && <circle cx={x} cy={y} r={4} fill={colors[node.eeroId]} />}
              </g>
            ))}
          </svg>
        )}
        {width > 0 &&
          placed.map(({ node, x, y }) => {
            const up = node.upstream ? at.get(node.upstream) : undefined;
            const e = eeroOf(node.eeroId);
            return (
              <div key={`h${node.eeroId}`}>
                <span className="pointer-events-none absolute -translate-x-1/2 whitespace-nowrap font-medium text-xs" style={{ left: x, top: y + radius + 4 }}>
                  {node.eero}
                </span>
                {up && e && <LinkChip look={uplinkLook(e)} className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2" style={{ left: (x + up.x) / 2, top: (y + up.y) / 2 }} />}
              </div>
            );
          })}
      </div>
      <MapControls nav={nav} />
      {/* Outside the zoomed layer, on the box's own colour (page background under card/40), so it stays readable over the drawing. */}
      <span className="pointer-events-none absolute bottom-2 left-2.5 rounded-md bg-background">
        <span className="block rounded-md bg-card/40 px-1.5 py-1 text-muted-foreground text-xs">Nearer its eero is a stronger signal</span>
      </span>
      {tip.node}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Signal and speed

const SCATTER_H = 250;
const SCATTER_ZONES: [number, number, SignalQuality][] = [
  [DBM_AXIS.from, SIGNAL_DBM.fair, "weak"],
  [SIGNAL_DBM.fair, SIGNAL_DBM.good, "fair"],
  [SIGNAL_DBM.good, SIGNAL_DBM.excellent, "good"],
  [SIGNAL_DBM.excellent, DBM_AXIS.to, "excellent"],
];
const GUTTER = 56;

/**
 * Link speed against signal, one dot per device in its band's colour, on a
 * log speed scale, over faint columns in the signal quality colours. Opposite corners are labelled: fast and strong (top
 * right, success) and slow and weak (bottom left, destructive).
 */
export function SignalScatter({ health, names, loading }: { health: WifiHealth | undefined; names: Map<string, string>; loading: boolean }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const tip = useTip();
  const points = (health?.points ?? []).filter((p) => p.rxMbps !== null && p.rxMbps > 0);
  const top = Math.max(1000, ...points.map((p) => p.rxMbps ?? 0));
  const bottom = Math.min(5, ...points.map((p) => p.rxMbps ?? 5));
  const lo = Math.log10(bottom * 0.8);
  const hi = Math.log10(top * 1.25);
  const plotW = Math.max(1, width - GUTTER - 4);
  const x = (dbm: number) => GUTTER + dbmShare(dbm) * plotW;
  const y = (mbps: number) => 6 + (1 - (Math.log10(mbps) - lo) / (hi - lo)) * (SCATTER_H - 26);
  const ticks = [1, 10, 100, 1000, 10000].filter((t) => t >= bottom * 0.8 && t <= top * 1.25);
  const r = points.length > 80 ? 2.6 : 3.6;
  return (
    <div ref={ref} className={cn("relative w-full transition-opacity", loading && "opacity-40")} style={{ height: SCATTER_H }}>
      {width > 0 && (
        <svg width={width} height={SCATTER_H} viewBox={`0 0 ${width} ${SCATTER_H}`} role="img" aria-label="Link speed against signal for every wireless device">
          {/* Signal quality as faint columns behind the dots, from weak on the left to excellent on the right. */}
          {SCATTER_ZONES.map(([from, to, q]) => (
            <rect key={q} x={x(from)} width={x(to) - x(from)} y={6} height={SCATTER_H - 26} fill={signalQualityColors[q]} fillOpacity={0.07} />
          ))}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={GUTTER} x2={width} y1={y(t)} y2={y(t)} className="stroke-border" />
              <text x={GUTTER - 8} y={y(t) + 3} textAnchor="end" className={AXIS_TEXT}>
                {formatMbps(t)}
              </text>
            </g>
          ))}
          {/* The two ends of the scale: top right is where a device wants to be, bottom left where it struggles. */}
          <text x={width - 6} y={18} textAnchor="end" className="fill-success-foreground text-[10px]">
            Fast and strong
          </text>
          <text x={GUTTER + 6} y={SCATTER_H - 26} className="fill-destructive-foreground text-[10px]">
            Slow and weak
          </text>
          {[...points]
            // Problems drawn last, so a weak or fair dot is never hidden under a good one.
            .sort((a, b) => b.dbm - a.dbm)
            .map((p) => (
              <circle
                key={p.deviceId}
                cx={x(p.dbm)}
                cy={y(p.rxMbps as number)}
                r={r}
                fill={bandColor(p.band)}
                className="stroke-card"
                strokeWidth={1}
                onPointerMove={(e) => tip.show(e, deviceTip(p, p.eeroId ? names.get(p.eeroId) : undefined))}
                onPointerLeave={tip.hide}
              />
            ))}
          {[DBM_AXIS.from, SIGNAL_DBM.good, DBM_AXIS.to].map((v, i) => (
            <text key={v} x={x(v)} y={SCATTER_H - 4} textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"} className={AXIS_TEXT}>
              {v} dBm
            </text>
          ))}
        </svg>
      )}
      {health && points.length === 0 && <p className="absolute inset-0 grid place-items-center text-muted-foreground text-sm">No link speeds reported.</p>}
      {tip.node}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Airwaves

const ROW_H = 72;
const BAND_GUTTER = 72;
/** Room above the tallest arch for two lines of labels (crowded labels stack). */
const LABEL_ROOM = 28;
const LABEL_LINE = 12;
/** Rough width of a 10.5px label character, to keep labels apart without measuring. */
const LABEL_CHAR = 5.6;

/** A flat-topped arch from x0 to x1 rising to `top`: a radio's channel, as a spectrum analyser draws it. */
const archPath = (x0: number, x1: number, base: number, top: number) => {
  const w = x1 - x0;
  return `M${x0},${base} C${x0 + w * 0.12},${base} ${x0 + w * 0.08},${top} ${x0 + w * 0.24},${top} L${x1 - w * 0.24},${top} C${x1 - w * 0.08},${top} ${x1 - w * 0.12},${base} ${x1},${base}`;
};

/**
 * Each eero's radios where they sit on their band: an arch as wide as the
 * channel and as tall as how busy it is (channel utilization), in the eero's
 * colour. Overlapping arches share airtime; empty stretches are free.
 */
export function Airwaves({ health, colors, loading }: { health: WifiHealth | undefined; colors: Record<string, string>; loading: boolean }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const tip = useTip();
  const bands = (health?.bands ?? []).map((b) => b.band);
  const radios = (health?.radios ?? []).flatMap((row) => row.bands.filter((b) => b.channel !== null).map((b) => ({ ...b, eeroId: row.eeroId, eero: row.eero })));
  // The busiest arch fills the row, less a line for its label; every band shares the scale, so heights compare.
  const peak = Math.max(5, ...radios.map((r) => r.utilization ?? 0));
  const ticks = niceScale(peak, 2).ticks.filter((t) => t <= peak);
  const tall = ROW_H - LABEL_ROOM;
  const lift = (u: number) => (u / peak) * tall;
  const height = Math.max(1, bands.length) * (ROW_H + 30);
  return (
    <div ref={ref} className={cn("relative w-full transition-opacity", loading && "opacity-40")} style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Each eero radio on its band's channels; height is how busy the channel is">
          {bands.map((band, row) => {
            const span = BAND_SPAN[band];
            const y0 = row * (ROW_H + 30) + 14;
            const base = y0 + ROW_H;
            const x = (mhz: number) => BAND_GUTTER + ((mhz - span.lo) / (span.hi - span.lo)) * (width - BAND_GUTTER - 4);
            const h = (u: number) => Math.max(4, lift(u));
            const on = radios.filter((r) => r.band === band).sort((a, b) => (b.utilization ?? 0) - (a.utilization ?? 0));
            // One label per stretch of spectrum, naming every radio on it, above the tallest arch.
            const labels = new Map<number, { x: number; top: number; words: string[] }>();
            for (const r of on) {
              const s = channelSpan(band, r.channel as number, r.widthMhz);
              const key = Math.round(s.center);
              const top = base - h(r.utilization ?? 0);
              const l = labels.get(key) ?? { x: x(s.center), top, words: [] };
              l.top = Math.min(l.top, top);
              l.words.push(`${r.eero} ${r.utilization === null ? MISSING : formatPercent(r.utilization)}`);
              labels.set(key, l);
            }
            // Left to right, each label centred over its arch and kept inside the plot; one that would
            // overlap a label already placed on its line moves up a line.
            const placed: { lo: number; hi: number; line: number }[] = [];
            const texts = [...labels.values()]
              .sort((a, b) => a.x - b.x)
              .map((l) => {
                const text = l.words.join(" · ");
                const w = text.length * LABEL_CHAR;
                const lo = Math.max(BAND_GUTTER, Math.min(width - 2 - w, l.x - w / 2));
                let line = 0;
                while (placed.some((p) => p.line === line && lo < p.hi + 8 && lo + w > p.lo - 8)) line++;
                placed.push({ lo, hi: lo + w, line });
                return { key: l.x, text, x: lo, y: Math.max(y0 + 9, l.top - 5 - line * LABEL_LINE) };
              });
            return (
              <g key={band}>
                <rect x={0} y={y0 + 1} width={8} height={8} rx={2} fill={bandColor(band)} />
                <text x={14} y={y0 + 9} className="fill-foreground font-medium text-xs">
                  {BAND_WORD[band]}
                </text>
                {ticks.map((t) => (
                  <line key={t} x1={BAND_GUTTER} x2={width} y1={base - lift(t)} y2={base - lift(t)} className="stroke-border" strokeDasharray={t === 0 ? undefined : "2 4"} />
                ))}
                {/* Busy steps in the gutter, under the band name, as every chart's y labels sit to the left. */}
                {ticks
                  .filter((t) => t > 0 && base - lift(t) > y0 + 20)
                  .map((t) => (
                    <text key={t} x={BAND_GUTTER - 8} y={base - lift(t) + 3} textAnchor="end" className={AXIS_TEXT}>
                      {t}% busy
                    </text>
                  ))}
                {span.ticks.map((c) => (
                  <text key={c} x={x(channelMhz(band, c))} y={base + 13} textAnchor="middle" className={AXIS_TEXT}>
                    {c}
                  </text>
                ))}
                {on.map((r, i) => {
                  const s = channelSpan(band, r.channel as number, r.widthMhz);
                  const d = archPath(x(s.lo), x(s.hi), base, base - h(r.utilization ?? 0));
                  const color = colors[r.eeroId] ?? "currentColor";
                  const body = (
                    <TipBody
                      title={
                        <>
                          <span className="font-medium text-foreground">{r.eero}</span> · {BAND_WORD[band]}
                        </>
                      }
                      rows={[
                        ["Channel", `${r.channel}${r.widthMhz ? `, ${r.widthMhz} MHz` : ""}`],
                        ["Busy", r.utilization === null ? MISSING : formatPercent(r.utilization)],
                        ["Devices", r.devices === null ? MISSING : formatCount(r.devices)],
                        ["Transmit power", r.txPowerDbm === null ? MISSING : `${r.txPowerDbm} dBm`],
                      ]}
                    />
                  );
                  return (
                    <g key={i} onPointerMove={(e) => tip.show(e, body)} onPointerLeave={tip.hide}>
                      <path d={`${d} Z`} fill={color} fillOpacity={0.12} />
                      <path d={d} fill="none" stroke={color} strokeWidth={2} />
                    </g>
                  );
                })}
                {texts.map((l) => (
                  <text key={l.key} x={l.x} y={l.y} className="fill-foreground text-[10.5px] tabular-nums">
                    {l.text}
                  </text>
                ))}
              </g>
            );
          })}
        </svg>
      )}
      {tip.node}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Wi-Fi generations

const FLOW_H = 280;
const NODE_W = 10;

/**
 * Devices flowing from the newest Wi-Fi generation they support (left) to the
 * one they connect with (right). Flows that stay level are faint; flows that
 * drop to an older generation carry the colour of what they could use.
 */
export function GenerationFlow({ insights, loading }: { insights: WifiInsights | undefined; loading: boolean }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const tip = useTip();
  const flows = insights?.flows ?? [];
  const total = flows.reduce((n, f) => n + f.devices.length, 0);
  const order: WifiGeneration[] = ["wifi7", "wifi6e", "wifi6", "wifi5", "wifi4", "unknown"];
  const left = order.filter((g) => flows.some((f) => f.supports === g));
  const right = order.filter((g) => flows.some((f) => f.current === g));
  const gap = 8;
  const usable = FLOW_H - 22 - gap * Math.max(left.length, right.length);
  const k = total ? usable / total : 0;
  const L = 96;
  const R = Math.max(L + 40, width - 96);
  const stack = (gens: WifiGeneration[], key: "supports" | "current") => {
    let y = 20;
    const out = new Map<WifiGeneration, { y: number; h: number; n: number; off: number }>();
    for (const g of gens) {
      const n = flows.filter((f) => f[key] === g).reduce((s, f) => s + f.devices.length, 0);
      out.set(g, { y, h: n * k, n, off: 0 });
      y += n * k + gap;
    }
    return out;
  };
  const ls = stack(left, "supports");
  const rs = stack(right, "current");
  return (
    <div ref={ref} className={cn("relative w-full transition-opacity", loading && "opacity-40")} style={{ height: FLOW_H }}>
      {width > 0 && total > 0 && (
        <svg width={width} height={FLOW_H} viewBox={`0 0 ${width} ${FLOW_H}`} role="img" aria-label="Devices by the Wi-Fi generation they support, flowing to the one they connect with">
          <text x={L} y={10} textAnchor="end" className={AXIS_TEXT}>
            Supports
          </text>
          <text x={width} y={10} textAnchor="end" className={AXIS_TEXT}>
            Connected with
          </text>
          {flows.map((f) => {
            const a = ls.get(f.supports);
            const b = rs.get(f.current);
            if (!a || !b) return null;
            const h = f.devices.length * k;
            const ys = a.y + a.off;
            const yc = b.y + b.off;
            a.off += h;
            b.off += h;
            const mx = (L + R) / 2;
            const down = f.supports !== f.current && f.current !== "unknown";
            const d = `M${L},${ys} C${mx},${ys} ${mx},${yc} ${R},${yc} L${R},${yc + h} C${mx},${yc + h} ${mx},${ys + h} ${L},${ys + h} Z`;
            return (
              <path
                key={`${f.supports}>${f.current}`}
                d={d}
                fill={down ? wifiGenerationColors[f.supports] : "currentColor"}
                fillOpacity={down ? 0.45 : 0.07}
                className="text-foreground"
                onPointerMove={(e) =>
                  tip.show(
                    e,
                    <TipBody
                      title={`${GENERATION_WORD[f.supports]} to ${GENERATION_WORD[f.current]}`}
                      rows={[["Devices", formatCount(f.devices.length)]]}
                    >
                      <div className="mt-1 max-w-80 text-foreground leading-normal">{someNames([...f.devices.map((d) => d.name)].sort((a, b) => a.localeCompare(b)), 40).join(", ")}</div>
                    </TipBody>,
                  )
                }
                onPointerLeave={tip.hide}
              />
            );
          })}
          {[...ls].map(([g, s]) => (
            <g key={`l${g}`}>
              <rect x={L - NODE_W} y={s.y} width={NODE_W} height={Math.max(2, s.h)} rx={2} fill={wifiGenerationColors[g]} />
              <text x={L - NODE_W - 6} y={s.y + s.h / 2 + 4} textAnchor="end" className="fill-foreground text-[11px] tabular-nums">
                {GENERATION_WORD[g]} · {s.n}
              </text>
            </g>
          ))}
          {[...rs].map(([g, s]) => (
            <g key={`r${g}`}>
              <rect x={R} y={s.y} width={NODE_W} height={Math.max(2, s.h)} rx={2} fill={wifiGenerationColors[g]} />
              <text x={R + NODE_W + 6} y={s.y + s.h / 2 + 4} className="fill-foreground text-[11px] tabular-nums">
                {GENERATION_WORD[g]} · {s.n}
              </text>
            </g>
          ))}
        </svg>
      )}
      {insights && total === 0 && <p className="absolute inset-0 grid place-items-center text-muted-foreground text-sm">No wireless devices.</p>}
      {tip.node}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Signal history

const LINE_W = 600;
const LINE_H = 30;
const HIST = { from: -95, to: -40 } as const;

/**
 * One line per device across the window, on one shared dBm scale, in the
 * colour of its median quality, broken where it dropped off (a faint red
 * band). The dashed line is -75 dBm.
 */
export function HistoryLines({ history, loading }: { history: SignalHistory | undefined; loading: boolean }) {
  const tip = useTip();
  const n = history?.at.length ?? 0;
  const xAt = (i: number) => (n < 2 ? LINE_W : (i / (n - 1)) * LINE_W);
  const yAt = (v: number) => LINE_H - 2 - ((Math.max(HIST.from, Math.min(HIST.to, v)) - HIST.from) / (HIST.to - HIST.from)) * (LINE_H - 4);
  const weakY = yAt(SIGNAL_DBM.fair);
  const minutes = history?.from && history.to ? Math.max(1, Math.round((Date.parse(history.to) - Date.parse(history.from)) / 60_000)) : 0;
  return (
    <div className={cn("flex h-full min-h-0 flex-col transition-opacity", loading && "opacity-40")}>
      {/* The time axis on top, fixed; rows fill the box (on wide screens the height beside it, else about seven rows) and scroll under it, fading at an edge while there is more that way. */}
      {history && history.devices.length > 0 && (
        <div className="grid grid-cols-[9rem_minmax(0,1fr)] gap-3 pb-1 text-3xs text-muted-foreground">
          <span />
          <div className="flex justify-between">
            <span>{minutes}m ago</span>
            <span>Now</span>
          </div>
        </div>
      )}
      <div className="scroll-fade-y -mr-2 max-h-[21rem] min-h-0 flex-1 overflow-y-auto pr-2 lg:max-h-none">
      {(history?.devices ?? []).map((d) => {
        const runs: { x: number; y: number }[][] = [];
        const gaps: [number, number][] = [];
        let run: { x: number; y: number }[] = [];
        let gapStart: number | null = null;
        d.dbm.forEach((v, i) => {
          if (v === null) {
            if (run.length) runs.push(run);
            run = [];
            if (gapStart === null && runs.length) gapStart = i;
          } else {
            if (gapStart !== null) gaps.push([gapStart, i]);
            gapStart = null;
            run.push({ x: xAt(i), y: yAt(v) });
          }
        });
        if (run.length) runs.push(run);
        const q = d.medianDbm === null ? "good" : d.medianDbm >= SIGNAL_DBM.excellent ? "excellent" : d.medianDbm >= SIGNAL_DBM.good ? "good" : d.medianDbm >= SIGNAL_DBM.fair ? "fair" : "weak";
        const move = (e: ReactPointerEvent<SVGSVGElement>) => {
          const box = e.currentTarget.getBoundingClientRect();
          const i = Math.round(((e.clientX - box.left) / box.width) * (n - 1));
          const v = d.dbm[i];
          const at = history?.at[i];
          const ago = at && history?.to ? Math.round((Date.parse(history.to) - Date.parse(at)) / 60_000) : 0;
          tip.show(e, <TipBody title={`${d.name} · ${ago === 0 ? "now" : `${ago}m ago`}`} rows={[["Signal", v === null || v === undefined ? "Not connected" : `${v} dBm`]]} />);
        };
        return (
          <div key={d.deviceId} className="grid grid-cols-[9rem_minmax(0,1fr)] items-center gap-3 border-border/50 border-b py-1.5 last:border-b-0">
            {/* Drops (or the median) under the name, so the line gets the rest of the row. */}
            <span className="min-w-0">
              <Link to={pathFor("device", { deviceId: d.deviceId })} className="block truncate text-[13px] outline-none hover:underline focus-visible:underline">
                {d.name}
              </Link>
              <span className="block text-3xs tabular-nums">
                {d.drops > 0 ? (
                  <span className="text-destructive-foreground" title="Times it dropped off the network, shaded red on its line">
                    {d.drops === 1 ? "Dropped once" : `Dropped ${d.drops}x`}
                  </span>
                ) : (
                  <span className="text-muted-foreground">{d.medianDbm === null ? MISSING : `Median ${d.medianDbm} dBm`}</span>
                )}
              </span>
            </span>
            <svg viewBox={`0 0 ${LINE_W} ${LINE_H}`} preserveAspectRatio="none" className="h-[30px] w-full" onPointerMove={move} onPointerLeave={tip.hide} role="img" aria-label={`${d.name}'s signal over the window`}>
              {gaps.map(([a, b]) => (
                <rect key={a} x={xAt(a) - 2} width={xAt(b) - xAt(a)} y={0} height={LINE_H} className="fill-destructive/15" />
              ))}
              <line x1={0} x2={LINE_W} y1={weakY} y2={weakY} className="stroke-destructive/40" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
              {runs.map((r, i) => (
                <path key={i} d={linePath(r)} fill="none" stroke={signalQualityColors[q]} strokeWidth={2} vectorEffect="non-scaling-stroke" />
              ))}
            </svg>
          </div>
        );
      })}
      </div>
      {history && history.devices.length === 0 && <p className="py-6 text-center text-muted-foreground text-sm">Recording. Lines appear after a few minutes with Mesh UI open.</p>}
      {tip.node}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Retries

const RETRY_H = 190;

/**
 * Retries against signal. Most devices sit low; one high up with a decent
 * signal points at interference near it rather than distance, and is named.
 */
export function RetryScatter({ health, names, flagged, loading }: { health: WifiHealth | undefined; names: Map<string, string>; flagged: Set<string>; loading: boolean }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const tip = useTip();
  const points = (health?.points ?? []).filter((p) => p.retryPct !== null);
  const scale = niceScale(Math.max(10, ...points.map((p) => p.retryPct ?? 0)), 3);
  const g = 36;
  const plotW = Math.max(1, width - g - 4);
  const x = (dbm: number) => g + dbmShare(dbm) * plotW;
  const y = (v: number) => 6 + (1 - v / scale.max) * (RETRY_H - 26);
  return (
    <div ref={ref} className={cn("relative w-full transition-opacity", loading && "opacity-40")} style={{ height: RETRY_H }}>
      {width > 0 && (
        <svg width={width} height={RETRY_H} viewBox={`0 0 ${width} ${RETRY_H}`} role="img" aria-label="Retries against signal for every wireless device">
          {scale.ticks.map((t) => (
            <g key={t}>
              <line x1={g} x2={width} y1={y(t)} y2={y(t)} className="stroke-border" />
              <text x={g - 6} y={y(t) + 3} textAnchor="end" className={AXIS_TEXT}>
                {t === 0 ? "0" : `${t}%`}
              </text>
            </g>
          ))}
          {points.map((p) => {
            const hot = flagged.has(p.deviceId);
            return (
              <g key={p.deviceId}>
                <circle
                  cx={x(p.dbm)}
                  cy={y(Math.min(scale.max, p.retryPct as number))}
                  r={hot ? 4.5 : 3.2}
                  fill={hot ? "var(--color-warning)" : signalQualityColors.good}
                  onPointerMove={(e) =>
                    tip.show(
                      e,
                      <TipBody
                        title={
                          <>
                            <span className="font-medium text-foreground">{p.name}</span>
                            {p.eeroId && names.get(p.eeroId) ? ` · ${names.get(p.eeroId)}` : ""}
                          </>
                        }
                        rows={[
                          ["Retries", formatPercent(p.retryPct)],
                          ["Signal", `${p.dbm} dBm`],
                          ["SNR", p.snr === null ? MISSING : `${p.snr} dB`],
                        ]}
                      />,
                    )
                  }
                  onPointerLeave={tip.hide}
                />
                {hot && (
                  <text x={x(p.dbm) + 8} y={y(Math.min(scale.max, p.retryPct as number)) + 3} className="fill-warning-foreground text-[10px]">
                    {p.name}
                  </text>
                )}
              </g>
            );
          })}
          {[DBM_AXIS.from, DBM_AXIS.to].map((v, i) => (
            <text key={v} x={x(v)} y={RETRY_H - 4} textAnchor={i === 0 ? "start" : "end"} className={AXIS_TEXT}>
              {v} dBm
            </text>
          ))}
        </svg>
      )}
      {tip.node}
    </div>
  );
}
