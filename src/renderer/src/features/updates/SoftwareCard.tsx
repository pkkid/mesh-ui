/**
 * Updates & admins hero: the target (or current) eeroOS, its status, the
 * release notes ("What's new") and, when an install is scheduled, the
 * "Installs automatically" countdown. Install now is a disabled "Coming
 * soon" button until `updates.install` lands. docs/ux/pages/updates-admins.md
 * (Layout 1) and docs/mockups/15-updates-admins.html.
 */
import { CalendarClock, Download, RotateCcw } from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Card } from "~/components/ui/card";
import { PageHeader } from "~/components/ui/hero";
import { Meter } from "~/components/ui/meter";
import { ComingSoonButton } from "~/components/ui/page";
import { Status, type StatusTone } from "~/components/ui/status";
import { cn } from "~/lib/utils";
import { networkClock } from "../../../../core/format";
import type { ReleaseNotes, Updates } from "../../../../core/model";

const HOUR = 3_600_000;

/** eeroOS versions read the same with or without eero's leading "v". */
export const osVersion = (v: string | null | undefined): string | null => (v ? v.replace(/^v/i, "") : null);

function statusOf(u: Updates): { tone: StatusTone; label: string } {
  if (u.status === "installing") return { tone: "info", label: "Installing" };
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
  fading,
}: {
  updates: Updates | undefined;
  notes: ReleaseNotes | null | undefined;
  timezone: string | null;
  now: number;
  /** Owners can install; an admin's role may not allow it. */
  canInstall: boolean;
  fading: boolean;
}) {
  const clock = networkClock(timezone);
  const u = updates;
  const pending = u !== undefined && u.status !== "up_to_date" && u.target !== null;
  const version = osVersion(pending ? u.target : (u?.current ?? null));
  const st = u ? statusOf(u) : null;
  const releasedAt = notes?.releasedAt ?? null;
  const scheduled = u?.scheduledAt ? Date.parse(u.scheduledAt) : null;

  const statusLine = st ? (
    <>
      <Status tone={st.tone}>{st.label}</Status>
      {pending && u?.current && <span className="font-mono">from {osVersion(u.current)}</span>}
      {releasedAt && <span>Released {clock.day(releasedAt).replace(/^\w+ /, "")}</span>}
      {!pending && u?.lastUpdatedAt && <span>Last updated {clock.day(u.lastUpdatedAt).replace(/^\w+ /, "")}</span>}
    </>
  ) : null;

  return (
    <PageHeader
      className={cn("transition-opacity", fading && "opacity-40")}
      icon={Download}
      title={version ? `eeroOS ${version}` : u ? "eeroOS" : ""}
      status={statusLine}
      facts={<WhatsNew notes={notes} />}
      actions={
        pending && u?.status !== "installing" && canInstall ? (
          <>
            <ComingSoonButton>
              <Download />
              Install now
            </ComingSoonButton>
            <Badge variant="warning">
              <RotateCcw />
              Disruptive · all eeros restart
            </Badge>
          </>
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
