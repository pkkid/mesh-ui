/**
 * Device detail hero (docs/ux/pages/device-detail.md, Layout 1): the flat page
 * header with the type icon, name with the GUEST tag, status line, Profile /
 * Connected to / Signal, the action row (Pause or Resume, then Block, all
 * outline) and Live throughput on the right (DeviceNow). Pause, Resume and
 * Unblock run at once with an Undo toast; Block asks first through the page's
 * confirm dialog (`onBlock`). Appearance and the profile are settings rows at
 * the bottom of the page (DeviceSettings). Controls dim by permission.
 * States: offline ("last seen 2h ago on Upstairs Hall"), paused (Resume
 * device), blocked (only Unblock), guest (no Pause), wired (Signal `-`) and
 * bridge mode (no Pause, Block or Live throughput).
 */
import { Ban, CircleCheck, Pause, Play } from "lucide-react";
import { type ReactNode, useState } from "react";

import { useQuery } from "~/app/useCommand";
import { fieldErrors, performWrite, type WriteOutcome } from "~/app/useWrite";
import { Metric, PageHeader } from "~/components/ui/hero";
import { GatedButton, useGate, useNow } from "~/components/ui/page";
import { Sheet } from "~/components/ui/sheet";
import { blockRequest, pauseRequest } from "~/features/devices/BulkBar";
import { Status, type StatusTone } from "~/components/ui/status";
import { entityColors } from "~/lib/chartColors";
import { deviceIcon } from "~/lib/deviceIcons";
import { cn } from "~/lib/utils";
import { DEVICE_TYPES, deviceCategory } from "../../../../core/eero/map/device";
import { formatRelative } from "../../../../core/format";
import type { Device, Eero, ProfileList } from "../../../../core/model";

import type { DeviceView } from "./DevicePage";
import { DeviceNow } from "./DeviceNow";

type State = "online" | "paused" | "offline" | "blocked";

export const deviceState = (d: Device): State => (d.blocked ? "blocked" : !d.connected ? "offline" : d.paused ? "paused" : "online");

const STATE: Record<State, { tone: StatusTone; label: string }> = {
  online: { tone: "success", label: "Online" },
  paused: { tone: "warning", label: "Paused" },
  offline: { tone: "muted", label: "Offline" },
  blocked: { tone: "destructive", label: "Blocked" },
};

const TYPE_LABELS: Record<string, string> = {
  tv: "TV",
  nas: "NAS",
  ereader: "E-reader",
  generic: "Device",
  smart_hub: "Smart home hub",
  ...Object.fromEntries(DEVICE_TYPES.filter((t) => t.type !== "generic").map((t) => [t.type, t.label])),
};

