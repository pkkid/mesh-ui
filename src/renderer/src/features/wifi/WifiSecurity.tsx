/**
 * Wi-Fi name, password and encryption. The password shows as dots until the
 * eye runs `wifi.password.get`; copy reads it on demand too. **Change** opens
 * the name and password sheet (Generate runs `wifi.password.generate`); Save
 * runs `wifi.name.set` then `wifi.password.set`, each after an inline
 * confirm carrying the engine's impact message. Security per band stages a
 * change on a segmented control; the impact and an inline confirm show
 * before `wifi.security.set`. 6 GHz is always WPA3.
 * docs/ux/pages/wifi.md (Layout, left column 1 and 2).
 */
import { Check, Copy, Dices, Eye, EyeOff, Info, KeyRound, type LucideIcon, Pencil, ShieldCheck, ShieldHalf, Wifi } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { execute } from "~/app/useCommand";
import { fieldErrors, useWrite } from "~/app/useWrite";
import { bandLabel } from "~/components/ui/band-badge";
import { Button } from "~/components/ui/button";
import { Card, Section } from "~/components/ui/card";
import { WriteConfirm } from "~/components/ui/confirm";
import { Input } from "~/components/ui/input";
import { GatedButton, useGate } from "~/components/ui/page";
import { Segmented } from "~/components/ui/segmented";
import { Sheet, SheetField } from "~/components/ui/sheet";
import { copyText } from "~/lib/clipboard";
import { cn } from "~/lib/utils";
import { formatCount, MISSING } from "../../../../core/format";
import type { Device, Security, WifiSettings, WirelessBand } from "../../../../core/model";
import { type GeneratedPassword, SSID_MAX_BYTES, ssidBytes as bytes, WIFI_PASSWORD, type WifiPassword } from "../../../../core/commands/wifi";
import { WifiImpact } from "./WifiImpact";
import type { Secret } from "./WifiPage";

/** Wi-Fi writes need the `settings` update permission (same table as the palette). */
const GATE = { area: "settings" } as const;
const PRINTABLE = /^[\x20-\x7E]*$/;

/** A labelled read-only value in an input-like box, with small icon buttons on the right. */
export function ReadField({
  icon: Icon,
  label,
  value,
  hint,
  mono = false,
  actions,
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  mono?: boolean;
  actions?: ReactNode;
}) {
  const missing = value === null || value === undefined || value === "";
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-center gap-1.5 text-muted-foreground text-xs">
        <Icon aria-hidden className="size-3.5" />
        {label}
      </div>
      <div className="flex h-8 items-center gap-2 rounded-lg border border-input bg-background ps-3 pe-1 text-sm dark:bg-input/32">
        <span className={cn("min-w-0 flex-1 truncate", mono && "font-mono text-[13px]", missing && "text-muted-foreground")} aria-label={label}>
          {missing ? MISSING : value}
        </span>
        {actions && <span className="flex shrink-0 items-center gap-0.5">{actions}</span>}
      </div>
      {hint && <div className="mt-1 text-2xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick?: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-3.5"
    >
      {children}
    </button>
  );
}

/** A copy button that reads its text on demand and shows a check for a moment. */
function CopyIcon({ label, text, disabled }: { label: string; text: () => Promise<string | null> | string | null; disabled?: boolean }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1200);
    return () => clearTimeout(t);
  }, [done]);
  return (
    <IconButton
      label={done ? "Copied" : label}
      disabled={disabled}
      onClick={() => {
        void (async () => {
          const value = await text();
          if (value && (await copyText(value))) setDone(true);
        })();
      }}
    >
      {done ? <Check /> : <Copy />}
    </IconButton>
  );
}

