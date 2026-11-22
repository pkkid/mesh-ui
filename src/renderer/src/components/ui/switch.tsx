/**
 * The app's one on/off switch, ported from T3 Code's `ui/switch.tsx` (Base
 * UI `Switch`) and trimmed to Mesh UI's spec (design-system.md, Switch):
 * 36 x 20, a 16px knob, `bg-primary` when on, `bg-muted` with a border when
 * off. `checked` null or undefined means eero does not report the value: a
 * dashed track that cannot be used. Disabled dims to 64% and shows `title`
 * (the gate's reason) as the tooltip. Every switch in the app is this one;
 * `switch.test.ts` fails on a hand-made `role="switch"`.
 */
import { Switch as SwitchPrimitive } from "@base-ui/react/switch";

import { cn } from "~/lib/utils";

export const UNKNOWN_SWITCH_TITLE = "eero does not report this setting";

export function Switch({
  checked,
  onCheckedChange,
  disabled = false,
  title,
  className,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
}: {
  checked: boolean | null | undefined;
  onCheckedChange: (next: boolean) => void;
  disabled?: boolean;
  /** Tooltip, usually why the switch is disabled. */
  title?: string | null;
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}) {
  const known = checked === true || checked === false;
  return (
    <SwitchPrimitive.Root
      checked={checked === true}
      onCheckedChange={(next) => onCheckedChange(next)}
      disabled={disabled || !known}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      title={!known ? UNKNOWN_SWITCH_TITLE : (title ?? undefined)}
      data-slot="switch"
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        "data-checked:border-transparent data-checked:bg-primary data-unchecked:bg-muted data-disabled:cursor-not-allowed",
        known ? "data-disabled:opacity-64" : "border-dashed",
        className,
      )}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block size-4 translate-x-0.5 rounded-full bg-background shadow-sm [transition:translate_.15s,scale_.1s_.1s]",
          "origin-left data-checked:origin-right data-checked:translate-x-4",
          // The small squash while pressed, as in T3 Code.
          "in-[[role=switch]:active]:not-data-disabled:scale-x-110",
        )}
      />
    </SwitchPrimitive.Root>
  );
}
