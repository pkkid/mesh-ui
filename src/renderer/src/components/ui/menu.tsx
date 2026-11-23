/**
 * The shared menu (trimmed from T3 Code's `components/ui/menu.tsx`): a list
 * of actions anchored to its trigger, on the popover surface with the
 * popover item and separator classes, so menus and popovers look the same.
 * Opens 4px from its trigger, is `no-drag` (it can open over the titlebar)
 * and scrolls inside past 20rem. See docs/design/design-system.md (Popovers
 * and menus).
 */
import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { ChevronRight } from "lucide-react";

import { cn } from "~/lib/utils";

import { popoverItem, popoverList, popoverSeparator, popoverSurface } from "./popover";

const Menu = MenuPrimitive.Root;
const MenuTrigger = MenuPrimitive.Trigger;
const MenuSub = MenuPrimitive.SubmenuRoot;

function MenuPopup({
  className,
  side = "bottom",
  align = "start",
  sideOffset = 4,
  children,
  ...props
}: MenuPrimitive.Popup.Props & {
  side?: MenuPrimitive.Positioner.Props["side"];
  align?: MenuPrimitive.Positioner.Props["align"];
  sideOffset?: MenuPrimitive.Positioner.Props["sideOffset"];
}) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner side={side} align={align} sideOffset={sideOffset} className="z-50">
        <MenuPrimitive.Popup className={cn("no-drag max-w-(--available-width)", popoverSurface, popoverList, className)} data-slot="menu-popup" {...props}>
          {children}
        </MenuPrimitive.Popup>
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

/** Menu icons are dim like an outline button's; a destructive row's icon is red with its label. An icon with its own `text-*` class keeps it. */
const menuIcon = "[&>svg:not([class*='text-'])]:text-muted-foreground";

function MenuItem({ className, variant = "default", ...props }: MenuPrimitive.Item.Props & { variant?: "default" | "destructive" }) {
  return (
    <MenuPrimitive.Item
      className={cn(popoverItem, variant === "destructive" ? "text-destructive-foreground [&>svg:not([class*='text-'])]:text-current" : menuIcon, className)}
      data-slot="menu-item"
      data-variant={variant}
      {...props}
    />
  );
}

function MenuSeparator({ className, ...props }: MenuPrimitive.Separator.Props) {
  return <MenuPrimitive.Separator className={cn(popoverSeparator, className)} data-slot="menu-separator" {...props} />;
}

/** A row that opens a submenu; the chevron is added. */
function MenuSubTrigger({ className, children, ...props }: MenuPrimitive.SubmenuTrigger.Props) {
  return (
    <MenuPrimitive.SubmenuTrigger className={cn(popoverItem, menuIcon, "data-popup-open:bg-muted/60", className)} data-slot="menu-sub-trigger" {...props}>
      {children}
      <ChevronRight className="ms-auto text-muted-foreground" />
    </MenuPrimitive.SubmenuTrigger>
  );
}

/** A submenu's popup: beside its row (inline end by default), aligned to the row's top. */
function MenuSubPopup({ side = "inline-end", ...props }: Parameters<typeof MenuPopup>[0]) {
  return <MenuPopup side={side} align="start" {...props} />;
}

export { Menu, MenuItem, MenuPopup, MenuSeparator, MenuSub, MenuSubPopup, MenuSubTrigger, MenuTrigger };
