/**
 * eero detail, two sections. "eero settings": T3-style settings rows in one
 * card (the name is changed from the hero's Rename…; Status
 * light `eero.led.set`: switch, brightness on release; Nightlight, Beacon
 * only, `eero.nightlight.set`: mode, brightness, times; then Remove eero).
 * "Device information": Software (`updates.get` plus
 * `eero.firmware.history`), IP addresses and Device information cards. Writes
 * dim with the reason when the eero is offline or the role cannot change
 * eeros. docs/ux/pages/eero-detail.md (Layout 4, Actions).
 */
import { Check, Copy, Cpu, Download, type LucideIcon, Network } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { pathFor } from "~/app/router";
import { useQuery } from "~/app/useCommand";
import { type Gate, useWrite } from "~/app/useWrite";
import { Button } from "~/components/ui/button";
import { Card, Section } from "~/components/ui/card";
import { IconTile } from "~/components/ui/hero";
import { useGate } from "~/components/ui/page";
import { KvList } from "~/components/ui/kv-list";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "~/components/ui/select";
import { TextLink } from "~/components/ui/text-link";
import { Row as SettingsRow, WriteSwitch } from "~/features/advanced/SettingsGroups";
import { Status, type StatusTone } from "~/components/ui/status";
import { copyText } from "~/lib/clipboard";
import { cn } from "~/lib/utils";
import { type Clock, formatPercent, MISSING } from "../../../../core/format";
import type { Eero, FirmwareEntry, Updates } from "../../../../core/model";
import { ipText, updateWindow } from "./helpers";

type NightMode = NonNullable<Eero["nightlight"]>["mode"];
const MODES = [
  { value: "off", label: "Off" },
  { value: "ambient", label: "Ambient" },
  { value: "schedule", label: "Scheduled" },
] as const satisfies ReadonlyArray<{ value: NightMode; label: string }>;

/** Whether this eero's settings can change now: the role gate, then offline or restarting. */
function useEeroGate(eero: Eero | null, capability?: string): Gate {
  const gate = useGate({ area: "eeros", capability });
  if (!eero) return { allowed: false, reason: null };
  if (eero.status === "offline") return { allowed: false, reason: `${eero.location} is offline` };
  if (eero.status === "updating") return { allowed: false, reason: `${eero.location} is restarting` };
  return gate;
}

/** "eero settings": one card of settings rows (T3 Code's settings groups), Remove last. */
export function EeroSettings({ eero, remove }: { eero: Eero | null; remove: ReactNode }) {
  // "Status light on, nightlight off": what the settings are set to now.
  const led = eero ? (eero.led.on === null ? null : `status light ${eero.led.on ? "on" : "off"}`) : null;
  const night = eero?.nightlight ? `nightlight ${MODE_WORD[eero.nightlight.mode].toLowerCase()}` : null;
  const parts = [led, night].filter(Boolean).join(", ");
  const description = parts ? parts.charAt(0).toUpperCase() + parts.slice(1) : "-";
  return (
    <Section title="eero settings" description={description} className="gap-[15px]">
      <Card className="divide-y divide-border/50">
        <StatusLightRow eero={eero} />
        <NightlightRow eero={eero} />
        {remove}
      </Card>
    </Section>
  );
}

/** "Device information": the read-only cards, side by side. */
export function EeroInfo({ eero, clock }: { eero: Eero | null; clock: Clock }) {
  // "eero Pro 7, joined Mar 3, 2025": what it is and how long it has been here.
  const joined = eero?.joined ? new Date(eero.joined).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : null;
  const description = eero ? [eero.model, joined ? `joined ${joined}` : null].filter(Boolean).join(", ") || "-" : "-";
  return (
    <Section title="Device information" description={description} className="gap-[15px]">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {/* eero runs no eeroOS on an eero Built-in device and reports no version for it. */}
        {eero?.kind !== "builtin" && <SoftwareCard eero={eero} clock={clock} />}
        <IpCard eero={eero} />
        <InfoCard eero={eero} />
      </div>
    </Section>
  );
}

