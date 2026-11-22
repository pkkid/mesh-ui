/**
 * eero detail: one eero's hero and uplink, data usage, radios, connected
 * devices, Ethernet ports, settings (shown as values) and more actions.
 * Rename, status light, nightlight, Blink and Restart run their commands
 * through the write kit; port actions and Remove stay "Coming soon" (M5).
 * Layout, data and states: docs/ux/pages/eero-detail.md
 * and docs/mockups/04-eero-detail.html. `[` and `]` move between eeros.
 */
import { useEffect, useMemo } from "react";

import { Link, navigate, pathFor } from "~/app/router";
import type { PageProps } from "~/app/routes";
import { useQuery } from "~/app/useCommand";
import { Card, Empty } from "~/components/ui/card";
import { SectionError } from "~/components/ui/page";
import { useTopBarUpdated } from "~/features/shell/TopBar";
import { TopBarTitleSwitcher } from "~/features/shell/TitleSwitcher";
import { eeroItems } from "~/features/palette/search";
import { networkClock } from "../../../../core/format";
import type { Eero, Internet, Network, NetworkHealth, UsageBreakdown, DeviceList } from "../../../../core/model";

import { RemoveEeroRow } from "./EeroActions";
import { EeroDevices } from "./EeroDevices";
import { WiredBackhaulNote } from "~/features/eeros/WiredBackhaulNote";
import { EeroHero } from "./EeroHero";
import { EeroPorts } from "./EeroPorts";
import { EeroRadios } from "./EeroRadios";
import { EeroInfo, EeroSettings } from "./EeroSettings";
import { EeroUsage } from "./EeroUsage";

export function EeroPage({ params }: PageProps) {
  const id = params.eeroId ?? "";
  const eero = useQuery<Eero>("eero.get", { eero: id }, { poll: true, enabled: id !== "" });
  useTopBarUpdated(eero.fetchedAt);
  const eeros = useQuery<Eero[]>("eero.list", undefined, { poll: true });
  const network = useQuery<Network>("network.get", undefined, { poll: true });
  const health = useQuery<NetworkHealth>("network.health", undefined, { poll: true });
  const byEero = useQuery<UsageBreakdown>("usage.breakdown", { range: "day", by: "eero" }, { poll: true });
  // The same device.list the eeros page reads (cached), for the wired backhaul note under Ethernet ports.
  const allDevices = useQuery<DeviceList>("device.list", undefined, { poll: true });

  const list = eeros.data ?? [];
  const listed = list.find((e) => e.id === id) ?? null;
  // The single read wins; the list fills in while it loads.
  const data = eero.data ?? listed;
  const isGateway = data?.isGateway ?? false;
  const internet = useQuery<Internet>("internet.get", undefined, { poll: true, enabled: isGateway });
  const networkName = network.data?.name ?? "this network";
  const networkOffline = health.data?.status === "offline" || (health.data?.issues ?? []).some((i) => i.kind === "network_offline");

  useEeroShortcuts(list, id);
  const siblings = useMemo(() => eeroItems(eeros.data ?? null), [eeros.data]);

  // Gone: the latest list no longer has this eero (removed elsewhere), even if an older eero.get is cached.
  if (eeros.data && !listed) {
    return (
      <Card>
        <Empty className="flex flex-col items-center gap-2">
          <span>This eero is no longer on {networkName}.</span>
          <Link to={pathFor("eeros")} className="text-foreground underline-offset-2 hover:underline">
            Go to eeros
          </Link>
        </Empty>
      </Card>
    );
  }
  if (eero.error && !data) return <SectionError what="this eero" error={eero.error} onRetry={() => void eero.refetch()} />;

  const clock = networkClock(network.data?.timezone);
  const offline = networkOffline || data?.status === "offline";
  const lastSeen = data?.lastHeartbeat
    ? (Date.now() - Date.parse(data.lastHeartbeat) > 20 * 3_600_000 ? clock.dateTime : clock.time)(data.lastHeartbeat)
    : null;
  const share = byEero.data?.rows.find((r) => r.id === id) ?? null;
  const gatewayId = list.find((e) => e.isGateway)?.id;
  const wiredOnGateway = (allDevices.data?.devices ?? []).filter((d) => d.connected && d.band === "wired" && d.eeroId === gatewayId).length;
  const name = data?.location ?? "eero";

  return (
    <>
      {/* "Basement eero": the eero's name in the breadcrumb, with "eero" so it reads as one. */}
      {data?.location && (
        <TopBarTitleSwitcher title={`${data.location} eero`} kind="eero" items={siblings} currentId={id} pathFor={(to) => pathFor("eero", { eeroId: to })} />
      )}

      <EeroHero
        eero={data}
        eeros={list}
        offline={offline}
        networkOffline={networkOffline}
        lastSeen={lastSeen}
        usage={share}
        networkName={networkName}
        internet={isGateway ? { label: internet.data?.isp.name ?? null, wanMbps: internet.data?.gateway?.wanPortSpeedMbps ?? null } : null}
        fading={eero.fading}
      />

      {/* 56px between sections (design-system.md, Shape and spacing). */}
      <div className="flex flex-col gap-14">
        <div className="grid gap-x-7 gap-y-14 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <EeroUsage eeroId={id} name={name} timezone={network.data?.timezone ?? null} />
          <EeroRadios eero={data} offline={offline} />
        </div>

        <div className="grid gap-x-7 gap-y-14 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <EeroDevices eeroId={id} name={name} />
          <div className="flex flex-col gap-3">
            <EeroPorts eeroId={id} offline={offline} />
            <WiredBackhaulNote eeros={list} wiredOnGateway={wiredOnGateway} />
          </div>
        </div>

        <EeroInfo eero={data} clock={clock} />

        <EeroSettings eero={data} remove={<RemoveEeroRow eero={data} eeros={list} networkName={networkName} />} />
      </div>
    </>
  );
}


/** `[` and `]` open the previous and next eero, in `eero.list` order (gateway first). */
function useEeroShortcuts(eeros: ReadonlyArray<Eero>, id: string) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "[" && e.key !== "]") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable='true']")) return;
      const at = eeros.findIndex((x) => x.id === id);
      if (at < 0 || eeros.length < 2) return;
      const next = eeros[(at + (e.key === "]" ? 1 : -1) + eeros.length) % eeros.length];
      if (!next) return;
      e.preventDefault();
      navigate(pathFor("eero", { eeroId: next.id }));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [eeros, id]);
}