export function WifiNamePassword({
  wifi,
  password: secret,
  offline = false,
  onSaved,
}: {
  wifi: WifiSettings | null;
  password: Secret<WifiPassword>;
  offline?: boolean;
  /** After a name or password change: drop revealed credentials so the next reveal reads the new ones. */
  onSaved?: () => void;
}) {
  const [shown, setShown] = useState(false);
  const [editing, setEditing] = useState(false);
  const gate = useGate(GATE);
  const password = secret.value?.password ?? null;
  // A network switch drops the revealed password; hide again so the next one is not read unasked.
  useEffect(() => {
    if (!secret.value) setShown(false);
  }, [secret.value]);
  const ssid = wifi?.ssid ?? null;
  const open = wifi !== null && !wifi.hasPassword;

  const passwordValue = !wifi ? null : open ? "No password (open network)" : shown && password ? password : "••••••••••••";
  const toggle = async () => {
    if (shown) return setShown(false);
    if (await secret.load()) setShown(true);
  };

  return (
    <Section
      title="Network name and password"
      subtitle="SSID and WPA passphrase for the main network"
      tools={
        <GatedButton size="xs" variant="outline" gate={gate} disabled={!wifi || offline} onClick={() => setEditing(true)}>
          <Pencil />
          Change
        </GatedButton>
      }
    >
      <Card padded>
        <div className="grid gap-4 md:grid-cols-2">
          <ReadField
            icon={Wifi}
            label="Wi-Fi network name"
            value={ssid}
            hint={ssid !== null ? `${formatCount(bytes(ssid))} of ${SSID_MAX_BYTES} bytes` : null}
            actions={<CopyIcon label="Copy network name" text={() => ssid} disabled={!ssid} />}
          />
          <ReadField
            icon={KeyRound}
            label="Wi-Fi password"
            mono={shown}
            value={passwordValue}
            hint={secret.error ? <span className="text-destructive-foreground">{secret.error}</span> : shown && password ? `${formatCount(password.length)} characters` : "Hidden until you reveal it"}
            actions={
              open ? null : (
                <>
                  <IconButton label={shown ? "Hide password" : "Reveal password"} disabled={!wifi || secret.loading} onClick={() => void toggle()}>
                    {shown ? <EyeOff /> : <Eye />}
                  </IconButton>
                  <CopyIcon label="Copy password" disabled={!wifi} text={async () => (await secret.load())?.password ?? null} />
                </>
              )
            }
          />
        </div>
      </Card>
      {wifi && <NamePasswordSheet open={editing} onClose={() => setEditing(false)} wifi={wifi} onSaved={onSaved} />}
    </Section>
  );
}

/** Client checks matching the commands' zod rules; the engine is the final word. */
function nameProblem(name: string): string | undefined {
  if (name.trim() === "") return "The Wi-Fi name can not be empty.";
  if (bytes(name) > SSID_MAX_BYTES) return `The Wi-Fi name is ${SSID_MAX_BYTES} bytes at most.`;
  return undefined;
}

function passwordProblem(pw: string): string | undefined {
  if (pw === "") return undefined;
  if (!PRINTABLE.test(pw)) return "Use letters, digits, spaces and plain symbols only.";
  if (pw.length < WIFI_PASSWORD.min) return `At least ${WIFI_PASSWORD.min} characters.`;
  if (pw.length > WIFI_PASSWORD.max) return `${WIFI_PASSWORD.max} characters at most.`;
  return undefined;
}

/**
 * Name and password sheet. The password field starts empty (the current one
 * is never read to fill it); leaving it empty keeps the password. Save runs
 * the name, then the password, each after its inline confirm.
 */
