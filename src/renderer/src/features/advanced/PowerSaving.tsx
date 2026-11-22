/**
 * Eco efficiency: the power saving switches and their schedules on the shared
 * week timeline (components/ui/timeline.tsx), with one line per schedule.
 * M5.3: both switches run `settings.power_saving.set` (with Undo); Add
 * schedule and each schedule's Edit open the schedule sheet
 * (`settings.power_schedule.add` / `.update`), whose Delete asks inline and
 * runs `.remove` with an Undo that adds it back. An end before the start
 * wraps past midnight ("next day"). Validation is core's (bad_params lands
 * under the field). docs/ux/pages/advanced-networking.md (Network services),
 * mockup 13. On a gateway eero reports as not `power_saving` capable the
 * whole section dims with the hardware reason (M5.R-fix9), as the eero app
 * hides it there: both switches, Add schedule and Edit are off, existing
 * schedules stay listed read-only, and each keeps a Delete (core refuses
 * every other power saving change on that hardware).
 */
import { CalendarPlus, Leaf, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";

import { fieldErrors, NOT_AVAILABLE, useWrite } from "~/app/useWrite";
import { Button } from "~/components/ui/button";
import { WriteConfirmDialog } from "~/components/ui/confirm";
import { Input } from "~/components/ui/input";
import { GatedButton, useGate, useNow } from "~/components/ui/page";
import type { Gate } from "~/app/useWrite";
import { Sheet, SheetField } from "~/components/ui/sheet";
import { formatMinute, WeekTimeline, type WeekSchedule } from "~/components/ui/timeline";
import { seriesColors } from "~/lib/chartColors";
import { cn } from "~/lib/utils";
import { DayBar, DayPicker, TimeSelect } from "~/components/ui/schedule-fields";
import { networkClock } from "../../../../core/format";
import type { Day, NetworkSettings, Schedule, ScheduleInput } from "../../../../core/model";

import { OFFLINE, Row, SubPanel, useOffline, useSettingsWrite, WriteSwitch } from "./SettingsGroups";

/** Why the Eco efficiency section is dimmed on hardware without power saving (core's ECO_NOT_CAPABLE, as UI copy). */
export const NO_POWER_SAVING = "Your eero hardware does not support power saving";

const DAY_INDEX: Record<Day, number> = { MON: 0, TUE: 1, WED: 2, THU: 3, FRI: 4, SAT: 5, SUN: 6 };
const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MON_FIRST: ReadonlyArray<Day> = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

/** Shortcuts under the day picker, as the profile schedule sheet's. */
const POWER_PRESETS: ReadonlyArray<{ label: string; days: ReadonlyArray<Day> }> = [
  { label: "Weekdays", days: ["MON", "TUE", "WED", "THU", "FRI"] },
  { label: "Weekends", days: ["SAT", "SUN"] },
  { label: "Every day", days: MON_FIRST },
];

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** "Every day", "Mon to Fri", "Sat, Sun". */
export function daysLabel(days: ReadonlyArray<Day>): string {
  const idx = [...new Set(days.map((d) => DAY_INDEX[d]))].sort((a, b) => a - b);
  if (idx.length === 7) return "Every day";
  if (idx.length === 0) return "No days";
  const run = idx.every((d, i) => i === 0 || d === (idx[i - 1] ?? 0) + 1);
  if (run && idx.length >= 3) return `${DAY_SHORT[idx[0] ?? 0]} to ${DAY_SHORT[idx[idx.length - 1] ?? 0]}`;
  return idx.map((d) => DAY_SHORT[d]).join(", ");
}

const toWeek = (s: Schedule): WeekSchedule => ({
  id: s.id,
  label: s.name,
  color: seriesColors.powerSaving,
  icon: <Leaf />,
  days: s.days.map((d) => DAY_INDEX[d]),
  start: minutes(s.start),
  end: minutes(s.end),
  enabled: s.enabled,
});

type SheetMode = { kind: "add" } | { kind: "edit"; schedule: Schedule };
type PowerParams = { enabled?: boolean; scheduleEnabled?: boolean };

export function PowerSaving({ settings, timezone, loading }: { settings: NetworkSettings | undefined; timezone: string | null; loading: boolean }) {
  const now = useNow(60_000);
  const offline = useOffline();
  const ps = settings?.powerSaving;
  const schedules = ps?.schedules ?? [];
  const clock = networkClock(timezone);
  const parts = clock.parts(now);
  const minute = parts.hour * 60 + Number(new Intl.DateTimeFormat("en-US", { timeZone: timezone ?? "UTC", minute: "numeric" }).format(now));
  // eero reports power_saving not capable on a gateway without it and refuses `enable` (403); the eero app
  // hides the section there. Dim all of it and say why; only Delete stays, to clean up old schedules.
  const ecoCapable = useGate({ area: "settings", capability: "power_saving" });
  const incapable = ecoCapable.reason === NOT_AVAILABLE;
  const hardware: Gate = { allowed: false, reason: NO_POWER_SAVING };
  const ecoWrite = useSettingsWrite<PowerParams>("settings.power_saving.set", "Eco efficiency", offline);
  const schedWrite = useSettingsWrite<PowerParams>("settings.power_saving.set", "the power saving schedule", offline);
  const eco = incapable ? { ...ecoWrite, gate: hardware } : ecoWrite;
  const sched = incapable ? { ...schedWrite, gate: hardware } : schedWrite;
  const unsupported = settings !== undefined && ps?.enabled === null && ps.scheduleEnabled === null;
  const baseGate = useGate("settings.power_schedule.add");
  const addGate = incapable ? hardware : baseGate.allowed && offline ? { allowed: false, reason: OFFLINE } : baseGate;
  const baseRemove = useGate("settings.power_schedule.remove");
  const removeGate = baseRemove.allowed && offline ? { allowed: false, reason: OFFLINE } : baseRemove;
  const [sheet, setSheet] = useState<SheetMode | null>(null);
  const remove = useWrite<Record<string, unknown>, { removed: string; schedule: Schedule }>("settings.power_schedule.remove");
  // No Undo here: adding a schedule back is refused on this hardware, so the confirm reads as destructive (red).
  const del = (s: Schedule) =>
    remove.run(
      { schedule: s.id },
      {
        askFirst: true,
        confirm: { title: `Delete ${s.name}?`, message: "It cannot be added back on this hardware.", confirmLabel: "Delete schedule", irreversible: true },
        success: `Deleted ${s.name}`,
        failure: `Couldn't delete ${s.name}`,
      },
    );

  const flip = (w: typeof eco, key: keyof PowerParams, what: string) => (on: boolean) =>
    void w.write.run(
      { [key]: on },
      { success: `${what} turned ${on ? "on" : "off"}`, undo: { id: "settings.power_saving.set", params: { [key]: !on }, success: `${what} turned ${on ? "off" : "on"}` } },
    );

  // Not on this hardware (eero reports power saving not capable) or not reported at all: both rows are left out,
  // as eero's app hides the section. Schedules left from older hardware can still be removed from the CLI.
  if (unsupported || incapable) return null;

  return (
    <>
      <Row
        title="Eco efficiency" when="powerSaving"
        description={incapable ? NO_POWER_SAVING : "Use less power when nobody needs full speed"}
        dim={unsupported || incapable}
        control={<WriteSwitch on={ps?.enabled} label="Eco efficiency" gate={eco.gate} busy={eco.write.running} onToggle={flip(eco, "enabled", "Eco efficiency")} />}
      />
      <Row
        title="Power saving schedule" when="powerSaving"
        description={incapable ? "Schedules do nothing on this hardware. You can still delete them." : "Radios drop to 1x1 and LEDs turn green. Wi-Fi blips for up to 5 seconds when it starts."}
        dim={unsupported || incapable}
        control={<WriteSwitch on={ps?.scheduleEnabled} label="Power saving schedule" gate={sched.gate} busy={sched.write.running} onToggle={flip(sched, "scheduleEnabled", "The power saving schedule")} />}
      >
        {!unsupported && (
          <SubPanel className="flex flex-col gap-3">
            {schedules.length === 0 ? (
              <span className="text-muted-foreground text-xs">{settings ? "No power saving schedules yet." : " "}</span>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {schedules.map((s) => (
                  <li key={s.id} className="flex items-center gap-2 text-xs">
                    <span className="size-2 shrink-0 rounded-sm" style={{ backgroundColor: seriesColors.powerSaving }} aria-hidden />
                    <span className="font-medium">{s.name}</span>
                    <span className="min-w-0 truncate text-muted-foreground">
                      {daysLabel(s.days)} · {formatMinute(minutes(s.start))} to {formatMinute(minutes(s.end))}
                      {minutes(s.end) < minutes(s.start) ? " next day" : ""}
                      {s.enabled ? "" : " · off"}
                    </span>
                    <span className="ms-auto">
                      {incapable ? (
                        <GatedButton size="icon-xs" variant="ghost-muted" gate={removeGate} aria-label={`Delete ${s.name}`} disabled={remove.running} onClick={() => void del(s)}>
                          <Trash2 />
                        </GatedButton>
                      ) : (
                        <GatedButton size="icon-xs" variant="ghost-muted" gate={addGate} aria-label={`Edit ${s.name}`} onClick={() => setSheet({ kind: "edit", schedule: s })}>
                          <Pencil />
                        </GatedButton>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className={cn(incapable && "opacity-50")}>
              <WeekTimeline
                schedules={schedules.map(toWeek)}
                today={settings ? parts.weekday : null}
                now={settings ? minute : null}
                loading={loading}
                ariaLabel={`Power saving schedules across the week: ${schedules.length === 0 ? "none" : schedules.map((s) => `${s.name}, ${daysLabel(s.days)}, ${s.start} to ${s.end}${s.enabled ? "" : ", off"}`).join("; ")}`}
              />
            </div>
            <div>
              <GatedButton size="xs" variant="outline" gate={addGate} disabled={!settings} onClick={() => setSheet({ kind: "add" })}>
                <CalendarPlus />
                Add schedule
              </GatedButton>
            </div>
          </SubPanel>
        )}
      </Row>
      {sheet && <PowerScheduleSheet key={sheet.kind === "add" ? "add" : sheet.schedule.id} mode={sheet} onClose={() => setSheet(null)} />}
    </>
  );
}

/** A new power saving schedule starts overnight, every day. */
export const NEW_POWER_SCHEDULE: ScheduleInput = { name: "Overnight", days: [...MON_FIRST], start: "23:00", end: "06:00", enabled: true };

const sameDays = (a: ReadonlyArray<Day>, b: ReadonlyArray<Day>) => a.length === b.length && a.every((d) => b.includes(d));

function PowerScheduleSheet({ mode, onClose }: { mode: SheetMode; onClose: () => void }) {
  const initial: ScheduleInput = mode.kind === "edit" ? mode.schedule : NEW_POWER_SCHEDULE;
  const [enabled, setEnabled] = useState(initial.enabled);
  const [name, setName] = useState(initial.name);
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [days, setDays] = useState<ReadonlyArray<Day>>(initial.days);

  const add = useWrite<Record<string, unknown>, Schedule>("settings.power_schedule.add", { form: true });
  const update = useWrite<Record<string, unknown>, Schedule>("settings.power_schedule.update", { form: true });
  const remove = useWrite<Record<string, unknown>, { removed: string; schedule: Schedule }>("settings.power_schedule.remove", { confirmIn: "nested" });
  const errors = fieldErrors((mode.kind === "add" ? add : update).error);

  const trimmed = name.trim();
  const input: ScheduleInput = { name: trimmed, days: MON_FIRST.filter((d) => days.includes(d)), start, end, enabled };
  const changed = trimmed !== initial.name || start !== initial.start || end !== initial.end || enabled !== initial.enabled || !sameDays(days, initial.days);
  const sameTimes = start !== "" && start === end;
  const valid = trimmed.length > 0 && trimmed.length <= 32 && days.length > 0 && start !== "" && end !== "" && !sameTimes;
  const wraps = start !== "" && end !== "" && minutes(end) < minutes(start);
  const plain = (s: ScheduleInput) => ({ name: s.name, days: [...s.days], start: s.start, end: s.end, enabled: s.enabled });

  const save = () =>
    mode.kind === "add"
      ? add.run(input, { success: (r) => `Added ${r.name}`, undo: (r) => ({ id: "settings.power_schedule.remove", params: { schedule: r.id } }) })
      : update.run({ ...plain(input), schedule: mode.schedule.id }, { success: `Saved ${trimmed}`, undo: { id: "settings.power_schedule.update", params: { ...plain(mode.schedule), schedule: mode.schedule.id } } });

  const del = async () => {
    if (mode.kind !== "edit") return;
    const s = mode.schedule;
    const res = await remove.run(
      { schedule: s.id },
      {
        askFirst: true,
        confirm: { title: `Delete ${s.name}?`, message: `The eeros stop saving power at ${formatMinute(minutes(s.start))}. Undo adds it back.`, confirmLabel: "Delete schedule" },
        success: `Deleted ${s.name}`,
        failure: `Couldn't delete ${s.name}`,
        undo: (r) => ({ id: "settings.power_schedule.add", params: plain(r.schedule), success: `Added ${r.schedule.name} back` }),
      },
    );
    if (res?.ok) onClose();
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={mode.kind === "add" ? "Add power saving schedule" : "Edit power saving schedule"}
      subtitle="Every eero · radios drop to 1x1 while it runs"
      dirty={mode.kind === "add" || changed}
      valid={valid}
      onSave={save}
      saveLabel={mode.kind === "add" ? "Add schedule" : "Save schedule"}
      error={errors._form}
      footerStart={
        mode.kind === "edit" ? (
          <Button type="button" size="sm" variant="ghost" className="text-destructive-foreground" disabled={remove.running} onClick={() => void del()}>
            <Trash2 />
            Delete schedule
          </Button>
        ) : null
      }
    >
      <WriteConfirmDialog write={remove} />

      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="font-medium text-sm">Schedule on</div>
          <div className="text-muted-foreground text-xs">Turn off to keep it without running it</div>
        </div>
        <WriteSwitch on={enabled} label="Schedule on" gate={{ allowed: true, reason: null }} onToggle={setEnabled} />
      </div>

      <SheetField label="Schedule name" htmlFor="power-sheet-name" error={trimmed.length > 32 ? "Use 32 characters or fewer." : errors.name} helper={`${trimmed.length} / 32`}>
        <Input id="power-sheet-name" value={name} autoFocus={mode.kind === "add"} onChange={(e) => setName(e.target.value)} />
      </SheetField>

      <div className="grid grid-cols-2 gap-3.5">
        <SheetField label="Start time" htmlFor="power-sheet-start" error={errors.start}>
          <TimeSelect id="power-sheet-start" value={start} onChange={setStart} />
        </SheetField>
        <SheetField
          label={
            <span className="flex items-baseline justify-between">
              End time
              {wraps ? <span className="font-normal text-2xs text-muted-foreground">next day</span> : null}
            </span>
          }
          htmlFor="power-sheet-end"
          error={sameTimes ? "End must differ from start." : errors.end}
        >
          <TimeSelect id="power-sheet-end" value={end} onChange={setEnd} invalid={sameTimes} />
        </SheetField>
      </div>

      <SheetField label="Repeats on" error={errors.days ?? (days.length === 0 ? "Pick at least one day." : undefined)}>
        <DayPicker order={MON_FIRST} days={days} onChange={setDays} presets={POWER_PRESETS} />
      </SheetField>

      <DayBar
        start={start}
        end={end}
        enabled={enabled}
        ariaLabel={sameTimes || !start || !end ? "No power saving" : `Power saving ${formatMinute(minutes(start))} to ${formatMinute(minutes(end))}${wraps ? " the next day" : ""}`}
      />
    </Sheet>
  );
}
