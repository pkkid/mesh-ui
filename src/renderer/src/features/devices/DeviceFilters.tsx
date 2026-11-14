/**
 * The Devices toolbar (docs/ux/pages/devices.md, Layout 2 and 3): search, a
 * status segment and a Filters popover (network, band, type, eero, profile,
 * manufacturer, new this week) on the left; Group by, Sort and Columns on
 * the right. Popover filters that are set show as removable chips under the
 * toolbar. Every filter and the sort become `device.list` params in
 * DevicesPage; grouping and columns are view state.
 */
import { Popover } from "@base-ui/react/popover";
import { ArrowDownAZ, Check, ChevronDown, Columns3, Layers, ListFilter, type LucideIcon, Search, X } from "lucide-react";
import { type ReactNode, type RefObject, useState } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Segmented } from "~/components/ui/segmented";
import { cn } from "~/lib/utils";
import type { Band, DeviceCategory, DeviceSummary } from "../../../../core/model";

export type StatusFilter = "all" | "online" | "offline" | "paused" | "blocked";
export type SortKey = "name" | "rate" | "usage" | "last_seen";
export type GroupBy = "category" | "status" | "eero" | "profile" | "none";
export type ColumnKey = "profile" | "eero" | "band" | "signal" | "addr" | "now" | "today";

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
  /** New this week: the ISO time one week before the filter was set (sent as `firstSeenSince`), or null. */
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

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

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
  now: "Now",
  today: "24h",
};

