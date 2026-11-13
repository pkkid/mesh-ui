/**
 * How one mesh link reads: its colour, dash, words and bars. Shared by the
 * topology Map and Tree on the eeros page and the uplink on eero detail.
 * Wired links take the wired series colour; wireless links take the status
 * colour of their quality (docs/ux/pages/eeros.md, Layout 1). Quality words
 * come from core (`Eero.meshQuality`); this file only words them.
 */
import { Cable, Unplug, Wifi } from "lucide-react";
import type { CSSProperties } from "react";

import { seriesColors } from "~/lib/chartColors";
import { cn } from "~/lib/utils";
import { formatMbps } from "../../../../core/format";
import type { Eero, MeshQuality } from "../../../../core/model";

export type LinkTone = "wired" | "success" | "warning" | "destructive" | "muted";

export type LinkLook = {
  tone: LinkTone;
  /** Wireless backhaul is dashed; so is any link while it is down. */
  dashed: boolean;
  /** Chip text: "Excellent", "10 Gbps WAN", "No link"; null hides the chip. */
  label: string | null;
  kind: "wired" | "wireless" | "down";
  /** eero bars 0 to 5 for the chip, wireless only. */
  bars: number | null;
};

/** The stroke colour for a tone: a series colour for wired, a status colour otherwise. */
export const LINK_COLOR: Record<LinkTone, string> = {
  wired: seriesColors.wired,
  success: "var(--color-success)",
  warning: "var(--color-warning)",
  destructive: "var(--color-destructive)",
  muted: "color-mix(in srgb, var(--color-muted-foreground) 55%, transparent)",
};

export const QUALITY_LABEL: Record<MeshQuality, string> = { excellent: "Excellent", good: "Good", weak: "Weak", poor: "Poor" };

const QUALITY_TONE: Record<MeshQuality, LinkTone> = { excellent: "success", good: "success", weak: "warning", poor: "destructive" };

/** Words for a wired speed: "10 Gbps", "2.5 Gbps", "1 Gbps", "100 Mbps". */
export function linkSpeed(mbps: number | null | undefined): string | null {
  if (typeof mbps !== "number" || !Number.isFinite(mbps) || mbps <= 0) return null;
  if (mbps >= 1000) return `${Number((mbps / 1000).toFixed(1))} Gbps`;
  return formatMbps(mbps);
}

/**
 * The look of an eero's link to its upstream. `down` means the network is not
 * reporting (grey, dashed, no chip); an offline eero draws "No link" in the
 * destructive colour; an eero behind an offline one is greyed.
 */
export function uplinkLook(eero: Pick<Eero, "status" | "backhaul" | "meshBars" | "meshQuality">, opts: { networkOffline?: boolean; behindOffline?: boolean } = {}): LinkLook {
  const wired = eero.backhaul === "wired";
  if (opts.networkOffline) return { tone: "muted", dashed: true, label: null, kind: wired ? "wired" : "wireless", bars: null };
  if (eero.status === "offline") return { tone: "destructive", dashed: true, label: "No link", kind: "down", bars: null };
  const behind = opts.behindOffline === true;
  if (wired) return { tone: behind ? "muted" : "wired", dashed: false, label: "Ethernet", kind: "wired", bars: null };
  const q = eero.meshQuality;
  return {
    tone: behind ? "muted" : q ? QUALITY_TONE[q] : "muted",
    dashed: true,
    label: q ? QUALITY_LABEL[q] : "Wireless",
    kind: "wireless",
    bars: eero.meshBars,
  };
}

/** eero reports 0 to 5 bars; four are drawn, as in the mockups. */
export const drawnBars = (bars: number | null): number => (bars === null ? 0 : Math.max(0, Math.min(4, Math.round((bars / 5) * 4))));

/** Four mesh signal bars; one drawn bar reads as destructive, two as warning (status colours). */
export function MeshBars({ bars, className }: { bars: number | null; className?: string }) {
  const n = drawnBars(bars);
  const on = n === 1 ? "bg-destructive" : n === 2 ? "bg-warning" : "bg-foreground/70";
  return (
    <span
      className={cn("inline-flex h-3 items-end gap-0.5", className)}
      role="img"
      aria-label={bars === null ? "Mesh signal unknown" : `Mesh signal ${bars} of 5 bars`}
    >
      {[4, 6.5, 9, 12].map((h, i) => (
        <i key={h} className={cn("w-[3px] rounded-[1px]", i < n ? on : "bg-border")} style={{ height: h }} />
      ))}
    </span>
  );
}

/** The small pill on a link: icon, words and, for wireless, the bars. */
export function LinkChip({ look, className, style }: { look: LinkLook; className?: string; style?: CSSProperties }) {
  if (!look.label) return null;
  const Icon = look.kind === "wired" ? Cable : look.kind === "down" ? Unplug : Wifi;
  return (
    <span
      data-slot="link-chip"
      style={style}
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border bg-card px-2 py-[3px] font-medium text-[11px] text-foreground/80",
        look.kind === "down" && "text-destructive-foreground",
        className,
      )}
    >
      <Icon aria-hidden className="size-3 text-muted-foreground" />
      {look.label}
      {look.kind === "wireless" && look.bars !== null && <MeshBars bars={look.bars} />}
    </span>
  );
}
