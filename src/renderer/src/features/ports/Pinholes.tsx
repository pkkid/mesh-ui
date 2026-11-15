/**
 * IPv6 firewall rules: one row per pinhole with its device, the device's
 * IPv6 address, the port and protocol. Add opens the rule sheet
 * (RuleSheet.tsx); the row menu's Remove asks first. With IPv6 off
 * (`settings.get` `ipv6.enabled`, refreshed by `settings.ipv6.set`) the
 * section says so with a link to Advanced networking instead.
 */
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { Link, pathFor } from "~/app/router";
import { type QueryState, useQuery } from "~/app/useCommand";
import { Card, Empty, Section } from "~/components/ui/card";
import { GatedButton, PlaceholderRows, Row, RowList, SectionError, useGate } from "~/components/ui/page";
import { cn } from "~/lib/utils";
import type { PinholeList } from "../../../../core/commands/routing";
import type { NetworkSettings } from "../../../../core/model";

import { DeviceCell, type Lookup, ProtocolTag, RowMenu } from "./Reservations";
import { PinholeSheet, removePinhole } from "./RuleSheet";

export function Pinholes({ query, lookup }: { query: QueryState<PinholeList>; lookup: Lookup }) {
  const rows = query.data?.pinholes;
  const [adding, setAdding] = useState(false);
  const settings = useQuery<NetworkSettings>("settings.get", undefined, { poll: true });
  const ipv6Off = settings.data?.ipv6.enabled === false;
  const addGate = useGate("pinhole.add");
  const removeGate = useGate("pinhole.remove");
  const tools = ipv6Off ? null : (
    <GatedButton gate={addGate} size="sm" variant="outline" onClick={() => setAdding(true)}>
      <Plus />
      Add
    </GatedButton>
  );

  return (
    <Section title="IPv6 firewall rules" subtitle="Pinholes to one device" tools={tools}>
      <PinholeSheet open={adding} onClose={() => setAdding(false)} />
      {ipv6Off ? (
        <Card>
          <Empty className="flex flex-col items-center gap-2">
            <span>Turn on IPv6 to add firewall rules.</span>
            <Link to={pathFor("advanced")} className="text-foreground text-xs underline-offset-2 hover:underline">
              Advanced networking
            </Link>
          </Empty>
        </Card>
      ) : query.error && !query.data ? (
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
                <RowMenu
                  label={`Options for the rule on port ${p.port}`}
                  actions={[{ label: "Remove", icon: Trash2, gate: removeGate, destructive: true, onClick: () => void removePinhole(p, d?.name ?? "this device") }]}
                />
              </Row>
            );
          })}
        </RowList>
      )}
    </Section>
  );
}
