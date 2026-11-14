// The edit sheet from docs/ux/overview.md#sheets (mockups: Appearance on 06,
// Edit schedule on 08): a panel near the top of the window over a dimmed
// backdrop, with a header (icon, title, what it affects, close), labelled
// fields 16 px apart, and a footer with an optional destructive action on the
// left and Cancel and Save on the right.
//
// Save is disabled until something changed and the form is valid. Save runs
// the write (usually `useWrite(...).run(params, { form: true })`); the sheet
// closes when it resolves `{ ok: true }` and stays open otherwise, with
// `bad_params` messages under their fields (`fieldErrors` in useWrite.ts).
// Esc, the backdrop and the close button cancel; with unsaved changes the
// footer asks "Discard changes?" first.
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { XIcon } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { Button } from "~/components/ui/button";
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from "~/components/ui/dialog";
import { cn } from "~/lib/utils";

type SheetProps = {
  open: boolean;
  /** Called when the sheet should close: after a save, or a cancel the person confirmed. */
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
  className?: string;
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
  className,
}: SheetProps) {
  const [saving, setSaving] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  useEffect(() => {
    if (!open) setDiscarding(false);
  }, [open]);

  const requestClose = () => {
    if (saving) return;
    if (dirty) setDiscarding(true);
    else onClose();
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
        align="top"
        showCloseButton={false}
        className={cn("w-full max-w-[540px] rounded-[18px]", className)}
        data-slot="sheet"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (dirty && valid && !saving) void save();
          }}
        >
          <div className="flex items-start gap-3 border-b px-5 py-4">
            {icon && (
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted text-muted-foreground [&_svg]:size-4">
                {icon}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-base">{title}</DialogTitle>
              {subtitle && <DialogDescription className="text-xs">{subtitle}</DialogDescription>}
            </div>
            <Button type="button" size="icon-sm" variant="ghost-muted" aria-label="Close" onClick={requestClose}>
              <XIcon />
            </Button>
          </div>

          <div className="flex flex-col gap-4 px-5 py-4">{children}</div>
          {error && <div className="px-5 pb-3 text-destructive-foreground text-xs">{error}</div>}

          <div className="flex items-center gap-2 border-t px-5 py-3">
            {discarding ? (
              <>
                <span className="me-auto text-foreground/80 text-xs">Discard changes?</span>
                <Button type="button" size="sm" variant="ghost" autoFocus onClick={() => setDiscarding(false)}>
                  Keep editing
                </Button>
                <Button type="button" size="sm" variant="destructive" onClick={onClose}>
                  Discard
                </Button>
              </>
            ) : (
              <>
                <div className="me-auto">{footerStart}</div>
                <DialogPrimitive.Close render={<Button type="button" size="sm" variant="ghost" />} disabled={saving}>
                  Cancel
                </DialogPrimitive.Close>
                <Button type="submit" size="sm" disabled={!dirty || !valid || saving}>
                  {saveLabel}
                </Button>
              </>
            )}
          </div>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

/** A labelled field: label, the control, then the bad_params message or a live helper. */
function SheetField({
  label,
  htmlFor,
  error,
  helper,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  /** The command's bad_params message for this field. */
  error?: string;
  /** Live helper ("18 / 32"), hidden while there is an error. */
  helper?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="font-medium text-xs">
        {label}
      </label>
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