function NamePasswordSheet({ open, onClose, wifi, onSaved }: { open: boolean; onClose: () => void; wifi: WifiSettings; onSaved?: () => void }) {
  const [name, setName] = useState(wifi.ssid);
  const [pw, setPw] = useState("");
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!open) return;
    setName(wifi.ssid);
    setPw("");
    setShown(false);
  }, [open, wifi.ssid]);

  const rename = useWrite<{ name: string }, WifiSettings>("wifi.name.set", {
    success: (r) => `Wi-Fi renamed to ${r.ssid}`,
    progress: "Renaming Wi-Fi...",
    progressDetail: "Wireless devices drop and rejoin",
    confirm: { confirmLabel: "Rename and reconnect" },
    form: true,
  });
  const repass = useWrite<{ password: string }, WifiSettings>("wifi.password.set", {
    success: "Wi-Fi password changed",
    progress: "Changing the Wi-Fi password...",
    progressDetail: "Wireless devices drop and rejoin",
    confirm: { confirmLabel: "Change and reconnect" },
    form: true,
  });

  const nameDirty = name !== wifi.ssid;
  const pwDirty = pw !== "";
  const nameError = (nameDirty ? nameProblem(name) : undefined) ?? fieldErrors(rename.error).name;
  const pwError = passwordProblem(pw) ?? fieldErrors(repass.error).password;
  const formError = fieldErrors(rename.error)._form ?? fieldErrors(repass.error)._form;

  const generate = async () => {
    const r = await execute<GeneratedPassword>("wifi.password.generate", {});
    if (r.ok) {
      setPw(r.result.password);
      setShown(true);
    }
  };

  const save = async () => {
    if (nameDirty) {
      const r = await rename.run({ name });
      if (!r?.ok) return r;
      onSaved?.();
    }
    if (pwDirty) {
      const r = await repass.run({ password: pw });
      if (!r?.ok) return r;
      onSaved?.();
    }
    return { ok: true };
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      icon={<Wifi />}
      title="Network name and password"
      subtitle={`${wifi.ssid} · every wireless device rejoins after a change`}
      dirty={nameDirty || pwDirty}
      valid={!nameProblem(name) && !passwordProblem(pw)}
      onSave={save}
      saveLabel="Save and reconnect"
      error={formError}
    >
      <SheetField label="Wi-Fi network name" htmlFor="wifi-sheet-name" error={nameError} helper={`${formatCount(bytes(name))} of ${SSID_MAX_BYTES} bytes`}>
        <Input id="wifi-sheet-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" spellCheck={false} aria-invalid={nameError ? true : undefined} />
      </SheetField>
      <SheetField
        label="New password"
        htmlFor="wifi-sheet-password"
        error={pwError}
        helper={pwDirty ? `${formatCount(pw.length)} characters` : "Leave empty to keep the current password"}
      >
        <div className="flex items-center gap-1.5">
          <Input
            id="wifi-sheet-password"
            type={shown ? "text" : "password"}
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            autoComplete="new-password"
            spellCheck={false}
            className={cn(shown && "font-mono")}
            aria-invalid={pwError ? true : undefined}
          />
          <IconButton label={shown ? "Hide password" : "Show password"} onClick={() => setShown((v) => !v)}>
            {shown ? <EyeOff /> : <Eye />}
          </IconButton>
          <Button type="button" size="sm" variant="outline" onClick={() => void generate()}>
            <Dices />
            Generate
          </Button>
        </div>
      </SheetField>
      <WriteConfirm write={rename}>
        <WriteConfirm write={repass}>
          <WifiImpact params={pwDirty ? { change: "password" } : nameDirty ? { change: "name" } : null} />
        </WriteConfirm>
      </WriteConfirm>
    </Sheet>
  );
}

const MODES: { value: Security; label: string; icon: LucideIcon }[] = [
  { value: "WPA2", label: "Standard (WPA2)", icon: ShieldHalf },
  { value: "WPA2_WPA3", label: "Hybrid (WPA2 + WPA3)", icon: ShieldHalf },
  { value: "WPA3", label: "Enhanced (WPA3)", icon: ShieldCheck },
];

const PLACEHOLDER_BANDS: WirelessBand[] = ["2.4", "5"];

type Staged = Partial<Record<"2.4" | "5", Security>>;
const PARAM: Record<"2.4" | "5", "band24" | "band5"> = { "2.4": "band24", "5": "band5" };

