/**
 * The schedule sheet on profile detail (docs/ux/pages/profile-detail.md,
 * Layout 4; mockup 08 "Edit schedule"): Schedule on, name, start and end
 * (end says "next day" when it wraps past midnight), Repeats on with day
 * toggles and presets, and an Each day preview with the hours paused. Save
 * runs `profile.schedule.add` or `profile.schedule.update`; Delete schedule
 * asks inline, then runs `profile.schedule.remove` with an Undo that adds it
 * back. Validation is the command's (bad_params lands under the field).
 */
import { CalendarPlus, Trash2 } from "lucide-react";
import { useState } from "react";

import { fieldErrors, useWrite } from "~/app/useWrite";
import { Button } from "~/components/ui/button";
import { InlineConfirm } from "~/components/ui/confirm";
import { Input } from "~/components/ui/input";
import { Sheet, SheetField } from "~/components/ui/sheet";
import { formatMinute, MINUTES_PER_DAY } from "~/components/ui/timeline";
import { cn } from "~/lib/utils";
import type { Day, Profile, Schedule, ScheduleInput } from "../../../../core/model";

import { minutesOf, spanMinutes } from "./helpers";
import { ScheduleIcon, Toggle } from "./ProfileSchedules";

export type ScheduleSheetMode = { kind: "add" } | { kind: "edit"; schedule: Schedule };

/** Sunday first, as the eero app and the row chips. */
const SUN_FIRST: ReadonlyArray<Day> = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

export const PRESETS: ReadonlyArray<{ label: string; days: ReadonlyArray<Day> }> = [
  { label: "School nights", days: ["SUN", "MON", "TUE", "WED", "THU"] },
  { label: "Weekdays", days: ["MON", "TUE", "WED", "THU", "FRI"] },
  { label: "Weekends", days: ["SAT", "SUN"] },
  { label: "Every day", days: SUN_FIRST },
];

/** A new schedule starts as Bedtime-like: 9:00 PM to 7:00 AM on school nights. */
export const NEW_SCHEDULE: ScheduleInput = { name: "New schedule", days: ["SUN", "MON", "TUE", "WED", "THU"], start: "21:00", end: "07:00", enabled: true };

const sameDays = (a: ReadonlyArray<Day>, b: ReadonlyArray<Day>) => a.length === b.length && a.every((d) => b.includes(d));

/** "10h paused · 50h a week" (minutes rounded to a tenth of an hour). */
export function pausedLine(input: Pick<ScheduleInput, "start" | "end" | "days">): string {
  const hours = (m: number) => `${Math.round((m / 60) * 10) / 10}h`;
  const day = input.start === input.end ? 0 : spanMinutes(input);
  return `${hours(day)} paused · ${hours(day * new Set(input.days).size)} a week`;
}

/** The paused spans within one day for the preview bar: one, or two when it wraps past midnight. */
export function daySpans(start: string, end: string): { from: number; to: number }[] {
  const s = minutesOf(start);
  const e = minutesOf(end);
  if (s === e) return [];
  if (e > s) return [{ from: s, to: e }];
  return [
    ...(e > 0 ? [{ from: 0, to: e }] : []),
    { from: s, to: MINUTES_PER_DAY },
  ];
}

type Props = { profile: Profile; mode: ScheduleSheetMode | null; onClose: () => void };

export function ScheduleSheet({ profile, mode, onClose }: Props) {
  return mode ? <SheetBody key={mode.kind === "add" ? "add" : mode.schedule.id} profile={profile} mode={mode} onClose={onClose} /> : null;
}

