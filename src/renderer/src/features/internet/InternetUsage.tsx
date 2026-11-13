/**
 * Internet "Data usage": WAN bytes per hour (Day or Week) and per day, the
 * devices using the most right now, and the By device and By profile
 * tables. Totals, busiest day, today so far and the Others row come from
 * core (`usage.get`, `usage.breakdown {top}`). Bridge mode hides the
 * per-device parts. docs/ux/pages/internet.md (Layout 5, States).
 */
import { ArrowDown, ArrowUp, Ellipsis } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { Link, pathFor } from "~/app/router";
import { invalidate, useCommand, useQuery } from "~/app/useCommand";
import { AreaChart } from "~/components/charts/AreaChart";
import { BarChart } from "~/components/charts/BarChart";
import { bandLabel } from "~/components/ui/band-badge";
import { BreakdownTable } from "~/components/ui/breakdown-table";
import { Card, Empty, Section } from "~/components/ui/card";
import { IconTile } from "~/components/ui/hero";
import { HeaderLink, SectionError } from "~/components/ui/page";
import { Segmented } from "~/components/ui/segmented";
import { entityColors, seriesColors } from "~/lib/chartColors";
import { deviceIcon } from "~/lib/deviceIcons";
import { cn } from "~/lib/utils";
import { bytesParts, formatBytes, formatPercent, mbpsParts, networkClock } from "../../../../core/format";
import type { BurstResult, DeviceList, Eero, Network, ProfileList, UsageBreakdown, UsageRange, UsageSeries } from "../../../../core/model";
import { BURST_SETTLE_SEC, POLL } from "../../../../core/poll";

const RANGES = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
] as const;

const TOP = 5;
const NOW_COUNT = 6;
const HOUR = 3_600_000;

export function InternetUsage() {
  const [range, setRange] = useState<UsageRange>("day");
  const network = useQuery<Network>("network.get", undefined, { poll: true });
  const bridged = network.data?.connectionMode === "bridged";
  const span = range === "day" ? "24h" : "7 days";

  return (
    <Section
      title="Data usage"
      subtitle="Internet (WAN) traffic only, local transfers excluded"
      tools={<Segmented aria-label="Range" value={range} onValueChange={setRange} options={RANGES} />}
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <PerHour range={range} bridged={bridged} network={network.data} />
        <PerDay network={network.data} />
      </div>
      {!bridged && (
        <div className="grid gap-4 lg:grid-cols-2">
          <ByDevice range={range} span={span} />
          <ByProfile range={range} span={span} />
        </div>
      )}
    </Section>
  );
}

function Legend({ down, up }: { down: number | null; up: number | null }) {
  return (
    <div className="flex items-center gap-4 text-muted-foreground text-xs">
      <span className="flex items-center gap-1.5">
        <ArrowDown className="size-3.5" style={{ color: seriesColors.download }} />
        Download <b className="font-medium text-foreground tabular-nums">{formatBytes(down)}</b>
      </span>
      <span className="flex items-center gap-1.5">
        <ArrowUp className="size-3.5" style={{ color: seriesColors.upload }} />
        Upload <b className="font-medium text-foreground tabular-nums">{formatBytes(up)}</b>
      </span>
    </div>
  );
}

