/**
 * Overview "Top devices": the five devices that used the most data in the
 * last 24 hours (`usage.breakdown`), with a thin bar scaled to the top one.
 * docs/ux/pages/overview.md (Layout 3).
 */
import {
  Camera,
  Cpu,
  Gamepad2,
  HardDrive,
  Laptop,
  type LucideIcon,
  Monitor,
  Printer,
  Smartphone,
  Speaker,
  Tablet,
  Tv,
  Watch,
} from "lucide-react";

import { Link, pathFor } from "~/app/router";
import { useQuery } from "~/app/useCommand";
import { Card, Empty, Section } from "~/components/ui/card";
import { IconTile } from "~/components/ui/hero";
import { seriesColors } from "~/lib/chartColors";
import { cn } from "~/lib/utils";
import { formatBytes, formatCount } from "../../../../core/format";
import type { DeviceCategory, DeviceList, UsageBreakdown } from "../../../../core/model";

import { HeaderLink, SectionError } from "./OverviewView";

const TOP = 5;

const TYPE_ICONS: Record<string, LucideIcon> = {
  phone: Smartphone,
  tablet: Tablet,
  ereader: Tablet,
  watch: Watch,
  fitness: Watch,
  laptop: Laptop,
  desktop: Monitor,
  tv: Tv,
  media_streamer: Tv,
  game_console: Gamepad2,
  speaker: Speaker,
  nas: HardDrive,
  printer: Printer,
  camera: Camera,
  doorbell: Camera,
};

const CATEGORY_ICONS: Record<DeviceCategory, LucideIcon> = {
  phones_tablets: Smartphone,
  computers: Laptop,
  entertainment: Tv,
  smart_home: Cpu,
  other: Cpu,
};

export function TopDevices() {
  const breakdown = useQuery<UsageBreakdown>("usage.breakdown", { range: "day", by: "device" }, { poll: true });
  const devices = useQuery<DeviceList>("device.list", undefined, { poll: true });

  const rows = (breakdown.data?.rows ?? []).filter((r) => r.down + r.up > 0).slice(0, TOP);
  const top = Math.max(0, ...rows.map((r) => r.down + r.up));
  const byId = new Map((devices.data?.devices ?? []).map((d) => [d.id, d]));
  const online = devices.data?.summary.online;

  return (
    <Section
      title="Top devices"
      subtitle={`Data used, 24h · ${formatCount(online)} online now`}
      tools={<HeaderLink to={pathFor("devices")} arrow>All devices</HeaderLink>}
    >
      {breakdown.error && !breakdown.data ? (
        <SectionError what="top devices" error={breakdown.error} onRetry={() => void breakdown.refetch()} />
      ) : breakdown.data && rows.length === 0 ? (
        <Card>
          <Empty>No activity in this window.</Empty>
        </Card>
      ) : (
        <Card>
          <table className={cn("w-full border-collapse text-[13px] transition-opacity", breakdown.fading && "opacity-40")}>
            <thead>
              <tr className="border-b text-left text-muted-foreground text-xs">
                <th className="px-3 py-2 font-normal">#</th>
                <th className="w-full px-3 py-2 font-normal">Device</th>
                <th className="px-3 py-2 text-right font-normal">Down</th>
                <th className="px-3 py-2 text-right font-normal">Up</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.data
                ? rows.map((r, i) => {
                    const device = r.id ? byId.get(r.id) : undefined;
                    const icon = device ? (TYPE_ICONS[device.type] ?? CATEGORY_ICONS[device.category]) : Cpu;
                    const to = r.id ? pathFor("device", { deviceId: r.id }) : pathFor("devices");
                    return (
                      <tr key={r.id ?? r.name} className="border-border/50 border-b last:border-b-0 hover:bg-muted/50">
                        <td className="px-3 py-2.5 text-muted-foreground text-xs tabular-nums">{i + 1}</td>
                        <td className="px-3 py-2.5">
                          <Link to={to} className="flex items-center gap-2.5 outline-none focus-visible:underline">
                            <IconTile icon={icon} size="sm" />
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-medium">{r.name}</div>
                              <div className="mt-1.5 h-0.5 max-w-48">
                                <div
                                  className="h-full min-w-1.5 rounded-full"
                                  style={{
                                    width: `${top > 0 ? ((r.down + r.up) / top) * 100 : 0}%`,
                                    backgroundColor: seriesColors.download,
                                  }}
                                />
                              </div>
                            </div>
                          </Link>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{formatBytes(r.down)}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right text-muted-foreground tabular-nums">
                          {formatBytes(r.up)}
                        </td>
                      </tr>
                    );
                  })
                : Array.from({ length: TOP }, (_, i) => (
                    <tr key={i} className="border-border/50 border-b last:border-b-0">
                      <td className="h-[49px]" colSpan={4} />
                    </tr>
                  ))}
            </tbody>
          </table>
        </Card>
      )}
    </Section>
  );
}