function SettingsCard({ icon, title, sub, side, children }: { icon: LucideIcon; title: string; sub: ReactNode; side?: ReactNode; children: ReactNode }) {
  return (
    <Card padded className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <IconTile icon={icon} />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-sm">{title}</div>
          <div className="truncate text-muted-foreground text-xs">{sub}</div>
        </div>
        {/* Level with the title, not centred on title and subtitle (design-system.md, Header actions). */}
        {side && <div className="flex h-5 items-center self-start">{side}</div>}
      </div>
      {children}
    </Card>
  );
}

/** Brightness slider ("Dim" to "Full"). Moves freely, saves on release (pointer up or a key). */
function Level({ label, value, gate, onCommit }: { label: string; value: number | null; gate?: Gate; onCommit?: (v: number) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const enabled = Boolean(gate?.allowed && onCommit && value !== null);
  const commit = () => {
    if (draft !== null && draft !== value) onCommit?.(draft);
  };
  return (
    <div>
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">{formatPercent(draft)}</span>
      </div>
      <div title={gate?.reason ?? undefined} className="relative mt-2 h-3">
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-muted" />
        {draft !== null && (
          <>
            <i className="absolute top-1/2 left-0 h-1.5 -translate-y-1/2 rounded-full bg-foreground/60" style={{ width: `${draft}%` }} />
            <b className="pointer-events-none absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border bg-card" style={{ left: `${draft}%` }} />
          </>
        )}
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          aria-label={label}
          value={draft ?? 0}
          disabled={!enabled}
          onChange={(e) => setDraft(Number(e.target.value))}
          onPointerUp={commit}
          onKeyUp={commit}
          className="absolute inset-0 w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
        />
      </div>
      <div className="mt-1.5 flex justify-between text-2xs text-muted-foreground">
        <span>Dim</span>
        <span>Full</span>
      </div>
    </div>
  );
}

const LEVELS = [0, 25, 50, 75, 100];

/** Brightness as a dropdown in 25% steps; a level eero reports between steps (60%) is listed too, so the value is always true. */
function BrightnessSelect({ value, disabled, reason, onChange }: { value: number | null; disabled: boolean; reason: string | null; onChange: (v: number) => void }) {
  const levels = value !== null && !LEVELS.includes(value) ? [...LEVELS, value].sort((a, b) => a - b) : LEVELS;
  const items = levels.map((l) => ({ value: String(l), label: `${l}%` }));
  return (
    <span title={reason ?? undefined} className="inline-flex">
      <Select items={items} value={value === null ? null : String(value)} disabled={disabled || value === null} onValueChange={(v) => v !== null && onChange(Number(v))}>
        <SelectTrigger aria-label="Brightness" className="w-24 min-w-0">
          <SelectValue placeholder="-" />
        </SelectTrigger>
        <SelectPopup>
          {items.map((i) => (
            <SelectItem key={i.value} value={i.value}>
              {i.label}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </span>
  );
}

function StatusLightRow({ eero }: { eero: Eero | null }) {
  const on = eero?.led.on ?? null;
  const gate = useEeroGate(eero, "led_action");
  const led = useWrite<{ eero: string; on?: boolean; brightness?: number }, Eero>("eero.led.set");
  const set = (change: { on?: boolean; brightness?: number }) => {
    if (!eero) return;
    const undo = change.on !== undefined ? { on: !change.on } : { brightness: eero.led.brightness ?? 100 };
    const success = change.on !== undefined ? `Status light ${change.on ? "on" : "off"}` : `Status light at ${change.brightness}%`;
    void led.run({ eero: eero.id, ...change }, { success, undo: { id: "eero.led.set", params: { eero: eero.id, ...undo } } });
  };
  const busy: Gate = led.running ? { allowed: false, reason: null } : gate;
  return (
    <SettingsRow
      title="Status light"
      description="The LED on the front. Solid white means all is well; it returns to full brightness while offline, restarting or resetting."
      control={
        <>
          <WriteSwitch on={on} label="Status light" gate={gate} busy={led.running} onToggle={(v) => set({ on: v })} />
          <BrightnessSelect value={eero?.led.brightness ?? null} disabled={!busy.allowed || on !== true} reason={busy.reason} onChange={(v) => set({ brightness: v })} />
        </>
      }
    />
  );
}

function NightlightRow({ eero }: { eero: Eero | null }) {
  const nl = eero?.nightlight ?? null;
  // Only on eero Beacon: the row is hidden on models without a nightlight.
  if (!eero || !nl) return null;
  const time = (hhmm: string | null) => {
    if (!hhmm) return null;
    // A wall-clock time on the eero, so no time zone conversion.
    const [h = 0, m = 0] = hhmm.split(":").map(Number);
    return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  };
  return <BeaconNightlight eero={eero} nl={nl} time={time} />;
}

const MODE_WORD: Record<NightMode, string> = { off: "Off", ambient: "Ambient", schedule: "Scheduled" };

function BeaconNightlight({ eero, nl, time }: { eero: Eero; nl: NonNullable<Eero["nightlight"]>; time: (hhmm: string | null) => string | null }) {
  const gate = useEeroGate(eero);
  const write = useWrite<{ eero: string; mode: NightMode; brightness?: number; on?: string; off?: string }, Eero>("eero.nightlight.set");
  const busy: Gate = write.running ? { allowed: false, reason: null } : gate;
  const set = (change: { mode?: NightMode; brightness?: number; on?: string; off?: string }, success: string) => {
    const was = { mode: nl.mode, ...(nl.brightness !== null && { brightness: nl.brightness }), ...(nl.on && { on: nl.on }), ...(nl.off && { off: nl.off }) };
    void write.run({ eero: eero.id, mode: nl.mode, ...change }, { success, undo: { id: "eero.nightlight.set", params: { eero: eero.id, ...was } } });
  };
  return (
    <SettingsRow
      title="Nightlight"
      description="An ambient or scheduled glow from the front of this eero."
      control={
        // A dropdown, not a Segmented toggle (design-system.md, Dropdowns, not pill toggles).
        <span title={busy.reason ?? undefined} className="inline-flex">
          <Select items={MODES} value={nl.mode} disabled={!busy.allowed} onValueChange={(mode) => mode && set({ mode }, `Nightlight ${MODE_WORD[mode].toLowerCase()}`)}>
            <SelectTrigger aria-label="Nightlight mode" className="w-36">
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
      }
    >
      {nl.mode !== "off" && (
        <div className="max-w-sm">
          <Level label="Brightness" value={nl.brightness} gate={busy} onCommit={(brightness) => set({ brightness }, `Nightlight at ${brightness}%`)} />
        </div>
      )}
      {nl.mode === "schedule" &&
        (busy.allowed ? (
          <div className="grid max-w-sm grid-cols-2 gap-3 text-xs">
            <TimeField label="On at" value={nl.on} onCommit={(on) => set({ on }, `Nightlight on at ${time(on)}`)} />
            <TimeField label="Off at" value={nl.off} onCommit={(off) => set({ off }, `Nightlight off at ${time(off)}`)} />
          </div>
        ) : (
          <KvList className="max-w-sm text-xs" items={[{ label: "On at", value: time(nl.on) }, { label: "Off at", value: time(nl.off) }]} />
        ))}
    </SettingsRow>
  );
}

/** A wall-clock time on the eero (no time zone), saved on blur when it changed. */
function TimeField({ label, value, onCommit }: { label: string; value: string | null; onCommit: (hhmm: string) => void }) {
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => setDraft(value ?? ""), [value]);
  return (
    <label className="flex flex-col gap-1">
      <span className="text-muted-foreground">{label}</span>
      <input
        type="time"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft && draft !== value && onCommit(draft)}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        className="h-8 rounded-(--control-radius) border bg-background px-2 text-[13px] tabular-nums"
      />
    </label>
  );
}

const UPDATE_STATUS: Record<Updates["status"], { tone: StatusTone; label: string }> = {
  up_to_date: { tone: "success", label: "Up to date" },
  available: { tone: "info", label: "Available" },
  scheduled: { tone: "info", label: "Scheduled" },
  installing: { tone: "info", label: "Installing" },
};

function SoftwareCard({ eero, clock }: { eero: Eero | null; clock: Clock }) {
  const updates = useQuery<Updates>("updates.get", undefined, { poll: true });
  const versions = useQuery<FirmwareEntry[]>("eero.firmware.history", { eero: eero?.id ?? "", limit: 5 }, { poll: true, enabled: Boolean(eero) });
  const u = updates.data;
  const status = u ? UPDATE_STATUS[u.status] : null;
  const target = u && u.status !== "up_to_date" && u.target ? `${u.target} ${u.status === "installing" ? "installing" : u.status === "scheduled" ? "scheduled" : "available"}` : null;
  const list = versions.data ?? [];

  return (
    <SettingsCard
      icon={Download}
      title="Software"
      sub="Updates install network-wide"
      side={status && <Status tone={status.tone}>{status.label}</Status>}
    >
      <KvList
        className="text-[13px]"
        items={[
          { label: "eeroOS", value: eero?.firmware ?? u?.current ?? null },
          ...(target ? [{ label: "Next", value: target }] : []),
          {
            label: "Update window",
            value: (
              <span className="inline-flex items-center gap-2">
                {updateWindow(u?.preferredHour ?? null) ?? MISSING}
                {/* The plain inline link style: underlined, never blue. */}
                <TextLink to={pathFor("updates")} className="text-xs">
                  Change
                </TextLink>
              </span>
            ),
          },
        ]}
      />
      <div className="flex flex-col gap-1 text-xs">
        {versions.error && !versions.data ? (
          <span className="text-muted-foreground">Version history isn't available.</span>
        ) : versions.data && list.length === 0 ? (
          <span className="text-muted-foreground">No version history reported.</span>
        ) : (
          list.map((v) => (
            <div key={`${v.version}-${v.installedAt ?? ""}`} className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 tabular-nums">
                <i aria-hidden className={cn("size-1.5 rounded-full", v.current ? "bg-foreground/80" : "bg-muted-foreground/40")} />
                {v.version}
                {v.current && <span className="text-muted-foreground">current</span>}
              </span>
              <span className="text-muted-foreground tabular-nums">{v.installedAt ? clock.day(v.installedAt) : MISSING}</span>
            </div>
          ))
        )}
      </div>
    </SettingsCard>
  );
}

function CopyAll({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <Button
      size="xs"
      variant="outline"
      disabled={text === ""}
      onClick={() => void copyText(text).then((ok) => ok && setCopied(true))}
    >
      {copied ? <Check /> : <Copy />}
      {copied ? "IP addresses copied" : "Copy IP addresses"}
    </Button>
  );
}

function IpCard({ eero }: { eero: Eero | null }) {
  return (
    <SettingsCard icon={Network} title="IP addresses" sub="Assigned by the gateway">
      <KvList
        className="text-[12.5px]"
        items={[
          { label: "IPv4", value: eero?.ipv4, mono: true, copy: true },
          ...(eero && eero.ipv6.length > 0
            ? eero.ipv6.map((ip, i) => ({ label: eero.ipv6.length > 1 ? `IPv6 ${i + 1}` : "IPv6", value: ip, mono: true, copy: true }))
            : [{ label: "IPv6", value: null }]),
          { label: "Subnet", value: eero?.subnet, mono: true, copy: true },
          { label: "Gateway", value: eero?.gatewayIp, mono: true, copy: true },
        ]}
      />
      {/* A labelled button under the list, right-aligned, instead of a bare icon in the header. */}
      <div className="flex justify-end">
        <CopyAll text={eero ? ipText(eero) : ""} />
      </div>
    </SettingsCard>
  );
}

function InfoCard({ eero }: { eero: Eero | null }) {
  const joined = eero?.joined ? new Date(eero.joined).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : null;
  return (
    <SettingsCard icon={Cpu} title="Device information" sub={joined ? `Joined ${joined}` : MISSING}>
      <KvList
        className="text-xs"
        items={[
          { label: "Model number", value: eero?.modelNumber },
          { label: "Serial", value: eero?.serial, mono: true, copy: true },
          { label: "MAC", value: eero?.mac, mono: true, copy: true },
          ...(eero?.bssids ?? []).map((b) => ({ label: `BSSID ${b.band}`, value: b.mac, mono: true })),
        ]}
      />
    </SettingsCard>
  );
}
