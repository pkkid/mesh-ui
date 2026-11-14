/**
 * Activity "Event stream": the network's events newest first, under a bar per
 * day (count and a per hour strip), with grouped rows folding repeats and a
 * "Load older events" footer that pages back to the start of history.
 * Grouping is done in core (`events.list {grouped: true}`).
 * docs/ux/pages/activity.md (Layout 3).
 */
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";

import { Link, pathFor } from "~/app/router";
import { Sparkline } from "~/components/charts/Sparkline";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, Empty } from "~/components/ui/card";
import { IconTile } from "~/components/ui/hero";
import { seriesColors } from "~/lib/chartColors";
import { cn } from "~/lib/utils";
import { type Clock, formatCount } from "../../../../core/format";
import type { EventSummary, NetworkEvent } from "../../../../core/model";

import { CATEGORIES } from "./ActivityChart";

/** Where a row's action goes: its device, eero or profile, Updates for firmware, Troubleshooting for a repeated eero problem. */
function rowLink(e: NetworkEvent): { to: string; label: string } | null {
  if (e.refs.deviceId) return { to: pathFor("device", { deviceId: e.refs.deviceId }), label: "Device" };
  if (e.refs.profileId) return { to: pathFor("profile", { profileId: e.refs.profileId }), label: "Profile" };
  if (e.category === "eero_status" && e.grouped?.length) return { to: pathFor("troubleshooting"), label: "Diagnose" };
  if (e.refs.eeroId) return { to: pathFor("eero", { eeroId: e.refs.eeroId }), label: "eero" };
  if (e.category === "firmware") return { to: pathFor("updates"), label: "Updates" };
  return null;
}

type Day = { key: string; label: string; sub: string; strip: number[] | null; rows: NetworkEvent[] };

/**
 * Splits rows into days using the summary's day starts (network time zone).
 * Rows older than the window fall into their own day by date label.
 */
export function splitDays(rows: ReadonlyArray<NetworkEvent>, days: EventSummary | undefined, hours: EventSummary | undefined, clock: Clock): Day[] {
  const starts = (days?.buckets ?? []).map((b) => Date.parse(b.at));
  const newest = starts.length - 1;
  const out: Day[] = [];
  for (const e of rows) {
    const at = Date.parse(e.at);
    let i = starts.length - 1;
    while (i >= 0 && (starts[i] as number) > at) i--;
    const key = i >= 0 ? `d${i}` : `x${clock.day(at)}`;
    let day = out[out.length - 1];
    if (!day || day.key !== key) {
      const bucket = i >= 0 ? days?.buckets[i] : undefined;
      const label = i === newest ? "Today" : i === newest - 1 ? "Yesterday" : clock.longWeekday(at);
      const end = i >= 0 && i < newest ? (starts[i + 1] as number) : Number.POSITIVE_INFINITY;
      const strip =
        i >= 0 && hours ? hours.buckets.filter((b) => Date.parse(b.at) >= (starts[i] as number) && Date.parse(b.at) < end).map((b) => b.total) : null;
      const sub = bucket ? `${clock.day(at)} · ${formatCount(bucket.total)} ${bucket.total === 1 ? "event" : "events"}` : clock.day(at);
      day = { key, label, sub, strip, rows: [] };
      out.push(day);
    }
    day.rows.push(e);
  }
  return out;
}

function EventRow({ e, clock }: { e: NetworkEvent; clock: Clock }) {
  const meta = CATEGORIES[e.category];
  const link = rowLink(e);
  const extra = e.grouped?.length ?? 0;
  return (
    <div className="grid grid-cols-[62px_32px_minmax(0,1fr)_auto] items-start gap-x-3.5 px-[18px] py-[11px] hover:bg-muted/50">
      <div className="pt-[7px] text-right font-mono text-[11.5px] text-muted-foreground tabular-nums">{clock.time(e.at)}</div>
      <IconTile icon={meta.icon} size="sm" />
      <div className="min-w-0">
        <div className="text-[13px] leading-snug">
          {e.title}
          {extra > 0 && (
            <Badge variant="outline" className="ms-2 align-middle">
              {extra + 1} events
            </Badge>
          )}
        </div>
        {e.detail && <div className="mt-0.5 text-muted-foreground text-xs">{e.detail}</div>}
        {extra > 0 && (
          <div className="mt-2 flex flex-col gap-1 border-l-2 ps-2.5">
            {[e, ...(e.grouped ?? [])].map((g) => (
              <div key={g.id} className="text-muted-foreground text-xs">
                <span className="me-2 font-mono text-[11.5px] text-foreground/80 tabular-nums">{clock.time(g.at)}</span>
                {g.detail ?? g.title}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1.5 pt-[3px]">
        {link && (
          <Button size="xs" variant="outline" render={<Link to={link.to} />}>
            {link.label}
            <ArrowRight />
          </Button>
        )}
      </div>
    </div>
  );
}

export function EventStream({
  rows,
  days,
  hours,
  clock,
  loading,
  fading,
  emptyText,
  error,
  footer,
}: {
  /** undefined while the first page loads. */
  rows: ReadonlyArray<NetworkEvent> | undefined;
  days: EventSummary | undefined;
  hours: EventSummary | undefined;
  clock: Clock;
  loading: boolean;
  fading: boolean;
  emptyText: string;
  /** The inline error note above the stream (rows already shown stay). */
  error: ReactNode;
  footer: ReactNode;
}) {
  if (!rows && error) return <>{error}</>;
  if (!rows) {
    return (
      <div className="flex flex-col gap-3">
        {error}
        <Card className="divide-y">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="h-[58px]" />
          ))}
        </Card>
      </div>
    );
  }
  const split = splitDays(rows, days, hours, clock);
  return (
    <div className="flex flex-col gap-3">
      {error}
      <Card className={cn("transition-opacity", fading && "opacity-40")} aria-busy={loading}>
        {split.length === 0 ? (
          <Empty>{emptyText}</Empty>
        ) : (
          split.map((d) => (
            <div key={d.key}>
              <div className="flex items-center gap-3 border-b bg-muted/40 px-[18px] py-3 [&:not(:first-child)]:border-t">
                <h3 className="font-semibold text-xs uppercase tracking-wider">{d.label}</h3>
                <span className="text-muted-foreground text-xs tabular-nums">{d.sub}</span>
                {d.strip && d.strip.some((v) => v > 0) && (
                  <Sparkline
                    values={d.strip}
                    color={seriesColors.neutral}
                    ariaLabel={`Events per hour, ${d.label}`}
                    dot={false}
                    className="ms-auto h-5 w-full max-w-72"
                  />
                )}
              </div>
              <div className="divide-y divide-border/60">
                {d.rows.map((e) => (
                  <EventRow key={e.id} e={e} clock={clock} />
                ))}
              </div>
            </div>
          ))
        )}
        {footer}
      </Card>
    </div>
  );
}
