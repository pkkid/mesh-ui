/**
 * IPv4 reservations table, plus the small pieces the Ports page tables
 * share: the device lookup, the device cell and the protocol label. The
 * filter is view state; add, edit and remove are "Coming soon".
 */
import { BookmarkPlus, Ellipsis, Search } from "lucide-react";
import { type ReactNode, useState } from "react";

import { Link, pathFor } from "~/app/router";
import type { QueryState } from "~/app/useCommand";
import { bandLabel } from "~/components/ui/band-badge";
import { Card, Empty, Section } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { ComingSoonButton, SectionError } from "~/components/ui/page";
import { deviceIcon } from "~/lib/deviceIcons";
import { cn } from "~/lib/utils";
import type { ReservationList } from "../../../../core/commands/routing";
import type { Device, Protocol } from "../../../../core/model";

/** What the tables need to show a device: the device itself, and its eero's name and colour. */
export type Lookup = {
  device: (id: string | null) => Device | undefined;
  eero: (id: string | null) => { name: string; color: string } | undefined;
};

export const PROTOCOL_LABEL: Record<Protocol, string> = { tcp: "TCP", udp: "UDP", both: "TCP+UDP" };

/** A neutral protocol tag. */
export function ProtocolTag({ protocol }: { protocol: Protocol }) {
  return <span className="inline-flex h-5 items-center whitespace-nowrap rounded-[5px] border bg-muted px-1.5 font-medium text-[11px] text-foreground/80">{PROTOCOL_LABEL[protocol]}</span>;
}

/** The disabled overflow menu of a row, until the writes land. */
export function RowMenu({ label }: { label: string }) {
  return (
    <ComingSoonButton size="icon-xs" variant="ghost-muted" aria-label={label}>
      <Ellipsis />
    </ComingSoonButton>
  );
}

/** Device icon tile, name (a link to the device) and an optional detail line. */
export function DeviceCell({ device, fallback, detail }: { device: Device | undefined; fallback: string; detail?: ReactNode }) {
  const Icon = deviceIcon(device);
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-3.5">
        <Icon />
      </span>
      <div className="min-w-0">
        {device ? (
          <Link to={pathFor("device", { deviceId: device.id })} className="block truncate font-medium hover:underline">
            {device.name}
          </Link>
        ) : (
          <div className="truncate font-medium">{fallback || "-"}</div>
        )}
        {detail && <div className="truncate text-2xs text-muted-foreground">{detail}</div>}
      </div>
    </div>
  );
}

/** "Wired · online", "5 GHz · offline". */
export function connectionLine(d: Device | undefined): string | null {
  if (!d) return null;
  const how = d.band ? bandLabel(d.band) : d.ssid === "guest" ? "Guest" : null;
  return [how, d.connected ? "online" : "offline"].filter(Boolean).join(" · ");
}

const th = "px-3 py-2 font-normal";
const td = "px-3 py-2.5";

export function Reservations({ query, lookup }: { query: QueryState<ReservationList>; lookup: Lookup }) {
  const [filter, setFilter] = useState("");
  const rows = query.data?.reservations;
  const q = filter.trim().toLowerCase();
  const shown = rows?.filter((r) => {
    if (!q) return true;
    const name = lookup.device(r.deviceId)?.name ?? r.name;
    return [name, r.mac, r.ip].some((s) => s.toLowerCase().includes(q));
  });

  const tools = (
    <>
      {rows && rows.length > 0 && (
        <Input
          type="search"
          className="w-48"
          icon={<Search />}
          placeholder="Filter"
          aria-label="Filter reservations"
          value={filter}
          onChange={(e) => setFilter(e.currentTarget.value)}
        />
      )}
      <ComingSoonButton size="sm" variant="outline">
        <BookmarkPlus />
        Add a reservation
      </ComingSoonButton>
    </>
  );

  return (
    <Section title="IPv4 reservations" subtitle="Devices that always get the same address" tools={tools}>
      {query.error && !query.data ? (
        <SectionError what="reservations" error={query.error} onRetry={() => void query.refetch()} />
      ) : rows && rows.length === 0 ? (
        <Card>
          <Empty>No reservations yet.</Empty>
        </Card>
      ) : (
        <Card>
          <table className={cn("w-full border-collapse text-[13px] transition-opacity", query.fading && "opacity-40")} aria-label="IPv4 reservations">
            <thead>
              <tr className="border-b text-left text-muted-foreground text-xs">
                <th className={cn(th, "w-[34%]")}>Device</th>
                <th className={th}>MAC address</th>
                <th className={th}>Reserved IP</th>
                <th className={th}>Connected to</th>
                <th className={cn(th, "text-right")}>Ports</th>
                <th className={th}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown
                ? shown.map((r) => {
                    const d = lookup.device(r.deviceId);
                    const eero = lookup.eero(d?.connected ? d.eeroId : null);
                    return (
                      <tr key={r.id} className={cn("border-border/50 border-b last:border-b-0 hover:bg-muted/50", d && !d.connected && "text-muted-foreground")}>
                        <td className={td}>
                          <DeviceCell device={d} fallback={r.name || r.mac} detail={connectionLine(d)} />
                        </td>
                        <td className={cn(td, "font-mono text-muted-foreground text-xs")}>{r.mac}</td>
                        <td className={cn(td, "font-mono text-xs tabular-nums")}>{r.ip}</td>
                        <td className={cn(td, "whitespace-nowrap text-xs")}>
                          {eero ? (
                            <span className="inline-flex items-center gap-1.5">
                              <span aria-hidden className="size-1.5 rounded-full" style={{ background: eero.color }} />
                              {eero.name}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </td>
                        <td className={cn(td, "text-right text-xs tabular-nums")}>{r.forwards > 0 ? r.forwards : <span className="text-muted-foreground">-</span>}</td>
                        <td className={cn(td, "w-8 py-1 text-right")}>
                          <RowMenu label={`Options for ${d?.name ?? r.name}`} />
                        </td>
                      </tr>
                    );
                  })
                : Array.from({ length: 4 }, (_, i) => (
                    <tr key={i} className="border-border/50 border-b last:border-b-0">
                      <td className="h-[49px]" colSpan={6} />
                    </tr>
                  ))}
              {shown && shown.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <Empty>No reservations match "{filter}".</Empty>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      )}
    </Section>
  );
}
