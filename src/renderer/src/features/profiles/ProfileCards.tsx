/**
 * Profiles section: one card per profile (or one row in List view) with its
 * initial in the profile colour, devices and how many are online, device
 * type icons, state, the next scheduled change, and today's usage with a
 * 24 h sparkline. Pause and Resume per card, Pause all, and a menu with
 * Rename and Delete. docs/ux/pages/profiles.md (Layout 1, Actions).
 *
 * Also the profile write pieces shared with profile detail and Overview:
 * ProfilePauseButton, ProfileSheet (add, rename, devices) and
 * useDeleteProfile.
 */
import { Popover } from "@base-ui/react/popover";
import { Ellipsis, LayoutGrid, List, Pause, Pencil, Play, Plus, Trash2, UserRoundPlus } from "lucide-react";
import { useState } from "react";

import { Link, navigate, pathFor } from "~/app/router";
import { affectedBy, execute, invalidate, type QueryState, useQuery } from "~/app/useCommand";
import { askInDialog, errorText, fieldErrors, useWrite } from "~/app/useWrite";
import { Sparkline } from "~/components/charts/Sparkline";
import { Button } from "~/components/ui/button";
import { Card, Empty, Section } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { GatedButton, SectionError, useGate } from "~/components/ui/page";
import { Segmented } from "~/components/ui/segmented";
import { Sheet, SheetField } from "~/components/ui/sheet";
import { Status, type StatusTone } from "~/components/ui/status";
import { toast } from "~/components/ui/toast";
import { deviceIcon } from "~/lib/deviceIcons";
import { cn } from "~/lib/utils";
import { bytesParts, formatBytes, MISSING, networkClock } from "../../../../core/format";
import type { Device, DeviceList, Profile, ProfileList, UsageSeries } from "../../../../core/model";
import { nameList, pauseAllMessage, pickerRows } from "../profile/helpers";

import type { ProfileColor } from "./ProfilesPage";

const VIEWS = [
  { value: "cards", label: "Cards", icon: LayoutGrid },
  { value: "list", label: "List", icon: List },
] as const;

export const PROFILE_STATE: Record<Profile["state"], { tone: StatusTone; label: string }> = {
  active: { tone: "success", label: "Active" },
  scheduled: { tone: "info", label: "Scheduled" },
  paused: { tone: "warning", label: "Paused" },
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "Pauses 4:00 PM · Homework", "Resumes Fri 7:00 AM", or null. Times in the network time zone. */
export function nextLine(p: Profile, timezone: string | null, now = Date.now()): string | null {
  if (p.paused) return "Paused until resumed";
  const next = p.nextChange;
  if (!next) return null;
  const clock = networkClock(timezone);
  const sameDay = clock.day(next.at) === clock.day(now);
  const when = sameDay ? clock.time(next.at) : `${clock.weekday(next.at)} ${clock.time(next.at)}`;
  const name = p.schedules.find((s) => s.id === next.scheduleId)?.name;
  return `${next.to === "paused" ? "Pauses" : "Resumes"} ${when}${name ? ` · ${name}` : ""}`;
}

/** The profile's initial in its colour. */
export function Avatar({ name, color, className }: { name: string; color: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("grid size-9 shrink-0 place-items-center rounded-full font-semibold text-background text-sm", className)}
      style={{ backgroundColor: color }}
    >
      {name.slice(0, 1).toUpperCase() || "?"}
    </span>
  );
}

type Props = {
  profiles: QueryState<ProfileList>;
  devices: ReadonlyArray<Device> | undefined;
  usage: ReadonlyArray<UsageSeries> | undefined;
  colorOf: ProfileColor;
  timezone: string | null;
};

