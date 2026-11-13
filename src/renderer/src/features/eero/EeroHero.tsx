/**
 * The eero detail hero: product tile with an LED bar, name, status line
 * (status, model, radio badge, uptime), Devices and Data 24h, and the
 * Uplink card on the right. docs/ux/pages/eero-detail.md (Layout 1).
 */
import { Badge } from "~/components/ui/badge";
import { Metric, PageHeader } from "~/components/ui/hero";
import { networkStatus, Status } from "~/components/ui/status";
import { eeroIcon } from "~/components/mesh/Topology";
import { cn } from "~/lib/utils";
import { formatBytes, formatCount, formatDuration, formatPercent } from "../../../../core/format";
import type { Eero, UsageBreakdownRow } from "../../../../core/model";

import { EeroUplink } from "./EeroUplink";

export type EeroHeroProps = {
  eero: Eero | null;
  eeros: ReadonlyArray<Eero>;
  /** This eero (or the whole network) is not reporting. */
  offline: boolean;
  networkOffline: boolean;
  /** "2:16 AM", for an offline eero. */
  lastSeen: string | null;
  /** This eero's row in `usage.breakdown {by: eero, range: day}`. */
  usage: UsageBreakdownRow | null;
  /** The Internet node, for the gateway only. */
  internet: { label: string | null; wanMbps: number | null } | null;
  fading?: boolean;
};

/** "Tri-band Wi-Fi 7", "Dual-band": band count, plus the Wi-Fi generation when the model name carries it. */
export function radioBadge(e: Pick<Eero, "bands" | "model">): string | null {
  const n = e.bands.filter((b) => b !== "wired").length;
  const bands = n >= 3 ? "Tri-band" : n === 2 ? "Dual-band" : null;
  const gen = /\b(7|6E|6)$/i.exec(e.model ?? "")?.[1]?.toUpperCase();
  return [bands, gen ? `Wi-Fi ${gen}` : null].filter(Boolean).join(" ") || null;
}

export function EeroHero({ eero, eeros, offline, networkOffline, lastSeen, usage, internet, fading = false }: EeroHeroProps) {
  const status = offline ? networkStatus("offline") : networkStatus(eero?.status);
  const badge = eero ? radioBadge(eero) : null;
  const wired = eero?.clients.wired ?? null;
  const total = offline ? null : (eero?.clients.total ?? null);
  const bytes = usage ? usage.down + usage.up : null;

  return (
    <PageHeader
      className={cn("transition-opacity", fading && "opacity-40")}
      title={eero?.location ?? "-"}
      icon={<ProductTile eero={eero} offline={offline} />}
      status={
        <>
          <Status tone={status.tone}>{status.label}</Status>
          {eero?.model && <Badge variant="outline">{eero.model}</Badge>}
          {badge && <Badge variant="outline">{badge}</Badge>}
          {eero?.isGateway && <Badge variant="outline">Gateway</Badge>}
          <span>{offline ? (lastSeen ? `Last seen ${lastSeen}` : null) : eero?.uptimeSec != null ? `Up ${formatDuration(eero.uptimeSec)}` : null}</span>
        </>
      }
      facts={
        <>
          <Metric
            label="Devices"
            value={
              total === null ? null : (
                <>
                  {formatCount(total)}
                  {wired !== null && wired > 0 && <small className="ms-1.5 font-normal text-muted-foreground text-xs">{formatCount(wired)} wired</small>}
                </>
              )
            }
          />
          <Metric
            label="Data, 24h"
            value={
              bytes === null ? null : (
                <>
                  {formatBytes(bytes)}
                  {usage && <small className="ms-1.5 font-normal text-muted-foreground text-xs">{formatPercent(usage.share)} of network</small>}
                </>
              )
            }
          />
        </>
      }
      aside={eero ? <EeroUplink eero={eero} eeros={eeros} internet={internet} networkOffline={networkOffline} /> : null}
    />
  );
}

/** LED state from `eero.led`: on at full, dimmed, off, or unknown. */
function ledState(e: Eero | null, offline: boolean): "on" | "dim" | "off" | "unknown" {
  if (!e || offline || e.led.on === null) return "unknown";
  if (!e.led.on) return "off";
  return e.led.brightness !== null && e.led.brightness < 100 ? "dim" : "on";
}

const LED_LABEL = { on: "Status light on", dim: "Status light dimmed", off: "Status light off", unknown: "Status light unknown" } as const;

/** A 150px rounded square with the router or lamp glyph and an LED bar at the top that mirrors the LED. */
function ProductTile({ eero, offline }: { eero: Eero | null; offline: boolean }) {
  const Icon = eeroIcon({ model: eero?.model ?? null });
  const led = ledState(eero, offline);
  return (
    <div
      role="img"
      aria-label={`${eero?.model ?? "eero"}. ${LED_LABEL[led]}`}
      className="relative mt-1 grid size-[150px] shrink-0 place-items-center rounded-[34px] bg-muted text-muted-foreground shadow-[inset_0_0_0_1px_var(--color-border)]"
    >
      <span
        aria-hidden
        className={cn(
          "absolute top-4 left-1/2 h-1 w-9 -translate-x-1/2 rounded-full",
          led === "on" && "bg-foreground/80",
          led === "dim" && "bg-foreground/40",
          (led === "off" || led === "unknown") && "bg-border",
        )}
      />
      <Icon aria-hidden className={cn("size-14", offline && "opacity-60")} strokeWidth={1.5} />
    </div>
  );
}
