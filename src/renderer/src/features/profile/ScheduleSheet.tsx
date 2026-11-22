/**
 * The schedule sheet on profile detail (docs/ux/pages/profile-detail.md,
 * Layout 6; mockup 08 "Edit schedule"): Schedule on, name, start and end
 * (end says "next day" when it wraps past midnight), Repeats on with day
 * toggles and presets, and an Each day preview with the hours paused. Save
 * runs `profile.schedule.add` or `profile.schedule.update`; Delete schedule
 * asks inline, then runs `profile.schedule.remove` with an Undo that adds it
 * back. Validation is the command's (bad_params lands under the field).
 *
 * Follows the sheet rules (design-system.md, Components: Sheet): a clean
 * panel with no divider lines, the standard 36x20 switch, neutral day
 * buttons (a picked day gets a stronger outline, not a colour) and the
 * presets as plain text links, not pills.
 */
import { Trash2 } from "lucide-react";
import { useState } from "react";

import { fieldErrors, useWrite } from "~/app/useWrite";
import { Button } from "~/components/ui/button";
import { WriteConfirmDialog } from "~/components/ui/confirm";
import { Input } from "~/components/ui/input";
import { Sheet, SheetField } from "~/components/ui/sheet";
import { DayBar, DayPicker, sameDays, TimeSelect } from "~/components/ui/schedule-fields";
import { formatMinute } from "~/components/ui/timeline";
import { WriteSwitch } from "~/features/advanced/SettingsGroups";
import type { Day, Profile, Schedule, ScheduleInput } from "../../../../core/model";

import { minutesOf, spanMinutes } from "./helpers";

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


/** "10h paused, 50h a week" (minutes rounded to a tenth of an hour). */
export function pausedLine(input: Pick<ScheduleInput, "start" | "end" | "days">): string {
  const hours = (m: number) => `${Math.round((m / 60) * 10) / 10}h`;
  const day = input.start === input.end ? 0 : spanMinutes(input);
  return `${hours(day)} paused, ${hours(day * new Set(input.days).size)} a week`;
}

/** The sheet's switch is form state, not a write: always usable. */
const FORM_GATE = { allowed: true, reason: null };

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

  // Core asks (over the sheet) when the schedule covers right now and would pause online devices straight away.
  const startsNow = { title: "Pause devices now?", confirmLabel: "Save and pause now" };
  const add = useWrite<Record<string, unknown>, Schedule>("profile.schedule.add", { form: true, confirmIn: "nested", confirm: startsNow });
  const update = useWrite<Record<string, unknown>, Schedule>("profile.schedule.update", { form: true, confirmIn: "nested", confirm: startsNow });
  const remove = useWrite<Record<string, unknown>, { removed: string; schedule: Schedule }>("profile.schedule.remove", { confirmIn: "nested" });
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
        askFirst: true,
        confirm: { title: `Delete ${s.name}?`, message: `${p.name}'s devices stop pausing at ${startAt}. Undo adds it back.`, confirmLabel: "Delete schedule" },
        success: `Deleted ${s.name}`,
        failure: `Couldn't delete ${s.name}`,
        undo: (r) => ({ id: "profile.schedule.add", params: back(r.schedule), success: `Added ${r.schedule.name} back` }),
      },
    );
    if (res?.ok) onClose();
  };

  const startAt = formatMinute(minutesOf(mode.kind === "edit" ? mode.schedule.start : start));

  return (
    <Sheet
      open
      onClose={onClose}
      title={mode.kind === "add" ? "Add a scheduled pause" : "Edit schedule"}
      subtitle={`${p.name}, pauses ${devices === 1 ? "its device" : `all ${devices} devices`} automatically`}
      dirty={dirty}
      valid={valid}
      onSave={save}
      saveLabel={mode.kind === "add" ? "Add schedule" : "Save schedule"}
      error={errors._form}
      footerStart={
        mode.kind === "edit" ? (
          <Button type="button" size="sm" variant="ghost" className="text-destructive-foreground" disabled={remove.running} onClick={() => void del()}>
            <Trash2 />
            Delete schedule{"\u2026"}
          </Button>
        ) : null
      }
    >
      <WriteConfirmDialog write={add} />
      <WriteConfirmDialog write={update} />
      <WriteConfirmDialog write={remove} />

      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="font-medium text-sm" id="schedule-sheet-on">
            Schedule on
          </div>
          <div className="text-muted-foreground text-xs">Turn off to keep it without pausing</div>
        </div>
        <WriteSwitch on={enabled} label="Schedule on" gate={FORM_GATE} onToggle={setEnabled} />
      </div>

      <SheetField label="Schedule name" htmlFor="schedule-sheet-name" error={trimmed.length > 32 ? "Use 32 characters or fewer." : errors.name} helper={`${trimmed.length} / 32`}>
        <Input id="schedule-sheet-name" value={name} autoFocus={mode.kind === "add"} placeholder="Bedtime" onChange={(e) => setName(e.target.value)} />
      </SheetField>

      <div className="grid grid-cols-2 gap-3.5">
        <SheetField label="Start time" htmlFor="schedule-sheet-start" error={errors.start}>
          <TimeSelect id="schedule-sheet-start" value={start} onChange={setStart} />
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
          <TimeSelect id="schedule-sheet-end" value={end} onChange={setEnd} invalid={sameTimes} />
        </SheetField>
      </div>

      <SheetField label="Repeats on" error={errors.days ?? (days.length === 0 ? "Pick at least one day." : undefined)}>
        <DayPicker order={SUN_FIRST} days={days} onChange={setDays} presets={PRESETS} />
      </SheetField>

      <DayBar
        start={start}
        end={end}
        enabled={enabled}
        aside={valid || sameTimes ? pausedLine(input) : "-"}
        ariaLabel={sameTimes || !start || !end ? "No pause" : `Paused ${formatMinute(minutesOf(start))} to ${formatMinute(minutesOf(end))}${wraps ? " the next day" : ""}`}
      />
    </Sheet>
  );
}
