/**
 * The Profiles page header (docs/ux/pages/profiles.md, Layout 1): the flat
 * hero every page opens with. Title is the profile count, the status line
 * splits it by state, and the facts say how much of the network is in a
 * profile, what changes next (the soonest scheduled start or end), and who
 * used the most data today. A share bar of devices by profile, Unassigned
 * included, sits under them. Actions: Add a profile, Pause all, and Resume
 * all while any profile is paused. The right-hand column is Usage by profile
 * (ProfilesUsage.tsx), the way Devices puts Live throughput there. Every
 * figure comes from `profile.list` and `usage.get`.
 */
import { Plus } from "lucide-react";

import type { QueryState } from "~/app/useCommand";
import { ShareBar } from "~/components/charts/ShareBar";
import { Metric, PageHeader } from "~/components/ui/hero";
import { GatedButton, useGate } from "~/components/ui/page";
import { Status } from "~/components/ui/status";
import { cn } from "~/lib/utils";
import { formatBytes, formatCount } from "../../../../core/format";
import type { ProfileList, UsageSeries } from "../../../../core/model";

import { nextLine, PauseAllButton, PROFILE_GATE, ResumeAllButton } from "./ProfileCards";
import type { ProfileColor } from "./ProfilesPage";
import { ProfilesUsage } from "./ProfilesUsage";

type Props = {
  profiles: QueryState<ProfileList>;
  usage: ReadonlyArray<UsageSeries> | undefined;
  colorOf: ProfileColor;
  timezone: string | null;
  onAdd: () => void;
};

const plural = (n: number, word: string) => `${formatCount(n)} ${word}${n === 1 ? "" : "s"}`;

export function ProfilesHero({ profiles, usage, colorOf, timezone, onAdd }: Props) {
  const createGate = useGate({ ...PROFILE_GATE, op: "create" });
  const data = profiles.data;
  const list = data?.profiles ?? [];
  const count = (state: string) => list.filter((p) => p.state === state).length;
  const [active, paused, scheduled] = [count("active"), count("paused"), count("scheduled")];

  const inProfiles = list.reduce((n, p) => n + p.deviceIds.length, 0);
  const unassigned = data?.unassigned.deviceIds.length ?? 0;
  const total = inProfiles + unassigned;

  // The soonest scheduled start or end across every profile that is not paused by hand.
  const next = list
    .filter((p) => !p.paused && p.nextChange)
    .sort((a, b) => Date.parse(a.nextChange!.at) - Date.parse(b.nextChange!.at))[0];

  const names = new Map(list.map((p) => [p.id, p.name]));
  const top = (usage ?? [])
    .filter((s) => s.id !== null && names.has(s.id))
    .sort((a, b) => (b.todaySoFar ?? 0) - (a.todaySoFar ?? 0))[0];

  const rest = [paused > 0 && `${formatCount(paused)} paused`, scheduled > 0 && `${formatCount(scheduled)} in a scheduled pause`].filter(Boolean);

  return (
    <PageHeader
      flat
      data-slot="profiles-hero"
      aside={<ProfilesUsage profiles={data} colorOf={colorOf} timezone={timezone} />}
      // 56px between the facts and Usage by profile, as Devices does beside Live throughput.
      className={cn("transition-opacity [&>div:first-child]:gap-14", profiles.fading && "opacity-40")}
      title={data ? plural(list.length, "profile") : "Profiles"}
      status={
        data ? (
          <>
            <Status tone={active > 0 ? "success" : "muted"}>{formatCount(active)} active</Status>
            {rest.length > 0 && <span className="tabular-nums">{rest.join(" · ")}</span>}
          </>
        ) : (
          <span>-</span>
        )
      }
      facts={
        <>
          <Metric
            label="In a profile"
            value={
              data ? (
                <>
                  {formatCount(inProfiles)}
                  <span className="font-normal text-muted-foreground text-xs"> of {plural(total, "device")}</span>
                </>
              ) : null
            }
          />
          <Metric
            label="Next change"
            value={
              data ? (
                next ? (
                  <>
                    {next.name}
                    <span className="font-normal text-muted-foreground text-xs"> · {nextLine(next, timezone)}</span>
                  </>
                ) : (
                  "None scheduled"
                )
              ) : null
            }
          />
          <Metric
            label="Most data today"
            value={
              top?.id ? (
                <>
                  {names.get(top.id)}
                  <span className="font-normal text-muted-foreground text-xs"> · {formatBytes(top.todaySoFar)}</span>
                </>
              ) : null
            }
          />
          <ShareBar
            className="mt-2 basis-full"
            segments={[
              ...list.map((p) => ({ label: p.name, value: p.deviceIds.length, color: colorOf(p.id) })),
              { label: "Unassigned", value: unassigned, color: colorOf(null) },
            ]}
            format={(v) => plural(v, "device")}
          />
        </>
      }
      actions={
        list.length > 0 ? (
          <>
            <GatedButton gate={createGate} variant="outline" onClick={onAdd}>
              <Plus />
              Add a profile{"\u2026"}
            </GatedButton>
            <PauseAllButton profiles={list} />
            {paused > 0 && <ResumeAllButton profiles={list} />}
          </>
        ) : undefined
      }
    />
  );
}
