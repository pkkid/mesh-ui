// The confirm from docs/ux/overview.md#confirmations: every disruptive or
// destructive action (and the few writes the UI confirms on its own) asks in
// a centred modal naming the target and the consequence, with a filled
// danger button that repeats the action and Cancel. Focus starts on Cancel;
// Esc and the backdrop cancel. After the person confirms, the write kit runs
// the command with `confirm: true` (disruptive and destructive) or without it.
//
// Pages rarely build these by hand (app/useWrite.ts):
// - `ConfirmHost`, mounted once by App.tsx, shows `ConfirmDialog` for every
//   `useWrite` and `performWrite` confirm, with the engine's needs_confirm
//   message and type-to-confirm for destructive actions on a named thing.
// - `WriteConfirmDialog` nests the same dialog inside another dialog (the
//   palette, a sheet) for a `useWrite(id, { confirmIn: "nested" })` write.
import { TriangleAlert } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { answerDialog, type ConfirmAsk, useDialogAsk, type WriteState } from "~/app/useWrite";
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from "~/components/ui/dialog";
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
  ask: Pick<ConfirmAsk, "title" | "message" | "confirmLabel" | "typeToConfirm"> | null;
  onAnswer: (ok: boolean) => void;
};

/**
 * The centred confirm dialog: icon and title naming the target, the
 * consequence, a filled danger button that repeats the action and Cancel.
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

  return (
    <Dialog open={ask !== null} onOpenChange={(open) => !open && onAnswer(false)}>
      <DialogPopup showCloseButton={false} className="max-w-md" initialFocus={current?.typeToConfirm === undefined ? cancelRef : undefined}>
        <div className="flex flex-col gap-1.5 px-5 pt-5">
          <DialogTitle className="flex items-center gap-2 text-base text-destructive-foreground">
            <TriangleAlert className="size-4 shrink-0" />
            {current?.title}
          </DialogTitle>
          {current?.message && <DialogDescription className="text-foreground/80">{current.message}</DialogDescription>}
        </div>
        {current?.typeToConfirm !== undefined && (
          <TypeToConfirm id={inputId} name={current.typeToConfirm} value={typed} onChange={setTyped} className="px-5 pt-4" />
        )}
        <div className="flex justify-end gap-2 px-5 pt-5 pb-4">
          <Button ref={cancelRef} size="sm" variant="ghost" onClick={() => onAnswer(false)}>
            Cancel
          </Button>
          <Button size="sm" variant="destructive" disabled={!matches} onClick={() => onAnswer(true)}>
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
