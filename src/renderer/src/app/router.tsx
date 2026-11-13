/**
 * A small hash router: one route per page (routes.ts), back and forward from
 * the browser history, and the last route remembered in localStorage. It is
 * view state, never a command. See docs/ux/overview.md#navigation.
 */
import { type AnchorHTMLAttributes, type MouseEvent, Suspense, useEffect, useSyncExternalStore } from "react";

import { ComingSoon } from "~/features/shell/ComingSoon";
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

/** Builds a path for a route, filling `:name` segments from params. */
export function pathFor(id: RouteDef["id"], params: Record<string, string> = {}): string {
  return routeById(id).path.replace(/:(\w+)/g, (_, name: string) => encodeURIComponent(params[name] ?? ""));
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
        navigate(pathFor("account"));
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

/** The scrolling content column with the current page in it. */
export function RouterOutlet() {
  const { route, params, path } = useLocation();
  const Page = PAGES[route.id];
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div key={path} className="mx-auto flex max-w-[1320px] flex-col gap-7 px-7 pt-[22px] pb-12">
        {Page ? (
          <Suspense fallback={null}>
            <Page params={params} />
          </Suspense>
        ) : (
          <ComingSoon route={route} params={params} />
        )}
      </div>
    </div>
  );
}
