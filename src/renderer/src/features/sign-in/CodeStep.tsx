/**
 * Sign in, step 2: the one-time code (docs/ux/sign-in.md, Verification
 * code). Six boxes that advance as you type, step back on Backspace and
 * fill from a paste; the sixth digit submits. Wrong code, resend timer and
 * eero's resend limit are shown inline.
 */
import { ArrowLeft, MailCheck, MessageSquareText, ShieldCheck } from "lucide-react";
import { type ClipboardEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";

import { useCommand, useQuery } from "~/app/useCommand";
import { cn } from "~/lib/utils";
import type { ExecuteError } from "../../../../core/errors";
import type { AppInfo, AuthStatus } from "../../../../core/model";
import { BigButton, ErrorLine, errorText, FootNote, Lead, type LoginKind, Title } from "./SignInView";

/** eero's code length. The API accepts 4 to 10 digits; every code seen so far has 6. */
const CODE_LENGTH = 6;
/** eero sends a new code about once a minute; the engine enforces the same. */
const RESEND_SEC = 60;
const SUPPORT_URL = "https://support.eero.com/hc/en-us";

type CodeStepProps = {
  /** As typed, shown in the lead. */
  login: string;
  kind: LoginKind;
  onBack: () => void;
  onSwitchKind: () => void;
  /** Signed in; `ms` is how long verify took. The button stays busy until it settles. */
  onVerified: (ms: number) => Promise<void> | void;
};

const isWrongCode = (e: ExecuteError) => e.code === "eero_error" && /code\.invalid|verification\./.test(e.detail?.eeroError ?? "");

export function CodeStep({ login, kind, onBack, onSwitchKind, onVerified }: CodeStepProps) {
  const verify = useCommand<{ code: string }, AuthStatus>("auth.login.verify");
  const resend = useCommand<Record<string, never>, AuthStatus>("auth.login.resend");
  const info = useQuery<AppInfo>("app.info");
  const [digits, setDigits] = useState<string[]>(() => Array(CODE_LENGTH).fill(""));
  const [wrong, setWrong] = useState(false);
  const [resendAt, setResendAt] = useState(() => Date.now() + RESEND_SEC * 1000);
  const [now, setNow] = useState(() => Date.now());
  const [resent, setResent] = useState(false);
  const [resendBlocked, setResendBlocked] = useState(false);
  const [opening, setOpening] = useState(false);
  const boxes = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => boxes.current[0]?.focus(), []);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const code = digits.join("");
  const left = Math.max(0, Math.ceil((resendAt - now) / 1000));

  const submit = async (value = code) => {
    if (value.length !== CODE_LENGTH || verify.running || opening) return;
    const started = performance.now();
    const res = await verify.run({ code: value });
    if (res.ok) {
      setOpening(true);
      return onVerified(performance.now() - started);
    }
    setWrong(isWrongCode(res.error));
    // The boxes were disabled while verifying; focus once they are back.
    setTimeout(() => boxes.current[CODE_LENGTH - 1]?.focus(), 0);
  };

  const fill = (from: number, chars: string) => {
    const next = [...digits];
    let at = from;
    for (const ch of chars.replace(/\D/g, "")) {
      if (at >= CODE_LENGTH) break;
      next[at++] = ch;
    }
    setDigits(next);
    setWrong(false);
    verify.reset();
    boxes.current[Math.min(at, CODE_LENGTH - 1)]?.focus();
    const joined = next.join("");
    if (joined.length === CODE_LENGTH && at === CODE_LENGTH) void submit(joined);
  };

  const onKeyDown = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      e.preventDefault();
      const next = [...digits];
      const at = next[i] ? i : Math.max(0, i - 1);
      next[at] = "";
      setDigits(next);
      setWrong(false);
      boxes.current[at]?.focus();
    } else if (e.key === "ArrowLeft") {
      boxes.current[Math.max(0, i - 1)]?.focus();
    } else if (e.key === "ArrowRight") {
      boxes.current[Math.min(CODE_LENGTH - 1, i + 1)]?.focus();
    } else if (e.key === "Enter") {
      void submit();
    }
  };

  const onPaste = (i: number, e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text").replace(/\D/g, "");
    fill(text.length >= CODE_LENGTH ? 0 : i, text);
  };

  const doResend = async () => {
    const res = await resend.run({});
    if (res.ok) {
      setDigits(Array(CODE_LENGTH).fill(""));
      setWrong(false);
      verify.reset();
      setResendAt(Date.now() + RESEND_SEC * 1000);
      setResent(true);
      boxes.current[0]?.focus();
    } else if (res.error.code === "rate_limited") {
      if (res.error.detail?.eeroError === "error.too.many.resends") setResendBlocked(true);
      else setResendAt(Date.now() + (res.error.detail?.retryAfterSec ?? RESEND_SEC) * 1000);
    }
  };

  const error = verify.error;
  // No code is sent outside live mode; say what to type (docs/ux/sign-in.md).
  const sandboxHint =
    info.data?.backend === "demo" ? "Demo mode: no code is sent. Enter any 6 digits." : info.data?.fakeServer ? "Fake eero server: enter 123456." : null;
  const Icon = kind === "email" ? MailCheck : MessageSquareText;

  return (
    <div className="flex flex-1 flex-col">
      <button
        type="button"
        onClick={onBack}
        className="flex cursor-pointer items-center gap-1.5 self-start text-muted-foreground text-xs hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Back
      </button>
      <div className="mt-[18px] grid size-10 place-items-center rounded-[10px] border bg-muted text-foreground">
        <Icon className="size-5" />
      </div>
      <Title className="mt-4">{kind === "email" ? "Check your email" : "Check your messages"}</Title>
      <Lead>
        We sent a {CODE_LENGTH}-digit code to <b className="font-semibold text-foreground">{login}</b>. It can take a minute or two to arrive.
      </Lead>

      <div id="code-label" className="mt-[22px] mb-2 text-muted-foreground text-xs">
        Enter code
      </div>
      <div role="group" aria-labelledby="code-label" className="grid grid-cols-6 gap-2">
        {digits.map((d, i) => (
          <input
            // Fixed length, so the index is the identity.
            key={i}
            ref={(el) => {
              boxes.current[i] = el;
            }}
            aria-label={`Digit ${i + 1}`}
            inputMode="numeric"
            autoComplete={i === 0 ? "one-time-code" : "off"}
            maxLength={1}
            value={d}
            disabled={verify.running || opening}
            aria-invalid={wrong || undefined}
            onChange={(e) => fill(i, e.target.value.slice(-1))}
            onKeyDown={(e) => onKeyDown(i, e)}
            onPaste={(e) => onPaste(i, e)}
            onFocus={(e) => e.target.select()}
            className={cn(
              "h-[54px] w-full min-w-0 rounded-[11px] border border-input bg-card text-center font-mono font-semibold text-[22px] outline-none transition-colors focus:border-primary disabled:opacity-60",
              wrong && "border-destructive text-destructive-foreground focus:border-destructive",
            )}
          />
        ))}
      </div>
      {sandboxHint && <p className="mt-2 text-muted-foreground text-xs">{sandboxHint}</p>}
      {error && (
        <ErrorLine>
          {wrong ? (
            "That code didn't work. Check it and try again, or resend a new code."
          ) : error.code === "eero_error" ? (
            <>
              {error.message}{" "}
              <a href={SUPPORT_URL} target="_blank" rel="noreferrer" className="font-medium underline-offset-2 hover:underline">
                eero support
              </a>
            </>
          ) : (
            errorText(error)
          )}
        </ErrorLine>
      )}

      <BigButton className="mt-[18px]" busy={verify.running || opening} disabled={code.length !== CODE_LENGTH} onClick={() => void submit()}>
        Verify
      </BigButton>
      <div className="mt-3 flex items-center justify-between gap-3 text-xs">
        <span className="text-muted-foreground">
          {resendBlocked ? (
            "Too many codes requested. Try again in a few minutes."
          ) : (
            <>
              {resent && left > 0 ? "New code sent. " : "Didn't get it? "}
              {left > 0 ? (
                <span className="text-muted-foreground/70 tabular-nums">
                  Resend in {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
                </span>
              ) : (
                <button
                  type="button"
                  disabled={resend.running}
                  onClick={() => void doResend()}
                  className="cursor-pointer font-medium text-info-foreground hover:underline disabled:opacity-50"
                >
                  Resend code
                </button>
              )}
            </>
          )}
        </span>
        <button type="button" onClick={onSwitchKind} className="cursor-pointer font-medium text-info-foreground hover:underline">
          {kind === "email" ? "Use a phone number instead" : "Use an email instead"}
        </button>
      </div>
      {resend.error && resend.error.code !== "rate_limited" && <ErrorLine>{errorText(resend.error)}</ErrorLine>}
      <FootNote icon={<ShieldCheck />}>Each code works once. Five wrong codes may lock the account.</FootNote>
    </div>
  );
}
