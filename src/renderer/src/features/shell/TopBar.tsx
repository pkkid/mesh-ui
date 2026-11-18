/**
 * The 44px strip at the top of the main pane (docs/ux/overview.md#topbar).
 * It doubles as the window titlebar (`drag-region`), so every control in it
 * is `no-drag` and it leaves room for native window controls on the right.
 *
 * Left: crumbs (parent page link, then the page title), nothing after it.
 * Right: an actions slot for the page, Refresh (every query on screen, past
 * the engine cache; also Ctrl+R / Cmd+R / F5 from main), search,
 * notifications and the light/dark toggle. Pages fill the slots with
 * <TopBarTitle> and <TopBarActions>, which portal into the bar, and report
 * how fresh their data is with `useTopBarUpdated(at)`, which Refresh's
 * tooltip shows ("Refresh (Ctrl+R) · Updated 2 min ago").
 */
import { Moon, RefreshCw, Search, Sun } from "lucide-react";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { Link, useLocation } from "~/app/router";
import { refreshAll, useQuery, useRefresh, useUpdating } from "~/app/useCommand";
import { routeById } from "~/app/routes";
import { useNow } from "~/components/ui/page";
import { Bell } from "~/features/notifications/Bell";
import { openPalette } from "~/features/palette/CommandPalette";
import { toggleAppearance, useResolvedAppearance } from "~/lib/themes";
import { cn } from "~/lib/utils";

import type { NetworkSummary } from "../../../../core/model";
import { networkTitle } from "./NetworkSwitcher";

import { formatRelative } from "../../../../core/format";

/** A crumb that links somewhere: muted, foreground on hover, as T3 Code's project crumb. */
const CRUMB_LINK =
  "no-drag min-w-0 truncate rounded-sm transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring";

type SlotName = "title" | "actions";
type Slots = Readonly<Record<SlotName, HTMLElement | null>>;

const SlotsContext = createContext<Slots>({ title: null, actions: null });
const RegisterContext = createContext<(name: SlotName, el: HTMLElement | null) => void>(() => {});

/** Holds the slot elements; wraps the main pane so pages can portal into the bar. */
export function TopBarProvider({ children }: { children: ReactNode }) {
  const [slots, setSlots] = useState<Slots>({ title: null, actions: null });
  const register = useCallback(
    (name: SlotName, el: HTMLElement | null) => setSlots((s) => (s[name] === el ? s : { ...s, [name]: el })),
    [],
  );
  return (
    <RegisterContext.Provider value={register}>
      <SlotsContext.Provider value={slots}>{children}</SlotsContext.Provider>
    </RegisterContext.Provider>
  );
}

function Slot({ name, children }: { name: SlotName; children: ReactNode }) {
  const el = useContext(SlotsContext)[name];
  return el ? createPortal(children, el) : null;
}

/** Replaces the last crumb (the route title), e.g. a device name on Device detail. */
export const TopBarTitle = ({ children }: { children: ReactNode }) => <Slot name="title">{children}</Slot>;
/** Small page buttons before the search field: Share Wi-Fi, Prev and Next. */
export const TopBarActions = ({ children }: { children: ReactNode }) => <Slot name="actions">{children}</Slot>;

