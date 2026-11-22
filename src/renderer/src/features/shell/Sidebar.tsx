/**
 * The sidebar (docs/ux/overview.md#sidebar): app mark, network switcher,
 * the Network and Settings nav groups with counts, and the signed-in user
 * (name and role, a button that opens Account) with a sign-out icon.
 * Counts come from `network.get`; items the network cannot use (Profiles and
 * Reservations & ports in bridge mode) are hidden, not greyed out.
 */
import { Popover } from "@base-ui/react/popover";
import { ArrowLeft, ArrowRight, LogOut } from "lucide-react";

import { type HistoryDirection, Link, navigateHistory, useCanNavigateHistory, useLocation } from "~/app/router";
import { useShortcutText, withKeys } from "~/lib/shortcuts";
import { ROUTES, type RouteDef, routeById } from "~/app/routes";
import { useCommand, useQuery } from "~/app/useCommand";
import { AppIcon } from "~/components/mesh/AppIcon";
import { AppWordmark } from "~/components/mesh/AppWordmark";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { formatCount } from "../../../../core/format";
import type { Account, AuthStatus, Network, NetworkSummary } from "../../../../core/model";
import { NetworkSwitcher } from "./NetworkSwitcher";
import { UpdateChip } from "./UpdateChip";

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
    <aside data-app-sidebar="" className="flex w-(--sidebar-width) shrink-0 flex-col border-e bg-sidebar surface-grain text-sidebar-foreground">
      {/* T3 Code's SidebarChromeHeader: brand, then Back and Forward, then the pill; the pill wraps out of sight when it does not fit. */}
      <div className="drag-region flex h-(--titlebar-height) shrink-0 items-center ps-[calc(var(--titlebar-inset-left)+1rem)] pe-3">
        <div className="flex h-8 min-w-0 flex-1 flex-wrap content-start items-center gap-x-2 overflow-hidden py-0.5">
          <div className="flex shrink-0 items-center gap-1">
            <div className="flex h-7 min-w-0 items-center gap-[9px]">
              <AppIcon className="size-[22px]" />
              <AppWordmark className="text-sm" />
            </div>
            <div className="flex items-center">
              <HistoryButton direction="back" />
              <HistoryButton direction="forward" />
            </div>
          </div>
          {auth.data?.backend === "demo" && (
            <div className="ml-1 flex h-7 items-center">
              <Badge className="border text-2xs">Demo</Badge>
            </div>
          )}
        </div>
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

      <UserFooter active={active === "account"} />
    </aside>
  );
}

/** T3 Code's HistoryNavigationButton: a ghost icon button, disabled when there is nowhere to go. */
function HistoryButton({ direction }: { direction: HistoryDirection }) {
  const enabled = useCanNavigateHistory(direction);
  const label = direction === "back" ? "Go back" : "Go forward";
  const keys = useShortcutText(direction === "back" ? "nav.back" : "nav.forward");
  const Icon = direction === "back" ? ArrowLeft : ArrowRight;
  return (
    <Button
      aria-label={label}
      title={withKeys(label, keys)}
      // The nav icons' dimmer gray, not the ghost button's foreground; full sidebar text on hover.
      className="no-drag text-(--sidebar-icon-color) hover:text-sidebar-foreground"
      disabled={!enabled}
      onClick={() => navigateHistory(direction)}
      size="icon-sm"
      variant="ghost"
    >
      <Icon className="size-3.5" />
    </Button>
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
        // T3 Code's SidebarMenuButton: muted at rest, full sidebar text on hover and when selected.
        "group/nav flex h-8 items-center gap-[9px] rounded-[var(--control-radius)] px-2.5 font-medium text-[13.5px] text-sidebar-muted-foreground/80 outline-none",
        "hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring",
        "data-active:bg-sidebar-row-selected data-active:text-sidebar-foreground",
      )}
    >
      {/* -translate-y-px: centred by the box, the glyphs read 1px low beside the text. */}
      <Icon className={cn("size-4 shrink-0 -translate-y-px", active ? "text-sidebar-foreground" : "text-(--sidebar-icon-color) group-hover/nav:text-sidebar-foreground")} />
      <span className="min-w-0 flex-1 truncate">{route.title}</span>
      {count !== undefined && count !== null && (
        <span className="text-2xs text-muted-foreground tabular-nums">{formatCount(count)}</span>
      )}
    </Link>
  );
}

/**
 * The signed-in user's name and role, a button that opens Account (with the
 * nav rows' hover and selected states). Sign out is a sibling icon on the
 * right, so it never navigates.
 */
function UserFooter({ active }: { active: boolean }) {
  const account = useQuery<Account>("account.get");
  // Shares the switcher's network.list entry, which does the polling.
  const networks = useQuery<NetworkSummary[]>("network.list");
  const logout = useCommand("auth.logout");
  const current = networks.data?.find((n) => n.selected) ?? networks.data?.[0];
  const role = current?.role === "owner" ? "Owner" : current?.role === "admin" ? "Admin" : "-";
  const name = account.data?.name ?? null;

  return (
    <div className="p-2">
      <UpdateChip />
      {/* The whole row is the Account button: the link's ::after covers it, and
          sign out sits above that layer, so the markup never nests a button in a link.
          The row drops its hover while the pointer is on sign out, and sign out takes a
          foreground mix of its own, so it reads as its own target in every theme (#352). */}
      <div
        data-active={active || undefined}
        className="relative flex items-center gap-1 rounded-[var(--control-radius)] py-1.5 ps-2.5 pe-1.5 text-sidebar-foreground not-data-active:hover:not-has-[button:hover]:bg-sidebar-row-hover has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring data-active:bg-sidebar-row-selected"
      >
        <Link
          to={routeById("account").path}
          aria-current={active ? "page" : undefined}
          title="Account"
          className="min-w-0 flex-1 outline-none after:absolute after:inset-0 after:rounded-[inherit]"
        >
          <div className="truncate font-medium text-sm">{name ?? "-"}</div>
          <div className="text-muted-foreground text-xs">{role}</div>
        </Link>
        <Popover.Root>
          <Popover.Trigger
            aria-label="Sign out"
            title="Sign out"
            className="relative z-10 grid size-7 cursor-pointer place-items-center rounded-[var(--control-radius)] text-muted-foreground outline-none hover:bg-foreground/8 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
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
