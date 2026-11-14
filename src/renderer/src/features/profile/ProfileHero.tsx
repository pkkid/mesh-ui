/**
 * Profile detail hero (docs/ux/pages/profile-detail.md, Layout 1): the
 * initial in the profile colour, name, state and the next scheduled change
 * (both from `profile.get`, computed in core), devices, last 7 days and
 * scheduled off-time, and the Pause / Resume button (disabled until the
 * profile writes land). States: active, scheduled, in a scheduled pause,
 * paused (manual) and no devices.
 */
import { Pause, Play } from "lucide-react";

import { useQuery } from "~/app/useCommand";
import { Metric, PageHeader } from "~/components/ui/hero";
import { ComingSoonButton, useNow } from "~/components/ui/page";
import { Status } from "~/components/ui/status";
import { PROFILE_STATE } from "~/features/profiles/ProfileCards";
import { cn } from "~/lib/utils";
import { formatBytes, formatCount } from "../../../../core/format";
import type { Profile, UsageSeries } from "../../../../core/model";

import { heroLine, hoursLine, inScheduledPause } from "./helpers";

type Props = { profile: Profile | null; color: string; timezone: string | null; fading: boolean };

export function ProfileHero({ profile: p, color, timezone, fading }: Props) {
  const week = useQuery<UsageSeries>("usage.get", { scope: "profile", id: p?.id, range: "week" }, { poll: true, enabled: !!p });
  // The countdown in the line ticks every minute.
  const now = useNow(60_000);

  const name = p?.name ?? "";
  const devices = p?.deviceIds.length ?? null;
  const state = p ? PROFILE_STATE[p.state] : null;
  const scheduledPause = p ? inScheduledPause(p) : false;
  const line = p ? heroLine(p, timezone, now) : null;
  const total = week.data ? week.data.total.down + week.data.total.up : null;
  const possessive = name ? `${name}'s` : "the";

  const action = p?.paused ? (
    <ComingSoonButton size="lg" variant="outline" className="w-full">
      <Play />
      Resume profile
    </ComingSoonButton>
  ) : (
    <ComingSoonButton size="lg" variant="outline" className="w-full" title={devices === 0 ? "Add a device first" : "Coming soon"}>
      <Pause />
      Pause profile
    </ComingSoonButton>
  );
  const hint = p?.paused
    ? `Resuming during a scheduled pause keeps ${name || "it"} online until the next scheduled pause.`
    : devices === 0
      ? "Add a device first."
      : devices !== null
        ? `Stops internet on ${possessive} ${formatCount(devices)} device${devices === 1 ? "" : "s"} now.`
        : null;

  return (
    <PageHeader
      className={cn("transition-opacity", fading && !p && "opacity-40")}
      icon={
        <span
          aria-hidden
          className="grid size-[88px] shrink-0 place-items-center rounded-full font-semibold text-4xl text-background"
          style={{ backgroundColor: color }}
        >
          {name.slice(0, 1).toUpperCase()}
        </span>
      }
      title={name || " "}
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
          <Metric label="Devices" value={p ? `${formatCount(p.deviceIds.length)} · ${formatCount(p.devicesOnline)} online` : null} />
          <Metric label="Last 7 days" value={total === null ? null : formatBytes(total)} />
          <Metric label="Scheduled off-time" value={p ? (hoursLine(p.schedules) ?? "None") : null} />
        </>
      }
      aside={
        p ? (
          <div className="flex max-w-60 flex-col items-stretch gap-2">
            {action}
            {hint ? <p className="text-2xs text-muted-foreground">{hint}</p> : null}
          </div>
        ) : null
      }
    />
  );
}