export function TopBar() {
  const register = useContext(RegisterContext);
  const refs = useMemo(
    () => ({
      title: (el: HTMLElement | null) => register("title", el),
      actions: (el: HTMLElement | null) => register("actions", el),
    }),
    [register],
  );
  const { route } = useLocation();
  const parent = route.parent ? routeById(route.parent) : null;
  // Shares the switcher's network.list entry (it does the polling). Settings and
  // Account are about the app and the eero account, not a network, so no crumb.
  const networks = useQuery<NetworkSummary[]>("network.list");
  const current = networks.data?.find((n) => n.selected);
  const networkName = current && route.id !== "settings" && route.id !== "account" ? networkTitle(current) : null;
  const appearance = useResolvedAppearance();
  const isMac = navigator.platform.startsWith("Mac");
  const themeLabel = appearance === "dark" ? "Switch to light" : "Switch to dark";

  return (
    <header className="drag-region flex h-(--titlebar-height) shrink-0 items-center gap-3 ps-5 pe-[calc(var(--titlebar-inset-right)+0.875rem)]">
      {/* Crumbs as T3 Code's WorkspaceBreadcrumb: network / parent / page, all
          text-sm font-medium; earlier crumbs muted (foreground on hover), the
          separator in icon-muted, the page itself in the foreground. */}
      <nav aria-label="Breadcrumb" className="min-w-0">
        <ol className="m-0 flex min-w-0 list-none items-center gap-3 p-0 font-medium text-sm">
          {networkName && (
            <>
              <li className="flex min-w-0 shrink items-center text-muted-foreground">
                <Link to={routeById("overview").path} className={CRUMB_LINK}>
                  {networkName}
                </Link>
              </li>
              <li aria-hidden className="flex shrink-0 items-center text-icon-muted">/</li>
            </>
          )}
          {parent && (
            <>
              <li className="flex shrink-0 items-center text-muted-foreground">
                <Link to={parent.path} className={CRUMB_LINK}>
                  {parent.title}
                </Link>
              </li>
              <li aria-hidden className="flex shrink-0 items-center text-icon-muted">/</li>
            </>
          )}
          <li aria-current="page" className="flex min-w-0 items-center text-foreground">
            <h1 className="flex min-w-0 font-medium text-sm">
              <span ref={refs.title} className="peer truncate empty:hidden" />
              <span className="truncate peer-[:not(:empty)]:hidden">{route.title}</span>
            </h1>
          </li>
        </ol>
      </nav>

      <div className="no-drag ms-auto flex items-center gap-1">
        <div ref={refs.actions} className="flex items-center gap-1 empty:hidden" />
        <button
          type="button"
          onClick={() => openPalette()}
          aria-label="Search or run a command"
          // 15px on top of the 4px gap (plus Refresh's 7px glyph padding), about 26px to the Refresh glyph, set by eye against the native window controls.
          className="ms-2 me-[15px] flex h-7 w-[260px] cursor-pointer items-center gap-2 rounded-[var(--control-radius)] border bg-card px-2.5 text-[12.5px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5"
        >
          <Search />
          <span>Search or run a command</span>
          <kbd className="ms-auto rounded-[5px] border border-input px-1.5 font-mono text-[10.5px]">
            {isMac ? "⌘K" : "Ctrl K"}
          </kbd>
        </button>
        <RefreshButton isMac={isMac} />
        <Bell className={iconButton} />
        <button type="button" onClick={toggleAppearance} title={themeLabel} aria-label={themeLabel} className={iconButton}>
          {appearance === "dark" ? <Sun /> : <Moon />}
        </button>
      </div>
    </header>
  );
}

// How fresh the page's data is (its main query's `fetchedAt`), for Refresh's tooltip.
let updatedAt: number | null = null;
const updatedListeners = new Set<() => void>();
const setUpdatedAt = (at: number | null) => {
  if (updatedAt === at) return;
  updatedAt = at;
  updatedListeners.forEach((l) => l());
};

/**
 * Reports when the page's data was last fetched; Refresh's tooltip says
 * "Updated 2 min ago". Cleared when the page unmounts.
 */
export function useTopBarUpdated(at: number | null): void {
  useEffect(() => {
    setUpdatedAt(at);
    return () => setUpdatedAt(null);
  }, [at]);
}

function useUpdatedAt(): number | null {
  return useSyncExternalStore(
    (l) => (updatedListeners.add(l), () => updatedListeners.delete(l)),
    () => updatedAt,
  );
}

/**
 * Refetches every query on screen, skipping the engine cache. Clicks while it
 * runs are ignored. Main sends the same request for Ctrl+R / Cmd+R and F5
 * (`window.mesh.onRefresh`) instead of reloading.
 *
 * It is also the app's only "updating" cue: the icon spins while a refresh
 * runs or any background refetch (a poll, a re-read after a write) has taken
 * longer than 150 ms, so sections never dim for them. With reduced motion it
 * does not spin; it turns foreground-coloured instead.
 */
function RefreshButton({ isMac }: { isMac: boolean }) {
  const { refreshing, refresh } = useRefresh();
  const updating = useUpdating();
  const busy = refreshing || updating;
  useEffect(() => {
    const mesh = (window as { mesh?: { onRefresh?: (l: () => void) => () => void } }).mesh;
    return typeof mesh?.onRefresh === "function" ? mesh.onRefresh(() => void refreshAll()) : undefined;
  }, []);
  const at = useUpdatedAt();
  const now = useNow(15_000);
  const shortcut = `Refresh (${isMac ? "⌘R" : "Ctrl+R"})`;
  const title = at === null ? shortcut : `${shortcut} · Updated ${formatRelative(new Date(at).toISOString(), now)}`;
  return (
    <button
      type="button"
      onClick={() => void refresh()}
      disabled={refreshing}
      aria-busy={busy}
      title={busy ? "Updating..." : title}
      aria-label="Refresh"
      className={cn(iconButton, "disabled:cursor-default disabled:hover:bg-transparent")}
    >
      <RefreshCw className={cn(busy && "motion-safe:animate-spin motion-reduce:text-foreground")} />
    </button>
  );
}

const iconButton = cn(
  "relative grid size-[30px] cursor-pointer place-items-center rounded-[var(--control-radius)] text-muted-foreground outline-none",
  "hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4",
);
