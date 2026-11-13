/**
 * The Devices toolbar and filter chips (docs/ux/pages/devices.md, Layout 2
 * and 3): search, Main / Guest segment, Group by, Sort, Columns, then the
 * status, connection and dropdown chips. Every filter and the sort become
 * `device.list` params in DevicesPage; grouping and columns are view state.
 */
import { Popover } from "@base-ui/react/popover";
import {
  ArrowDownAZ,
  Ban,
  Cable,
  Check,
  ChevronDown,
  Columns3,
  Factory,
  Layers,
  type LucideIcon,
  PauseCircle,
  Router,
  Search,
  Shapes,
  Users,
} from "lucide-react";
import { type ReactNode, type RefObject, useState } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Segmented } from "~/components/ui/segmented";
import { StatusDot, type StatusTone } from "~/components/ui/status";
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
};

export const CATEGORY_LABELS: Record<DeviceCategory, string> = {
  phones_tablets: "Phones & tablets",
  computers: "Computers",
  entertainment: "Entertainment",
  smart_home: "Smart home",
  other: "Other",
};

export const CATEGORIES = Object.keys(CATEGORY_LABELS) as DeviceCategory[];

export const COLUMN_LABELS: Record<ColumnKey, string> = {
  profile: "Profile",
  eero: "Connected to",
  band: "Band",
  signal: "Signal",
  addr: "IP · MAC",
  now: "Now",
  today: "Today",
};

const SORT_LABELS: Record<SortKey, string> = {
  name: "Name, A to Z",
  rate: "Live rate",
  usage: "Data today",
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
  const statusChip = (value: StatusFilter, label: string, n: number | undefined, lead?: ReactNode) => (
    <Chip
      key={value}
      selected={f.status === value}
      onClick={() => onChange({ status: value === f.status && value !== "all" ? "all" : value })}
      lead={lead}
      count={count(n)}
    >
      {label}
    </Chip>
  );
  const bandChip = (band: Band, label: string, icon?: LucideIcon) => (
    <Chip
      key={band}
      selected={f.band === band}
      onClick={() => onChange({ band: f.band === band ? null : band })}
      icon={icon}
      count={count(s?.byBand[band])}
    >
      {label}
    </Chip>
  );
  const dot = (tone: StatusTone) => <StatusDot tone={tone} className="size-[7px]" />;

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-[340px] max-w-full">
          <Input
            ref={props.searchRef}
            type="search"
            aria-label="Search devices"
            placeholder="Search by name, manufacturer, MAC or IP"
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
          aria-label="Network"
          value={f.ssid}
          onValueChange={(ssid) => onChange({ ssid })}
          options={[
            { value: "all", label: "All networks" },
            { value: "main", label: "Main" },
            { value: "guest", label: props.guestCount === undefined ? "Guest" : `Guest ${props.guestCount}` },
          ]}
        />
        <div className="ms-auto flex items-center gap-2">
          <span className="text-muted-foreground text-xs">Group by</span>
          <Picker
            label="Group by"
            value={props.groupBy}
            options={(Object.keys(GROUP_LABELS) as GroupBy[]).map((g) => ({ value: g, label: GROUP_LABELS[g] }))}
            onChange={(g) => props.onGroupBy(g as GroupBy)}
            triggerClassName={selectClass}
            trigger={<SelectTrigger icon={Layers}>{GROUP_LABELS[props.groupBy]}</SelectTrigger>}
          />
          <span className="text-muted-foreground text-xs">Sort</span>
          <Picker
            label="Sort"
            value={props.sort}
            options={(Object.keys(SORT_LABELS) as SortKey[]).map((k) => ({ value: k, label: SORT_LABELS[k] }))}
            onChange={(k) => props.onSort(k as SortKey)}
            triggerClassName={selectClass}
            trigger={<SelectTrigger icon={ArrowDownAZ}>{SORT_LABELS[props.sort]}</SelectTrigger>}
          />
          <ColumnsButton hidden={props.hidden} onToggle={props.onToggleColumn} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filters">
        {statusChip("all", "All", s?.total)}
        {statusChip("online", "Online", s?.online, dot("success"))}
        {statusChip("offline", "Offline", s?.offline, dot("muted"))}
        {statusChip("paused", "Paused", s?.paused, <PauseCircle />)}
        {statusChip("blocked", "Blocked", s?.blocked, <Ban />)}
        <Rule />
        {bandChip("wired", "Wired", Cable)}
        {bandChip("2.4", "2.4 GHz")}
        {bandChip("5", "5 GHz")}
        {bandChip("6", "6 GHz")}
        <Rule />
        <DropdownChip
          icon={Router}
          name="eero"
          value={f.eero}
          options={props.eeros}
          onChange={(eero) => onChange({ eero })}
        />
        <DropdownChip
          icon={Users}
          name="Profile"
          value={f.profile}
          options={[...props.profiles, { value: UNASSIGNED, label: "Unassigned" }]}
          onChange={(profile) => onChange({ profile })}
        />
        <DropdownChip
          icon={Shapes}
          name="Type"
          value={f.type}
          options={CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c], count: s?.byCategory[c] }))}
          onChange={(type) => onChange({ type: type as DeviceCategory | null })}
        />
        <DropdownChip
          icon={Factory}
          name="Manufacturer"
          bare
          value={f.manufacturer}
          options={props.manufacturers.map((m) => ({ value: m, label: m }))}
          onChange={(manufacturer) => onChange({ manufacturer })}
        />
      </div>
    </div>
  );
}

