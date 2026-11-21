/**
 * Activity "Event stream": a live stream of the network's events newest first
 * (eero's last ~15 minutes plus every event read while the app is open),
 * under a bar per day (count and a per hour strip), with grouped rows folding
 * repeats and a "Load older events" footer while more are kept.
 * Grouping is done in core (`events.list {grouped: true}`). Rows core gave an
 * `action` show it (Assign profile, Resume, Unblock) while the device or
 * profile still needs it, through the write kit (`useWrite`, gated by the
 * command's own gate). Every row that leads somewhere (its device, profile,
 * eero, Updates, Troubleshooting) ends in a dim "View ..." text link, never a
 * button or a menu; renaming or blocking a device happens on its page. `NotificationSettingsButton`
 * is the hero action that opens the notification settings sheet.
 * docs/ux/pages/activity.md (Layout 3, Actions).
 */
import { Bell, ChevronDown, Play, UserRoundPlus } from "lucide-react";
import { type ReactNode, useMemo } from "react";

import { pathFor } from "~/app/router";
import { useQuery } from "~/app/useCommand";
import { useWrite } from "~/app/useWrite";
import { Sparkline } from "~/components/charts/Sparkline";
import { Button } from "~/components/ui/button";
import { Card, Empty } from "~/components/ui/card";
import { IconTile } from "~/components/ui/hero";
import { SectionLink, useGate } from "~/components/ui/page";
import { entityColors, seriesColors } from "~/lib/chartColors";
import { openNotificationSettings } from "~/features/notifications/NotificationSettings";
import { cn } from "~/lib/utils";
import { type Clock, formatCount } from "../../../../core/format";
import type { Device, DeviceBulkResult, DeviceList, EventSummary, NetworkEvent, Profile, ProfileList } from "../../../../core/model";
import { blockRequest, ProfileMenu, type ProfileOption, profileRequest } from "../devices/BulkBar";

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
    return { devices: actions.has("assign_profile") || actions.has("unblock"), profiles: actions.size > 0 };
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
// Header settings



/** The hero's Notification settings action: opens the notification settings sheet here, over Activity. */
export function NotificationSettingsButton() {
  return (
    <Button variant="outline" onClick={openNotificationSettings}>
      <Bell />
      Notification settings{"\u2026"}
    </Button>
  );
}

function EventRow({ e, clock, ctx }: { e: NetworkEvent; clock: Clock; ctx: ActionContext }) {
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
        {link && <SectionLink to={link.to}>{link.label}</SectionLink>}
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
                  <EventRow key={e.id} e={e} clock={clock} ctx={actions} />
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
