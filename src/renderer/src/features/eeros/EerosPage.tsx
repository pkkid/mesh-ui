/**
 * eeros: the mesh itself. Topology (Map or Tree) with the issue note and the
 * selected eero, a card per eero with its radios, data usage by eero,
 * clients by band and network actions. Layout, data and states:
 * docs/ux/pages/eeros.md and docs/mockups/03-eeros.html. Every figure comes
 * from a query command; the page only arranges and words it.
 */
import { ArrowRight, LayoutGrid, List, Waypoints } from "lucide-react";
import { useState } from "react";

import { Link, navigate, pathFor } from "~/app/router";
import type { PageProps } from "~/app/routes";
import { useQuery } from "~/app/useCommand";
import { MeshBars } from "~/components/mesh/LinkChip";
import { eeroIcon, Topology } from "~/components/mesh/Topology";
import { TopologyTree } from "~/components/mesh/TopologyTree";
import { Button } from "~/components/ui/button";
import { Card, Empty, Section } from "~/components/ui/card";
import { IconTile } from "~/components/ui/hero";
import { KvList } from "~/components/ui/kv-list";
import { SectionError, useNow } from "~/components/ui/page";
import { Segmented } from "~/components/ui/segmented";
import { networkStatus } from "~/components/ui/status";
import { TopBarSubtitle } from "~/features/shell/TopBar";
import { formatRelative, networkClock } from "../../../../core/format";
import type { DeviceList, Eero, Internet, Network, NetworkHealth, Updates } from "../../../../core/model";

import { ClientsByBand } from "./ClientsByBand";
import { EeroCards, type EeroStatusWord } from "./EeroCards";
import { EeroUsage } from "./EeroUsage";
import { NetworkActions } from "./NetworkActions";
import { topIssue, WeakLinkNote } from "./WeakLinkNote";

const TOPOLOGY_VIEWS = [
  { value: "map", label: "Map", icon: Waypoints },
  { value: "tree", label: "Tree", icon: List },
] as const;

const CARD_VIEWS = [
  { value: "grid", label: "Grid", icon: LayoutGrid },
  { value: "list", label: "List", icon: List },
] as const;

export function EerosPage(_props: PageProps) {
  const eeros = useQuery<Eero[]>("eero.list", undefined, { poll: true });
  const health = useQuery<NetworkHealth>("network.health", undefined, { poll: true });
  const network = useQuery<Network>("network.get", undefined, { poll: true });
  const internet = useQuery<Internet>("internet.get", undefined, { poll: true });
  const devices = useQuery<DeviceList>("device.list", undefined, { poll: true });
  const updates = useQuery<Updates>("updates.get", undefined, { poll: true });

  const [topoView, setTopoView] = useState<"map" | "tree">("map");
  const [cardView, setCardView] = useState<"grid" | "list">("grid");
  const [picked, setPicked] = useState<string | null>(null);

  const list = eeros.data ?? [];
  const issues = health.data?.issues ?? [];
  const issue = topIssue(issues);
  const networkOffline = health.data?.status === "offline" || issues.some((i) => i.kind === "network_offline");
  const weak = new Set(issues.filter((i) => i.kind === "weak_link").flatMap((i) => (i.eeroId ? [i.eeroId] : [])));
  const clock = networkClock(network.data?.timezone);
  // A time today, a date and time once it is older than most of a day.
  const lastSeen = (e: Eero) =>
    e.lastHeartbeat ? (Date.now() - Date.parse(e.lastHeartbeat) > 20 * 3_600_000 ? clock.dateTime : clock.time)(e.lastHeartbeat) : null;
  const offlineDetail = (e: Eero) => {
    const t = lastSeen(e);
    return t ? `Offline · last seen ${t}` : "Offline";
  };
  const statusOf = (e: Eero): EeroStatusWord =>
    networkOffline || e.status === "offline" ? networkStatus("offline") : weak.has(e.id) ? networkStatus("degraded") : networkStatus(e.status);

  // Default selection: the first eero with an issue, else the first non-gateway.
  const flagged = issues.find((i) => i.eeroId && list.some((e) => e.id === i.eeroId))?.eeroId;
  const selectedId =
    (picked && list.some((e) => e.id === picked) ? picked : null) ?? flagged ?? list.find((e) => !e.isGateway)?.id ?? list[0]?.id ?? null;
  const selected = list.find((e) => e.id === selectedId) ?? null;

  const gateway = list.find((e) => e.isGateway);
  const wired = (devices.data?.devices ?? []).filter((d) => d.connected && d.band === "wired" && d.eeroId === gateway?.id);
  const wiredChip = wired.length > 0 ? `${wired.length} wired: ${wired.map((d) => d.name).join(", ")}` : null;
  const internetNode = { label: internet.data?.isp.name ?? null, wanMbps: internet.data?.gateway?.wanPortSpeedMbps ?? null };
  const open = (id: string) => navigate(pathFor("eero", { eeroId: id }));
  const loading = !eeros.data && eeros.loading;

  const topology = {
    eeros: list,
    internet: internetNode,
    selectedId,
    warnIds: weak,
    onSelect: setPicked,
    onOpen: open,
    networkOffline,
    offlineDetail,
    loading: eeros.fading || loading,
  };

  return (
    <>
      <TopBarSubtitle>
        <Subtitle updates={updates.data} at={eeros.fetchedAt} />
      </TopBarSubtitle>

      <Section
        title="Mesh topology"
        subtitle="Upstream links and mesh quality bars"
        tools={<Segmented aria-label="Topology view" value={topoView} onValueChange={setTopoView} options={TOPOLOGY_VIEWS} />}
      >
        {eeros.error && !eeros.data ? (
          <SectionError what="eeros" error={eeros.error} onRetry={() => void eeros.refetch()} />
        ) : (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_330px]">
            {topoView === "map" ? <Topology {...topology} wiredChip={networkOffline ? null : wiredChip} /> : <TopologyTree {...topology} />}
            <div className="flex flex-col gap-3">
              <WeakLinkNote issue={issue} eeros={list} networkName={network.data?.name ?? "This network"} lastSeen={lastSeen} />
              {selected && <SelectedEero eero={selected} eeros={list} />}
            </div>
          </div>
        )}
      </Section>

      <Section
        title="Your eeros"
        subtitle="Bands, channels and load per eero"
        tools={<Segmented aria-label="Card layout" value={cardView} onValueChange={setCardView} options={CARD_VIEWS} />}
      >
        {eeros.error && !eeros.data ? (
          <SectionError what="eeros" error={eeros.error} onRetry={() => void eeros.refetch()} />
        ) : eeros.data && list.length === 0 ? (
          <Card>
            <Empty>No eeros on this network.</Empty>
          </Card>
        ) : (
          <EeroCards
            eeros={list}
            view={cardView}
            statusOf={statusOf}
            offlineDetail={(e) => (lastSeen(e) ? `last seen ${lastSeen(e)}` : null)}
            fading={eeros.fading}
          />
        )}
      </Section>

      <div className="grid gap-7 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <EeroUsage eeros={eeros.data} timezone={network.data?.timezone ?? null} />
        <div className="flex flex-col gap-7">
          {devices.error && !devices.data ? (
            <Section title="Clients by band">
              <SectionError what="clients" error={devices.error} onRetry={() => void devices.refetch()} />
            </Section>
          ) : (
            <ClientsByBand summary={devices.data?.summary} fading={devices.fading} />
          )}
          <NetworkActions />
        </div>
      </div>
    </>
  );
}