export function ProfileCards({ profiles, devices, usage, colorOf, timezone }: Props) {
  const [view, setView] = useState<"cards" | "list">("cards");
  const [sheet, setSheet] = useState<SheetMode | null>(null);
  const createGate = useGate({ ...PROFILE_GATE, op: "create" });
  const list = profiles.data?.profiles ?? [];
  const byId = new Map((devices ?? []).map((d) => [d.id, d]));
  const series = new Map((usage ?? []).map((s) => [s.id, s]));
  const loading = !profiles.data;

  const items = (loading ? PLACEHOLDERS : list).map((p) => ({
    profile: p,
    devices: p.deviceIds.flatMap((id) => byId.get(id) ?? []),
    usage: series.get(p.id),
  }));

  return (
    <Section
      title="Profiles"
      subtitle="Group devices by person to pause them together and see their usage"
      tools={
        list.length > 0 ? (
          <>
            <PauseAllButton profiles={list} />
            <Segmented aria-label="Profile layout" value={view} onValueChange={setView} options={VIEWS} />
          </>
        ) : null
      }
    >
      {profiles.error && !profiles.data ? (
        <SectionError what="profiles" error={profiles.error} onRetry={() => void profiles.refetch()} />
      ) : profiles.data && list.length === 0 ? (
        <Card>
          <Empty className="flex flex-col items-center gap-3">
            <span>No profiles yet. Group devices by person to pause them together.</span>
            <GatedButton gate={createGate} size="xs" variant="outline" onClick={() => setSheet({ kind: "create" })}>
              <Plus />
              Add a profile
            </GatedButton>
          </Empty>
        </Card>
      ) : view === "cards" ? (
        <div className={cn("grid gap-4 sm:grid-cols-2 xl:grid-cols-4", profiles.fading && "opacity-40 transition-opacity")}>
          {items.map((x) => (
            <ProfileCard key={x.profile.id} {...x} placeholder={loading} color={colorOf(x.profile.id)} timezone={timezone} onRename={() => setSheet({ kind: "rename", profile: x.profile })} />
          ))}
        </div>
      ) : (
        <Card className={cn("divide-y", profiles.fading && "opacity-40 transition-opacity")}>
          {items.map((x) => (
            <ProfileRow key={x.profile.id} {...x} color={colorOf(x.profile.id)} timezone={timezone} />
          ))}
        </Card>
      )}
      <ProfileSheet mode={sheet} onClose={() => setSheet(null)} />
    </Section>
  );
}

/** Four blank cards at normal size while the list loads. */
const PLACEHOLDERS: Profile[] = Array.from({ length: 4 }, (_, i) => ({
  id: `placeholder-${i}`,
  name: "",
  state: "active",
  paused: false,
  deviceIds: [],
  devicesOnline: 0,
  schedules: [],
  nextChange: null,
}));

type CardProps = { profile: Profile; devices: Device[]; usage: UsageSeries | undefined; color: string; timezone: string | null };

function DeviceStack({ devices }: { devices: Device[] }) {
  const shown = [...devices].sort((a, b) => Number(b.connected) - Number(a.connected)).slice(0, 6);
  return (
    <div className="flex min-h-7" aria-hidden>
      {shown.map((d) => {
        const Icon = deviceIcon(d);
        return (
          <span
            key={d.id}
            title={d.name}
            className={cn(
              "-me-1.5 grid size-[26px] place-items-center rounded-lg bg-muted text-muted-foreground shadow-[0_0_0_2px_var(--color-card),inset_0_0_0_1px_var(--color-border)]",
              !d.connected && "opacity-50",
            )}
          >
            <Icon className="size-3.5" />
          </span>
        );
      })}
    </div>
  );
}

const deviceLine = (p: Profile) => `${plural(p.deviceIds.length, "device")} · ${p.devicesOnline} online`;

function Today({ usage }: { usage: UsageSeries | undefined }) {
  const today = bytesParts(usage?.todaySoFar);
  return (
    <span className="font-medium text-xl tabular-nums tracking-tight">
      {today.value}
      {today.unit && <span className="ms-1 font-normal text-muted-foreground text-xs">{today.unit}</span>}
    </span>
  );
}

function PauseButton({ profile, className }: { profile: Profile; className?: string }) {
  return <ProfilePauseButton profile={profile} size="sm" variant={profile.paused ? "default" : "outline"} className={cn("w-full", className)} />;
}

