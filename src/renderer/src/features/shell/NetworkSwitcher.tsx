/**
 * The network row at the top of the sidebar and its popover
 * (docs/ux/overview.md#network-switcher). Rows come from `network.list`;
 * choosing one runs `network.select` and refetches every query. With one
 * network the row is not interactive and hides its chevrons. The popover is
 * the width of the row, and each of its rows shows what the row shows: status
 * dot, name and the same status line. The name is the network nickname when
 * one is set, with the Wi-Fi name leading the line under it (#270).
 */
import { Popover } from "@base-ui/react/popover";
import { ChevronsUpDown, Settings } from "lucide-react";
import { useEffect, useState } from "react";

import { Link, pathFor } from "~/app/router";
import { useCommand, useQuery } from "~/app/useCommand";
import { networkStatus, StatusDot } from "~/components/ui/status";
import { cn } from "~/lib/utils";
import { formatRelative } from "../../../../core/format";
import type { NetworkSummary } from "../../../../core/model";

/** The nickname when set, else the Wi-Fi name. */
/** A network as people know it: its nickname, else its name. The topbar crumb uses it too. */
export const networkTitle = (n: NetworkSummary): string => n.nickname ?? n.name;
const title = networkTitle;

/**
 * "Online · Ziply Fiber" under the name, in the sidebar row and in every
 * popover row. Under a nickname the Wi-Fi name leads it instead of the ISP:
 * "Maple Street · Online".
 */
function rowLine(n: NetworkSummary): string {
  const status = networkStatus(n.status).label;
  const wifi = n.nickname && n.nickname !== n.name ? n.name : null;
  if (n.status === "offline" && n.lastSeen) return [wifi, `${status} · last seen ${formatRelative(n.lastSeen, Date.now())}`].filter(Boolean).join(" · ");
  if (wifi) return `${wifi} · ${status}`;
  return n.isp ? `${status} · ${n.isp}` : status;
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
        <div className="truncate font-medium text-sidebar-foreground text-sm">{current ? title(current) : "No network"}</div>
        <div className="truncate text-muted-foreground text-xs">
          {current ? rowLine(current) : list.error ? "Not connected" : "-"}
        </div>
      </div>
      {many && <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />}
    </>
  );
  const rowClass =
    "mx-2.5 mt-1 mb-2 flex items-center gap-2.5 rounded-[10px] bg-sidebar-row-selected px-2.5 py-[9px] outline-none focus-visible:ring-2 focus-visible:ring-ring";

  if (!many) {
    return <div className={rowClass}>{row}</div>;
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger className={cn(rowClass, "cursor-pointer hover:bg-sidebar-row-active")} aria-label="Switch network">
        {row}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={4} className="z-50">
          <Popover.Popup className="no-drag w-(--anchor-width) rounded-xl border border-sidebar-border bg-sidebar surface-grain p-1 text-sidebar-foreground text-xs shadow-lg outline-none">
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
                      "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-start outline-none hover:bg-sidebar-row-hover focus-visible:bg-sidebar-row-hover",
                      selected && "bg-sidebar-row-selected hover:bg-sidebar-row-selected",
                    )}
                  >
                    <StatusDot tone={s.tone} className="size-2" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-sm">{title(n)}</div>
                      <div className="truncate text-muted-foreground text-xs">{rowLine(n)}</div>
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="mt-1 border-sidebar-border border-t pt-1">
              <Link
                to={pathFor("account", { section: "networks" })}
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-muted-foreground hover:bg-sidebar-row-hover hover:text-foreground [&_svg]:size-3.5"
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
