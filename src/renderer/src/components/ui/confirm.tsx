// Inline confirm from docs/ux/overview.md#confirmations and mockups 06, 11
// and 16: the button area becomes a note naming the target and the
// consequence, a filled danger button that repeats the action, and Cancel.
// Focus moves to Cancel; Esc cancels. After the user confirms, the caller
// runs the command with `confirm: true` (disruptive and destructive) or
// without it (the few writes the UI confirms on its own).
//
// With the write kit (app/useWrite.ts) pages rarely build these by hand:
// - `WriteConfirm` shows a useWrite hook's pending confirm in place of its
//   trigger, with the engine's needs_confirm message.
// - `ConfirmDialog` is the centred dialog (no room for a note, network-wide or
//   destructive), with type-to-confirm; `ConfirmHost`, mounted once by
//   App.tsx, shows it for every `confirmIn: "dialog"` write and the palette.
import { TriangleAlert } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";

import { answerDialog, type ConfirmAsk, useDialogAsk, type WriteState } from "~/app/useWrite";
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from "~/components/ui/dialog";
import { cn } from "~/lib/utils";
import { Button } from "./button";

type InlineConfirmProps = {
  /** Names the target: "Block Alex's MacBook Pro?" */
  title: ReactNode;
  /** One or two sentences on who loses what and for how long. */
  children?: ReactNode;
  /** Repeats the action: "Yes, restart network", "Block device". */
  confirmLabel: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
  /** Disables the buttons while the command runs. */
  running?: boolean;
  /** Destructive actions on a named thing: the user types this to enable the button. */
  typeToConfirm?: string;
  /** Shown under the buttons when the command failed. */
  error?: ReactNode;
  className?: string;
};

function InlineConfirm({
  title,
  children,
  confirmLabel,
  onConfirm,
  onCancel,
  running = false,
  typeToConfirm,
  error,
  className,
}: InlineConfirmProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [typed, setTyped] = useState("");
  const titleId = useId();
  const inputId = useId();
  const matches = typeToConfirm === undefined || typed === typeToConfirm;

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <div
      role="alertdialog"
      aria-labelledby={titleId}
      data-slot="inline-confirm"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !running) {
          e.stopPropagation();
          onCancel();
        }
      }}
      className={cn("rounded-xl border border-input bg-muted px-3.5 py-3", className)}
    >
      <div id={titleId} className="flex items-center gap-1.5 font-medium text-destructive-foreground text-sm">
        <TriangleAlert className="size-[15px] shrink-0" />
        {title}
      </div>
      {children && <div className="mt-1 text-foreground/80 text-xs">{children}</div>}
      {typeToConfirm !== undefined && (
        <TypeToConfirm id={inputId} name={typeToConfirm} value={typed} onChange={setTyped} className="mt-3" />
      )}
      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" variant="destructive" disabled={!matches || running} onClick={onConfirm}>
          {confirmLabel}
        </Button>
        <Button ref={cancelRef} size="sm" variant="ghost" disabled={running} onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {error && <div className="mt-2 text-destructive-foreground text-xs">{error}</div>}
    </div>
  );
}

type ConfirmButtonProps = Omit<InlineConfirmProps, "onCancel" | "onConfirm" | "running"> & {
  /** Renders the trigger; call `open` to reveal the confirm in its place. */
  trigger: (open: () => void) => ReactNode;
  /**
   * Runs the action. While its promise is pending the buttons are disabled.
   * Resolving to `{ ok: false }` (an execute result) keeps the confirm open.
   */
  onConfirm: () => unknown;
  onCancel?: () => void;
};

/** A trigger that turns into an InlineConfirm in place, until confirmed or cancelled. */
function ConfirmButton({ trigger, onConfirm, onCancel, ...props }: ConfirmButtonProps) {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  if (!open) return <>{trigger(() => setOpen(true))}</>;
  return (
    <InlineConfirm
      {...props}
      running={running}
      onConfirm={async () => {
        setRunning(true);
        const res = await onConfirm();
        setRunning(false);
        const failed = typeof res === "object" && res !== null && (res as { ok?: unknown }).ok === false;
        if (!failed) setOpen(false);
      }}
      onCancel={() => {
        setOpen(false);
        onCancel?.();
      }}
    />
  );
}

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
 * Shows a useWrite hook's pending confirm in place of the trigger:
 *
 *   const restart = useWrite("eero.reboot", { success: "Restarted Office" });
 *   <WriteConfirm write={restart}>
 *     <Button onClick={() => restart.run({ eero: id })}>Restart</Button>
 *   </WriteConfirm>
 */
function WriteConfirm<P, R>({ write, children, className }: { write: WriteState<P, R>; children: ReactNode; className?: string }) {
  if (!write.asking) return <>{children}</>;
  return (
    <InlineConfirm
      title={write.asking.title}
      confirmLabel={write.asking.confirmLabel}
      typeToConfirm={write.asking.typeToConfirm}
      running={write.confirming}
      onConfirm={() => write.answer(true)}
      onCancel={() => write.answer(false)}
      className={className}
    >
      {write.asking.message || undefined}
    </InlineConfirm>
  );
}

export { ConfirmButton, ConfirmDialog, ConfirmHost, InlineConfirm, WriteConfirm };
