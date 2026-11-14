/**
 * Activity "Event stream": the network's events newest first, under a bar per
 * day (count and a per hour strip), with grouped rows folding repeats and a
 * "Load older events" footer that pages back to the start of history.
 * Grouping is done in core (`events.list {grouped: true}`). Rows core gave an
 * `action` show it (Assign profile, Resume, Unblock) while the device or
 * profile still needs it, through the write kit (`useWrite`, gated by the
 * command's own gate). docs/ux/pages/activity.md (Layout 3, Actions).
 */
import { ArrowRight, ChevronDown, Play, UserRoundPlus } from "lucide-react";
import { type ReactNode, useMemo } from "react";

import { Link, pathFor } from "~/app/router";
import { useQuery } from "~/app/useCommand";
import { useWrite } from "~/app/useWrite";
import { Sparkline } from "~/components/charts/Sparkline";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, Empty } from "~/components/ui/card";
import { IconTile } from "~/components/ui/hero";
import { useGate } from "~/components/ui/page";
import { entityColors, seriesColors } from "~/lib/chartColors";
import { cn } from "~/lib/utils";
import { type Clock, formatCount } from "../../../../core/format";
import type { Device, DeviceBulkResult, DeviceList, EventSummary, NetworkEvent, Profile, ProfileList } from "../../../../core/model";
import { blockRequest, ProfileMenu, type ProfileOption, profileRequest } from "../devices/BulkBar";

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

function EventRow({ e, clock, ctx }: { e: NetworkEvent; clock: Clock; ctx: ActionContext }) {
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
                  <EventRow key={e.id} e={e} clock={clock} ctx={actions} />
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
