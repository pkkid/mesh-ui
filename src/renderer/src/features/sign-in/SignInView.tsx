/**
 * Sign in (docs/ux/sign-in.md, mockup 18): Welcome, verification code,
 * then straight to the dashboard on the last used (or first) network. Every step
 * talks to the engine through commands; the token never reaches this code.
 *
 * The window stays the main window; the steps sit in a 460px column in the
 * middle, like the mockup's small window.
 */
import {
  ArrowRight,
  AtSign,
  CircleAlert,
  FlaskConical,
  Info,
  Lock,
  LockOpen,
  Mail,
  Phone,
  Smartphone,
  Wifi,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { execute, useCommand, useQuery } from "~/app/useCommand";
import { Button } from "~/components/ui/button";
import { Segmented } from "~/components/ui/segmented";
import { Status } from "~/components/ui/status";
import { hue } from "~/lib/chartColors";
import { cn } from "~/lib/utils";
import type { ExecuteError } from "../../../../core/errors";
import type { Account, AppInfo, AuthStatus, NetworkSummary } from "../../../../core/model";
import { CodeStep } from "./CodeStep";

export type LoginKind = "email" | "phone";

/** What the user typed last, kept for this run so an expired session can prefill it. */
let lastLogin: { kind: LoginKind; country: string; value: string } | null = null;

type Step =
  | { id: "welcome" }
  | { id: "code"; login: string }
  | { id: "no-networks"; error: ExecuteError | null };

type SignInViewProps = {
  /** The session ended while the app was open (not a first launch). */
  expired: boolean;
  /** Signed in and loaded: show the main window. */
  onDone: () => void;
};

export function SignInView({ expired, onDone }: SignInViewProps) {
  const [step, setStep] = useState<Step>({ id: "welcome" });
  const [kind, setKind] = useState<LoginKind>(lastLogin?.kind ?? "email");

  /**
   * Opens the last used network (the engine's selection, from `lastNetworkId`)
   * if the account still has it, else the first one, then shows the dashboard.
   * `network.select` resolves before the dashboard mounts, so no network query
   * runs too early. Switching later is the sidebar's network switcher.
   */
  const openNetwork = async () => {
    const list = await execute<NetworkSummary[]>("network.list");
    if (!list.ok) {
      // A build without network.list falls back to the engine's choice.
      if (list.error.code === "unknown_command") return onDone();
      return setStep({ id: "no-networks", error: list.error });
    }
    const network = list.result.find((n) => n.selected) ?? list.result[0];
    if (!network) return setStep({ id: "no-networks", error: null });
    const select = await execute("network.select", { network: network.id });
    if (!select.ok && select.error.code !== "unknown_command") return setStep({ id: "no-networks", error: select.error });
    onDone();
  };

  return (
    <Frame>
      {step.id === "welcome" && (
        <Welcome
          expired={expired}
          kind={kind}
          onKind={setKind}
          onSent={(login) => setStep({ id: "code", login })}
        />
      )}
      {step.id === "code" && (
        <CodeStep
          login={step.login}
          kind={kind}
          onBack={() => setStep({ id: "welcome" })}
          onSwitchKind={() => {
            setKind(kind === "email" ? "phone" : "email");
            setStep({ id: "welcome" });
          }}
          onVerified={openNetwork}
        />
      )}
      {step.id === "no-networks" && <NoNetworks error={step.error} onRetry={() => void openNetwork()} />}
    </Frame>
  );
}

/**
 * Signed in, but there is no network to open: the account has none, or the
 * list could not be loaded (then the error and Retry show instead).
 */
function NoNetworks({ error, onRetry }: { error: ExecuteError | null; onRetry: () => void }) {
  const account = useQuery<Account>("account.get");
  const logout = useCommand("auth.logout");
  const name = account.data?.name ?? null;
  const contact = account.data?.email?.value ?? account.data?.phone?.value ?? null;

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center gap-3">
        <div
          aria-hidden
          className="grid size-9 shrink-0 place-items-center rounded-full font-semibold text-background text-xs"
          style={{ background: name ? hue("orange") : "var(--color-muted-foreground)" }}
        >
          {initials(name)}
        </div>
        <div className="min-w-0">
          <div className="truncate font-medium text-[13px]">{name ?? "-"}</div>
          <div className="truncate text-2xs text-muted-foreground">{contact ?? "-"}</div>
        </div>
        <Status tone="success" className="ms-auto">
          Signed in
        </Status>
      </div>

      {error ? (
        <>
          <Title className="mt-[22px]">Couldn't load your networks</Title>
          <ErrorLine>{errorText(error)}</ErrorLine>
        </>
      ) : (
        <>
          <Title className="mt-[22px]">No networks yet</Title>
          <Lead>This account has no eero networks yet. Set one up in the eero mobile app, then come back.</Lead>
        </>
      )}
      <div className="mt-5 flex gap-2">
        {error && <Button onClick={onRetry}>Retry</Button>}
        <Button variant="outline" disabled={logout.running} onClick={() => void logout.run({})}>
          Sign out
        </Button>
      </div>
      {logout.error && <ErrorLine>{errorText(logout.error)}</ErrorLine>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared pieces (also used by CodeStep)

/** The titlebar strip and the centred 460px column. */
function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full flex-col bg-background">
      <div className="drag-region flex h-(--titlebar-height) shrink-0 items-center gap-2 ps-[calc(var(--titlebar-inset-left)+1rem)] pe-4">
        <div className="grid size-[18px] place-items-center rounded-[6px] bg-primary text-primary-foreground">
          <Wifi className="size-[11px]" strokeWidth={2.5} />
        </div>
        <span className="font-medium text-[13px]">Mesh UI</span>
      </div>
      <div className="flex min-h-0 flex-1 justify-center overflow-y-auto">
        <div className="flex min-h-[min(640px,100%)] w-full max-w-[460px] flex-col px-[38px] pt-[34px] pb-[26px]">{children}</div>
      </div>
    </div>
  );
}

export function Title({ children, className }: { children: ReactNode; className?: string }) {
  return <h1 className={cn("font-semibold text-[22px] tracking-tight", className)}>{children}</h1>;
}

export function Lead({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("mt-1.5 text-[13px] text-muted-foreground leading-normal", className)}>{children}</p>;
}

/** Full-width 42px primary button. While `busy` the label fades and the button is disabled. */
export function BigButton({
  busy,
  disabled,
  children,
  className,
  ...props
}: React.ComponentProps<typeof Button> & { busy?: boolean }) {
  return (
    <Button
      size="lg"
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cn("h-[42px] w-full shrink-0 rounded-[10px] text-sm", busy && "disabled:opacity-100", className)}
      {...props}
    >
      <span className={cn("inline-flex items-center gap-2 transition-opacity", busy && "opacity-50")}>{children}</span>
    </Button>
  );
}

