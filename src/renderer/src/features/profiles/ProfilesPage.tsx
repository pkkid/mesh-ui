/**
 * Profiles: people on the network. Profile cards with state, devices,
 * today's usage and the next schedule; today's pauses per profile; usage by
 * profile; and the Unassigned devices. Pause, resume, add and assign are
 * write commands from a later milestone, so they show disabled ("Coming
 * soon"). Layout, data and states: docs/ux/pages/profiles.md and
 * docs/mockups/07-profiles.html. Every figure comes from a query command.
 */
import { Plus } from "lucide-react";

import { Link, pathFor } from "~/app/router";
import type { PageProps } from "~/app/routes";
import { useQuery } from "~/app/useCommand";
import { Button } from "~/components/ui/button";
import { Card, Empty } from "~/components/ui/card";
import { ComingSoonButton } from "~/components/ui/page";
import { TopBarActions } from "~/features/shell/TopBar";
import { entityColors, seriesColors } from "~/lib/chartColors";
import type { DeviceList, Network, ProfileList, UsageBreakdown, UsageSeries } from "../../../../core/model";

import { ProfileCards } from "./ProfileCards";
import { ProfilesUsage } from "./ProfilesUsage";
import { ScheduleOverview } from "./ScheduleOverview";
import { UnassignedCard } from "./UnassignedCard";

/** A profile's colour, by id; Unassigned (null) is the neutral series. */
export type ProfileColor = (id: string | null) => string;

export function ProfilesPage(_props: PageProps) {
  const network = useQuery<Network>("network.get", undefined, { poll: true });
  const bridged = network.data?.connectionMode === "bridged" || network.data?.connectionMode === "ipPassthrough";
  const enabled = !bridged;
  const profiles = useQuery<ProfileList>("profile.list", undefined, { poll: true, enabled });
  const devices = useQuery<DeviceList>("device.list", undefined, { poll: true, enabled });
  const today = useQuery<UsageSeries[]>("usage.get", { scope: "profile", range: "day" }, { poll: true, enabled });
  const deviceUsage = useQuery<UsageBreakdown>("usage.breakdown", { range: "day", by: "device" }, { poll: true, enabled });

  const list = profiles.data?.profiles ?? [];
  const colors = entityColors(list.map((p) => p.id));
  const colorOf: ProfileColor = (id) => (id === null ? seriesColors.neutral : (colors[id] ?? seriesColors.neutral));
  const timezone = network.data?.timezone ?? null;

  if (bridged) {
    return (
      <Card>
        <Empty className="flex flex-col items-center gap-3">
          <span>
            {network.data?.name ?? "This network"} is in bridge mode. Profiles need eero to run the network (NAT); your router
            handles devices instead.
          </span>
          <Button size="xs" variant="outline" render={<Link to={pathFor("advanced")} />}>
            Advanced networking
          </Button>
        </Empty>
      </Card>
    );
  }

  return (
    <>
      <TopBarActions>
        <ComingSoonButton size="sm">
          <Plus />
          Add a profile
        </ComingSoonButton>
      </TopBarActions>

      <ProfileCards profiles={profiles} devices={devices.data?.devices} usage={today.data} colorOf={colorOf} timezone={timezone} />
      <ScheduleOverview profiles={profiles} colorOf={colorOf} timezone={timezone} />
      <ProfilesUsage profiles={profiles.data} colorOf={colorOf} timezone={timezone} />
      <UnassignedCard profiles={profiles.data} devices={devices} usage={deviceUsage.data} colorOf={colorOf} timezone={timezone} />
    </>
  );
}
