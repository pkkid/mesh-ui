/**
 * Guest network: the hero with the power button and the QR block, guest
 * usage, isolation and security, name and password (with its edit sheet),
 * and the guest devices. Layout, data and states: docs/ux/pages/guest.md
 * and docs/mockups/11-guest.html.
 */
import { Check, Globe, House, Smartphone, Ticket, X } from "lucide-react";
import { type ReactNode, useReducer } from "react";

import { Link, pathFor } from "~/app/router";
import type { PageProps } from "~/app/routes";
import { useQuery } from "~/app/useCommand";
import { BandBadge } from "~/components/ui/band-badge";
import { Card, Empty, Section } from "~/components/ui/card";
import { SectionError } from "~/components/ui/page";
import { cn } from "~/lib/utils";
import { TopBarTitle } from "~/features/shell/TopBar";
import type { GuestNetwork, Network, Security, WirelessBand } from "../../../../core/model";

import { GuestDevices } from "./GuestDevices";
import { GuestHero } from "./GuestHero";
import { GuestSettings } from "./GuestSettings";
import { GuestUsage } from "./GuestUsage";

export function GuestPage(_: PageProps) {
  const network = useQuery<Network>("network.get", undefined, { poll: true });
  const guest = useQuery<GuestNetwork>("guest.get", undefined, { poll: true });

  const bridged = network.data?.connectionMode === "bridged";
  const g = guest.data;
  const on = g?.enabled === true && !bridged;
  const timezone = network.data?.timezone ?? null;
  // Bumped after a name or password save, so the hero reads the QR again.
  const [shareVersion, bumpShare] = useReducer((n: number) => n + 1, 0);

  return (
    <>
      <TopBarTitle>Guest network</TopBarTitle>
      {guest.error && !g ? (
        <SectionError what="the guest network" error={guest.error} onRetry={() => void guest.refetch()} />
      ) : (
        <GuestHero guest={g} networkName={network.data?.name ?? null} unavailable={bridged} offline={network.data?.status === "offline"} fading={guest.fading} shareVersion={shareVersion} />
      )}

      {bridged ? (
        <Card>
          <Empty>Guest network is not available in bridge mode. eero needs to route the network to keep guests apart.</Empty>
        </Card>
      ) : (
        <>
          <div className="grid gap-7 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <GuestUsage timezone={timezone} off={g !== undefined && !on} />
            <Isolation guest={g} networkName={network.data?.name ?? null} />
          </div>
          <GuestSettings guest={g} networkName={network.data?.name ?? null} onSaved={bumpShare} />
          <GuestDevices timezone={timezone} />
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Isolation & security

const SECURITY_LABEL: Record<Security, string> = {
  WPA2: "Standard (WPA2)",
  WPA2_WPA3: "Hybrid (WPA2 + WPA3)",
  WPA3: "Enhanced (WPA3)",
};

const BANDS: WirelessBand[] = ["2.4", "5", "6"];

/** eero always isolates guests: from the home network and from each other. Static copy plus the encryption per band. */
function Isolation({ guest, networkName }: { guest: GuestNetwork | undefined; networkName: string | null }) {
  const open = guest !== undefined && !guest.hasPassword;
  // Bands the network has: any band with a security mode (an open network shows the two every eero has).
  const bands = guest ? (open ? BANDS.filter((b) => b !== "6") : BANDS.filter((b) => guest.security[b] !== null)) : [];
  return (
    <Section title="Isolation & security">
      <Card padded className="flex flex-col gap-4">
        <div className="flex flex-col gap-3">
          <Path from={<Node icon={<Ticket />} label="Guests" />} to={<Node icon={<Globe />} label="Internet" detail="Allowed" />} allowed />
          <Path from={<Node icon={<Ticket />} label="Guests" />} to={<Node icon={<House />} label={networkName ?? "Your network"} detail="Blocked" />} />
          <Path from={<Node icon={<Smartphone />} label="Guest A" />} to={<Node icon={<Smartphone />} label="Guest B" />} />
        </div>
        <div className="h-px bg-border" />
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="font-medium text-xs">Encryption</span>
            <Link to={pathFor("wifi")} className="text-muted-foreground text-xs underline-offset-2 hover:text-foreground hover:underline">
              Same as main network
            </Link>
          </div>
          {guest === undefined ? (
            <div className="h-16" />
          ) : bands.length === 0 ? (
            <span className="text-muted-foreground text-xs">-</span>
          ) : (
            bands.map((b) => (
              <div key={b} className="flex items-center justify-between text-sm">
                <BandBadge band={b} />
                <span className={cn("text-muted-foreground", open && "text-warning-foreground")}>
                  {open ? "Open, no password" : SECURITY_LABEL[guest.security[b] as Security]}
                </span>
              </div>
            ))
          )}
        </div>
      </Card>
    </Section>
  );
}

function Node({ icon, label, detail }: { icon: ReactNode; label: string; detail?: string }) {
  return (
    <div className="min-w-0 rounded-xl border bg-muted/40 px-3 py-2.5">
      <div className="flex items-center gap-1.5 font-medium text-xs [&_svg]:size-3.5 [&_svg]:text-muted-foreground">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      {detail && <div className="truncate text-2xs text-muted-foreground">{detail}</div>}
    </div>
  );
}

/** Two boxes joined by a line: solid with a check when allowed, dashed with a cross when blocked. */
function Path({ from, to, allowed = false }: { from: ReactNode; to: ReactNode; allowed?: boolean }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_44px_minmax(0,1fr)] items-center" role="img" aria-label={allowed ? "Allowed" : "Blocked"}>
      {from}
      <div className="relative h-0.5">
        <div className={cn("absolute inset-0", allowed ? "bg-success" : "border-destructive border-t-2 border-dashed")} />
        <span className="absolute top-1/2 left-1/2 grid size-5 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-card">
          {allowed ? <Check className="size-3.5 text-success-foreground" /> : <X className="size-3.5 text-destructive-foreground" />}
        </span>
      </div>
      {to}
    </div>
  );
}
