// Adapted from T3 Code's components/ui/dialog.tsx and dialog-styles.ts (MIT).
// Trimmed to what Mesh UI uses: a modal popup over a dimmed backdrop, with a
// title, description and close. Base UI handles focus trapping, Esc and
// clicks on the backdrop.
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { XIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

const BACKDROP_CLASS =
  "fixed inset-0 z-50 bg-background/60 backdrop-blur-[2px] transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 dark:bg-background/64";

const POPUP_CLASS =
  "no-drag relative flex min-h-0 w-full min-w-0 flex-col rounded-2xl border bg-popover text-popover-foreground shadow-[0_24px_64px_-24px_rgb(0_0_0/65%)] outline-none transition-[scale,opacity] duration-150 data-ending-style:scale-98 data-ending-style:opacity-0 data-starting-style:scale-98 data-starting-style:opacity-0";

const Dialog = DialogPrimitive.Root;

function DialogClose(props: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

/**
 * The dialog box with its backdrop. `align="top"` pins it near the top of the
 * window (palettes, search) instead of centring it.
 */
function DialogPopup({
  className,
  children,
  showCloseButton = true,
  align = "center",
  ...props
}: DialogPrimitive.Popup.Props & { showCloseButton?: boolean; align?: "center" | "top" }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop forceRender className={BACKDROP_CLASS} data-slot="dialog-backdrop" />
      <DialogPrimitive.Viewport
        className={cn(
          "fixed inset-0 z-50 grid justify-items-center p-4",
          align === "center" ? "grid-rows-[1fr_auto_1fr]" : "grid-rows-[auto_1fr] pt-10",
        )}
        data-slot="dialog-viewport"
      >
        <DialogPrimitive.Popup
          className={cn(POPUP_CLASS, align === "center" ? "row-start-2 max-h-full max-w-lg" : "row-start-1", className)}
          data-slot="dialog-popup"
          {...props}
        >
          {children}
          {showCloseButton && (
            <DialogPrimitive.Close
              aria-label="Close"
              className="absolute end-2 top-2"
              render={<Button size="icon" variant="ghost" />}
            >
              <XIcon />
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Viewport>
    </DialogPrimitive.Portal>
  );
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      className={cn("font-semibold text-lg leading-snug", className)}
      data-slot="dialog-title"
      {...props}
    />
  );
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      className={cn("text-muted-foreground text-sm", className)}
      data-slot="dialog-description"
      {...props}
    />
  );
}

export { Dialog, DialogClose, DialogDescription, DialogPopup, DialogTitle };
