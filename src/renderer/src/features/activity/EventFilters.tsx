/**
 * Activity filter bar (docs/ux/pages/activity.md, Layout 2), built from the
 * shared filter bar like Devices: search and a Filters popover (Device, eero,
 * Profile), and the filters that are set as removable chips under it. There
 * is no range: the stream is live (eero sends only its last ~15 minutes), so
 * it holds what came in while the app was open. Types hidden from the legend show as
 * one chip too. Pure view state; the page passes it to `events.list` and
 * `events.summary`, which filter in core.
 */
import type { RefObject } from "react";

import {
  FilterBar,
  type FilterChip,
  type FilterOption,
  FilterRow,
  FilterSearch,
  FiltersButton,
  SelectPicker,
} from "~/components/ui/filter-bar";

export type EventFilterState = {
  search: string;
  device: string | null;
  eero: string | null;
  profile: string | null;
};

export const EMPTY_FILTERS: EventFilterState = { search: "", device: null, eero: null, profile: null };

/** Clears every filter in the Filters popover; search stays. */
const CLEAR_POPOVER: Partial<EventFilterState> = { device: null, eero: null, profile: null };

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
  hiddenTypes,
  onShowAllTypes,
}: {
  value: EventFilterState;
  searchText: string;
  onSearchText: (text: string) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  onChange: (patch: Partial<EventFilterState>) => void;
  devices: ReadonlyArray<Option>;
  eeros: ReadonlyArray<Option>;
  profiles: ReadonlyArray<Option>;
  /** How many event types the legend hides (0 when all show). */
  hiddenTypes: number;
  onShowAllTypes: () => void;
}) {
  const labelOf = (options: ReadonlyArray<Option>, v: string) => options.find((o) => o.value === v)?.label ?? v;
  const chips: FilterChip[] = [];
  if (f.device) chips.push({ key: "device", text: `Device: ${labelOf(devices, f.device)}`, onRemove: () => onChange({ device: null }) });
  if (f.eero) chips.push({ key: "eero", text: `eero: ${labelOf(eeros, f.eero)}`, onRemove: () => onChange({ eero: null }) });
  if (f.profile) chips.push({ key: "profile", text: `Profile: ${labelOf(profiles, f.profile)}`, onRemove: () => onChange({ profile: null }) });
  const popoverSet = chips.length;
  if (hiddenTypes > 0) chips.push({ key: "types", text: `${hiddenTypes} ${hiddenTypes === 1 ? "type" : "types"} hidden`, onRemove: onShowAllTypes });

  return (
    <FilterBar
      chips={chips}
      onClearAll={() => {
        onChange(CLEAR_POPOVER);
        onShowAllTypes();
      }}
    >
      <FilterSearch
        inputRef={searchRef}
        aria-label="Filter events"
        placeholder="Filter events"
        title="Filter by text in the event"
        value={searchText}
        onValueChange={onSearchText}
      />
      <FiltersButton active={popoverSet} onClear={() => onChange(CLEAR_POPOVER)}>
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
    </FilterBar>
  );
}
