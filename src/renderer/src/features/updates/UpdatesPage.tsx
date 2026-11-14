/**
 * Updates & admins: software status with the release notes, every eero's
 * version, the preferred update time with the quiet-hours chart, then the
 * admins and invites. Read-only for now: install, preferred hour, invites
 * and removing admins are disabled "Coming soon" controls until their
 * commands land. Owner and admin views follow `admin.list` (who "you" are).
 * Layout, data and states: docs/ux/pages/updates-admins.md and
 * docs/mockups/15-updates-admins.html.
 */
import { RefreshCw, Router } from "lucide-react";

import type { PageProps } from "~/app/routes";
import { useQuery } from "~/app/useCommand";
import { Button } from "~/components/ui/button";
import { IconTile } from "~/components/ui/hero";
import { Row, RowList, SectionError, useNow } from "~/components/ui/page";
import { TopBarActions, TopBarSubtitle, TopBarTitle } from "~/features/shell/TopBar";
import { formatRelative, networkClock } from "../../../../core/format";
import type { AdminList, Network, ReleaseNotes, Updates } from "../../../../core/model";

import { Admins } from "./Admins";
import { QuietHours } from "./QuietHours";
import { osVersion, SoftwareCard } from "./SoftwareCard";

export function UpdatesPage(_: PageProps) {
  const network = useQuery<Network>("network.get", undefined, { poll: true });
  const updates = useQuery<Updates>("updates.get", undefined, { poll: true });
  const notes = useQuery<ReleaseNotes | null>("updates.notes");
  const admins = useQuery<AdminList>("admin.list");
  const now = useNow(60_000);

  const timezone = network.data?.timezone ?? null;
  const u = updates.data;
  const myRole = admins.data?.admins.find((a) => a.isYou)?.role ?? network.data?.role ?? null;

  return (
    <>
      <TopBarTitle>Updates &amp; admins</TopBarTitle>
      {updates.fetchedAt !== null && <TopBarSubtitle>Checked for updates {formatRelative(new Date(updates.fetchedAt).toISOString(), now, timezone ?? "UTC")}</TopBarSubtitle>}
      <TopBarActions>
        <Button size="xs" variant="outline" className="no-drag" onClick={() => void updates.refetch()} disabled={updates.loading}>
          <RefreshCw />
          Check for updates
        </Button>
      </TopBarActions>

      {updates.error && !u ? (
        <SectionError what="software updates" error={updates.error} onRetry={() => void updates.refetch()} />
      ) : (
        <SoftwareCard updates={u} notes={notes.error ? null : notes.data} timezone={timezone} now={now} canInstall={myRole === "owner"} fading={updates.fading} />
      )}

      <EveryEero updates={u} timezone={timezone} />
      <QuietHours preferredHour={u ? u.preferredHour : undefined} />
      <Admins list={admins} timezone={timezone} myRole={myRole} />
    </>
  );
}

/** "Living Room, Office and Garage": a plain list for a sentence. */
function listOf(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function EveryEero({ updates, timezone }: { updates: Updates | undefined; timezone: string | null }) {
  const clock = networkClock(timezone);
  if (!updates) return <div className="h-[58px]" />;
  const names = updates.eeros.map((e) => e.location);
  const versions = [...new Set(updates.eeros.map((e) => osVersion(e.firmware)).filter((v): v is string => v !== null))];
  const last = updates.lastUpdatedAt;
  return (
    <RowList>
      <Row>
        <IconTile icon={Router} />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-sm">Every eero updates together</div>
          <div className="text-muted-foreground text-xs">
            {names.length === 0 ? "No eeros on this network." : `${listOf(names)} ${names.length === 1 ? "was" : "were"} last updated ${last ? `on ${clock.dateTime(last).replace(",", " at")}` : "at an unknown time"}`}
            {versions.length > 1 ? `. Versions differ: ${versions.join(", ")}` : versions.length === 1 ? `, all on eeroOS ${versions[0]}` : ""}
            {updates.stuckEeros.length > 0 ? `. ${updates.stuckEeros.length} did not finish the last update` : ""}
          </div>
        </div>
      </Row>
    </RowList>
  );
}
