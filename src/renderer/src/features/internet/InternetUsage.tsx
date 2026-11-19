/**
 * Internet "Data usage": WAN bytes per hour (last 24 hours or 7 days) and
 * per day, then "By device" and "By profile" as their own sections side by
 * side, following the same range. No live rates here: the tables already
 * show who used the most, and the charts refresh on their own poll. Totals, busiest day, today so far and the Others row come from
 * core (`usage.get`, `usage.breakdown {top}`). Bridge mode hides the
 * per-device parts. docs/ux/pages/internet.md (Layout 4 and 5, States).
 */
import { ArrowDown, ArrowUp, Ellipsis } from "lucide-react";
import { useState } from "react";

import { pathFor } from "~/app/router";
import { useQuery } from "~/app/useCommand";
import { AreaChart } from "~/components/charts/AreaChart";
import { BarChart } from "~/components/charts/BarChart";
import { BreakdownTable } from "~/components/ui/breakdown-table";
import { Card, Empty, Section } from "~/components/ui/card";
import { SectionError, SectionLink } from "~/components/ui/page";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "~/components/ui/select";
import { entityColors, seriesColors } from "~/lib/chartColors";
import { deviceIcon } from "~/lib/deviceIcons";
import { cn } from "~/lib/utils";
import { bytesParts, formatBytes, formatPercent, networkClock } from "../../../../core/format";
import type { DeviceList, Network, ProfileList, UsageBreakdown, UsageRange, UsageSeries } from "../../../../core/model";

const RANGES = [
  { value: "day", label: "Last 24 hours" },
  { value: "week", label: "Last 7 days" },
] as const;

/** The window in subtitles, bare ("24 hours", not "Last 24 hours"). */
const WINDOW: Record<UsageRange, string> = { day: "24 hours", week: "7 days", month: "this month" };

const TOP = 5;
const HOUR = 3_600_000;

