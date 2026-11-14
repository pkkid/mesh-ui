/**
 * eero detail settings cards: Location (`eero.rename`: Enter or blur, preset
 * chips, Undo), Status light (`eero.led.set`: switch, brightness on
 * release), Nightlight (Beacon only, `eero.nightlight.set`: mode,
 * brightness, times), Software (`updates.get` plus
 * `eero.firmware.history`), IP addresses and Device information. Writes
 * dim with the reason when the eero is offline or the role cannot change
 * eeros. docs/ux/pages/eero-detail.md (Layout 4, Actions).
 */
import { Check, Copy, Cpu, Download, Info, type LucideIcon, MapPin, Moon, Network, Pencil, Plus, Sun } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { Link, pathFor } from "~/app/router";
import { useQuery } from "~/app/useCommand";
import { type Gate, useWrite } from "~/app/useWrite";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { IconTile } from "~/components/ui/hero";
import { useGate } from "~/components/ui/page";
import { KvList } from "~/components/ui/kv-list";
import { Segmented } from "~/components/ui/segmented";
import { Status, type StatusTone } from "~/components/ui/status";
import { copyText } from "~/lib/clipboard";
import { cn } from "~/lib/utils";
import { type Clock, formatPercent, MISSING } from "../../../../core/format";
import type { Eero, FirmwareEntry, Updates } from "../../../../core/model";
import { ipText, updateWindow } from "./helpers";

/** eero's room names, shown as preset chips. */
const PRESETS = ["Office", "Den", "Bedroom", "Kitchen", "Basement"];

type NightMode = NonNullable<Eero["nightlight"]>["mode"];
const modes = (disabled: boolean) =>
  [
    { value: "off", label: "Off", disabled },
    { value: "ambient", label: "Ambient", disabled },
    { value: "schedule", label: "Schedule", disabled },
  ] as const;

/** Whether this eero's settings can change now: the role gate, then offline or restarting. */
function useEeroGate(eero: Eero | null, capability?: string): Gate {
  const gate = useGate({ area: "eeros", capability });
  if (!eero) return { allowed: false, reason: null };
  if (eero.status === "offline") return { allowed: false, reason: `${eero.location} is offline` };
  if (eero.status === "updating") return { allowed: false, reason: `${eero.location} is restarting` };
  return gate;
}

export function EeroSettings({ eero, eeros, clock }: { eero: Eero | null; eeros: ReadonlyArray<Eero>; clock: Clock }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <LocationCard eero={eero} />
      <StatusLightCard eero={eero} />
      <NightlightCard eero={eero} eeros={eeros} />
      <SoftwareCard eero={eero} clock={clock} />
      <IpCard eero={eero} />
      <InfoCard eero={eero} />
    </div>
  );
}

function SettingsCard({ icon, title, sub, side, children }: { icon: LucideIcon; title: string; sub: ReactNode; side?: ReactNode; children: ReactNode }) {
  return (
    <Card padded className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <IconTile icon={icon} />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-[13.5px]">{title}</div>
          <div className="truncate text-muted-foreground text-xs">{sub}</div>
        </div>
        {side}
      </div>
      {children}
    </Card>
  );
}

function LocationCard({ eero }: { eero: Eero | null }) {
  const name = eero?.location ?? null;
  const gate = useEeroGate(eero);
  const rename = useWrite<{ eero: string; location: string }, Eero>("eero.rename", { form: true });
  const [draft, setDraft] = useState(name ?? "");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => setDraft(name ?? ""), [name]);

  const save = async (next: string) => {
    const location = next.trim();
    if (!eero || !gate.allowed || !location || location === eero.location) {
      setDraft(name ?? "");
      return;
    }
    const was = eero.location;
    const r = await rename.run(
      { eero: eero.id, location },
      { success: `Renamed ${was} to ${location}`, undo: { id: "eero.rename", params: { eero: eero.id, location: was } } },
    );
    if (!r?.ok) setDraft(name ?? "");
  };
  const error = rename.error?.code === "bad_params" ? rename.error.message : null;

  return (
    <SettingsCard icon={MapPin} title="Location" sub="Name shown everywhere for this eero">
      <label
        title={gate.reason ?? undefined}
        className={cn(
          "flex h-8 items-center gap-2 rounded-(--control-radius) border px-2.5 text-[13px] focus-within:ring-2 focus-within:ring-ring/40",
          gate.allowed ? "bg-background" : "bg-muted/40 text-foreground/80",
        )}
      >
        <input
          ref={input}
          aria-label="Location"
          value={gate.allowed ? draft : (name ?? MISSING)}
          disabled={!gate.allowed || rename.running}
          maxLength={32}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void save(draft)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setDraft(name ?? "");
              requestAnimationFrame(() => input.current?.blur());
            }
          }}
          className="min-w-0 flex-1 truncate bg-transparent outline-none disabled:cursor-not-allowed"
        />
        <Pencil aria-hidden className="size-3.5 text-muted-foreground" />
      </label>
      {error && <div className="text-destructive-foreground text-xs">{error}</div>}
      <div className="flex flex-wrap gap-1.5" title={gate.reason ?? undefined}>
        {PRESETS.map((p) => (
          <Chip key={p} on={p === name} disabled={!gate.allowed || rename.running} onClick={() => void save(p)}>
            {p}
          </Chip>
        ))}
        <Chip disabled={!gate.allowed} onClick={() => input.current?.select()}>
          <Plus aria-hidden className="size-3" />
          Custom
        </Chip>
      </div>
    </SettingsCard>
  );
}

