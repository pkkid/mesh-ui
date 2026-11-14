/**
 * Name & password (docs/ux/pages/guest.md, Layout 4): the current name and
 * whether there is a password, and the Name & password sheet that changes
 * them with `guest.rename` and `guest.password.set` (both disruptive).
 *
 * The sheet reads the current password with `guest.share` when it opens, so
 * the field can be revealed, copied or cleared; it is held only in the
 * sheet's state. Generate fills the field from `wifi.password.generate`
 * (nothing is saved until Save). Clearing the password makes the network
 * open, which the confirm says plainly. One confirm covers a save that
 * changes both: the password goes first (its confirm names an open
 * network), then the rename runs without asking again.
 */
import { Copy, Eye, EyeOff, KeyRound, Pencil, TriangleAlert, Wand2, Wifi } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";

import { useCommand } from "~/app/useCommand";
import { askInDialog, defaultDeps, fieldErrors, performWrite, type WriteOutcome } from "~/app/useWrite";
import { Button } from "~/components/ui/button";
import { Card, Section } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Meter } from "~/components/ui/meter";
import { GatedButton, useGate } from "~/components/ui/page";
import { Sheet, SheetField } from "~/components/ui/sheet";
import { copyText } from "~/lib/clipboard";
import { GUEST_NAME_MAX, passwordStrength, WIFI_PASSWORD } from "../../../../core/commands/guest";
import type { GuestNetwork, WifiShare } from "../../../../core/model";

type Props = {
  guest: GuestNetwork | undefined;
  /** The main network name (SSID): the guest name must differ from it. */
  networkName: string | null;
  /** After a save, so the hero reads the QR again. */
  onSaved: () => void;
};

export function GuestSettings({ guest, networkName, onSaved }: Props) {
  const gate = useGate({ area: "settings" });
  const [open, setOpen] = useState(false);
  return (
    <Section title="Name & password" subtitle="Saving disconnects current guests">
      <Card padded className="grid gap-4 sm:grid-cols-2">
        <Field label="Guest network name" icon={<Wifi />} hint={networkName ? `Must be different from your main network name, ${networkName}` : undefined}>
          {guest ? (guest.name ?? "-") : ""}
        </Field>
        <Field label="Guest network password" icon={<KeyRound />} hint={guest && !guest.hasPassword ? "Anyone nearby can join an open network." : "Copy it or share the QR code above."}>
          {guest ? (guest.hasPassword ? <span className="tracking-[0.18em]">••••••••••</span> : "Open, no password") : ""}
        </Field>
        <div className="flex gap-2 sm:col-span-2">
          <GatedButton gate={gate} size="sm" variant="outline" disabled={!guest} onClick={() => setOpen(true)}>
            <Pencil />
            Edit name and password
          </GatedButton>
        </div>
      </Card>
      {guest && open && <NamePasswordSheet guest={guest} networkName={networkName} onClose={() => setOpen(false)} onSaved={onSaved} />}
    </Section>
  );
}

const PRINTABLE = /^[\x20-\x7e]*$/;

/** Client-side checks for Save; the commands' zod schemas and the main-name check are the final word. */
function localErrors(name: string, password: string, networkName: string | null): { name?: string; password?: string } {
  const out: { name?: string; password?: string } = {};
  const n = name.trim();
  if (!n) out.name = "Enter a name.";
  else if (n.length > GUEST_NAME_MAX) out.name = `Use at most ${GUEST_NAME_MAX} characters.`;
  else if (networkName && n.toLowerCase() === networkName.trim().toLowerCase()) out.name = "Must be different from your main network name.";
  if (password && password.length < WIFI_PASSWORD.min) out.password = `Use at least ${WIFI_PASSWORD.min} characters, or clear it for an open network.`;
  else if (password.length > WIFI_PASSWORD.max) out.password = `Use at most ${WIFI_PASSWORD.max} characters.`;
  else if (!PRINTABLE.test(password)) out.password = "Use letters, digits, spaces and the symbols on a standard keyboard only.";
  return out;
}

