// Adapted from T3 Code's components/ui/dialog.tsx and dialog-styles.ts (MIT).
// Trimmed to what Mesh UI uses: a modal popup over a dimmed backdrop, with a
// title, description and close. Base UI handles focus trapping and Esc. A
// click on the backdrop never closes a modal: Esc and Cancel do
// (docs/design/design-system.md#behaviour).
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { XIcon } from "lucide-react";

import { Button, ButtonSizeContext } from "~/components/ui/button";
import { SegmentedSizeContext } from "~/components/ui/segmented";
import { cn } from "~/lib/utils";

const BACKDROP_CLASS =
  "fixed inset-0 z-50 bg-background/60 backdrop-blur-[2px] transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 dark:bg-background/64";

const POPUP_CLASS =
  "no-drag relative flex min-h-0 w-full min-w-0 flex-col rounded-[18px] border bg-popover text-popover-foreground shadow-[0_24px_64px_-24px_rgb(0_0_0/65%)] outline-none transition-[scale,opacity] duration-150 data-ending-style:scale-98 data-ending-style:opacity-0 data-starting-style:scale-98 data-starting-style:opacity-0";

/** A modal root that ignores clicks on the backdrop; Esc and Cancel close it. */
function Dialog(props: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root disablePointerDismissal {...props} />;
}

function DialogClose(props: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

/**
 * The dialog box with its backdrop. Every confirm and sheet opens with its top
 * edge at `--dialog-top` (clear of the titlebar, `index.css`) and grows
 * downward, so it never re-centres and a nested confirm opens at the same
 * height as its sheet. `placement="palette"` is the command palette's own,
 * higher position, the one documented exception. A box taller than the
 * window stops `--dialog-bottom` (60px) above the bottom edge and scrolls inside
 * (docs/design/design-system.md#modals-and-popups).
 */
function DialogPopup({
  className,
  children,
  showCloseButton = true,
  placement = "standard",
  ...props
}: DialogPrimitive.Popup.Props & { showCloseButton?: boolean; placement?: "standard" | "palette" }) {
  // Reset the control sizes: a dialog opened from a page or section header keeps its own sizes.
  return (
    <ButtonSizeContext value={undefined}>
      <SegmentedSizeContext value="sm">
        <DialogPrimitive.Portal>
          <DialogPrimitive.Backdrop forceRender className={BACKDROP_CLASS} data-slot="dialog-backdrop" />
          <DialogPrimitive.Viewport
            className={cn(
              "fixed inset-0 z-50 flex flex-col items-center p-4 pb-(--dialog-bottom)",
              placement === "standard" ? "pt-(--dialog-top)" : "pt-10",
            )}
            data-slot="dialog-viewport"
          >
            <DialogPrimitive.Popup
              className={cn(POPUP_CLASS, "max-h-full", placement === "standard" && "max-w-lg", className)}
              data-slot="dialog-popup"
              {...props}
            >
              {children}
              {showCloseButton && (
                <DialogPrimitive.Close
                  aria-label="Close"
                  className="absolute end-2 top-2"
                  render={<Button size="icon" variant="ghost-muted" />}
                >
                  <XIcon />
                </DialogPrimitive.Close>
              )}
            </DialogPrimitive.Popup>
          </DialogPrimitive.Viewport>
        </DialogPrimitive.Portal>
      </SegmentedSizeContext>
    </ButtonSizeContext>
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