/** "Laptop", "Game console", "TV": eero's device type in words. */
export function typeLabel(type: string): string {
  const known = TYPE_LABELS[type];
  if (known) return known;
  const words = type.replace(/[_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Device";
}

export function DeviceHero({ view, fallback, onBlock }: { view: DeviceView; fallback?: Device; onBlock: () => void }) {
  const eeros = useQuery<Eero[]>("eero.list", undefined, { poll: true });
  const profiles = useQuery<ProfileList>("profile.list", undefined, { poll: true, enabled: !view.bridged });
  const now = useNow();
  const gate = useGate({ area: "devices", bridgeOff: true });
  const blockGate = useGate({ area: "devices", bridgeOff: true, capability: "device_blacklist" });

  // While device.get loads, the name and icon come from the list cache.
  const d = view.device ?? fallback;
  const state = d ? deviceState(d) : null;
  const tz = view.network?.timezone ?? "UTC";
  const eeroName = (id: string | null) => (id ? (eeros.data?.find((e) => e.id === id)?.location ?? null) : null);
  const list = profiles.data?.profiles ?? [];
  const profile = d?.profileId ? list.find((p) => p.id === d.profileId) : undefined;
  const color = profile ? entityColors(list.map((p) => p.id))[profile.id] : undefined;
  const wired = d?.band === "wired";
  const live = state === "online" || state === "paused";

  let context: ReactNode = d ? typeLabel(d.type) : null;
  if (d && state === "offline") {
    const where = eeroName(d.eeroId);
    context = `last seen ${formatRelative(d.lastActive, now, tz)}${where ? ` on ${where}` : ""}`;
  }

  // Actions need the full device (device.get), not the list fallback.
  const ready = view.device;
  const actions: ReactNode[] = [];
  if (ready && state === "blocked") {
    if (!view.bridged)
      actions.push(
        <GatedButton key="unblock" gate={blockGate} variant="outline" onClick={() => void performWrite(blockRequest([ready], false))}>
          <CircleCheck />
          Unblock
        </GatedButton>,
      );
  } else if (ready) {
    if (!view.bridged && !view.guest)
      actions.push(
        <GatedButton key="pause" gate={gate} variant="outline" onClick={() => void performWrite(pauseRequest([ready], !ready.paused))}>
          {ready.paused ? <Play /> : <Pause />}
          {ready.paused ? "Resume device" : "Pause device…"}
        </GatedButton>,
      );
  }
  if (ready && state !== "blocked" && !view.bridged) {
    actions.push(
      <GatedButton key="block" gate={blockGate} variant="outline" className="text-destructive-foreground" onClick={onBlock}>
        <Ban />
        Block…
      </GatedButton>,
    );
  }

  return (
    <PageHeader
      flat
      icon={deviceIcon(d)}
      title={
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="truncate">{d?.name ?? "-"}</span>
          {view.guest && (
            <span className="shrink-0 rounded-[4px] border bg-muted px-1.5 py-px font-bold text-2xs text-muted-foreground tracking-[0.08em]">
              GUEST
            </span>
          )}
        </span>
      }
      status={
        d && state ? (
          <>
            <Status tone={STATE[state].tone}>{STATE[state].label}</Status>
            <span>{context}</span>
          </>
        ) : undefined
      }
      facts={
        <>
          {!view.bridged && (
            <Metric
              label="Profile"
              value={
                !d ? null : profile ? (
                  <span className="flex items-center gap-1.5 text-sm">
                    <span
                      aria-hidden
                      className="grid size-5 shrink-0 place-items-center rounded-full font-semibold text-[10px] text-background"
                      style={{ background: color }}
                    >
                      {profile.name.slice(0, 1).toUpperCase()}
                    </span>
                    {profile.name}
                  </span>
                ) : d.profileId ? null : (
                  <span className="text-muted-foreground text-sm">Unassigned</span>
                )
              }
            />
          )}
          <Metric label="Connected to" value={d && live ? <span className="text-sm">{eeroName(d.eeroId)}</span> : null} />
          <Metric
            label="Signal"
            value={
              d && live && !wired && d.signal ? (
                <span className="flex items-center gap-1.5 text-sm">
                  <SignalBars bars={d.signal.bars ?? 0} />
                  {d.signal.dbm === null ? null : `${d.signal.dbm} dBm`}
                </span>
              ) : null
            }
          />
        </>
      }
      actions={actions.length ? <>{actions}</> : undefined}
      aside={view.bridged || !d ? undefined : <DeviceNow device={d} timezone={view.network?.timezone} />}
    />
  );
}

/**
 * The icon sheet (device-detail.md, Layout 4), from the icon button on Device
 * settings' Appearance row: only the device type grid. Save runs
 * `device.type.set`, with Undo.
 */
export function IconSheet({ device: d, open, onClose }: { device: Device; open: boolean; onClose: () => void }) {
  const [type, setType] = useState(d.type);
  const [error, setError] = useState<string | null>(null);
  const changed = type !== d.type;
  const save = async (): Promise<WriteOutcome<Device>> => {
    setError(null);
    const res = await performWrite<Record<string, unknown>, Device>({
      id: "device.type.set",
      params: { device: d.id, type },
      form: true,
      success: "Saved",
      failure: `Couldn't change the icon of ${d.name}`,
      undo: { id: "device.type.set", params: { device: d.id, type: d.type } },
    });
    if (res && !res.ok) {
      const f = fieldErrors(res.error);
      setError(f.type ?? f._form ?? res.error.message);
    }
    return res;
  };

  const CurrentIcon = deviceIcon({ type, category: deviceCategory(type) });
  return (
    <Sheet
      open={open}
      onClose={onClose}
      icon={<CurrentIcon className="size-4" />}
      title="Icon"
      subtitle={`The icon for ${d.name}, shown everywhere in Mesh UI and the eero app`}
      dirty={changed}
      valid
      onSave={save}
      error={error}
      className="max-w-xl"
      clean
    >
      {/* The grid alone: the title says what it is, and the picked tile is marked. */}
      <div role="radiogroup" aria-label="Device type" className="grid grid-cols-8 gap-1">
        {DEVICE_TYPES.map((t) => {
          const on = t.type === type;
          const Icon = deviceIcon({ type: t.type, category: deviceCategory(t.type) });
          return (
            <button
              key={t.type}
              type="button"
              role="radio"
              aria-checked={on}
              title={t.label}
              onClick={() => setType(t.type)}
              className={cn(
                "flex cursor-pointer flex-col items-center gap-1 rounded-lg border px-0.5 py-1.5 outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring",
                on ? "border-foreground/50 bg-muted text-foreground" : "border-transparent text-muted-foreground",
              )}
            >
              <Icon aria-hidden className="size-4" />
              <span className="w-full truncate text-center text-3xs">{t.label}</span>
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}

/** Four bars as in the Devices table: one red, two yellow, three or four in the text colour. */
function SignalBars({ bars }: { bars: number }) {
  const n = Math.max(0, Math.min(4, Math.round(bars)));
  const on = n === 1 ? "bg-destructive" : n === 2 ? "bg-warning" : "bg-foreground/80";
  return (
    <span role="img" aria-label={n === 0 ? "No signal" : `Signal ${n} of 4`} className="inline-flex h-3 items-end gap-0.5">
      {[4, 6.5, 9, 12].map((h, i) => (
        <span key={h} className={cn("w-[3px] rounded-[1px]", i < n ? on : "bg-border")} style={{ height: h }} />
      ))}
    </span>
  );
}