function NamePasswordSheet({ guest, networkName, onClose, onSaved }: { guest: GuestNetwork; networkName: string | null; onClose: () => void; onSaved: () => void }) {
  const share = useCommand<Record<string, never>, WifiShare>("guest.share");
  const generate = useCommand<{ length?: number }, { password: string }>("wifi.password.generate");
  const [loaded, setLoaded] = useState(false);
  const [savedPassword, setSavedPassword] = useState("");
  const [name, setName] = useState(guest.name ?? "");
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const runShare = share.run;
  // Only a successful read fills the field: a failed one must not look like an open network.
  const load = useCallback(async () => {
    const res = await runShare();
    if (!res.ok) return;
    const current = res.result.password ?? "";
    setSavedPassword(current);
    setPassword(current);
    setLoaded(true);
  }, [runShare]);
  useEffect(() => {
    void load();
  }, [load]);

  const nameChanged = name.trim() !== (guest.name ?? "");
  const passwordChanged = loaded && password !== savedPassword;
  const dirty = nameChanged || passwordChanged;
  const local = localErrors(name, password, networkName);
  const errors = { name: serverErrors.name ?? local.name, password: serverErrors.password ?? local.password };
  const opening = loaded && password === "" && savedPassword !== "";
  const strength = password ? passwordStrength(password) : null;

  const save = async (): Promise<WriteOutcome<unknown>> => {
    setServerErrors({});
    setFormError(null);
    const title = opening
      ? "Make the guest network open?"
      : nameChanged && passwordChanged
        ? "Save guest name and password?"
        : nameChanged
          ? "Rename guest network?"
          : "Change guest password?";
    const writes: { id: string; params: Record<string, unknown> }[] = [
      ...(passwordChanged ? [{ id: "guest.password.set", params: { password: password === "" ? null : password } }] : []),
      ...(nameChanged ? [{ id: "guest.rename", params: { name: name.trim() } }] : []),
    ];
    let last: WriteOutcome<unknown> = null;
    for (const [i, w] of writes.entries()) {
      const final = i === writes.length - 1;
      last = await performWrite(
        {
          ...w,
          form: true,
          confirm: { title, confirmLabel: opening ? "Make it open" : "Save" },
          progress: "Saving guest network",
          success: final ? (writes.length > 1 ? "Saved guest name and password" : nameChanged ? "Renamed guest network" : opening ? "Guest network is open" : "Changed guest password") : undefined,
          failure: "Couldn't save the guest network",
        },
        // The first write asks; the one after it was covered by that confirm.
        { ...defaultDeps, ask: i === 0 ? askInDialog : async () => true },
      );
      if (!last) return null;
      if (!last.ok) {
        const fields = fieldErrors(last.error);
        if (Object.keys(fields).length) setServerErrors(fields);
        else setFormError(last.error.message);
        if (i > 0) onSaved();
        return last;
      }
    }
    onSaved();
    return last;
  };

  const fill = async () => {
    const res = await generate.run({});
    if (res.ok) {
      setPassword(res.result.password);
      setReveal(true);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      icon={<Wifi />}
      title="Name & password"
      subtitle={guest.online > 0 ? `Saving disconnects ${guest.online} ${guest.online === 1 ? "guest" : "guests"} now online` : "Saving disconnects current guests"}
      dirty={dirty}
      valid={!local.name && !local.password && loaded}
      onSave={save}
      error={formError}
    >
      <SheetField
        label="Guest network name"
        htmlFor="guest-name"
        error={errors.name}
        helper={`${name.trim().length} / ${GUEST_NAME_MAX} · must be different from ${networkName ?? "your main network name"}`}
      >
        <Input
          id="guest-name"
          value={name}
          aria-invalid={errors.name ? true : undefined}
          onChange={(e) => {
            setName(e.target.value);
            setServerErrors(({ name: _n, ...rest }) => rest);
          }}
        />
      </SheetField>
      <SheetField
        label="Guest network password"
        htmlFor="guest-password"
        error={errors.password}
        helper={strength ? `${strength.label} · ${password.length} characters` : loaded ? "Empty: an open network anyone nearby can join" : share.error ? undefined : "Loading the current password"}
      >
        <div className="flex items-center gap-1.5">
          <Input
            id="guest-password"
            type={reveal ? "text" : "password"}
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
            value={password}
            disabled={!loaded}
            placeholder={loaded ? "No password (open)" : ""}
            aria-invalid={errors.password ? true : undefined}
            onChange={(e) => {
              setPassword(e.target.value);
              setServerErrors(({ password: _p, ...rest }) => rest);
            }}
          />
          <Button type="button" size="icon-sm" variant="ghost-muted" aria-label={reveal ? "Hide password" : "Show password"} disabled={!loaded} onClick={() => setReveal((r) => !r)}>
            {reveal ? <EyeOff /> : <Eye />}
          </Button>
          <Button type="button" size="icon-sm" variant="ghost-muted" aria-label="Copy password" disabled={!password} onClick={() => void copyText(password, { toast: "Copied password" })}>
            <Copy />
          </Button>
          <Button type="button" size="icon-sm" variant="ghost-muted" aria-label="Generate password" title="Generate a strong password" disabled={!loaded || generate.running} onClick={() => void fill()}>
            <Wand2 />
          </Button>
        </div>
        {!loaded && share.error && (
          <div role="alert" className="flex items-center gap-2 text-destructive-foreground text-xs">
            Couldn't read the current password. Nothing can be saved until it loads.
            <Button type="button" size="xs" variant="outline" disabled={share.running} onClick={() => void load()}>
              Retry
            </Button>
          </div>
        )}
        {strength && <Meter value={strength.score} max={4} label={`Password strength, ${strength.label}`} className="mt-1" />}
      </SheetField>
      {opening && (
        <div className="flex items-start gap-2 rounded-lg border bg-muted px-3 py-2 text-foreground/80 text-xs">
          <TriangleAlert className="mt-px size-3.5 shrink-0 text-warning-foreground" />
          With no password the guest network is open: anyone nearby can join. You will be asked to confirm.
        </div>
      )}
    </Sheet>
  );
}

function Field({ label, icon, hint, children }: { label: string; icon: ReactNode; hint?: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-muted-foreground text-xs">{label}</span>
      <div className="flex h-8 items-center gap-2 rounded-(--control-radius) border bg-muted/30 px-2.5 text-sm [&_svg]:size-4 [&_svg]:text-muted-foreground">
        {icon}
        <span className="truncate">{children}</span>
      </div>
      {hint && <span className="text-2xs text-muted-foreground">{hint}</span>}
    </div>
  );
}
