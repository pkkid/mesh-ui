/**
 * Profile detail "Profile settings" (docs/ux/pages/profile-detail.md, Layout
 * 5): settings rows in one card at the bottom of the page, like device
 * detail's "Device settings" and eero detail's "eero settings". Rename is in
 * the hero. Delete profile is the row here, an outline button in the destructive colour that asks first (type the
 * name) and runs `profile.delete`, then returns to Profiles.
 */
import { Card, Section } from "~/components/ui/card";
import { GatedButton, useGate } from "~/components/ui/page";
import { Row as SettingsRow } from "~/features/advanced/SettingsGroups";
import { PROFILE_GATE } from "~/features/profiles/ProfileCards";
import type { Profile } from "../../../../core/model";

type Props = { profile: Profile | null; onDelete: () => void; deleting: boolean };

export function ProfileSettings({ profile: p, onDelete, deleting }: Props) {
  const deleteGate = useGate({ ...PROFILE_GATE, op: "delete" });
  const name = p?.name ?? "this profile";
  const devices = p?.deviceIds.length ?? 0;
  const schedules = p?.schedules.length ?? 0;
  // "4 devices, 3 schedules": what deleting the profile lets go of.
  const description = p ? `${devices} ${devices === 1 ? "device" : "devices"}, ${schedules} ${schedules === 1 ? "schedule" : "schedules"}` : "-";

  return (
    <Section title="Profile settings" description={description} className="gap-[15px]">
      <Card className="divide-y divide-border/50">
        <SettingsRow
          title="Delete profile"
          description={`${p ? `${name}'s` : "Its"} devices move to Unassigned, the schedules are removed and any pause is lifted. Usage history stays with the devices.`}
          control={
            // Destructive text, outline; the ellipsis because it asks first (type the name), as eero detail's Remove eero.
            <GatedButton size="sm" variant="outline" tone="danger" gate={deleteGate} disabled={!p || deleting} onClick={onDelete}>
              Delete profile{"…"}
            </GatedButton>
          }
        />
      </Card>
    </Section>
  );
}
