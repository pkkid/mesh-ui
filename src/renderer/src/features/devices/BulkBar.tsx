/**
 * Device writes for the Devices page and device detail
 * (docs/ux/pages/devices.md, device-detail.md): the bulk action bar, the
 * profile menu, and the write requests both pages run through the write kit
 * (app/useWrite.ts). Every request goes to one device command
 * (`device.pause`, `.resume`, `.profile.set`, `.block`, `.unblock`), which
 * takes one device or a list and reports each device that failed.
 */
import { Ban, Check, ChevronDown, CircleCheck, Pause, Play, UserRoundPlus, X } from "lucide-react";
import { type ReactElement, useRef } from "react";

import { type Gate, performWrite, type WriteRequest } from "~/app/useWrite";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { GatedButton } from "~/components/ui/page";
import { cn } from "~/lib/utils";
import type { Device, DeviceBulkResult } from "../../../../core/model";

export type DeviceRef = Pick<Device, "id" | "name" | "profileId" | "paused" | "blocked">;
export type ProfileOption = { id: string; name: string; color?: string };

// ---------------------------------------------------------------------------
// Requests

const count = (n: number) => `${n} ${n === 1 ? "device" : "devices"}`;
const who = (devices: ReadonlyArray<DeviceRef>) => (devices.length === 1 ? (devices[0]?.name ?? "1 device") : count(devices.length));

/** "Paused Alex's Phone", "Paused 3 devices", or "Paused 2 of 3. PlayStation 5: <reason>". */
function outcome(verb: string, devices: ReadonlyArray<DeviceRef>, r: DeviceBulkResult): string {
  if (r.failed.length === 0) return `${verb} ${who(devices)}`;
  const f = r.failed[0];
  const name = devices.find((d) => d.id === f?.id)?.name ?? f?.device ?? "";
  return `${verb} ${r.devices.length} of ${r.devices.length + r.failed.length}. ${name}: ${f?.message ?? ""}`;
}

const ids = (devices: ReadonlyArray<DeviceRef>) => devices.map((d) => d.id);
/** Devices the write really changed: it succeeded and they were not already in that state. Undo reverses only these. */
const changed = (r: DeviceBulkResult, devices: ReadonlyArray<DeviceRef>, was: (d: DeviceRef) => boolean) => {
  const already = new Set(devices.filter(was).map((d) => d.id));
  return r.devices.map((d) => d.id).filter((id) => !already.has(id));
};

/** The bulk commands take at most this many devices. */
export const BULK_MAX = 50;

/** The pause confirm's title and button. `device.pause` is disruptive: core's needs_confirm message names the devices. */
const pauseConfirm = (devices: ReadonlyArray<Pick<DeviceRef, "name">>) => ({
  title: `Pause ${devices.length === 1 ? (devices[0]?.name ?? "1 device") : count(devices.length)}?`,
  confirmLabel: devices.length > 1 ? `Pause ${count(devices.length)}` : "Pause device",
});

/** Pause (disruptive: asks in the confirm dialog) or resume, with Undo running the other one on the devices that changed. */
export function pauseRequest(devices: ReadonlyArray<DeviceRef>, paused: boolean): WriteRequest<{ devices: string[] }, DeviceBulkResult> {
  const verb = paused ? "Paused" : "Resumed";
  return {
    id: paused ? "device.pause" : "device.resume",
    params: { devices: ids(devices) },
    success: (r) => outcome(verb, devices, r),
    failure: `Couldn't ${paused ? "pause" : "resume"} ${who(devices)}`,
    undo: (r) => {
      const undo = changed(r, devices, (d) => d.paused === paused);
      if (!undo.length) return null;
      return paused
        ? { id: "device.resume", params: { devices: undo } }
        : { id: "device.pause", params: { devices: undo }, confirm: pauseConfirm(devices.filter((d) => undo.includes(d.id))) };
    },
    confirm: paused ? pauseConfirm(devices) : undefined,
  };
}

/** The block confirm. `device.block` is disruptive, so the engine asks; this is the copy the dialog shows. */
function blockConfirm(devices: ReadonlyArray<Pick<DeviceRef, "name">>, where: string) {
  const many = devices.length > 1;
  return {
    title: `Block ${devices.length === 1 ? (devices[0]?.name ?? "1 device") : count(devices.length)}?`,
    message: many
      ? `They are disconnected from every eero and can't rejoin ${where} until you unblock them.`
      : `It will be disconnected from every eero and can't rejoin ${where} until you unblock it from Devices > Blocked.`,
    confirmLabel: many ? `Block ${count(devices.length)}` : "Block device",
  };
}

/**
 * Block (disruptive: asks in the confirm dialog) or unblock, with Undo running the other one.
 */
