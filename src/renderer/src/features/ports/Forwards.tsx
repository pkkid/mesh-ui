/**
 * Port forwards table: name, device, internal IP, external and internal
 * port or range, protocol and whether it is on. Read-only: the Enabled
 * switch, Add and the row menu are "Coming soon". Disabled forwards are dimmed.
 */
import { ArrowRight, Plus } from "lucide-react";

import type { QueryState } from "~/app/useCommand";
import { Card, Empty, Section } from "~/components/ui/card";
import { ComingSoonButton, SectionError } from "~/components/ui/page";
import { cn } from "~/lib/utils";
import type { ForwardList } from "../../../../core/commands/routing";

import { type Lookup, ProtocolTag, RowMenu } from "./Reservations";

const th = "px-3 py-2 font-normal";
const td = "px-3 py-2.5";

/** A read-only switch showing whether a forward is on. */
function EnabledSwitch({ on, label }: { on: boolean; label: string }) {
  return (
    <span title="Coming soon" className="inline-flex align-middle">
      <span
        role="switch"
        aria-checked={on}
        aria-disabled
        aria-label={label}
        className={cn("relative inline-block h-[18px] w-8 rounded-full border opacity-80 transition-colors", on ? "border-primary bg-primary" : "bg-muted")}
      >
        <span className={cn("absolute top-px size-3.5 rounded-full shadow-xs", on ? "left-[15px] bg-primary-foreground" : "left-px bg-background")} />
      </span>
    </span>
  );
}

export function Forwards({ query, lookup, publicIp }: { query: QueryState<ForwardList>; lookup: Lookup; publicIp: string | null }) {
  const rows = query.data?.forwards;
  const tools = (
    <ComingSoonButton size="sm">
      <Plus />
      Add port forward
    </ComingSoonButton>
  );

  return (
    <Section title="Port forwards" subtitle={publicIp ? `Open to the internet on ${publicIp}` : "Open to the internet"} tools={tools}>
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
                          <EnabledSwitch on={f.enabled} label={`${f.name || "Forward"} enabled`} />
                        </td>
                        <td className={cn(td, "w-8 py-1 text-right")}>
                          <RowMenu label={`Options for ${f.name || "forward"}`} />
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
