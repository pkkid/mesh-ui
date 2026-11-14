/**
 * Wi-Fi name, password and encryption. The password shows as dots until the
 * eye runs `wifi.password.get` (through the page's reveal, which reads
 * `wifi.share`); copy reads it on demand too. Security per band is shown on
 * a segmented control whose other options are "Coming soon". 6 GHz is always
 * WPA3. docs/ux/pages/wifi.md (Layout, left column 1 and 2).
 */
import { Check, Copy, Dices, Eye, EyeOff, Info, KeyRound, type LucideIcon, ShieldCheck, ShieldHalf, Wifi } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { bandLabel } from "~/components/ui/band-badge";
import { Card, Section } from "~/components/ui/card";
import { ComingSoonButton } from "~/components/ui/page";
import { Segmented } from "~/components/ui/segmented";
import { copyText } from "~/lib/clipboard";
import { cn } from "~/lib/utils";
import { formatCount, MISSING } from "../../../../core/format";
import type { Device, Security, WifiSettings, WirelessBand } from "../../../../core/model";
import type { Reveal } from "./WifiPage";

/** eero allows a 32 byte SSID; count bytes, not characters. */
const SSID_MAX_BYTES = 32;
const bytes = (s: string) => new TextEncoder().encode(s).length;

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

export function WifiNamePassword({ wifi, reveal }: { wifi: WifiSettings | null; reveal: Reveal }) {
  const [shown, setShown] = useState(false);
  const password = reveal.share?.password ?? null;
  // A network switch drops the revealed password; hide again so the next one is not read unasked.
  useEffect(() => {
    if (!reveal.share) setShown(false);
  }, [reveal.share]);
  const ssid = wifi?.ssid ?? null;
  const open = wifi !== null && !wifi.hasPassword;

  const passwordValue = !wifi ? null : open ? "No password (open network)" : shown && password ? password : "••••••••••••";
  const toggle = async () => {
    if (shown) return setShown(false);
    if (await reveal.load()) setShown(true);
  };

  return (
    <Section
      title="Network name and password"
      subtitle="SSID and WPA passphrase for the main network"
      tools={
        <ComingSoonButton size="xs" variant="outline">
          Change
        </ComingSoonButton>
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
            hint={reveal.error ? <span className="text-destructive-foreground">{reveal.error}</span> : shown && password ? `${formatCount(password.length)} characters` : "Hidden until you reveal it"}
            actions={
              open ? null : (
                <>
                  <IconButton label={shown ? "Hide password" : "Reveal password"} disabled={!wifi || reveal.loading} onClick={() => void toggle()}>
                    {shown ? <EyeOff /> : <Eye />}
                  </IconButton>
                  <CopyIcon label="Copy password" disabled={!wifi} text={async () => (await reveal.load())?.password ?? null} />
                  <IconButton label="Generate a password (coming soon)" disabled>
                    <Dices />
                  </IconButton>
                </>
              )
            }
          />
        </div>
      </Card>
    </Section>
  );
}

const MODES: { value: Security; label: string; icon: LucideIcon }[] = [
  { value: "WPA2", label: "Standard (WPA2)", icon: ShieldHalf },
  { value: "WPA2_WPA3", label: "Hybrid (WPA2 + WPA3)", icon: ShieldHalf },
  { value: "WPA3", label: "Enhanced (WPA3)", icon: ShieldCheck },
];

const PLACEHOLDER_BANDS: WirelessBand[] = ["2.4", "5"];

export function WifiSecurity({ wifi, devices, offline }: { wifi: WifiSettings | null; devices: Device[] | null; offline: boolean }) {
  const bands: WirelessBand[] = wifi ? wifi.bands.map((b) => b.band) : PLACEHOLDER_BANDS;
  const byId = new Map((devices ?? []).map((d) => [d.id, d]));
  const wpa2Only = (wifi?.wpa2OnlyDevices ?? []).map((id) => byId.get(id)).filter((d): d is Device => d !== undefined);
  // Only a hybrid band tells WPA2 only devices apart, and only while they are connected.
  const perBand = (band: WirelessBand) => (devices && !offline && wifi?.security[band] === "WPA2_WPA3" ? wpa2Only.filter((d) => d.band === band).length : null);
  const names = wpa2Only.map((d) => d.name);
  const has6 = bands.includes("6");

  return (
    <Section title="Encryption" subtitle="WPA3 support per band">
      <Card>
        <div className="grid grid-cols-[8rem_minmax(0,1fr)_auto] items-center gap-4 border-b bg-muted/40 px-[18px] py-2 font-semibold text-3xs text-muted-foreground uppercase tracking-widest">
          <span>Band</span>
          <span>Security mode</span>
          <span className="text-right">WPA2 only</span>
        </div>
        {bands.map((band) => {
          const value = wifi?.security[band] ?? null;
          const count = perBand(band);
          return (
            <div key={band} className="grid grid-cols-[8rem_minmax(0,1fr)_auto] items-center gap-4 border-b border-border/50 px-[18px] py-3 last:border-b-0">
              <span className="font-medium text-[13px]">{bandLabel(band)}</span>
              <div className="min-w-0 overflow-x-auto">
                {value ? (
                  <span title={band === "6" ? "6 GHz always uses WPA3" : "Coming soon"} className="inline-flex">
                    <Segmented<Security>
                      aria-label={`${bandLabel(band)} security mode`}
                      value={value}
                      onValueChange={() => {}}
                      // Changes come later; only the current mode stays selectable so it reads at full contrast.
                      options={MODES.map((m) => ({ ...m, disabled: m.value !== value }))}
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
