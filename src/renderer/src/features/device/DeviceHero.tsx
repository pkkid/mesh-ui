/**
 * Device detail hero (docs/ux/pages/device-detail.md, Layout 1): type icon,
 * name with the GUEST tag, status line, Profile / Connected to / Signal, the
 * action row and the live Now box. Pause and Resume, Change profile and
 * Unblock run at once with an Undo toast; Block asks first through the
 * page's inline confirm (`onBlock`); Appearance opens the sheet (nickname
 * and type, saving only what changed). Controls dim by permission.
 * States: offline ("last seen 2h ago on Upstairs Hall"), paused (Resume
 * device), blocked (only Unblock and Appearance), guest (no Pause or Change
 * profile), wired (Signal `-`) and bridge mode (no Pause, profile, Block or
 * Now box).
 */
import { Ban, ChevronDown, CircleCheck, Pause, Pencil, Play, UserRound } from "lucide-react";
import { type ReactNode, useId, useState } from "react";

import { useQuery } from "~/app/useCommand";
import { fieldErrors, performWrite, type WriteOutcome } from "~/app/useWrite";
import { Metric, PageHeader } from "~/components/ui/hero";
import { Input } from "~/components/ui/input";
import { GatedButton, useGate, useNow } from "~/components/ui/page";
import { Sheet, SheetField } from "~/components/ui/sheet";
import { blockRequest, pauseRequest, ProfileMenu, profileRequest } from "~/features/devices/BulkBar";
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
  const editGate = useGate({ area: "devices" });
  const blockGate = useGate({ area: "devices", bridgeOff: true, capability: "device_blacklist" });
  const [appearance, setAppearance] = useState(false);

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
        <GatedButton key="pause" gate={gate} onClick={() => void performWrite(pauseRequest([ready], !ready.paused))}>
          {ready.paused ? <Play /> : <Pause />}
          {ready.paused ? "Resume device" : "Pause device"}
        </GatedButton>,
      );
  }
  if (d)
    actions.push(
      <GatedButton key="appearance" gate={ready ? editGate : { allowed: false, reason: null }} variant="outline" onClick={() => setAppearance(true)}>
        <Pencil />
        Appearance
      </GatedButton>,
    );
  if (ready && state !== "blocked" && !view.bridged) {
    if (!view.guest) {
      const button = (
        <GatedButton key="profile" gate={gate} variant="outline">
          <UserRound />
          Change profile
          <ChevronDown />
        </GatedButton>
      );
      const options = list.map((p) => ({ id: p.id, name: p.name, color: entityColors(list.map((x) => x.id))[p.id] }));
      actions.push(
        gate.allowed ? (
          <ProfileMenu
            key="profile"
            profiles={options}
            current={ready.profileId}
            onPick={(p) => void performWrite(profileRequest([ready], p))}
            trigger={button}
          />
        ) : (
          button
        ),
      );
    }
    actions.push(
      <GatedButton key="block" gate={blockGate} variant="outline" className="text-destructive-foreground" onClick={onBlock}>
        <Ban />
        Block
      </GatedButton>,
    );
  }

  return (
    <PageHeader
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
      actions={
        actions.length ? (
          <>
            {actions}
            {ready && <AppearanceSheet key={`${ready.id}:${appearance}`} device={ready} open={appearance} onClose={() => setAppearance(false)} />}
          </>
        ) : undefined
      }
      aside={view.bridged || !d ? undefined : <DeviceNow device={d} muted={state === "blocked"} />}
    />
  );
}

/**
 * The Appearance sheet (device-detail.md, Layout 3): nickname with a count
 * and "reset to hostname" (clears the nickname, so the device follows its own
 * name again), and the device type grid. Save runs `device.rename` and/or
 * `device.type.set`, only what changed.
 */
function AppearanceSheet({ device: d, open, onClose }: { device: Device; open: boolean; onClose: () => void }) {
  const [nickname, setNickname] = useState(d.nickname ?? "");
  const [type, setType] = useState(d.type);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const nameId = useId();
  const nameChanged = nickname.trim() !== (d.nickname ?? "");
  const typeChanged = type !== d.type;
  const label = DEVICE_TYPES.find((t) => t.type === type)?.label ?? typeLabel(type);

  const save = async (): Promise<WriteOutcome<Device>> => {
    setErrors({});
    setFormError(null);
    let res: WriteOutcome<Device> = null;
    const name = nickname.trim();
    if (nameChanged) {
      res = await performWrite<Record<string, unknown>, Device>({
        id: "device.rename",
        params: { device: d.id, nickname: name },
        form: true,
        success: typeChanged ? undefined : "Saved",
        failure: `Couldn't rename ${d.name}`,
        undo: typeChanged ? undefined : { id: "device.rename", params: { device: d.id, nickname: d.nickname ?? "" } },
      });
      if (!res?.ok) {
        if (res && !res.ok) setErrors(fieldErrors(res.error));
        return res;
      }
    }
    if (typeChanged) {
      res = await performWrite<Record<string, unknown>, Device>({
        id: "device.type.set",
        params: { device: d.id, type },
        form: true,
        success: "Saved",
        failure: `Couldn't change the type of ${d.name}`,
        undo: nameChanged ? undefined : { id: "device.type.set", params: { device: d.id, type: d.type } },
      });
      if (res && !res.ok) {
        const f = fieldErrors(res.error);
        setErrors(f);
        if (f._form) setFormError(f._form);
      }
    }
    return res;
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      icon={<Pencil className="size-4" />}
      title="Appearance"
      subtitle="Nickname and icon, shown everywhere in Mesh UI and the eero app"
      dirty={nameChanged || typeChanged}
      valid={nickname.trim().length <= 32}
      onSave={save}
      error={formError ?? errors._form}
      className="max-w-xl"
    >
      <SheetField
        label="Nickname"
        htmlFor={nameId}
        error={errors.nickname}
        helper={
          <span className="flex items-center gap-1.5">
            <span className="tabular-nums">{nickname.trim().length} / 32</span>
            {d.hostname && (
              <>
                <span aria-hidden>·</span>
                <span>
                  Hostname: <span className="font-mono">{d.hostname}</span>
                </span>
              </>
            )}
            {nickname !== "" && (
              <>
                <span aria-hidden>·</span>
                <button type="button" className="cursor-pointer underline-offset-2 hover:underline" onClick={() => setNickname("")}>
                  reset to {d.hostname ? "hostname" : "eero's name"}
                </button>
              </>
            )}
          </span>
        }
      >
        <Input id={nameId} value={nickname} maxLength={32} placeholder={d.hostname ?? d.name} onChange={(e) => setNickname(e.target.value)} />
      </SheetField>
      <SheetField label={<span className="flex justify-between">Device type<span className="font-normal text-muted-foreground">{label}</span></span>} error={errors.type}>
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
      </SheetField>
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
