/**
 * Profile detail: one person's profile. Hero with state and the next
 * scheduled change, the weekly schedule of pauses with its list, data usage
 * with top devices, and the profile's devices. Read-only for now: every write
 * (rename, pause, schedules, devices, delete) is a disabled "Coming soon"
 * control until its command lands. Layout, data and states:
 * docs/ux/pages/profile-detail.md and docs/mockups/08-profile-detail.html.
 * `[` and `]` move between profiles.
 */
import { Pencil, Trash2 } from "lucide-react";
import { type ReactNode, useEffect } from "react";

import { Link, navigate, pathFor } from "~/app/router";
import type { PageProps } from "~/app/routes";
import { useQuery } from "~/app/useCommand";
import { Button } from "~/components/ui/button";
import { Card, Empty, Section } from "~/components/ui/card";
import { ComingSoonButton, SectionError } from "~/components/ui/page";
import { TopBarActions, TopBarTitle } from "~/features/shell/TopBar";
import { entityColors, seriesColors } from "~/lib/chartColors";
import type { Network, Profile, ProfileList } from "../../../../core/model";

import { neighbour } from "./helpers";
import { ProfileDevices } from "./ProfileDevices";
import { ProfileHero } from "./ProfileHero";
import { ProfileSchedules } from "./ProfileSchedules";
import { ProfileUsage } from "./ProfileUsage";

export function ProfilePage({ params }: PageProps) {
  const id = params.profileId ?? "";
  const network = useQuery<Network>("network.get", undefined, { poll: true });
  const bridged = network.data?.connectionMode === "bridged" || network.data?.connectionMode === "ipPassthrough";
  const enabled = id !== "" && !bridged;
  const profile = useQuery<Profile>("profile.get", { profile: id }, { poll: true, enabled });
  const profiles = useQuery<ProfileList>("profile.list", undefined, { poll: true, enabled: !bridged });

  const list = profiles.data?.profiles ?? [];
  const listed = list.find((p) => p.id === id) ?? null;
  // The single read wins; the list fills in while it loads.
  const data = profile.data?.id === id ? profile.data : listed;
  const color = entityColors(list.map((p) => p.id))[id] ?? seriesColors.neutral;
  const networkName = network.data?.name ?? "this network";
  const timezone = network.data?.timezone ?? null;

  useProfileShortcuts(
    list.map((p) => p.id),
    id,
  );

  if (bridged) {
    return (
      <Note>
        <span>{network.data?.name ?? "This network"} is in bridge mode. Profiles need eero to run the network (NAT); your router handles devices instead.</span>
        <Button size="xs" variant="outline" render={<Link to={pathFor("advanced")} />}>
          Advanced networking
        </Button>
      </Note>
    );
  }
  // eero's own Unassigned group reads like a profile (`default: true`), but the list leaves it out.
  if (profiles.data && !listed) {
    const unassigned = profile.data?.id === id && !profile.error;
    return (
      <Note>
        <span>
          {unassigned
            ? "This is eero's Unassigned group, not a profile. Devices with no profile are listed under Unassigned on Profiles."
            : `This profile is no longer on ${networkName}.`}
        </span>
        <Link to={pathFor("profiles")} className="text-foreground underline-offset-2 hover:underline">
          Go to Profiles
        </Link>
      </Note>
    );
  }
  if (profile.error && !data) return <SectionError what="this profile" error={profile.error} onRetry={() => void profile.refetch()} />;

  const name = data?.name ?? "";
  return (
    <>
      <TopBarTitle>{name}</TopBarTitle>
      <TopBarActions>
        <ComingSoonButton size="sm" variant="outline">
          <Pencil />
          Rename
        </ComingSoonButton>
      </TopBarActions>

      <ProfileHero profile={data} color={color} timezone={timezone} fading={profile.fading} />
      <ProfileSchedules profile={data} timezone={timezone} fading={profile.fading} />

      <ProfileUsage profileId={id} profile={data} timezone={timezone} />
      <ProfileDevices profileId={id} profile={data} color={color} timezone={timezone} />

      <Section title={<span className="text-destructive">Delete profile</span>}>
        <Card padded className="flex flex-wrap items-center gap-4">
          <p className="min-w-0 flex-1 text-muted-foreground text-xs">
            {name ? `${name}'s` : "Its"} devices move to Unassigned, the schedules are removed and any pause is lifted. Usage history stays with the devices.
          </p>
          <ComingSoonButton size="sm" variant="destructive">
            <Trash2 />
            Delete profile
          </ComingSoonButton>
        </Card>
      </Section>
    </>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <Card>
      <Empty className="flex flex-col items-center gap-3">{children}</Empty>
    </Card>
  );
}

/** `[` and `]` open the previous and next profile, in `profile.list` order (by name). */
function useProfileShortcuts(ids: ReadonlyArray<string>, id: string) {
  const key = ids.join(",");
  useEffect(() => {
    const list = key ? key.split(",") : [];
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "[" && e.key !== "]") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable='true']")) return;
      const next = neighbour(list, id, e.key === "]" ? 1 : -1);
      if (!next) return;
      e.preventDefault();
      navigate(pathFor("profile", { profileId: next }));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [key, id]);
}
