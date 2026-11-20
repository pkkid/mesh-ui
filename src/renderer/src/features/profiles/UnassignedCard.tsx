/**
 * The unassigned half of the "Your profiles" section (docs/ux/pages/profiles.md,
 * Layout 2): a tile per device in no profile with its icon, name and
 * "Online, 142 GB in 24h", "Offline, 3 days ago" or "Blocked".
 *
 * `useAssign` holds what the profile cards and the tiles share: the list,
 * the selection (view state) and the drag (useTileDrag.tsx does the
 * physics). While devices are selected or one is being dragged, the profile
 * cards turn into dotted drop targets (ProfileCards.tsx); dropping on a card,
 * or clicking one with a selection, moves the devices there
 * (`device.profile.set`, with Undo). Dragging a selected tile carries the
 * whole selection. The section's "Add profile from selection…" button
 * (ProfileCards.tsx) opens the Add a profile sheet with the selection
 * picked (`profile.create`). Pause unassigned asks
 * first; Resume unassigned undoes it.
 */
import { Pause, Play } from "lucide-react";
import { useState } from "react";

import { navigate, pathFor } from "~/app/router";
import type { QueryState } from "~/app/useCommand";
import { performWrite, useWrite } from "~/app/useWrite";
import { GatedButton, SectionError, useGate, useNow } from "~/components/ui/page";
import { profileRequest } from "~/features/devices/BulkBar";
import { unassignedPauseMessage } from "~/features/profile/helpers";
import { deviceIcon } from "~/lib/deviceIcons";
import { cn } from "~/lib/utils";
import { formatBytes, formatRelative } from "../../../../core/format";
import type { Device, DeviceList, Profile, ProfileList, UsageBreakdown } from "../../../../core/model";

import { PROFILE_GATE } from "./ProfileCards";
import { useTileDrag } from "./useTileDrag";

/** The unassigned devices, the selection and the drag, shared by the profile cards and the tiles. */
export function useAssign(profiles: ProfileList | undefined, devices: QueryState<DeviceList>) {
  const assignGate = useGate({ area: "devices", bridgeOff: true });
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const profileList = profiles?.profiles ?? [];
  const owned = new Set(profileList.flatMap((p) => p.deviceIds));
  const listed = new Set(profileList.map((p) => p.id));
  // Same rule as the core Unassigned summary (no profile, or eero's own Unassigned group),
  // but blocked devices stay in the grid as "Blocked". Guests are not the household's.
  // Blank until profiles load too, or assigned devices would flash in as unassigned.
  const list = (profiles ? (devices.data?.devices ?? []) : [])
    .filter((d) => !owned.has(d.id) && (d.profileId === null || !listed.has(d.profileId)) && d.ssid !== "guest")
    .sort((a, b) => Number(b.connected) - Number(a.connected) || Number(a.blocked) - Number(b.blocked) || a.name.localeCompare(b.name));
  // Only tiles still on screen count: an assigned device leaves the selection.
  const picked = list.filter((d) => selected.has(d.id));

  const move = (devs: Device[], p: Pick<Profile, "id" | "name">) => {
    if (devs.length === 0) return;
    setSelected((prev) => new Set([...prev].filter((id) => !devs.some((d) => d.id === id))));
    void performWrite(profileRequest(devs, { id: p.id, name: p.name }));
  };
  const drag = useTileDrag<Device>({
    enabled: assignGate.allowed,
    onDrop: (devs, zone) => {
      const p = profileList.find((x) => x.id === zone);
      if (p) move(devs, p);
    },
  });

  return {
    list,
    loaded: !!devices.data && !!profiles,
    selected,
    picked,
    toggle: (id: string) =>
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    clear: () => setSelected(new Set()),
    /** Moves the selection to a profile (clicking a card while devices are selected). */
    moveSelection: (p: Pick<Profile, "id" | "name">) => move(picked, p),
    drag,
    /** Profile cards are drop targets now: something is selected or being dragged. */
    dropMode: assignGate.allowed && (picked.length > 0 || drag.dragging !== null),
    gate: assignGate,
  };
}

export type Assign = ReturnType<typeof useAssign>;

type PoolProps = {
  assign: Assign;
  devices: QueryState<DeviceList>;
  usage: UsageBreakdown | undefined;
  timezone: string | null;
};

