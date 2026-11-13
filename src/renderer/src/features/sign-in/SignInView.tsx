/**
 * Sign in (docs/ux/sign-in.md, mockup 18): Welcome, verification code,
 * choose network, then the first-run load before the dashboard. Every step
 * talks to the engine through commands; the token never reaches this code.
 *
 * The window stays the main window; the steps sit in a 460px column in the
 * middle, like the mockup's small window.
 */
import {
  ArrowRight,
  AtSign,
  Check,
  CircleAlert,
  FlaskConical,
  Gauge,
  Info,
  Lock,
  LockOpen,
  Mail,
  Minus,
  MonitorSmartphone,
  Phone,
  Router,
  Smartphone,
  Users,
  Wifi,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { execute, useCommand, useQuery } from "~/app/useCommand";
import { Button } from "~/components/ui/button";
import { Segmented } from "~/components/ui/segmented";
import { cn } from "~/lib/utils";
import type { ExecuteError } from "../../../../core/errors";
import { formatMbps } from "../../../../core/format";
import type { AppInfo, AuthStatus, Device, Eero, Network, NetworkHealth, NetworkSummary, Profile, SpeedHistory } from "../../../../core/model";
import { ChooseNetwork } from "./ChooseNetwork";
import { CodeStep } from "./CodeStep";

export type LoginKind = "email" | "phone";

/** What the user typed last, kept for this run so an expired session can prefill it. */
let lastLogin: { kind: LoginKind; country: string; value: string } | null = null;

type Step = { id: "welcome" } | { id: "code"; login: string } | { id: "choose" } | { id: "first-run"; network: NetworkSummary | null };

type SignInViewProps = {
  /** The session ended while the app was open (not a first launch). */
  expired: boolean;
  /** Signed in and loaded: show the main window. */
  onDone: () => void;
};

export function SignInView({ expired, onDone }: SignInViewProps) {
  const [step, setStep] = useState<Step>({ id: "welcome" });
  const [kind, setKind] = useState<LoginKind>(lastLogin?.kind ?? "email");
  const [verifyMs, setVerifyMs] = useState<number | null>(null);

  const afterVerify = async (ms: number) => {
    setVerifyMs(ms);
    if (expired) {
      // Back to the network that was open, if this account still has it.
      const list = await execute<NetworkSummary[]>("network.list");
      if (!list.ok || list.result.some((n) => n.selected)) return onDone();
    }
    setStep({ id: "choose" });
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
          onVerified={(ms) => void afterVerify(ms)}
        />
      )}
      {step.id === "choose" && <ChooseNetwork onContinue={(network) => setStep({ id: "first-run", network })} />}
      {step.id === "first-run" && <FirstRun network={step.network} signInMs={verifyMs} onDone={onDone} />}
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// Shared pieces (also used by CodeStep and ChooseNetwork)

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

// ---------------------------------------------------------------------------
// 4. First run

type RowState = { state: "waiting" | "running" | "done" | "skipped" | "failed"; ms: number | null };

type Loaded = {
  network?: Network;
  health?: NetworkHealth;
  eeros?: Eero[];
  devices?: Device[];
  profiles?: Profile[];
  speed?: SpeedHistory;
};

const ROWS = ["signed-in", "network", "eeros", "devices", "usage"] as const;
type RowId = (typeof ROWS)[number];

/** A list result, bare or wrapped with a summary (`DeviceList` is `{ devices, summary }`). */
function listOf<T>(value: unknown, key: string): T[] {
  if (Array.isArray(value)) return value as T[];
  const inner = value && typeof value === "object" ? (value as Record<string, unknown>)[key] : null;
  return Array.isArray(inner) ? (inner as T[]) : [];
}

/** Runs commands in order; ok when all succeed, skipped when one is not in this build yet. */
async function load(ids: [string, unknown][]): Promise<{ state: RowState["state"]; results: unknown[] }> {
  const results: unknown[] = [];
  for (const [id, params] of ids) {
    const res = await execute(id, params);
    if (!res.ok) return { state: res.error.code === "unknown_command" ? "skipped" : "failed", results };
    results.push(res.result);
  }
  return { state: "done", results };
}

function FirstRun({ network, signInMs, onDone }: { network: NetworkSummary | null; signInMs: number | null; onDone: () => void }) {
  const account = useQuery<{ name: string | null }>("account.get");
  const [rows, setRows] = useState<Record<RowId, RowState>>(() => ({
    "signed-in": { state: "done", ms: signInMs },
    network: { state: "waiting", ms: null },
    eeros: { state: "waiting", ms: null },
    devices: { state: "waiting", ms: null },
    usage: { state: "waiting", ms: null },
  }));
  const [data, setData] = useState<Loaded>({});

  useEffect(() => {
    let cancelled = false;
    const step = async (row: RowId, ids: [string, unknown][], keep: (results: unknown[]) => Partial<Loaded>) => {
      if (cancelled) return;
      setRows((r) => ({ ...r, [row]: { state: "running", ms: null } }));
      const started = performance.now();
      const { state, results } = await load(ids);
      if (cancelled) return;
      setRows((r) => ({ ...r, [row]: { state, ms: state === "done" ? performance.now() - started : null } }));
      if (state === "done") setData((d) => ({ ...d, ...keep(results) }));
    };
    void (async () => {
      await step("network", [["network.get", {}], ["network.health", {}]], ([n, h]) => ({ network: n as Network, health: h as NetworkHealth }));
      await step("eeros", [["eero.list", {}]], ([e]) => ({ eeros: e as Eero[] }));
      await step("devices", [["device.list", {}], ["profile.list", {}]], ([d, p]) => ({
        devices: listOf<Device>(d, "devices"),
        profiles: listOf<Profile>(p, "profiles"),
      }));
      await step("usage", [["usage.get", { scope: "network", range: "week" }]], () => ({}));
      const speed = await execute<SpeedHistory>("speedtest.history", { limit: 1 });
      if (!cancelled && speed.ok) setData((d) => ({ ...d, speed: speed.result }));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const name = data.network?.name ?? network?.name ?? null;
  const status = data.network?.status ?? network?.status ?? null;
  const offline = status === "offline";
  const firstName = account.data?.name?.split(/\s+/)[0] ?? null;
  const ready = ROWS.slice(0, 4).every((r) => rows[r].state !== "waiting" && rows[r].state !== "running");

  const lead = !name
    ? "Your account is ready."
    : offline
      ? `${name} is offline. You can see its settings and history, but live data is unavailable.`
      : status === "degraded" || data.health?.status === "degraded"
        ? `${name} is online, but something needs a look.`
        : status === "online"
          ? `${name} is online and looking healthy.`
          : `${name} is ready.`;

  const eeroCount = data.eeros?.length ?? data.network?.counts.eeros ?? network?.eeroCount ?? null;
  const devicesTotal = data.devices?.length ?? null;
  const devicesOnline = data.devices ? data.devices.filter((d) => d.connected).length : (network?.devicesOnline ?? null);
  const profiles = data.profiles?.length ?? data.network?.counts.profiles ?? null;
  const lastDown = data.speed?.tests[0]?.downMbps ?? null;

  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const labels: Record<RowId, string> = {
    "signed-in": "Signed in",
    network: "Network and health",
    eeros: eeroCount !== null ? `${plural(eeroCount, "eero")} and mesh links` : "eeros and mesh links",
    devices:
      devicesTotal !== null && profiles !== null
        ? `${plural(devicesTotal, "device")} and ${plural(profiles, "profile")}`
        : "Devices and profiles",
    usage: "7 days of usage history",
  };

  const mac = window.mesh?.platform === "darwin";

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-col items-center text-center">
        <div className="grid size-[76px] place-items-center rounded-full border bg-muted text-success-foreground">
          <Check className="size-9" />
        </div>
        <Title className="mt-[22px]">{firstName ? `You're all set, ${firstName}` : "You're all set"}</Title>
        <Lead>{lead}</Lead>
      </div>

      <div className="mt-3.5 flex flex-wrap justify-center gap-1.5">
        {eeroCount !== null && <Chip icon={<Router />}>{plural(eeroCount, "eero")}</Chip>}
        {devicesOnline !== null && devicesTotal !== null && (
          <Chip icon={<MonitorSmartphone />}>
            {devicesOnline} of {plural(devicesTotal, "device")}
          </Chip>
        )}
        {profiles !== null && <Chip icon={<Users />}>{plural(profiles, "profile")}</Chip>}
        {lastDown !== null && <Chip icon={<Gauge />}>{formatMbps(lastDown)}</Chip>}
      </div>

      <div className="mt-[18px] rounded-(--card-radius) border bg-card px-3.5 py-2" aria-label="Loading your network">
        {ROWS.map((id) => (
          <LoadRow key={id} label={labels[id]} row={rows[id]} hideTime={offline && (id === "eeros" || id === "devices")} />
        ))}
      </div>

      <BigButton className="mt-4" disabled={!ready} onClick={onDone}>
        Open dashboard
      </BigButton>
      <FootNote className="mt-auto block pt-3.5">
        <kbd className="me-1 rounded-[5px] border border-input px-1.5 py-px font-mono text-[10.5px]">{mac ? "⌘ K" : "Ctrl K"}</kbd>
        runs any command. The same commands work from the <span className="font-mono">mesh-ui</span> CLI.
      </FootNote>
    </div>
  );
}

function Chip({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex h-6 items-center gap-1.5 rounded-md border bg-card px-2 font-medium text-xs tabular-nums [&_svg]:size-3.5 [&_svg]:text-muted-foreground">
      {icon}
      {children}
    </span>
  );
}

function LoadRow({ label, row, hideTime }: { label: string; row: RowState; hideTime: boolean }) {
  const time = row.ms === null || hideTime ? null : row.ms < 100 ? "< 0.1 s" : `${(row.ms / 1000).toFixed(1)} s`;
  return (
    <div className={cn("flex items-center gap-2.5 py-1.5 text-[13px]", row.state === "waiting" || row.state === "skipped" ? "text-muted-foreground" : "")}>
      <span className="grid size-5 shrink-0 place-items-center">
        {row.state === "done" && <Check className="size-3 text-success-foreground" strokeWidth={3} />}
        {row.state === "running" && <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-border border-t-muted-foreground" />}
        {row.state === "waiting" && <span aria-hidden className="size-4 rounded-full border-2 border-border" />}
        {row.state === "skipped" && <Minus className="size-3" />}
        {row.state === "failed" && <CircleAlert className="size-3.5 text-warning-foreground" />}
      </span>
      {label}
      <span className="ms-auto text-[11.5px] text-muted-foreground tabular-nums">
        {row.state === "skipped" ? "Not available yet" : row.state === "failed" ? "Failed" : row.state === "done" ? (time ?? "-") : ""}
      </span>
    </div>
  );
}
