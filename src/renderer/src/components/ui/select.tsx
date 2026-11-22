// A styled dropdown select, ported from T3 Code's
// apps/web/src/components/ui/select.tsx and trimmed to what we use. The
// popup takes the shared popover surface, list padding and item class
// (ui/popover.tsx), so it matches every menu. Pass `items` to <Select> so <SelectValue> shows the
// label, not the raw value.
import { Select as SelectPrimitive } from "@base-ui/react/select";
import { cva, type VariantProps } from "class-variance-authority";
import { ChevronDownIcon } from "lucide-react";

import { cn } from "~/lib/utils";

import { popoverItem, popoverList, popoverSurface } from "./popover";

const Select = SelectPrimitive.Root;

const selectTriggerVariants = cva(
  "no-drag relative inline-flex cursor-pointer select-none items-center justify-between gap-1.5 border border-input bg-background text-left text-foreground outline-none transition-[color,box-shadow,background-color] hover:bg-muted/60 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/24 data-disabled:pointer-events-none data-disabled:opacity-64 dark:bg-input/32 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    defaultVariants: { size: "default" },
    variants: {
      size: {
        /** 28px, level with the buttons in a section header. */
        tool: "h-7 rounded-md px-2.5 text-xs",
        default: "h-8 rounded-lg px-3 text-sm",
      },
    },
  },
);

function SelectTrigger({
  className,
  size,
  children,
  ...props
}: SelectPrimitive.Trigger.Props & VariantProps<typeof selectTriggerVariants>) {
  return (
    <SelectPrimitive.Trigger className={cn(selectTriggerVariants({ size }), className)} data-slot="select-trigger" {...props}>
      {children}
      <SelectPrimitive.Icon data-slot="select-icon">
        <ChevronDownIcon className="-me-0.5 size-3.5 text-muted-foreground" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectValue({ className, ...props }: SelectPrimitive.Value.Props) {
  return <SelectPrimitive.Value className={cn("flex-1 truncate data-placeholder:text-placeholder", className)} data-slot="select-value" {...props} />;
}

function SelectPopup({
  className,
  children,
  align = "end",
  sideOffset = 4,
  ...props
}: SelectPrimitive.Popup.Props & {
  align?: SelectPrimitive.Positioner.Props["align"];
  sideOffset?: SelectPrimitive.Positioner.Props["sideOffset"];
}) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner align={align} alignItemWithTrigger={false} className="z-50 select-none" side="bottom" sideOffset={sideOffset}>
        <SelectPrimitive.Popup
          // Electron drag hit-testing ignores z-index; items over a drag region would swallow clicks.
          className="no-drag origin-(--transform-origin) outline-none"
          data-slot="select-popup"
          {...props}
        >
          <SelectPrimitive.List
            className={cn(
              popoverSurface,
              popoverList,
              "min-w-(--anchor-width)",
              className,
            )}
            data-slot="select-list"
          >
            {children}
          </SelectPrimitive.List>
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  );
}

function SelectItem({ className, children, ...props }: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      className={cn(
        popoverItem,
        "whitespace-nowrap data-selected:font-medium",
        className,
      )}
      data-slot="select-item"
      {...props}
    >
      <SelectPrimitive.ItemText className="min-w-0 flex-1" data-slot="select-item-text">
        {children}
      </SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

export { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue };
