/**
 * Device detail "IP addresses" (docs/ux/pages/device-detail.md, Layout 2):
 * IPv4 with a Reserved badge (from `reservation.list`, matched on MAC, or
 * the reservation `device.get` carries) and Edit or Reserve (disabled until
 * reservation writes land), each IPv6 address on its own line, and the
 * link-local address in muted text. Bridge mode has no reservations, so no
 * badge and no Reserve.
 */
import { Lock } from "lucide-react";

import { useQuery } from "~/app/useCommand";
import { Badge } from "~/components/ui/badge";
import { Card, Section } from "~/components/ui/card";
import { KvList } from "~/components/ui/kv-list";
import type { ReservationList } from "../../../../core/commands/routing";

import type { DeviceView } from "./DevicePage";

const compact = (mac: string) => mac.toLowerCase().replace(/[^0-9a-f]/g, "");

export function DeviceAddresses({ view }: { view: DeviceView }) {
  const reservations = useQuery<ReservationList>("reservation.list", undefined, { poll: 60, enabled: !view.bridged });
  const d = view.device;
  const listed = d ? reservations.data?.reservations.find((r) => compact(r.mac) === compact(d.mac)) : undefined;
  const reserved = !view.bridged && !!d && (!!listed || !!d.reservation);
  const ipv4 = d ? (d.ipv4 ?? listed?.ip ?? d.reservation?.ip ?? null) : null;
  const canReserve = !view.bridged && !view.guest && !!d && !d.blocked;

  return (
    <Section title="IP addresses">
      <Card padded>
        <KvList
          items={[
            {
              label: "IPv4",
              value: ipv4 ? (
                <span className="flex items-center justify-end gap-2">
                  <span className="font-mono text-xs">{ipv4}</span>
                  {reserved && (
                    <Badge variant="outline" className="text-2xs">
                      <Lock />
                      Reserved
                    </Badge>
                  )}
                  {canReserve && (
                    <span title="Coming soon" className="cursor-not-allowed text-muted-foreground text-xs">
                      {reserved ? "Edit" : "Reserve"}
                    </span>
                  )}
                </span>
              ) : null,
              copy: ipv4 ?? undefined,
            },
            {
              label: "IPv6",
              value: d?.ipv6.length ? (
                <span className="flex flex-col items-end">
                  {d.ipv6.map((a) => (
                    <span key={a} className="font-mono text-xs">
                      {a}
                    </span>
                  ))}
                </span>
              ) : null,
            },
            { label: "Link-local", value: d?.ipv6LinkLocal ? <span className="font-mono text-muted-foreground text-xs">{d.ipv6LinkLocal}</span> : null },
          ]}
        />
      </Card>
    </Section>
  );
}
