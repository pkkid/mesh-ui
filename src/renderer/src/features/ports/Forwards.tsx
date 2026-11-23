/**
 * Port forwards table: name, device, internal IP, external and internal
 * port or range, protocol and whether it is on. Add and the row menu's Edit
 * open the port forward sheet (RuleSheet.tsx); the Enabled switch runs
 * `forward.update` with Undo; Remove asks first. Disabled forwards are dimmed.
 */
import { ArrowRight, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import type { QueryState } from "~/app/useCommand";
import { Card, Empty, Section } from "~/components/ui/card";
import { GatedButton, SectionError, useGate } from "~/components/ui/page";
import { WriteSwitch } from "~/features/advanced/SettingsGroups";
import { cn } from "~/lib/utils";
import type { ForwardList } from "../../../../core/commands/routing";

import { type Lookup, ProtocolTag, RowMenu } from "./Reservations";
import { ForwardSheet, type ForwardSheetMode, removeForward, setForwardEnabled } from "./RuleSheet";

const th = "px-3 py-2 font-normal";
const td = "px-3 py-2.5";

export function Forwards({ query, lookup, publicIp }: { query: QueryState<ForwardList>; lookup: Lookup; publicIp: string | null }) {
  const rows = query.data?.forwards;
  const [sheet, setSheet] = useState<ForwardSheetMode | null>(null);
  const addGate = useGate("forward.add");
  const editGate = useGate("forward.update");
  const removeGate = useGate("forward.remove");
  const tools = (
    <GatedButton gate={addGate} variant="outline" onClick={() => setSheet({ kind: "add" })}>
      <Plus />
      Add port forward{"\u2026"}
    </GatedButton>
  );

  return (
    <Section title="Port forwards" when="nat" description={forwardsLine(rows, publicIp)} tools={tools} className="gap-[15px]">
      <ForwardSheet mode={sheet} onClose={() => setSheet(null)} />
      {query.error && !query.data ? (
        <SectionError what="port forwards" error={query.error} onRetry={() => void query.refetch()} />
      ) : rows && rows.length === 0 ? (
        <Card>
          <Empty>No port forwards yet.</Empty>
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className={cn("w-full border-collapse text-[13px] transition-opacity", query.fading && "opacity-40")} aria-label="Port forwards">
            <thead>
              <tr className="border-b text-left text-muted-foreground text-xs">
                <th className={th}>Name</th>
                <th className={th}>Device</th>
                <th className={th}>Internal IP</th>
                <th className={cn(th, "text-right")}>External</th>
                <th className={th}>
                  <span className="sr-only">to</span>
                </th>
                <th className={th}>Internal</th>
                <th className={th}>Protocol</th>
                <th className={cn(th, "text-right")}>Enabled</th>
                <th className={th}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows
                ? rows.map((f) => {
                    const d = lookup.device(f.deviceId);
                    return (
                      <tr key={f.id} className={cn("border-border/50 border-b last:border-b-0 hover:bg-muted/50", !f.enabled && "text-muted-foreground")}>
                        <td className={cn(td, "whitespace-nowrap font-medium")}>{f.name || "-"}</td>
                        <td className={cn(td, "whitespace-nowrap")}>{d?.name ?? "-"}</td>
                        <td className={cn(td, "font-mono text-xs tabular-nums")}>{f.ip || "-"}</td>
                        <td className={cn(td, "whitespace-nowrap text-right font-mono text-xs tabular-nums")}>{f.externalPort}</td>
                        <td className="px-0 text-muted-foreground">
                          <ArrowRight aria-hidden className="size-3.5" />
                        </td>
                        <td className={cn(td, "whitespace-nowrap font-mono text-xs tabular-nums")}>{f.internalPort}</td>
                        <td className={td}>
                          <ProtocolTag protocol={f.protocol} />
                        </td>
                        <td className={cn(td, "text-right")}>
                          <WriteSwitch on={f.enabled} label={`${f.name || "Forward"} enabled`} gate={editGate} onToggle={(on) => void setForwardEnabled(f, on)} className="align-middle" />
                        </td>
                        <td className={cn(td, "w-8 py-1 text-right")}>
                          <RowMenu
                            label={`Options for ${f.name || "forward"}`}
                            actions={[
                              { label: "Edit\u2026", icon: Pencil, gate: editGate, onClick: () => setSheet({ kind: "edit", forward: f }) },
                              { label: "Remove", icon: Trash2, gate: removeGate, destructive: true, onClick: () => void removeForward(f) },
                            ]}
                          />
                        </td>
                      </tr>
                    );
                  })
                : Array.from({ length: 3 }, (_, i) => (
                    <tr key={i} className="border-border/50 border-b last:border-b-0">
                      <td className="h-[43px]" colSpan={9} />
                    </tr>
                  ))}
            </tbody>
          </table>
        </Card>
      )}
    </Section>
  );
}

/** "5 forwards, 4 on, open on 203.0.113.48": the count, how many are on, and the address they open. */
function forwardsLine(rows: ReadonlyArray<{ enabled: boolean }> | undefined, publicIp: string | null): string {
  if (!rows) return "-";
  if (rows.length === 0) return "Nothing open to the internet";
  const on = rows.filter((r) => r.enabled).length;
  return [`${rows.length} ${rows.length === 1 ? "forward" : "forwards"}`, `${on} on`, publicIp && `open on ${publicIp}`].filter(Boolean).join(", ");
}