function Chip({ on = false, disabled = false, onClick, children }: { on?: boolean; disabled?: boolean; onClick?: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-full border px-2.5 text-xs",
        disabled ? "cursor-not-allowed opacity-80" : "hover:bg-muted",
        on ? "bg-secondary font-medium text-foreground" : "text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}

/** A small on/off switch. */
function Toggle({ on, label, gate, onChange }: { on: boolean | null; label: string; gate: Gate; onChange: (on: boolean) => void }) {
  return (
    <span title={gate.reason ?? undefined} className="inline-flex">
      <button
        type="button"
        role="switch"
        aria-checked={on === true}
        aria-label={label}
        disabled={!gate.allowed || on === null}
        onClick={() => onChange(!on)}
        className={cn("relative h-5 w-9 rounded-full border", gate.allowed ? "cursor-pointer" : "cursor-not-allowed opacity-80", on ? "bg-foreground/70" : "bg-muted")}
      >
        <i className={cn("absolute top-0.5 size-3.5 rounded-full bg-background shadow-sm", on ? "right-0.5" : "left-0.5")} />
      </button>
    </span>
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
      <div className="mt-1.5 flex justify-between text-3xs text-muted-foreground uppercase tracking-wider">
        <span>Dim</span>
        <span>Full</span>
      </div>
    </div>
  );
}

function StatusLightCard({ eero }: { eero: Eero | null }) {
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
    <SettingsCard icon={Sun} title="Status light" sub="LED on the front of this eero" side={<Toggle on={on} label="Status light" gate={busy} onChange={(v) => set({ on: v })} />}>
      <Level label="Brightness" value={on === false ? null : (eero?.led.brightness ?? null)} gate={busy} onCommit={(v) => set({ brightness: v })} />
      <div className="text-2xs text-muted-foreground">
        Solid white means all is well. The LED returns to full brightness while offline, restarting or resetting.
      </div>
    </SettingsCard>
  );
}

function NightlightCard({ eero, eeros }: { eero: Eero | null; eeros: ReadonlyArray<Eero> }) {
  const nl = eero?.nightlight ?? null;
  if (!eero || !nl) {
    const beacon = eeros.find((e) => e.nightlight !== null && e.id !== eero?.id);
    return (
      <SettingsCard icon={Moon} title="Nightlight" sub="Ambient or scheduled glow" side={<Status tone="muted">Not available</Status>}>
        <div className="pointer-events-none self-start opacity-60" title="Only on eero Beacon">
          <Segmented aria-label="Nightlight mode" value="off" onValueChange={() => {}} options={modes(true)} />
        </div>
        <Note>
          Nightlight is only on eero Beacon.
          {beacon && (
            <>
              {" "}
              Your{" "}
              <Link to={pathFor("eero", { eeroId: beacon.id })} className="underline underline-offset-2">
                {beacon.location}
              </Link>{" "}
              eero has one.
            </>
          )}
        </Note>
      </SettingsCard>
    );
  }
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
    <SettingsCard icon={Moon} title="Nightlight" sub="Ambient or scheduled glow" side={<Status tone={nl.mode === "off" ? "muted" : "success"}>{MODE_WORD[nl.mode]}</Status>}>
      <div className="self-start" title={busy.reason ?? undefined}>
        <Segmented aria-label="Nightlight mode" value={nl.mode} onValueChange={(mode: NightMode) => set({ mode }, `Nightlight ${MODE_WORD[mode].toLowerCase()}`)} options={modes(!busy.allowed)} />
      </div>
      {nl.mode !== "off" && <Level label="Brightness" value={nl.brightness} gate={busy} onCommit={(brightness) => set({ brightness }, `Nightlight at ${brightness}%`)} />}
      {nl.mode === "schedule" &&
        (busy.allowed ? (
          <div className="grid grid-cols-2 gap-3 text-xs">
            <TimeField label="On at" value={nl.on} onCommit={(on) => set({ on }, `Nightlight on at ${time(on)}`)} />
            <TimeField label="Off at" value={nl.off} onCommit={(off) => set({ off }, `Nightlight off at ${time(off)}`)} />
          </div>
        ) : (
          <KvList className="text-xs" items={[{ label: "On at", value: time(nl.on) }, { label: "Off at", value: time(nl.off) }]} />
        ))}
    </SettingsCard>
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

function Note({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-2 rounded-[10px] border bg-muted/40 px-3 py-2.5 text-xs text-foreground/80">
      <Info aria-hidden className="mt-px size-3.5 shrink-0 text-info-foreground" />
      <div>{children}</div>
    </div>
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
                <Link to={pathFor("updates")} className="text-info-foreground text-xs hover:underline">
                  Change
                </Link>
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
      size="icon-xs"
      variant="outline"
      title={copied ? "IP addresses copied" : "Copy IP addresses"}
      aria-label="Copy IP addresses"
      disabled={text === ""}
      onClick={() => void copyText(text).then((ok) => ok && setCopied(true))}
    >
      {copied ? <Check /> : <Copy />}
    </Button>
  );
}

function IpCard({ eero }: { eero: Eero | null }) {
  return (
    <SettingsCard icon={Network} title="IP addresses" sub="Assigned by the gateway" side={<CopyAll text={eero ? ipText(eero) : ""} />}>
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
