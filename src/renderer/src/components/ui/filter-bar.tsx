/**
 * The filter bar for list pages (docs/design/design-system.md#filter-bar):
 * a bare toolbar (no card) with search and a Filters popover on the left and
 * dropdown triggers (Group by, Sort, Range) on the right, and the filters
 * that are set as removable chips under it with Clear all. Devices and
 * Activity both build their bars from these pieces.
 */
import { Popover } from "@base-ui/react/popover";
import { Check, ChevronDown, ListFilter, type LucideIcon, Search, X } from "lucide-react";
import { type ComponentProps, type ReactNode, type RefObject, useEffect, useState } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { cn } from "~/lib/utils";

export type FilterOption = { value: string; label: string; count?: number };

/** A filter that is set, shown as a chip under the toolbar. */
export type FilterChip = { key: string; text: string; onRemove: () => void };

/** Pickers with more rows than this get a type-ahead field at the top. */
const SEARCH_THRESHOLD = 10;

/** The toolbar row plus the chip row. Put right-hand controls in `FilterBarEnd`. */
export function FilterBar({ chips, onClearAll, children }: { chips: ReadonlyArray<FilterChip>; onClearAll: () => void; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Active filters">
          {chips.map((c) => (
            <span key={c.key} className="inline-flex h-6 items-center gap-1 rounded-full border bg-card ps-2.5 pe-1 text-foreground/80 text-xs">
              {c.text}
              <button
                type="button"
                aria-label={`Remove filter: ${c.text}`}
                onClick={c.onRemove}
                className="grid size-4 cursor-pointer place-items-center rounded-full text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
          <Button variant="ghost-muted" size="xs" onClick={onClearAll}>
            Clear all
          </Button>
        </div>
      )}
    </div>
  );
}

/** The right-hand group of the toolbar. */
export function FilterBarEnd({ children }: { children: ReactNode }) {
  return <div className="ms-auto flex items-center gap-1.5">{children}</div>;
}

/** The toolbar search field, with the `/` shortcut hint (wire the key with `useSlashFocus`). Esc clears it. */
export function FilterSearch({
  inputRef,
  value,
  onValueChange,
  ...props
}: { inputRef?: RefObject<HTMLInputElement | null>; value: string; onValueChange: (text: string) => void } & Omit<
  ComponentProps<"input">,
  "value" | "onChange" | "ref"
>) {
  return (
    <div className="relative min-w-36 max-w-[300px] flex-1 basis-36">
      <Input
        ref={inputRef}
        type="search"
        icon={<Search />}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onValueChange("");
        }}
        // 32px outside like every toolbar control: the field's 1px border sits around the input.
        className="pe-7 text-[13px] [&_input]:h-[30px]"
        {...props}
      />
      <kbd className="pointer-events-none absolute end-2 top-1/2 -translate-y-1/2 rounded-[5px] border px-1.5 font-mono text-2xs text-muted-foreground">
        /
      </kbd>
    </div>
  );
}

/** `/` anywhere on the page (outside a text field) focuses the search field. */
export function useSlashFocus(ref: RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))) return;
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      ref.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ref]);
}

/** The Filters button and its popover; the badge counts the popover filters that are set. */
export function FiltersButton({ active, onClear, children }: { active: number; onClear: () => void; children: ReactNode }) {
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

/** A labelled row inside the Filters popover. */
export function FilterRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[84px_1fr] items-center gap-2">
      <span className="text-muted-foreground">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** A neutral on/off pill inside the Filters popover. */
export function FilterToggle({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: ReactNode }) {
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

export const popupClass =
  "no-drag max-h-80 min-w-44 overflow-y-auto rounded-xl border bg-popover p-1 text-popover-foreground text-xs shadow-lg outline-none";
export const itemClass =
  "flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-start outline-none hover:bg-muted/60 focus-visible:bg-muted/60";

/**
 * A popover list of options with a check on the current one. Long lists get
 * a type-ahead field; Enter picks the first match.
 */
export function Picker({
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
  options: ReadonlyArray<FilterOption>;
  onChange: (value: string | null) => void;
  /** Classes and content of the trigger button. */
  triggerClassName: string;
  trigger: ReactNode;
  /** Adds a first row that clears the value. */
  anyLabel?: string;
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchable = options.length > SEARCH_THRESHOLD;
  const q = query.trim().toLowerCase();
  const matches = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  const rows: ReadonlyArray<{ value: string | null; label: string; count?: number }> = anyLabel && !q ? [{ value: null, label: anyLabel }, ...matches] : matches;
  const pick = (v: string | null) => {
    setOpen(false);
    onChange(v);
  };
  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setQuery("");
      }}
    >
      <Popover.Trigger aria-label={label} title={label} className={triggerClassName}>
        {trigger}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align={align} sideOffset={4} className="z-50">
          <Popover.Popup className={cn(popupClass, searchable && "w-64")}>
            {searchable && (
              <div className="sticky -top-1 z-10 -mx-1 -mt-1 bg-popover p-1">
              <input
                type="search"
                autoFocus
                aria-label={`Find ${label.toLowerCase()}`}
                placeholder="Type to find"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  const first = matches[0];
                  if (e.key === "Enter" && q && first) {
                    e.preventDefault();
                    pick(first.value);
                  }
                }}
                className="h-7 w-full rounded-lg border border-input bg-background px-2.5 text-xs outline-none placeholder:text-placeholder focus-visible:ring-2 focus-visible:ring-ring dark:bg-input/32 [&::-webkit-search-cancel-button]:appearance-none"
              />
              </div>
            )}
            <div role="listbox" aria-label={label}>
              {rows.length === 0 && <div className="px-2.5 py-1.5 text-muted-foreground">{q ? "No matches" : "Nothing to pick yet"}</div>}
              {rows.map((o) => (
                <button
                  key={o.value ?? ""}
                  type="button"
                  role="option"
                  aria-selected={o.value === value}
                  className={itemClass}
                  onClick={() => pick(o.value)}
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

/** A full-width select inside the Filters popover, with an "Any" row. */
export function SelectPicker({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: string | null;
  options: ReadonlyArray<FilterOption>;
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

/** Toolbar dropdown triggers (Group by, Sort, Range): sized to their value, 32px, the name in the tooltip. */
const dropdownClass =
  "inline-flex h-8 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg border border-input bg-background px-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-input/32";

/** A toolbar dropdown: icon, the current value and a chevron, opening a `Picker`. */
export function FilterDropdown({
  label,
  icon: Icon,
  value,
  options,
  onChange,
  anyLabel,
  align = "end",
}: {
  label: string;
  icon: LucideIcon;
  value: string | null;
  options: ReadonlyArray<FilterOption>;
  onChange: (value: string | null) => void;
  /** A first row that clears the value, also shown on the trigger while nothing is picked. */
  anyLabel?: string;
  align?: "start" | "end";
}) {
  const shown = value === null ? (anyLabel ?? "") : (options.find((o) => o.value === value)?.label ?? value);
  return (
    <Picker
      label={label}
      value={value}
      options={options}
      onChange={onChange}
      anyLabel={anyLabel}
      align={align}
      triggerClassName={dropdownClass}
      trigger={
        <>
          <Icon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-start">{shown}</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </>
      }
    />
  );
}
