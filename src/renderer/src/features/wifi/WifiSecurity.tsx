/**
 * Wi-Fi name, password and encryption. The password shows as dots until the
 * eye runs `wifi.password.get`; copy reads it on demand too. **Change** opens
 * the name and password sheet (Generate runs `wifi.password.generate`); Save
 * runs `wifi.name.set` then `wifi.password.set`, each after a confirm
 * dialog carrying the engine's impact message. Security per band stages a
 * change on a segmented control; the impact and a confirm dialog show
 * before `wifi.security.set`. 6 GHz is always WPA3.
 * docs/ux/pages/wifi.md (Layout, left column 1 and 2).
 */
import { Check, Copy, Dices, Eye, EyeOff, Pencil, Wifi } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { execute } from "~/app/useCommand";
import { fieldErrors, useWrite } from "~/app/useWrite";
import { bandLabel } from "~/components/ui/band-badge";
import { Button } from "~/components/ui/button";
import { WriteConfirmDialog } from "~/components/ui/confirm";
import { Input } from "~/components/ui/input";
import { Footnote, GatedButton, useGate } from "~/components/ui/page";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Status } from "~/components/ui/status";
import { Row as SettingsRow } from "~/features/advanced/SettingsGroups";
import { Sheet, SheetField } from "~/components/ui/sheet";
import { copyText } from "~/lib/clipboard";
import { cn } from "~/lib/utils";
import { formatCount, MISSING } from "../../../../core/format";
import type { Device, Security, WifiSettings, WirelessBand } from "../../../../core/model";
import { type GeneratedPassword, SSID_MAX_BYTES, ssidBytes as bytes, WIFI_PASSWORD, type WifiPassword } from "../../../../core/commands/wifi";
import { WifiImpact } from "./WifiImpact";
import { SECURITY_LABEL } from "./WifiHero";
import type { Secret } from "./WifiPage";

/** Wi-Fi writes need the `settings` update permission (same table as the palette). */
const GATE = { area: "settings" } as const;
const PRINTABLE = /^[\x20-\x7E]*$/;

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

/** The Wi-Fi settings' Edit name and password… button (section header): needs `settings` updates and an online network. */
export function EditNamePasswordButton({ wifi, offline, onClick }: { wifi: WifiSettings | null; offline: boolean; onClick: () => void }) {
  const gate = useGate(GATE);
  return (
    <GatedButton variant="outline" className="[&_svg]:text-muted-foreground" gate={gate} disabled={!wifi || offline} onClick={onClick}>
      <Pencil />
      Edit name and password{"\u2026"}
    </GatedButton>
  );
}

/**
 * The Name and Password rows of the Wi-Fi settings, and the name and password
 * sheet while `editing` (the page's Edit name and password… opens it).
 */
