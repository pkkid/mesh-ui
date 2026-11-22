/**
 * The 44px strip at the top of the main pane (docs/ux/overview.md#topbar).
 * It doubles as the window titlebar (`drag-region`), so every control in it
 * is `no-drag` and it leaves room for native window controls on the right.
 *
 * Left: crumbs (parent page link, then the page title), nothing after it.
 * Right: an actions slot for the page, Refresh (every query on screen, past
 * the engine cache; also its shortcut, F5 by default), search,
 * notifications and the light/dark toggle. Pages fill the slots with
 * <TopBarTitle> and <TopBarActions>, which portal into the bar, and report
 * how fresh their data is with `useTopBarUpdated(at)`, which Refresh's
 * tooltip shows ("Refresh (F5) · Updated 2m ago"), and on a second line
 * how often the page updates on its own ("Updates every minute"; a page whose
 * main data polls slower says so with `useTopBarPollEvery(seconds)`).
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
import { isMac, useBinding, useShortcut, useShortcutText } from "~/lib/shortcuts";
import { toggleAppearance, useResolvedAppearance } from "~/lib/themes";
import { cn } from "~/lib/utils";

import type { NetworkSummary } from "../../../../core/model";
import { networkTitle } from "./NetworkSwitcher";

import { formatRelative } from "../../../../core/format";
import { comboKeys } from "@shared/shortcuts";

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
  const paletteKeys = comboKeys(useBinding("palette.open"), isMac()).join(isMac() ? "" : " ");
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
              {/* Detail pages (a device, eero or profile) show nothing until the page names
                  itself, rather than flashing the generic "Device" first. */}
              {!parent && <span className="truncate peer-[:not(:empty)]:hidden">{route.title}</span>}
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
          <kbd className="ms-auto inline-flex h-5 items-center rounded-[5px] border border-input px-1.5 font-kbd text-[10.5px] leading-none">
            {paletteKeys}
          </kbd>
        </button>
        <RefreshButton />
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
 * "Updated 2m ago". Cleared when the page unmounts.
 */
/** How often the page's main data updates on its own, in seconds; most poll every minute (src/core/poll.ts). */
const DEFAULT_POLL_SEC = 60;
let pollEvery = DEFAULT_POLL_SEC;
const pollListeners = new Set<() => void>();
function setPollEvery(sec: number) {
  pollEvery = sec;
  for (const l of pollListeners) l();
}

/** A page whose main data polls slower than every minute (Updates & admins, every 15 minutes) says so for Refresh's tooltip. */
export function useTopBarPollEvery(seconds: number): void {
  useEffect(() => {
    setPollEvery(seconds);
    return () => setPollEvery(DEFAULT_POLL_SEC);
  }, [seconds]);
}

function usePollEvery(): number {
  return useSyncExternalStore(
    (l) => (pollListeners.add(l), () => pollListeners.delete(l)),
    () => pollEvery,
  );
}

/** "Updates every minute"; any other interval short, "Updates every 15m". */
const everyLine = (sec: number) => {
  const min = Math.round(sec / 60);
  return min <= 1 ? "Updates every minute" : `Updates every ${min}m`;
};

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
 * runs are ignored. Its shortcut (F5 by default, Settings > Keyboard
 * shortcuts) does the same; main catches F5 and Ctrl+R / Cmd+R so they never
 * reload the window (lib/shortcuts.ts).
 *
 * It is also the app's only "updating" cue: the icon spins while a refresh
 * runs or any background refetch (a poll, a re-read after a write) has taken
 * longer than 150 ms, so sections never dim for them. With reduced motion it
 * does not spin; it turns foreground-coloured instead.
 */
function RefreshButton() {
  const { refreshing, refresh } = useRefresh();
  const updating = useUpdating();
  const busy = refreshing || updating;
  useShortcut("data.refresh", () => void refreshAll());
  const at = useUpdatedAt();
  const now = useNow(15_000);
  const shortcut = `Refresh (${useShortcutText("data.refresh")})`;
  const every = usePollEvery();
  // Two lines (the shared tooltip keeps line breaks): the shortcut and freshness, then how often it updates on its own.
  const title = `${at === null ? shortcut : `${shortcut} · Updated ${formatRelative(new Date(at).toISOString(), now)}`}\n${everyLine(every)}`;
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
