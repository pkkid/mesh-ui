/**
 * A small hash router: one route per page (routes.ts), back and forward from
 * the browser history, and the last route remembered in localStorage. It is
 * view state, never a command. See docs/ux/overview.md#navigation.
 */
import { type AnchorHTMLAttributes, type MouseEvent, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { ComingSoon } from "~/features/shell/ComingSoon";
import { PageLoading } from "~/features/shell/PageLoading";
import { cn } from "~/lib/utils";
import { HoldPage, PageLoad, PageLoadContext } from "./pageLoad";
import { DEFAULT_ROUTE, PAGES, ROUTES, type RouteDef, routeById } from "./routes";

export type Location = {
  route: RouteDef;
  params: Readonly<Record<string, string>>;
  path: string;
};

const VIEW_KEY = "mesh-ui:view:v1";

/** Matches a path such as "/devices/abc" against the route table. */
export function matchPath(path: string): Location | null {
  const parts = path.split("/").filter(Boolean);
  for (const route of ROUTES) {
    const pattern = route.path.split("/").filter(Boolean);
    if (pattern.length !== parts.length) continue;
    const params: Record<string, string> = {};
    const ok = pattern.every((seg, i) => {
      const part = parts[i] ?? "";
      if (seg.startsWith(":")) {
        try {
          params[seg.slice(1)] = decodeURIComponent(part);
        } catch {
          return false;
        }
        return part.length > 0;
      }
      return seg === part;
    });
    if (ok) return { route, params, path: `/${parts.join("/")}` };
  }
  return null;
}

const paramNames = (path: string) => [...path.matchAll(/:(\w+)/g)].map((m) => m[1] as string);

/**
 * Builds a path for a route, filling `:name` segments from params. A page
 * with a section deep link has two routes under one id (`/internet` and
 * `/internet/:section`); the one whose segments match the params wins.
 */
export function pathFor(id: RouteDef["id"], params: Record<string, string> = {}): string {
  const given = Object.keys(params);
  const route =
    ROUTES.find((r) => {
      const names = paramNames(r.path);
      return r.id === id && names.length === given.length && names.every((n) => n in params);
    }) ?? routeById(id);
  return route.path.replace(/:(\w+)/g, (_, name: string) => encodeURIComponent(params[name] ?? ""));
}

function readLastPath(): string | null {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    const saved = raw ? (JSON.parse(raw) as { lastRoute?: unknown }) : null;
    return typeof saved?.lastRoute === "string" ? saved.lastRoute : null;
  } catch {
    return null;
  }
}

function saveLastPath(path: string) {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    const saved = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    localStorage.setItem(VIEW_KEY, JSON.stringify({ ...saved, lastRoute: path }));
  } catch {
    // Storage unavailable: the route is not remembered.
  }
}

