/**
 * "Your profiles": one card per profile (or one row in List view) with its
 * initial in the profile colour, devices and how many are online, device
 * type icons, state, the next scheduled change, and today's usage with a
 * 24 h sparkline; under them, the unassigned devices (UnassignedCard.tsx).
 * While unassigned devices are selected or one is being dragged, the cards
 * turn into dotted drop targets: drop on one, or click it, to move the
 * devices there, and the new icons bounce into its stack. Tools: Card view /
 * List view, "Add a profile…" (which becomes "Add profile from selection…"
 * while unassigned devices are selected) and "View unassigned profile".
 * Cards carry no buttons: pausing,
 * schedules, rename and delete happen on the profile's own page, one click
 * away. Add a profile, Pause all and Resume all live in the page hero
 * (ProfilesHero.tsx).
 * docs/ux/pages/profiles.md (Layout 2, Actions).
 *
 * Also the profile write pieces shared with profile detail and Overview:
 * ProfilePauseButton, ProfileSheet (add, rename, devices) and
 * useDeleteProfile.
 */
import { Pause, Pencil, Play, Plus, UserRoundPlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Link, navigate, pathFor } from "~/app/router";
import { affectedBy, execute, invalidate, type QueryState, useQuery } from "~/app/useCommand";
import { askInDialog, errorText, fieldErrors, useWrite } from "~/app/useWrite";
import { Sparkline } from "~/components/charts/Sparkline";
import { Card, CardLink, Empty, Section } from "~/components/ui/card";
import { WriteConfirmDialog } from "~/components/ui/confirm";
import { Input } from "~/components/ui/input";
import { GatedButton, SectionError, SectionLink, useGate } from "~/components/ui/page";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Sheet, SheetField } from "~/components/ui/sheet";
import { Status, type StatusTone } from "~/components/ui/status";
import { toast } from "~/components/ui/toast";
import { deviceIcon } from "~/lib/deviceIcons";
import { cn } from "~/lib/utils";
import { bytesParts, formatBytes, MISSING, networkClock } from "../../../../core/format";
import type { Device, DeviceList, Profile, ProfileList, UsageBreakdown, UsageSeries } from "../../../../core/model";
import { nameList, pauseAllMessage, pickerRows } from "../profile/helpers";

import type { ProfileColor } from "./ProfilesPage";
import { type Assign, UnassignedPool, useAssign } from "./UnassignedCard";

const VIEWS = [
  { value: "cards", label: "Card view" },
  { value: "list", label: "List view" },
] as const;

