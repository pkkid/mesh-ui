/**
 * Device detail "Addresses and ports" (docs/ux/pages/device-detail.md,
 * Layout 2): the IP addresses and port forwarding in one card of settings
 * rows, like Device settings. Each row says what it is, shows the value and
 * has one action:
 * - IPv4: the address (copy) and whether it is reserved; Reserve… or Edit…
 *   opens the reservation sheet for this device (features/ports/RuleSheet.tsx),
 *   whose edit mode also offers Remove reservation… here.
 *   The reservation comes from `reservation.list` (matched on MAC) or the one
 *   `device.get` carries.
 * - IPv6: the addresses, with the link-local address under them.
 * - Port forwarding: how many are open and off, Open a port… (the port forward
 *   sheet with this device picked), and the forwards listed under the row
 *   (`forward.list {device}`): name, port, protocol, an on/off switch and a
 *   trash button.
 * The header links to Reservations & ports, which holds both. Bridge mode has
 * no reservations or forwards; guests have no forwards.
 */
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { pathFor } from "~/app/router";
import { useQuery } from "~/app/useCommand";
import type { Gate } from "~/app/useWrite";
import { Badge } from "~/components/ui/badge";
import { Card, Section } from "~/components/ui/card";
import { CopyButton } from "~/components/ui/kv-list";
import { GatedButton, SectionLink, useGate } from "~/components/ui/page";
import { Row as SettingsRow, WriteSwitch } from "~/features/advanced/SettingsGroups";
import { ForwardSheet, type ForwardSheetMode, removeForward, ReservationSheet, type ReservationSheetMode, setForwardEnabled } from "~/features/ports/RuleSheet";
import { cn } from "~/lib/utils";
import type { ForwardList, ReservationList } from "../../../../core/commands/routing";
import type { Forward, Protocol } from "../../../../core/model";

import { DIM_ICON } from "./DeviceHero";
import type { DeviceView } from "./DevicePage";

const PROTOCOL: Record<Protocol, string> = { tcp: "TCP", udp: "UDP", both: "TCP+UDP" };
const compact = (mac: string) => mac.toLowerCase().replace(/[^0-9a-f]/g, "");

