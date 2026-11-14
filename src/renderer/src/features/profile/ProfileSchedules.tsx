/**
 * Profile detail "Scheduled pauses" and "Schedules" (docs/ux/pages/
 * profile-detail.md, Layout 2): the week on the shared timeline, one lane a
 * day with today and the Now line in the network time zone, and the list of
 * schedules with their times, days and on or off. Schedules come only from
 * `profile.get` (the profile's own `schedule[]`). Adding, editing and
 * switching schedules are writes from a later milestone ("Coming soon").
 */
import { BookOpen, CalendarClock, Moon, Plus, Utensils } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

import { Card, Empty, Section } from "~/components/ui/card";
import { ComingSoonButton, useNow } from "~/components/ui/page";
import { WeekTimeline, type WeekSchedule } from "~/components/ui/timeline";
import { entityColors } from "~/lib/chartColors";
import { cn } from "~/lib/utils";
import type { Profile, Schedule } from "../../../../core/model";

import { dayChips, scheduleIcon, timeRange, todayIn, weekInput, zoneName } from "./helpers";

const ICONS = { moon: Moon, book: BookOpen, utensils: Utensils, "calendar-clock": CalendarClock } as const;

export function ScheduleIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[scheduleIcon(name)];
  return <Icon aria-hidden className={className} />;
}

/** One colour per schedule, stable by schedule id. */
export const scheduleColors = (schedules: ReadonlyArray<Schedule>) => entityColors(schedules.map((s) => s.id));

type Props = { profile: Profile | null; timezone: string | null; fading: boolean };

export function ProfileSchedules({ profile: p, timezone, fading }: Props) {
  const now = useNow(60_000);
  const schedules = p?.schedules ?? [];
  const colors = scheduleColors(schedules);
  const today = todayIn(now, timezone);
  const week: WeekSchedule[] = schedules.map((s) => ({
    ...weekInput(s),
    color: colors[s.id] ?? "",
    icon: <ScheduleIcon name={s.name} />,
  }));
  const name = p?.name ?? "this profile";
  const empty = p && schedules.length === 0;

  return (
    <div className="grid gap-7 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Section
        title="Scheduled pauses"
        subtitle={`This week · network time zone (${zoneName(timezone, now)})`}
        tools={
          schedules.length > 0 ? (
            <div className="flex flex-wrap items-center gap-3 text-muted-foreground text-xs" aria-hidden>
              {schedules.map((s) => (
                <Swatch key={s.id} label={s.name} style={s.enabled ? { backgroundColor: colors[s.id] } : undefined} dashed={!s.enabled} />
              ))}
            </div>
          ) : null
        }
      >
        <Card padded className="pt-6">
          <WeekTimeline
            schedules={week}
            today={p ? today.lane : null}
            now={p ? today.minute : null}
            loading={fading || !p}
            ariaLabel={`Scheduled pauses for ${name} this week, Monday to Sunday`}
          />
          {empty ? (
            <p className="mt-3 text-center text-muted-foreground text-xs">
              No scheduled pauses. Add one to pause {p.name}'s devices automatically, like at bedtime.
            </p>
          ) : null}
        </Card>
      </Section>

      <Section
        title="Schedules"
        tools={
          <ComingSoonButton size="xs" variant="outline">
            <Plus />
            Add a scheduled pause
          </ComingSoonButton>
        }
      >
        <Card className={cn("divide-y transition-opacity", fading && "opacity-40")}>
          {!p ? (
            <div className="h-[58px]" />
          ) : schedules.length === 0 ? (
            <Empty>No scheduled pauses yet.</Empty>
          ) : (
            schedules.map((s) => <ScheduleRow key={s.id} schedule={s} color={colors[s.id] ?? ""} />)
          )}
        </Card>
      </Section>
    </div>
  );
}

function ScheduleRow({ schedule: s, color }: { schedule: Schedule; color: string }) {
  return (
    <div className={cn("flex min-h-[58px] items-center gap-3 px-[18px] py-2.5", !s.enabled && "opacity-60")}>
      <span
        aria-hidden
        className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-muted text-muted-foreground shadow-[inset_0_0_0_1px_var(--color-border)] [&_svg]:size-4"
      >
        <ScheduleIcon name={s.name} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="flex min-w-0 items-center gap-1.5 font-medium text-[13px]">
            <i aria-hidden className={cn("size-2 shrink-0 rounded-[2px]", !s.enabled && "border border-muted-foreground border-dashed")} style={s.enabled ? { backgroundColor: color } : undefined} />
            <span className="truncate">{s.name}</span>
          </span>
          <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
            {timeRange(s)}
            {s.enabled ? "" : " · off"}
          </span>
        </div>
        <div className="flex gap-0.5" role="img" aria-label={`Repeats on ${s.days.map((d) => d.charAt(0) + d.slice(1).toLowerCase()).join(", ") || "no days"}`}>
          {dayChips(s.days).map((c) => (
            <span
              key={c.day}
              aria-hidden
              className={cn(
                "grid size-5 place-items-center rounded-[5px] font-semibold text-3xs",
                c.on ? "bg-foreground/80 text-background" : "bg-muted text-muted-foreground/70",
              )}
            >
              {c.letter}
            </span>
          ))}
        </div>
      </div>
      <span title="Coming soon">
        <button
          type="button"
          role="switch"
          aria-checked={s.enabled}
          aria-label={`${s.name} ${s.enabled ? "on" : "off"}`}
          disabled
          className={cn("relative h-4 w-7 rounded-full transition-colors disabled:cursor-not-allowed", s.enabled ? "bg-foreground/70" : "bg-muted shadow-[inset_0_0_0_1px_var(--color-border)]")}
        >
          <span className={cn("absolute top-0.5 size-3 rounded-full bg-background shadow-xs", s.enabled ? "left-3.5" : "left-0.5")} />
        </button>
      </span>
    </div>
  );
}

function Swatch({ label, style, dashed }: { label: ReactNode; style?: CSSProperties; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <i className={cn("size-2 rounded-[2px]", dashed && "border border-muted-foreground border-dashed")} style={style} />
      {label}
      {dashed ? " (off)" : ""}
    </span>
  );
}
