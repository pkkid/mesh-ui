/**
 * Activity "Event stream": the network's events newest first, under a bar per
 * day (count and a per hour strip), with grouped rows folding repeats and a
 * "Load older events" footer that pages back to the start of history.
 * Grouping is done in core (`events.list {grouped: true}`). Rows core gave an
 * `action` show it (Assign profile, Resume, Unblock) while the device or
 * profile still needs it, through the write kit (`useWrite`, gated by the
 * command's own gate). Rows about a device also get a `...` menu: Rename (a
 * small dialog, `device.rename`), Block or Unblock (`device.block`, asks
 * first) and Device details, each gated by its command.
 * `StreamSettingsButton` is the header's settings icon, opening App & account
 * at Notifications. docs/ux/pages/activity.md (Layout 3, Actions).
 */
import { Menu } from "@base-ui/react/menu";
import { ArrowRight, Ban, ChevronDown, CircleCheck, Ellipsis, Info, Pencil, Play, Settings, UserRoundPlus } from "lucide-react";
import { type FormEvent, type ReactNode, useId, useMemo, useState } from "react";

import { Link, navigate, pathFor } from "~/app/router";
import { useQuery } from "~/app/useCommand";
import { fieldErrors, type Gate, performWrite, useWrite } from "~/app/useWrite";
import { Sparkline } from "~/components/charts/Sparkline";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, Empty } from "~/components/ui/card";
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from "~/components/ui/dialog";
import { IconTile } from "~/components/ui/hero";
import { Input } from "~/components/ui/input";
import { useGate } from "~/components/ui/page";
import { entityColors, seriesColors } from "~/lib/chartColors";
import { cn } from "~/lib/utils";
import { type Clock, formatCount } from "../../../../core/format";
import type { Device, DeviceBulkResult, DeviceList, EventSummary, NetworkEvent, Profile, ProfileList } from "../../../../core/model";
import { blockRequest, menuClasses, ProfileMenu, type ProfileOption, profileRequest } from "../devices/BulkBar";

import { CATEGORIES } from "./ActivityChart";

/** Where a row's action goes: its device, eero or profile, Updates for firmware, Troubleshooting for a repeated eero problem. */
function rowLink(e: NetworkEvent): { to: string; label: string } | null {
  if (e.refs.deviceId) return { to: pathFor("device", { deviceId: e.refs.deviceId }), label: "Device" };
  if (e.refs.profileId) return { to: pathFor("profile", { profileId: e.refs.profileId }), label: "Profile" };
  if (e.category === "eero_status" && e.grouped?.length) return { to: pathFor("troubleshooting"), label: "Diagnose" };
  if (e.refs.eeroId) return { to: pathFor("eero", { eeroId: e.refs.eeroId }), label: "eero" };
  if (e.category === "firmware") return { to: pathFor("updates"), label: "Updates" };
  return null;
}

type Day = { key: string; label: string; sub: string; strip: number[] | null; rows: NetworkEvent[] };

/**
 * Splits rows into days using the summary's day starts (network time zone).
 * Rows older than the window fall into their own day by date label.
 */
