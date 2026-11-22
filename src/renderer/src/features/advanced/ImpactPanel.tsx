/**
 * What a settings change does before it is confirmed, from `settings.impact`:
 * whether every eero restarts and for how long, how many online devices lose
 * internet, and core's summary sentence (the same text as the confirm). Shown
 * inside each Advanced networking sheet and, for the change waiting on its
 * confirm dialog, in the page's side panel ("Pending change"). Every figure
 * and sentence comes from core. docs/ux/pages/advanced-networking.md (Side
 * panel and confirm bar).
 */
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { useQuery } from "~/app/useCommand";
import { ImpactBox, ImpactFigure, ImpactFigures, ImpactSummary } from "~/components/ui/impact";
import type { Eero, SettingsImpact } from "../../../../core/model";

/** `settings.impact` for the given write ids; nothing is read while `ids` is empty. */
export function useImpact(ids: readonly string[]) {
  return useQuery<SettingsImpact>("settings.impact", { changes: ids.map((id) => ({ id })) }, { enabled: ids.length > 0 });
}

/**
 * The impact of saving `ids`. `title` heads it ("Impact of saving", "Pending change"). Nothing shows
 * while `ids` is empty (nothing changed yet), so a sheet stays quiet until there is something to say.
 */
export function ImpactPanel({ ids, title = "Impact of saving", what, className }: { ids: readonly string[]; title?: string; what?: ReactNode; className?: string }) {
  const q = useImpact(ids);
  const eeros = useQuery<Eero[]>("eero.list", undefined, { enabled: ids.length > 0 });
  const impact = ids.length > 0 ? (q.data ?? null) : null;
  if (ids.length === 0) return null;

  const restarting = impact ? (impact.restarts ? (eeros.data?.length ?? null) : 0) : null;
  return (
    <ImpactBox title={title} fading={q.fading} className={className}>
      {what && <div className="font-medium text-sm">{what}</div>}
      {q.error && !impact ? (
        <div className="text-destructive-foreground text-xs">{q.error.message}</div>
      ) : (
        <>
          <ImpactFigures>
            <ImpactFigure label="devices lose internet" value={impact ? impact.deviceIds.length : null} />
            <ImpactFigure label="eeros restart" value={restarting} />
          </ImpactFigures>
          {impact && <ImpactSummary>{impact.summary}</ImpactSummary>}
        </>
      )}
    </ImpactBox>
  );
}

// ---------------------------------------------------------------------------
// Pending change: the side panel follows whichever control waits on a confirm

type Pending = { key: string; ids: string[]; what: string };
type PendingApi = { set: (key: string, next: Omit<Pending, "key"> | null) => void };

const PendingContext = createContext<PendingApi | null>(null);
const PendingList = createContext<Pending[]>([]);

export function PendingImpactProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Pending[]>([]);
  const set = useCallback((key: string, next: Omit<Pending, "key"> | null) => {
    setList((cur) => {
      const rest = cur.filter((p) => p.key !== key);
      return next ? [...rest, { key, ...next }] : rest;
    });
  }, []);
  const api = useMemo(() => ({ set }), [set]);
  return (
    <PendingContext.Provider value={api}>
      <PendingList.Provider value={list}>{children}</PendingList.Provider>
    </PendingContext.Provider>
  );
}

/** Registers a change waiting on its confirm while `active`; the side panel shows its impact. */
export function usePendingImpact(key: string, id: string, what: string, active: boolean) {
  const api = useContext(PendingContext);
  useEffect(() => {
    if (!api) return;
    api.set(key, active ? { ids: [id], what } : null);
    return () => api.set(key, null);
  }, [api, key, id, what, active]);
}

/**
 * The hero's right-hand column: how changes apply, or the pending change's impact while one waits on its confirm.
 * Flat in the header (no card), under a title like Signal's Signal spread.
 */
export function PendingPanel({ offline, bridged }: { offline: boolean; bridged: boolean }) {
  const list = useContext(PendingList);
  const last = list.at(-1);
  return (
    <div data-slot="pending-panel" className="flex w-72 flex-col gap-2 text-xs">
      {last ? (
        <ImpactPanel ids={last.ids} title="Pending change" what={last.what} />
      ) : (
        <>
          <h2 className="font-semibold text-base text-foreground leading-7">How changes apply</h2>
          <p className="text-muted-foreground">
            Settings marked <span className="text-warning-foreground">Restarts eeros</span> restart every eero when saved. Before you confirm, the confirm and this panel say how long the network is down and how many devices lose internet.
          </p>
        </>
      )}
      {offline && <p className="text-warning-foreground">Your network is offline, changes cannot reach the eeros.</p>}
      {bridged && <p className="text-muted-foreground">This network is in bridge mode: another router handles addressing, DNS and port forwarding.</p>}
    </div>
  );
}
