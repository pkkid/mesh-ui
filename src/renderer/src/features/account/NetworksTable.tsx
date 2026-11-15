/**
 * App & account, Networks on this account (docs/ux/pages/app-account.md,
 * Layout 4): every network from `network.list` with its name, nickname,
 * "current" or "Shared with you", role, eeros and status (`Online`,
 * `Offline 2d`). A row click runs `network.select`, like the sidebar's
 * switcher; a successful select refetches every query.
 *
 * The list shares the switcher's 60 s `network.list` poll (same query, one
 * request). eero sends no owner name for a shared network, so a network you
 * administer reads "Shared with you" instead of "shared by ...".
 */
import { House } from "lucide-react";

import { useCommand, useQuery } from "~/app/useCommand";
import { Badge } from "~/components/ui/badge";
import { Card, Empty, Section } from "~/components/ui/card";
import { SectionError, useNow } from "~/components/ui/page";
import { networkStatus, Status } from "~/components/ui/status";
import { cn } from "~/lib/utils";
import type { NetworkSummary } from "../../../../core/model";
import { offlineFor } from "./sessionAndNetworks";

const th = "px-3 py-2 font-normal";
const td = "px-3 py-2.5";

/** The muted line under the title: the Wi-Fi name when a nickname is the title, ISP, then "Shared with you" or "current". */
function detailLine(n: NetworkSummary): string {
  const parts = [n.nickname ? n.name : null, n.isp].filter((p): p is string => Boolean(p));
  if (n.role === "admin") parts.push("Shared with you");
  if (n.selected) parts.push("current");
  return parts.length ? parts.join(" · ") : "-";
}

const roleLabel = (n: NetworkSummary) => (n.role === "owner" ? "Owner" : n.role === "admin" ? "Admin" : "-");

export function NetworksTable({ id }: { id?: string }) {
  const list = useQuery<NetworkSummary[]>("network.list", undefined, { poll: 60 });
  const select = useCommand<{ network: string }>("network.select");
  const now = useNow();
  const rows = list.data;

  const choose = (n: NetworkSummary) => {
    if (n.selected || select.running) return;
    void select.run({ network: n.id });
  };

  return (
    <Section id={id} title="Networks on this account" subtitle="Every network you own or help run">
      {list.error && !rows ? (
        <SectionError what="networks" error={list.error} onRetry={() => void list.refetch()} />
      ) : rows && rows.length === 0 ? (
        <Card>
          <Empty>This account has no eero networks yet.</Empty>
        </Card>
      ) : (
        <Card>
          <table className={cn("w-full border-collapse text-[13px] transition-opacity", (list.fading || select.running) && "opacity-40")} aria-label="Networks on this account">
            <thead>
              <tr className="border-b text-left text-muted-foreground text-xs">
                <th className={cn(th, "w-1/2")}>Network</th>
                <th className={th}>Role</th>
                <th className={cn(th, "text-right")}>eeros</th>
                <th className={cn(th, "text-right")}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows
                ? rows.map((n) => {
                    const s = networkStatus(n.status);
                    return (
                      <tr
                        key={n.id}
                        aria-current={n.selected || undefined}
                        tabIndex={n.selected ? -1 : 0}
                        title={n.selected ? "The network you are managing" : `Switch to ${n.nickname ?? n.name}`}
                        onClick={() => choose(n)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            choose(n);
                          }
                        }}
                        className={cn(
                          "border-border/50 border-b outline-none last:border-b-0 focus-visible:bg-muted/50",
                          n.selected ? "bg-muted/30" : "cursor-pointer hover:bg-muted/50",
                        )}
                      >
                        <td className={td}>
                          <div className="flex min-w-0 items-center gap-2.5">
                            <div aria-hidden className="grid size-7 shrink-0 place-items-center rounded-lg border bg-muted text-muted-foreground">
                              <House className="size-3.5" />
                            </div>
                            <div className="min-w-0">
                              <div className="truncate font-medium">{n.nickname ?? n.name}</div>
                              <div className="truncate text-2xs text-muted-foreground">{detailLine(n)}</div>
                            </div>
                          </div>
                        </td>
                        <td className={td}>
                          <Badge variant="secondary">{roleLabel(n)}</Badge>
                        </td>
                        <td className={cn(td, "text-right text-xs tabular-nums")}>{n.eeroCount ?? <span className="text-muted-foreground">-</span>}</td>
                        <td className={cn(td, "text-right")}>
                          <Status tone={s.tone}>{n.status === "offline" ? offlineFor(n.lastSeen, now) : s.label}</Status>
                        </td>
                      </tr>
                    );
                  })
                : Array.from({ length: 2 }, (_, i) => (
                    <tr key={i} className="border-border/50 border-b last:border-b-0">
                      <td className="h-[53px]" colSpan={4} />
                    </tr>
                  ))}
            </tbody>
          </table>
        </Card>
      )}
      {select.error && <div className="text-destructive-foreground text-xs">Couldn't switch networks. {select.error.message}</div>}
    </Section>
  );
}
