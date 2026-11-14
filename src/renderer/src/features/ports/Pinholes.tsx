/**
 * IPv6 firewall rules: one row per pinhole with its device, the device's
 * IPv6 address, the port and protocol. Add and remove are "Coming soon".
 */
import { Plus } from "lucide-react";

import type { QueryState } from "~/app/useCommand";
import { Card, Empty, Section } from "~/components/ui/card";
import { ComingSoonButton, PlaceholderRows, Row, RowList, SectionError } from "~/components/ui/page";
import { cn } from "~/lib/utils";
import type { PinholeList } from "../../../../core/commands/routing";

import { DeviceCell, type Lookup, ProtocolTag, RowMenu } from "./Reservations";

export function Pinholes({ query, lookup }: { query: QueryState<PinholeList>; lookup: Lookup }) {
  const rows = query.data?.pinholes;
  const tools = (
    <ComingSoonButton size="sm" variant="outline">
      <Plus />
      Add
    </ComingSoonButton>
  );

  return (
    <Section title="IPv6 firewall rules" subtitle="Pinholes to one device" tools={tools}>
      {query.error && !query.data ? (
        <SectionError what="IPv6 firewall rules" error={query.error} onRetry={() => void query.refetch()} />
      ) : !rows ? (
        <PlaceholderRows count={2} />
      ) : rows.length === 0 ? (
        <Card>
          <Empty>No IPv6 rules yet.</Empty>
        </Card>
      ) : (
        <RowList className={cn("text-[13px] transition-opacity", query.fading && "opacity-40")}>
          {rows.map((p) => {
            const d = lookup.device(p.deviceId);
            return (
              <Row key={p.id}>
                <div className="min-w-0 flex-1">
                  <DeviceCell device={d} fallback={p.deviceId ?? ""} detail={<span className="font-mono">{p.address ?? "-"}</span>} />
                </div>
                <span className="font-mono text-xs tabular-nums">{p.port}</span>
                <ProtocolTag protocol={p.protocol} />
                <RowMenu label={`Options for the rule on port ${p.port}`} />
              </Row>
            );
          })}
        </RowList>
      )}
    </Section>
  );
}
