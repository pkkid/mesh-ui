/**
 * "Unassigned devices": a tile per device in no profile with its icon, name
 * and "Online · 142 GB today", "Offline · 3 days ago" or "Blocked", plus a
 * faint avatar per profile to assign it. Assigning and pausing are writes
 * from a later milestone, so they show disabled ("Coming soon").
 * docs/ux/pages/profiles.md (Layout 4).
 */
import { Info, Pause, UserRoundPlus } from "lucide-react";

import { navigate, pathFor } from "~/app/router";
import type { QueryState } from "~/app/useCommand";
import { Card, Empty, Section } from "~/components/ui/card";
import { ComingSoonButton, SectionError, useNow } from "~/components/ui/page";
import { deviceIcon } from "~/lib/deviceIcons";
import { cn } from "~/lib/utils";
import { formatBytes, formatRelative } from "../../../../core/format";
import type { Device, DeviceList, ProfileList, UsageBreakdown } from "../../../../core/model";

import { Avatar } from "./ProfileCards";
import type { ProfileColor } from "./ProfilesPage";

type Props = {
  profiles: ProfileList | undefined;
  devices: QueryState<DeviceList>;
  usage: UsageBreakdown | undefined;
  colorOf: ProfileColor;
  timezone: string | null;
};

export function UnassignedCard({ profiles, devices, usage, colorOf, timezone }: Props) {
  const now = useNow(60_000);
  const owned = new Set((profiles?.profiles ?? []).flatMap((p) => p.deviceIds));
  const listed = new Set((profiles?.profiles ?? []).map((p) => p.id));
  // Same rule as the core Unassigned summary (no profile, or eero's own Unassigned group),
  // but blocked devices stay in the grid as "Blocked". Guests are not the household's.
  const list = (devices.data?.devices ?? [])
    .filter((d) => !owned.has(d.id) && (d.profileId === null || !listed.has(d.profileId)) && d.ssid !== "guest")
    .sort((a, b) => Number(b.connected) - Number(a.connected) || Number(a.blocked) - Number(b.blocked) || a.name.localeCompare(b.name));
  const today = new Map((usage?.rows ?? []).map((r) => [r.id, r.down + r.up]));
  const loaded = !!devices.data && !!profiles;
  const empty = loaded && list.length === 0;

  const detail = (d: Device) => {
    if (d.blocked) return <span className="text-destructive-foreground">Blocked</span>;
    if (d.connected) return `Online · ${formatBytes(today.get(d.id))} today`;
    return d.lastActive ? `Offline · ${formatRelative(d.lastActive, now, timezone ?? "UTC")}` : "Offline";
  };

  return (
    <Section
      title="Unassigned devices"
      subtitle={loaded && !empty ? `${list.length} ${list.length === 1 ? "device" : "devices"} not in a profile` : undefined}
      tools={
        !loaded || empty ? null : (
          <ComingSoonButton size="xs" variant="outline">
            <Pause />
            Pause unassigned
          </ComingSoonButton>
        )
      }
    >
      {devices.error && !devices.data ? (
        <SectionError what="devices" error={devices.error} onRetry={() => void devices.refetch()} />
      ) : empty ? (
        <Card>
          <Empty>Every device is in a profile.</Empty>
        </Card>
      ) : (
        <>
          <div className="flex gap-2 rounded-[10px] border bg-muted/40 px-3 py-2.5 text-foreground/80 text-xs">
            <Info aria-hidden className="mt-px size-3.5 shrink-0 text-info-foreground" />
            <div>
              New devices and devices with private (randomized) MAC addresses land here. Pausing Unassigned asks for confirmation,
              since it includes the TV, printer and smart home gear.
            </div>
          </div>
          <div className={cn("grid gap-2 sm:grid-cols-2 xl:grid-cols-4", devices.fading && "opacity-40 transition-opacity")}>
            {list.map((d) => {
              const Icon = deviceIcon(d);
              return (
                <div
                  key={d.id}
                  onDoubleClick={() => navigate(pathFor("device", { deviceId: d.id }))}
                  className={cn("flex min-w-0 items-center gap-2.5 rounded-[10px] border bg-card px-3 py-2", !d.connected && "opacity-60")}
                >
                  <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                    <Icon className="size-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-[12.5px]">{d.name}</div>
                    <div className="truncate text-2xs text-muted-foreground">{detail(d)}</div>
                  </div>
                  <div className="flex shrink-0 gap-0.5" title="Assign to a profile: coming soon">
                    {(profiles?.profiles ?? []).slice(0, 6).map((p) => (
                      <Avatar key={p.id} name={p.name} color={colorOf(p.id)} className="size-[18px] text-[9px] opacity-35" />
                    ))}
                  </div>
                </div>
              );
            })}
            {loaded && (
              <div
                title="Coming soon"
                className="flex items-center justify-center gap-2 rounded-[10px] border border-dashed px-3 py-2 text-muted-foreground text-xs opacity-70"
              >
                <UserRoundPlus aria-hidden className="size-[15px]" />
                New profile from selection
              </div>
            )}
          </div>
        </>
      )}
    </Section>
  );
}
