/**
 * Overview "Top devices": the five devices that used the most data in the
 * last 24 hours (`usage.breakdown`), with a thin bar scaled to the top one.
 * docs/ux/pages/overview.md (Layout 3).
 */
import { pathFor } from "~/app/router";
import { useQuery } from "~/app/useCommand";
import { BreakdownTable } from "~/components/ui/breakdown-table";
import { Card, Empty, Section } from "~/components/ui/card";
import { HeaderLink, SectionError } from "~/components/ui/page";
import { seriesColors } from "~/lib/chartColors";
import { deviceIcon } from "~/lib/deviceIcons";
import { formatBytes, formatCount } from "../../../../core/format";
import type { DeviceList, UsageBreakdown } from "../../../../core/model";

const TOP = 5;

export function TopDevices() {
  const breakdown = useQuery<UsageBreakdown>("usage.breakdown", { range: "day", by: "device" }, { poll: true });
  const devices = useQuery<DeviceList>("device.list", undefined, { poll: true });

  const rows = (breakdown.data?.rows ?? []).filter((r) => r.down + r.up > 0).slice(0, TOP);
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
          <BreakdownTable
            rows={breakdown.data ? rows : undefined}
            rowKey={(r) => r.id ?? r.name}
            nameHeader="Device"
            name={(r) => r.name}
            size={(r) => r.down + r.up}
            columns={[
              { header: "Down", cell: (r) => formatBytes(r.down) },
              { header: "Up", cell: (r) => formatBytes(r.up), muted: true },
            ]}
            color={seriesColors.download}
            icon={(r) => deviceIcon(r.id ? byId.get(r.id) : undefined)}
            to={(r) => (r.id ? pathFor("device", { deviceId: r.id }) : pathFor("devices"))}
            ranked
            placeholderCount={TOP}
            fading={breakdown.fading}
          />
        </Card>
      )}
    </Section>
  );
}