export function NamePasswordRows({
  wifi,
  password: secret,
  editing,
  onEditDone,
  onSaved,
}: {
  wifi: WifiSettings | null;
  password: Secret<WifiPassword>;
  editing: boolean;
  onEditDone: () => void;
  /** After a name or password change: drop revealed credentials so the next reveal reads the new ones. */
  onSaved?: () => void;
}) {
  const [shown, setShown] = useState(false);
  const password = secret.value?.password ?? null;
  // A network switch drops the revealed password; hide again so the next one is not read unasked.
  useEffect(() => {
    if (!secret.value) setShown(false);
  }, [secret.value]);
  const ssid = wifi?.ssid ?? null;
  const open = wifi !== null && !wifi.hasPassword;

  const passwordValue = !wifi ? MISSING : shown && password ? password : "••••••••••";
  const toggle = async () => {
    if (shown) return setShown(false);
    if (await secret.load()) setShown(true);
  };

  return (
    <>
      <SettingsRow
        title="Name"
        description={ssid ? `${formatCount(bytes(ssid))} of ${SSID_MAX_BYTES} bytes, shared by every band.` : "Shared by every band."}
        control={
          <span className="flex items-center gap-1.5">
            <span className="max-w-56 truncate text-sm">{ssid ?? MISSING}</span>
            <CopyIcon label="Copy network name" text={() => ssid} disabled={!ssid} />
          </span>
        }
      />
      <SettingsRow
        title="Password"
        description={
          secret.error ? (
            <span className="text-destructive-foreground">{secret.error}</span>
          ) : !wifi ? undefined : open ? (
            "Anyone nearby can join an open network."
          ) : shown && password ? (
            `${formatCount(password.length)} characters. Read from eero only when you reveal or copy it.`
          ) : (
            "Read from eero only when you reveal or copy it."
          )
        }
        control={
          open ? (
            <Status tone="warning">Open, no password</Status>
          ) : (
            <span className="flex items-center gap-1.5">
              <span className={cn("max-w-56 truncate text-sm", shown && password ? "font-mono" : "tracking-[0.18em]")}>{passwordValue}</span>
              <IconButton label={shown ? "Hide password" : "Reveal password"} disabled={!wifi || secret.loading} onClick={() => void toggle()}>
                {shown ? <EyeOff /> : <Eye />}
              </IconButton>
              <CopyIcon label="Copy password" disabled={!wifi} text={async () => (await secret.load())?.password ?? null} />
            </span>
          )
        }
      />
      {wifi && <NamePasswordSheet open={editing} onClose={onEditDone} wifi={wifi} onSaved={onSaved} />}
    </>
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
 * the name, then the password, each after its confirm dialog.
 */
function NamePasswordSheet({ open, onClose, wifi, onSaved }: { open: boolean; onClose: () => void; wifi: WifiSettings; onSaved?: () => void }) {
  const [name, setName] = useState(wifi.ssid);
  const [pw, setPw] = useState("");
  const [shown, setShown] = useState(false);
  // Reset only when the sheet opens: a rename refetches the SSID mid-save, and the password draft must survive it.
  const ssid = wifi.ssid;
  useEffect(() => {
    if (!open) return;
    setName(ssid);
    setPw("");
    setShown(false);
  }, [open]);

  const rename = useWrite<{ name: string }, WifiSettings>("wifi.name.set", {
    confirmIn: "nested",
    success: (r) => `Wi-Fi renamed to ${r.ssid}`,
    progress: "Renaming Wi-Fi...",
    progressDetail: "Wireless devices drop and rejoin",
    confirm: { confirmLabel: "Rename and reconnect" },
    form: true,
  });
  const repass = useWrite<{ password: string }, WifiSettings>("wifi.password.set", {
    confirmIn: "nested",
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
      subtitle={`${wifi.ssid}, every wireless device rejoins after a change`}
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
      <WifiImpact params={pwDirty ? { change: "password" } : nameDirty ? { change: "name" } : null} />
      <WriteConfirmDialog write={rename} />
      <WriteConfirmDialog write={repass} />
    </Sheet>
  );
}

/** The modes in each band's dropdown, with eero's full names. */
const MODES: { value: Security; label: string }[] = (["WPA2", "WPA2_WPA3", "WPA3"] as const).map((value) => ({ value, label: SECURITY_LABEL[value] }));

const PLACEHOLDER_BANDS: WirelessBand[] = ["2.4", "5"];

type Staged = Partial<Record<"2.4" | "5", Security>>;
const PARAM: Record<"2.4" | "5", "band24" | "band5"> = { "2.4": "band24", "5": "band5" };

/**
 * The security rows of the Wi-Fi settings: one per band with its mode in a dropdown (6 GHz is
 * fixed to WPA3), and under each band's title the devices that joined it with
 * WPA2 only. A change is staged (`edited`), then the impact and Save and
 * restart… (confirm dialog) before `wifi.security.set`.
 */
export function SecurityRows({ wifi, devices, offline }: { wifi: WifiSettings | null; devices: Device[] | null; offline: boolean }) {
  const bands: WirelessBand[] = wifi ? wifi.bands.map((b) => b.band) : PLACEHOLDER_BANDS;
  const byId = new Map((devices ?? []).map((d) => [d.id, d]));
  const wpa2Only = (wifi?.wpa2OnlyDevices ?? []).map((id) => byId.get(id)).filter((d): d is Device => d !== undefined);
  // Only a hybrid band tells WPA2 only devices apart, and only while they are connected.
  const onBand = (band: WirelessBand) => (devices && !offline && wifi?.security[band] === "WPA2_WPA3" ? wpa2Only.filter((d) => d.band === band) : null);

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
    <>
      {bands.map((band) => {
        const saved = wifi?.security[band] ?? null;
        const value = band === "6" ? saved : ((staged as Record<string, Security>)[band] ?? saved);
        const these = onBand(band);
        const fixed = band === "6";
        const title = fixed ? "6 GHz always uses WPA3" : !editable ? (gate.reason ?? (offline ? "The network is offline" : undefined)) : undefined;
        return (
          <SettingsRow
            key={band}
            title={
              <>
                {bandLabel(band)} security
                {!fixed && value !== saved && <span className="font-normal text-muted-foreground text-2xs">edited</span>}
              </>
            }
            description={
              fixed
                ? "Always WPA3."
                : these === null
                  ? wifi?.security[band] === "WPA2_WPA3"
                    ? undefined
                    : "Devices on WPA2 only show here while this band is Hybrid."
                  : these.length === 0
                    ? "No device joined with WPA2 only."
                    : `${listNames(these.map((d) => d.name))} joined with WPA2 only.`
            }
            control={
              value ? (
                <span title={title} className="inline-flex">
                  <Select items={MODES} value={value} onValueChange={(mode) => mode && stage(band, mode as Security)} disabled={fixed || !editable || save.running}>
                    <SelectTrigger className="w-52" aria-label={`${bandLabel(band)} security mode`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectPopup>
                      {MODES.map((m) => (
                        <SelectItem key={m.value} value={m.value}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </span>
              ) : (
                <span className="text-muted-foreground text-xs">{wifi ? "Unknown" : MISSING}</span>
              )
            }
          />
        );
      })}
      {changes.length > 0 && (
        <div className="flex flex-col gap-3 px-4 py-3">
          <WifiImpact params={{ change: "security", ...params }} />
          <div className="mt-3 flex items-center justify-end gap-2">
            <span className="me-auto text-muted-foreground text-xs">
              {formatCount(changes.length)} unsaved {changes.length === 1 ? "change" : "changes"}
            </span>
            <Button size="sm" variant="ghost" disabled={save.running} onClick={() => setStaged({})}>
              Discard
            </Button>
            <Button size="sm" variant="outline" disabled={save.running} onClick={() => void save.run(params)}>
              Save and restart{"\u2026"}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

/** The footnote under the Wi-Fi settings: what the security rows mean. */
export function SecurityFootnote({ wifi }: { wifi: WifiSettings | null }) {
  const has6 = (wifi?.bands ?? []).some((b) => b.band === "6");
  return (
    <Footnote>
      {has6 ? "6 GHz always uses WPA3. " : ""}
      Moving a band to Enhanced (WPA3) drops the devices that joined it with WPA2 only; the eeros restart to apply any change.
    </Footnote>
  );
}

/** "A, B and C"; more than four end in "and N more". */
function listNames(names: string[]): string {
  const shown = names.length > 4 ? [...names.slice(0, 3), `${names.length - 3} more`] : names;
  return shown.length <= 1 ? (shown[0] ?? "") : `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}`;
}