export function InternetUsage() {
  const [range, setRange] = useState<UsageRange>("day");
  const network = useQuery<Network>("network.get", undefined, { poll: true });
  const bridged = network.data?.connectionMode === "bridged";
  // "On pace for 13.9 TB a month": the last 7 days' daily average times 30, for anyone
  // watching an ISP data cap. Same query as the Per day card (fetched once).
  const week = useQuery<UsageSeries>("usage.get", { scope: "network", range: "week", cadence: "daily" }, { poll: true });
  const weekTotal = week.data ? week.data.total.down + week.data.total.up : 0;
  const days = week.data?.points.length ?? 0;
  const description = weekTotal > 0 && days > 0 ? `On pace for ${formatBytes((weekTotal / days) * 30)} a month` : "-";

  return (
    <>
      <Section
        title="Data usage"
        description={description}
        className="gap-[15px]"
        tools={
          // A dropdown, not a Segmented toggle, like Overview's Data usage range (design-system.md).
          <Select items={RANGES} value={range} onValueChange={(v) => v && setRange(v)}>
            <SelectTrigger size="tool" aria-label="Range">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {RANGES.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <PerHour range={range} network={network.data} />
          <PerDay network={network.data} />
        </div>
      </Section>
      {/* By device and By profile are sections of their own, side by side, following the range above. */}
      {!bridged && (
        <div className="grid gap-x-7 gap-y-14 lg:grid-cols-2">
          <ByDevice range={range} />
          <ByProfile range={range} />
        </div>
      )}
    </>
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

function PerHour({ range, network }: { range: UsageRange; network: Network | undefined }) {
  const usage = useQuery<UsageSeries>("usage.get", { scope: "network", range, cadence: "hourly" }, { poll: true });
  const clock = networkClock(network?.timezone);
  const s = usage.data;
  const points = s?.points ?? [];
  const has = !!s && s.total.down + s.total.up > 0;
  const day = range === "day";
  // Stats under the chart, like Per day's: the busiest hour (down plus up), and the largest hour each way.
  const busiest = has ? points.reduce<(typeof points)[number] | undefined>((a, p) => (!a || p.down + p.up > a.down + a.up ? p : a), undefined) : undefined;
  const maxDown = has ? Math.max(...points.map((p) => p.down)) : null;
  const maxUp = has ? Math.max(...points.map((p) => p.up)) : null;
  const busiestWhen = busiest ? `${day ? "" : `${clock.weekday(busiest.at)} `}${clock.hour(busiest.at)}` : undefined;

  return (
    <Card padded className="flex flex-col gap-3">
      {/* Title with the window and total under it ("24 hours, 462 GB"), like Per day's; legend on the right. */}
      <div className="flex flex-wrap items-start gap-2">
        <div>
          <div className="font-medium text-sm">Per hour</div>
          <div className={cn("text-muted-foreground text-xs transition-opacity", usage.fading && "opacity-40")}>
            {WINDOW[range]}, {formatBytes(has ? (s?.total.down ?? 0) + (s?.total.up ?? 0) : null)}
          </div>
        </div>
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
          // Fill the space above the stats; the card stretches to Per day's height, so the two charts end level.
          className="min-h-0 flex-1"
          heightClassName="h-full min-h-40"
          ariaLabel={`Data used per hour, ${day ? "last 24 hours" : "last 7 days"}, download and upload`}
        />
      )}
      <div className="h-px bg-border" />
      {/* Same Stat as Per day's row, so labels and figures line up across both cards and the charts end level. */}
      <div className={cn("flex gap-[50px] transition-opacity", usage.fading && "opacity-40")}>
        <Stat label="Busiest hour" bytes={busiest ? busiest.down + busiest.up : null} prefix={busiestWhen} />
        <Stat label="Max down" bytes={maxDown} />
        <Stat label="Max up" bytes={maxUp} />
      </div>
    </Card>
  );
}

/**
 * A stat under a usage chart: a muted label over the figure in `text-xl
 * font-semibold`, its unit small and muted ("54.0 GB"), and an optional
 * muted prefix in the unit's style ("Thu 54.0 GB", "8 PM 41.0 GB").
 * Every stat in both cards uses it, left aligned 50px apart, so labels and
 * figures line up.
 */
function Stat({ label, bytes, prefix }: { label: string; bytes: number | null | undefined; prefix?: string }) {
  const v = bytesParts(bytes);
  return (
    <div>
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="whitespace-nowrap font-semibold text-xl tabular-nums">
        {prefix && v.unit && <small className="me-1.5 font-medium text-muted-foreground text-xs">{prefix}</small>}
        {v.value}
        {v.unit && <small className="ms-1 font-medium text-muted-foreground text-xs">{v.unit}</small>}
      </div>
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

  return (
    <Card padded className="flex flex-col gap-3">
      {/* Subtext under the title, never beside it. */}
      <div>
        <div className="font-medium text-sm">Per day</div>
        <div className={cn("text-muted-foreground text-xs transition-opacity", usage.fading && "opacity-40")}>7 days, {formatBytes(avg)} a day</div>
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
      <div className={cn("flex gap-[50px] transition-opacity", usage.fading && "opacity-40")}>
        <Stat label="Today so far" bytes={has ? s?.todaySoFar : null} />
        {/* The short weekday only ("Thu 54.0 GB"): the date made it too long. */}
        <Stat
          label="Busiest day"
          bytes={has && s?.busiest ? s.busiest.down + s.busiest.up : null}
          prefix={has && s?.busiest ? clock.weekday(s.busiest.at) : undefined}
         
        />
      </div>
    </Card>
  );
}

function ByDevice({ range }: { range: UsageRange }) {
  const breakdown = useQuery<UsageBreakdown>("usage.breakdown", { range, by: "device", top: TOP }, { poll: true });
  const devices = useQuery<DeviceList>("device.list", undefined, { poll: true });
  const byId = new Map((devices.data?.devices ?? []).map((d) => [d.id, d]));
  const rows = breakdown.data?.rows.filter((r) => r.down + r.up > 0);
  const colors = entityColors((rows ?? []).flatMap((r) => (r.id ? [r.id] : [])));
  // "24 hours, top 5 used 78%": how much the named rows (not Others) account for.
  const named = (rows ?? []).filter((r) => r.id);
  const topShare = named.reduce((sum, r) => sum + r.share, 0);
  const description = rows && named.length ? `${WINDOW[range]}, top ${named.length} used ${formatPercent(topShare)}` : WINDOW[range];

  return (
    <Section
      title="By device"
      description={description}
      className="gap-[15px]"
      tools={<SectionLink to={pathFor("devices")}>View all devices</SectionLink>}
    >
      <Card>
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
    </Section>
  );
}

const countOf = (n: number) => `${n} ${n === 1 ? "device" : "devices"}`;

function ByProfile({ range }: { range: UsageRange }) {
  const breakdown = useQuery<UsageBreakdown>("usage.breakdown", { range, by: "profile" }, { poll: true });
  const profiles = useQuery<ProfileList>("profile.list", undefined, { poll: true });
  const list = profiles.data?.profiles ?? [];
  const byId = new Map(list.map((p) => [p.id, p]));
  const colors = entityColors(list.map((p) => p.id));
  // "Other devices" (unassigned) goes last, like By device's Others row.
  const rows = breakdown.data && [...breakdown.data.rows.filter((r) => r.id !== null), ...breakdown.data.rows.filter((r) => r.id === null)];

  const detail = (id: string | null): string => {
    if (id === null) return "unassigned";
    const p = byId.get(id);
    if (!p) return "";
    return p.paused ? `${countOf(p.deviceIds.length)} · paused` : countOf(p.deviceIds.length);
  };

  // "24 hours, 3 profiles, 1 paused": the count, and what needs attention.
  const paused = list.filter((p) => p.paused).length;
  const description = profiles.data
    ? [WINDOW[range], `${list.length} ${list.length === 1 ? "profile" : "profiles"}`, paused > 0 ? `${paused} paused` : null].filter(Boolean).join(", ")
    : WINDOW[range];

  return (
    <Section
      title="By profile"
      description={description}
      className="gap-[15px]"
      tools={<SectionLink to={pathFor("profiles")}>View all profiles</SectionLink>}
    >
      <Card>
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
    </Section>
  );
}
