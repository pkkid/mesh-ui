/**
 * eeros: the mesh itself. Topology (Map or Tree) with the issue note and the
 * selected eero, a card per eero with its radios, data usage by eero,
 * clients by band and network actions. Layout, data and states:
 * docs/ux/pages/eeros.md and docs/mockups/03-eeros.html. Every figure comes
 * from a query command; the page only arranges and words it.
 */
import { CircleArrowUp, CircleCheck } from "lucide-react";
import { useState } from "react";

import { navigate, pathFor } from "~/app/router";
import type { PageProps } from "~/app/routes";
import { useQuery } from "~/app/useCommand";
import { MeshBars } from "~/components/mesh/LinkChip";
import { Topology } from "~/components/mesh/Topology";
import { BUSY_AT, wirelessRadios } from "~/components/mesh/RadioTable";
import { eeroIcon } from "~/lib/deviceIcons";
import { TopologyTree } from "~/components/mesh/TopologyTree";
import { Card, CardLink, Empty, Section } from "~/components/ui/card";
import { IconTile } from "~/components/ui/hero";
import { KvList } from "~/components/ui/kv-list";
import { SectionError } from "~/components/ui/page";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "~/components/ui/select";
import { TextLink } from "~/components/ui/text-link";
import { networkStatus } from "~/components/ui/status";
import { useTopBarUpdated } from "~/features/shell/TopBar";
import { formatCount, networkClock } from "../../../../core/format";
import type { DeviceList, Eero, Internet, Network, NetworkHealth, Updates } from "../../../../core/model";

import { ClientsByBand } from "./ClientsByBand";
import { EeroCards, type EeroStatusWord } from "./EeroCards";
import { EeroUsage } from "./EeroUsage";
import { NetworkActions } from "./NetworkActions";
import { topIssue, WeakLinkNote } from "./WeakLinkNote";
import { WiredBackhaulNote } from "./WiredBackhaulNote";

const TOPOLOGY_VIEWS = [
  { value: "map", label: "Map view" },
  { value: "tree", label: "Tree view" },
] as const;

const CARD_VIEWS = [
  { value: "grid", label: "Grid view" },
  { value: "list", label: "List view" },
] as const;