export function DeviceNetwork({ view, id }: { view: DeviceView; id: string }) {
  const d = view.device;
  const ports = !view.bridged && !view.guest;
  const reservations = useQuery<ReservationList>("reservation.list", undefined, { poll: true, enabled: !view.bridged });
  const forwards = useQuery<ForwardList>("forward.list", { device: id }, { poll: true, enabled: ports });
  const [reservationSheet, setReservationSheet] = useState<ReservationSheetMode | null>(null);
  const [forwardSheet, setForwardSheet] = useState<ForwardSheetMode | null>(null);

  const listed = d ? reservations.data?.reservations.find((r) => compact(r.mac) === compact(d.mac)) : undefined;
  const reserved = !view.bridged && !!d && (!!listed || !!d.reservation);
  const ipv4 = d ? (d.ipv4 ?? listed?.ip ?? d.reservation?.ip ?? null) : null;
  const canReserve = !view.bridged && !view.guest && !!d && !d.blocked && (!!reservations.data || !reserved);
  const reserveGate = useGate(listed ? "reservation.update" : "reservation.add");
  const addGate = useGate("forward.add");
  const editGate = useGate("forward.update");
  const removeGate = useGate("forward.remove");

  const rows = forwards.data?.forwards;
  const on = rows?.filter((f) => f.enabled).length ?? 0;
  const off = (rows?.length ?? 0) - on;
  const portsText = !rows ? null : rows.length === 0 ? "no ports open" : [on ? `${on} open` : null, off ? `${off} off` : null].filter(Boolean).join(", ");

  // "Reserved, 1 open" or "Not reserved, no ports open": what is set (the address itself is the first row).
  const description = d
    ? [view.bridged ? (ipv4 ? null : "No IPv4 address") : reserved ? "Reserved" : "Not reserved", ports ? portsText : null].filter(Boolean).join(", ") || "-"
    : "-";

  return (
    <Section
      title={ports ? "Addresses and ports" : "Addresses"}
      description={description}
      className="gap-[15px]"
      tools={view.bridged ? undefined : <SectionLink to={pathFor("ports")}>Reservations &amp; ports</SectionLink>}
    >
      <ReservationSheet mode={reservationSheet} onClose={() => setReservationSheet(null)} removable />
      <ForwardSheet mode={forwardSheet} onClose={() => setForwardSheet(null)} />
      <Card className="divide-y divide-border/50">
        <SettingsRow
          title={
            ipv4 ? (
              <span className="flex items-center gap-1.5">
                <span className="font-mono text-[13px]">{ipv4}</span>
                <CopyButton text={ipv4} label="IPv4 address" />
              </span>
            ) : (
              <span className="font-normal text-muted-foreground">{d ? "No IPv4 address" : "-"}</span>
            )
          }
          description={view.bridged ? "IPv4" : reserved ? "IPv4, reserved: it never changes" : "IPv4, can change when the device reconnects"}
          control={
            canReserve ? (
              <GatedButton
                gate={reserveGate}
                variant="outline"
                size="sm"
                className={DIM_ICON}
                title={reserved ? "Edit this device's address reservation" : "Always give this device the same IPv4 address"}
                onClick={() => {
                  if (!d) return;
                  setReservationSheet(listed ? { kind: "edit", reservation: listed } : { kind: "add", deviceId: d.id });
                }}
              >
                {reserved ? <Pencil /> : <Plus />}
                {reserved ? "Edit…" : "Reserve…"}
              </GatedButton>
            ) : undefined
          }
        />
        <SettingsRow
          title={
            d?.ipv6.length ? (
              <span className="flex flex-col">
                {d.ipv6.map((a) => (
                  <span key={a} className="font-mono text-[13px]">
                    {a}
                  </span>
                ))}
              </span>
            ) : (
              <span className="font-normal text-muted-foreground">{d ? "No IPv6 address" : "-"}</span>
            )
          }
          description={
            d?.ipv6LinkLocal ? (
              <>
                Link-local <span className="font-mono">{d.ipv6LinkLocal}</span>
              </>
            ) : (
              "IPv6"
            )
          }
        />
        {ports && (
          <SettingsRow
            title="Port forwarding"
            description={
              forwards.error && !rows
                ? "Couldn't load the port forwards."
                : forwards.data?.unavailable ?? (rows ? (rows.length === 0 ? "No ports open to this device" : portsText) : "-")
            }
            control={
              d && !d.blocked ? (
                <GatedButton gate={addGate} variant="outline" size="sm" className={DIM_ICON} onClick={() => setForwardSheet({ kind: "add", deviceId: id })}>
                  <Plus />
                  Open a port{"…"}
                </GatedButton>
              ) : undefined
            }
          >
            {rows && rows.length > 0 && (
              // One grid for every row (each row a subgrid), so the columns line up and the name gets what is left.
              <div
                role="table"
                aria-label="Port forwards"
                className={cn("grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-x-3 text-[13px]", forwards.fading && "opacity-40")}
              >
                {rows.map((f) => (
                  <ForwardRow key={f.id} forward={f} editGate={editGate} removeGate={removeGate} />
                ))}
              </div>
            )}
          </SettingsRow>
        )}
      </Card>
    </Section>
  );
}

/** One forward under the Port forwarding row: name, port or range, protocol, its on/off switch and trash. */
function ForwardRow({ forward: f, editGate, removeGate }: { forward: Forward; editGate: Gate; removeGate: Gate }) {
  const port = f.externalPort === f.internalPort ? f.externalPort : `${f.externalPort} → ${f.internalPort}`;
  const name = f.name || "Port forward";
  return (
    <div role="row" className="col-span-4 grid min-h-8 grid-cols-subgrid items-center border-border/50 border-t first:border-t-0">
      <span role="cell" className={cn("truncate", !f.enabled && "text-muted-foreground")}>
        {name}
        {!f.enabled && <span className="text-muted-foreground"> (off)</span>}
      </span>
      <span role="cell" className={cn("truncate font-mono text-xs tabular-nums", !f.enabled && "text-muted-foreground")}>
        {port}
      </span>
      <span role="cell">
        {/* The band badge's neutral box (muted fill, border), so it shows on the card in both themes. */}
        <Badge className="border bg-muted text-foreground/80">{PROTOCOL[f.protocol]}</Badge>
      </span>
      <span role="cell" className="flex items-center justify-end gap-1.5">
        <WriteSwitch on={f.enabled} label={`${name} on`} gate={editGate} onToggle={(next) => void setForwardEnabled(f, next)} />
        <button
          type="button"
          disabled={!removeGate.allowed}
          title={removeGate.allowed ? `Remove ${name}…` : (removeGate.reason ?? undefined)}
          aria-label={`Remove ${name}…`}
          onClick={() => void removeForward(f)}
          className="grid size-6 cursor-pointer place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-70"
        >
          <Trash2 className="size-3.5" />
        </button>
      </span>
    </div>
  );
}
