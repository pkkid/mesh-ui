/**
 * The app's one checkbox, ported from T3 Code's `ui/checkbox.tsx` (Base UI
 * `Checkbox`) and trimmed to Mesh UI's spec (design-system.md, Checkbox):
 * a 16px box with a 4px radius, `border-input` on `bg-background` when off,
 * `bg-primary` with a lucide `Check` when on (the switch's "on" color), and a
 * `Minus` on the same fill when `indeterminate`. Disabled dims to 64%.
 * `onCheckedChange` also says whether Shift was held (click or Shift+Space),
 * so a table can select a range. Every checkbox in the app is this one;
 * `checkbox.test.ts` fails on a native `type="checkbox"`.
 */
import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { Check, Minus } from "lucide-react";
import { useRef } from "react";

import { cn } from "~/lib/utils";

export function Checkbox({
  checked,
  indeterminate = false,
  onCheckedChange,
  disabled = false,
  id,
  title,
  className,
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  /** The mixed state: some, not all, of a set is picked. Draws a minus. */
  indeterminate?: boolean;
  /** `shiftKey`: Shift was held for the click or key press, as for a range select. */
  onCheckedChange?: (next: boolean, info: { shiftKey: boolean }) => void;
  disabled?: boolean;
  /** The id of the hidden input, for a `<label htmlFor>`. */
  id?: string;
  title?: string;
  className?: string;
  "aria-label"?: string;
}) {
  const shift = useRef(false);
  return (
    <CheckboxPrimitive.Root
      checked={checked}
      indeterminate={indeterminate}
      onPointerDown={(e) => {
        shift.current = e.shiftKey;
      }}
      onKeyDown={(e) => {
        shift.current = e.shiftKey;
      }}
      onCheckedChange={(next) => {
        onCheckedChange?.(next, { shiftKey: shift.current });
        shift.current = false;
      }}
      disabled={disabled}
      id={id}
      title={title}
      aria-label={ariaLabel}
      data-slot="checkbox"
      className={cn(
        "relative inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-[4px] border border-input bg-background outline-none transition-colors",
        "not-data-disabled:hover:border-ring/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        "data-checked:border-transparent data-indeterminate:border-transparent",
        "data-disabled:cursor-not-allowed data-disabled:opacity-64",
        className,
      )}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="-inset-px absolute flex items-center justify-center rounded-[4px] bg-primary text-primary-foreground data-unchecked:not-data-indeterminate:hidden"
        render={(props, state) => (
          <span {...props}>{state.indeterminate ? <Minus className="size-3" strokeWidth={3} /> : <Check className="size-3" strokeWidth={3} />}</span>
        )}
      />
    </CheckboxPrimitive.Root>
  );
}