export function blockRequest(
  devices: ReadonlyArray<DeviceRef>,
  blocked: boolean,
  opts: { networkName?: string | null } = {},
): WriteRequest<{ devices: string[] }, DeviceBulkResult> {
  const where = opts.networkName ?? "this network";
  return {
    id: blocked ? "device.block" : "device.unblock",
    params: { devices: ids(devices) },
    success: (r) => outcome(blocked ? "Blocked" : "Unblocked", devices, r),
    failure: `Couldn't ${blocked ? "block" : "unblock"} ${who(devices)}`,
    undo: (r) => {
      const undo = changed(r, devices, (d) => d.blocked === blocked);
      if (!undo.length) return null;
      return blocked
        ? { id: "device.unblock", params: { devices: undo } }
        : { id: "device.block", params: { devices: undo }, confirm: blockConfirm(devices.filter((d) => undo.includes(d.id)), where) };
    },
    confirm: blocked ? blockConfirm(devices, where) : undefined,
  };
}

/** Move to a profile (null: Unassigned). Undo when every device came from the same place. */
export function profileRequest(
  devices: ReadonlyArray<DeviceRef>,
  profile: ProfileOption | null,
): WriteRequest<{ devices: string[]; profile: string | null }, DeviceBulkResult> {
  const before = new Set(devices.map((d) => d.profileId));
  const [prev] = before;
  const target = profile?.name ?? "Unassigned";
  return {
    id: "device.profile.set",
    params: { devices: ids(devices), profile: profile?.id ?? null },
    success: (r) => movedText(target, devices, r),
    failure: `Couldn't move ${who(devices)} to ${target}`,
    // Core asks only when the move takes devices offline (the target is paused, or a scheduled pause is on).
    confirm: { title: `Move ${who(devices)} to ${target}?`, confirmLabel: `Move to ${target}` },
    undo: (r) => {
      const undo = changed(r, devices, (d) => d.profileId === (profile?.id ?? null));
      return before.size === 1 && undo.length ? { id: "device.profile.set", params: { devices: undo, profile: prev ?? null } } : null;
    },
  };
}

function movedText(target: string, devices: ReadonlyArray<DeviceRef>, r: DeviceBulkResult): string {
  if (r.failed.length === 0) return `Moved ${who(devices)} to ${target}`;
  const f = r.failed[0];
  const name = devices.find((d) => d.id === f?.id)?.name ?? f?.device ?? "";
  return `Moved ${r.devices.length} of ${r.devices.length + r.failed.length} to ${target}. ${name}: ${f?.message ?? ""}`;
}

/** The ids a bulk write left unchanged (failed), or [] when it was cancelled or failed as a whole. */
export function failedIds(res: Awaited<ReturnType<typeof performWrite<unknown, DeviceBulkResult>>>): string[] {
  if (!res?.ok) return [];
  return res.result.failed.flatMap((f) => (f.id ? [f.id] : []));
}

// ---------------------------------------------------------------------------
// Profile menu

