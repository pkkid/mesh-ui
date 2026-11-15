/**
 * Updates & admins hero: the target (or current) eeroOS, its status, the
 * release notes ("What's new") and, when an install is scheduled, the
 * "Installs automatically" countdown. Install now runs `updates.install`
 * (disruptive) with core's confirm, then a progress toast and per-eero
 * progress stay until every eero is back. docs/ux/pages/updates-admins.md
 * (Layout 1) and docs/mockups/15-updates-admins.html.
 */
import { CalendarClock, Download, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { execute, invalidate, useQuery } from "~/app/useCommand";
import { useWrite } from "~/app/useWrite";
import { Badge } from "~/components/ui/badge";
import { Card } from "~/components/ui/card";
import { PageHeader } from "~/components/ui/hero";
import { Meter } from "~/components/ui/meter";
import { GatedButton, useGate } from "~/components/ui/page";
import { Status, type StatusTone } from "~/components/ui/status";
import { toast } from "~/components/ui/toast";
import { cn } from "~/lib/utils";
import { networkClock } from "../../../../core/format";
import type { Eero, ReleaseNotes, Updates } from "../../../../core/model";

/** How often the install watcher reads the eeros and the update state. */
const WATCH_EVERY_MS = 5_000;
/** If no eero is seen restarting by then and eero says it is done, the install finished between reads. */
const SEE_DOWN_MS = 90_000;
/** Past this the toast turns into an error pointing at the eeros page. */
const GIVE_UP_MS = 30 * 60_000;

const isDown = (e: Pick<Eero, "status">) => e.status === "updating" || e.status === "offline";

/**
 * Keeps "Installing eeroOS x" on screen until eero reports the install done
 * and every eero is back online: seen down then up (or never seen down
 * within 90 s). A failed read counts as down, since the gateway restarting
 * takes this computer offline too. Each check refreshes the update, eero
 * and network queries so the page follows along. `onDone` runs once.
 */
export function watchInstall(networkId: string, version: string, onDone: () => void): void {
  const id = toast.progress(`Installing eeroOS ${version}`, { detail: "Every eero restarts, about 10 minutes" });
  const started = Date.now();
  let seenDown = false;
  const tick = async () => {
    const [eeros, updates] = await Promise.all([execute<Eero[]>("eero.list", { networkId }), execute<Updates>("updates.get", { networkId })]);
    invalidate(["eero.", "network.", "updates."]);
    const elapsed = Date.now() - started;
    // Done only when a successful read says so; a failed read is not proof.
    const finished = updates.ok && updates.result.status !== "installing";
    if (!eeros.ok || eeros.result.some(isDown)) seenDown = true;
    else if (finished && (seenDown || elapsed > SEE_DOWN_MS)) {
      toast.update(id, "success", { title: `eeroOS ${version} is installed`, detail: "Every eero is back online" });
      onDone();
      return;
    }
    if (elapsed > GIVE_UP_MS) {
      toast.update(id, "error", { title: "The update is taking longer than expected", detail: "Check the eeros page; eero may still be installing." });
      onDone();
      return;
    }
    setTimeout(() => void tick(), WATCH_EVERY_MS);
  };
  setTimeout(() => void tick(), 1_000);
}

const HOUR = 3_600_000;

/** eeroOS versions read the same with or without eero's leading "v". */
export const osVersion = (v: string | null | undefined): string | null => (v ? v.replace(/^v/i, "") : null);

function statusOf(u: Updates, installing: boolean): { tone: StatusTone; label: string } {
  if (installing || u.status === "installing") return { tone: "info", label: "Installing" };
  if (u.required && u.status !== "up_to_date") return { tone: "warning", label: "Update required" };
  if (u.status === "scheduled") return { tone: "info", label: "Update scheduled" };
  if (u.status === "available") return { tone: "info", label: "Update available" };
  return { tone: "success", label: "Up to date" };
}

/** "11h 46m" until the scheduled install. */
function countdown(ms: number): string {
  if (ms <= 0) return "now";
  const mins = Math.round(ms / 60_000);
  const h = Math.floor(mins / 60);
  return h > 0 ? `${h}h ${mins % 60}m` : `${mins}m`;
}

export function SoftwareCard({
  updates,
  notes,
  timezone,
  now,
  canInstall,
  networkId,
  fading,
}: {
  updates: Updates | undefined;
  notes: ReleaseNotes | null | undefined;
  timezone: string | null;
  now: number;
  /** Owners can install; an admin's role does not allow it (the roles table). */
  canInstall: boolean;
  /** The network the page shows, so the watcher keeps reading it if another one is selected. */
  networkId: string | null;
  fading: boolean;
}) {
  const gate = useGate("updates.install");
  const [watching, setWatching] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const install = useWrite<Record<string, never>, Updates>("updates.install");
  const clock = networkClock(timezone);
  const u = updates;
  const pending = u !== undefined && u.status !== "up_to_date" && u.target !== null;
  const version = osVersion(pending ? u.target : (u?.current ?? null));
  const installing = watching || u?.status === "installing";
  const st = u ? statusOf(u, installing) : null;
  const releasedAt = notes?.releasedAt ?? null;
  const scheduled = u?.scheduledAt ? Date.parse(u.scheduledAt) : null;

  const runInstall = async () => {
    if (!version || !networkId) return;
    const r = await install.run({}, { confirm: { title: `Install eeroOS ${version} now?`, confirmLabel: "Yes, install now" } });
    if (!r?.ok) return;
    setWatching(true);
    watchInstall(networkId, version, () => mounted.current && setWatching(false));
  };

  const statusLine = st ? (
    <>
      <Status tone={st.tone}>{st.label}</Status>
      {pending && u?.current && <span className="font-mono">from {osVersion(u.current)}</span>}
      {releasedAt && <span>Released {clock.day(releasedAt).replace(/^\w+ /, "")}</span>}
      {!pending && !installing && u?.lastUpdatedAt && <span>Last updated {clock.day(u.lastUpdatedAt).replace(/^\w+ /, "")}</span>}
    </>
  ) : null;

  return (
    <PageHeader
      className={cn("transition-opacity", fading && "opacity-40")}
      icon={Download}
      title={version ? `eeroOS ${version}` : u ? "eeroOS" : ""}
      status={statusLine}
      facts={
        <>
          {installing && <InstallProgress />}
          <WhatsNew notes={notes} />
        </>
      }
      actions={
        pending && !installing && canInstall && u?.canUpdateNow ? (
          <div className="flex flex-wrap items-center gap-2">
            <GatedButton gate={gate} disabled={install.running} onClick={() => void runInstall()}>
              <Download />
              Install now
            </GatedButton>
            <Badge variant="warning">
              <RotateCcw />
              Disruptive · all eeros restart
            </Badge>
          </div>
        ) : undefined
      }
      aside={
        scheduled !== null && u?.status === "scheduled" ? (
          <Card padded className="flex w-72 flex-col gap-3 bg-muted/30">
            <div className="flex items-center gap-2.5">
              <CalendarClock className="size-4 text-muted-foreground" />
              <div className="min-w-0">
                <div className="font-medium text-sm">Installs automatically</div>
                <div className="text-2xs text-muted-foreground">
                  {u.required ? "At the next update window, required" : `${clock.longDate(scheduled)} at ${clock.time(scheduled)}`}
                </div>
              </div>
            </div>
            <div className="font-semibold text-2xl tabular-nums">
              {countdown(scheduled - now)} <span className="font-normal text-muted-foreground text-xs">to go</span>
            </div>
            <Meter value={Math.max(0, 24 * HOUR - (scheduled - now))} max={24 * HOUR} label="Time until the update window" />
            <div className="text-2xs text-muted-foreground">eero sends reminders 12 hours and 15 minutes before. Turn them on or off in App &amp; account.</div>
          </Card>
        ) : undefined
      }
    />
  );
}

/** Each eero while the install runs: restarting or back, with a meter of how many are back. */
function InstallProgress() {
  const eeros = useQuery<Eero[]>("eero.list", undefined, { poll: 10 });
  const list = eeros.data ?? [];
  const back = list.filter((e) => !isDown(e)).length;
  return (
    <div className="flex max-w-md flex-col gap-2 rounded-lg border bg-muted/30 p-3" role="status" aria-label="Install progress">
      <div className="flex items-center justify-between gap-4 text-xs">
        <span className="font-medium">Installing on every eero</span>
        <span className="text-muted-foreground tabular-nums">
          {back} of {list.length || "-"} back
        </span>
      </div>
      <Meter value={back} max={Math.max(list.length, 1)} label="eeros back online" />
      <ul className="flex flex-col gap-1">
        {list.map((e) => (
          <li key={e.id} className="flex items-center justify-between text-xs">
            <span className="text-foreground/80">{e.location}</span>
            <Status tone={isDown(e) ? "info" : "success"}>{isDown(e) ? "Restarting" : "Back online"}</Status>
          </li>
        ))}
      </ul>
    </div>
  );
}

function WhatsNew({ notes }: { notes: ReleaseNotes | null | undefined }) {
  if (notes === undefined) return <div className="h-5" />;
  if (notes === null || notes.features.length === 0) return <div className="text-muted-foreground text-xs">No release notes from eero for this version.</div>;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="font-medium text-xs">What's new</div>
      <ul className="list-disc space-y-0.5 ps-4 text-foreground/80 text-sm">
        {notes.features.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
    </div>
  );
}
