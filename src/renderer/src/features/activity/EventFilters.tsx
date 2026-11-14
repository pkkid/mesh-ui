/**
 * Activity filter bar: text filter, Device, eero and Profile selects, the
 * Range select (a day inside the last 7, or all of them) and Reset. Pure view
 * state; the page passes it to `events.list` and `events.summary`, which
 * filter in core. docs/ux/pages/activity.md (Layout 2).
 */
import { Calendar, MonitorSmartphone, RotateCcw, Router, Search, Users } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { cn } from "~/lib/utils";

export type EventFilterState = {
  search: string;
  device: string | null;
  eero: string | null;
  profile: string | null;
  /** Index into the range options; null is the whole 7 days. */
  day: number | null;
};

export const EMPTY_FILTERS: EventFilterState = { search: "", device: null, eero: null, profile: null, day: null };

export type Option = { value: string; label: string };

const selectClass =
  "h-7 min-w-32 max-w-44 cursor-pointer truncate rounded-lg border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-input/32";

function Select({
  label,
  icon,
  value,
  any,
  options,
  onChange,
}: {
  label: string;
  icon: ReactNode;
  value: string | null;
  any: string;
  options: ReadonlyArray<Option>;
  onChange: (value: string | null) => void;
}) {
  return (
    <label className="flex items-center gap-1.5">
      <span className="text-2xs text-muted-foreground">{label}</span>
      <span className="relative inline-flex items-center">
        <span className="pointer-events-none absolute left-2 text-muted-foreground [&_svg]:size-3.5">{icon}</span>
        <select
          aria-label={label}
          className={cn(selectClass, "pl-7", value === null && "text-muted-foreground")}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
        >
          <option value="">{any}</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </span>
    </label>
  );
}

export function EventFilters({
  value,
  searchText,
  onSearchText,
  onChange,
  onReset,
  devices,
  eeros,
  profiles,
  days,
  canReset,
}: {
  value: EventFilterState;
  searchText: string;
  onSearchText: (text: string) => void;
  onChange: (patch: Partial<EventFilterState>) => void;
  onReset: () => void;
  devices: ReadonlyArray<Option>;
  eeros: ReadonlyArray<Option>;
  profiles: ReadonlyArray<Option>;
  /** One label per day of the window, newest first ("Today", "Yesterday", "Tuesday"). */
  days: ReadonlyArray<string>;
  canReset: boolean;
}) {
  return (
    <Card className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3.5">
      <Input
        type="search"
        aria-label="Filter events"
        placeholder="Filter events"
        icon={<Search />}
        className="w-44"
        value={searchText}
        onChange={(e) => onSearchText(e.target.value)}
      />
      <Select label="Device" icon={<MonitorSmartphone />} value={value.device} any="Any device" options={devices} onChange={(device) => onChange({ device })} />
      <Select label="eero" icon={<Router />} value={value.eero} any="Any eero" options={eeros} onChange={(eero) => onChange({ eero })} />
      <Select label="Profile" icon={<Users />} value={value.profile} any="Any profile" options={profiles} onChange={(profile) => onChange({ profile })} />
      <Select
        label="Range"
        icon={<Calendar />}
        value={value.day === null ? null : String(value.day)}
        any="Last 7 days"
        options={days.map((label, i) => ({ value: String(i), label }))}
        onChange={(day) => onChange({ day: day === null ? null : Number(day) })}
      />
      <Button size="xs" variant="ghost" className="ms-auto" disabled={!canReset} onClick={onReset}>
        <RotateCcw />
        Reset
      </Button>
    </Card>
  );
}