/** The unassigned tiles under the profile cards, with a heading line. */
export function UnassignedPool({ assign: a, devices, usage, timezone }: PoolProps) {
  const now = useNow(60_000);
  const today = new Map((usage?.rows ?? []).map((r) => [r.id, r.down + r.up]));
  const draggingIds = new Set((a.drag.dragging ?? []).map((d) => d.id));
  const online = a.list.filter((d) => d.connected).length;

  const detail = (d: Device) => {
    if (d.blocked) return <span className="text-destructive-foreground">Blocked</span>;
    // usage.breakdown day is the last 24 hours, not since midnight.
    if (d.connected) return `Online, ${formatBytes(today.get(d.id))} in 24h`;
    return d.lastActive ? `Offline, ${formatRelative(d.lastActive, now, timezone ?? "UTC")}` : "Offline";
  };

  if (devices.error && !devices.data) return <SectionError what="devices" error={devices.error} onRetry={() => void devices.refetch()} />;
  if (!a.loaded) return null;

  return (
    // 28px under the cards, so the tiles read as their own group in the same section.
    <div className="mt-[13px] flex flex-col gap-2.5">
      {/* A quiet heading inside the section: what the tiles are, then what to do with them on the line under it. */}
      <div className="flex flex-col gap-0.5 text-xs">
        <div className="flex items-baseline gap-2">
          <span className="font-medium text-foreground">Unassigned</span>
          <span className="text-muted-foreground tabular-nums">
            {a.list.length === 0 ? "Every device is in a profile." : `${a.list.length} ${a.list.length === 1 ? "device" : "devices"}, ${online} online`}
          </span>
        </div>
        {a.list.length > 0 && (
          <div className="text-muted-foreground">
            {a.picked.length > 0 ? (
              <>
                {a.picked.length} selected: drag them onto a profile, or click one.{" "}
                <button type="button" className="cursor-pointer underline-offset-2 hover:text-foreground hover:underline" onClick={a.clear}>
                  Clear
                </button>
              </>
            ) : (
              "Drag a device onto a profile, or select several. New and private-MAC devices land here."
            )}
          </div>
        )}
      </div>
      {a.list.length > 0 && (
        <div className={cn("grid gap-1 sm:grid-cols-2 lg:grid-cols-3", devices.fading && "opacity-40 transition-opacity")}>
          {a.list.map((d) => {
            const on = a.selected.has(d.id);
            return (
              <div
                key={d.id}
                role="checkbox"
                aria-checked={on}
                aria-label={`Select ${d.name}`}
                tabIndex={0}
                onPointerDown={(e) =>
                  a.drag.press(
                    e,
                    () => (on ? a.picked : [d]),
                    () => <Tile device={d} detail={detail(d)} selected />,
                  )
                }
                onClick={() => !a.drag.wasDrag() && a.toggle(d.id)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget || (e.key !== " " && e.key !== "Enter")) return;
                  e.preventDefault();
                  a.toggle(d.id);
                }}
                onDoubleClick={() => navigate(pathFor("device", { deviceId: d.id }))}
                className={cn(
                  "min-w-0 select-none rounded-[10px] outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-ring",
                  a.gate.allowed ? "cursor-grab" : "cursor-pointer",
                  draggingIds.has(d.id) && "opacity-25",
                )}
              >
                <Tile device={d} detail={detail(d)} selected={on} />
              </div>
            );
          })}
        </div>
      )}
      {a.drag.layer}
    </div>
  );
}

/** One device tile: icon, name and its line. Also the drag ghost. */
function Tile({ device: d, detail, selected }: { device: Device; detail: React.ReactNode; selected: boolean }) {
  const Icon = deviceIcon(d);
  return (
    <div
      className={cn(
        "flex h-full min-w-0 items-center gap-2.5 rounded-[10px] px-3 py-2 transition-colors hover:bg-muted/60",
        selected && "bg-muted shadow-[inset_0_0_0_2px_var(--color-ring)]",
        !d.connected && !selected && "opacity-60",
      )}
    >
      <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-[12.5px]">{d.name}</div>
        <div className="truncate text-2xs text-muted-foreground">{detail}</div>
      </div>
    </div>
  );
}

/**
 * Pause unassigned (disruptive: the confirm dialog names who goes offline,
 * including the TV, printer and smart home gear) or Resume unassigned.
 * Shared with the Unassigned page.
 */
export function UnassignedPauseButton({ paused, devices, hero = false }: { paused: boolean; devices: ReadonlyArray<Device>; hero?: boolean }) {
  const gate = useGate(PROFILE_GATE);
  const copy = unassignedPauseMessage(devices);
  const confirm = { ...copy, confirmLabel: "Pause unassigned" };
  const pause = useWrite("profile.unassigned.pause", {
    confirm,
    success: "Paused unassigned devices",
    undo: { id: "profile.unassigned.resume", success: "Resumed unassigned devices" },
  });
  const resume = useWrite("profile.unassigned.resume", {
    success: "Resumed unassigned devices",
    undo: { id: "profile.unassigned.pause", confirm, success: "Paused unassigned devices" },
  });
  const write = paused ? resume : pause;
  // The section's Pause asks first, so it ends in an ellipsis; the Unassigned page's hero button keeps its label.
  const label = paused ? "Resume unassigned" : hero ? "Pause unassigned" : "Pause unassigned\u2026";
  return (
    <GatedButton
      gate={!paused && devices.length === 0 && gate.allowed ? { allowed: false, reason: "No unassigned devices to pause" } : gate}
      variant={paused && hero ? "default" : "outline"}
      className={hero ? "w-full" : undefined}
      disabled={write.running}
      onClick={() => void write.run()}
    >
      {paused ? <Play /> : <Pause />}
      {label}
    </GatedButton>
  );
}
