/**
 * Updates & admins hero, the flat page header: the eeroOS every eero runs
 * now, its status with the update's version ("Update available · 7.13.0") (and, when an install is scheduled, when it installs on
 * its own), facts for the countdown, every eero's version and the last
 * update, then Check for updates and Install now with "Restarts every eero"
 * after it. "What's new" (the release notes) is the right-hand column. Install now runs `updates.install`
 * (disruptive) with core's confirm, then a progress toast and per-eero
 * progress stay until every eero is back. docs/ux/pages/updates-admins.md
 * (Layout 1) and docs/mockups/15-updates-admins.html.
 */
import { Download, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { execute, invalidate, useQuery } from "~/app/useCommand";
import { useWrite } from "~/app/useWrite";
import { Button } from "~/components/ui/button";
import { Metric, PageHeader } from "~/components/ui/hero";
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


/** eeroOS versions read the same with or without eero's leading "v". */
export const osVersion = (v: string | null | undefined): string | null => (v ? v.replace(/^v/i, "") : null);

function statusOf(u: Updates, installing: boolean): { tone: StatusTone; label: string } {
  if (installing || u.status === "installing") return { tone: "info", label: "Installing" };
  // A required update reads as available too; the line under the status says when it installs on its own.
  if (u.required && u.status !== "up_to_date") return { tone: "info", label: "Update available" };
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
  onCheck,
  checking,
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
  /** Check for updates: reads `updates.get` past the engine cache. */
  onCheck: () => void;
  checking: boolean;
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
  // `version` is the one an install would put on (Install now, the toast); the title is what runs now.
  const version = osVersion(pending ? u.target : (u?.current ?? null));
  const installed = osVersion(u?.current ?? null);
  const installing = watching || u?.status === "installing";
  const st = u ? statusOf(u, installing) : null;
  const releasedAt = notes?.releasedAt ?? null;
  const scheduled = u?.scheduledAt ? Date.parse(u.scheduledAt) : null;

  const runInstall = async () => {
    if (!version || !networkId) return;
    const r = await install.run({}, { confirm: { title: `Install eeroOS ${version} now?`, confirmLabel: "Install now" } });
    if (!r?.ok) return;
    setWatching(true);
    watchInstall(networkId, version, () => mounted.current && setWatching(false));
  };

  // Every eero's version (eero updates them together) and anything stuck from the last update.
  const versions = [...new Set((u?.eeros ?? []).map((e) => osVersion(e.firmware)).filter((v): v is string => v !== null))];
  const stuck = u?.stuckEeros.length ?? 0;
  const autoAt = scheduled !== null && u?.status === "scheduled" ? scheduled : null;

  const statusLine = st ? (
    <>
      <Status tone={st.tone}>{st.label}</Status>
      {/* One run of text, so the version and the date sit on one baseline: "7.12.1 · Released Nov 10". */}
      {(pending && version) || releasedAt ? (
        <span>{[pending ? version : null, releasedAt ? `Released ${clock.day(releasedAt).replace(/^\w+ /, "")}` : null].filter(Boolean).join(" · ")}</span>
      ) : null}
      {/* Its own line: when eero installs it without you, and eero's reminders. */}
      {autoAt !== null && (
        <span className="basis-full">
          {u?.required ? "Required: installs at the next update window." : `Installs automatically ${clock.longDate(autoAt)} at ${clock.time(autoAt)}.`} eero sends reminders 12 hours and 15
          minutes before; turn them on or off in Account.
        </span>
      )}
      {/* eero updates every eero together, so their versions are only worth a word when they differ. */}
      {versions.length > 1 && <span className="basis-full text-warning-foreground">Your eeros are on different versions: {versions.join(", ")}.</span>}
      {stuck > 0 && <span className="basis-full text-warning-foreground">{stuck === 1 ? "1 eero" : `${stuck} eeros`} did not finish the last update.</span>}
    </>
  ) : null;

  return (
    <PageHeader
      flat
      data-slot="updates-hero"
      className={cn("transition-opacity", fading && !u && "opacity-40")}
      // The version every eero runs now; the status line names the update ("Update available · 7.13.0").
      title={installed ? `eeroOS ${installed}` : u ? "eeroOS" : "Updates & admins"}
      status={statusLine}
      facts={
        installing ? (
          <InstallProgress />
        ) : u ? (
          <>
            {autoAt !== null && <Metric label="Installs in" value={countdown(autoAt - now)} />}
            <Metric label="Last updated" value={u.lastUpdatedAt ? clock.day(u.lastUpdatedAt).replace(/^\w+ /, "") : "-"} />
          </>
        ) : null
      }
      actions={
        <>
          <Button variant="outline" disabled={checking || installing} onClick={onCheck}>
            <RefreshCw className={cn(checking && "animate-spin motion-reduce:animate-none")} />
            Check for updates
          </Button>
          {pending && !installing && canInstall && u?.canUpdateNow && (
            <>
              {/* The page's call to action: the one filled button in the hero. */}
              <GatedButton gate={gate} disabled={install.running} onClick={() => void runInstall()}>
                <Download />
                Install now{"\u2026"}
              </GatedButton>
            </>
          )}
        </>
      }
      asideFit="w-[388px]"
      aside={<WhatsNew notes={notes} />}
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

/**
 * The hero's right-hand column: eero's release notes under a title, as Advanced networking's How changes apply.
 * The title names the version the notes are for ("What's new in 7.13.0"). It fills the column the header gives it (as tall as the left side) and scrolls
 * when eero lists more than fits, so the header never grows.
 */
function WhatsNew({ notes }: { notes: ReleaseNotes | null | undefined }) {
  return (
    <div data-slot="whats-new" className="flex h-full flex-col gap-2 text-xs">
      <h2 className="shrink-0 font-semibold text-base text-foreground leading-7">{notes ? `What's new in ${osVersion(notes.version)}` : "What's new"}</h2>
      {notes === undefined ? null : notes === null || notes.features.length === 0 ? (
        <p className="text-muted-foreground">No release notes from eero for this version.</p>
      ) : (
        <ul className="flex min-h-0 flex-1 list-disc flex-col gap-1 overflow-y-auto ps-4 pe-1 text-muted-foreground">
          {notes.features.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
