/**
 * Profiles section: one card per profile (or one row in List view) with its
 * initial in the profile colour, devices and how many are online, device
 * type icons, state, the next scheduled change, and today's usage with a
 * 24 h sparkline. Pause, Resume and the menu are disabled until the profile
 * writes land. docs/ux/pages/profiles.md (Layout 1).
 */
import { Ellipsis, LayoutGrid, List, Pause, Play, Plus } from "lucide-react";
import { useState } from "react";

import { Link, navigate, pathFor } from "~/app/router";
import type { QueryState } from "~/app/useCommand";
import { Sparkline } from "~/components/charts/Sparkline";
import { Card, Empty, Section } from "~/components/ui/card";
import { ComingSoonButton, SectionError } from "~/components/ui/page";
import { Segmented } from "~/components/ui/segmented";
import { Status, type StatusTone } from "~/components/ui/status";
import { deviceIcon } from "~/lib/deviceIcons";
import { cn } from "~/lib/utils";
import { bytesParts, formatBytes, MISSING, networkClock } from "../../../../core/format";
import type { Device, Profile, ProfileList, UsageSeries } from "../../../../core/model";

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
            <ComingSoonButton size="xs" variant="outline">
              <Pause />
              Pause all
            </ComingSoonButton>
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
            <ComingSoonButton size="xs" variant="outline">
              <Plus />
              Add a profile
            </ComingSoonButton>
          </Empty>
        </Card>
      ) : view === "cards" ? (
        <div className={cn("grid gap-4 sm:grid-cols-2 xl:grid-cols-4", profiles.fading && "opacity-40 transition-opacity")}>
          {items.map((x) => (
            <ProfileCard key={x.profile.id} {...x} placeholder={loading} color={colorOf(x.profile.id)} timezone={timezone} />
          ))}
        </div>
      ) : (
        <Card className={cn("divide-y", profiles.fading && "opacity-40 transition-opacity")}>
          {items.map((x) => (
            <ProfileRow key={x.profile.id} {...x} color={colorOf(x.profile.id)} timezone={timezone} />
          ))}
        </Card>
      )}
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
  return (
    <ComingSoonButton size="sm" variant={profile.paused ? "default" : "outline"} className={cn("w-full", className)}>
      {profile.paused ? <Play /> : <Pause />}
      {profile.paused ? "Resume" : "Pause"}
    </ComingSoonButton>
  );
}

function ProfileCard({ profile: p, devices, usage, color, timezone, placeholder }: CardProps & { placeholder: boolean }) {
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
        <div className="min-w-0 flex-1 [&>span]:flex">
          <PauseButton profile={p} />
        </div>
        <ComingSoonButton size="icon-sm" variant="outline" aria-label="More actions">
          <Ellipsis />
        </ComingSoonButton>
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
      <div className="w-28 [&>span]:flex">
        <PauseButton profile={p} />
      </div>
    </div>
  );
}
