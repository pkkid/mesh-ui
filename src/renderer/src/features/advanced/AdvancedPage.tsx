/**
 * Advanced networking: every network-wide setting, power saving schedules on
 * the shared week timeline, Thread without its secrets, integrations and the
 * danger zone. Internet, Network services, Wireless and the danger zone are
 * live (M5.2, M5.3); the side panel shows the impact of the change waiting
 * on its confirm (`settings.impact`).
 * Layout, data and states: docs/ux/pages/advanced-networking.md and
 * docs/mockups/13-advanced-networking.html.
 */
import type { PageProps } from "~/app/routes";
import { useQuery } from "~/app/useCommand";
import { SectionError } from "~/components/ui/page";
import { cn } from "~/lib/utils";
import { TopBarSubtitle, TopBarTitle } from "~/features/shell/TopBar";
import { ownerOnly } from "../../../../core/spec";
import type { Integrations as IntegrationsData, Internet, Network, NetworkSettings } from "../../../../core/model";

import { PendingImpactProvider, PendingPanel } from "./ImpactPanel";
import { Integrations } from "./Integrations";
import { PowerSaving } from "./PowerSaving";
import { DangerZone, InternetGroup, ServicesGroup, WirelessGroup } from "./SettingsGroups";

export function AdvancedPage(_: PageProps) {
  const network = useQuery<Network>("network.get", undefined, { poll: true });
  const internet = useQuery<Internet>("internet.get", undefined, { poll: true });
  const settings = useQuery<NetworkSettings>("settings.get");
  const integrations = useQuery<IntegrationsData>("integrations.get");

  const s = settings.data;
  const mode = s?.connectionMode ?? network.data?.connectionMode;
  const bridged = mode === "bridged" || mode === "ipPassthrough";
  const offline = network.data?.status === "offline";
  // The shared owner rule (core `ownerOnly`): the real owner maps to "owner"; an unknown role is not refused.
  const owner = ownerOnly(network.data?.role) === null;
  const timezone = s?.timezone ?? network.data?.timezone ?? null;

  return (
    <PendingImpactProvider>
      <TopBarTitle>Advanced networking</TopBarTitle>
      <TopBarSubtitle>Changes apply to every eero</TopBarSubtitle>
      <div className="grid items-start gap-7 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className={cn("flex min-w-0 flex-col gap-6 transition-opacity", settings.fading && "opacity-40")}>
          {settings.error && !s ? (
            <SectionError what="network settings" error={settings.error} onRetry={() => void settings.refetch()} />
          ) : (
            <>
              <InternetGroup settings={s} internet={internet.data} bridged={bridged} offline={offline} />
              <ServicesGroup settings={s} bridged={bridged} offline={offline}>
                <PowerSaving settings={s} timezone={timezone} loading={settings.fading} />
              </ServicesGroup>
              <WirelessGroup settings={s} />
            </>
          )}
          <Integrations query={integrations} owner={owner} />
          <DangerZone owner={owner} networkName={network.data?.name ?? null} />
        </div>
        <aside className="flex flex-col gap-4 xl:sticky xl:top-0">
          <PendingPanel offline={offline} bridged={bridged} />
        </aside>
      </div>
    </PendingImpactProvider>
  );
}
