/**
 * Unassigned (`#/profiles/unassigned`): the devices in no profile (eero's own
 * `default: true` group, which is never offered as a profile). A hero with
 * the device count, online count and pause state, Pause unassigned (asks
 * first) or Resume unassigned, and the devices with their data in the last
 * 24 hours. From `profile.list` (`unassigned`), `device.list` and
 * `usage.breakdown {range: day, by: device}`. docs/ux/pages/profile-detail.md
 * (Unassigned).
 */
import { UsersRound } from "lucide-react";

import { pathFor } from "~/app/router";
import type { PageProps } from "~/app/routes";
import { useQuery } from "~/app/useCommand";
import { BreakdownTable } from "~/components/ui/breakdown-table";
import { Card, Empty, Section } from "~/components/ui/card";
import { Metric, PageHeader } from "~/components/ui/hero";
import { SectionError, useNow } from "~/components/ui/page";
import { Status } from "~/components/ui/status";
import { UnassignedPauseButton } from "~/features/profiles/UnassignedCard";
import { TopBarTitle } from "~/features/shell/TopBar";
import { seriesColors } from "~/lib/chartColors";
import { deviceIcon } from "~/lib/deviceIcons";
import { cn } from "~/lib/utils";
import { formatBytes, formatCount, formatPercent } from "../../../../core/format";
import type { DeviceList, Eero, Network, ProfileList, UsageBreakdown } from "../../../../core/model";

import { connectionLine, type DeviceRow, deviceRows } from "./helpers";

export function UnassignedPage(_props: PageProps) {
  const network = useQuery<Network>("network.get", undefined, { poll: true });
  const profiles = useQuery<ProfileList>("profile.list", undefined, { poll: true });
  const devices = useQuery<DeviceList>("device.list", undefined, { poll: true });
  const usage = useQuery<UsageBreakdown>("usage.breakdown", { range: "day", by: "device" }, { poll: true });
  const eeros = useQuery<Eero[]>("eero.list", undefined, { poll: true });
  const now = useNow();
  const timezone = network.data?.timezone ?? null;

  const summary = profiles.data?.unassigned;
  const ids = new Set(summary?.deviceIds ?? []);
  const list = summary && devices.data ? devices.data.devices.filter((d) => ids.has(d.id)) : undefined;
  const rows = list ? deviceRows(list, usage.data?.rows) : undefined;
  const total = rows ? rows.reduce((sum, r) => sum + (r.down ?? 0) + (r.up ?? 0), 0) : null;
  const location = new Map((eeros.data ?? []).map((e) => [e.id, e.location] as const));
  const paused = summary?.paused ?? false;
  const failed = (!profiles.data && profiles.error) || (!devices.data && devices.error) || null;

  return (
    <>
      <TopBarTitle>Unassigned</TopBarTitle>
      <PageHeader
        className={cn("transition-opacity", profiles.fading && !summary && "opacity-40")}
        icon={UsersRound}
        title="Unassigned"
        status={
          summary ? (
            <>
              <Status tone={paused ? "warning" : "success"}>{paused ? "Paused" : "Active"}</Status>
              <span>{paused ? "Paused until resumed" : "Devices in no profile"}</span>
            </>
          ) : null
        }
        facts={
          <>
            <Metric label="Devices" value={summary ? `${formatCount(summary.deviceIds.length)} · ${formatCount(summary.devicesOnline)} online` : null} />
            <Metric label="Last 24 hours" value={total === null ? null : formatBytes(total)} />
          </>
        }
        aside={
          summary && list ? (
            <div className="flex max-w-60 flex-col items-stretch gap-2">
              <UnassignedPauseButton paused={paused} devices={list} size="lg" />
              <p className="text-2xs text-muted-foreground">
                {paused ? "Resuming brings every unassigned device back online." : "Includes the TV, printer and smart home gear."}
              </p>
            </div>
          ) : null
        }
      />

      <Section title="Devices" subtitle="New devices and devices with private (randomized) addresses land here · data in the last 24 hours">
        {failed ? (
          <SectionError
            what="unassigned devices"
            error={failed}
            onRetry={() => {
              void profiles.refetch();
              void devices.refetch();
            }}
          />
        ) : rows && rows.length === 0 ? (
          <Card>
            <Empty>Every device is in a profile.</Empty>
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
              color={seriesColors.neutral}
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
              ]}
            />
          </Card>
        )}
      </Section>
    </>
  );
}
