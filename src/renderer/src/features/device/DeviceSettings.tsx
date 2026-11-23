/**
 * Device detail "Device settings" (docs/ux/pages/device-detail.md, Layout 6):
 * settings rows in one card at the bottom of the page, like eero detail's
 * "eero settings". Profile picks the device's profile from a menu
 * (`device.profile.set`, Undo toast). The name and icon are changed from the
 * hero (Rename… and the icon itself). The section is left out for guests and
 * in bridge mode, where there is no profile to pick, and the row dims with
 * the reason while the device is blocked. Controls dim by permission.
 */
import { ChevronDown, UserRound } from "lucide-react";
import { useQuery } from "~/app/useCommand";
import { performWrite } from "~/app/useWrite";
import { Card, Section } from "~/components/ui/card";
import { GatedButton, useGate } from "~/components/ui/page";
import { ProfileMenu, profileRequest } from "~/features/devices/BulkBar";
import { Row as SettingsRow } from "~/features/advanced/SettingsGroups";
import { entityColors } from "~/lib/chartColors";
import type { ProfileList } from "../../../../core/model";

import type { DeviceView } from "./DevicePage";

export function DeviceSettings({ view }: { view: DeviceView }) {
  const d = view.device;
  const profiles = useQuery<ProfileList>("profile.list", undefined, { poll: true, enabled: !view.bridged });
  const gate = useGate({ area: "devices", bridgeOff: true });

  const list = profiles.data?.profiles ?? [];
  const colors = entityColors(list.map((p) => p.id));
  const profile = d?.profileId ? list.find((p) => p.id === d.profileId) : undefined;
  const showProfile = !view.bridged && !view.guest;
  const profileName = profile?.name ?? (d && !d.profileId ? "Unassigned" : null);
  const profileGate = d?.blocked ? { allowed: false, reason: `Unblock ${d.name} to change its profile` } : gate;

  // "In Alex" or "No profile": what the setting is now.
  const description = d && profileName ? (profile ? `In ${profile.name}` : "No profile") : "-";

  const profileButton = (
    // 32px, the settings row control size.
    <GatedButton gate={d ? profileGate : { allowed: false, reason: null }} variant="outline">
      <UserRound />
      {profileName ?? "-"}
      <ChevronDown />
    </GatedButton>
  );

  if (!showProfile) return null;
  return (
    <Section title="Device settings" description={description} className="gap-[15px]">
      <Card className="divide-y divide-border/50">
        <SettingsRow
            title="Profile"
            description="Pauses, schedules and usage for this device follow its profile."
            control={
              d && profileGate.allowed ? (
                <ProfileMenu
                  profiles={list.map((p) => ({ id: p.id, name: p.name, color: colors[p.id] }))}
                  current={d.profileId}
                  onPick={(p) => void performWrite(profileRequest([d], p))}
                  trigger={profileButton}
                />
              ) : (
                profileButton
              )
            }
          />
      </Card>
    </Section>
  );
}