function SheetBody({ profile: p, mode, onClose }: { profile: Profile; mode: ScheduleSheetMode; onClose: () => void }) {
  const initial: ScheduleInput = mode.kind === "edit" ? mode.schedule : NEW_SCHEDULE;
  const [enabled, setEnabled] = useState(initial.enabled);
  const [name, setName] = useState(initial.name);
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [days, setDays] = useState<ReadonlyArray<Day>>(initial.days);
  const [deleting, setDeleting] = useState(false);

  const add = useWrite<Record<string, unknown>, Schedule>("profile.schedule.add", { form: true });
  const update = useWrite<Record<string, unknown>, Schedule>("profile.schedule.update", { form: true });
  const remove = useWrite<Record<string, unknown>, { removed: string; schedule: Schedule }>("profile.schedule.remove");
  const active = mode.kind === "add" ? add : update;
  const errors = fieldErrors(active.error);

  const trimmed = name.trim();
  const input: ScheduleInput = { name: trimmed, days: SUN_FIRST.filter((d) => days.includes(d)), start, end, enabled };
  const changed = trimmed !== initial.name || start !== initial.start || end !== initial.end || enabled !== initial.enabled || !sameDays(days, initial.days);
  // A new schedule is ready to save as it opens.
  const dirty = mode.kind === "add" || changed;
  const sameTimes = start !== "" && start === end;
  const valid = trimmed.length > 0 && trimmed.length <= 32 && days.length > 0 && start !== "" && end !== "" && !sameTimes;
  const wraps = end !== "" && start !== "" && minutesOf(end) < minutesOf(start);
  const devices = p.deviceIds.length;
  const back = (s: ScheduleInput) => ({ profile: p.id, name: s.name, days: [...s.days], start: s.start, end: s.end, enabled: s.enabled });

  const save = () =>
    mode.kind === "add"
      ? add.run(
          { profile: p.id, ...input },
          {
            success: (r) => `Added ${r.name} to ${p.name}`,
            undo: (r) => ({ id: "profile.schedule.remove", params: { profile: p.id, schedule: r.id } }),
          },
        )
      : update.run(
          { ...back(input), schedule: mode.schedule.id },
          {
            success: `Saved ${trimmed}`,
            undo: { id: "profile.schedule.update", params: { ...back(mode.schedule), schedule: mode.schedule.id } },
          },
        );

  const del = async () => {
    if (mode.kind !== "edit") return;
    const s = mode.schedule;
    const res = await remove.run(
      { profile: p.id, schedule: s.id },
      {
        success: `Deleted ${s.name}`,
        failure: `Couldn't delete ${s.name}`,
        undo: (r) => ({ id: "profile.schedule.add", params: back(r.schedule), success: `Added ${r.schedule.name} back` }),
      },
    );
    if (res?.ok) onClose();
  };

  const toggleDay = (d: Day) => setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  const startAt = formatMinute(minutesOf(mode.kind === "edit" ? mode.schedule.start : start));

  return (
    <Sheet
      open
      onClose={onClose}
      icon={mode.kind === "add" ? <CalendarPlus /> : <ScheduleIcon name={trimmed || initial.name} />}
      title={mode.kind === "add" ? "Add a scheduled pause" : "Edit schedule"}
      subtitle={`${p.name} · pauses ${devices === 1 ? "its device" : `all ${devices} devices`} automatically`}
      dirty={dirty}
      valid={valid}
      onSave={save}
      saveLabel={mode.kind === "add" ? "Add schedule" : "Save"}
      error={errors._form}
      footerStart={
        mode.kind === "edit" && !deleting ? (
          <Button type="button" size="sm" variant="ghost" className="text-destructive-foreground" onClick={() => setDeleting(true)}>
            <Trash2 />
            Delete schedule
          </Button>
        ) : null
      }
    >
      {deleting && mode.kind === "edit" ? (
        <InlineConfirm
          title={`Delete ${mode.schedule.name}?`}
          confirmLabel="Delete schedule"
          onConfirm={() => void del()}
          onCancel={() => setDeleting(false)}
          running={remove.running}
        >
          {p.name}'s devices stop pausing at {startAt}. Undo adds it back.
        </InlineConfirm>
      ) : null}

      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="font-medium text-sm" id="schedule-sheet-on">
            Schedule on
          </div>
          <div className="text-muted-foreground text-xs">Turn off to keep it without pausing</div>
        </div>
        <Toggle checked={enabled} onChange={setEnabled} labelledBy="schedule-sheet-on" />
      </div>

      <SheetField label="Schedule name" htmlFor="schedule-sheet-name" error={trimmed.length > 32 ? "Use 32 characters or fewer." : errors.name} helper={`${trimmed.length} / 32`}>
        <Input id="schedule-sheet-name" value={name} autoFocus={mode.kind === "add"} placeholder="Bedtime" onChange={(e) => setName(e.target.value)} />
      </SheetField>

      <div className="grid grid-cols-2 gap-3.5">
        <SheetField label="Start time" htmlFor="schedule-sheet-start" error={errors.start}>
          <Input id="schedule-sheet-start" type="time" step={60} required value={start} onChange={(e) => setStart(e.target.value)} />
        </SheetField>
        <SheetField
          label={
            <span className="flex items-baseline justify-between">
              End time
              {wraps ? <span className="font-normal text-2xs text-muted-foreground">next day</span> : null}
            </span>
          }
          htmlFor="schedule-sheet-end"
          error={sameTimes ? "End must differ from start." : errors.end}
        >
          <Input id="schedule-sheet-end" type="time" step={60} required value={end} aria-invalid={sameTimes || undefined} onChange={(e) => setEnd(e.target.value)} />
        </SheetField>
      </div>

      <SheetField label="Repeats on" error={errors.days ?? (days.length === 0 ? "Pick at least one day." : undefined)}>
        <div className="flex gap-1" role="group" aria-label="Repeats on">
          {SUN_FIRST.map((d) => {
            const on = days.includes(d);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                onClick={() => toggleDay(d)}
                className={cn(
                  "h-7 flex-1 rounded-[var(--control-radius)] font-medium text-xs transition-colors",
                  on ? "bg-foreground/80 text-background" : "bg-muted text-muted-foreground hover:text-foreground",
                )}
              >
                {d.charAt(0) + d.slice(1).toLowerCase()}
              </button>
            );
          })}
        </div>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {PRESETS.map((preset) => {
            const on = sameDays(days, preset.days);
            return (
              <button
                key={preset.label}
                type="button"
                aria-pressed={on}
                onClick={() => setDays(preset.days)}
                className={cn(
                  "h-6 rounded-full border px-2.5 text-2xs transition-colors",
                  on ? "border-foreground/40 bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </SheetField>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between font-medium text-xs">
          <span>Each day</span>
          <span className="font-normal text-muted-foreground tabular-nums">{valid || sameTimes ? pausedLine(input) : "-"}</span>
        </div>
        <div
          role="img"
          aria-label={sameTimes || !start || !end ? "No pause" : `Paused ${formatMinute(minutesOf(start))} to ${formatMinute(minutesOf(end))}${wraps ? " the next day" : ""}`}
          className={cn("relative h-5 overflow-hidden rounded-md border bg-muted/40", !enabled && "opacity-60")}
        >
          {daySpans(start, end).map((s) => (
            <i
              key={s.from}
              className={cn("absolute inset-y-0", enabled ? "bg-foreground/60" : "border-[1.5px] border-muted-foreground/70 border-dashed")}
              style={{ left: `${(s.from / MINUTES_PER_DAY) * 100}%`, width: `${((s.to - s.from) / MINUTES_PER_DAY) * 100}%` }}
            />
          ))}
        </div>
        <div className="flex justify-between text-3xs text-muted-foreground uppercase tracking-wide" aria-hidden>
          {["12 AM", "6 AM", "12 PM", "6 PM", "12 AM"].map((t, i) => (
            <span key={i}>{t}</span>
          ))}
        </div>
      </div>
    </Sheet>
  );
}
