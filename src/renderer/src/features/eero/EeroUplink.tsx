/**
 * The hero's Uplink card: the upstream eero (or the Internet and the WAN for
 * the gateway), the link with its quality chip, this eero, then any
 * downstream eeros with their own links. Link looks come from the shared
 * mesh pieces (`uplinkLook`, `LinkChip`), the graph from `eero.list`.
 * docs/ux/pages/eero-detail.md (Layout 1).
 *
 * The full Topology map needs more room than the hero has, so this is a
 * single row: upstream, link, this eero, links to each downstream eero.
 */
import { Globe, type LucideIcon } from "lucide-react";

import { Link, pathFor } from "~/app/router";
import { LINK_COLOR, LinkChip, type LinkLook, linkSpeed, uplinkLook } from "~/components/mesh/LinkChip";
import { behindOffline, eeroIcon } from "~/components/mesh/Topology";
import { cn } from "~/lib/utils";
import type { Eero } from "../../../../core/model";
import { uplinkOf } from "./helpers";

export type EeroUplinkProps = {
  eero: Eero;
  eeros: ReadonlyArray<Eero>;
  internet: { label: string | null; wanMbps: number | null } | null;
  networkOffline: boolean;
};

export function EeroUplink({ eero, eeros, internet, networkOffline }: EeroUplinkProps) {
  const { upstream, downstream } = uplinkOf(eero, eeros);
  const behind = behindOffline(eeros.some((e) => e.id === eero.id) ? eeros : [...eeros, eero]);
  const wan = linkSpeed(internet?.wanMbps);
  const up: LinkLook = eero.isGateway
    ? { tone: networkOffline ? "muted" : "wired", dashed: networkOffline, label: networkOffline ? null : wan ? `${wan} WAN` : "WAN", kind: "wired", bars: null }
    : uplinkLook(eero, { networkOffline, behindOffline: behind.has(eero.id) });
  const backhaul = eero.isGateway ? "Gateway (WAN)" : eero.status === "offline" ? "No link" : eero.backhaul === "wired" ? "Wired backhaul" : eero.backhaul === "wireless" ? "Wireless backhaul" : null;
  const eeroOffline = networkOffline || eero.status === "offline";

  return (
    <div className="flex w-[460px] flex-col gap-5 rounded-(--card-radius) border bg-muted/40 px-4 pt-3 pb-4" role="group" aria-label={`Uplink of ${eero.location}`}>
      <div className="flex items-baseline justify-between">
        <span className="font-medium text-xs">Uplink</span>
        <span className="text-2xs text-muted-foreground">{backhaul ?? "-"}</span>
      </div>
      <div className="flex items-start">
        {eero.isGateway ? (
          <Node icon={Globe} name="Internet" detail={internet?.label ?? "-"} muted={networkOffline} />
        ) : upstream ? (
          <Node icon={eeroIcon(upstream)} name={upstream.location} detail={upstream.isGateway ? "Gateway" : "upstream"} to={pathFor("eero", { eeroId: upstream.id })} muted={networkOffline || upstream.status === "offline"} />
        ) : (
          <Node icon={Globe} name="-" detail="upstream" muted />
        )}
        <Wire look={up} />
        <Node icon={eeroIcon(eero)} name={eero.location} detail="this eero" self muted={eeroOffline} />
        {downstream.length === 1 && downstream[0] && (
          <>
            <Wire look={uplinkLook(downstream[0], { networkOffline, behindOffline: behind.has(downstream[0].id) })} />
            <Node icon={eeroIcon(downstream[0])} name={downstream[0].location} detail="downstream" to={pathFor("eero", { eeroId: downstream[0].id })} muted={networkOffline || downstream[0].status === "offline" || behind.has(downstream[0].id)} />
          </>
        )}
      </div>
      {downstream.length > 1 && (
        <div className="-mt-1 flex flex-col gap-1.5 border-t pt-3">
          <span className="text-2xs text-muted-foreground">Downstream</span>
          {downstream.map((d) => (
            <div key={d.id} className="flex items-center gap-2">
              <Link to={pathFor("eero", { eeroId: d.id })} className="truncate font-medium text-xs hover:underline">
                {d.location}
              </Link>
              <LinkChip look={uplinkLook(d, { networkOffline, behindOffline: behind.has(d.id) })} className="ms-auto" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Node({ icon: Icon, name, detail, to, self = false, muted = false }: { icon: LucideIcon; name: string; detail: string; to?: string; self?: boolean; muted?: boolean }) {
  const body = (
    <>
      <span
        className={cn(
          "grid size-11 place-items-center rounded-xl border bg-card text-foreground/80 [&_svg]:size-[22px]",
          self && "outline-2 outline-muted-foreground/60 outline-offset-2 outline-solid",
          muted && "text-muted-foreground/60",
        )}
      >
        <Icon aria-hidden />
      </span>
      <span className={cn("max-w-full truncate font-medium text-xs", muted && "text-muted-foreground")}>{name}</span>
      <span className="-mt-0.5 text-2xs text-muted-foreground">{detail}</span>
    </>
  );
  const cls = "flex w-[88px] shrink-0 flex-col items-center gap-1 text-center";
  return to ? (
    <Link to={to} className={cn(cls, "rounded-lg outline-none hover:[&>span:nth-child(2)]:underline focus-visible:ring-2 focus-visible:ring-ring")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** A link line at the icons' centre, with its chip under it so the line stays visible. */
function Wire({ look }: { look: LinkLook }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-2 pt-[21px]">
      <span aria-hidden className={cn("w-full border-t-2", look.dashed && "border-dashed")} style={{ borderColor: LINK_COLOR[look.tone] }} />
      <LinkChip look={look} />
    </div>
  );
}
