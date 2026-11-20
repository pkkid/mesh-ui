/**
 * Profile detail hero (docs/ux/pages/profile-detail.md, Layout 1): the flat
 * page header, as on device detail. The initial in the profile colour, the
 * name, state and the next scheduled change (both from `profile.get`,
 * computed in core), Devices, Last 7 days and Scheduled off-time, and the
 * action row at the bottom, outline: Rename… first (the rename sheet), as
 * on device and eero detail, then Pause profile… or Resume profile
 * (`profile.pause` and `profile.resume`, with Undo). Delete is the last row
 * of Profile settings at the bottom of the page (ProfileSettings.tsx). States: active, scheduled, in a scheduled pause, paused
 * (manual) and no devices.
 */
import { useQuery } from "~/app/useCommand";
import { Metric, PageHeader } from "~/components/ui/hero";
import { Pencil } from "lucide-react";

import { GatedButton, useGate, useNow } from "~/components/ui/page";
import { Status } from "~/components/ui/status";
import { DIM_ICON } from "~/features/device/DeviceHero";
import { PROFILE_GATE, PROFILE_STATE, ProfilePauseButton } from "~/features/profiles/ProfileCards";
import { cn } from "~/lib/utils";
import { formatBytes, formatCount } from "../../../../core/format";
import type { Profile, UsageSeries } from "../../../../core/model";

import { heroLine, hoursLine, inScheduledPause } from "./helpers";

type Props = { profile: Profile | null; color: string; timezone: string | null; fading: boolean; onRename: () => void };

export function ProfileHero({ profile: p, color, timezone, fading, onRename }: Props) {
  const gate = useGate(PROFILE_GATE);
  const week = useQuery<UsageSeries>("usage.get", { scope: "profile", id: p?.id, range: "week" }, { poll: true, enabled: !!p });
  // The countdown in the line ticks every minute.
  const now = useNow(60_000);

  const name = p?.name ?? "";
  const state = p ? PROFILE_STATE[p.state] : null;
  const scheduledPause = p ? inScheduledPause(p) : false;
  const line = p ? heroLine(p, timezone, now) : null;
  const total = week.data ? week.data.total.down + week.data.total.up : null;

  return (
    <PageHeader
      flat
      className={cn("transition-opacity", fading && !p && "opacity-40")}
      icon={
        // 64px, the size of the icon tile on device and eero detail.
        <span
          aria-hidden
          className="grid size-16 shrink-0 place-items-center rounded-full font-semibold text-[28px] text-background"
          style={{ backgroundColor: p ? color : "var(--color-muted)" }}
        >
          {name.slice(0, 1).toUpperCase()}
        </span>
      }
      title={name || "-"}
      status={
        p && state ? (
          <>
            <Status tone={state.tone}>{state.label}</Status>
            {scheduledPause ? <Status tone="warning">Paused by schedule</Status> : null}
            {line ? <span>{line}</span> : null}
          </>
        ) : null
      }
      facts={
        <>
          <Metric
            label="Devices"
            value={
              p ? (
                <>
                  {formatCount(p.deviceIds.length)}
                  <span className="font-normal text-muted-foreground text-xs"> · {formatCount(p.devicesOnline)} online</span>
                </>
              ) : null
            }
          />
          <Metric label="Last 7 days" value={total === null ? null : formatBytes(total)} />
          <Metric label="Scheduled off-time" value={p ? (hoursLine(p.schedules) ?? "None") : null} />
        </>
      }
      actions={
        p ? (
          <>
            {/* Rename first in every detail hero; it opens the rename sheet, so it ends in an ellipsis. */}
            <GatedButton gate={gate} variant="outline" className={DIM_ICON} onClick={onRename}>
              <Pencil />
              Rename{"\u2026"}
            </GatedButton>
            <ProfilePauseButton profile={p} hero />
          </>
        ) : null
      }
    />
  );
}
