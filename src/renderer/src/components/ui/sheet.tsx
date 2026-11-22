// The sheet from docs/ux/overview.md#sheets: a panel at the shared modal
// offset over a dimmed backdrop, laid out like the confirm dialog
// (design-system.md#sheet). A body on the page background with the title, its
// muted line, 20px, then the content; and, for a form, the footer band (top
// border, muted fill) with an optional action on the left and Cancel and the
// filled Save on the right: primary, or yellow (red) when a command it runs is
// `disruptive` (`destructive`), named by `saves`, as the confirm's button. Every sheet has the close X at the top
// right. A content sheet (Share Wi-Fi) passes no `onSave`; its footer holds
// one outline Close button.
// One of two named widths; the body scrolls when the sheet would pass the
// bottom of the window, header and footer stay in view.
//
// Save is disabled until something changed and the form is valid. Save runs
// the write (usually `useWrite(...).run(params, { form: true })`); the sheet
// closes when it resolves `{ ok: true }` and stays open otherwise, with
// `bad_params` messages under their fields (`fieldErrors` in useWrite.ts).
// Esc, Cancel and the X close it at once, unsaved changes or not (never a
// "Discard changes?" ask); a click on the backdrop does nothing.
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { type ReactNode, useState } from "react";

import { useCommands } from "~/app/useCommand";
import { Button } from "~/components/ui/button";
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from "~/components/ui/dialog";
import { cn } from "~/lib/utils";

type SheetSize = "default" | "wide";

const SIZE_CLASS: Record<SheetSize, string> = {
  default: "max-w-[540px]",
  wide: "max-w-[640px]",
};

type SheetProps = {
  open: boolean;
  /** Called when the sheet should close: after a save, or on Esc, Cancel or the X. */
  onClose: () => void;
  title: ReactNode;
  /** Muted line saying what it affects: "Mia · pauses all 4 devices automatically". */
  subtitle?: ReactNode;
  /** `default` 540px for every sheet; `wide` 640px when the content needs the room (the device icon picker). */
  size?: SheetSize;
  /** A form-level error (an eero error, or bad_params with no field). */
  error?: ReactNode;
  children: ReactNode;
  /**
   * Runs the write. Resolving to an execute result with `ok: true` closes the
   * sheet; anything else keeps it open. Without it the sheet is content only:
   * the footer holds just an outline Close.
   */
  onSave?: () => Promise<unknown>;
  /** Something changed since the sheet opened (Save stays disabled until then). */
  dirty?: boolean;
  /** The form is valid (client-side checks; the command's zod schema is the final word). */
  valid?: boolean;
  saveLabel?: ReactNode;
  /** The footer's Cancel, renamed when closing keeps something pending ("Later" on a code step). */
  cancelLabel?: ReactNode;
  /**
   * The command ids Save may run. Their effect colours Save as the confirm's
   * button does: yellow when one is `disruptive` (devices go offline), red
   * when one is `destructive`, the primary colour otherwise.
   */
  saves?: readonly string[];
  /** Footer left: a secondary or destructive action ("Delete schedule") that reveals its own confirm. */
  footerStart?: ReactNode;
};

/** Save's colour from the effects of the commands it runs, as the confirm's button: red, yellow, or the primary colour. */
export function saveVariantFor(effects: ReadonlyArray<string | undefined>): "destructive" | "warning" | "default" {
  if (effects.includes("destructive")) return "destructive";
  if (effects.includes("disruptive")) return "warning";
  return "default";
}

function Sheet({
  open,
  onClose,
  title,
  subtitle,
  size = "default",
  error,
  children,
  onSave,
  dirty = false,
  valid = true,
  saveLabel = "Save",
  cancelLabel = "Cancel",
  saves,
  footerStart,
}: SheetProps) {
  const commands = useCommands();
  const saveVariant = saveVariantFor((saves ?? []).map((id) => commands?.find((c) => c.id === id)?.effect));
  const [saving, setSaving] = useState(false);
  const requestClose = () => {
    if (!saving) onClose();
  };

  const save = async () => {
    if (!onSave) return;
    setSaving(true);
    const res = await onSave();
    setSaving(false);
    if (typeof res === "object" && res !== null && (res as { ok?: unknown }).ok === true) onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && requestClose()}>
      <DialogPopup className={cn("w-full bg-background", SIZE_CLASS[size])} data-slot="sheet">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            if (onSave && dirty && valid && !saving) void save();
          }}
        >
          <div className="flex shrink-0 flex-col gap-1 ps-5 pe-12 pt-5">
            <DialogTitle className="text-base">{title}</DialogTitle>
            {subtitle && <DialogDescription className="text-xs">{subtitle}</DialogDescription>}
          </div>

          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 pt-5 pb-[30px]">
            {children}
            {error && <div className="text-destructive-foreground text-xs">{error}</div>}
          </div>

          <div className="flex shrink-0 items-center gap-2 rounded-b-[17px] border-t bg-muted/72 px-5 py-4">
            {onSave ? (
              <>
                <div className="me-auto">{footerStart}</div>
                <DialogPrimitive.Close render={<Button type="button" size="sm" variant="outline" />} disabled={saving}>
                  {cancelLabel}
                </DialogPrimitive.Close>
                <Button type="submit" size="sm" variant={saveVariant} disabled={!dirty || !valid || saving}>
                  {saveLabel}
                </Button>
              </>
            ) : (
              <DialogPrimitive.Close render={<Button type="button" size="sm" variant="outline" className="ms-auto" />}>Close</DialogPrimitive.Close>
            )}
          </div>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

/**
 * A labelled field: label, the control, then the bad_params message or a live
 * helper. `aside` sits at the right end of the label's line, for a small
 * control that changes what the field takes (Transfer's Email or Text message).
 */
function SheetField({
  label,
  htmlFor,
  error,
  helper,
  aside,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  aside?: ReactNode;
  /** The command's bad_params message for this field. */
  error?: string;
  /** Live helper ("18 / 32"), hidden while there is an error. */
  helper?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {aside ? (
        <div className="flex items-center justify-between gap-2">
          <label htmlFor={htmlFor} className="font-medium text-xs">
            {label}
          </label>
          {aside}
        </div>
      ) : (
        <label htmlFor={htmlFor} className="font-medium text-xs">
          {label}
        </label>
      )}
      {children}
      {error ? (
        <div role="alert" className="text-destructive-foreground text-xs">
          {error}
        </div>
      ) : (
        helper && <div className="text-muted-foreground text-xs">{helper}</div>
      )}
    </div>
  );
}

export { Sheet, SheetField };
