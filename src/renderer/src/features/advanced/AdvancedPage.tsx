/**
 * Advanced networking (read view): every network-wide setting as it is now,
 * power saving schedules on the shared week timeline, Thread without its
 * secrets, integrations and the danger zone. Every control is disabled
 * ("Coming soon") until the settings writes and `settings.impact` land in M5.
 * Layout, data and states: docs/ux/pages/advanced-networking.md and
 * docs/mockups/13-advanced-networking.html.
 */
import { Info } from "lucide-react";

import type { PageProps } from "~/app/routes";
import { useQuery } from "~/app/useCommand";
import { Card } from "~/components/ui/card";
import { SectionError } from "~/components/ui/page";
import { cn } from "~/lib/utils";
import { TopBarSubtitle, TopBarTitle } from "~/features/shell/TopBar";
import type { Integrations as IntegrationsData, Internet, Network, NetworkSettings } from "../../../../core/model";

import { Integrations } from "./Integrations";
import { PowerSaving } from "./PowerSaving";
import { DangerZone, InternetGroup, ServicesGroup, WirelessGroup } from "./SettingsGroups";

export function AdvancedPage(_: PageProps) {
  const network = useQuery<Network>("network.get", undefined, { poll: true });
  const internet = useQuery<Internet>("internet.get", undefined, { poll: true });
  const settings = useQuery<NetworkSettings>("settings.get");
  const integrations = useQuery<IntegrationsData>("integrations.get");

  const s = settings.data;
  const bridged = s?.connectionMode === "bridged" || network.data?.connectionMode === "bridged";
  const offline = network.data?.status === "offline";
  const owner = network.data?.role === "owner";
  const timezone = s?.timezone ?? network.data?.timezone ?? null;

  return (
    <>
      <TopBarTitle>Advanced networking</TopBarTitle>
      <TopBarSubtitle>Changes apply to every eero</TopBarSubtitle>
      <div className="grid items-start gap-7 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className={cn("flex min-w-0 flex-col gap-6 transition-opacity", settings.fading && "opacity-40")}>
          {settings.error && !s ? (
            <SectionError what="network settings" error={settings.error} onRetry={() => void settings.refetch()} />
          ) : (
            <>
              <InternetGroup settings={s} internet={internet.data} bridged={bridged} />
              <ServicesGroup settings={s} bridged={bridged}>
                <PowerSaving settings={s} timezone={timezone} loading={settings.fading} />
              </ServicesGroup>
              <WirelessGroup settings={s} />
            </>
          )}
          <Integrations query={integrations} owner={owner} />
          <DangerZone owner={owner} networkName={network.data?.name ?? null} />
        </div>
        <aside className="flex flex-col gap-4 xl:sticky xl:top-0">
          <Card padded className="flex flex-col gap-2 text-xs">
            <div className="flex items-center gap-2 font-medium text-sm [&_svg]:size-4 [&_svg]:text-muted-foreground">
              <Info />
              Read only for now
            </div>
            <p className="text-muted-foreground">
              These are the settings eero reports for this network. Changing them comes in a later update, with a preview of which eeros restart and for how long.
            </p>
            {offline && <p className="text-warning-foreground">Your network is offline. Settings are read from the cloud and may be out of date.</p>}
            {bridged && <p className="text-muted-foreground">This network is in bridge mode: another router handles addressing, DNS and port forwarding.</p>}
          </Card>
        </aside>
      </div>
    </>
  );
}
