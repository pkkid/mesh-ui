/**
 * "Today's pauses": one lane per profile plus Unassigned, 12 AM to 12 AM in
 * the network time zone. Segments come from `profile.list` (`today`, computed
 * in core): past scheduled spans solid muted, upcoming ones hatched, a manual
 * pause in the warning colour, and a Now line across every lane.
 * docs/ux/pages/profiles.md (Layout 2), mockup 07.
 */
import type { CSSProperties } from "react";

import { navigate, pathFor } from "~/app/router";
import type { QueryState } from "~/app/useCommand";
import { Card, Section } from "~/components/ui/card";
import { SectionError, useNow } from "~/components/ui/page";
import { formatMinute, MINUTES_PER_DAY } from "~/components/ui/timeline";
import { cn } from "~/lib/utils";
import { networkClock } from "../../../../core/format";
import type { PauseSegment, ProfileList } from "../../../../core/model";

import { Avatar } from "./ProfileCards";
import type { ProfileColor } from "./ProfilesPage";

const TICKS = ["12 AM", "6 AM", "12 PM", "6 PM", "12 AM"];
const pct = (minute: number) => `${(Math.max(0, Math.min(MINUTES_PER_DAY, minute)) / MINUTES_PER_DAY) * 100}%`;
const HATCH = "repeating-linear-gradient(135deg, color-mix(in srgb, var(--color-muted-foreground) 22%, transparent) 0 5px, transparent 5px 10px)";

/** Minutes after midnight of an instant in a time zone (UTC when unknown). */
function minuteIn(ms: number, timeZone: string | null): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: timeZone ?? "UTC", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(ms);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    return get("hour") * 60 + get("minute");
  } catch {
    return Math.floor((ms % 86_400_000) / 60_000);
  }
}

/** "Pacific Time", from the zone's generic name. */
function zoneName(timeZone: string | null): string {
  if (!timeZone) return "UTC";
  try {
    const p = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longGeneric" }).formatToParts(Date.now());
    return p.find((x) => x.type === "timeZoneName")?.value ?? timeZone;
  } catch {
    return timeZone;
  }
}

type Props = { profiles: QueryState<ProfileList>; colorOf: ProfileColor; timezone: string | null };

export function ScheduleOverview({ profiles, colorOf, timezone }: Props) {
  const now = useNow(60_000);
  const data = profiles.data;
  const tz = data?.today.timezone ?? timezone;
  // Until the network or the list answers, the zone is unknown: no date, no Now line.
  const known = !!data || timezone !== null;
  const clock = networkClock(tz);
  const minute = minuteIn(now, tz);
  const names = new Map((data?.profiles ?? []).map((p) => [p.id, p.name]));
  const lanes = data?.today.lanes ?? [];

  return (
    <Section
      title="Today's pauses"
      subtitle={known ? `${clock.longDate(now)} · scheduled and manual, network time zone (${zoneName(tz)})` : "Scheduled and manual, network time zone"}
      tools={
        <div className="flex items-center gap-3 text-muted-foreground text-xs" aria-hidden>
          <Swatch className="bg-muted-foreground/40" label="Scheduled" />
          <Swatch className="bg-warning" label="Manual pause" />
          <Swatch style={{ background: HATCH }} className="shadow-[inset_0_0_0_1px_var(--color-border)]" label="Upcoming" />
        </div>
      }
    >
      {profiles.error && !data ? (
        <SectionError what="today's pauses" error={profiles.error} onRetry={() => void profiles.refetch()} />
      ) : (
        <Card padded className="pt-7">
          <div
            role="img"
            aria-label="Pauses today per profile, scheduled and manual"
            className={cn("grid grid-cols-[8rem_minmax(0,1fr)] items-center gap-y-2.5 transition-opacity", profiles.fading && "opacity-40")}
          >
            {(data ? lanes : [{ profileId: null, segments: [] }]).map((lane, i) => {
              const name = lane.profileId === null ? "Unassigned" : (names.get(lane.profileId) ?? "Profile");
              return (
                <Lane
                  key={lane.profileId ?? "unassigned"}
                  name={name}
                  color={colorOf(lane.profileId)}
                  segments={lane.segments}
                  minute={known ? minute : null}
                  nowLabel={i === 0 ? clock.time(now) : null}
                  onOpen={lane.profileId === null ? undefined : () => navigate(pathFor("profile", { profileId: lane.profileId! }))}
                  loading={!data}
                />
              );
            })}
          </div>
          <div className="mt-1.5 grid grid-cols-[8rem_minmax(0,1fr)]" aria-hidden>
            <span />
            <div className="flex justify-between text-3xs text-muted-foreground uppercase tracking-wide">
              {TICKS.map((t, i) => (
                <span key={i}>{t}</span>
              ))}
            </div>
          </div>
        </Card>
      )}
    </Section>
  );
}

