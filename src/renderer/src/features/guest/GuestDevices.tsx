/**
 * Guest network "Guest devices": every device seen on the guest network in
 * the last 7 days, online first, with its eero, band, signal, when it was
 * last seen and its data in the last 24 hours. docs/ux/pages/guest.md
 * (Layout 6). Rows come from `device.list {ssid: guest}`, data from
 * `usage.breakdown {by: device, range: day}`, eero names from `eero.list`.
 */
import { useState } from "react";

import { pathFor } from "~/app/router";
import { useQuery } from "~/app/useCommand";
import { BandBadge } from "~/components/ui/band-badge";
import { BreakdownTable } from "~/components/ui/breakdown-table";
import { Card, Empty, Section } from "~/components/ui/card";
import { SectionError, useNow } from "~/components/ui/page";
import { Segmented } from "~/components/ui/segmented";
import { Status } from "~/components/ui/status";
import { seriesColors } from "~/lib/chartColors";
import { deviceIcon } from "~/lib/deviceIcons";
import { cn } from "~/lib/utils";
import { formatBytes, formatCount, formatRelative, MISSING } from "../../../../core/format";
import type { Device, DeviceList, Eero, UsageBreakdown } from "../../../../core/model";

type Filter = "all" | "online" | "recent";
type Row = { device: Device; down: number | null; up: number | null };

const FILTERS = [
  { value: "all", label: "All" },
  { value: "online", label: "Online" },
  { value: "recent", label: "Recent" },
] as const;

export function GuestDevices({ timezone }: { timezone: string | null }) {
  const [filter, setFilter] = useState<Filter>("all");
  const devices = useQuery<DeviceList>("device.list", { ssid: "guest" }, { poll: true });
  const usage = useQuery<UsageBreakdown>("usage.breakdown", { range: "day", by: "device" }, { poll: true });
  const eeros = useQuery<Eero[]>("eero.list", undefined, { poll: true });
  const now = useNow();

  const used = new Map((usage.data?.rows ?? []).flatMap((r) => (r.id ? [[r.id, r] as const] : [])));
  const location = new Map((eeros.data ?? []).map((e) => [e.id, e.location] as const));
  const all = devices.data?.devices;
  const online = all?.filter((d) => d.connected).length ?? 0;
  const rows: Row[] | undefined = all
    ?.filter((d) => (filter === "online" ? d.connected : filter === "recent" ? !d.connected : true))
    .map((d) => {
      const u = used.get(d.id);
      return { device: d, down: u ? u.down : null, up: u ? u.up : null };
    })
    .sort(
      (a, b) =>
        Number(b.device.connected) - Number(a.device.connected) ||
        (b.down ?? 0) + (b.up ?? 0) - ((a.down ?? 0) + (a.up ?? 0)) ||
        a.device.name.localeCompare(b.device.name),
    );

  const subtitle = all && all.length > 0 ? `${formatCount(online)} online · ${formatCount(all.length - online)} more in the last 7 days` : null;
  const emptyText = all?.length === 0 ? "No guests in the last 7 days." : filter === "online" ? "No guests are online right now." : "Every guest seen this week is online.";

  return (
    <Section title="Guest devices" subtitle={subtitle} tools={<Segmented aria-label="Show" value={filter} onValueChange={setFilter} options={FILTERS} />}>
      {devices.error && !all ? (
        <SectionError what="guest devices" error={devices.error} onRetry={() => void devices.refetch()} />
      ) : rows && rows.length === 0 ? (
        <Card>
          <Empty>{emptyText}</Empty>
        </Card>
      ) : (
        <Card>
          <BreakdownTable<Row>
            rows={rows}
            rowKey={(r) => r.device.id}
            nameHeader="Device"
            name={(r) => <span className={cn(!r.device.connected && "text-muted-foreground")}>{r.device.name}</span>}
            icon={(r) => deviceIcon(r.device)}
            to={(r) => pathFor("device", { deviceId: r.device.id })}
            size={(r) => (r.down ?? 0) + (r.up ?? 0)}
            color={(r) => (r.device.connected ? seriesColors.download : seriesColors.neutral)}
            fading={devices.fading}
            placeholderCount={3}
            columns={[
              { header: "eero", cell: (r) => (r.device.eeroId ? (location.get(r.device.eeroId) ?? MISSING) : MISSING) },
              { header: "Band", cell: (r) => (r.device.band ? <BandBadge band={r.device.band} /> : <span className="text-muted-foreground">{MISSING}</span>) },
              { header: "Signal", cell: (r) => <Signal device={r.device} /> },
              { header: "Last seen", cell: (r) => (r.device.connected ? "Now" : r.device.lastActive ? formatRelative(r.device.lastActive, now, timezone ?? "UTC") : MISSING) },
              { header: "Down", cell: (r) => formatBytes(r.down) },
              { header: "Up", cell: (r) => formatBytes(r.up), muted: true },
              { header: "", cell: (r) => <Status tone={r.device.connected ? "success" : "muted"}>{r.device.connected ? "Online" : "Left"}</Status> },
            ]}
          />
        </Card>
      )}
    </Section>
  );
}

/** dBm and four bars; "-" when offline, wired or unknown. */
function Signal({ device: d }: { device: Device }) {
  if (!d.connected || d.band === "wired" || !d.signal || d.signal.dbm === null) return <span className="text-muted-foreground">{MISSING}</span>;
  const n = d.signal.bars === null ? 0 : Math.max(0, Math.min(4, Math.round((d.signal.bars / 5) * 4)));
  const on = n === 1 ? "bg-destructive" : n === 2 ? "bg-warning" : "bg-foreground/80";
  return (
    <span className="inline-flex items-center justify-end gap-1.5">
      <span className="text-muted-foreground text-xs tabular-nums">{d.signal.dbm}</span>
      <span role="img" aria-label={d.signal.bars === null ? "Signal unknown" : `Signal ${d.signal.bars} of 5 bars`} className="inline-flex h-3 items-end gap-0.5">
        {[4, 6.5, 9, 12].map((h, i) => (
          <span key={h} className={cn("w-[3px] rounded-[1px]", i < n ? on : "bg-border")} style={{ height: h }} />
        ))}
      </span>
    </span>
  );
}