function ProfileCard({ profile: p, devices, usage, color, timezone, placeholder, onRename }: CardProps & { placeholder: boolean; onRename: () => void }) {
  const to = pathFor("profile", { profileId: p.id });
  const state = PROFILE_STATE[p.state];
  const next = placeholder ? null : nextLine(p, timezone);
  return (
    <Card
      padded
      className={cn("flex cursor-pointer flex-col gap-3.5 transition-colors hover:bg-muted/30", p.paused && "border-muted-foreground/40", placeholder && "pointer-events-none")}
      onClick={() => !placeholder && navigate(to)}
    >
      <div className="flex items-center gap-3">
        <Avatar name={placeholder ? "" : p.name} color={placeholder ? "var(--color-muted)" : color} />
        <div className="min-w-0 flex-1">
          {placeholder ? (
            <div className="font-medium text-[15px]">{MISSING}</div>
          ) : (
            <Link to={to} className="block truncate font-medium text-[15px] outline-none focus-visible:underline" onClick={(e) => e.stopPropagation()}>
              {p.name}
            </Link>
          )}
          <div className="truncate text-muted-foreground text-xs">{placeholder ? MISSING : deviceLine(p)}</div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <DeviceStack devices={devices} />
        {!placeholder && <Status tone={state.tone}>{state.label}</Status>}
      </div>
      <div className="min-h-4 truncate text-muted-foreground text-xs">{placeholder ? "" : (next ?? "No schedules")}</div>
      <div>
        <div className="flex items-baseline justify-between">
          <span className="text-muted-foreground text-xs">Today</span>
          <Today usage={usage} />
        </div>
        <Sparkline
          className="mt-1 h-[34px] w-full"
          values={(usage?.points ?? []).map((x) => x.down + x.up)}
          color={color}
          ariaLabel={`Data used by ${p.name} per hour today`}
        />
      </div>
      <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
        <div className="min-w-0 flex-1 [&>span]:flex">{!placeholder && <PauseButton profile={p} />}</div>
        {!placeholder && <ProfileMenu profile={p} onRename={onRename} />}
      </div>
    </Card>
  );
}