function Swatch({ label, className, style }: { label: string; className?: string; style?: CSSProperties }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <i className={cn("size-2 rounded-[2px]", className)} style={style} />
      {label}
    </span>
  );
}

type LaneProps = {
  name: string;
  color: string;
  segments: PauseSegment[];
  minute: number | null;
  nowLabel: string | null;
  onOpen?: () => void;
  loading: boolean;
};

function Lane({ name, color, segments, minute, nowLabel, onOpen, loading }: LaneProps) {
  return (
    <>
      <div className="flex min-w-0 items-center gap-1.5 text-[13px]">
        {loading ? null : <Avatar name={name} color={color} className="size-5 text-2xs" />}
        <span className="truncate">{loading ? "" : name}</span>
      </div>
      <div className="relative h-6 rounded-[7px] bg-muted/40 shadow-[inset_0_0_0_1px_var(--color-border)]">
        {segments.map((s) => (
          <Segment key={`${s.kind}-${s.start}`} segment={s} minute={minute ?? 0} onOpen={onOpen} />
        ))}
        {!loading && segments.length === 0 ? (
          <span className="absolute inset-y-0 left-2.5 flex items-center text-2xs text-muted-foreground/70">No pauses today</span>
        ) : null}
        {minute === null ? null : (
          <span className="absolute -inset-y-1 z-10 w-0.5 -translate-x-1/2 rounded-full bg-foreground" style={{ left: pct(minute) }} aria-hidden>
            {nowLabel ? (
              <span className="absolute -top-4 left-1/2 -translate-x-1/2 whitespace-nowrap font-semibold text-2xs text-foreground">{nowLabel}</span>
            ) : null}
          </span>
        )}
      </div>
    </>
  );
}

function Segment({ segment: s, minute, onOpen }: { segment: PauseSegment; minute: number; onOpen?: () => void }) {
  const upcoming = s.start > minute;
  const manual = s.kind === "manual";
  const title = manual ? `${s.label} · since ${formatMinute(s.start)}` : `${s.label} · ${formatMinute(s.start)} to ${formatMinute(s.end)}`;
  return (
    <button
      type="button"
      title={title}
      onClick={onOpen}
      className={cn(
        "absolute inset-y-[3px] flex cursor-pointer items-center overflow-hidden whitespace-nowrap rounded-[5px] px-1.5 font-semibold text-[10px] outline-none focus-visible:ring-2 focus-visible:ring-ring",
        manual ? "bg-warning text-background" : upcoming ? "text-foreground shadow-[inset_0_0_0_1px_var(--color-border)]" : "bg-muted-foreground/40 text-foreground",
      )}
      style={{ left: `calc(${pct(s.start)} + 1px)`, width: `calc(${pct(s.end - s.start)} - 2px)`, background: !manual && upcoming ? HATCH : undefined }}
    >
      {s.end - s.start >= 90 ? <span className="min-w-0 truncate">{s.label}</span> : null}
    </button>
  );
}
