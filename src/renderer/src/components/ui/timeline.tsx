/**
 * Week timeline for schedules: one lane per day (Mon to Sun), hours across,
 * a block per scheduled span. A span that ends at or before it starts wraps
 * past midnight and is split across two days (Bedtime 9 PM to 7 AM is 9 PM
 * to 12 AM on the day, then 12 AM to 7 AM the next; Sunday wraps to Monday).
 * Shared by profile pause schedules and eero power saving. Mockup:
 * docs/mockups/08-profile-detail.html ("Scheduled pauses").
 *
 * `layoutWeek` is pure (tested in components/charts/charts.test.ts); the
 * component only draws its result.
 */
import type { ReactNode } from "react";

import { cn } from "../../lib/utils";

export const MINUTES_PER_DAY = 24 * 60;

/** Lane order: index 0 is Monday, 6 is Sunday. */
export const WEEK_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export type WeekSchedule = {
  id: string;
  label: string;
  /** From chartColors.ts (the schedule or profile colour). Never pick a colour inline. */
  color: string;
  icon?: ReactNode;
  /** Days the span starts on, 0 (Monday) to 6 (Sunday). */
  days: ReadonlyArray<number>;
  /** Minutes after midnight, 0 to 1439. */
  start: number;
  /** Minutes after midnight, 0 to 1440. At or before `start` means the span wraps past midnight. */
  end: number;
  /** Disabled schedules draw as a dashed outline. Defaults to true. */
  enabled?: boolean;
};

export type TimelineBlock = {
  schedule: WeekSchedule;
  /** Minutes after midnight on this lane's day, `start < end`, within 0 to 1440. */
  start: number;
  end: number;
  /** This block carries on from the day before (the second half of an overnight span). */
  fromPreviousDay: boolean;
  /** This block carries on into the next day (the first half of an overnight span). */
  intoNextDay: boolean;
};

const clampMinute = (m: number) => Math.max(0, Math.min(MINUTES_PER_DAY, Math.round(m)));

/**
 * Lays schedules out on seven lanes. Overnight spans are split at midnight;
 * Sunday's overnight half lands on Monday. A span whose start equals its end
 * covers a full 24 hours from the start. Blocks in a lane are sorted by start.
 */
export function layoutWeek(schedules: ReadonlyArray<WeekSchedule>): TimelineBlock[][] {
  const lanes: TimelineBlock[][] = WEEK_DAYS.map(() => []);
  for (const schedule of schedules) {
    const start = clampMinute(schedule.start) % MINUTES_PER_DAY;
    const end = clampMinute(schedule.end);
    const wraps = end <= start;
    for (const day of new Set(schedule.days)) {
      if (!Number.isInteger(day) || day < 0 || day > 6) continue;
      if (!wraps) {
        lanes[day]!.push({ schedule, start, end, fromPreviousDay: false, intoNextDay: false });
        continue;
      }
      // Until midnight on the day, then from midnight on the next day.
      const after = end % MINUTES_PER_DAY;
      lanes[day]!.push({ schedule, start, end: MINUTES_PER_DAY, fromPreviousDay: false, intoNextDay: after > 0 });
      if (after > 0) lanes[(day + 1) % 7]!.push({ schedule, start: 0, end: after, fromPreviousDay: true, intoNextDay: false });
    }
  }
  for (const lane of lanes) lane.sort((a, b) => a.start - b.start || a.end - b.end);
  return lanes;
}

/** "9:00 PM" for minutes after midnight (1440 reads as 12:00 AM). */
export function formatMinute(minute: number): string {
  const m = clampMinute(minute) % MINUTES_PER_DAY;
  const h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, "0");
  return `${h % 12 === 0 ? 12 : h % 12}:${mm} ${h < 12 ? "AM" : "PM"}`;
}

const TICKS = ["12 AM", "6 AM", "12 PM", "6 PM", "12 AM"];
const HOURS = Array.from({ length: 23 }, (_, i) => i + 1);
const pct = (minute: number) => `${(minute / MINUTES_PER_DAY) * 100}%`;

export type WeekTimelineProps = {
  schedules: ReadonlyArray<WeekSchedule>;
  /** Today's lane (0 is Monday), emphasised. */
  today?: number | null;
  /** Minutes after midnight in the network time zone, for the Now line on today's lane. */
  now?: number | null;
  /** What the timeline shows, for screen readers. */
  ariaLabel: string;
  loading?: boolean;
  className?: string;
};

export function WeekTimeline({ schedules, today = null, now = null, ariaLabel, loading, className }: WeekTimelineProps) {
  const lanes = layoutWeek(schedules);
  return (
    <div role="img" aria-label={ariaLabel} className={cn("flex flex-col gap-2", className)}>
      <div className={cn("grid grid-cols-[2.75rem_minmax(0,1fr)] items-center gap-y-[7px] transition-opacity", loading && "opacity-40")}>
        {lanes.map((blocks, day) => {
          const isToday = day === today;
          return (
            <Lane key={WEEK_DAYS[day]} day={WEEK_DAYS[day]!} blocks={blocks} isToday={isToday} now={isToday ? now : null} />
          );
        })}
      </div>
      <div className="flex justify-between pl-11 text-3xs text-muted-foreground uppercase tracking-wide" aria-hidden>
        {TICKS.map((t, i) => (
          <span key={i}>{t}</span>
        ))}
      </div>
    </div>
  );
}

function Lane({ day, blocks, isToday, now }: { day: string; blocks: TimelineBlock[]; isToday: boolean; now: number | null }) {
  return (
    <>
      <span
        className={cn("font-semibold text-2xs uppercase tracking-wider", isToday ? "text-foreground" : "text-muted-foreground")}
        aria-hidden
      >
        {day}
      </span>
      <div
        className={cn("relative h-[30px] rounded-lg border bg-muted/40", isToday && "border-muted-foreground/50")}
        aria-hidden
      >
        {HOURS.map((h) => (
          <i key={h} className="absolute inset-y-0 w-px bg-border/70" style={{ left: pct(h * 60) }} />
        ))}
        {blocks.map((b) => (
          <Block key={`${b.schedule.id}-${b.start}`} block={b} />
        ))}
        {now === null ? null : (
          <span className="absolute -inset-y-1 z-10 w-0.5 -translate-x-1/2 rounded-full bg-foreground" style={{ left: pct(now) }}>
            <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 font-bold text-[9.5px] text-foreground">Now</span>
          </span>
        )}
      </div>
    </>
  );
}

function Block({ block }: { block: TimelineBlock }) {
  const { schedule: s, start, end } = block;
  const hours = (end - start) / 60;
  const enabled = s.enabled ?? true;
  const title = `${s.label}${enabled ? "" : " (off)"}: ${formatMinute(s.start)} to ${formatMinute(s.end)}`;
  return (
    <span
      title={title}
      className={cn(
        "absolute inset-y-1 flex items-center gap-1 overflow-hidden whitespace-nowrap rounded-md px-[7px] font-semibold text-[10.5px] [&_svg]:size-[11px] [&_svg]:shrink-0",
        enabled ? "text-background" : "border-[1.5px] border-muted-foreground/70 border-dashed text-muted-foreground",
      )}
      style={{
        left: `calc(${pct(start)} + 1px)`,
        width: `calc(${pct(end - start)} - 2px)`,
        backgroundColor: enabled ? `color-mix(in srgb, ${s.color} 78%, transparent)` : undefined,
      }}
    >
      {s.icon && hours >= 3 ? s.icon : null}
      {hours >= 2 ? <span className="min-w-0 truncate">{enabled ? s.label : `${s.label} (off)`}</span> : null}
    </span>
  );
}
