/**
 * The hero's account dialogs (docs/ux/pages/account.md, Actions): one
 * field (Edit name, Change email, Change mobile), then, for email and
 * mobile, the 6 digit code eero sent (`account.email.verify`,
 * `account.phone.verify`). Verify only (an unverified address or number)
 * opens straight at the code step. `bad_params` and a wrong code show under
 * the field; the code itself never leaves this dialog except as the verify
 * command's param.
 */
import { useId, useState } from "react";

import { affectedBy, execute, invalidate, useQuery } from "~/app/useCommand";
import { fieldErrors, performWrite, type WriteRequest } from "~/app/useWrite";
import { Button } from "~/components/ui/button";
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { SheetField } from "~/components/ui/sheet";
import { toast } from "~/components/ui/toast";
import type { ExecuteError } from "../../../../core/errors";
import type { Account, AppInfo } from "../../../../core/model";

const CODE = /^\d{6}$/;

export type CodeDialogField = {
  /** The write that takes the value, e.g. `account.email.set`. */
  command: string;
  /** Its param name, e.g. `email`. */
  param: string;
  label: string;
  type: "text" | "email" | "tel";
  initial?: string;
  placeholder?: string;
  hint?: string;
  submitLabel: string;
  /** Success toast when there is no code step: "Renamed to Sam". */
  success?: (value: string) => string;
  /** The inverse write for the toast's Undo (the old name). */
  undo?: WriteRequest;
};

export type CodeDialogVerify = {
  command: "account.email.verify" | "account.phone.verify";
  /** Where eero sent the code, for the lead; the field's value once it is set. */
  sentTo?: string;
  /** "email" or "text": how eero sent it. */
  via: "email" | "text";
  /** Success toast. */
  success: string;
};

export function CodeDialog({
  title,
  description,
  field,
  verify,
  onClose,
}: {
  title: string;
  description: string;
  /** Leave out to open at the code step. */
  field?: CodeDialogField;
  verify?: CodeDialogVerify;
  onClose: () => void;
}) {
  const [step, setStep] = useState<"field" | "code">(field ? "field" : "code");
  const [value, setValue] = useState(field?.initial ?? "");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState(verify?.sentTo ?? "");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const info = useQuery<AppInfo>("app.info");
  const ids = { field: useId(), code: useId() };

  const submitField = async () => {
    if (!field) return;
    setRunning(true);
    setError(null);
    const v = value.trim();
    const res = await performWrite<Record<string, unknown>, Account>({
      id: field.command,
      params: { [field.param]: v },
      form: true,
      // With a code step the toast waits for the verify.
      ...(verify ? {} : { success: () => field.success?.(v) ?? "Saved", ...(field.undo ? { undo: field.undo } : {}) }),
    });
    setRunning(false);
    if (!res) return;
    if (!res.ok) {
      const errs = fieldErrors(res.error);
      setError(errs[field.param] ?? errs._form ?? null);
      return;
    }
    if (!verify) return onClose();
    setSentTo(v);
    setStep("code");
  };

  const submitCode = async () => {
    if (!verify) return;
    setRunning(true);
    setError(null);
    // Run directly: a wrong code belongs under the field, not in a toast.
    const res = await execute<Account>(verify.command, { code });
    setRunning(false);
    if (res.ok) {
      invalidate(affectedBy(verify.command));
      toast.success(verify.success);
      return onClose();
    }
    setError(codeError(res.error));
  };

  const ready = step === "field" ? value.trim() !== "" && value.trim() !== (field?.initial ?? "").trim() : CODE.test(code);
  const lead =
    step === "field"
      ? description
      : `eero ${verify?.via === "text" ? "texted" : "emailed"} a 6 digit code${sentTo ? ` to ${sentTo}` : ""}. Enter it to verify.`;
  const demoHint = info.data?.backend === "demo" ? "Demo mode: no code is sent. Enter any 6 digits." : info.data?.fakeServer ? "Fake eero server: enter 123456." : null;

  return (
    <Dialog open onOpenChange={(o) => !o && !running && onClose()}>
      <DialogPopup className="w-full max-w-sm">
        <form
          className="flex flex-col gap-4 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!ready || running) return;
            void (step === "field" ? submitField() : submitCode());
          }}
        >
          <div className="flex flex-col gap-1.5 pe-8">
            <DialogTitle className="text-base">{step === "field" ? title : verify?.command === "account.phone.verify" ? "Verify mobile" : "Verify email"}</DialogTitle>
            <DialogDescription className="text-xs">{lead}</DialogDescription>
          </div>
          {step === "field" && field ? (
            <SheetField label={field.label} htmlFor={ids.field} error={error ?? undefined} helper={field.hint}>
              <Input
                id={ids.field}
                type={field.type}
                value={value}
                placeholder={field.placeholder}
                autoComplete="off"
                spellCheck={false}
                autoFocus
                onChange={(e) => setValue(e.target.value)}
              />
            </SheetField>
          ) : (
            <SheetField label="Code" htmlFor={ids.code} error={error ?? undefined} helper={demoHint ?? undefined}>
              <Input
                id={ids.code}
                value={code}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="000000"
                className="font-mono tabular-nums tracking-[0.3em]"
                autoFocus
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              />
            </SheetField>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" disabled={running} onClick={onClose}>
              {step === "code" && field ? "Later" : "Cancel"}
            </Button>
            <Button type="submit" size="sm" disabled={!ready || running}>
              {step === "field" ? field?.submitLabel : "Verify"}
            </Button>
          </div>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

/** A wrong code reads plainly; anything else as core wrote it. */
function codeError(e: ExecuteError): string {
  if (e.code === "bad_params") return "The code is 6 digits.";
  return e.message;
}
