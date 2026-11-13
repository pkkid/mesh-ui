/**
 * The note beside the topology: the most serious `network.health` issue in
 * words. Network not reporting, then an eero offline, then a weak link with
 * suggestions and Test placement / Scan coverage. Nothing when the mesh is
 * fine. docs/ux/pages/eeros.md (Layout 1, States).
 */
import { Cable, CirclePlus, Crosshair, Move, TriangleAlert, Unplug, WifiOff } from "lucide-react";
import type { ReactNode } from "react";

import { Link, pathFor } from "~/app/router";
import { Button } from "~/components/ui/button";
import { ComingSoonButton } from "~/components/ui/page";
import { cn } from "~/lib/utils";
import type { Eero, HealthIssue } from "../../../../core/model";

const ORDER: Record<HealthIssue["kind"], number> = { network_offline: 0, eero_offline: 1, weak_link: 2 };

/** The issue the note shows: the most serious, first of its kind. */
export function topIssue(issues: ReadonlyArray<HealthIssue>): HealthIssue | null {
  return [...issues].sort((a, b) => ORDER[a.kind] - ORDER[b.kind])[0] ?? null;
}

const devices = (n: number) => `${n} ${n === 1 ? "device" : "devices"}`;

export function WeakLinkNote({
  issue,
  eeros,
  networkName,
  lastSeen,
}: {
  issue: HealthIssue | null;
  eeros: ReadonlyArray<Eero>;
  networkName: string;
  /** "2:16 AM" for an eero, from its last heartbeat in network time. */
  lastSeen: (e: Eero) => string | null;
}) {
  if (!issue) return null;
  const byId = new Map(eeros.map((e) => [e.id, e]));
  const eero = issue.eeroId ? byId.get(issue.eeroId) : undefined;
  const upstream = issue.upstreamId ? byId.get(issue.upstreamId) : undefined;
  const gateway = eeros.find((e) => e.isGateway);
  const n = issue.deviceIds.length;

  if (issue.kind === "network_offline") {
    return (
      <Note tone="destructive" icon={<WifiOff />} title={`${networkName} is not reporting`}>
        Its eeros have not checked in with eero, so everything here is as last seen. Check the modem and the {gateway?.location ?? "gateway"} eero.
      </Note>
    );
  }

  if (issue.kind === "eero_offline") {
    const seen = eero ? lastSeen(eero) : null;
    return (
      <Note tone="destructive" icon={<Unplug />} title={`${eero?.location ?? "An eero"} is offline`}>
        {seen ? `It last checked in at ${seen}` : "It has stopped checking in"}
        {n > 0 ? `, and the ${devices(n)} on it have dropped or moved to another eero.` : "."} Check that it has power.
      </Note>
    );
  }

  const name = eero?.location ?? "An eero";
  const up = upstream?.location ?? "its upstream eero";
  const bars = eero?.meshBars;
  return (
    <Note
      tone="warning"
      icon={<TriangleAlert />}
      title={`${name} has a weak link`}
      actions={
        <>
          <ComingSoonButton size="xs" variant="outline">
            <Crosshair />
            Test placement
          </ComingSoonButton>
          <Button size="xs" variant="ghost" render={<Link to={pathFor("troubleshooting")} />}>
            Scan coverage
          </Button>
        </>
      }
    >
      <p>
        It reaches {up} at only {bars ?? "-"} of 5 bars
        {n > 0 ? `, so the ${devices(n)} connected through it get slower speeds than the rest of the mesh.` : ", so devices that join it get slower speeds than the rest of the mesh."}
      </p>
      <ul className="mt-2 flex flex-col gap-1.5">
        <Suggestion icon={<Move />}>Move it 1 or 2 rooms closer to {up}, ideally in line of sight</Suggestion>
        <Suggestion icon={<Cable />}>Or run Ethernet from {gateway?.location ?? "the gateway"} for wired backhaul</Suggestion>
        <Suggestion icon={<CirclePlus />}>Or add an eero halfway between them</Suggestion>
      </ul>
    </Note>
  );
}

function Suggestion({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-start gap-1.5 [&_svg]:mt-px [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-warning-foreground">
      {icon}
      <span>{children}</span>
    </li>
  );
}

/** A status note in a subtle card: the title in the status colour, the body in normal text. */
function Note({
  tone,
  icon,
  title,
  actions,
  children,
}: {
  tone: "warning" | "destructive";
  icon: ReactNode;
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div role="status" className="flex flex-col gap-2 rounded-(--card-radius) border bg-card px-3.5 py-3 text-[12.5px]">
      <div
        className={cn(
          "flex items-center gap-1.5 font-medium [&_svg]:size-4 [&_svg]:shrink-0",
          tone === "warning" ? "text-warning-foreground" : "text-destructive-foreground",
        )}
      >
        {icon}
        {title}
      </div>
      <div className="text-foreground/80 text-xs">{children}</div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
