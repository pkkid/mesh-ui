/**
 * Activity "Event stream": a live stream of the network's events newest first
 * (eero's last ~15 minutes plus every event read while the app is open),
 * under a bar per day (count and a per hour strip), with grouped rows folding
 * repeats and a "Load older events" footer while more are kept.
 * Grouping is done in core (`events.list {grouped: true}`). Rows core gave an
 * `action` show it (Assign profile, Resume, Unblock) while the device or
 * profile still needs it, through the write kit (`useWrite`, gated by the
 * command's own gate). Rows about a device also get a `...` menu: Rename (a
 * small dialog, `device.rename`), Block or Unblock (`device.block`,
 * disruptive: the confirm dialog first) and Device details, each gated by its command.
 * Rows that only lead somewhere (their profile, eero, Updates,
 * Troubleshooting) end in a dim "View ..." text link, never a button; device
 * rows reach their device through the menu's Device details instead. `NotificationSettingsButton`
 * is the hero action that opens the notification settings sheet.
 * docs/ux/pages/activity.md (Layout 3, Actions).
 */
import { Menu } from "@base-ui/react/menu";
import { Ban, Bell, ChevronDown, CircleCheck, Ellipsis, Info, Pencil, Play, UserRoundPlus } from "lucide-react";
import { type FormEvent, type ReactNode, useId, useMemo, useState } from "react";

import { navigate, pathFor } from "~/app/router";
import { useQuery } from "~/app/useCommand";
import { fieldErrors, type Gate, performWrite, useWrite } from "~/app/useWrite";
import { Sparkline } from "~/components/charts/Sparkline";
import { Button } from "~/components/ui/button";
import { Card, Empty } from "~/components/ui/card";
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from "~/components/ui/dialog";
import { IconTile } from "~/components/ui/hero";
import { Input } from "~/components/ui/input";
import { SectionLink, useGate } from "~/components/ui/page";
import { entityColors, seriesColors } from "~/lib/chartColors";
import { openNotificationSettings } from "~/features/notifications/NotificationSettings";
import { cn } from "~/lib/utils";
import { type Clock, formatCount } from "../../../../core/format";
import type { Device, DeviceBulkResult, DeviceList, EventSummary, NetworkEvent, Profile, ProfileList } from "../../../../core/model";
import { blockRequest, menuClasses, ProfileMenu, type ProfileOption, profileRequest } from "../devices/BulkBar";

import { CATEGORIES } from "./ActivityChart";

/** Where a row leads: its device, eero or profile, Updates for firmware, Troubleshooting for a repeated eero problem. */
export function rowLink(e: NetworkEvent): { to: string; label: string } | null {
  if (e.refs.deviceId) return { to: pathFor("device", { deviceId: e.refs.deviceId }), label: "View device" };
  if (e.refs.profileId) return { to: pathFor("profile", { profileId: e.refs.profileId }), label: "View profile" };
  if (e.category === "eero_status" && e.grouped?.length) return { to: pathFor("troubleshooting"), label: "View troubleshooting" };
  if (e.refs.eeroId) return { to: pathFor("eero", { eeroId: e.refs.eeroId }), label: "View eero" };
  if (e.category === "firmware") return { to: pathFor("updates"), label: "View updates" };
  return null;
}

type Day = { key: string; label: string; sub: string; strip: number[] | null; rows: NetworkEvent[] };

/**
 * Splits rows into days by their date in the network time zone. A day's
 * count and strip come from the kept-events summary's buckets on that day;
 * a day it does not cover gets the date alone.
 */
