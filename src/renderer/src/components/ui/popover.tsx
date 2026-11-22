/**
 * The shared popover (trimmed from T3 Code's `components/ui/popover.tsx`):
 * a floating surface anchored to its trigger. One surface class, a 4px
 * offset, `no-drag` (Electron drag hit-testing ignores z-index, so a popup
 * over the titlebar would swallow clicks) and a max height with the content
 * scrolling inside. See docs/design/design-system.md (Popovers).
 *
 * Every popover uses `PopoverPopup`, every menu `ui/menu.tsx`; both share
 * the surface, the list padding and the item and separator classes below.
 * Feature files never define their own popup surface.
 */
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";

import { cn } from "~/lib/utils";

/** The popover surface: card-like, 12px radius, 1px border, shadow. */
export const popoverSurface = "rounded-xl border bg-popover text-popover-foreground text-xs shadow-lg outline-none";

/** A list popup (menus, pickers, the Select list): 4px padding, at least 11rem wide, at most 20rem tall, scrolling inside. */
export const popoverList = "min-w-44 max-h-[min(20rem,var(--available-height))] overflow-y-auto p-1";

const itemBase =
  "flex min-h-7 w-full cursor-pointer select-none items-center gap-2 rounded-lg px-2.5 py-1.5 text-start outline-none data-disabled:cursor-not-allowed data-disabled:opacity-50 disabled:cursor-not-allowed disabled:opacity-50 [&>svg]:size-3.5 [&>svg]:shrink-0";

/** A row of a menu or listbox: 28px tall, lit while `data-highlighted` (set by Menu, Select, or the listbox's own keyboard code). */
export const popoverItem = cn(itemBase, "data-highlighted:bg-muted/60");

/** A plain `<button>` row in a popover, which has no `data-highlighted`: lit on hover and keyboard focus instead. */
export const popoverButtonItem = cn(itemBase, "hover:bg-muted/60 focus-visible:bg-muted/60");

/** A 1px rule between groups of rows. */
export const popoverSeparator = "-mx-1 my-1 h-px bg-border/60";

/** A muted heading row at the top of a list ("Pick who to schedule"). */
export const popoverLabel = "px-2.5 pt-1 pb-1.5 text-muted-foreground";

const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;

/**
 * `variant="panel"` (default) leaves padding to the content (a form, a
 * header and list, a confirm); `variant="list"` is a padded, scrolling list
 * of `popoverButtonItem` rows.
 */
function PopoverPopup({
  className,
  side = "bottom",
  align = "start",
  sideOffset = 4,
  variant = "panel",
  children,
  ...props
}: PopoverPrimitive.Popup.Props & {
  side?: PopoverPrimitive.Positioner.Props["side"];
  align?: PopoverPrimitive.Positioner.Props["align"];
  sideOffset?: PopoverPrimitive.Positioner.Props["sideOffset"];
  variant?: "panel" | "list";
}) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner side={side} align={align} sideOffset={sideOffset} className="z-50">
        <PopoverPrimitive.Popup
          className={cn(
            "no-drag flex max-h-(--available-height) max-w-(--available-width) flex-col overflow-y-auto",
            popoverSurface,
            variant === "list" && popoverList,
            className,
          )}
          data-slot="popover-popup"
          {...props}
        >
          {children}
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

const PopoverClose = PopoverPrimitive.Close;
const PopoverTitle = PopoverPrimitive.Title;
const PopoverDescription = PopoverPrimitive.Description;

export { Popover, PopoverClose, PopoverDescription, PopoverPopup, PopoverTitle, PopoverTrigger };
