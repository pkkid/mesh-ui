/**
 * LAN address map: a range bar (gateway, static range, DHCP pool with the
 * leased count) over a grid of one square per address, coloured by kind.
 * Everything comes from reservation.list (LAN map, reservations and the
 * leased addresses core counted); the renderer only lays it out.
 */
import { Info } from "lucide-react";

import type { QueryState } from "~/app/useCommand";
import { Card, Section } from "~/components/ui/card";
import { SectionError } from "~/components/ui/page";
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
  const subtitle = lan ? `${lan.subnet} · ${formatCount(lan.size)} addresses` : undefined;
  const legend = (
    <div className="hidden items-center gap-3 text-muted-foreground text-xs xl:flex">
      {LEGEND.map(([k, label]) => (
        <span key={k} className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span aria-hidden className="size-2 rounded-[2px]" style={{ background: lanColors[k] }} />
          {label}
        </span>
      ))}
    </div>
  );

  return (
    <Section title="LAN address map" subtitle={subtitle && <span className="font-mono">{subtitle}</span>} tools={legend}>
      {query.error && !query.data ? (
        <SectionError what="the address map" error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <Card padded className={cn("flex flex-col gap-4 transition-opacity", query.fading && "opacity-40")}>
          {lan ? <Body lan={lan} reserved={query.data?.reservations.map((r) => r.ip) ?? []} leases={query.data?.leases ?? []} /> : <div className="h-[220px]" />}
        </Card>
      )}
    </Section>
  );
}

function Body({ lan, reserved, leases }: { lan: Lan; reserved: string[]; leases: string[] }) {
  const staticSize = Math.max(0, toNum(lan.staticRange.end) - toNum(lan.staticRange.start) + 1);
  const all = lan.size <= MAX_SQUARES ? kinds(lan, reserved, leases) : null;
  const base = toNum(lan.subnet.split("/")[0] ?? "");
  const rows = all ? Math.ceil(all.length / PER_ROW) : 0;
  const leased = `${formatCount(lan.pool.leased)} leased`;

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
        <div className="flex flex-col gap-0.5" role="img" aria-label={`One square per address: ${reserved.length} reserved, ${lan.pool.leased} leased`}>
          {Array.from({ length: rows }, (_, row) => {
            const first = row * PER_ROW;
            const label = (base + first) % 256 === 0 ? toIp(base + first) : "";
            return (
              <div key={row} className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-2">
                <span className="font-mono text-3xs text-muted-foreground tabular-nums">{label}</span>
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

      <div className="flex items-center gap-2 text-muted-foreground text-xs">
        <Info className="size-3.5 shrink-0" />
        Reservations sit in the static range so they never collide with DHCP leases.{all ? " Hover a square for its address." : ""}
      </div>
    </>
  );
}