function Avatar({ p }: { p: ProfileOption | null }) {
  if (!p) return <span aria-hidden className="size-4 shrink-0 rounded-full border border-dashed" />;
  return (
    <span
      aria-hidden
      className="grid size-4 shrink-0 place-items-center rounded-full font-semibold text-[9px] text-background"
      style={{ background: p.color }}
    >
      {p.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** The profile rows of a menu: each profile, then Unassigned, with a check on `current`. */
export function ProfileItems({
  profiles,
  current,
  onPick,
}: {
  profiles: ReadonlyArray<ProfileOption>;
  /** The devices' shared profile: an id, null (Unassigned), or undefined when mixed. */
  current: string | null | undefined;
  onPick: (p: ProfileOption | null) => void;
}) {
  const rows: (ProfileOption | null)[] = [...profiles, null];
  return (
    <>
      {rows.map((p) => {
        const on = (p?.id ?? null) === current;
        return (
          <MenuItem key={p?.id ?? "unassigned"} onClick={() => onPick(p)}>
            <Check className={cn(!on && "invisible")} />
            <Avatar p={p} />
            <span className="min-w-0 flex-1 truncate">{p ? p.name : "Unassigned"}</span>
          </MenuItem>
        );
      })}
    </>
  );
}

/** A button that opens the profile list; picking one runs `onPick`. */
export function ProfileMenu({
  trigger,
  profiles,
  current,
  onPick,
  label = "Change profile",
}: {
  trigger: ReactElement;
  profiles: ReadonlyArray<ProfileOption>;
  current: string | null | undefined;
  onPick: (p: ProfileOption | null) => void;
  label?: string;
}) {
  return (
    <Menu>
      <MenuTrigger render={trigger} aria-label={label} />
      <MenuPopup>
        <ProfileItems profiles={profiles} current={current} onPick={onPick} />
      </MenuPopup>
    </Menu>
  );
}

// ---------------------------------------------------------------------------
// Bulk bar

type BulkBarProps = {
  /** The selected devices, in table order. */
  selected: ReadonlyArray<Device>;
  profiles: ReadonlyArray<ProfileOption>;
  networkName: string | null;
  /** Bridge mode: pause, profiles and block are hidden. */
  bridged: boolean;
  /** Pause, resume and profiles. */
  gate: Gate;
  /** Block (also needs the blocklist capability). */
  blockGate: Gate;
  /** Selection after a write: the failed rows stay selected, else none. */
  onSelect: (ids: string[]) => void;
};

/** The bar over the table while rows are selected (devices.md, Layout 4). */
/**
 * The bar slides open under the filters when the first row is picked, so the
 * table moves down smoothly instead of jumping a row, and its contents fade
 * in once it has room; closing reverses it, still showing the last selection
 * while it folds away. Reduced motion skips both.
 */
export function BulkBar(props: BulkBarProps) {
  const open = props.selected.length > 0;
  const last = useRef(props.selected);
  if (open) last.current = props.selected;
  return (
    <div
      data-open={open || undefined}
      inert={!open}
      className={cn(
        // Closed, it also cancels the column's gap above it, so nothing is left behind.
        "-mt-2.5 grid grid-rows-[0fr] transition-[grid-template-rows,margin] delay-75 duration-200 ease-out motion-reduce:transition-none",
        "data-open:mt-0 data-open:grid-rows-[1fr] data-open:delay-0",
      )}
    >
      <div
        className={cn(
          "min-h-0 overflow-hidden opacity-0 transition-opacity duration-75 motion-reduce:transition-none",
          open && "opacity-100 delay-150 duration-150",
        )}
      >
        <BulkBarContent {...props} selected={last.current} />
      </div>
    </div>
  );
}

function BulkBarContent({ selected, profiles, networkName, bridged, gate: writeGate, blockGate: blockWriteGate, onSelect }: BulkBarProps) {
  if (selected.length === 0) return null;
  const tooMany: Gate = { allowed: false, reason: `Select ${BULK_MAX} devices or fewer` };
  const over = selected.length > BULK_MAX;
  const gate = over ? tooMany : writeGate;
  const blockGate = over ? tooMany : blockWriteGate;
  const guestsOnly = selected.every((d) => d.ssid === "guest");
  const allBlocked = selected.every((d) => d.blocked);
  const names = selected.map((d) => d.name).join(", ");
  const shared = new Set(selected.map((d) => d.profileId));
  const current = shared.size === 1 ? [...shared][0] : undefined;
  const after = async (req: WriteRequest<unknown, DeviceBulkResult>) => {
    const res = await performWrite(req);
    if (res?.ok) onSelect(failedIds(res));
  };
  const showPause = !bridged && !guestsOnly && !allBlocked;

  return (
    <div className="flex items-center gap-2.5 rounded-xl bg-muted/60 py-2 ps-3.5 pe-2.5" role="toolbar" aria-label="Selected devices">
      <Checkbox aria-label="Clear selection" checked indeterminate onCheckedChange={() => onSelect([])} />
      <span className="shrink-0 font-medium text-[13px] tabular-nums">{selected.length} selected</span>
      <span className="min-w-0 truncate text-muted-foreground text-xs" title={names}>
        {names}
      </span>
      <div className="ms-auto flex shrink-0 items-center gap-2">
        {showPause && (
          <>
            <GatedButton gate={gate} variant="outline" size="xs" onClick={() => void after(pauseRequest(selected, true))}>
              <Pause />
              Pause…
            </GatedButton>
            <GatedButton gate={gate} variant="outline" size="xs" onClick={() => void after(pauseRequest(selected, false))}>
              <Play />
              Resume
            </GatedButton>
            {gate.allowed ? (
              <ProfileMenu
                label="Assign profile"
                profiles={profiles}
                current={current}
                onPick={(p) => void after(profileRequest(selected, p))}
                trigger={
                  <Button variant="outline" size="xs">
                    <UserRoundPlus />
                    Assign profile
                    <ChevronDown />
                  </Button>
                }
              />
            ) : (
              <GatedButton gate={gate} variant="outline" size="xs">
                <UserRoundPlus />
                Assign profile
                <ChevronDown />
              </GatedButton>
            )}
          </>
        )}
        {!bridged &&
          (allBlocked ? (
            <GatedButton gate={blockGate} variant="outline" size="xs" onClick={() => void after(blockRequest(selected, false))}>
              <CircleCheck />
              Unblock {selected.length}
            </GatedButton>
          ) : (
            <GatedButton
              gate={blockGate}
              variant="outline"
              size="xs"
              tone="danger"
              onClick={() => void after(blockRequest(selected.filter((d) => !d.blocked), true, { networkName }))}
            >
              <Ban />
              Block {selected.filter((d) => !d.blocked).length}…
            </GatedButton>
          ))}
        <span aria-hidden className="h-[18px] w-px bg-border" />
        <Button variant="ghost" size="xs" onClick={() => onSelect([])}>
          <X />
          Clear
        </Button>
      </div>
    </div>
  );
}
