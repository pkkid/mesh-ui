// The fields every schedule sheet shares (a profile's scheduled pause, a power
// saving schedule): the days it repeats on, start and end times, and the bar
// that previews one day. One look for both (design-system.md#sheet).
import type { ReactNode } from "react";

import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "~/components/ui/select";
import { formatMinute, MINUTES_PER_DAY } from "~/components/ui/timeline";
import { cn } from "~/lib/utils";
import type { Day } from "../../../../core/model";

/** "16:00" to 960 minutes after midnight. */
export function hhmmMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** The spans within one day for the preview bar: one, or two when it wraps past midnight. */
export function daySpans(start: string, end: string): { from: number; to: number }[] {
  if (start === "" || end === "") return [];
  const s = hhmmMinutes(start);
  const e = hhmmMinutes(end);
  if (s === e) return [];
  if (e > s) return [{ from: s, to: e }];
  return [...(e > 0 ? [{ from: 0, to: e }] : []), { from: s, to: MINUTES_PER_DAY }];
}

const sameDays = (a: ReadonlyArray<Day>, b: ReadonlyArray<Day>) => a.length === b.length && a.every((d) => b.includes(d));

/**
 * The days a schedule repeats on: one connected control like Segmented (a
 * muted track, picked days raised on the card colour), but any number can be
 * picked. Under it, presets as plain text links; the one that matches reads in
 * the foreground colour.
 */
export function DayPicker({
  order,
  days,
  onChange,
  presets = [],
}: {
  order: ReadonlyArray<Day>;
  days: ReadonlyArray<Day>;
  onChange: (days: ReadonlyArray<Day>) => void;
  presets?: ReadonlyArray<{ label: string; days: ReadonlyArray<Day> }>;
}) {
  const toggle = (d: Day) => onChange(days.includes(d) ? days.filter((x) => x !== d) : [...days, d]);
  return (
    <div className="flex flex-col gap-1.5">
      <div role="group" aria-label="Repeats on" className="flex rounded-[9px] border bg-muted p-0.5">
        {order.map((d) => {
          const on = days.includes(d);
          return (
            <button
              key={d}
              type="button"
              aria-pressed={on}
              data-selected={on || undefined}
              onClick={() => toggle(d)}
              className={cn(
                "h-7 flex-1 cursor-pointer rounded-[7px] text-muted-foreground text-xs outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                "data-selected:bg-card data-selected:font-medium data-selected:text-foreground data-selected:shadow-[0_1px_2px_rgb(0_0_0/25%),inset_0_0_0_1px_var(--color-border)]",
              )}
            >
              {d.charAt(0) + d.slice(1).toLowerCase()}
            </button>
          );
        })}
      </div>
      {presets.length > 0 && (
        <div className="flex flex-wrap gap-x-3.5 gap-y-1">
          {presets.map((preset) => {
            const on = sameDays(days, preset.days);
            return (
              <button
                key={preset.label}
                type="button"
                aria-pressed={on}
                onClick={() => onChange(preset.days)}
                className={cn(
                  "cursor-pointer rounded-sm text-xs underline-offset-2 outline-none transition-colors hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring",
                  on ? "font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const STEP = 15;

/** A time of day as the app's dropdown, in 15 minute steps ("9:00 PM"), plus the current value when it is off the grid. */
export function TimeSelect({ id, value, onChange, invalid }: { id: string; value: string; onChange: (hhmm: string) => void; invalid?: boolean }) {
  const grid = Array.from({ length: MINUTES_PER_DAY / STEP }, (_, i) => i * STEP);
  const current = value === "" ? null : hhmmMinutes(value);
  const all = current === null || grid.includes(current) ? grid : [...grid, current].sort((a, b) => a - b);
  const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const items = all.map((m) => ({ value: hhmm(m), label: formatMinute(m) }));
  return (
    <Select items={items} value={current === null ? null : hhmm(current)} onValueChange={(v) => v !== null && onChange(v)}>
      <SelectTrigger id={id} className="w-full min-w-0 tabular-nums" aria-invalid={invalid || undefined}>
        <SelectValue placeholder="Pick a time" />
      </SelectTrigger>
      <SelectPopup align="start" className="max-h-72 text-sm tabular-nums">
        {items.map((t) => (
          <SelectItem key={t.value} value={t.value}>
            {t.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

/**
 * One day as a bar, midnight to midnight, with the schedule's span filled in
 * the neutral schedule colour (dashed outline while the schedule is off), and
 * start, middle and end labels under it. `aside` sits at the right of the
 * "Each day" label ("10h paused, 50h a week").
 */
export function DayBar({ start, end, enabled, ariaLabel, aside }: { start: string; end: string; enabled: boolean; ariaLabel: string; aside?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between font-medium text-xs">
        <span>Each day</span>
        {aside != null && <span className="font-normal text-muted-foreground tabular-nums">{aside}</span>}
      </div>
      <div role="img" aria-label={ariaLabel} className={cn("relative h-5 overflow-hidden rounded-md bg-muted", !enabled && "opacity-60")}>
        {daySpans(start, end).map((s) => (
          <i
            key={s.from}
            className={cn("absolute inset-y-0", enabled ? "bg-muted-foreground/45" : "border-[1.5px] border-muted-foreground/70 border-dashed")}
            style={{ left: `${(s.from / MINUTES_PER_DAY) * 100}%`, width: `${((s.to - s.from) / MINUTES_PER_DAY) * 100}%` }}
          />
        ))}
      </div>
      <div className="flex justify-between text-3xs text-muted-foreground tabular-nums" aria-hidden>
        {["12 AM", "6 AM", "12 PM", "6 PM", "12 AM"].map((t, i) => (
          <span key={i}>{t}</span>
        ))}
      </div>
    </div>
  );
}

export { sameDays };
