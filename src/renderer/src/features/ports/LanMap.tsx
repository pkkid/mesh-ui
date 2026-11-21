/**
 * LAN address map: a range bar (gateway, static range, DHCP pool with the
 * leased count) over a grid of one square per address, coloured by kind.
 * Everything comes from reservation.list (LAN map, reservations and the
 * leased addresses core counted); the renderer only lays it out.
 */
import { useLayoutEffect, useRef, useState } from "react";

import type { QueryState } from "~/app/useCommand";
import { Card, Section } from "~/components/ui/card";
import { Footnote, SectionError } from "~/components/ui/page";
import { lanColors } from "~/lib/chartColors";
import { cn } from "~/lib/utils";
import type { ReservationList } from "../../../../core/commands/routing";
import { formatCount } from "../../../../core/format";
import type { LanMap as Lan } from "../../../../core/model";

type Kind = "none" | "gateway" | "staticRange" | "reserved" | "leased" | "free";

const LEGEND: [Exclude<Kind, "none">, string][] = [
  ["gateway", "Gateway"],
  ["staticRange", "Static range"],
  ["reserved", "Reserved"],
  ["leased", "Leased"],
  ["free", "Free in pool"],
];

/** Squares per grid row; the first address of each /24 is labelled. */
const PER_ROW = 64;
/** Larger subnets show the range bar only: a square per address stops being readable. */
const MAX_SQUARES = 4096;
/** The grid shows at most this many rows (a /22, eero's default) before it scrolls. */
const MAX_ROWS = 16;
/** The 2px (`gap-0.5`) between rows. */
const ROW_GAP = 2;

const toNum = (ip: string): number => ip.split(".").reduce((a, n) => a * 256 + Number(n), 0);
const toIp = (n: number) => [Math.floor(n / 16777216) % 256, Math.floor(n / 65536) % 256, Math.floor(n / 256) % 256, n % 256].join(".");
/** ".4.2" from "192.168.4.2": the last two octets, as the eero app writes them. */
const short = (ip: string) => `.${ip.split(".").slice(2).join(".")}`;

function kinds(lan: Lan, reserved: ReadonlyArray<string>, leases: ReadonlyArray<string>): Kind[] {
  const base = toNum(lan.subnet.split("/")[0] ?? "");
  const gw = toNum(lan.gateway) - base;
  const [ss, se, ps, pe] = [lan.staticRange.start, lan.staticRange.end, lan.pool.start, lan.pool.end].map((ip) => toNum(ip) - base) as [number, number, number, number];
  const res = new Set(reserved.map((ip) => toNum(ip) - base));
  const lease = new Set(leases.map((ip) => toNum(ip) - base));
  return Array.from({ length: lan.size }, (_, i): Kind => {
    if (i === gw) return "gateway";
    if (res.has(i)) return "reserved";
    if (lease.has(i)) return "leased";
    if (i >= ps && i <= pe) return "free";
    if (i >= ss && i <= se) return "staticRange";
    return "none";
  });
}

export function LanMap({ query }: { query: QueryState<ReservationList> }) {
  const lan = query.data?.lan ?? null;
  // "192.168.4.0/22, 1,024 addresses, 8 reserved, 22 leased": the range, then how it is used (the mode is in the hero).
  const description = lan
    ? [lan.subnet, `${formatCount(lan.size)} addresses`, `${formatCount(query.data?.reservations.length ?? 0)} reserved`, `${formatCount(lan.pool.leased)} leased`].join(", ")
    : "-";
  // On wide windows the legend sits on the right of the header; narrower, it moves under the subtitle instead of vanishing.
  const legend = (className: string) => (
    <div className={cn("items-center gap-x-3 gap-y-1 text-muted-foreground text-xs", className)}>
      {LEGEND.map(([k, label]) => (
        <span key={k} className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span aria-hidden className="size-2 rounded-[2px]" style={{ background: lanColors[k] }} />
          {label}
        </span>
      ))}
    </div>
  );

  return (
    <Section title="LAN address map" when="nat" description={description} tools={legend("hidden xl:flex")} className="gap-[15px]">
      {legend("-mt-2 flex flex-wrap xl:hidden")}
      {query.error && !query.data ? (
        <SectionError what="the address map" error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <>
          <Card padded className={cn("flex flex-col gap-4 transition-opacity", query.fading && "opacity-40")}>
            {lan ? <Body lan={lan} reserved={query.data?.reservations.map((r) => r.ip) ?? []} leases={query.data?.leases ?? []} /> : <div className="h-[220px]" />}
          </Card>
          <Footnote>
            Reservations sit in the static range so they never collide with DHCP leases.{lan && lan.size <= MAX_SQUARES ? " Hover a square for its address." : ""}
          </Footnote>
        </>
      )}
    </Section>
  );
}