function PerHour({ range, bridged, network }: { range: UsageRange; bridged: boolean; network: Network | undefined }) {
  const usage = useQuery<UsageSeries>("usage.get", { scope: "network", range, cadence: "hourly" }, { poll: true });
  const clock = networkClock(network?.timezone);
  const s = usage.data;
  const points = s?.points ?? [];
  const has = !!s && s.total.down + s.total.up > 0;
  const day = range === "day";

  return (
    <Card padded className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-medium text-sm">Per hour</span>
        <span className="text-muted-foreground text-xs">{day ? "last 24 hours" : "last 7 days"}</span>
        <div className={cn("ms-auto transition-opacity", usage.fading && "opacity-40")}>
          <Legend down={has ? (s?.total.down ?? null) : null} up={has ? (s?.total.up ?? null) : null} />
        </div>
      </div>
      {usage.error && !s ? (
        <SectionError what="data usage" error={usage.error} onRetry={() => void usage.refetch()} />
      ) : (
        <AreaChart
          series={[
            { id: "down", label: "Download", color: seriesColors.download, values: points.map((p) => p.down) },
            { id: "up", label: "Upload", color: seriesColors.upload, values: points.map((p) => p.up) },
          ]}
          labels={points.map((p) => (day ? clock.hour(p.at) : clock.weekday(p.at)))}
          tooltipLabels={points.map((p) => `${clock.weekday(p.at)} ${clock.hour(p.at)} to ${clock.hour(Date.parse(p.at) + HOUR)}`)}
          format={formatBytes}
          loading={usage.loading && (!s || usage.fading)}
          heightClassName="h-40"
          ariaLabel={`Data used per hour, ${day ? "last 24 hours" : "last 7 days"}, download and upload`}
        />
      )}
      {!bridged && (
        <>
          <div className="h-px bg-border" />
          <UsingNow offline={network?.status === "offline"} />
        </>
      )}
    </Card>
  );
}

/**
 * Asks for fresh rates once a minute while the page is visible, then
 * refetches the device list once they have settled. Core keeps bursts to
 * once a minute per network, so this shares the Devices page's budget.
 */
function useLiveRates(enabled: boolean): void {
  const { run } = useCommand<Record<string, never>, BurstResult>("device.rates.refresh");
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let next: ReturnType<typeof setTimeout> | undefined;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (document.visibilityState === "visible") {
        const res = await run({});
        if (cancelled) return;
        if (res.ok) {
          const wait = Date.parse(res.result.nextBurstAt) + BURST_SETTLE_SEC * 1000 - Date.now();
          clearTimeout(settle);
          settle = setTimeout(() => invalidate(["device.list"]), Number.isFinite(wait) && wait > 0 ? wait : 0);
        }
      }
      if (!cancelled) next = setTimeout(tick, POLL.rates * 1000);
    };
    void tick();
    return () => {
      cancelled = true;
      clearTimeout(next);
      clearTimeout(settle);
    };
  }, [enabled, run]);
}