const SORT_LABELS: Record<SortKey, string> = {
  name: "Name",
  rate: "Live rate",
  usage: "Data, 24h",
  last_seen: "Last seen",
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
  sort: SortKey;
  onSort: (s: SortKey) => void;
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
  const chips: { key: string; text: string; clear: Partial<DeviceFilterState> }[] = [];
  if (f.ssid !== "all") chips.push({ key: "ssid", text: f.ssid === "main" ? "Main network" : "Guest network", clear: { ssid: "all" } });
  if (f.band) chips.push({ key: "band", text: BAND_LABELS[f.band], clear: { band: null } });
  if (f.type) chips.push({ key: "type", text: CATEGORY_LABELS[f.type], clear: { type: null } });
  if (f.eero) chips.push({ key: "eero", text: `eero: ${labelOf(props.eeros, f.eero)}`, clear: { eero: null } });
  if (f.profile) chips.push({ key: "profile", text: `Profile: ${labelOf(profileOptions, f.profile)}`, clear: { profile: null } });
  if (f.manufacturer) chips.push({ key: "manufacturer", text: f.manufacturer, clear: { manufacturer: null } });
  if (f.newSince) chips.push({ key: "newSince", text: "New this week", clear: { newSince: null } });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="relative min-w-36 max-w-[300px] flex-1 basis-36">
          <Input
            ref={props.searchRef}
            type="search"
            aria-label="Search devices"
            placeholder="Search devices"
            title="Search by name, manufacturer, MAC or IP"
            icon={<Search />}
            value={props.searchText}
            onChange={(e) => props.onSearchText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") props.onSearchText("");
            }}
            className="pe-7 text-[13px]"
          />
          <kbd className="pointer-events-none absolute end-2 top-1/2 -translate-y-1/2 rounded-[5px] border px-1.5 font-mono text-2xs text-muted-foreground">
            /
          </kbd>
        </div>
        <Segmented
          aria-label="Status"
          value={f.status}
          onValueChange={(status) => onChange({ status })}
          options={[
            { value: "all", label: `All ${count(s?.total)}` },
            { value: "online", label: `Online ${count(s?.online)}` },
            { value: "offline", label: `Offline ${count(s?.offline)}` },
            { value: "paused", label: `Paused ${count(s?.paused)}` },
            { value: "blocked", label: `Blocked ${count(s?.blocked)}` },
          ]}
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
                <Toggle key={b} pressed={f.band === b} onClick={() => onChange({ band: f.band === b ? null : b })}>
                  {BAND_LABELS[b]}
                  <span className="text-muted-foreground tabular-nums">{count(s?.byBand[b])}</span>
                </Toggle>
              ))}
            </div>
          </FilterRow>
          <FilterRow label="Type">
            <SelectPicker
              name="Type"
              value={f.type}
              options={typeOptions}
              onChange={(type) => onChange({ type: type as DeviceCategory | null })}
            />
          </FilterRow>
          <FilterRow label="eero">
            <SelectPicker name="eero" value={f.eero} options={eeroOptions} onChange={(eero) => onChange({ eero })} />
          </FilterRow>
          <FilterRow label="Profile">
            <SelectPicker name="Profile" value={f.profile} options={profileOptions} onChange={(profile) => onChange({ profile })} />
          </FilterRow>
          <FilterRow label="Manufacturer">
            <SelectPicker
              name="Manufacturer"
              value={f.manufacturer}
              options={manufacturerOptions}
              onChange={(manufacturer) => onChange({ manufacturer })}
            />
          </FilterRow>
          <FilterRow label="First seen">
            <Toggle
              pressed={f.newSince !== null}
              onClick={() => onChange({ newSince: f.newSince ? null : new Date(Date.now() - WEEK_MS).toISOString() })}
            >
              New this week
              <span className="text-muted-foreground tabular-nums">{count(s?.newThisWeek.length)}</span>
            </Toggle>
          </FilterRow>
        </FiltersButton>
        <div className="ms-auto flex items-center gap-1.5">
          <Picker
            label="Group by"
            value={props.groupBy}
            options={(Object.keys(GROUP_LABELS) as GroupBy[]).map((g) => ({ value: g, label: GROUP_LABELS[g] }))}
            onChange={(g) => props.onGroupBy(g as GroupBy)}
            align="end"
            triggerClassName={compactClass}
            trigger={<SelectTrigger icon={Layers}>{GROUP_LABELS[props.groupBy]}</SelectTrigger>}
          />
          <Picker
            label="Sort"
            value={props.sort}
            options={(Object.keys(SORT_LABELS) as SortKey[]).map((k) => ({ value: k, label: SORT_LABELS[k] }))}
            onChange={(k) => props.onSort(k as SortKey)}
            align="end"
            triggerClassName={compactClass}
            trigger={<SelectTrigger icon={ArrowDownAZ}>{SORT_LABELS[props.sort]}</SelectTrigger>}
          />
          <ColumnsButton hidden={props.hidden} onToggle={props.onToggleColumn} />
        </div>
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Active filters">
          {chips.map((c) => (
            <span
              key={c.key}
              className="inline-flex h-6 items-center gap-1 rounded-full border bg-card ps-2.5 pe-1 text-foreground/80 text-xs"
            >
              {c.text}
              <button
                type="button"
                aria-label={`Remove filter: ${c.text}`}
                onClick={() => onChange(c.clear)}
                className="grid size-4 cursor-pointer place-items-center rounded-full text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
          <Button variant="ghost-muted" size="xs" onClick={() => onChange(CLEAR_POPOVER)}>
            Clear all
          </Button>
        </div>
      )}
    </div>
  );
}

/** The Filters button and its popover; the badge counts the popover filters that are set. */
function FiltersButton({ active, onClear, children }: { active: number; onClear: () => void; children: ReactNode }) {
  // The wrapper keeps the popover's focus guards out of the toolbar's flex gaps.
  return (
    <div className="flex">
    <Popover.Root>
      <Popover.Trigger
        render={<Button variant="outline" aria-label={active ? `Filters, ${active} set` : "Filters"} />}
        className="gap-1.5 px-2 font-normal text-[13px]"
      >
        <ListFilter className="size-3.5 text-muted-foreground" />
        Filters
        {active > 0 && (
          <span className="grid h-4 min-w-4 place-items-center rounded-full bg-muted px-1 font-medium text-2xs text-foreground tabular-nums">
            {active}
          </span>
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={4} className="z-50">
          <Popover.Popup
            aria-label="Filters"
            className="no-drag w-[340px] rounded-xl border bg-popover text-popover-foreground text-xs shadow-lg outline-none"
          >
            <div className="flex flex-col gap-2.5 p-3">{children}</div>
            <div className="flex items-center justify-between border-t px-3 py-2">
              <span className="text-muted-foreground">
                {active === 0 ? "No filters set" : `${active} ${active === 1 ? "filter" : "filters"} set`}
              </span>
              <Button variant="ghost-muted" size="xs" disabled={active === 0} onClick={onClear}>
                Clear all
              </Button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
    </div>
  );
}

function FilterRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[84px_1fr] items-center gap-2">
      <span className="text-muted-foreground">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** A neutral on/off pill inside the Filters popover. */
function Toggle({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "inline-flex h-6 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border bg-card px-2.5 text-foreground/80 text-xs outline-none transition-colors",
        "hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring",
        pressed && "border-muted-foreground/50 bg-muted text-foreground",
      )}
    >
      {children}
    </button>
  );
}

