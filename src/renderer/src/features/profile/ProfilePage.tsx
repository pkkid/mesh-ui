/**
 * Profile detail: one person's profile. Hero with state and the next
 * scheduled change, the weekly schedule of pauses with its list, data usage
 * with top devices, and the profile's devices. Rename, pause, devices and
 * delete run their write commands (schedules come with M4.12).
 * `#/profiles/unassigned` is the Unassigned page. Layout, data and states:
 * docs/ux/pages/profile-detail.md and docs/mockups/08-profile-detail.html.
 * `[` and `]` move between profiles.
 */
import { Pencil, Trash2 } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { Link, navigate, pathFor } from "~/app/router";
import type { PageProps } from "~/app/routes";
import { useQuery } from "~/app/useCommand";
import { Button } from "~/components/ui/button";
import { Card, Empty, Section } from "~/components/ui/card";
import { GatedButton, SectionError, useGate } from "~/components/ui/page";
import { PROFILE_GATE, ProfileSheet, type SheetMode, useDeleteProfile } from "~/features/profiles/ProfileCards";
import { TopBarActions, TopBarTitle } from "~/features/shell/TopBar";
import { entityColors, seriesColors } from "~/lib/chartColors";
import type { Network, ProfileDetail, ProfileList } from "../../../../core/model";

import { neighbour } from "./helpers";
import { ProfileDevices } from "./ProfileDevices";
import { ProfileHero } from "./ProfileHero";
import { ProfileSchedules } from "./ProfileSchedules";
import { ProfileUsage } from "./ProfileUsage";
import { UnassignedPage } from "./UnassignedPage";

export function ProfilePage(props: PageProps) {
  // Unassigned is not a profile and has no id; it shares the route (profile ids are numbers).
  return props.params.profileId === UNASSIGNED ? <UnassignedPage {...props} /> : <OneProfile {...props} />;
}

/** The Unassigned page's route param: `pathFor("profile", { profileId: UNASSIGNED })`. */
export const UNASSIGNED = "unassigned";

function OneProfile({ params }: PageProps) {
  const id = params.profileId ?? "";
  const [sheet, setSheet] = useState<SheetMode | null>(null);
  const gate = useGate(PROFILE_GATE);
  const deleteGate = useGate({ ...PROFILE_GATE, op: "delete" });
  const del = useDeleteProfile(() => navigate(pathFor("profiles")));
  const network = useQuery<Network>("network.get", undefined, { poll: true });
  const bridged = network.data?.connectionMode === "bridged" || network.data?.connectionMode === "ipPassthrough";
  const enabled = id !== "" && !bridged;
  const profile = useQuery<ProfileDetail>("profile.get", { profile: id }, { poll: true, enabled });
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
  // Gone, or eero's own Unassigned group (a `default: true` profile the list leaves out): one note for both,
  // since a cached detail read cannot tell them apart without racing the list.
  if (profiles.data && !listed) {
    return (
      <Note>
        <span>This profile is no longer on {networkName}. Devices with no profile are listed under Unassigned on Profiles.</span>
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
        <GatedButton gate={gate} size="sm" variant="outline" disabled={!data} onClick={() => data && setSheet({ kind: "rename", profile: data })}>
          <Pencil />
          Rename
        </GatedButton>
      </TopBarActions>
      <ProfileSheet mode={sheet} onClose={() => setSheet(null)} />

      <ProfileHero profile={data} color={color} timezone={timezone} fading={profile.fading} />
      <ProfileSchedules profile={data} timezone={timezone} fading={profile.fading} />

      <ProfileUsage profileId={id} profile={data} timezone={timezone} />
      <ProfileDevices profileId={id} profile={data} color={color} timezone={timezone} onEdit={() => data && setSheet({ kind: "devices", profile: data })} />

      <Section title={<span className="text-destructive">Delete profile</span>}>
        <Card padded className="flex flex-wrap items-center gap-4">
          <p className="min-w-0 flex-1 text-muted-foreground text-xs">
            {name ? `${name}'s` : "Its"} devices move to Unassigned, the schedules are removed and any pause is lifted. Usage history stays with the devices.
          </p>
          <GatedButton gate={deleteGate} size="sm" variant="destructive" disabled={!data || del.running} onClick={() => data && void del.run(data)}>
            <Trash2 />
            Delete profile
          </GatedButton>
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
