/**
 * Overview: is the network healthy, how fast is it, who is using it, and
 * what changed recently. Layout, data and states: docs/ux/pages/overview.md
 * and docs/mockups/01-overview.html. Every figure comes from a query command;
 * the page only arranges and words it.
 */
import type { PageProps } from "~/app/routes";
import { useQuery } from "~/app/useCommand";
import { Card } from "~/components/ui/card";
import { useNow } from "~/components/ui/page";
import { TopBarSubtitle } from "~/features/shell/TopBar";
import { formatRelative } from "../../../../core/format";
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
  const bridged = network.data?.connectionMode === "bridged";

  return (
    <>
      <TopBarSubtitle>
        <Freshness at={network.fetchedAt} />
      </TopBarSubtitle>
      {bridged && (
        <Card padded className="text-muted-foreground text-xs">
          {network.data?.name ?? "This network"} is in bridge mode. Profiles and per-device usage need eero to run the
          network (NAT), so they are hidden here.
        </Card>
      )}
      <NetworkHero />
      <DataUsage />
      {bridged ? (
        <div className="grid gap-7 lg:grid-cols-3">
          <EerosList />
          <BusyHeatmap />
          <RecentActivity />
        </div>
      ) : (
        <>
          <div className="grid gap-7 lg:grid-cols-2">
            <EerosList />
            <TopDevices />
          </div>
          <div className="grid gap-7 lg:grid-cols-3">
            <ProfilesList />
            <BusyHeatmap />
            <RecentActivity />
          </div>
        </>
      )}
    </>
  );
}

/** "Updated just now", counting up between polls. */
function Freshness({ at }: { at: number | null }) {
  const now = useNow(15_000);
  if (at === null) return null;
  return <>Updated {formatRelative(new Date(at).toISOString(), now)}</>;
}
