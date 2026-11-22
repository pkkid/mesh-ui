// Segmented toggle from docs/design/design-system.md (Components) and the
// mockups' `.seg`: a track on `bg-muted` with the selected segment on
// `bg-card` in the foreground colour. No borders, outlines or shadows on the
// track or the segment: only the fill and the text colour change
// (design-system.md, Pills). Used for Light / Dark, Simple / Advanced.
import type { LucideIcon } from "lucide-react";
import { createContext, type KeyboardEvent, use, useRef } from "react";

import { cn } from "~/lib/utils";

export type SegmentedOption<T extends string> = {
  value: T;
  label: string;
  icon?: LucideIcon;
  /** Tooltip, e.g. the full name behind a short label. */
  title?: string;
  disabled?: boolean;
};

/**
 * Heights (3px padding around the items, no border): `tool` 28px (22px items)
 * in a section header, level with the 28px buttons there; `sm` 30px (24px
 * items, the default) in forms and settings; `md` 32px (26px items) in
 * toolbars beside `h-8` inputs, buttons and selects. `Section` sets `tool`
 * for its tools slot through `SegmentedSizeContext`, so call sites there
 * leave `size` off.
 */
export type SegmentedSize = "tool" | "sm" | "md";

const ITEM_HEIGHT: Record<SegmentedSize, string> = { tool: "h-[22px]", sm: "h-6", md: "h-[26px]" };

const SegmentedSizeContext = createContext<SegmentedSize>("sm");

type SegmentedProps<T extends string> = {
  value: T;
  onValueChange: (value: T) => void;
  options: ReadonlyArray<SegmentedOption<T>>;
  /** Names the group for screen readers ("Range"). */
  "aria-label": string;
  size?: SegmentedSize;
  className?: string;
};

/** A radio group: arrow keys move and select, Tab leaves the group. */
function Segmented<T extends string>({ value, onValueChange, options, size: sizeProp, className, ...props }: SegmentedProps<T>) {
  const size = sizeProp ?? use(SegmentedSizeContext);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = options.filter((o) => !o.disabled);

  const onKeyDown = (e: KeyboardEvent) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step || enabled.length === 0) return;
    e.preventDefault();
    const at = enabled.findIndex((o) => o.value === value);
    const next = enabled[(at + step + enabled.length) % enabled.length];
    if (!next) return;
    onValueChange(next.value);
    refs.current[options.indexOf(next)]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={props["aria-label"]}
      data-slot="segmented"
      onKeyDown={onKeyDown}
      className={cn("inline-flex shrink-0 rounded-[9px] bg-muted p-[3px]", className)}
    >
      {options.map((option, i) => {
        const selected = option.value === value;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            disabled={option.disabled}
            title={option.title}
            data-selected={selected || undefined}
            onClick={() => onValueChange(option.value)}
            className={cn(
              "inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[7px] px-2.5 text-muted-foreground text-xs outline-none transition-colors",
              ITEM_HEIGHT[size],
              "hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
              "data-selected:bg-card data-selected:font-medium data-selected:text-foreground",
            )}
          >
            {Icon && <Icon className="size-3.5" />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export { Segmented, SegmentedSizeContext };
