/**
 * Page loads: what the page transition in `RouterOutlet` waits for.
 *
 * The outlet gives each page a `PageLoad` through `PageLoadContext`. Every
 * `useQuery` inside the page holds it while its first load is pending (no
 * data and no error yet for those params), and a lazy page holds it while its
 * code loads. The page fades in once nothing has held it for a frame, so a
 * query that only starts when an earlier one lands (an id it needs) still
 * counts. Queries outside the page (sidebar, topbar) have no `PageLoad` and
 * never delay it. See docs/architecture/ui.md#page-transitions.
 */
import { createContext, useContext, useLayoutEffect } from "react";

export class PageLoad {
  private holds = 0;
  private listeners = new Set<() => void>();

  /** Holds the page until the returned release is called (once). */
  hold(): () => void {
    this.holds++;
    this.emit();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.holds--;
      this.emit();
    };
  }

  get pending(): number {
    return this.holds;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  private emit(): void {
    this.listeners.forEach((l) => l());
  }
}

export const PageLoadContext = createContext<PageLoad | null>(null);

/** Holds the page this component sits in while `waiting` is true. */
export function useHoldPage(waiting: boolean): void {
  const load = useContext(PageLoadContext);
  // A layout effect, so holds from one render land before the outlet checks.
  useLayoutEffect(() => (load && waiting ? load.hold() : undefined), [load, waiting]);
}

/** A Suspense fallback that holds the page while its code loads. */
export function HoldPage(): null {
  useHoldPage(true);
  return null;
}
