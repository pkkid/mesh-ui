/**
 * Overview: is the network healthy, how fast is it, who is using it, and
 * what changed recently. Layout, data and states: docs/ux/pages/overview.md
 * and docs/mockups/01-overview.html. Every figure comes from a query command;
 * the page only arranges and words it.
 */
import type { PageProps } from "~/app/routes";
import { useQuery } from "~/app/useCommand";
import { Card } from "~/components/ui/card";
import { useTopBarUpdated } from "~/features/shell/TopBar";
import type { Network } from "../../../../core/model";

import { BusyHeatmap } from "./BusyHeatmap";
import { DataUsage } from "./DataUsage";
import { EerosList } from "./EerosList";
import { NetworkHero } from "./NetworkHero";
import { ProfilesList } from "./ProfilesList";
import { RecentActivity } from "./RecentActivity";
import { TopDevices } from "./TopDevices";

export function OverviewView(_props: PageProps) {
  const network = useQuery<Network>("network.get", undefined, { poll: true });
  useTopBarUpdated(network.fetchedAt);
  const bridged = network.data?.connectionMode === "bridged";

  return (
    <>
      {bridged && (
        <Card padded className="text-muted-foreground text-xs">
          {network.data?.name ?? "This network"} is in bridge mode. Profiles and per-device usage need eero to run the
          network (NAT), so they are hidden here.
        </Card>
      )}
      <NetworkHero />
      {/* 56px between sections, the same as from the hero's rule to Data usage. */}
      <div className="flex flex-col gap-14">
        <DataUsage />
        {bridged ? (
          <div className="grid gap-x-7 gap-y-14 lg:grid-cols-3">
            <EerosList />
            <BusyHeatmap />
            <RecentActivity />
          </div>
        ) : (
          <>
            <div className="grid gap-x-7 gap-y-14 lg:grid-cols-2">
              <EerosList />
              <TopDevices />
            </div>
            <div className="grid gap-x-7 gap-y-14 lg:grid-cols-3">
              <ProfilesList />
              <BusyHeatmap />
              <RecentActivity />
            </div>
          </>
        )}
      </div>
    </>
  );
}

