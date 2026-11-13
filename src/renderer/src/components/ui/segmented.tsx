// Segmented toggle from docs/design/design-system.md (Components) and the
// mockups' `.seg`: an inset track on `bg-muted` with the selected segment
// raised on `bg-card`. Used for Day / Week, metric switches, Light / Dark.
import type { LucideIcon } from "lucide-react";
import { type KeyboardEvent, useRef } from "react";

import { cn } from "~/lib/utils";

export type SegmentedOption<T extends string> = {
  value: T;
  label: string;
  icon?: LucideIcon;
  disabled?: boolean;
};

type SegmentedProps<T extends string> = {
  value: T;
  onValueChange: (value: T) => void;
  options: ReadonlyArray<SegmentedOption<T>>;
  /** Names the group for screen readers ("Range"). */
  "aria-label": string;
  className?: string;
};

/** A radio group: arrow keys move and select, Tab leaves the group. */
function Segmented<T extends string>({ value, onValueChange, options, className, ...props }: SegmentedProps<T>) {
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
      className={cn("inline-flex shrink-0 rounded-[9px] border bg-muted p-0.5", className)}
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
            data-selected={selected || undefined}
            onClick={() => onValueChange(option.value)}
            className={cn(
              "inline-flex h-6 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[7px] px-2.5 text-muted-foreground text-xs outline-none transition-colors",
              "hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
              "data-selected:bg-card data-selected:font-medium data-selected:text-foreground data-selected:shadow-[0_1px_2px_rgb(0_0_0/25%),inset_0_0_0_1px_var(--color-border)]",
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

export { Segmented };
