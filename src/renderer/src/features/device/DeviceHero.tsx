/**
 * Device detail hero (docs/ux/pages/device-detail.md, Layout 1): type icon,
 * name with the GUEST tag, status line, Profile / Connected to / Signal, the
 * action row (disabled until device writes land) and the live Now box.
 * States: offline ("last seen 2h ago on Upstairs Hall"), paused (Resume
 * device), blocked (only Unblock and Appearance), guest (no Pause or Change
 * profile), wired (Signal `-`) and bridge mode (no Pause, profile, Block or
 * Now box).
 */
import { Ban, Pause, Pencil, Play, UserRound } from "lucide-react";
import type { ReactNode } from "react";

import { useQuery } from "~/app/useCommand";
import { Metric, PageHeader } from "~/components/ui/hero";
import { ComingSoonButton, useNow } from "~/components/ui/page";
import { Status, type StatusTone } from "~/components/ui/status";
import { entityColors } from "~/lib/chartColors";
import { deviceIcon } from "~/lib/deviceIcons";
import { cn } from "~/lib/utils";
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

const TYPE_LABELS: Record<string, string> = { tv: "TV", nas: "NAS", ereader: "E-reader", generic: "Device", smart_hub: "Smart home hub" };

/** "Laptop", "Game console", "TV": eero's device type in words. */
export function typeLabel(type: string): string {
  const known = TYPE_LABELS[type];
  if (known) return known;
  const words = type.replace(/[_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Device";
}

const SOON = "Coming soon";

export function DeviceHero({ view, fallback }: { view: DeviceView; fallback?: Device }) {
  const eeros = useQuery<Eero[]>("eero.list", undefined, { poll: true });
  const profiles = useQuery<ProfileList>("profile.list", undefined, { poll: true, enabled: !view.bridged });
  const now = useNow();

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

  const actions: ReactNode[] = [];
  if (d && state === "blocked") {
    actions.push(
      <ComingSoonButton key="unblock" variant="outline" title={SOON}>
        <Ban />
        Unblock
      </ComingSoonButton>,
    );
  } else if (d) {
    if (!view.bridged && !view.guest)
      actions.push(
        <ComingSoonButton key="pause" title={SOON}>
          {d.paused ? <Play /> : <Pause />}
          {d.paused ? "Resume device" : "Pause device"}
        </ComingSoonButton>,
      );
  }
  if (d)
    actions.push(
      <ComingSoonButton key="appearance" variant="outline" title={SOON}>
        <Pencil />
        Appearance
      </ComingSoonButton>,
    );
  if (d && state !== "blocked" && !view.bridged) {
    if (!view.guest)
      actions.push(
        <ComingSoonButton key="profile" variant="outline" title={SOON}>
          <UserRound />
          Change profile
        </ComingSoonButton>,
      );
    actions.push(
      <ComingSoonButton key="block" variant="outline" title={SOON} className="text-destructive-foreground">
        <Ban />
        Block
      </ComingSoonButton>,
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
      actions={actions.length ? actions : undefined}
      aside={view.bridged || !d ? undefined : <DeviceNow device={d} muted={state === "blocked"} />}
    />
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