export function EerosPage(_props: PageProps) {
  const eeros = useQuery<Eero[]>("eero.list", undefined, { poll: true });
  useTopBarUpdated(eeros.fetchedAt);
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

  // "3 eeros, 2 wired backhaul, 1 weak link": the count, how many are wired, then what needs attention.
  const wiredBackhaul = list.filter((e) => !e.isGateway && e.backhaul === "wired").length;
  const offlineCount = list.filter((e) => e.status === "offline").length;
  const topologyDescription = eeros.data
    ? [
        `${list.length} ${list.length === 1 ? "eero" : "eeros"}`,
        wiredBackhaul > 0 ? `${wiredBackhaul} wired backhaul` : null,
        weak.size > 0 ? `${weak.size} weak ${weak.size === 1 ? "link" : "links"}` : null,
        offlineCount > 0 ? `${offlineCount} offline` : null,
      ]
        .filter(Boolean)
        .join(", ")
    : "-";

  // "37 clients, 1 busy radio": who is connected across the mesh, then any radio over the busy line.
  const clientCount = list.reduce((sum, e) => sum + (e.clients.total ?? 0), 0);
  const busyRadios = list.flatMap((e) => wirelessRadios(e)).filter((r) => r.utilization !== null && r.utilization / 100 >= BUSY_AT).length; // utilization is 0 to 100
  const eerosDescription = eeros.data
    ? [`${formatCount(clientCount)} ${clientCount === 1 ? "client" : "clients"}`, busyRadios > 0 ? `${busyRadios} busy ${busyRadios === 1 ? "radio" : "radios"}` : null]
        .filter(Boolean)
        .join(", ")
    : "-";

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
    // 56px between sections (design-system.md, Shape and spacing).
    <div className="flex flex-col gap-14">
      <Section
        title="Mesh topology"
        description={topologyDescription}
        className="gap-[15px]"
        tools={
          // A dropdown, not a Segmented toggle (design-system.md, Dropdowns, not pill toggles).
          <Select items={TOPOLOGY_VIEWS} value={topoView} onValueChange={(v) => v && setTopoView(v)}>
            <SelectTrigger size="tool" aria-label="Topology view">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {TOPOLOGY_VIEWS.map((v) => (
                <SelectItem key={v.value} value={v.value}>
                  {v.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      >
        {eeros.error && !eeros.data ? (
          <SectionError what="eeros" error={eeros.error} onRetry={() => void eeros.refetch()} />
        ) : (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_330px]">
            {topoView === "map" ? <Topology {...topology} interactive wiredChip={networkOffline ? null : wiredChip} /> : <TopologyTree {...topology} />}
            <div className="flex flex-col gap-3">
              <WeakLinkNote issue={issue} eeros={list} networkName={network.data?.name ?? "This network"} lastSeen={lastSeen} />
              {selected && <SelectedEero eero={selected} eeros={list} />}
              <FirmwareLine updates={updates.data} />
              <WiredBackhaulNote eeros={list} wiredOnGateway={wired.length} />
            </div>
          </div>
        )}
      </Section>

      <Section
        title="Your eeros"
        description={eerosDescription}
        className="gap-[15px]"
        tools={
          // A dropdown, not a Segmented toggle (design-system.md, Dropdowns, not pill toggles).
          <Select items={CARD_VIEWS} value={cardView} onValueChange={(v) => v && setCardView(v)}>
            <SelectTrigger size="tool" aria-label="Card layout">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {CARD_VIEWS.map((v) => (
                <SelectItem key={v.value} value={v.value}>
                  {v.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
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

      <div className="grid gap-x-7 gap-y-14 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <EeroUsage eeros={eeros.data} timezone={network.data?.timezone ?? null} />
        {devices.error && !devices.data ? (
          <Section title="Clients by band">
            <SectionError what="clients" error={devices.error} onRetry={() => void devices.refetch()} />
          </Section>
        ) : (
          <ClientsByBand summary={devices.data?.summary} fading={devices.fading} />
        )}
      </div>
      {/* Disruptive actions in their own row at the bottom of the page, away from the read-only sections. */}
      <NetworkActions />
    </div>
  );
}

/** "eeroOS 7.12.1, up to date · updated 4s ago". */
/** Under the selected eero: the network's eeroOS and update state ("eeroOS 7.12.1, up to date"). */
function FirmwareLine({ updates }: { updates: Updates | undefined }) {
  if (!updates?.current) return null;
  // Anything but up to date links to Updates & admins ("7.13.0 available", an inline TextLink).
  const text =
    updates.status === "up_to_date"
      ? null
      : updates.status === "installing"
        ? `installing ${updates.target ?? "an update"}`
        : updates.status === "scheduled"
          ? `${updates.target ?? "update"} scheduled`
          : `${updates.target ?? "update"} available`;
  // A link inside a footnote is dimmed with it (half the text colour), keeping its underline.
  const state =
    text === null ? (
      "up to date"
    ) : (
      <TextLink to={pathFor("updates")} className="text-foreground/50 decoration-foreground/25 hover:text-foreground/70">
        {text}
      </TextLink>
    );
  // An icon like the note below, so the two lines' text lines up: a check when up to date, an up arrow otherwise.
  const Icon = updates.status === "up_to_date" ? CircleCheck : CircleArrowUp;
  return (
    <p className="flex gap-2 px-1 text-muted-foreground/50 text-xs">
      <Icon className="mt-px size-3.5 shrink-0" />
      <span>
        eeroOS {updates.current}, {state}
      </span>
    </p>
  );
}

/** The selected eero: name, its uplink, Open, and backhaul, mesh quality and downstream eeros. */
function SelectedEero({ eero, eeros }: { eero: Eero; eeros: ReadonlyArray<Eero> }) {
  const upstream = eeros.find((e) => e.id === eero.upstream) ?? (eero.isGateway ? undefined : eeros.find((e) => e.isGateway));
  const downstream = eeros.filter((e) => e.upstream === eero.id || (!e.isGateway && e.upstream === null && eero.isGateway));
  const to = pathFor("eero", { eeroId: eero.id });
  const line = eero.isGateway ? "Selected · gateway" : upstream ? `Selected · uplink to ${upstream.location}` : "Selected";
  return (
    // A clickable card: a click anywhere opens the eero, so there is no View link (design-system.md, Clickable cards).
    <Card padded to={to} className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <IconTile icon={eeroIcon(eero)} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-sm">
            <CardLink to={to}>{eero.location}</CardLink>
          </div>
          <div className="truncate text-muted-foreground text-xs">{line}</div>
        </div>
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