function Body({ lan, reserved, leases }: { lan: Lan; reserved: string[]; leases: string[] }) {
  // Taller than MAX_ROWS rows (a range bigger than eero's default /22): cap the grid at that height and let it scroll.
  // The squares follow the card's width, so the cap is measured from a row as the card resizes.
  const gridRef = useRef<HTMLDivElement>(null);
  const [maxHeight, setMaxHeight] = useState<number | null>(null);
  const staticSize = Math.max(0, toNum(lan.staticRange.end) - toNum(lan.staticRange.start) + 1);
  const all = lan.size <= MAX_SQUARES ? kinds(lan, reserved, leases) : null;
  const base = toNum(lan.subnet.split("/")[0] ?? "");
  const rows = all ? Math.ceil(all.length / PER_ROW) : 0;
  const leased = `${formatCount(lan.pool.leased)} leased`;
  const tall = rows > MAX_ROWS;
  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el || !tall) return setMaxHeight(null);
    const measure = () => {
      const row = el.firstElementChild as HTMLElement | null;
      if (row) setMaxHeight(MAX_ROWS * row.offsetHeight + (MAX_ROWS - 1) * ROW_GAP);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [tall]);

  return (
    <>
      <div className="flex h-7 gap-0.5 overflow-hidden rounded-md text-2xs" role="img" aria-label={`Gateway ${lan.gateway}, static range ${lan.staticRange.start} to ${lan.staticRange.end}, DHCP pool ${lan.pool.start} to ${lan.pool.end} with ${leased}`}>
        <div className="min-w-2.5" style={{ flex: 1, background: lanColors.gateway }} title={`Gateway ${lan.gateway}`} />
        {staticSize > 0 && (
          <div className="flex min-w-[150px] items-center truncate px-2 text-foreground" style={{ flex: staticSize, background: lanColors.staticRange }}>
            Static {short(lan.staticRange.start)} to {short(lan.staticRange.end)}
          </div>
        )}
        <div className="flex min-w-0 items-center truncate px-2 text-foreground" style={{ flex: lan.pool.size, background: lanColors.free }}>
          <span className="truncate">
            DHCP pool {lan.pool.start} to {lan.pool.end} · {formatCount(lan.pool.size)} addresses, {leased}
          </span>
        </div>
      </div>

      {all && (
        <div
          ref={gridRef}
          className={cn("flex flex-col gap-0.5", tall && "overflow-y-auto pe-1")}
          style={tall && maxHeight ? { maxHeight } : undefined}
          role="img"
          aria-label={`One square per address: ${reserved.length} reserved, ${lan.pool.leased} leased`}
        >
          {Array.from({ length: rows }, (_, row) => {
            const first = row * PER_ROW;
            const label = (base + first) % 256 === 0 ? toIp(base + first) : "";
            return (
              <div key={row} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2">
                {/* The label takes no height of its own, so every row of squares is the same height (no gaps where a
                    label sits); its top lines up with the top of its row and the text may run past it. */}
                <span className="relative">
                  <span className="absolute top-0 left-0 whitespace-nowrap font-mono text-3xs text-muted-foreground leading-none tabular-nums">{label}</span>
                </span>
                <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${PER_ROW}, minmax(0, 1fr))` }}>
                  {all.slice(first, first + PER_ROW).map((k, i) => (
                    <span key={i} className="aspect-square rounded-[1.5px]" style={{ background: lanColors[k] }} title={toIp(base + first + i)} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