export function splitDays(rows: ReadonlyArray<NetworkEvent>, hours: EventSummary | undefined, clock: Clock, now = hours ? Date.parse(hours.to) : Date.now()): Day[] {
  const today = clock.day(now);
  const yesterday = clock.day(now - 24 * 60 * 60 * 1000);
  const out: Day[] = [];
  for (const e of rows) {
    const key = clock.day(e.at);
    let day = out[out.length - 1];
    if (!day || day.key !== key) {
      const label = key === today ? "Today" : key === yesterday ? "Yesterday" : clock.longWeekday(e.at);
      const buckets = (hours?.buckets ?? []).filter((b) => clock.day(b.at) === key);
      const total = buckets.reduce((n, b) => n + b.total, 0);
      const sub = buckets.length ? `${key}, ${formatCount(total)} ${total === 1 ? "event" : "events"}` : key;
      day = { key, label, sub, strip: buckets.length > 1 ? buckets.map((b) => b.total) : null, rows: [] };
      out.push(day);
    }
    day.rows.push(e);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Row actions

/** What the row actions need, read once for the whole stream. */
type ActionContext = {
  devices: ReadonlyMap<string, Device>;
  profiles: ReadonlyMap<string, Profile>;
  profileOptions: ReadonlyArray<ProfileOption>;
};

function useActionContext(rows: ReadonlyArray<NetworkEvent> | undefined): ActionContext {
  const wanted = useMemo(() => {
    const actions = new Set((rows ?? []).flatMap((e) => (e.action ? [e.action] : [])));
    // Device rows have the row menu, which needs the device too.
    const deviceRows = (rows ?? []).some((e) => e.refs.deviceId);
    return { devices: deviceRows || actions.has("assign_profile") || actions.has("unblock"), profiles: actions.size > 0 };
  }, [rows]);
  // The same queries the page reads for its filters, so these share their cache and refetch after a write.
  const devices = useQuery<DeviceList>("device.list", {}, { enabled: wanted.devices });
  const profiles = useQuery<ProfileList>("profile.list", undefined, { enabled: wanted.profiles });
  return useMemo(() => {
    const list = profiles.data?.profiles ?? [];
    const colors = entityColors(list.map((p) => p.id));
    return {
      devices: new Map((devices.data?.devices ?? []).map((d) => [d.id, d])),
      profiles: new Map(list.map((p) => [p.id, p])),
      profileOptions: list.map((p) => ({ id: p.id, name: p.name, color: colors[p.id] })),
    };
  }, [devices.data, profiles.data]);
}

/**
 * The row's write, only while its target still needs it: Resume while the
 * profile is paused, Unblock while the device is blocked, Assign profile
 * while a main-network device is Unassigned. A closed gate hides it
 * (activity.md, States: No permission).
 */
function RowAction({ e, ctx }: { e: NetworkEvent; ctx: ActionContext }) {
  const device = e.refs.deviceId ? ctx.devices.get(e.refs.deviceId) : undefined;
  const profile = e.refs.profileId ? ctx.profiles.get(e.refs.profileId) : undefined;
  if (e.action === "resume" && profile?.paused) return <ResumeButton profile={profile} />;
  if (e.action === "unblock" && device?.blocked) return <UnblockButton device={device} />;
  if (e.action === "assign_profile" && device && device.profileId === null && device.ssid !== "guest" && !device.blocked && ctx.profileOptions.length > 0) {
    return <AssignButton device={device} profiles={ctx.profileOptions} />;
  }
  return null;
}

function ResumeButton({ profile }: { profile: Profile }) {
  const gate = useGate("profile.resume");
  const write = useWrite("profile.resume");
  if (!gate.allowed) return null;
  return (
    <Button
      size="xs"
      variant="outline"
      disabled={write.running}
      onClick={() =>
        void write.run(
          { profile: profile.id },
          {
            success: `Resumed ${profile.name}`,
            failure: `Couldn't resume ${profile.name}`,
            undo: { id: "profile.pause", params: { profile: profile.id }, confirm: { title: `Pause ${profile.name}?`, confirmLabel: "Pause profile" }, success: `Paused ${profile.name}` },
          },
        )
      }
    >
      <Play />
      Resume
    </Button>
  );
}

function UnblockButton({ device }: { device: Device }) {
  const gate = useGate("device.unblock");
  const write = useWrite<{ devices: string[] }, DeviceBulkResult>("device.unblock");
  if (!gate.allowed) return null;
  const req = blockRequest([device], false);
  return (
    <Button size="xs" variant="outline" disabled={write.running} onClick={() => void write.run(req.params, req)}>
      Unblock
    </Button>
  );
}

function AssignButton({ device, profiles }: { device: Device; profiles: ReadonlyArray<ProfileOption> }) {
  const gate = useGate("device.profile.set");
  const write = useWrite<{ devices: string[]; profile: string | null }, DeviceBulkResult>("device.profile.set");
  if (!gate.allowed) return null;
  return (
    <ProfileMenu
      label={`Assign ${device.name} to a profile`}
      profiles={profiles}
      current={device.profileId}
      onPick={(p) => {
        const req = profileRequest([device], p);
        void write.run(req.params, req);
      }}
      trigger={
        <Button size="xs" variant="outline" disabled={write.running}>
          <UserRoundPlus />
          Assign profile
          <ChevronDown />
        </Button>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Row menu and header settings

const reasonOf = (g: Gate) => (g.allowed ? undefined : (g.reason ?? undefined));

/**
 * The `...` menu on a row about a device: Rename, Block or Unblock, Device
 * details. Rename and Block need the device in the device list (a device
 * eero no longer lists keeps only Device details); a closed gate disables
 * the item with its reason, like the Devices table.
 */
function RowMenu({ deviceId, device, networkName }: { deviceId: string; device: Device | undefined; networkName: string | null }) {
  const renameGate = useGate("device.rename");
  const blockGate = useGate(device?.blocked ? "device.unblock" : "device.block");
  const [renaming, setRenaming] = useState(false);
  const name = device?.name ?? "this device";
  return (
    <>
      <Menu.Root>
        <Menu.Trigger
          aria-label={`Actions for ${name}`}
          className="grid size-6 cursor-pointer place-items-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[popup-open]:bg-muted"
        >
          <Ellipsis className="size-[15px]" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner side="bottom" align="end" sideOffset={4} className="z-50">
            <Menu.Popup className={menuClasses.popup}>
              {device && (
                <Menu.Item className={menuClasses.item} disabled={!renameGate.allowed} title={reasonOf(renameGate)} onClick={() => setRenaming(true)}>
                  <Pencil className="size-3.5" />
                  Rename device{"\u2026"}
                </Menu.Item>
              )}
              {device &&
                (device.blocked ? (
                  <Menu.Item
                    className={menuClasses.item}
                    disabled={!blockGate.allowed}
                    title={reasonOf(blockGate)}
                    onClick={() => void performWrite(blockRequest([device], false))}
                  >
                    <CircleCheck className="size-3.5" />
                    Unblock device
                  </Menu.Item>
                ) : (
                  <Menu.Item
                    className={cn(menuClasses.item, "text-destructive-foreground")}
                    disabled={!blockGate.allowed}
                    title={reasonOf(blockGate)}
                    onClick={() => void performWrite(blockRequest([device], true, { networkName }))}
                  >
                    <Ban className="size-3.5" />
                    Block device{"\u2026"}
                  </Menu.Item>
                ))}
              {device && <Menu.Separator className="my-1 h-px bg-border" />}
              <Menu.Item className={menuClasses.item} onClick={() => navigate(pathFor("device", { deviceId }))}>
                <Info className="size-3.5" />
                Device details
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      {device && renaming && <RenameDialog device={device} onClose={() => setRenaming(false)} />}
    </>
  );
}

/** Rename from a row: the nickname shown everywhere (empty clears it), with Undo, like the Devices table. */
function RenameDialog({ device: d, onClose }: { device: Device; onClose: () => void }) {
  const [value, setValue] = useState(d.nickname ?? d.name);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputId = useId();
  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    const nickname = value.trim();
    if (nickname === (d.nickname ?? d.name)) return onClose();
    setSaving(true);
    const res = await performWrite({
      id: "device.rename",
      params: { device: d.id, nickname },
      form: true,
      success: nickname ? `Renamed to ${nickname}` : `Cleared the nickname of ${d.name}`,
      failure: `Couldn't rename ${d.name}`,
      undo: { id: "device.rename", params: { device: d.id, nickname: d.nickname ?? "" } },
    });
    setSaving(false);
    if (res?.ok) return onClose();
    if (res && !res.ok) {
      const f = fieldErrors(res.error);
      setError(f.nickname ?? f._form ?? res.error.message);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPopup className="max-w-sm p-5">
        <form onSubmit={(ev) => void submit(ev)} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1 pe-8">
            <DialogTitle className="text-base">Rename {d.name}</DialogTitle>
            <DialogDescription className="text-xs">Shown everywhere in Mesh UI and the eero app. Leave it empty to use the device's own name.</DialogDescription>
          </div>
          <label htmlFor={inputId} className="sr-only">
            New name for {d.name}
          </label>
          <Input
            id={inputId}
            autoFocus
            value={value}
            maxLength={32}
            placeholder={d.hostname ?? d.name}
            aria-invalid={error ? true : undefined}
            onChange={(e) => setValue(e.target.value)}
            onFocus={(e) => e.target.select()}
          />
          {error && <div className="text-destructive-foreground text-xs">{error}</div>}
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={saving}>
              Save
            </Button>
          </div>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

/** The hero's Notification settings action: opens the notification settings sheet here, over Activity. */
export function NotificationSettingsButton() {
  return (
    <Button variant="outline" onClick={openNotificationSettings}>
      <Bell />
      Notification settings{"\u2026"}
    </Button>
  );
}

function EventRow({ e, clock, ctx, networkName }: { e: NetworkEvent; clock: Clock; ctx: ActionContext; networkName: string | null }) {
  const meta = CATEGORIES[e.category];
  const link = rowLink(e);
  const extra = e.grouped?.length ?? 0;
  // A single event centres time, icon, text and actions on the row. A grouped row is taller (its sub list), so time,
  // icon and actions sit on the title's 18px line instead, each centred in a box of that height.
  const line = extra > 0 ? "flex h-[18px] items-center" : "flex items-center";
  return (
    <div
      className={cn(
        "grid grid-cols-[62px_32px_minmax(0,1fr)_auto] gap-x-3.5 px-[18px] py-[11px] hover:bg-muted/50",
        extra > 0 ? "items-start" : "items-center",
      )}
    >
      {/* Mono digits have no descenders, so they sit high in their line box; 3px of top padding moves them down 1.5px,
          centring their ink on the title and detail lines. */}
      <div className={cn(line, "justify-end font-mono text-2xs text-muted-foreground tabular-nums", extra === 0 && "pt-[3px]")}>
        {clock.time(e.at)}
      </div>
      <div className={line}>
        <IconTile icon={meta.icon} size="sm" />
      </div>
      <div className="min-w-0">
        <div className="text-[13px] leading-[18px]">{e.title}</div>
        {e.detail && <div className="mt-0.5 text-muted-foreground text-xs">{e.detail}</div>}
        {extra > 0 && (
          <div className="mt-2 flex flex-col gap-1 border-l ps-2.5">
            {[e, ...(e.grouped ?? [])].map((g) => (
              <div key={g.id} className="text-muted-foreground text-xs">
                <span className="me-2 font-mono text-2xs text-foreground/80 tabular-nums">{clock.time(g.at)}</span>
                {g.detail ?? g.title}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className={cn(line, "gap-3")}>
        {e.action && <RowAction e={e} ctx={ctx} />}
        {link && !e.refs.deviceId && <SectionLink to={link.to}>{link.label}</SectionLink>}
        {e.refs.deviceId && <RowMenu deviceId={e.refs.deviceId} device={ctx.devices.get(e.refs.deviceId)} networkName={networkName} />}
      </div>
    </div>
  );
}

export function EventStream({
  rows,
  hours,
  clock,
  loading,
  fading,
  emptyText,
  error,
  footer,
  note,
  networkName = null,
}: {
  /** undefined while the first page loads. */
  rows: ReadonlyArray<NetworkEvent> | undefined;
  /** events.summary {range: "kept"}: the day bars' counts and strips. */
  hours: EventSummary | undefined;
  clock: Clock;
  loading: boolean;
  fading: boolean;
  emptyText: string;
  /** The inline error note above the stream (rows already shown stay). */
  error: ReactNode;
  footer: ReactNode;
  /** A footnote under the card (`Footnote`), outside it. */
  note?: ReactNode;
  /** For the block confirm ("can't rejoin <network>"). */
  networkName?: string | null;
}) {
  const actions = useActionContext(rows);
  if (!rows && error) return <>{error}</>;
  if (!rows) {
    return (
      <div className="flex flex-col gap-3">
        {error}
        <Card className="divide-y divide-border/50">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="h-[58px]" />
          ))}
        </Card>
      </div>
    );
  }
  const split = splitDays(rows, hours, clock);
  return (
    <div className="flex flex-col gap-3">
      {error}
      <Card className={cn("transition-opacity", fading && "opacity-40")} aria-busy={loading}>
        {split.length === 0 ? (
          <Empty>{emptyText}</Empty>
        ) : (
          split.map((d) => (
            <div key={d.key}>
              <div className="flex items-center gap-3 border-border/50 border-b bg-muted px-[18px] py-2">
                <h3 className="font-semibold text-3xs text-muted-foreground uppercase tracking-widest">{d.label}</h3>
                <span className="text-muted-foreground/70 text-xs tabular-nums">{d.sub}</span>
                {d.strip && d.strip.some((v) => v > 0) && (
                  <Sparkline
                    values={d.strip}
                    color={seriesColors.neutral}
                    ariaLabel={`Events over time, ${d.label}`}
                    dot={false}
                    className="ms-auto h-5 w-full max-w-72"
                  />
                )}
              </div>
              <div className="divide-y divide-border/50">
                {d.rows.map((e) => (
                  <EventRow key={e.id} e={e} clock={clock} ctx={actions} networkName={networkName} />
                ))}
              </div>
            </div>
          ))
        )}
        {footer}
      </Card>
      {note}
    </div>
  );
}