const popupClass =
  "no-drag max-h-80 min-w-44 overflow-y-auto rounded-xl border bg-popover p-1 text-popover-foreground text-xs shadow-lg outline-none";
const itemClass =
  "flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-start outline-none hover:bg-muted/60 focus-visible:bg-muted/60";

/** A popover list of options with a check on the current one. */
function Picker({
  label,
  value,
  options,
  onChange,
  trigger,
  triggerClassName,
  anyLabel,
  align = "start",
}: {
  label: string;
  value: string | null;
  options: ReadonlyArray<Option>;
  onChange: (value: string | null) => void;
  /** Classes and content of the trigger button. */
  triggerClassName: string;
  trigger: ReactNode;
  /** Adds a first "Any" row that clears the value. */
  anyLabel?: string;
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const rows: ReadonlyArray<{ value: string | null; label: string; count?: number }> = anyLabel
    ? [{ value: null, label: anyLabel }, ...options]
    : options;
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger aria-label={label} title={label} className={triggerClassName}>
        {trigger}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align={align} sideOffset={4} className="z-50">
          <Popover.Popup className={popupClass}>
            <div role="listbox" aria-label={label}>
              {rows.length === 0 && <div className="px-2.5 py-1.5 text-muted-foreground">Nothing to pick yet</div>}
              {rows.map((o) => (
                <button
                  key={o.value ?? ""}
                  type="button"
                  role="option"
                  aria-selected={o.value === value}
                  className={itemClass}
                  onClick={() => {
                    setOpen(false);
                    onChange(o.value);
                  }}
                >
                  <Check className={cn("size-3.5 shrink-0", o.value !== value && "invisible")} />
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  {o.count !== undefined && <span className="text-muted-foreground tabular-nums">{o.count}</span>}
                </button>
              ))}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

const selectClass =
  "inline-flex h-7 cursor-pointer items-center gap-2 rounded-lg border border-input bg-background px-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-input/32";

/** Group by and Sort: sized to their value, with the name in the tooltip and for screen readers. */
const compactClass =
  "inline-flex h-8 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg border border-input bg-background px-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-input/32";

function SelectTrigger({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <>
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-start">{children}</span>
      <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
    </>
  );
}

/** A full-width select inside the Filters popover, with an "Any" row. */
function SelectPicker({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: string | null;
  options: ReadonlyArray<Option>;
  onChange: (value: string | null) => void;
}) {
  const picked = value === null ? "Any" : (options.find((o) => o.value === value)?.label ?? value);
  return (
    <Picker
      label={name}
      value={value}
      options={options}
      onChange={onChange}
      anyLabel="Any"
      triggerClassName={cn(selectClass, "w-full")}
      trigger={
        <>
          <span className={cn("min-w-0 flex-1 truncate text-start", value === null && "text-muted-foreground")}>{picked}</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </>
      }
    />
  );
}

function ColumnsButton({ hidden, onToggle }: { hidden: ReadonlySet<ColumnKey>; onToggle: (c: ColumnKey) => void }) {
  return (
    <Popover.Root>
      <Popover.Trigger render={<Button variant="outline" size="icon" aria-label="Columns" title="Columns" />}>
        <Columns3 />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={4} className="z-50">
          <Popover.Popup className={popupClass}>
            <div role="group" aria-label="Columns">
              {(Object.keys(COLUMN_LABELS) as ColumnKey[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={!hidden.has(c)}
                  className={itemClass}
                  onClick={() => onToggle(c)}
                >
                  <Check className={cn("size-3.5 shrink-0", hidden.has(c) && "invisible")} />
                  {COLUMN_LABELS[c]}
                </button>
              ))}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
