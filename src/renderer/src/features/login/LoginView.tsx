import { ArrowLeft, Wifi } from "lucide-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Spinner } from "~/components/ui/spinner";

type LoginViewProps = {
  initialError?: string;
  onSignedIn: () => Promise<void>;
};

/** Two-step eero sign-in: request a code by email or phone, then verify it. */
export function LoginView({ initialError, onSignedIn }: LoginViewProps) {
  const [step, setStep] = useState<"login" | "verify">("login");
  const [login, setLogin] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError ?? "");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (step === "login") {
        await window.mesh.startLogin(login.trim());
        setStep("verify");
      } else {
        await window.mesh.verify(code.trim());
        await onSignedIn();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="drag-region h-(--titlebar-height) shrink-0" />
      <div className="grid flex-1 place-items-center px-6 pb-(--titlebar-height)">
        <form onSubmit={submit} className="flex w-full max-w-80 flex-col gap-4">
          <div className="flex flex-col items-center gap-3 pb-2 text-center">
            <div className="grid size-11 place-items-center rounded-xl bg-brand text-brand-foreground shadow-sm">
              <Wifi className="size-5.5" strokeWidth={2.25} />
            </div>
            <div>
              <h1 className="font-semibold text-lg tracking-tight">Sign in to Mesh UI</h1>
              <p className="text-muted-foreground text-sm">
                {step === "login"
                  ? "Use the email or phone number on your eero account."
                  : `Enter the code sent to ${login}.`}
              </p>
            </div>
          </div>

          {step === "login" ? (
            <Input
              key="login"
              autoFocus
              placeholder="Email or phone"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
            />
          ) : (
            <Input
              key="code"
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="Verification code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          )}

          <Button type="submit" size="lg" disabled={busy || !(step === "login" ? login.trim() : code.trim())}>
            {busy && <Spinner className="text-current" />}
            {step === "login" ? "Send code" : "Verify"}
          </Button>

          {step === "verify" && (
            <Button
              variant="ghost-muted"
              size="sm"
              onClick={() => {
                setStep("login");
                setCode("");
                setError("");
              }}
            >
              <ArrowLeft />
              Use a different account
            </Button>
          )}

          {error && <p className="text-center text-destructive-foreground text-sm">{error}</p>}
        </form>
      </div>
    </div>
  );
}
