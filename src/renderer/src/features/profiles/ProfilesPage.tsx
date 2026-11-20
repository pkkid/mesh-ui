/**
 * Profiles: people on the network. The hero (counts, next change, who used
 * the most today, devices by profile; Add a profile, Pause all, Resume all),
 * with Usage by profile on its right; then Your profiles (the profile cards,
 * and the unassigned devices under them to drag onto the cards); and today's
 * pauses per profile. Pause and Resume per card, Rename and Delete, and Pause
 * unassigned run their write commands. Layout, data and states: docs/ux/pages/profiles.md and
 * docs/mockups/07-profiles.html. Every figure comes from a query command.
 */
import { useState } from "react";

import { Link, pathFor } from "~/app/router";
import type { PageProps } from "~/app/routes";
import { useQuery } from "~/app/useCommand";
import { Button } from "~/components/ui/button";
import { Card, Empty } from "~/components/ui/card";
import { entityColors, seriesColors } from "~/lib/chartColors";
import type { DeviceList, Network, ProfileList, UsageBreakdown, UsageSeries } from "../../../../core/model";

import { ProfileCards, ProfileSheet, type SheetMode } from "./ProfileCards";
import { ProfilesHero } from "./ProfilesHero";
import { ScheduleOverview } from "./ScheduleOverview";

/** A profile's colour, by id; Unassigned (null) is the neutral series. */
export type ProfileColor = (id: string | null) => string;

export function ProfilesPage(_props: PageProps) {
  const [sheet, setSheet] = useState<SheetMode | null>(null);
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
      <ProfilesHero profiles={profiles} usage={today.data} colorOf={colorOf} timezone={timezone} onAdd={() => setSheet({ kind: "create" })} />
      <div className="flex flex-col gap-14">
        <ProfileCards
          profiles={profiles}
          devices={devices}
          usage={today.data}
          deviceUsage={deviceUsage.data}
          colorOf={colorOf}
          timezone={timezone}
          setSheet={setSheet}
        />
        <ScheduleOverview profiles={profiles} colorOf={colorOf} timezone={timezone} />
      </div>
      <ProfileSheet mode={sheet} onClose={() => setSheet(null)} />
    </>
  );
}
