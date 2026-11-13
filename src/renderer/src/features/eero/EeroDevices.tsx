/**
 * eero detail "Connected devices": every connected client on this eero,
 * most data first, with its band and Wi-Fi generation (or port), signal,
 * link rate and data in the last 24 hours. docs/ux/pages/eero-detail.md
 * (Layout 3). Rows come from `device.list {eero}`, data from
 * `usage.breakdown {by: device, range: day}`.
 */
import { pathFor } from "~/app/router";
import { linkSpeed } from "~/components/mesh/LinkChip";
import { useQuery } from "~/app/useCommand";
import { BandBadge } from "~/components/ui/band-badge";
import { BreakdownTable } from "~/components/ui/breakdown-table";
import { Card, Empty, Section } from "~/components/ui/card";
import { HeaderLink, SectionError } from "~/components/ui/page";
import { deviceIcon } from "~/lib/deviceIcons";
import { seriesColors } from "~/lib/chartColors";
import { cn } from "~/lib/utils";
import { formatBytes, MISSING } from "../../../../core/format";
import type { Device, DeviceList, UsageBreakdown } from "../../../../core/model";

type Row = { device: Device; bytes: number | null };

export function EeroDevices({ eeroId, name }: { eeroId: string; name: string }) {
  const devices = useQuery<DeviceList>("device.list", { eero: eeroId, connected: true }, { poll: true, enabled: eeroId !== "" });
  const usage = useQuery<UsageBreakdown>("usage.breakdown", { range: "day", by: "device" }, { poll: true });

  const used = new Map((usage.data?.rows ?? []).flatMap((r) => (r.id ? [[r.id, r.down + r.up] as const] : [])));
  const rows: Row[] | undefined = devices.data?.devices
    .map((d) => ({ device: d, bytes: used.get(d.id) ?? null }))
    .sort((a, b) => (b.bytes ?? -1) - (a.bytes ?? -1) || a.device.name.localeCompare(b.device.name));

  return (
    <Section title="Connected devices" tools={<HeaderLink to={pathFor("devices")} arrow>All devices</HeaderLink>}>
      {devices.error && !devices.data ? (
        <SectionError what="devices" error={devices.error} onRetry={() => void devices.refetch()} />
      ) : rows && rows.length === 0 ? (
        <Card>
          <Empty>No devices are connected to {name} right now.</Empty>
        </Card>
      ) : (
        <Card>
          <BreakdownTable<Row>
            rows={rows}
            rowKey={(r) => r.device.id}
            nameHeader="Device"
            name={(r) => r.device.name}
            icon={(r) => deviceIcon(r.device)}
            to={(r) => pathFor("device", { deviceId: r.device.id })}
            size={(r) => r.bytes ?? 0}
            color={seriesColors.download}
            fading={devices.fading}
            columns={[
              { header: "Connection", cell: (r) => <Connection device={r.device} /> },
              { header: "Signal", cell: (r) => <Signal device={r.device} /> },
              { header: "Rate", cell: (r) => linkSpeed(r.device.link?.rxMbps ?? r.device.wiredPort?.speedMbps) ?? MISSING },
              { header: "Data 24h", cell: (r) => formatBytes(r.bytes) },
            ]}
          />
        </Card>
      )}
    </Section>
  );
}

/** Band badge, then the Wi-Fi generation ("Wi-Fi 6E") or the port ("Port 1"). */
function Connection({ device: d }: { device: Device }) {
  const detail = d.band === "wired" ? (d.wiredPort ? `Port ${d.wiredPort.port}` : null) : (d.link?.standard ?? null);
  return (
    <span className="inline-flex items-center gap-1.5">
      {d.band ? <BandBadge band={d.band} /> : <span className="text-muted-foreground">{MISSING}</span>}
      {detail && <span className="text-2xs text-muted-foreground">{detail}</span>}
    </span>
  );
}

/** dBm and four bars; "-" for wired or unknown. */
function Signal({ device: d }: { device: Device }) {
  if (d.band === "wired" || !d.signal || d.signal.dbm === null) return <span className="text-muted-foreground">{MISSING}</span>;
  return (
    <span className="inline-flex items-center justify-end gap-1.5">
      <span className="text-muted-foreground text-xs tabular-nums">{d.signal.dbm}</span>
      <SignalBars bars={d.signal.bars} />
    </span>
  );
}

/** eero reports 0 to 5 bars; four are drawn: one red, two yellow, three or four in the text colour. */
function SignalBars({ bars }: { bars: number | null }) {
  const n = bars === null ? 0 : Math.max(0, Math.min(4, Math.round((bars / 5) * 4)));
  const on = n === 1 ? "bg-destructive" : n === 2 ? "bg-warning" : "bg-foreground/80";
  return (
    <span role="img" aria-label={bars === null ? "Signal unknown" : `Signal ${bars} of 5 bars`} className="inline-flex h-3 items-end gap-0.5">
      {[4, 6.5, 9, 12].map((h, i) => (
        <span key={h} className={cn("w-[3px] rounded-[1px]", i < n ? on : "bg-border")} style={{ height: h }} />
      ))}
    </span>
  );
}