/** The muted rule and line at the bottom of a step. */
export function FootNote({ icon, children, className }: { icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("mt-auto flex shrink-0 items-center gap-2 border-t pt-3.5 text-[11.5px] text-muted-foreground [&_svg]:size-[13px] [&_svg]:shrink-0", className)}>
      {icon}
      {children}
    </div>
  );
}

/** A red line under a control. */
export function ErrorLine({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="mt-2 flex items-start gap-1.5 text-destructive-foreground text-xs">
      <CircleAlert className="mt-px size-3.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

/** Words for an error from a sign-in command. */
export function errorText(error: ExecuteError): string {
  if (error.code === "network_error") return "Can't reach eero. Check your internet connection.";
  return error.message;
}

/** Initials for the avatar: "Alex Kim" becomes "AK". */
export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

// ---------------------------------------------------------------------------
// 1. Welcome

const COUNTRIES = [
  ["+1", "US +1"],
  ["+44", "UK +44"],
  ["+61", "AU +61"],
  ["+64", "NZ +64"],
  ["+353", "IE +353"],
  ["+49", "DE +49"],
  ["+33", "FR +33"],
  ["+34", "ES +34"],
  ["+39", "IT +39"],
  ["+31", "NL +31"],
  ["+46", "SE +46"],
  ["+52", "MX +52"],
  ["+55", "BR +55"],
  ["+81", "JP +81"],
  ["+91", "IN +91"],
] as const;

const fieldClass =
  "flex h-[42px] w-full items-center gap-2 rounded-[10px] border border-input bg-background px-3 text-sm shadow-xs/5 transition-shadow has-focus-visible:border-primary dark:bg-input/32 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground";

function Welcome({
  expired,
  kind,
  onKind,
  onSent,
}: {
  expired: boolean;
  kind: LoginKind;
  onKind: (k: LoginKind) => void;
  onSent: (login: string) => void;
}) {
  const auth = useQuery<AuthStatus>("auth.status");
  const info = useQuery<AppInfo>("app.info");
  const start = useCommand<{ login: string }, AuthStatus>("auth.login.start");
  const [email, setEmail] = useState(lastLogin?.kind === "email" ? lastLogin.value : "");
  const [phone, setPhone] = useState(lastLogin?.kind === "phone" ? lastLogin.value : "");
  const [country, setCountry] = useState(lastLogin?.country ?? "+1");
  const [demoHint, setDemoHint] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), [kind]);

  const value = kind === "email" ? email.trim() : phone.trim();
  const login = kind === "email" || value.startsWith("+") ? value : `${country}${value}`;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!value || start.running) return;
    lastLogin = { kind, country, value };
    const res = await start.run({ login });
    if (res.ok) onSent(kind === "email" ? login : `${country} ${value}`.replace(/^(\+\d+) \+/, "+"));
  };

  const demo = auth.data?.backend === "demo";
  const storage = auth.data?.storage;

  return (
    <form onSubmit={submit} className="flex flex-1 flex-col" noValidate>
      <div className="grid size-16 place-items-center rounded-[19px] border bg-muted text-foreground">
        <Wifi className="size-8" />
      </div>
      <Title className="mt-[22px]">Sign in to your eero account</Title>
      <Lead>Manage your eero networks from the desktop. We'll send you a one-time code, no password needed.</Lead>
      {expired && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-xs">
          <CircleAlert className="size-3.5 shrink-0 text-warning-foreground" />
          Your session ended. Sign in again.
        </div>
      )}

      <Segmented
        aria-label="Sign in with"
        className="mt-[22px] self-start"
        value={kind}
        onValueChange={(k) => {
          onKind(k);
          start.reset();
        }}
        options={[
          { value: "email", label: "Email", icon: Mail },
          { value: "phone", label: "Phone", icon: Smartphone },
        ]}
      />

      <label htmlFor="sign-in-login" className="mt-3.5 mb-1.5 text-muted-foreground text-xs">
        {kind === "email" ? "Email address" : "Mobile number"}
      </label>
      {kind === "email" ? (
        <span className={fieldClass}>
          <AtSign />
          <input
            ref={inputRef}
            id="sign-in-login"
            type="email"
            autoComplete="email"
            placeholder="name@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={start.error ? true : undefined}
            className="h-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-placeholder"
          />
        </span>
      ) : (
        <span className={fieldClass}>
          <Phone />
          <select
            aria-label="Country code"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className="h-full cursor-pointer bg-transparent pe-1 text-sm outline-none"
          >
            {COUNTRIES.map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
          <span aria-hidden className="h-5 w-px bg-border" />
          <input
            ref={inputRef}
            id="sign-in-login"
            type="tel"
            autoComplete="tel-national"
            placeholder="555 010 0142"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            aria-invalid={start.error ? true : undefined}
            className="h-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-placeholder"
          />
        </span>
      )}

      <BigButton type="submit" className="mt-3.5" busy={start.running} disabled={!value}>
        Send code
        <ArrowRight />
      </BigButton>
      {start.error && <ErrorLine>{errorText(start.error)}</ErrorLine>}

      <div className="mt-4 flex gap-2.5 rounded-[10px] border bg-card px-3 py-2.5 text-muted-foreground text-xs leading-normal">
        <Info className="mt-px size-3.5 shrink-0 text-info-foreground" />
        <div>
          Amazon login is not supported in Mesh UI. If you sign in to the eero app with Amazon, use an eero account that has admin access to
          your network.
        </div>
      </div>

      <div className="mt-auto pt-6">
        <div className="mb-2.5 flex items-center gap-1.5 text-2xs text-muted-foreground">
          {demo ? (
            <>
              <FlaskConical className="size-3 shrink-0" />
              Demo mode: use any email, then any 6-digit code.
            </>
          ) : storage === "keychain" ? (
            <>
              <Lock className="size-3 shrink-0" />
              Session token kept in the system keychain.
            </>
          ) : storage === "memory" ? (
            <>
              <LockOpen className="size-3 shrink-0" />
              No system keychain found. You'll stay signed in only until Mesh UI closes.
            </>
          ) : null}
        </div>
        <FootNote icon={<FlaskConical />} className="mt-0">
          {demoHint ? (
            <span>
              Start Mesh UI with <span className="font-mono">--demo</span> to explore sample networks.
            </span>
          ) : (
            <span>
              Just looking?{" "}
              <button type="button" className="cursor-pointer font-medium text-info-foreground hover:underline" onClick={() => setDemoHint(true)}>
                Try demo mode
              </button>
            </span>
          )}
          <span className="ms-auto tabular-nums">{info.data ? `v${info.data.version}` : ""}</span>
        </FootNote>
      </div>
    </form>
  );
}

