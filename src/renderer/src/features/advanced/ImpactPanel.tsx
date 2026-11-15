/**
 * What a settings change does before it is confirmed, from `settings.impact`:
 * whether every eero restarts and for how long, how many online devices lose
 * internet, and core's summary sentence (the same text as the confirm). Shown
 * inside each Advanced networking sheet and, for the change waiting on its
 * confirm dialog, in the page's side panel ("Pending change"). Every figure
 * and sentence comes from core. docs/ux/pages/advanced-networking.md (Side
 * panel and confirm bar).
 */
import { RotateCcw } from "lucide-react";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { useQuery } from "~/app/useCommand";
import { Card } from "~/components/ui/card";
import { cn } from "~/lib/utils";
import { formatCount, MISSING } from "../../../../core/format";
import type { SettingsImpact } from "../../../../core/model";

/** `settings.impact` for the given write ids; nothing is read while `ids` is empty. */
export function useImpact(ids: readonly string[]) {
  return useQuery<SettingsImpact>("settings.impact", { changes: ids.map((id) => ({ id })) }, { enabled: ids.length > 0 });
}

function Figure({ label, value, warn = false }: { label: string; value: ReactNode; warn?: boolean }) {
  return (
    <div className="min-w-0">
      <div className={cn("font-semibold text-2xl tabular-nums tracking-tight", warn && "text-warning-foreground")}>{value}</div>
      <div className="text-muted-foreground text-xs">{label}</div>
    </div>
  );
}

/** The impact of saving `ids`. `title` heads it ("Impact of saving", "Pending change"). */
export function ImpactPanel({ ids, title = "Impact of saving", what, className }: { ids: readonly string[]; title?: string; what?: ReactNode; className?: string }) {
  const q = useImpact(ids);
  const impact = ids.length > 0 ? (q.data ?? null) : null;

  if (ids.length === 0) {
    return <div className={cn("rounded-xl border bg-muted/40 px-3.5 py-3 text-muted-foreground text-xs", className)}>Nothing to save.</div>;
  }

  return (
    <div aria-label={title} className={cn("flex flex-col gap-3 rounded-xl border bg-muted/40 px-3.5 py-3 transition-opacity", q.fading && "opacity-40", className)}>
      <div className="font-semibold text-3xs text-muted-foreground/70 uppercase tracking-widest">{title}</div>
      {what && <div className="font-medium text-sm">{what}</div>}
      {q.error && !impact ? (
        <div className="text-destructive-foreground text-xs">{q.error.message}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Figure label="Devices lose internet" value={impact ? formatCount(impact.deviceIds.length) : MISSING} warn={!!impact && impact.deviceIds.length > 0} />
            <Figure label={impact?.restarts ? "Every eero restarts" : "Restart"} value={impact ? (impact.estimate ?? "None") : MISSING} warn={!!impact?.restarts} />
          </div>
          {impact && <p className="text-foreground/80 text-xs">{impact.summary}</p>}
          {impact?.restarts && (
            <ol className="flex list-decimal flex-col gap-1 ps-4 text-muted-foreground text-xs">
              <li>The change is saved to every eero.</li>
              <li>Every eero restarts, the gateway first: {impact.estimate}.</li>
              <li>Devices rejoin on their own when the eeros are back.</li>
            </ol>
          )}
        </>
      )}
    </div>
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

/** The side panel: the pending change's impact, or how changes apply when nothing waits. */
export function PendingPanel({ offline, bridged }: { offline: boolean; bridged: boolean }) {
  const list = useContext(PendingList);
  const last = list.at(-1);
  return (
    <Card padded className="flex flex-col gap-3 text-xs">
      {last ? (
        <ImpactPanel ids={last.ids} title="Pending change" what={last.what} className="border-0 bg-transparent p-0" />
      ) : (
        <>
          <div className="flex items-center gap-2 font-medium text-sm [&_svg]:size-4 [&_svg]:text-muted-foreground">
            <RotateCcw />
            How changes apply
          </div>
          <p className="text-muted-foreground">
            Settings marked <b className="font-medium text-foreground">Restarts eeros</b> restart every eero when saved. Before you confirm, this panel shows how long the network is down and how many devices lose internet.
          </p>
        </>
      )}
      {offline && <p className="text-warning-foreground">Your network is offline, changes cannot reach the eeros.</p>}
      {bridged && <p className="text-muted-foreground">This network is in bridge mode: another router handles addressing, DNS and port forwarding.</p>}
    </Card>
  );
}
