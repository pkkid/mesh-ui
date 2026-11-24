/**
 * The Devices toolbar (docs/ux/pages/devices.md, Layout 2 and 3): search, a
 * Status dropdown and a Filters popover (network, band, type, eero, profile,
 * manufacturer, new this week) on the left; Group by and Columns on the
 * right. Popover filters that are set show as removable chips under the
 * toolbar. Every filter becomes a `device.list` param in DevicesPage;
 * grouping and columns are view state. Sorting is on the table headers.
 */
import { Check, CircleDot, Columns3, Layers } from "lucide-react";
import type { RefObject } from "react";

import { Button } from "~/components/ui/button";
import {
  FilterBar,
  FilterBarEnd,
  type FilterChip,
  FilterDropdown,
  FilterRow,
  FilterSearch,
  FiltersButton,
  FilterToggle,
  SelectPicker,
} from "~/components/ui/filter-bar";
import { Popover, PopoverPopup, PopoverTrigger, popoverButtonItem } from "~/components/ui/popover";
import { Segmented } from "~/components/ui/segmented";
import { cn } from "~/lib/utils";
import type { Band, DeviceCategory, DeviceSummary } from "../../../../core/model";

export type StatusFilter = "all" | "online" | "offline" | "paused" | "blocked";
export type GroupBy = "category" | "status" | "eero" | "profile" | "none";
export type ColumnKey = "profile" | "eero" | "band" | "signal" | "addr" | "now" | "chart" | "today" | "status";

/** `profile` filter value for devices with no profile (sent as `profile: null`). */
export const UNASSIGNED = "__unassigned__";

/** What the user picked. DevicesPage turns it into `device.list` params. */
export type DeviceFilterState = {
  search: string;
  ssid: "all" | "main" | "guest";
  status: StatusFilter;
  band: Band | null;
  eero: string | null;
  /** A profile id, UNASSIGNED, or null for any. */
  profile: string | null;
  type: DeviceCategory | null;
  manufacturer: string | null;
  /** New this week: the ISO time one week before the filter was set (sent as `newSince`), or null. */
  newSince: string | null;
};

export const EMPTY_FILTERS: DeviceFilterState = {
  search: "",
  ssid: "all",
  status: "all",
  band: null,
  eero: null,
  profile: null,
  type: null,
  manufacturer: null,
  newSince: null,
};

/** Clears every filter in the Filters popover; search and status stay. */
const CLEAR_POPOVER: Partial<DeviceFilterState> = {
  ssid: "all",
  band: null,
  type: null,
  eero: null,
  profile: null,
  manufacturer: null,
  newSince: null,
};

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export const CATEGORY_LABELS: Record<DeviceCategory, string> = {
  phones_tablets: "Phones & tablets",
  computers: "Computers",
  entertainment: "Entertainment",
  smart_home: "Smart home",
  other: "Other",
};

export const CATEGORIES = Object.keys(CATEGORY_LABELS) as DeviceCategory[];

const BAND_LABELS: Record<Band, string> = { wired: "Wired", "2.4": "2.4 GHz", "5": "5 GHz", "6": "6 GHz" };
// Listed by hand: Object.keys would put the numeric-looking "5" and "6" first.
const BANDS: Band[] = ["wired", "2.4", "5", "6"];

export const COLUMN_LABELS: Record<ColumnKey, string> = {
  profile: "Profile",
  eero: "Connected to",
  band: "Band",
  signal: "Signal",
  addr: "IP · MAC",
  now: "Live",
  chart: "Live chart",
  today: "24h",
  status: "Status",
};

const GROUP_LABELS: Record<GroupBy, string> = {
  category: "Category",
  status: "Status",
  eero: "eero",
  profile: "Profile",
  none: "None",
};

type Option = { value: string; label: string; count?: number };

type DeviceFiltersProps = {
  filters: DeviceFilterState;
  /** What is typed in the search field (debounced into `filters.search`). */
  searchText: string;
  onSearchText: (text: string) => void;
  onChange: (patch: Partial<DeviceFilterState>) => void;
  summary: DeviceSummary | undefined;
  guestCount: number | undefined;
  eeros: ReadonlyArray<Option>;
  profiles: ReadonlyArray<Option>;
  manufacturers: ReadonlyArray<string>;
  groupBy: GroupBy;
  onGroupBy: (g: GroupBy) => void;
  hidden: ReadonlySet<ColumnKey>;
  onToggleColumn: (c: ColumnKey) => void;
  searchRef: RefObject<HTMLInputElement | null>;
};

const count = (n: number | undefined) => (n === undefined ? "-" : String(n));