const currentPath = () => window.location.hash.replace(/^#/, "") || "/";

let location: Location = resolve();

/** The location for the current hash, redirecting unknown paths. */
function resolve(): Location {
  const found = matchPath(currentPath());
  if (found) return found;
  const fallback = matchPath(readLastPath() ?? "") ?? matchPath(routeById(DEFAULT_ROUTE).path);
  const loc = fallback as Location;
  window.history.replaceState(null, "", `#${loc.path}`);
  return loc;
}

const listeners = new Set<() => void>();
window.addEventListener("hashchange", () => {
  location = resolve();
  saveLastPath(location.path);
  listeners.forEach((l) => l());
});
saveLastPath(location.path);

export function navigate(path: string, { replace = false } = {}): void {
  if (path === location.path) return;
  if (replace) {
    window.history.replaceState(null, "", `#${path}`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else {
    window.location.hash = path;
  }
}

export function useLocation(): Location {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => location,
  );
}

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { to: string };

/** An in-app link. Plain anchors with `#/...` hrefs, so they work with the keyboard and middle click is harmless. */
export function Link({ to, onClick, ...props }: LinkProps) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  return <a href={`#${to}`} onClick={handle} {...props} />;
}

/** Global navigation shortcuts from docs/ux/overview.md#keyboard-shortcuts. */
export function useNavigationShortcuts(): void {
  useEffect(() => {
    const numbered = ROUTES.filter((r) => r.nav === "network");
    const onKey = (e: KeyboardEvent) => {
      const mod = navigator.platform.startsWith("Mac") ? e.metaKey : e.ctrlKey;
      if (mod && !e.shiftKey && !e.altKey && /^[1-7]$/.test(e.key)) {
        const route = numbered[Number(e.key) - 1];
        if (route) {
          e.preventDefault();
          navigate(route.path);
        }
      } else if (mod && e.key === ",") {
        e.preventDefault();
        navigate(pathFor("settings"));
      } else if (e.altKey && !mod && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        if (e.key === "ArrowLeft") window.history.back();
        else window.history.forward();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/**
 * Scrolls the content column so the element with this id sits at the top
 * (for `#/page/:section` deep links). Only the column scrolls:
 * `scrollIntoView` would also scroll the window and push the titlebar off.
 */
export function scrollToSection(id: string): void {
  const el = document.getElementById(id);
  const column = el?.closest<HTMLElement>("[data-page-scroll]");
  if (!el || !column) return;
  const top = el.getBoundingClientRect().top - column.getBoundingClientRect().top + column.scrollTop;
  column.scrollTo({ top: Math.max(0, top - 22) });
}

/** Page transition timings (docs/architecture/ui.md#page-transitions). */
const FADE_OUT_MS = 150;
/** A page shows after this even if a query is still loading; its sections fade their own placeholders. */
const MAX_WAIT_MS = 3000;

/** `wait`: the page is mounted but hidden until its data lands. `in`: it fades in. */
type Phase = "wait" | "in";

/**
 * Fades the outgoing page out as a still copy of its DOM laid over the page
 * area, so the next page can mount (and start loading) at once instead of
 * after the fade. The copy is inert: no React, no ids, no pointer events.
 * Calls `done` when the fade ends.
 */
function fadeOutCopy(host: HTMLElement, scroller: HTMLElement, page: HTMLElement, done: () => void): () => void {
  const copy = page.cloneNode(true) as HTMLElement;
  for (const el of copy.querySelectorAll("[id]")) el.removeAttribute("id");
  copy.removeAttribute("aria-busy");
  copy.style.transform = `translateY(${-scroller.scrollTop}px)`;
  const ghost = document.createElement("div");
  ghost.setAttribute("aria-hidden", "true");
  ghost.inert = true;
  // Same box as the scroll column, less its scrollbar lane, so the copy sits exactly where the page was.
  ghost.className = "topbar-scroll-fade pointer-events-none absolute inset-y-0 left-0 overflow-hidden";
  ghost.style.right = `${scroller.offsetWidth - scroller.clientWidth}px`;
  ghost.style.transition = `opacity ${FADE_OUT_MS}ms ease-out`;
  ghost.appendChild(copy);
  host.appendChild(ghost);
  void ghost.offsetWidth; // start the transition from full opacity
  ghost.style.opacity = "0";
  const t = setTimeout(() => {
    ghost.remove();
    done();
  }, FADE_OUT_MS);
  return () => {
    clearTimeout(t);
    ghost.remove();
  };
}

/**
 * The scrolling content column with the current page in it. Switching pages
 * mounts the new page at once, hidden, so its queries start on the click,
 * while a still copy of the old page fades out over it. The new page fades
 * in once its first loads land (pageLoad.ts) and the fade out is over, so a
 * page never shows its empty template first. The loading mark fades in
 * slowly meanwhile, so quick switches never show it.
 */
export function RouterOutlet() {
  const location = useLocation();
  const [shown, setShown] = useState(location);
  const [phase, setPhase] = useState<Phase>("wait");
  const [fadingOut, setFadingOut] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const page = useRef<HTMLDivElement>(null);
  const stopFade = useRef<(() => void) | null>(null);
  // One PageLoad per mounted page: a new page gets a new one.
  const load = useMemo(() => new PageLoad(), [shown.path]);
  const pending = useSyncExternalStore(
    (l) => load.subscribe(l),
    () => load.pending,
  );

  // A new location: copy the old page for its fade out, then swap pages in the same tick.
  // A layout effect, so the copy is taken before anything paints and the old DOM is still there.
  useLayoutEffect(() => {
    if (location.path === shown.path) return;
    stopFade.current?.();
    stopFade.current = null;
    if (wrapper.current && scroller.current && page.current && phase === "in") {
      stopFade.current = fadeOutCopy(wrapper.current, scroller.current, page.current, () => {
        stopFade.current = null;
        setFadingOut(false);
      });
      setFadingOut(true);
    }
    scroller.current?.scrollTo({ top: 0 });
    setShown(location);
    setPhase("wait");
  }, [location, shown.path, phase]);

  useEffect(() => () => stopFade.current?.(), []);

  // Ready once nothing has held the page for a frame (a query can start when an earlier one lands)
  // and the old page has faded out.
  useEffect(() => {
    if (phase !== "wait" || pending > 0 || fadingOut) return;
    const frame = requestAnimationFrame(() => {
      if (load.pending === 0) setPhase("in");
    });
    return () => cancelAnimationFrame(frame);
  }, [phase, pending, load, fadingOut]);

  useEffect(() => {
    if (phase !== "wait") return;
    const t = setTimeout(() => setPhase("in"), MAX_WAIT_MS);
    return () => clearTimeout(t);
  }, [phase, load]);

  const switching = phase !== "in";

  const Page = PAGES[shown.route.id];
  return (
    <div ref={wrapper} className="relative flex min-h-0 flex-1 flex-col">
      <div ref={scroller} data-page-scroll className="topbar-scroll-fade min-h-0 flex-1 overflow-y-auto">
        <div
          key={shown.path}
          ref={page}
          aria-busy={switching}
          className={cn(
            "mx-auto flex max-w-[1056px] flex-col gap-7 px-7 pt-[22px] pb-[100px] transition-opacity",
            // In over 300 ms easing both ends (ease-out alone reads as a pop). The fade out is the copy's.
            phase === "in" ? "opacity-100 duration-300 ease-in-out" : "pointer-events-none opacity-0 duration-0",
          )}
        >
          <PageLoadContext.Provider value={load}>
            {Page ? (
              <Suspense fallback={<HoldPage />}>
                <Page params={shown.params} />
              </Suspense>
            ) : (
              <ComingSoon route={shown.route} params={shown.params} />
            )}
          </PageLoadContext.Provider>
        </div>
      </div>
      <PageLoading visible={switching} />
    </div>
  );
}
