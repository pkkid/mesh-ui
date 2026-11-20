/**
 * "Today's pauses": one lane per profile plus Unassigned, 12 AM to 12 AM in
 * the network time zone. Segments come from `profile.list` (`today`, computed
 * in core): past scheduled spans solid muted, upcoming ones hatched, a manual
 * pause in the warning colour, and a Now line across every lane. With no
 * schedules anywhere and nothing paused today it collapses to one line and
 * an Add a schedule picker (a profile opens the schedule sheet, Unassigned
 * opens its page). docs/ux/pages/profiles.md (Layout 3, States), mockup 07.
 */
import { Popover } from "@base-ui/react/popover";
import { Plus } from "lucide-react";
import { type CSSProperties, useState } from "react";

import { navigate, pathFor } from "~/app/router";
import type { QueryState } from "~/app/useCommand";
import { Card, Section } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { GatedButton, SectionError, useGate, useNow } from "~/components/ui/page";
import { formatMinute, MINUTES_PER_DAY } from "~/components/ui/timeline";
import { cn } from "~/lib/utils";
import { networkClock } from "../../../../core/format";
import type { PauseSegment, Profile, ProfileList } from "../../../../core/model";
import { ScheduleSheet } from "../profile/ScheduleSheet";

import { Avatar, nextLine, PROFILE_GATE } from "./ProfileCards";
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
  // "3 scheduled, 1 manual, Pacific Time": today's pauses by kind (zero counts left out), then the zone they are in.
  const segments = lanes.flatMap((l) => l.segments);
  const kinds = (["scheduled", "manual"] as const).map((k) => [k, segments.filter((x) => x.kind === k).length] as const).filter(([, n]) => n > 0);
  const description = known ? [...kinds.map(([k, n]) => `${n} ${k}`), zoneName(tz)].join(", ") : "-";

  // Nothing scheduled anywhere and nothing paused today: one line, not a chart of empty lanes.
  // Only once the list has answered, so the empty form never flashes while it loads.
  if (data && !profiles.error && !hasPauses(data)) {
    return (
      <Section title="Today's pauses" className="gap-[15px]" description="None scheduled" tools={<AddSchedule profiles={data.profiles} colorOf={colorOf} />}>
        <Card className="px-[18px] py-3 text-[13px] text-muted-foreground">
          No scheduled pauses. Schedules pause a profile's internet at set times, like bedtime.
        </Card>
      </Section>
    );
  }

  return (
    <Section
      title="Today's pauses"
      className="gap-[15px]"
      description={description}
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
              // A profile whose schedules do not run today says when the next one does.
              const profile = data?.profiles.find((p) => p.id === lane.profileId);
              const next = profile && profile.schedules.length > 0 ? nextLine(profile, tz) : null;
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
                  emptyText={next ? `No pauses today, ${next}` : "No pauses today"}
                />
              );
            })}
          </div>
          <div className="mt-1.5 grid grid-cols-[8rem_minmax(0,1fr)]" aria-hidden>
            <span />
            <div className="flex justify-between text-3xs text-muted-foreground tabular-nums">
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

/** Whether any profile or Unassigned has a schedule, or any lane has a pause today (a manual pause keeps the chart). */
function hasPauses(data: ProfileList): boolean {
  return (
    data.profiles.some((p) => p.schedules.length > 0) ||
    data.unassigned.schedules.length > 0 ||
    data.today.lanes.some((l) => l.segments.length > 0)
  );
}

/** "Add a schedule": pick a profile to open its schedule sheet, or Unassigned to open its page. */
function AddSchedule({ profiles, colorOf }: { profiles: Profile[]; colorOf: ProfileColor }) {
  const gate = useGate(PROFILE_GATE);
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<Profile | null>(null);
  const item = "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted";
  if (!gate.allowed) {
    return (
      <GatedButton gate={gate} variant="outline">
        <Plus />
        Add a schedule
      </GatedButton>
    );
  }
  const pick = (go: () => void) => () => {
    setOpen(false);
    go();
  };
  return (
    <>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger render={<Button variant="outline" />}>
          <Plus />
          Add a schedule
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner side="bottom" align="end" sideOffset={4} className="z-50">
            <Popover.Popup className="max-h-80 w-56 overflow-y-auto rounded-xl border bg-popover p-1 text-popover-foreground text-xs shadow-lg outline-none">
              <div className="px-2 pt-1 pb-1.5 text-muted-foreground">Pick who to schedule</div>
              {profiles.map((p) => (
                <button key={p.id} type="button" className={item} onClick={pick(() => setTarget(p))}>
                  <Avatar name={p.name} color={colorOf(p.id)} className="size-5 text-2xs" />
                  <span className="truncate">{p.name}</span>
                </button>
              ))}
              <button type="button" className={item} onClick={pick(() => navigate(pathFor("profile", { profileId: "unassigned" })))}>
                <Avatar name="Unassigned" color={colorOf(null)} className="size-5 text-2xs" />
                <span className="truncate">Unassigned</span>
              </button>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      {target ? <ScheduleSheet profile={target} mode={{ kind: "add" }} onClose={() => setTarget(null)} /> : null}
    </>
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
  emptyText: string;
};

function Lane({ name, color, segments, minute, nowLabel, onOpen, loading, emptyText }: LaneProps) {
  return (
    <>
      <div className="flex min-w-0 items-center gap-1.5 text-[13px]">
        {loading ? null : <Avatar name={name} color={color} className="size-5 text-2xs" />}
        <span className="truncate">{loading ? "" : name}</span>
      </div>
      <div className="relative h-6 rounded-[7px] bg-muted">
        {segments.map((s) => (
          <Segment key={`${s.kind}-${s.start}`} segment={s} minute={minute ?? 0} onOpen={onOpen} />
        ))}
        {!loading && segments.length === 0 ? (
          <span className="absolute inset-y-0 left-2.5 flex items-center text-2xs text-muted-foreground/70">{emptyText}</span>
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
