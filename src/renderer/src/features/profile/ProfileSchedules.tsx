/**
 * Profile detail "Scheduled pauses" and "Schedules" (docs/ux/pages/
 * profile-detail.md, Layout 2): the week on the shared timeline, one lane a
 * day with today and the Now line in the network time zone, and the list of
 * schedules with their times, days and on or off. Schedules come only from
 * `profile.get` (the profile's own `schedule[]`); today's manual pause comes
 * from its `today` segments and draws in the warning colour on today's lane.
 * "Add a scheduled pause", a row or its pencil open the schedule sheet
 * (ScheduleSheet.tsx); the row switch runs `profile.schedule.update
 * {enabled}` with Undo.
 */
import { BookOpen, CalendarClock, Moon, Pencil, Plus, Utensils } from "lucide-react";
import { type CSSProperties, type ReactNode, useState } from "react";

import { useWrite } from "~/app/useWrite";
import { Button } from "~/components/ui/button";
import { Card, Empty, Section } from "~/components/ui/card";
import { GatedButton, useGate, useNow } from "~/components/ui/page";
import { WeekTimeline, type WeekSchedule } from "~/components/ui/timeline";
import { PROFILE_GATE } from "~/features/profiles/ProfileCards";
import { entityColors } from "~/lib/chartColors";
import { cn } from "~/lib/utils";
import type { Profile, ProfileDetail, Schedule } from "../../../../core/model";

import { dayChips, scheduleIcon, timeRange, todayIn, weekInput, zoneName } from "./helpers";
import { ScheduleSheet, type ScheduleSheetMode } from "./ScheduleSheet";

const ICONS = { moon: Moon, book: BookOpen, utensils: Utensils, "calendar-clock": CalendarClock } as const;

export function ScheduleIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[scheduleIcon(name)];
  return <Icon aria-hidden className={className} />;
}

/** One colour per schedule, stable by schedule id. */
export const scheduleColors = (schedules: ReadonlyArray<Schedule>) => entityColors(schedules.map((s) => s.id));

/** A manual pause is a status, so it takes the warning token (as on the Profiles page lanes), not a series colour. */
const MANUAL_COLOR = "var(--color-warning)";

/** `profile.get` adds today's pauses; the list's Profile (shown while it loads) has none. */
type Props = { profile: (Profile & Partial<Pick<ProfileDetail, "today">>) | null; timezone: string | null; fading: boolean };

export function ProfileSchedules({ profile: p, timezone, fading }: Props) {
  const now = useNow(60_000);
  const gate = useGate(PROFILE_GATE);
  const [sheet, setSheet] = useState<ScheduleSheetMode | null>(null);
  const schedules = p?.schedules ?? [];
  const colors = scheduleColors(schedules);
  const today = todayIn(now, timezone);
  // Today's manual pause (from the last read, polled every minute), drawn on today's lane.
  const manual = p?.paused && p.today ? p.today.segments.filter((x) => x.kind === "manual") : [];
  const week: WeekSchedule[] = [
    ...schedules.map((s) => ({
      ...weekInput(s),
      color: colors[s.id] ?? "",
      icon: <ScheduleIcon name={s.name} />,
    })),
    ...manual.map((x) => ({ id: `manual-${x.start}`, label: "Paused", color: MANUAL_COLOR, days: [today.lane], start: x.start, end: x.end })),
  ];
  const name = p?.name ?? "this profile";
  const empty = p && schedules.length === 0;

  return (
    <div className="grid gap-7 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Section
        title="Scheduled pauses"
        subtitle={`This week · network time zone (${zoneName(timezone, now)})`}
        tools={
          schedules.length > 0 || manual.length > 0 ? (
            <div className="flex flex-wrap items-center gap-3 text-muted-foreground text-xs" aria-hidden>
              {schedules.map((s) => (
                <Swatch key={s.id} label={s.name} style={s.enabled ? { backgroundColor: colors[s.id] } : undefined} dashed={!s.enabled} />
              ))}
              {manual.length > 0 ? <Swatch label="Manual pause" style={{ backgroundColor: MANUAL_COLOR }} /> : null}
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
            ariaLabel={`Scheduled pauses for ${name} this week, Monday to Sunday${manual.length ? `, and a manual pause today` : ""}`}
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
          <GatedButton gate={gate} size="xs" variant="outline" disabled={!p} onClick={() => setSheet({ kind: "add" })}>
            <Plus />
            Add a scheduled pause
          </GatedButton>
        }
      >
        <Card className={cn("divide-y transition-opacity", fading && "opacity-40")}>
          {!p ? (
            <div className="h-[58px]" />
          ) : schedules.length === 0 ? (
            <Empty>No scheduled pauses yet.</Empty>
          ) : (
            schedules.map((s) => (
              <ScheduleRow key={s.id} profile={p} schedule={s} color={colors[s.id] ?? ""} allowed={gate.allowed} reason={gate.reason} onOpen={() => setSheet({ kind: "edit", schedule: s })} />
            ))
          )}
        </Card>
      </Section>
      {p ? <ScheduleSheet profile={p} mode={sheet} onClose={() => setSheet(null)} /> : null}
    </div>
  );
}

type RowProps = { profile: Profile; schedule: Schedule; color: string; allowed: boolean; reason: string | null; onOpen: () => void };

function ScheduleRow({ profile: p, schedule: s, color, allowed, reason, onOpen }: RowProps) {
  const toggle = useWrite("profile.schedule.update", {
    failure: `Couldn't turn ${s.name} ${s.enabled ? "off" : "on"}`,
  });
  const flip = () =>
    void toggle.run(
      { profile: p.id, schedule: s.id, enabled: !s.enabled },
      {
        success: `Turned ${s.name} ${s.enabled ? "off" : "on"}`,
        undo: { id: "profile.schedule.update", params: { profile: p.id, schedule: s.id, enabled: s.enabled }, success: `Turned ${s.name} ${s.enabled ? "on" : "off"}` },
      },
    );
  return (
    <div
      className={cn("group flex min-h-[58px] items-center gap-3 px-[18px] py-2.5", allowed && "cursor-pointer hover:bg-muted/50")}
      onClick={allowed ? onOpen : undefined}
    >
      <div className={cn("flex min-w-0 flex-1 items-center gap-3", !s.enabled && "opacity-60")}>
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
      </div>
      {/* The controls do their own thing; a click there does not open the sheet. */}
      <div className="flex shrink-0 items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
        <span title={reason ?? undefined}>
          <Toggle checked={s.enabled} onChange={flip} label={`${s.name} ${s.enabled ? "on" : "off"}`} disabled={!allowed || toggle.running} />
        </span>
        <Button size="icon-xs" variant="ghost-muted" aria-label={`Edit ${s.name}`} title={reason ?? `Edit ${s.name}`} disabled={!allowed} onClick={onOpen}>
          <Pencil />
        </Button>
      </div>
    </div>
  );
}

/** The small on or off switch of a schedule row and the sheet's "Schedule on". */
export function Toggle({
  checked,
  onChange,
  label,
  labelledBy,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  labelledBy?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-labelledby={labelledBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-4 w-7 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        checked ? "bg-foreground/70" : "bg-muted shadow-[inset_0_0_0_1px_var(--color-border)]",
      )}
    >
      <span className={cn("absolute top-0.5 size-3 rounded-full bg-background shadow-xs transition-[left]", checked ? "left-3.5" : "left-0.5")} />
    </button>
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
