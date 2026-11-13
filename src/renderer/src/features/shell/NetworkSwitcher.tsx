/**
 * The network row at the top of the sidebar and its popover
 * (docs/ux/overview.md#network-switcher). Rows come from `network.list`;
 * choosing one runs `network.select` and refetches every query. With one
 * network the row is not interactive and hides its chevrons.
 */
import { Popover } from "@base-ui/react/popover";
import { ChevronsUpDown, Settings } from "lucide-react";
import { useEffect, useState } from "react";

import { Link } from "~/app/router";
import { routeById } from "~/app/routes";
import { useCommand, useQuery } from "~/app/useCommand";
import { Badge } from "~/components/ui/badge";
import { networkStatus, StatusDot } from "~/components/ui/status";
import { cn } from "~/lib/utils";
import { formatRelative } from "../../../../core/format";
import type { NetworkSummary } from "../../../../core/model";

/** "Online · Ziply Fiber" under the name in the sidebar row. */
function rowLine(n: NetworkSummary): string {
  const status = networkStatus(n.status).label;
  if (n.status === "offline" && n.lastSeen) return `${status} · last seen ${formatRelative(n.lastSeen, Date.now())}`;
  return n.isp ? `${status} · ${n.isp}` : status;
}

/** "4 eeros · 31 devices online", "last seen 2 days ago" or "update available" in the popover. */
function detailLine(n: NetworkSummary): string {
  if (n.status === "offline") return n.lastSeen ? `last seen ${formatRelative(n.lastSeen, Date.now())}` : "Offline";
  const parts: string[] = [];
  if (n.eeroCount !== null) parts.push(`${n.eeroCount} ${n.eeroCount === 1 ? "eero" : "eeros"}`);
  if (n.devicesOnline !== null) parts.push(`${n.devicesOnline} ${n.devicesOnline === 1 ? "device" : "devices"} online`);
  if (n.updateAvailable) parts.push("update available");
  return parts.join(" · ") || "-";
}

export function NetworkSwitcher() {
  const list = useQuery<NetworkSummary[]>("network.list", undefined, { poll: 60 });
  const select = useCommand<{ network: string }>("network.select");
  const [open, setOpen] = useState(false);
  const networks = list.data ?? [];
  const current = networks.find((n) => n.selected) ?? networks[0] ?? null;
  const many = networks.length > 1;

  // Ctrl+Shift+N opens the switcher (docs/ux/overview.md#keyboard-shortcuts).
  useEffect(() => {
    if (!many) return;
    const onKey = (e: KeyboardEvent) => {
      const mod = navigator.platform.startsWith("Mac") ? e.metaKey : e.ctrlKey;
      if (mod && e.shiftKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [many]);

  const choose = async (n: NetworkSummary) => {
    setOpen(false);
    if (n.id === current?.id) return;
    // A successful network.select refetches every query (useCommand invalidates all).
    await select.run({ network: n.id });
  };

  const status = current ? networkStatus(current.status) : null;
  const row = (
    <>
      <StatusDot tone={status?.tone ?? "muted"} className="size-2" />
      <div className="min-w-0 flex-1 text-start">
        <div className="truncate font-medium text-[13px] text-sidebar-foreground">{current?.name ?? "No network"}</div>
        <div className="truncate text-2xs text-muted-foreground">
          {current ? rowLine(current) : list.error ? "Not connected" : "-"}
        </div>
      </div>
      {many && <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />}
    </>
  );
  const rowClass =
    "mx-2.5 mt-1 mb-2 flex items-center gap-2.5 rounded-[10px] border bg-card px-2.5 py-[9px] outline-none focus-visible:ring-2 focus-visible:ring-ring";

  if (!many) {
    return <div className={rowClass}>{row}</div>;
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger className={cn(rowClass, "cursor-pointer hover:bg-sidebar-row-hover")} aria-label="Switch network">
        {row}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={4} className="z-50">
          <Popover.Popup className="no-drag w-[calc(var(--anchor-width)+6rem)] max-w-[22rem] rounded-xl border bg-popover p-1 text-popover-foreground text-xs shadow-lg outline-none">
            <div role="group" aria-label="Networks">
              {networks.map((n) => {
                const s = networkStatus(n.status);
                const selected = n.id === current?.id;
                return (
                  <button
                    key={n.id}
                    type="button"
                    aria-current={selected || undefined}
                    onClick={() => void choose(n)}
                    className={cn(
                      "flex w-full cursor-pointer items-start gap-2.5 rounded-lg px-2.5 py-2 text-start outline-none hover:bg-muted/60 focus-visible:bg-muted/60",
                      selected && "bg-muted",
                    )}
                  >
                    <StatusDot tone={s.tone} className="mt-1.5 size-2" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium text-[13px]">{n.name}</span>
                        {n.role && <Badge className="h-[18px] border px-1.5 text-2xs">{n.role === "owner" ? "Owner" : "Admin"}</Badge>}
                      </div>
                      <div className="mt-0.5 truncate text-muted-foreground">
                        {s.label} · {detailLine(n)}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="mt-1 border-t pt-1">
              <Link
                to={routeById("account").path}
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-muted-foreground hover:bg-muted/60 hover:text-foreground [&_svg]:size-3.5"
              >
                <Settings />
                Manage networks
              </Link>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
