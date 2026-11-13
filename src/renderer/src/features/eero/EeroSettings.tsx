/**
 * eero detail settings cards, shown as values for now: Location, Status
 * light, Nightlight (Beacon only), Software (`updates.get` plus
 * `eero.firmware.history`), IP addresses and Device information. The
 * controls are disabled ("Coming soon") until `eero.rename`, `eero.led.set`
 * and `eero.nightlight.set` land. docs/ux/pages/eero-detail.md (Layout 4).
 */
import { Check, Copy, Cpu, Download, Info, type LucideIcon, MapPin, Moon, Network, Pencil, Plus, Sun } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { Link, pathFor } from "~/app/router";
import { useQuery } from "~/app/useCommand";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { IconTile } from "~/components/ui/hero";
import { KvList } from "~/components/ui/kv-list";
import { Segmented } from "~/components/ui/segmented";
import { Status, type StatusTone } from "~/components/ui/status";
import { copyText } from "~/lib/clipboard";
import { cn } from "~/lib/utils";
import { type Clock, formatPercent, MISSING } from "../../../../core/format";
import type { Eero, FirmwareEntry, Updates } from "../../../../core/model";

const SOON = "Coming soon";

/** eero's room names, shown as preset chips. Moves to core with `eero.rename`. */
const PRESETS = ["Office", "Den", "Bedroom", "Kitchen", "Basement"];

const NIGHTLIGHT_MODES = [
  { value: "off", label: "Off", disabled: true },
  { value: "ambient", label: "Ambient", disabled: true },
  { value: "schedule", label: "Schedule", disabled: true },
] as const;

export function EeroSettings({ eero, eeros, clock }: { eero: Eero | null; eeros: ReadonlyArray<Eero>; clock: Clock }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <LocationCard eero={eero} />
      <StatusLightCard eero={eero} />
      <NightlightCard eero={eero} eeros={eeros} clock={clock} />
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
  return (
    <SettingsCard icon={MapPin} title="Location" sub="Name shown everywhere for this eero">
      <div
        title={SOON}
        aria-disabled
        className="flex h-8 items-center gap-2 rounded-(--control-radius) border bg-muted/40 px-2.5 text-[13px] text-foreground/80"
      >
        <span className="truncate">{name ?? MISSING}</span>
        <Pencil aria-hidden className="ms-auto size-3.5 text-muted-foreground" />
      </div>
      <div className="flex flex-wrap gap-1.5" title={SOON}>
        {PRESETS.map((p) => (
          <Chip key={p} on={p === name}>
            {p}
          </Chip>
        ))}
        <Chip>
          <Plus aria-hidden className="size-3" />
          Custom
        </Chip>
      </div>
    </SettingsCard>
  );
}

function Chip({ on = false, children }: { on?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      disabled
      className={cn(
        "inline-flex h-6 cursor-not-allowed items-center gap-1 rounded-full border px-2.5 text-xs opacity-80",
        on ? "bg-secondary font-medium text-foreground" : "text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}

/** A small on/off switch, disabled until its write command lands. */
function Toggle({ on, label }: { on: boolean | null; label: string }) {
  return (
    <span title={SOON} className="inline-flex">
      <button
        type="button"
        role="switch"
        aria-checked={on === true}
        aria-label={label}
        disabled
        className={cn("relative h-5 w-9 cursor-not-allowed rounded-full border opacity-80", on ? "bg-foreground/70" : "bg-muted")}
      >
        <i className={cn("absolute top-0.5 size-3.5 rounded-full bg-background shadow-sm", on ? "right-0.5" : "left-0.5")} />
      </button>
    </span>
  );
}

/** A read-only slider track for brightness ("Dim" to "Full"). */
function Level({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">{formatPercent(value)}</span>
      </div>
      <div
        role="slider"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value ?? undefined}
        aria-disabled
        title={SOON}
        className="relative mt-2 h-1.5 rounded-full bg-muted"
      >
        {value !== null && (
          <>
            <i className="absolute inset-y-0 left-0 rounded-full bg-foreground/60" style={{ width: `${value}%` }} />
            <b className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border bg-card" style={{ left: `${value}%` }} />
          </>
        )}
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
  return (
    <SettingsCard icon={Sun} title="Status light" sub="LED on the front of this eero" side={<Toggle on={on} label="Status light" />}>
      <Level label="Brightness" value={on === false ? null : (eero?.led.brightness ?? null)} />
      <div className="text-2xs text-muted-foreground">
        Solid white means all is well. The LED returns to full brightness while offline, restarting or resetting.
      </div>
    </SettingsCard>
  );
}

function NightlightCard({ eero, eeros, clock }: { eero: Eero | null; eeros: ReadonlyArray<Eero>; clock: Clock }) {
  const nl = eero?.nightlight ?? null;
  if (!eero || !nl) {
    const beacon = eeros.find((e) => e.nightlight !== null && e.id !== eero?.id);
    return (
      <SettingsCard icon={Moon} title="Nightlight" sub="Ambient or scheduled glow" side={<Status tone="muted">Not available</Status>}>
        <div className="pointer-events-none self-start opacity-60" title={SOON}>
          <Segmented aria-label="Nightlight mode" value="off" onValueChange={() => {}} options={NIGHTLIGHT_MODES} />
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
    const [h, m] = hhmm.split(":").map(Number);
    return clock.time(Date.UTC(2000, 0, 1, h ?? 0, m ?? 0)).replace(/\s/, " ");
  };
  return (
    <SettingsCard
      icon={Moon}
      title="Nightlight"
      sub="Ambient or scheduled glow"
      side={<Status tone={nl.mode === "off" ? "muted" : "success"}>{nl.mode === "off" ? "Off" : nl.mode === "ambient" ? "Ambient" : "Scheduled"}</Status>}
    >
      <div className="pointer-events-none self-start" title={SOON}>
        <Segmented aria-label="Nightlight mode" value={nl.mode} onValueChange={() => {}} options={NIGHTLIGHT_MODES} />
      </div>
      {nl.mode !== "off" && <Level label="Brightness" value={nl.brightness} />}
      {nl.mode === "schedule" && (
        <KvList className="text-xs" items={[{ label: "On at", value: time(nl.on) }, { label: "Off at", value: time(nl.off) }]} />
      )}
    </SettingsCard>
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

/** "2 AM", "12 PM". */
const hourWord = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h % 24 < 12 ? "AM" : "PM"}`;

/** eero's update window: three hours from the preferred hour ("2 to 5 AM"). */
export function updateWindow(hour: number | null): string | null {
  if (hour === null) return null;
  const from = hourWord(hour);
  const to = hourWord((hour + 3) % 24);
  return from.slice(-2) === to.slice(-2) ? `${from.slice(0, -3)} to ${to}` : `${from} to ${to}`;
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

/** "IPv4 192.168.4.22" lines for every known address, for the card's copy button. */
export function ipText(e: Pick<Eero, "ipv4" | "ipv6" | "subnet" | "gatewayIp">): string {
  const rows: [string, string | null][] = [["IPv4", e.ipv4], ...e.ipv6.map((ip): [string, string] => ["IPv6", ip]), ["Subnet", e.subnet], ["Gateway", e.gatewayIp]];
  return rows.flatMap(([k, v]) => (v ? [`${k} ${v}`] : [])).join("\n");
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