function UsingNow({ offline }: { offline: boolean }) {
  useLiveRates(!offline);
  const list = useQuery<DeviceList>("device.list", { sort: "rate", limit: NOW_COUNT }, { poll: true });
  const eeros = useQuery<Eero[]>("eero.list", undefined, { poll: true });
  const where = new Map((eeros.data ?? []).map((e) => [e.id, e.location]));
  const devices = (list.data?.devices ?? []).filter((d) => d.connected);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium text-[13px]">Using the most right now</span>
        <span className="text-muted-foreground text-xs">current rate · refreshed every minute</span>
      </div>
      {offline ? (
        <div className="text-muted-foreground text-xs">Live rates need a connection to eero.</div>
      ) : list.error && !list.data ? (
        <div className="text-muted-foreground text-xs">
          Couldn't load live rates.{" "}
          <button type="button" className="cursor-pointer underline" onClick={() => void list.refetch()}>
            Retry
          </button>
        </div>
      ) : list.data && devices.length === 0 ? (
        <div className="text-muted-foreground text-xs">No devices online.</div>
      ) : (
        <div className={cn("grid gap-x-6 gap-y-2.5 transition-opacity sm:grid-cols-2 xl:grid-cols-3", list.fading && "opacity-40")}>
          {devices.map((d) => {
            const rate = d.rates && d.rates.downMbps > 0 ? mbpsParts(d.rates.downMbps) : null;
            const sub = [d.eeroId ? where.get(d.eeroId) : null, d.band ? bandLabel(d.band) : null].filter(Boolean).join(" · ");
            return (
              <Link key={d.id} to={pathFor("device", { deviceId: d.id })} className="flex min-w-0 items-center gap-2.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <IconTile icon={deviceIcon(d)} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-[13px]">{d.name}</div>
                  <div className="truncate text-2xs text-muted-foreground">{sub || "-"}</div>
                </div>
                <span className="font-medium text-[13px] tabular-nums">
                  {rate ? (
                    <>
                      {rate.value} <span className="text-2xs text-muted-foreground">{rate.unit}</span>
                    </>
                  ) : (
                    "-"
                  )}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PerDay({ network }: { network: Network | undefined }) {
  const usage = useQuery<UsageSeries>("usage.get", { scope: "network", range: "week", cadence: "daily" }, { poll: true });
  const clock = networkClock(network?.timezone);
  const s = usage.data;
  const points = s?.points ?? [];
  const total = s ? s.total.down + s.total.up : 0;
  const has = total > 0;
  const avg = has && points.length ? total / points.length : null;
  const today = bytesParts(has ? s?.todaySoFar : null);

  return (
    <Card padded className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium text-sm">Per day</span>
        <span className={cn("text-muted-foreground text-xs transition-opacity", usage.fading && "opacity-40")}>avg {formatBytes(avg)} / day</span>
      </div>
      <div className={cn("transition-opacity", usage.fading && "opacity-40")}>
        <Legend down={has ? (s?.total.down ?? null) : null} up={has ? (s?.total.up ?? null) : null} />
      </div>
      {usage.error && !s ? (
        <SectionError what="daily usage" error={usage.error} onRetry={() => void usage.refetch()} />
      ) : (
        <BarChart
          series={[
            { id: "down", label: "Download", color: seriesColors.download, values: points.map((p) => p.down) },
            { id: "up", label: "Upload", color: seriesColors.upload, values: points.map((p) => p.up) },
          ]}
          labels={points.map((p) => clock.weekday(p.at))}
          tooltipLabels={points.map((p) => clock.longDate(p.at))}
          format={formatBytes}
          highlight={points.length ? points.length - 1 : undefined}
          loading={usage.loading && (!s || usage.fading)}
          heightClassName="h-36"
          hideYLabels
          ariaLabel="Data used per day, last 7 days, download and upload stacked"
        />
      )}
      <div className="h-px bg-border" />
      <div className={cn("flex items-end justify-between gap-3 transition-opacity", usage.fading && "opacity-40")}>
        <div>
          <div className="text-muted-foreground text-xs">Today so far</div>
          <div className="font-semibold text-xl tabular-nums">
            {today.value}
            {today.unit && <small className="ms-1 font-medium text-muted-foreground text-xs">{today.unit}</small>}
          </div>
        </div>
        <div className="text-right">
          <div className="text-muted-foreground text-xs">Busiest day</div>
          <div className="font-medium text-[13px] tabular-nums">
            {has && s?.busiest ? `${clock.day(s.busiest.at)} · ${formatBytes(s.busiest.down + s.busiest.up)}` : "-"}
          </div>
        </div>
      </div>
    </Card>
  );
}

function ByDevice({ range, span }: { range: UsageRange; span: string }) {
  const breakdown = useQuery<UsageBreakdown>("usage.breakdown", { range, by: "device", top: TOP }, { poll: true });
  const devices = useQuery<DeviceList>("device.list", undefined, { poll: true });
  const byId = new Map((devices.data?.devices ?? []).map((d) => [d.id, d]));
  const rows = breakdown.data?.rows.filter((r) => r.down + r.up > 0);
  const colors = entityColors((rows ?? []).flatMap((r) => (r.id ? [r.id] : [])));

  return (
    <Card>
      <TableHeader title="By device" span={span} link={<HeaderLink to={pathFor("devices")} arrow>All devices</HeaderLink>} />
      {breakdown.error && !breakdown.data ? (
        <Empty>
          Couldn't load usage by device.{" "}
          <button type="button" className="cursor-pointer underline" onClick={() => void breakdown.refetch()}>
            Retry
          </button>
        </Empty>
      ) : rows && rows.length === 0 ? (
        <Empty>No activity in this window.</Empty>
      ) : (
        <BreakdownTable
          rows={rows}
          rowKey={(r) => r.id ?? r.name}
          nameHeader="Device"
          name={(r) => (r.id ? r.name : <span className="font-normal text-muted-foreground">{r.name}</span>)}
          size={(r) => r.down + r.up}
          columns={[
            { header: "Down", cell: (r) => formatBytes(r.down) },
            { header: "Up", cell: (r) => formatBytes(r.up), muted: true },
            { header: "Share", cell: (r) => formatPercent(r.share) },
          ]}
          color={(r) => (r.id ? (colors[r.id] ?? seriesColors.neutral) : seriesColors.neutral)}
          icon={(r) => (r.id ? deviceIcon(byId.get(r.id)) : Ellipsis)}
          to={(r) => (r.id ? pathFor("device", { deviceId: r.id }) : undefined)}
          placeholderCount={TOP + 1}
          fading={breakdown.fading}
        />
      )}
    </Card>
  );
}

const countOf = (n: number) => `${n} ${n === 1 ? "device" : "devices"}`;

function ByProfile({ range, span }: { range: UsageRange; span: string }) {
  const breakdown = useQuery<UsageBreakdown>("usage.breakdown", { range, by: "profile" }, { poll: true });
  const profiles = useQuery<ProfileList>("profile.list", undefined, { poll: true });
  const list = profiles.data?.profiles ?? [];
  const byId = new Map(list.map((p) => [p.id, p]));
  const colors = entityColors(list.map((p) => p.id));
  const rows = breakdown.data?.rows;

  const detail = (id: string | null): string => {
    if (id === null) return "unassigned";
    const p = byId.get(id);
    if (!p) return "";
    return p.paused ? `${countOf(p.deviceIds.length)} · paused` : countOf(p.deviceIds.length);
  };

  return (
    <Card>
      <TableHeader title="By profile" span={span} link={<HeaderLink to={pathFor("profiles")} arrow>Profiles</HeaderLink>} />
      {breakdown.error && !breakdown.data ? (
        <Empty>
          Couldn't load usage by profile.{" "}
          <button type="button" className="cursor-pointer underline" onClick={() => void breakdown.refetch()}>
            Retry
          </button>
        </Empty>
      ) : rows && rows.every((r) => r.down + r.up === 0) ? (
        <Empty>No activity in this window.</Empty>
      ) : (
        <BreakdownTable
          rows={rows}
          rowKey={(r) => r.id ?? "unassigned"}
          nameHeader="Profile"
          name={(r) => {
            const color = r.id ? (colors[r.id] ?? seriesColors.neutral) : seriesColors.neutral;
            return (
              <span className="flex items-center gap-2.5">
                <span
                  aria-hidden
                  className="grid size-6 shrink-0 place-items-center rounded-full font-semibold text-2xs text-background"
                  style={{ backgroundColor: color }}
                >
                  {r.id ? r.name.slice(0, 1).toUpperCase() : "?"}
                </span>
                <span className="truncate">
                  {r.id ? r.name : "Other devices"} <span className="font-normal text-2xs text-muted-foreground">{detail(r.id)}</span>
                </span>
              </span>
            );
          }}
          size={(r) => r.down + r.up}
          columns={[
            { header: "Down", cell: (r) => formatBytes(r.down) },
            { header: "Up", cell: (r) => formatBytes(r.up), muted: true },
            { header: "Share", cell: (r) => formatPercent(r.share) },
          ]}
          color={(r) => (r.id ? (colors[r.id] ?? seriesColors.neutral) : seriesColors.neutral)}
          to={(r) => (r.id ? pathFor("profile", { profileId: r.id }) : pathFor("profiles"))}
          placeholderCount={4}
          fading={breakdown.fading}
        />
      )}
    </Card>
  );
}

function TableHeader({ title, span, link }: { title: string; span: string; link: ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-b px-4 py-2.5">
      <span className="font-medium text-[13px]">{title}</span>
      <span className="text-muted-foreground text-xs">{span}</span>
      <div className="ms-auto">{link}</div>
    </div>
  );
}