export const PROFILE_STATE: Record<Profile["state"], { tone: StatusTone; label: string }> = {
  active: { tone: "success", label: "Active" },
  scheduled: { tone: "info", label: "Scheduled" },
  paused: { tone: "warning", label: "Paused" },
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "Homework starts 4:00 PM", "Bedtime ends Fri 7:00 AM", "Resumes 6:00 PM", or null. Times in the network time zone. */
export function nextLine(p: Profile, timezone: string | null, now = Date.now()): string | null {
  if (p.paused) return "Paused until resumed";
  const next = p.nextChange;
  if (!next) return null;
  const clock = networkClock(timezone);
  const sameDay = clock.day(next.at) === clock.day(now);
  const when = sameDay ? clock.time(next.at) : `${clock.weekday(next.at)} ${clock.time(next.at)}`;
  const name = p.schedules.find((s) => s.id === next.scheduleId)?.name;
  if (name) return `${name} ${next.to === "paused" ? "starts" : "ends"} ${when}`;
  return `${next.to === "paused" ? "Pauses" : "Resumes"} ${when}`;
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
  devices: QueryState<DeviceList>;
  usage: ReadonlyArray<UsageSeries> | undefined;
  /** Per-device data over 24 hours, for the unassigned tiles. */
  deviceUsage: UsageBreakdown | undefined;
  colorOf: ProfileColor;
  timezone: string | null;
  /** Opens the page's profile sheet (add, rename). */
  setSheet: (mode: SheetMode) => void;
};

export function ProfileCards({ profiles, devices, usage, deviceUsage, colorOf, timezone, setSheet }: Props) {
  const [view, setView] = useState<"cards" | "list">("cards");
  const createGate = useGate({ ...PROFILE_GATE, op: "create" });
  const list = profiles.data?.profiles ?? [];
  const byId = new Map((devices.data?.devices ?? []).map((d) => [d.id, d]));
  const assign = useAssign(profiles.data, devices);
  const series = new Map((usage ?? []).map((s) => [s.id, s]));
  const loading = !profiles.data;

  const items = (loading ? PLACEHOLDERS : list).map((p) => ({
    profile: p,
    devices: p.deviceIds.flatMap((id) => byId.get(id) ?? []),
    usage: series.get(p.id),
  }));

  const deviceCount = list.reduce((n, p) => n + p.deviceIds.length, 0);
  const unassigned = assign.list;

  return (
    <Section
      title="Your profiles" when="nat"
      className="gap-[15px]"
      // "18 devices in profiles, 18 unassigned": where the network's devices sit right now.
      description={assign.loaded ? `${plural(deviceCount, "device")} in profiles, ${unassigned.length} unassigned` : "-"}
      tools={
        assign.loaded ? (
          <>
            {list.length > 0 && (
              <Select items={VIEWS} value={view} onValueChange={(v) => v && setView(v)}>
                <SelectTrigger size="tool" aria-label="Profile layout">
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  {VIEWS.map((v) => (
                    <SelectItem key={v.value} value={v.value}>
                      {v.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            )}
            {/* Opens the Add a profile sheet, so it ends in an ellipsis; with a selection, those devices come picked. */}
            <GatedButton
              gate={createGate}
              variant="outline"
              className="[&_svg]:text-muted-foreground"
              onClick={() => setSheet({ kind: "create", deviceIds: assign.picked.map((d) => d.id) })}
            >
              <UserRoundPlus />
              {assign.picked.length > 0 ? `Add profile from selection (${assign.picked.length})\u2026` : "Add a profile\u2026"}
            </GatedButton>
            {/* Unassigned is paused, scheduled and inspected on its own page, like any profile. */}
            <SectionLink to={pathFor("profile", { profileId: "unassigned" })}>View unassigned profile</SectionLink>
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
            <ProfileCard
              key={x.profile.id}
              {...x}
              assign={assign}
              placeholder={loading}
              color={colorOf(x.profile.id)}
              timezone={timezone}
            />
          ))}
        </div>
      ) : (
        <Card
          className={cn(
            "divide-y divide-border/50 transition-colors",
            // While rows are drop targets, the table's border and row rules go clear so they don't fight the dotted outlines.
            // Nothing moves or resizes: neighbouring rows' outlines may touch, and the edge rows' outlines are not clipped.
            assign.dropMode && "divide-transparent overflow-visible border-transparent bg-transparent shadow-none",
            profiles.fading && "opacity-40 transition-opacity",
          )}
        >
          {items.map((x) => (
            <ProfileRow key={x.profile.id} {...x} assign={assign} color={colorOf(x.profile.id)} timezone={timezone} />
          ))}
        </Card>
      )}
      <UnassignedPool assign={assign} devices={devices} usage={deviceUsage} timezone={timezone} />
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

type CardProps = { profile: Profile; devices: Device[]; usage: UsageSeries | undefined; color: string; timezone: string | null; assign: Assign };

/**
 * What a card or row needs to be a drop target while unassigned devices are
 * selected or dragged: the zone id, a dotted outline (an outline, so nothing
 * shifts), a darker fill and outline while a drag hovers it, and a click that moves the
 * selection there instead of opening the profile.
 */
function dropTarget(p: Profile, a: Assign, placeholder: boolean) {
  const on = a.dropMode && !placeholder;
  const hot = on && a.drag.over === p.id;
  return {
    on,
    props: on
      ? {
          "data-drop-zone": p.id,
          role: "button",
          "aria-label": a.picked.length > 0 ? `Move ${a.picked.length} selected to ${p.name}` : `${p.name}, drop devices here`,
          onClick: (e: React.MouseEvent) => {
            // The card's own buttons (Pause, the menu) still do their job.
            if ((e.target as Element).closest("[data-card-ignore], button, a")) return;
            e.preventDefault();
            a.moveSelection(p);
          },
        }
      : {},
    className: cn(
      on &&
        "cursor-copy border-transparent outline-2 outline-dotted -outline-offset-1 transition-[background-color,outline-color] duration-150",
      // The card under a drag only darkens its fill and outline; it never grows (growing felt unwieldy).
      // Resting outline: the theme's border colour, as the cards' own 1px border.
      on && (hot ? "bg-muted/60 outline-foreground/60" : "outline-border hover:bg-muted/30"),
      // Lift the hovered target, so its outline draws over its neighbours' where list rows touch.
      hot && "relative z-10",
    ),
  };
}

/**
 * A device icon tile in a stack or pile. Offline is the online tile mixed
 * halfway into the window background (fill, outline and icon), so it reads
 * dimmed but stays solid: see-through tiles stacked on each other read as a
 * mess.
 */
export const iconTone = (online: boolean) =>
  online
    ? "bg-muted text-muted-foreground ring-1 ring-border ring-inset"
    : "bg-[color-mix(in_srgb,var(--color-muted)_50%,var(--color-background))] text-[color-mix(in_srgb,var(--color-muted-foreground)_50%,var(--color-background))] ring-1 ring-[color-mix(in_srgb,var(--color-border)_50%,var(--color-background))] ring-inset";

/**
 * The profile's device icons, online first, up to six and then "+N" (styled
 * like the last icon shown). Icons that arrive after the stack first drew (a
 * drop) fall in with a small bounce.
 */
function DeviceStack({ devices }: { devices: Device[] }) {
  const shown = [...devices].sort((a, b) => Number(b.connected) - Number(a.connected)).slice(0, 6);
  const extra = devices.length - shown.length;
  const seen = useRef<Set<string> | null>(null);
  const fresh = seen.current ? new Set(devices.filter((d) => !seen.current!.has(d.id)).map((d) => d.id)) : new Set<string>();
  useEffect(() => {
    seen.current = new Set(devices.map((d) => d.id));
  });
  return (
    <div className="flex min-h-7" aria-hidden>
      {shown.map((d) => (
        <StackIcon key={d.id} device={d} fresh={fresh.has(d.id)} />
      ))}
      {extra > 0 && (
        <span
          className={cn(
            "-me-1.5 grid h-[26px] min-w-[26px] place-items-center rounded-lg px-1 text-2xs tabular-nums shadow-[0_0_0_2px_var(--color-card)]",
            iconTone(shown.at(-1)?.connected ?? true),
          )}
        >
          +{extra}
        </span>
      )}
    </div>
  );
}

function StackIcon({ device: d, fresh }: { device: Device; fresh: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!fresh || !ref.current || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    ref.current.animate(
      [
        { transform: "translateY(-14px) scale(0.6)", opacity: 0 },
        { transform: "translateY(2px) scale(1.12)", opacity: 1, offset: 0.6 },
        { transform: "translateY(0) scale(1)" },
      ],
      { duration: 420, delay: 180, easing: "ease-out", fill: "backwards" },
    );
  }, [fresh]);
  const Icon = deviceIcon(d);
  return (
    <span ref={ref} title={d.name} className={cn("-me-1.5 grid size-[26px] place-items-center rounded-lg shadow-[0_0_0_2px_var(--color-card)]", iconTone(d.connected))}>
      <Icon className="size-3.5" />
    </span>
  );
}

const deviceLine = (p: Profile) => `${plural(p.deviceIds.length, "device")}, ${p.devicesOnline} online`;

function Today({ usage }: { usage: UsageSeries | undefined }) {
  const today = bytesParts(usage?.todaySoFar);
  return (
    <span className="font-medium text-xl tabular-nums tracking-tight">
      {today.value}
      {today.unit && <span className="ms-1 font-normal text-muted-foreground text-xs">{today.unit}</span>}
    </span>
  );
}

function ProfileCard({ profile: p, devices, usage, color, timezone, assign, placeholder }: CardProps & { placeholder: boolean }) {
  const to = pathFor("profile", { profileId: p.id });
  const state = PROFILE_STATE[p.state];
  const next = placeholder ? null : nextLine(p, timezone);
  const drop = dropTarget(p, assign, placeholder);
  return (
    <Card
      padded
      to={placeholder || drop.on ? undefined : to}
      {...drop.props}
      className={cn(
        "flex flex-col gap-3.5",
        p.paused && "border-muted-foreground/40 hover:border-muted-foreground/60",
        placeholder && "pointer-events-none",
        drop.className,
      )}
    >
      <div className="flex items-center gap-3">
        <Avatar name={placeholder ? "" : p.name} color={placeholder ? "var(--color-muted)" : color} />
        <div className="min-w-0 flex-1">
          {placeholder ? (
            <div className="font-medium text-[15px]">{MISSING}</div>
          ) : (
            <CardLink to={to} className="block font-medium text-[15px]">
              {p.name}
            </CardLink>
          )}
          <div className="truncate text-muted-foreground text-xs">{placeholder ? MISSING : deviceLine(p)}</div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <DeviceStack devices={devices} />
        {!placeholder && <Status tone={state.tone}>{state.label}</Status>}
      </div>
      <div className="min-h-4 truncate text-muted-foreground text-xs">{placeholder ? "" : scheduleText(p, next)}</div>
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
    </Card>
  );
}

/** The card's schedule line: the next change, "2 schedules, all off", or "No schedules". */
const scheduleText = (p: Profile, next: string | null) =>
  next ?? (p.schedules.length > 0 ? `${plural(p.schedules.length, "schedule")}, all off` : "No schedules");

function ProfileRow({ profile: p, devices, usage, color, timezone, assign }: CardProps) {
  const to = pathFor("profile", { profileId: p.id });
  const state = PROFILE_STATE[p.state];
  const placeholder = p.id.startsWith("placeholder-");
  const drop = dropTarget(p, assign, placeholder);
  return (
    <div {...drop.props} className={cn("flex min-h-[58px] items-center gap-4 px-[18px] py-2.5", drop.on && "rounded-lg", drop.className)}>
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
      <div className="hidden min-w-0 flex-1 truncate text-muted-foreground text-xs md:block">{placeholder ? "" : scheduleText(p, nextLine(p, timezone))}</div>
      <div className="w-20 text-right text-sm tabular-nums" title="Today">
        {formatBytes(usage?.todaySoFar)}
      </div>
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
  hero = false,
  variant = "outline",
  className,
}: {
  profile: Profile;
  /** In a page header: the header sets the size, and the label says "profile". */
  hero?: boolean;
  variant?: "default" | "outline";
  className?: string;
}) {
  const gate = useGate(PROFILE_GATE);
  const id = p.paused ? "profile.resume" : "profile.pause";
  // Pausing is disruptive: the engine asks, with core's message naming how many devices go offline.
  const confirm = { title: `Pause ${p.name}?`, confirmLabel: "Pause profile" };
  const write = useWrite(id, {
    success: `${p.paused ? "Resumed" : "Paused"} ${p.name}`,
    failure: `Couldn't ${p.paused ? "resume" : "pause"} ${p.name}`,
    confirm: p.paused ? undefined : confirm,
    undo: { id: p.paused ? "profile.pause" : "profile.resume", params: { profile: p.id }, confirm: p.paused ? confirm : undefined, success: `${p.paused ? "Paused" : "Resumed"} ${p.name}` },
  });
  return (
    <GatedButton
      gate={gate}
      // Outside a header: the card size used across the app (24px, 12px text, as the eero cards' Blink light), icon dimmed.
      size={hero ? undefined : "xs"}
      variant={variant}
      className={cn("[&_svg]:text-muted-foreground", className)}
      disabled={write.running}
      onClick={() => void write.run({ profile: p.id })}
    >
      {p.paused ? <Play /> : <Pause />}
      {hero ? (p.paused ? "Resume profile" : "Pause profile\u2026") : p.paused ? "Resume" : "Pause\u2026"}
    </GatedButton>
  );
}

/** Pause all: every profile not yet paused (Unassigned not included), after a confirm, with one Undo. */
export function PauseAllButton({ profiles }: { profiles: ReadonlyArray<Profile> }) {
  const gate = useGate(PROFILE_GATE);
  const [running, setRunning] = useState(false);
  const targets = profiles.filter((p) => !p.paused);
  const run = async () => {
    const copy = pauseAllMessage(targets);
    if (!(await askInDialog({ id: "profile.pause", effect: "disruptive", ...copy, confirmLabel: "Pause all" }))) return;
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
      variant="outline"
      disabled={running}
      onClick={() => void run()}
    >
      <Pause />
      Pause all{"\u2026"}
    </GatedButton>
  );
}

/** Resume all: every paused profile, no confirm (resuming takes nothing offline), with one Undo that pauses them again. */
export function ResumeAllButton({ profiles }: { profiles: ReadonlyArray<Profile> }) {
  const gate = useGate(PROFILE_GATE);
  const [running, setRunning] = useState(false);
  const targets = profiles.filter((p) => p.paused);
  const run = async () => {
    setRunning(true);
    const done = await runEach("profile.resume", targets);
    setRunning(false);
    if (done.length === 0) return;
    toast.success(`Resumed ${nameList(done.map((p) => p.name))}`, {
      action: { label: "Undo", run: async () => (await runEach("profile.pause", done)).length > 0 && toast.success("Undone") },
    });
  };
  return (
    <GatedButton gate={gate} variant="outline" disabled={running || targets.length === 0} onClick={() => void run()}>
      <Play />
      Resume all
    </GatedButton>
  );
}

/**
 * Runs one write per profile in turn; an error toast names the ones that
 * failed. Returns the ones that worked. Pause all asked once for every
 * profile, so each `profile.pause` (disruptive) goes with `confirm: true`.
 */
async function runEach(id: "profile.pause" | "profile.resume", list: ReadonlyArray<Profile>): Promise<Profile[]> {
  const done: Profile[] = [];
  const failed: { p: Profile; text: string }[] = [];
  for (const p of list) {
    const res = await execute(id, id === "profile.pause" ? { profile: p.id, confirm: true } : { profile: p.id });
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
  const write = useWrite<{ profile: string }>("profile.delete");
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
  // Core asks (over the sheet) when a device joins a paused profile or leaves to a paused Unassigned.
  const setDevices = useWrite<{ profile: string; devices: string[] }, Profile>("profile.devices.set", {
    form: true,
    confirmIn: "nested",
    confirm: { title: "Take devices offline?", confirmLabel: "Save" },
  });
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
      <WriteConfirmDialog write={setDevices} />
    </Sheet>
  );
}