const Rule = () => <span aria-hidden className="mx-1 h-[18px] w-px bg-border" />;

const chipClass = (selected: boolean) =>
  cn(
    "inline-flex h-[26px] cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border bg-card px-2.5 text-foreground/80 text-xs outline-none transition-colors",
    "hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-[13px] [&_svg]:text-muted-foreground",
    selected && "border-muted-foreground/50 bg-muted text-foreground [&_svg]:text-foreground",
  );

function Chip({
  selected,
  onClick,
  icon: Icon,
  lead,
  count: n,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  icon?: LucideIcon;
  lead?: ReactNode;
  count?: string;
  children: ReactNode;
}) {
  return (
    <button type="button" aria-pressed={selected} onClick={onClick} className={chipClass(selected)}>
      {Icon ? <Icon /> : lead}
      {children}
      {n !== undefined && <span className="text-muted-foreground tabular-nums">{n}</span>}
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
}) {
  const [open, setOpen] = useState(false);
  const rows: ReadonlyArray<{ value: string | null; label: string; count?: number }> = anyLabel
    ? [{ value: null, label: anyLabel }, ...options]
    : options;
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger aria-label={label} className={triggerClassName}>
        {trigger}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={4} className="z-50">
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
  "inline-flex h-8 w-[150px] cursor-pointer items-center gap-2 rounded-lg border border-input bg-background px-2.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-input/32";

function SelectTrigger({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <>
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-start">{children}</span>
      <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
    </>
  );
}

function DropdownChip({
  icon: Icon,
  name,
  value,
  options,
  onChange,
  bare = false,
}: {
  icon: LucideIcon;
  name: string;
  value: string | null;
  options: ReadonlyArray<Option>;
  onChange: (value: string | null) => void;
  /** Shows just the name while nothing is picked ("Manufacturer" rather than "Manufacturer: Any"). */
  bare?: boolean;
}) {
  const picked = value === null ? null : (options.find((o) => o.value === value)?.label ?? value);
  const text = picked !== null ? `${name}: ${picked}` : bare ? name : `${name}: Any`;
  return (
    <Picker
      label={name}
      value={value}
      options={options}
      onChange={onChange}
      anyLabel="Any"
      triggerClassName={chipClass(value !== null)}
      trigger={
        <>
          <Icon />
          {text}
          <ChevronDown />
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
