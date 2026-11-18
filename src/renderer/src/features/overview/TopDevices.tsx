/**
 * Overview "Top devices": the five devices that used the most data in the
 * last 24 hours (`usage.breakdown`), with a thin bar scaled to the top one.
 * docs/ux/pages/overview.md (Layout 3).
 */
import { pathFor } from "~/app/router";
import { useQuery } from "~/app/useCommand";
import { BreakdownTable } from "~/components/ui/breakdown-table";
import { Card, Empty, Section } from "~/components/ui/card";
import { SectionError, SectionLink } from "~/components/ui/page";
import { seriesColors } from "~/lib/chartColors";
import { deviceIcon } from "~/lib/deviceIcons";
import { formatBytes, formatPercent } from "../../../../core/format";
import type { DeviceList, UsageBreakdown } from "../../../../core/model";

const TOP = 5;

export function TopDevices() {
  const breakdown = useQuery<UsageBreakdown>("usage.breakdown", { range: "day", by: "device" }, { poll: true });
  const devices = useQuery<DeviceList>("device.list", undefined, { poll: true });

  const rows = (breakdown.data?.rows ?? []).filter((r) => r.down + r.up > 0).slice(0, TOP);
  const byId = new Map((devices.data?.devices ?? []).map((d) => [d.id, d]));
  // "Last 24 hours · 55% of all traffic": how much of the network these rows account for.
  const all = (breakdown.data?.rows ?? []).reduce((sum, r) => sum + r.down + r.up, 0);
  const top = rows.reduce((sum, r) => sum + r.down + r.up, 0);
  const description = all > 0 ? `Last 24 hours · ${formatPercent((top / all) * 100)} of all traffic` : "Last 24 hours";

  return (
    <Section
      className="gap-[15px]"
      title="Top devices"
      description={description}
      tools={<SectionLink to={pathFor("devices")}>View all devices</SectionLink>}
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
