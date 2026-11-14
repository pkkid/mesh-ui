/**
 * Profile detail "Devices" (docs/ux/pages/profile-detail.md, Layout 3): the
 * profile's devices with status, where they connect (or when they were last
 * seen), their data in the last 24 hours (eero's device usage is a rolling
 * 24 h, never "today") and their share of the profile's total. From
 * `device.list {profile}`, `usage.breakdown {range: day, by: device, profile}`
 * and `eero.list` for eero names. Add a device opens the devices picker;
 * the x on a row removes it (`profile.devices.set`, with Undo).
 */
import { Plus, X } from "lucide-react";

import { pathFor } from "~/app/router";
import { useQuery } from "~/app/useCommand";
import { useWrite } from "~/app/useWrite";
import { Button } from "~/components/ui/button";
import { BreakdownTable } from "~/components/ui/breakdown-table";
import { Card, Empty, Section } from "~/components/ui/card";
import { GatedButton, SectionError, useGate, useNow } from "~/components/ui/page";
import { PROFILE_GATE } from "~/features/profiles/ProfileCards";
import { Status } from "~/components/ui/status";
import { deviceIcon } from "~/lib/deviceIcons";
import { cn } from "~/lib/utils";
import { formatBytes, formatCount, formatPercent } from "../../../../core/format";
import type { DeviceList, Eero, Profile, UsageBreakdown } from "../../../../core/model";

import { connectionLine, type DeviceRow, deviceRows } from "./helpers";

type Props = { profileId: string; profile: Profile | null; color: string; timezone: string | null; onEdit: () => void };

export function ProfileDevices({ profileId, profile, color, timezone, onEdit }: Props) {
  const gate = useGate(PROFILE_GATE);
  const remove = useWrite<{ profile: string; devices: string[] }>("profile.devices.set");
  const removeDevice = (deviceId: string, name: string) => {
    if (!profile) return;
    const before = profile.deviceIds;
    void remove.run(
      { profile: profileId, devices: before.filter((x) => x !== deviceId) },
      {
        success: `Moved ${name} to Unassigned`,
        failure: `Couldn't remove ${name}`,
        undo: { id: "profile.devices.set", params: { profile: profileId, devices: before }, success: `Moved ${name} back to ${profile.name}` },
      },
    );
  };
  const devices = useQuery<DeviceList>("device.list", { profile: profileId }, { poll: true });
  const usage = useQuery<UsageBreakdown>("usage.breakdown", { range: "day", by: "device", profile: profileId }, { poll: true });
  const eeros = useQuery<Eero[]>("eero.list", undefined, { poll: true });
  const now = useNow();

  const location = new Map((eeros.data ?? []).map((e) => [e.id, e.location] as const));
  const all = devices.data?.devices;
  const rows = all ? deviceRows(all, usage.data?.rows) : undefined;
  const online = all?.filter((d) => d.connected).length ?? 0;
  const subtitle = all && all.length > 0 ? `${formatCount(online)} of ${formatCount(all.length)} online · data in the last 24 hours` : "Data in the last 24 hours";

  return (
    <Section
      title="Devices"
      subtitle={subtitle}
      tools={
        <GatedButton gate={gate} size="xs" variant="outline" disabled={!profile} onClick={onEdit}>
          <Plus />
          Add a device
        </GatedButton>
      }
    >
      {devices.error && !all ? (
        <SectionError what="devices" error={devices.error} onRetry={() => void devices.refetch()} />
      ) : rows && rows.length === 0 ? (
        <Card>
          <Empty>No devices in {profile?.name ?? "this profile"} yet.</Empty>
        </Card>
      ) : (
        <Card>
          <BreakdownTable<DeviceRow>
            rows={rows}
            rowKey={(r) => r.device.id}
            nameHeader="Device"
            name={(r) => (
              <span className="flex min-w-0 flex-col">
                <span className={cn("truncate", !r.device.connected && "text-muted-foreground")}>{r.device.name}</span>
                <span className="truncate text-2xs text-muted-foreground">
                  {connectionLine(r.device, r.device.eeroId ? (location.get(r.device.eeroId) ?? null) : null, now, timezone)}
                </span>
              </span>
            )}
            icon={(r) => deviceIcon(r.device)}
            to={(r) => pathFor("device", { deviceId: r.device.id })}
            size={(r) => (r.down ?? 0) + (r.up ?? 0)}
            color={color}
            fading={devices.fading}
            placeholderCount={3}
            columns={[
              {
                header: "Status",
                cell: (r) => (
                  <Status tone={!r.device.connected ? "muted" : r.device.paused ? "warning" : "success"}>
                    {!r.device.connected ? "Offline" : r.device.paused ? "Paused" : "Online"}
                  </Status>
                ),
              },
              { header: "Down", cell: (r) => formatBytes(r.down) },
              { header: "Up", cell: (r) => formatBytes(r.up), muted: true },
              { header: "Share", cell: (r) => (r.share === null ? "-" : formatPercent(r.share)), muted: true },
              {
                header: "",
                cell: (r) =>
                  gate.allowed ? (
                    <Button
                      size="icon-xs"
                      variant="ghost-muted"
                      aria-label={`Remove ${r.device.name} from ${profile?.name ?? "this profile"}`}
                      title="Remove from profile"
                      disabled={remove.running || !profile}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        removeDevice(r.device.id, r.device.name);
                      }}
                    >
                      <X />
                    </Button>
                  ) : null,
              },
            ]}
          />
        </Card>
      )}
    </Section>
  );
}
