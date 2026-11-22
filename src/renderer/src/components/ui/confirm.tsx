// The confirm from docs/ux/overview.md#confirmations: every disruptive or
// destructive action (and the few writes the UI confirms on its own) asks in
// a modal naming the target and the consequence, with a filled danger
// button that repeats the action and Cancel. Focus starts on Cancel; Esc
// cancels too, so there is no close X, and a backdrop click does nothing
// (docs/design/design-system.md#modals-and-popups). After the person confirms, the write kit runs
// the command with `confirm: true` (disruptive and destructive) or without it.
//
// Pages rarely build these by hand (app/useWrite.ts):
// - `ConfirmHost`, mounted once by App.tsx, shows `ConfirmDialog` for every
//   `useWrite` and `performWrite` confirm, with the engine's needs_confirm
//   message and type-to-confirm for destructive actions on a named thing.
// - `WriteConfirmDialog` nests the same dialog inside another dialog (the
//   palette, a sheet) for a `useWrite(id, { confirmIn: "nested" })` write.
import { useEffect, useId, useRef, useState } from "react";

import { answerDialog, type ConfirmAsk, useDialogAsk, type WriteState } from "~/app/useWrite";
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from "~/components/ui/dialog";
import { cn } from "~/lib/utils";
import { Button } from "./button";

function TypeToConfirm({
  id,
  name,
  value,
  onChange,
  className,
}: {
  id: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className="sr-only">
        Type {name} to confirm
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`Type "${name}" to confirm`}
        autoComplete="off"
        spellCheck={false}
        className="h-[30px] w-full rounded-[var(--control-radius)] border border-input bg-card px-2.5 text-[13px] outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring"
      />
    </div>
  );
}

type ConfirmDialogProps = {
  /** The confirm to show, or null when closed. */
  ask: (Pick<ConfirmAsk, "title" | "message" | "confirmLabel" | "typeToConfirm" | "offline"> & Partial<Pick<ConfirmAsk, "effect">>) | null;
  onAnswer: (ok: boolean) => void;
};

/**
 * The confirm dialog, laid out as T3 Code's: a body on the page background with
 * a title naming the target, 20px, and the consequence, 30px; then a footer band
 * (top border, muted fill) with an outline Cancel and a filled action button
 * that repeats the action. No close X.
 * Destructive asks with `typeToConfirm` keep the button disabled until the
 * name matches. Esc, the backdrop and Cancel all answer false.
 */
function ConfirmDialog({ ask, onAnswer }: ConfirmDialogProps) {
  const [typed, setTyped] = useState("");
  const inputId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  // Keep the last ask while the dialog animates out.
  const shown = useRef(ask);
  if (ask) shown.current = ask;
  const current = shown.current;
  useEffect(() => setTyped(""), [ask]);
  const matches = current?.typeToConfirm === undefined || typed === current.typeToConfirm;
  // The title and button say how serious it is: red when it cannot be undone, yellow when it takes devices
  // offline (a disruptive command, or a write whose run would), and a plain title with a filled primary
  // button for a reversible write asked about only to be sure.
  const tone = current?.effect === "destructive" ? "destructive" : current?.effect === "disruptive" || current?.offline ? "warning" : "plain";
  const confirmVariant = tone === "plain" ? "default" : tone;
  const titleTone = tone === "destructive" ? "text-destructive-foreground" : tone === "warning" ? "text-warning-foreground" : undefined;

  return (
    <Dialog open={ask !== null} onOpenChange={(open) => !open && onAnswer(false)}>
      <DialogPopup
        showCloseButton={false}
        className="max-w-md bg-background"
        initialFocus={current?.typeToConfirm === undefined ? cancelRef : undefined}
      >
        <div className="flex flex-col gap-5 px-5 pt-5 pb-[30px]">
          <DialogTitle className={cn("text-base", titleTone)}>{current?.title}</DialogTitle>
          {current?.message && <DialogDescription className="text-foreground/80">{current.message}</DialogDescription>}
          {current?.typeToConfirm !== undefined && (
            <TypeToConfirm id={inputId} name={current.typeToConfirm} value={typed} onChange={setTyped} className="-mt-1" />
          )}
        </div>
        <div className="flex justify-end gap-2 rounded-b-[17px] border-t bg-muted/72 px-5 py-4">
          <Button ref={cancelRef} size="sm" variant="outline" onClick={() => onAnswer(false)}>
            Cancel
          </Button>
          <Button size="sm" variant={confirmVariant} disabled={!matches} onClick={() => onAnswer(true)}>
            {current?.confirmLabel}
          </Button>
        </div>
      </DialogPopup>
    </Dialog>
  );
}

/** The app-wide confirm dialog for writes that confirm in a dialog. Mounted once by App.tsx. */
function ConfirmHost() {
  const ask = useDialogAsk();
  return <ConfirmDialog ask={ask} onAnswer={answerDialog} />;
}

/**
 * A `confirmIn: "nested"` write's confirm, rendered inside the dialog that
 * holds the control (the palette, a sheet) so focus and Esc stay with it.
 * It closes once the person confirms, while the command runs.
 */
function WriteConfirmDialog<P, R>({ write }: { write: WriteState<P, R> }) {
  return <ConfirmDialog ask={write.confirming ? null : write.asking} onAnswer={write.answer} />;
}

export { ConfirmDialog, ConfirmHost, WriteConfirmDialog };
