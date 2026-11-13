/**
 * The sidebar (docs/ux/overview.md#sidebar): app mark, network switcher,
 * the Network and Settings nav groups with counts, and the signed-in user.
 * Counts come from `network.get`; items the network cannot use (Profiles and
 * Reservations & ports in bridge mode) are hidden, not greyed out.
 */
import { Popover } from "@base-ui/react/popover";
import { LogOut, Wifi } from "lucide-react";

import { Link, useLocation } from "~/app/router";
import { ROUTES, type RouteDef } from "~/app/routes";
import { useCommand, useQuery } from "~/app/useCommand";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { hue } from "~/lib/chartColors";
import { cn } from "~/lib/utils";
import { formatCount } from "../../../../core/format";
import type { Account, AuthStatus, Network, NetworkSummary } from "../../../../core/model";
import { NetworkSwitcher } from "./NetworkSwitcher";

const GROUPS = [
  { id: "network", label: "Network" },
  { id: "settings", label: "Settings" },
] as const;

export function Sidebar() {
  const { route } = useLocation();
  const network = useQuery<Network>("network.get", undefined, { poll: true });
  const auth = useQuery<AuthStatus>("auth.status");
  const bridged = network.data?.connectionMode === "bridged" || network.data?.connectionMode === "ipPassthrough";
  const active = route.parent ?? route.id;

  return (
    <aside className="flex w-(--sidebar-width) shrink-0 flex-col border-sidebar-border border-e bg-sidebar text-sidebar-foreground">
      <div className="drag-region flex h-(--titlebar-height) shrink-0 items-center gap-[9px] ps-[calc(var(--titlebar-inset-left)+1rem)] pe-4">
        <div className="grid size-[22px] place-items-center rounded-[7px] bg-primary text-primary-foreground">
          <Wifi className="size-[13px]" strokeWidth={2.5} />
        </div>
        <span className="font-semibold text-sm tracking-tight">Mesh UI</span>
        {auth.data?.backend === "demo" && <Badge className="border text-2xs">Demo</Badge>}
      </div>

      <NetworkSwitcher />

      <nav aria-label="Pages" className="flex-1 overflow-y-auto px-2 pb-2">
        {GROUPS.map((group) => (
          <div key={group.id}>
            <div className="px-2.5 pt-3 pb-[5px] font-semibold text-3xs text-muted-foreground/70 uppercase tracking-widest">
              {group.label}
            </div>
            {ROUTES.filter((r) => r.nav === group.id && !(bridged && r.natOnly)).map((r) => (
              <NavItem
                key={r.id}
                route={r}
                active={r.id === active}
                count={r.count ? network.data?.counts[r.count] : undefined}
              />
            ))}
          </div>
        ))}
      </nav>

      <UserFooter />
    </aside>
  );
}

function NavItem({ route, active, count }: { route: RouteDef; active: boolean; count: number | null | undefined }) {
  const Icon = route.icon;
  return (
    <Link
      to={route.path}
      aria-current={active ? "page" : undefined}
      data-active={active || undefined}
      className={cn(
        "flex h-8 items-center gap-[9px] rounded-[var(--control-radius)] px-2.5 text-[13.5px] text-sidebar-foreground outline-none",
        "hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-ring",
        "data-active:bg-sidebar-row-selected data-active:font-medium data-active:text-foreground data-active:shadow-[0_1px_0_rgb(0_0_0/4%),inset_0_0_0_1px_var(--color-border)]",
      )}
    >
      <Icon className={cn("size-4 shrink-0", active ? "text-foreground" : "text-muted-foreground")} />
      <span className="min-w-0 flex-1 truncate">{route.title}</span>
      {count !== undefined && count !== null && (
        <span className="text-2xs text-muted-foreground tabular-nums">{formatCount(count)}</span>
      )}
    </Link>
  );
}

function initials(name: string | null | undefined): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "-";
  return words
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function UserFooter() {
  const account = useQuery<Account>("account.get");
  // Shares the switcher's network.list entry, which does the polling.
  const networks = useQuery<NetworkSummary[]>("network.list");
  const logout = useCommand("auth.logout");
  const current = networks.data?.find((n) => n.selected) ?? networks.data?.[0];
  const role = current?.role === "owner" ? "Owner" : current?.role === "admin" ? "Admin" : "-";
  const name = account.data?.name ?? null;

  return (
    <div className="border-sidebar-border border-t p-2">
      <div className="flex items-center gap-[9px] rounded-[var(--control-radius)] px-2 py-1.5">
        <div
          aria-hidden
          className="grid size-[26px] shrink-0 place-items-center rounded-full font-semibold text-[11px] text-background"
          style={{ background: name ? hue("orange") : "var(--color-muted-foreground)" }}
        >
          {initials(name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-[13px]">{name ?? "-"}</div>
          <div className="text-2xs text-muted-foreground">{role}</div>
        </div>
        <Popover.Root>
          <Popover.Trigger
            aria-label="Sign out"
            title="Sign out"
            className="grid size-7 cursor-pointer place-items-center rounded-[var(--control-radius)] text-muted-foreground outline-none hover:bg-sidebar-row-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <LogOut className="size-3.5" />
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Positioner side="top" align="end" sideOffset={6} className="z-50">
              <Popover.Popup className="w-64 rounded-xl border bg-popover p-3 text-popover-foreground shadow-lg outline-none">
                <Popover.Title className="font-medium text-sm">Sign out of Mesh UI?</Popover.Title>
                <Popover.Description className="mt-1 text-muted-foreground text-xs">
                  Your networks keep running.
                </Popover.Description>
                {logout.error && <div className="mt-2 text-destructive-foreground text-xs">{logout.error.message}</div>}
                <div className="mt-3 flex justify-end gap-2">
                  <Popover.Close render={<Button size="sm" variant="ghost" />}>Cancel</Popover.Close>
                  <Button size="sm" variant="outline" disabled={logout.running} onClick={() => void logout.run({})}>
                    <LogOut />
                    Sign out
                  </Button>
                </div>
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
      </div>
    </div>
  );
}