/** "eeroOS 7.12.1, up to date · updated 4s ago". */
function Subtitle({ updates, at }: { updates: Updates | undefined; at: number | null }) {
  const now = useNow(15_000);
  const parts: string[] = [];
  if (updates?.current) {
    const state =
      updates.status === "up_to_date"
        ? "up to date"
        : updates.status === "installing"
          ? `installing ${updates.target ?? "an update"}`
          : updates.status === "scheduled"
            ? `${updates.target ?? "update"} scheduled`
            : `${updates.target ?? "update"} available`;
    parts.push(`eeroOS ${updates.current}, ${state}`);
  }
  if (at !== null) parts.push(`updated ${formatRelative(new Date(at).toISOString(), now)}`);
  return <>{parts.join(" · ")}</>;
}

/** The selected eero: name, its uplink, Open, and backhaul, mesh quality and downstream eeros. */
function SelectedEero({ eero, eeros }: { eero: Eero; eeros: ReadonlyArray<Eero> }) {
  const upstream = eeros.find((e) => e.id === eero.upstream) ?? (eero.isGateway ? undefined : eeros.find((e) => e.isGateway));
  const downstream = eeros.filter((e) => e.upstream === eero.id || (!e.isGateway && e.upstream === null && eero.isGateway));
  const to = pathFor("eero", { eeroId: eero.id });
  const line = eero.isGateway ? "Selected · gateway" : upstream ? `Selected · uplink to ${upstream.location}` : "Selected";
  return (
    <Card padded className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <IconTile icon={eeroIcon(eero)} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-[13.5px]">{eero.location}</div>
          <div className="truncate text-muted-foreground text-xs">{line}</div>
        </div>
        <Button size="xs" variant="outline" render={<Link to={to} />}>
          Open
          <ArrowRight />
        </Button>
      </div>
      <KvList
        className="text-xs"
        items={[
          { label: "Backhaul", value: eero.isGateway ? "Gateway (WAN)" : eero.backhaul === "wired" ? "Wired" : eero.backhaul === "wireless" ? "Wireless" : null },
          {
            label: "Mesh quality",
            value:
              eero.backhaul === "wireless" && eero.meshBars !== null && eero.status !== "offline" ? (
                <span className="inline-flex items-center gap-1.5">
                  {eero.meshBars} of 5 bars <MeshBars bars={eero.meshBars} />
                </span>
              ) : null,
          },
          { label: "Downstream", value: downstream.length > 0 ? downstream.map((e) => e.location).join(", ") : "None" },
        ]}
      />
    </Card>
  );
}