export function splitDays(rows: ReadonlyArray<NetworkEvent>, days: EventSummary | undefined, hours: EventSummary | undefined, clock: Clock): Day[] {
  const starts = (days?.buckets ?? []).map((b) => Date.parse(b.at));
  const newest = starts.length - 1;
  const out: Day[] = [];
  for (const e of rows) {
    const at = Date.parse(e.at);
    let i = starts.length - 1;
    while (i >= 0 && (starts[i] as number) > at) i--;
    const key = i >= 0 ? `d${i}` : `x${clock.day(at)}`;
    let day = out[out.length - 1];
    if (!day || day.key !== key) {
      const bucket = i >= 0 ? days?.buckets[i] : undefined;
      const label = i === newest ? "Today" : i === newest - 1 ? "Yesterday" : clock.longWeekday(at);
      const end = i >= 0 && i < newest ? (starts[i + 1] as number) : Number.POSITIVE_INFINITY;
      const strip =
        i >= 0 && hours ? hours.buckets.filter((b) => Date.parse(b.at) >= (starts[i] as number) && Date.parse(b.at) < end).map((b) => b.total) : null;
      const sub = bucket ? `${clock.day(at)} · ${formatCount(bucket.total)} ${bucket.total === 1 ? "event" : "events"}` : clock.day(at);
      day = { key, label, sub, strip, rows: [] };
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
  const write = useWrite("profile.resume", { confirmIn: "dialog" });
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
            undo: { id: "profile.pause", params: { profile: profile.id }, success: `Paused ${profile.name}` },
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
  const write = useWrite<{ devices: string[] }, DeviceBulkResult>("device.unblock", { confirmIn: "dialog" });
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
  const write = useWrite<{ devices: string[]; profile: string | null }, DeviceBulkResult>("device.profile.set", { confirmIn: "dialog" });
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
                  Rename...
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
                    Unblock
                  </Menu.Item>
                ) : (
                  <Menu.Item
                    className={cn(menuClasses.item, "text-destructive-foreground")}
                    disabled={!blockGate.allowed}
                    title={reasonOf(blockGate)}
                    onClick={() => void performWrite(blockRequest([device], true, { networkName }))}
                  >
                    <Ban className="size-3.5" />
                    Block...
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

/** The Event stream header's settings icon: App & account at Notifications. */
export function StreamSettingsButton() {
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      aria-label="Notification settings"
      title="Notification settings"
      render={<Link to={`${pathFor("account")}/notifications`} />}
    >
      <Settings />
    </Button>
  );
}

function EventRow({ e, clock, ctx, networkName }: { e: NetworkEvent; clock: Clock; ctx: ActionContext; networkName: string | null }) {
  const meta = CATEGORIES[e.category];
  const link = rowLink(e);
  const extra = e.grouped?.length ?? 0;
  return (
    <div className="grid grid-cols-[62px_32px_minmax(0,1fr)_auto] items-start gap-x-3.5 px-[18px] py-[11px] hover:bg-muted/50">
      <div className="pt-[7px] text-right font-mono text-[11.5px] text-muted-foreground tabular-nums">{clock.time(e.at)}</div>
      <IconTile icon={meta.icon} size="sm" />
      <div className="min-w-0">
        <div className="text-[13px] leading-snug">
          {e.title}
          {extra > 0 && (
            <Badge variant="outline" className="ms-2 align-middle">
              {extra + 1} events
            </Badge>
          )}
        </div>
        {e.detail && <div className="mt-0.5 text-muted-foreground text-xs">{e.detail}</div>}
        {extra > 0 && (
          <div className="mt-2 flex flex-col gap-1 border-l-2 ps-2.5">
            {[e, ...(e.grouped ?? [])].map((g) => (
              <div key={g.id} className="text-muted-foreground text-xs">
                <span className="me-2 font-mono text-[11.5px] text-foreground/80 tabular-nums">{clock.time(g.at)}</span>
                {g.detail ?? g.title}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1.5 pt-[3px]">
        {e.action && <RowAction e={e} ctx={ctx} />}
        {link && (
          <Button size="xs" variant="outline" render={<Link to={link.to} />}>
            {link.label}
            <ArrowRight />
          </Button>
        )}
        {e.refs.deviceId && <RowMenu deviceId={e.refs.deviceId} device={ctx.devices.get(e.refs.deviceId)} networkName={networkName} />}
      </div>
    </div>
  );
}

export function EventStream({
  rows,
  days,
  hours,
  clock,
  loading,
  fading,
  emptyText,
  error,
  footer,
  networkName = null,
}: {
  /** undefined while the first page loads. */
  rows: ReadonlyArray<NetworkEvent> | undefined;
  days: EventSummary | undefined;
  hours: EventSummary | undefined;
  clock: Clock;
  loading: boolean;
  fading: boolean;
  emptyText: string;
  /** The inline error note above the stream (rows already shown stay). */
  error: ReactNode;
  footer: ReactNode;
  /** For the block confirm ("can't rejoin <network>"). */
  networkName?: string | null;
}) {
  const actions = useActionContext(rows);
  if (!rows && error) return <>{error}</>;
  if (!rows) {
    return (
      <div className="flex flex-col gap-3">
        {error}
        <Card className="divide-y">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="h-[58px]" />
          ))}
        </Card>
      </div>
    );
  }
  const split = splitDays(rows, days, hours, clock);
  return (
    <div className="flex flex-col gap-3">
      {error}
      <Card className={cn("transition-opacity", fading && "opacity-40")} aria-busy={loading}>
        {split.length === 0 ? (
          <Empty>{emptyText}</Empty>
        ) : (
          split.map((d) => (
            <div key={d.key}>
              <div className="flex items-center gap-3 border-b bg-muted/40 px-[18px] py-3 [&:not(:first-child)]:border-t">
                <h3 className="font-semibold text-xs uppercase tracking-wider">{d.label}</h3>
                <span className="text-muted-foreground text-xs tabular-nums">{d.sub}</span>
                {d.strip && d.strip.some((v) => v > 0) && (
                  <Sparkline
                    values={d.strip}
                    color={seriesColors.neutral}
                    ariaLabel={`Events per hour, ${d.label}`}
                    dot={false}
                    className="ms-auto h-5 w-full max-w-72"
                  />
                )}
              </div>
              <div className="divide-y divide-border/60">
                {d.rows.map((e) => (
                  <EventRow key={e.id} e={e} clock={clock} ctx={actions} networkName={networkName} />
                ))}
              </div>
            </div>
          ))
        )}
        {footer}
      </Card>
    </div>
  );
}
