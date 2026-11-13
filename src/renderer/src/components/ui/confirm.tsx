// Inline confirm from docs/ux/overview.md#confirmations and mockups 06, 11
// and 16: the button area becomes a note naming the target and the
// consequence, a filled danger button that repeats the action, and Cancel.
// Focus moves to Cancel; Esc cancels. After the user confirms, the caller
// runs the command with `confirm: true` (disruptive and destructive) or
// without it (the few writes the UI confirms on its own).
import { TriangleAlert } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";

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
        <div className="mt-3">
          <label htmlFor={inputId} className="sr-only">
            Type {typeToConfirm} to confirm
          </label>
          <input
            id={inputId}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={`Type "${typeToConfirm}" to confirm`}
            autoComplete="off"
            spellCheck={false}
            className="h-[30px] w-full rounded-[var(--control-radius)] border border-input bg-card px-2.5 text-[13px] outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
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

export { ConfirmButton, InlineConfirm };
