/**
 * IPv6 firewall rules: one row per pinhole with its device, the device's
 * IPv6 address, the port and protocol. Add opens the rule sheet
 * (RuleSheet.tsx); the row menu's Remove asks first. With IPv6 off
 * (`settings.get` `ipv6.enabled`, refreshed by `settings.ipv6.set`) the
 * section says so with a link to Advanced networking instead.
 */
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

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
  const tools = (
    <GatedButton gate={addGate} variant="outline" className="[&_svg]:text-muted-foreground" onClick={() => setAdding(true)}>
      <Plus />
      Add a rule{"\u2026"}
    </GatedButton>
  );

  // With IPv6 off there is nothing to open: the whole section is left out (Advanced networking turns IPv6 on).
  if (ipv6Off) return null;

  return (
    <Section
      title="IPv6 firewall rules" when="ipv6Rules"
      description={rows ? (rows.length === 0 ? "No pinholes open" : `${rows.length} ${rows.length === 1 ? "pinhole" : "pinholes"} open to one device each`) : "-"}
      tools={tools}
      className="gap-[15px]"
    >
      <PinholeSheet open={adding} onClose={() => setAdding(false)} />
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
