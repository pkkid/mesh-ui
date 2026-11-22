// The edit sheet from docs/ux/overview.md#sheets (mockups: Appearance on 06,
// Edit schedule on 08): a panel at the shared modal offset over a dimmed
// backdrop, with a header (icon, title, what it affects), labelled fields
// 16 px apart, and a footer with an optional destructive action on the left
// and Cancel and Save on the right. One clean style: no rule under the header
// or above the footer, 30px of space instead, and one of two named widths
// (design-system.md#modals-and-popups). The body scrolls when the sheet would
// pass the bottom of the window; header and footer stay in view.
//
// Save is disabled until something changed and the form is valid. Save runs
// the write (usually `useWrite(...).run(params, { form: true })`); the sheet
// closes when it resolves `{ ok: true }` and stays open otherwise, with
// `bad_params` messages under their fields (`fieldErrors` in useWrite.ts).
// Esc, Cancel and the close button close it at once, unsaved changes or not
// (never a "Discard changes?" ask); a click on the backdrop does nothing.
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { type ReactNode, useState } from "react";

import { Button } from "~/components/ui/button";
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from "~/components/ui/dialog";
import { cn } from "~/lib/utils";

type SheetProps = {
  open: boolean;
  /** Called when the sheet should close: after a save, or on Esc, Cancel or the close button. */
  onClose: () => void;
  icon?: ReactNode;
  title: ReactNode;
  /** Muted line saying what it affects: "Mia · pauses all 4 devices automatically". */
  subtitle?: ReactNode;
  /** Something changed since the sheet opened. */
  dirty: boolean;
  /** The form is valid (client-side checks; the command's zod schema is the final word). */
  valid?: boolean;
  /** Runs the write. Resolving to an execute result with `ok: true` closes the sheet. */
  onSave: () => Promise<unknown>;
  saveLabel?: ReactNode;
  /** Footer left: a destructive action ("Delete schedule") that reveals its own confirm. */
  footerStart?: ReactNode;
  /** A form-level error (an eero error, or bad_params with no field). */
  error?: ReactNode;
  children: ReactNode;
  /** `default` 540px for every sheet; `wide` 640px when the content needs the room (the device icon picker). */
  size?: SheetSize;
};

type SheetSize = "default" | "wide";

const SIZE_CLASS: Record<SheetSize, string> = {
  default: "max-w-[540px]",
  wide: "max-w-[640px]",
};

function Sheet({
  open,
  onClose,
  icon,
  title,
  subtitle,
  dirty,
  valid = true,
  onSave,
  saveLabel = "Save",
  footerStart,
  error,
  children,
  size = "default",
}: SheetProps) {
  const [saving, setSaving] = useState(false);
  const requestClose = () => {
    if (!saving) onClose();
  };

  const save = async () => {
    setSaving(true);
    const res = await onSave();
    setSaving(false);
    if (typeof res === "object" && res !== null && (res as { ok?: unknown }).ok === true) onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && requestClose()}>
      <DialogPopup
        showCloseButton={false}
        className={cn("w-full", SIZE_CLASS[size])}
        data-slot="sheet"
      >
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            if (dirty && valid && !saving) void save();
          }}
        >
          <div className="flex shrink-0 items-start gap-3 px-5 pt-5">
            {icon && (
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted text-muted-foreground [&_svg]:size-4">
                {icon}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-base">{title}</DialogTitle>
              {subtitle && <DialogDescription className="text-xs">{subtitle}</DialogDescription>}
            </div>
          </div>

          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 py-[30px]">
            {children}
            {error && <div className="text-destructive-foreground text-xs">{error}</div>}
          </div>

          <div className="flex shrink-0 items-center gap-2 px-5 pb-4">
            <div className="me-auto">{footerStart}</div>
            <DialogPrimitive.Close render={<Button type="button" size="sm" variant="ghost" />} disabled={saving}>
              Cancel
            </DialogPrimitive.Close>
            <Button type="submit" size="sm" disabled={!dirty || !valid || saving}>
              {saveLabel}
            </Button>
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
