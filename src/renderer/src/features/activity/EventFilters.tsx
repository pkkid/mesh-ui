/**
 * Activity filter bar (docs/ux/pages/activity.md, Layout 2), built from the
 * shared filter bar like Devices: search and a Filters popover (Event type,
 * Device, eero, Profile) on the left, the stream's own controls (`end`: the
 * Show dropdown) on the right of the same row, and the filters that are set
 * as removable chips under it. There is no range: the stream is live (eero
 * sends only its last ~15 minutes), so it holds what came in while the app
 * was open. Pure view state; the page passes it to `events.list` and
 * `events.summary`, which filter in core.
 */
import type { ReactNode, RefObject } from "react";

import {
  FilterBar,
  FilterBarEnd,
  type FilterChip,
  type FilterOption,
  FilterRow,
  FilterSearch,
  FiltersButton,
  FilterToggle,
  SelectPicker,
} from "~/components/ui/filter-bar";
import { formatCount } from "../../../../core/format";
import type { EventCategory } from "../../../../core/model";

import { CATEGORIES, CATEGORY_ORDER } from "./ActivityChart";

export type EventFilterState = {
  search: string;
  /** Show only these types; empty shows every type. */
  types: EventCategory[];
  device: string | null;
  eero: string | null;
  profile: string | null;
};

export const EMPTY_FILTERS: EventFilterState = { search: "", types: [], device: null, eero: null, profile: null };

/** Clears every filter in the Filters popover; search stays. */
const CLEAR_POPOVER: Partial<EventFilterState> = { types: [], device: null, eero: null, profile: null };

export type Option = FilterOption;

export function EventFilters({
  value: f,
  searchText,
  onSearchText,
  searchRef,
  onChange,
  devices,
  eeros,
  profiles,
  typeCounts,
  end,
}: {
  value: EventFilterState;
  searchText: string;
  onSearchText: (text: string) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  onChange: (patch: Partial<EventFilterState>) => void;
  devices: ReadonlyArray<Option>;
  eeros: ReadonlyArray<Option>;
  profiles: ReadonlyArray<Option>;
  /** Kept events per type, for the Event type toggles (types with none are left out unless picked). */
  typeCounts: Readonly<Record<EventCategory, number>> | undefined;
  /** Controls on the right of the bar's row. */
  end?: ReactNode;
}) {
  const labelOf = (options: ReadonlyArray<Option>, v: string) => options.find((o) => o.value === v)?.label ?? v;
  const chips: FilterChip[] = [];
  if (f.types.length > 0) {
    const text = f.types.length <= 2 ? f.types.map((t) => CATEGORIES[t].label).join(", ") : `${f.types.length} types`;
    chips.push({ key: "types", text: `Type: ${text}`, onRemove: () => onChange({ types: [] }) });
  }
  if (f.device) chips.push({ key: "device", text: `Device: ${labelOf(devices, f.device)}`, onRemove: () => onChange({ device: null }) });
  if (f.eero) chips.push({ key: "eero", text: `eero: ${labelOf(eeros, f.eero)}`, onRemove: () => onChange({ eero: null }) });
  if (f.profile) chips.push({ key: "profile", text: `Profile: ${labelOf(profiles, f.profile)}`, onRemove: () => onChange({ profile: null }) });
  const toggleType = (t: EventCategory) => onChange({ types: f.types.includes(t) ? f.types.filter((x) => x !== t) : [...f.types, t] });
  const shownTypes = CATEGORY_ORDER.filter((t) => (typeCounts?.[t] ?? 0) > 0 || f.types.includes(t));

  return (
    <FilterBar
      chips={chips}
      onClearAll={() => onChange(CLEAR_POPOVER)}
    >
      <FilterSearch
        inputRef={searchRef}
        aria-label="Filter events"
        placeholder="Filter events"
        title="Filter by text in the event"
        value={searchText}
        onValueChange={onSearchText}
      />
      <FiltersButton active={chips.length} onClear={() => onChange(CLEAR_POPOVER)}>
        <FilterRow label="Event type">
          <div role="group" aria-label="Event type" className="flex flex-wrap gap-1">
            {shownTypes.map((t) => (
              <FilterToggle key={t} pressed={f.types.includes(t)} onClick={() => toggleType(t)}>
                {CATEGORIES[t].label}
                <span className="text-muted-foreground tabular-nums">{formatCount(typeCounts?.[t] ?? 0)}</span>
              </FilterToggle>
            ))}
          </div>
        </FilterRow>
        <FilterRow label="Device">
          <SelectPicker name="Device" value={f.device} options={devices} onChange={(device) => onChange({ device })} />
        </FilterRow>
        <FilterRow label="eero">
          <SelectPicker name="eero" value={f.eero} options={eeros} onChange={(eero) => onChange({ eero })} />
        </FilterRow>
        <FilterRow label="Profile">
          <SelectPicker name="Profile" value={f.profile} options={profiles} onChange={(profile) => onChange({ profile })} />
        </FilterRow>
      </FiltersButton>
      {end && <FilterBarEnd>{end}</FilterBarEnd>}
    </FilterBar>
  );
}