function ProfileRow({ profile: p, devices, usage, color, timezone }: CardProps) {
  const to = pathFor("profile", { profileId: p.id });
  const state = PROFILE_STATE[p.state];
  const placeholder = p.id.startsWith("placeholder-");
  return (
    <div className="flex min-h-[58px] items-center gap-4 px-[18px] py-2.5">
      <Avatar name={p.name} color={placeholder ? "var(--color-muted)" : color} className="size-7 text-xs" />
      <div className="w-40 min-w-0">
        {placeholder ? (
          <div className="font-medium text-[13.5px]">{MISSING}</div>
        ) : (
          <Link to={to} className="block truncate font-medium text-[13.5px] hover:underline">
            {p.name}
          </Link>
        )}
        <div className="truncate text-muted-foreground text-xs">{placeholder ? MISSING : deviceLine(p)}</div>
      </div>
      <div className="hidden w-44 lg:block">
        <DeviceStack devices={devices} />
      </div>
      <div className="w-24">{!placeholder && <Status tone={state.tone}>{state.label}</Status>}</div>
      <div className="hidden min-w-0 flex-1 truncate text-muted-foreground text-xs md:block">{placeholder ? "" : (nextLine(p, timezone) ?? "No schedules")}</div>
      <div className="w-20 text-right text-sm tabular-nums" title="Today">
        {formatBytes(usage?.todaySoFar)}
      </div>
      <div className="w-28 [&>span]:flex">{!placeholder && <PauseButton profile={p} />}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Writes (M4.5), shared with profile detail and Overview.

/** Profile writes need the `profiles` permission and NAT mode. */
export const PROFILE_GATE = { area: "profiles", bridgeOff: true } as const;

/** Pause or Resume one profile, with Undo. */
export function ProfilePauseButton({
  profile: p,
  size = "sm",
  variant = "outline",
  className,
}: {
  profile: Profile;
  size?: "sm" | "lg";
  variant?: "default" | "outline";
  className?: string;
}) {
  const gate = useGate(PROFILE_GATE);
  const id = p.paused ? "profile.resume" : "profile.pause";
  const write = useWrite(id, {
    success: `${p.paused ? "Resumed" : "Paused"} ${p.name}`,
    failure: `Couldn't ${p.paused ? "resume" : "pause"} ${p.name}`,
    undo: { id: p.paused ? "profile.pause" : "profile.resume", params: { profile: p.id }, success: `${p.paused ? "Paused" : "Resumed"} ${p.name}` },
  });
  return (
    <GatedButton gate={gate} size={size} variant={variant} className={className} disabled={write.running} onClick={() => void write.run({ profile: p.id })}>
      {p.paused ? <Play /> : <Pause />}
      {size === "lg" ? (p.paused ? "Resume profile" : "Pause profile") : p.paused ? "Resume" : "Pause"}
    </GatedButton>
  );
}

/** Pause all: every profile not yet paused (Unassigned not included), after a confirm, with one Undo. */
function PauseAllButton({ profiles }: { profiles: ReadonlyArray<Profile> }) {
  const gate = useGate(PROFILE_GATE);
  const [running, setRunning] = useState(false);
  const targets = profiles.filter((p) => !p.paused);
  const run = async () => {
    const copy = pauseAllMessage(targets);
    if (!(await askInDialog({ id: "profile.pause", effect: "write", ...copy, confirmLabel: "Pause all" }))) return;
    setRunning(true);
    const done = await runEach("profile.pause", targets);
    setRunning(false);
    if (done.length === 0) return;
    toast.success(`Paused ${nameList(done.map((p) => p.name))}`, {
      action: { label: "Undo", run: async () => (await runEach("profile.resume", done)).length > 0 && toast.success("Undone") },
    });
  };
  return (
    <GatedButton
      gate={targets.length === 0 && gate.allowed ? { allowed: false, reason: "Every profile is paused" } : gate}
      size="xs"
      variant="outline"
      disabled={running}
      onClick={() => void run()}
    >
      <Pause />
      Pause all
    </GatedButton>
  );
}

/** Runs one write per profile in turn; an error toast names the ones that failed. Returns the ones that worked. */
async function runEach(id: "profile.pause" | "profile.resume", list: ReadonlyArray<Profile>): Promise<Profile[]> {
  const done: Profile[] = [];
  const failed: { p: Profile; text: string }[] = [];
  for (const p of list) {
    const res = await execute(id, { profile: p.id });
    if (res.ok) done.push(p);
    else failed.push({ p, text: errorText(id, res.error) });
  }
  invalidate(affectedBy(id));
  if (failed.length > 0) {
    const verb = id === "profile.pause" ? "pause" : "resume";
    toast.error(`Couldn't ${verb} ${nameList(failed.map((f) => f.p.name))}`, {
      detail: failed[0]?.text,
      action: { label: "Retry", run: () => runEach(id, failed.map((f) => f.p)) },
    });
  }
  return done;
}

/** Delete a profile: the type-the-name dialog, then a toast. `onDeleted` runs after it is gone. */
export function useDeleteProfile(onDeleted?: () => void) {
  const write = useWrite<{ profile: string }>("profile.delete", { confirmIn: "dialog" });
  return {
    running: write.running,
    run: async (p: Pick<Profile, "id" | "name">) => {
      const res = await write.run(
        { profile: p.id },
        { success: `Deleted ${p.name}`, failure: `Couldn't delete ${p.name}`, confirm: { title: `Delete ${p.name}?`, confirmLabel: "Delete profile", typeToConfirm: p.name } },
      );
      if (res?.ok) onDeleted?.();
      return res;
    },
  };
}

/** The `...` menu on a card: Rename and Delete. */
function ProfileMenu({ profile: p, onRename }: { profile: Profile; onRename: () => void }) {
  const gate = useGate(PROFILE_GATE);
  const [open, setOpen] = useState(false);
  const del = useDeleteProfile();
  const item = "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted [&_svg]:size-3.5 [&_svg]:text-muted-foreground";
  if (!gate.allowed) {
    return (
      <GatedButton gate={gate} size="icon-sm" variant="outline" aria-label="More actions">
        <Ellipsis />
      </GatedButton>
    );
  }
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger render={<Button size="icon-sm" variant="outline" aria-label={`More actions for ${p.name}`} />}>
        <Ellipsis />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={4} className="z-50">
          <Popover.Popup className="w-44 rounded-xl border bg-popover p-1 text-popover-foreground text-xs shadow-lg outline-none">
            <button
              type="button"
              className={item}
              onClick={() => {
                setOpen(false);
                onRename();
              }}
            >
              <Pencil />
              Rename
            </button>
            <button
              type="button"
              className={cn(item, "text-destructive-foreground")}
              disabled={del.running}
              onClick={() => {
                setOpen(false);
                void del.run(p);
              }}
            >
              <Trash2 />
              Delete profile...
            </button>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

export type SheetMode = { kind: "create"; deviceIds?: string[] } | { kind: "rename"; profile: Profile } | { kind: "devices"; profile: Profile };

/** Add a profile (name and devices), Rename (name) or a profile's devices (picker), in one edit sheet. */
export function ProfileSheet({ mode, onClose, openAfterCreate = true }: { mode: SheetMode | null; onClose: () => void; openAfterCreate?: boolean }) {
  return mode ? <ProfileSheetBody key={mode.kind + (mode.kind === "create" ? "" : mode.profile.id)} mode={mode} onClose={onClose} openAfterCreate={openAfterCreate} /> : null;
}

function ProfileSheetBody({ mode, onClose, openAfterCreate }: { mode: SheetMode; onClose: () => void; openAfterCreate: boolean }) {
  const profile = mode.kind === "create" ? null : mode.profile;
  const startName = profile?.name ?? "";
  const startIds = mode.kind === "create" ? (mode.deviceIds ?? []) : (profile?.deviceIds ?? []);
  const [name, setName] = useState(startName);
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set(startIds));
  const showName = mode.kind !== "devices";
  const showDevices = mode.kind !== "rename";
  const devices = useQuery<DeviceList>("device.list", undefined, { enabled: showDevices });
  const profiles = useQuery<ProfileList>("profile.list", undefined, { enabled: showDevices });

  const create = useWrite<{ name: string; devices: string[] }, Profile>("profile.create", { form: true });
  const rename = useWrite<{ profile: string; name: string }, Profile>("profile.rename", { form: true });
  const setDevices = useWrite<{ profile: string; devices: string[] }, Profile>("profile.devices.set", { form: true });
  const active = mode.kind === "create" ? create : mode.kind === "rename" ? rename : setDevices;
  const errors = fieldErrors(active.error);

  const trimmed = name.trim();
  const sameIds = picked.size === startIds.length && startIds.every((id) => picked.has(id));
  const dirty = mode.kind === "create" ? trimmed !== "" || picked.size > 0 : mode.kind === "rename" ? trimmed !== startName : !sameIds;
  const nameError = !showName ? undefined : trimmed.length > 32 ? "Use 32 characters or fewer." : errors.name;
  const valid = !showName || (trimmed.length > 0 && trimmed.length <= 32);

  const rows = pickerRows(devices.data?.devices ?? [], profiles.data?.profiles ?? [], profile?.id ?? null);
  const save = async () => {
    if (mode.kind === "create") {
      const res = await create.run({ name: trimmed, devices: [...picked] }, { success: (r) => `Added ${r.name}` });
      if (res?.ok && openAfterCreate) navigate(pathFor("profile", { profileId: res.result.id }));
      return res;
    }
    if (mode.kind === "rename") {
      return rename.run(
        { profile: mode.profile.id, name: trimmed },
        { success: `Renamed ${startName} to ${trimmed}`, undo: { id: "profile.rename", params: { profile: mode.profile.id, name: startName } } },
      );
    }
    // Undo restores this profile's list only; devices taken from another profile would end up Unassigned, so no Undo then.
    const taken = rows.some((r) => picked.has(r.id) && !startIds.includes(r.id) && r.note !== null && r.note !== "Unassigned");
    return setDevices.run(
      { profile: mode.profile.id, devices: [...picked] },
      {
        success: `Updated ${mode.profile.name}'s devices`,
        undo: taken ? undefined : { id: "profile.devices.set", params: { profile: mode.profile.id, devices: startIds } },
      },
    );
  };

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Sheet
      open
      onClose={onClose}
      icon={mode.kind === "create" ? <UserRoundPlus /> : mode.kind === "rename" ? <Pencil /> : <Plus />}
      title={mode.kind === "create" ? "Add a profile" : mode.kind === "rename" ? `Rename ${startName}` : `${startName}'s devices`}
      subtitle={showDevices ? `${picked.size} ${picked.size === 1 ? "device" : "devices"} selected · devices move out of their old profile` : undefined}
      dirty={dirty}
      valid={valid}
      onSave={save}
      saveLabel={mode.kind === "create" ? "Add profile" : "Save"}
      error={errors._form}
    >
      {showName && (
        <SheetField label="Name" htmlFor="profile-sheet-name" error={nameError} helper={`${trimmed.length} / 32`}>
          <Input id="profile-sheet-name" value={name} autoFocus placeholder="Alex" onChange={(e) => setName(e.target.value)} />
        </SheetField>
      )}
      {showDevices && (
        <SheetField label="Devices" error={errors.devices}>
          <div className="max-h-72 overflow-y-auto rounded-[var(--control-radius)] border">
            {!devices.data ? (
              <div className="px-3 py-2 text-muted-foreground text-xs">{MISSING}</div>
            ) : rows.length === 0 ? (
              <div className="px-3 py-2 text-muted-foreground text-xs">No devices on this network yet.</div>
            ) : (
              rows.map((r) => {
                const Icon = deviceIcon(r.device);
                return (
                  <label key={r.id} className="flex cursor-pointer items-center gap-2.5 border-b px-3 py-1.5 last:border-b-0 hover:bg-muted/50">
                    <input type="checkbox" className="accent-primary" checked={picked.has(r.id)} onChange={() => toggle(r.id)} />
                    <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-[13px]">{r.name}</span>
                    {r.note && <span className="shrink-0 text-2xs text-muted-foreground">{r.note}</span>}
                  </label>
                );
              })
            )}
          </div>
        </SheetField>
      )}
    </Sheet>
  );
}
