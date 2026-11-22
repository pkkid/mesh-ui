/**
 * The shared popover (trimmed from T3 Code's `components/ui/popover.tsx`):
 * a floating surface anchored to its trigger. One surface class, a 4px
 * offset, `no-drag` (Electron drag hit-testing ignores z-index, so a popup
 * over the titlebar would swallow clicks) and a max height with the content
 * scrolling inside. See docs/design/design-system.md (Popovers).
 *
 * New popovers use this; older hand-built ones move onto it with #346.
 */
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";

import { cn } from "~/lib/utils";

/** The popover surface: card-like, 12px radius, 1px border, shadow. */
export const popoverSurface = "rounded-xl border bg-popover text-popover-foreground text-xs shadow-lg outline-none";

const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;

function PopoverPopup({
  className,
  side = "bottom",
  align = "start",
  sideOffset = 4,
  children,
  ...props
}: PopoverPrimitive.Popup.Props & {
  side?: PopoverPrimitive.Positioner.Props["side"];
  align?: PopoverPrimitive.Positioner.Props["align"];
  sideOffset?: PopoverPrimitive.Positioner.Props["sideOffset"];
}) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner side={side} align={align} sideOffset={sideOffset} className="z-50">
        <PopoverPrimitive.Popup
          className={cn("no-drag flex max-h-(--available-height) max-w-(--available-width) flex-col overflow-hidden", popoverSurface, className)}
          data-slot="popover-popup"
          {...props}
        >
          {children}
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverPopup, PopoverTrigger };