export function DeviceFilters(props: DeviceFiltersProps) {
  const { filters: f, onChange, summary: s } = props;
  // Counts come from the device.list summary (the whole network), like the band and type counts.
  const counted = (options: ReadonlyArray<Option>, rows: { key: string | null; count: number }[] | undefined, keyOf = (v: string): string | null => v): Option[] =>
    options.map((o) => ({ ...o, count: rows ? (rows.find((r) => r.key === keyOf(o.value))?.count ?? 0) : undefined }));
  const profileOptions: Option[] = counted(
    [...props.profiles, { value: UNASSIGNED, label: "Unassigned" }],
    s?.byProfile.map((r) => ({ key: r.profileId, count: r.count })),
    (v) => (v === UNASSIGNED ? null : v),
  );
  const eeroOptions = counted(props.eeros, s?.byEero.map((r) => ({ key: r.eeroId, count: r.count })));
  const manufacturerOptions = counted(
    props.manufacturers.map((m) => ({ value: m, label: m })),
    s?.byManufacturer.map((r) => ({ key: r.manufacturer, count: r.count })),
  );
  const typeOptions: Option[] = CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c], count: s?.byCategory[c] }));
  const labelOf = (options: ReadonlyArray<Option>, value: string) => options.find((o) => o.value === value)?.label ?? value;

  // One removable chip per popover filter that is set.
  const chips: FilterChip[] = [];
  const chip = (key: string, text: string, clear: Partial<DeviceFilterState>) => chips.push({ key, text, onRemove: () => onChange(clear) });
  if (f.ssid !== "all") chip("ssid", f.ssid === "main" ? "Main network" : "Guest network", { ssid: "all" });
  if (f.band) chip("band", BAND_LABELS[f.band], { band: null });
  if (f.type) chip("type", CATEGORY_LABELS[f.type], { type: null });
  if (f.eero) chip("eero", `eero: ${labelOf(props.eeros, f.eero)}`, { eero: null });
  if (f.profile) chip("profile", `Profile: ${labelOf(profileOptions, f.profile)}`, { profile: null });
  if (f.manufacturer) chip("manufacturer", f.manufacturer, { manufacturer: null });
  if (f.newSince) chip("newSince", "New this week", { newSince: null });

  return (
    <FilterBar chips={chips} onClearAll={() => onChange(CLEAR_POPOVER)}>
      <FilterSearch
        inputRef={props.searchRef}
        aria-label="Search devices"
        placeholder="Search devices"
        title="Search by name, manufacturer, MAC or IP"
        value={props.searchText}
        onValueChange={props.onSearchText}
      />
      <FilterDropdown
        label="Status"
        icon={CircleDot}
        align="start"
        value={f.status}
        options={[
          { value: "all", label: "All devices", count: s?.total },
          { value: "online", label: "Online", count: s?.online },
          { value: "offline", label: "Offline", count: s?.offline },
          { value: "paused", label: "Paused", count: s?.paused },
          { value: "blocked", label: "Blocked", count: s?.blocked },
        ]}
        onChange={(status) => onChange({ status: (status ?? "all") as DeviceFilterState["status"] })}
      />
      <FiltersButton active={chips.length} onClear={() => onChange(CLEAR_POPOVER)}>
        <FilterRow label="Network">
          <Segmented
            aria-label="Network"
            value={f.ssid}
            onValueChange={(ssid) => onChange({ ssid })}
            options={[
              { value: "all", label: "All" },
              { value: "main", label: "Main" },
              { value: "guest", label: props.guestCount === undefined ? "Guest" : `Guest ${props.guestCount}` },
            ]}
          />
        </FilterRow>
        <FilterRow label="Band">
          <div role="group" aria-label="Band" className="flex flex-wrap gap-1">
            {BANDS.map((b) => (
              <FilterToggle key={b} pressed={f.band === b} onClick={() => onChange({ band: f.band === b ? null : b })}>
                {BAND_LABELS[b]}
                <span className="text-muted-foreground tabular-nums">{count(s?.byBand[b])}</span>
              </FilterToggle>
            ))}
          </div>
        </FilterRow>
        <FilterRow label="Type">
          <SelectPicker name="Type" value={f.type} options={typeOptions} onChange={(type) => onChange({ type: type as DeviceCategory | null })} />
        </FilterRow>
        <FilterRow label="eero">
          <SelectPicker name="eero" value={f.eero} options={eeroOptions} onChange={(eero) => onChange({ eero })} />
        </FilterRow>
        <FilterRow label="Profile">
          <SelectPicker name="Profile" value={f.profile} options={profileOptions} onChange={(profile) => onChange({ profile })} />
        </FilterRow>
        <FilterRow label="Manufacturer">
          <SelectPicker name="Manufacturer" value={f.manufacturer} options={manufacturerOptions} onChange={(manufacturer) => onChange({ manufacturer })} />
        </FilterRow>
        <FilterRow label="First seen">
          <FilterToggle
            pressed={f.newSince !== null}
            onClick={() => onChange({ newSince: f.newSince ? null : new Date(Date.now() - WEEK_MS).toISOString() })}
          >
            New this week
            <span className="text-muted-foreground tabular-nums">{count(s?.newThisWeek.length)}</span>
          </FilterToggle>
        </FilterRow>
      </FiltersButton>
      <FilterBarEnd>
        <FilterDropdown
          label="Group by"
          icon={Layers}
          value={props.groupBy}
          options={(Object.keys(GROUP_LABELS) as GroupBy[]).map((g) => ({ value: g, label: GROUP_LABELS[g] }))}
          onChange={(g) => props.onGroupBy(g as GroupBy)}
        />
        <ColumnsButton hidden={props.hidden} onToggle={props.onToggleColumn} />
      </FilterBarEnd>
    </FilterBar>
  );
}

function ColumnsButton({ hidden, onToggle }: { hidden: ReadonlySet<ColumnKey>; onToggle: (c: ColumnKey) => void }) {
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" size="icon" aria-label="Columns" title="Columns" />}>
        <Columns3 />
      </PopoverTrigger>
      <PopoverPopup variant="list" align="end">
            <div role="group" aria-label="Columns">
              {(Object.keys(COLUMN_LABELS) as ColumnKey[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={!hidden.has(c)}
                  className={popoverButtonItem}
                  onClick={() => onToggle(c)}
                >
                  <Check className={cn(hidden.has(c) && "invisible")} />
                  {COLUMN_LABELS[c]}
                </button>
              ))}
            </div>
      </PopoverPopup>
    </Popover>
  );
}