export function WifiSecurity({ wifi, devices, offline }: { wifi: WifiSettings | null; devices: Device[] | null; offline: boolean }) {
  const bands: WirelessBand[] = wifi ? wifi.bands.map((b) => b.band) : PLACEHOLDER_BANDS;
  const byId = new Map((devices ?? []).map((d) => [d.id, d]));
  const wpa2Only = (wifi?.wpa2OnlyDevices ?? []).map((id) => byId.get(id)).filter((d): d is Device => d !== undefined);
  // Only a hybrid band tells WPA2 only devices apart, and only while they are connected.
  const perBand = (band: WirelessBand) => (devices && !offline && wifi?.security[band] === "WPA2_WPA3" ? wpa2Only.filter((d) => d.band === band).length : null);
  const names = wpa2Only.map((d) => d.name);
  const has6 = bands.includes("6");

  const gate = useGate(GATE);
  const [staged, setStaged] = useState<Staged>({});
  // A network switch or a saved change resets what is staged.
  const key = wifi ? `${wifi.ssid}|${wifi.security["2.4"]}|${wifi.security["5"]}` : "";
  useEffect(() => setStaged({}), [key]);
  const save = useWrite<Record<string, Security>, WifiSettings>("wifi.security.set", {
    success: "Wi-Fi security changed",
    progress: "Changing Wi-Fi security...",
    progressDetail: "eeros restart to apply it",
    confirm: { confirmLabel: "Save and restart" },
  });
  const editable = gate.allowed && !offline && wifi !== null;
  const stage = (band: WirelessBand, mode: Security) => {
    if (band === "6" || !wifi) return;
    setStaged((s) => {
      const next = { ...s };
      if (wifi.security[band] === mode) delete next[band];
      else next[band] = mode;
      return next;
    });
  };
  const changes = Object.entries(staged) as ["2.4" | "5", Security][];
  const params = Object.fromEntries(changes.map(([band, mode]) => [PARAM[band], mode]));

  return (
    <Section title="Encryption" subtitle="WPA3 support per band">
      <Card>
        <div className="grid grid-cols-[8rem_minmax(0,1fr)_auto] items-center gap-4 border-b bg-muted/40 px-[18px] py-2 font-semibold text-3xs text-muted-foreground uppercase tracking-widest">
          <span>Band</span>
          <span>Security mode</span>
          <span className="text-right">WPA2 only</span>
        </div>
        {bands.map((band) => {
          const saved = wifi?.security[band] ?? null;
          const value = band === "6" ? saved : ((staged as Record<string, Security>)[band] ?? saved);
          const count = perBand(band);
          const fixed = band === "6";
          const title = fixed ? "6 GHz always uses WPA3" : !editable ? (gate.reason ?? (offline ? "The network is offline" : undefined)) : undefined;
          return (
            <div key={band} className="grid grid-cols-[8rem_minmax(0,1fr)_auto] items-center gap-4 border-b border-border/50 px-[18px] py-3 last:border-b-0">
              <span className="font-medium text-[13px]">
                {bandLabel(band)}
                {!fixed && value !== saved && <span className="ms-1.5 font-normal text-muted-foreground text-2xs">edited</span>}
              </span>
              <div className="min-w-0 overflow-x-auto">
                {value ? (
                  <span title={title} className="inline-flex">
                    <Segmented<Security>
                      aria-label={`${bandLabel(band)} security mode`}
                      value={value}
                      onValueChange={(mode) => stage(band, mode)}
                      // 6 GHz and a locked control keep only the current mode selectable so it reads at full contrast.
                      options={MODES.map((m) => ({ ...m, disabled: (fixed || !editable || save.running) && m.value !== value }))}
                    />
                  </span>
                ) : (
                  <span className="text-muted-foreground text-xs">{wifi ? "Unknown" : MISSING}</span>
                )}
              </div>
              <span className="text-right text-xs tabular-nums">
                {count === null ? (
                  <span className="text-muted-foreground">{MISSING}</span>
                ) : (
                  <>
                    <b className="font-medium">{formatCount(count)}</b> <span className="text-muted-foreground">{count === 1 ? "device" : "devices"}</span>
                  </>
                )}
              </span>
            </div>
          );
        })}
        {changes.length > 0 && (
          <div className="flex flex-col gap-3 border-t px-[18px] py-3">
            <WriteConfirm write={save}>
              <WifiImpact params={{ change: "security", ...params }} />
              <div className="mt-3 flex items-center justify-end gap-2">
                <span className="me-auto text-muted-foreground text-xs">
                  {formatCount(changes.length)} unsaved {changes.length === 1 ? "change" : "changes"}
                </span>
                <Button size="sm" variant="ghost" disabled={save.running} onClick={() => setStaged({})}>
                  Discard
                </Button>
                <Button size="sm" disabled={save.running} onClick={() => void save.run(params)}>
                  Save and restart
                </Button>
              </div>
            </WriteConfirm>
          </div>
        )}
        <div className="flex items-start gap-2 border-t px-[18px] py-3 text-muted-foreground text-xs">
          <Info aria-hidden className="mt-px size-3.5 shrink-0" />
          <span>
            {has6 ? "6 GHz always uses Enhanced (WPA3). " : ""}
            {names.length > 0 ? (
              <>
                <b className="font-medium text-foreground">{listNames(names)}</b> joined with WPA2 only and would drop off if their band moved to Enhanced (WPA3).
              </>
            ) : wifi && bands.some((b) => wifi.security[b] === "WPA2_WPA3") ? (
              "No device has joined with WPA2 only."
            ) : (
              "Devices that only speak WPA2 show here once the network offers WPA3 alongside it."
            )}
          </span>
        </div>
      </Card>
    </Section>
  );
}

/** "A, B and C"; more than four end in "and N more". */
function listNames(names: string[]): string {
  const shown = names.length > 4 ? [...names.slice(0, 3), `${names.length - 3} more`] : names;
  return shown.length <= 1 ? (shown[0] ?? "") : `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}`;
}
