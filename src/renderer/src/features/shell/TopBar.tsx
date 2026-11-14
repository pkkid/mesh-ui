/**
 * The 44px strip at the top of the main pane (docs/ux/overview.md#topbar).
 * It doubles as the window titlebar (`drag-region`), so every control in it
 * is `no-drag` and it leaves room for native window controls on the right.
 *
 * Left: crumbs (parent page link, then the page title) and a subtitle slot.
 * Right: an actions slot for the page, search, notifications and the
 * light/dark toggle. Pages fill the slots with <TopBarTitle>,
 * <TopBarSubtitle> and <TopBarActions>, which portal into the bar.
 */
import { Moon, Search, Sun } from "lucide-react";
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { Link, useLocation } from "~/app/router";
import { routeById } from "~/app/routes";
import { Bell } from "~/features/notifications/Bell";
import { openPalette } from "~/features/palette/CommandPalette";
import { toggleAppearance, useResolvedAppearance } from "~/lib/themes";
import { cn } from "~/lib/utils";

type SlotName = "title" | "subtitle" | "actions";
type Slots = Readonly<Record<SlotName, HTMLElement | null>>;

const SlotsContext = createContext<Slots>({ title: null, subtitle: null, actions: null });
const RegisterContext = createContext<(name: SlotName, el: HTMLElement | null) => void>(() => {});

/** Holds the slot elements; wraps the main pane so pages can portal into the bar. */
export function TopBarProvider({ children }: { children: ReactNode }) {
  const [slots, setSlots] = useState<Slots>({ title: null, subtitle: null, actions: null });
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
/** Freshness or a page summary: "Updated 4s ago". */
export const TopBarSubtitle = ({ children }: { children: ReactNode }) => <Slot name="subtitle">{children}</Slot>;
/** Small page buttons before the search field: Share Wi-Fi, Prev and Next. */
export const TopBarActions = ({ children }: { children: ReactNode }) => <Slot name="actions">{children}</Slot>;

export function TopBar() {
  const register = useContext(RegisterContext);
  const refs = useMemo(
    () => ({
      title: (el: HTMLElement | null) => register("title", el),
      subtitle: (el: HTMLElement | null) => register("subtitle", el),
      actions: (el: HTMLElement | null) => register("actions", el),
    }),
    [register],
  );
  const { route } = useLocation();
  const parent = route.parent ? routeById(route.parent) : null;
  const appearance = useResolvedAppearance();
  const isMac = navigator.platform.startsWith("Mac");
  const themeLabel = appearance === "dark" ? "Switch to light" : "Switch to dark";

  return (
    <header className="drag-region flex h-(--titlebar-height) shrink-0 items-center gap-3 border-b bg-background ps-5 pe-[calc(var(--titlebar-inset-right)+0.875rem)]">
      <div className="flex min-w-0 items-baseline gap-2">
        {parent && (
          <>
            <Link to={parent.path} className="no-drag shrink-0 text-[13px] text-muted-foreground hover:text-foreground">
              {parent.title}
            </Link>
            <span className="text-muted-foreground/70">/</span>
          </>
        )}
        <h1 className="flex min-w-0 font-semibold text-sm">
          <span ref={refs.title} className="peer truncate empty:hidden" />
          <span className="truncate peer-[:not(:empty)]:hidden">{route.title}</span>
        </h1>
        <span ref={refs.subtitle} className="truncate text-muted-foreground text-xs empty:hidden" />
      </div>

      <div className="no-drag ms-auto flex items-center gap-1">
        <div ref={refs.actions} className="flex items-center gap-1 empty:hidden" />
        <button
          type="button"
          onClick={() => openPalette()}
          aria-label="Search or run a command"
          className="ms-2 flex h-7 w-[260px] cursor-pointer items-center gap-2 rounded-[var(--control-radius)] border bg-card px-2.5 text-[12.5px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5"
        >
          <Search />
          <span>Search or run a command</span>
          <kbd className="ms-auto rounded-[5px] border border-input px-1.5 font-mono text-[10.5px]">
            {isMac ? "⌘K" : "Ctrl K"}
          </kbd>
        </button>
        <Bell className={iconButton} />
        <button type="button" onClick={toggleAppearance} title={themeLabel} aria-label={themeLabel} className={iconButton}>
          {appearance === "dark" ? <Sun /> : <Moon />}
        </button>
      </div>
    </header>
  );
}

const iconButton = cn(
  "relative grid size-[30px] cursor-pointer place-items-center rounded-[var(--control-radius)] text-muted-foreground outline-none",
  "hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4",
);
