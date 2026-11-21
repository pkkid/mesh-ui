/**
 * Updates & admins: the flat hero is eeroOS (status, every eero's version,
 * Check for updates and Install now, the release notes on the right), then,
 * in one full-width column, the preferred update time with the quiet-hours chart, then the
 * admins and invites, and Transfer network (owner only). Install now, the
 * preferred hour, invites, removing admins and the transfer are writes
 * through the write kit. Owner and admin views follow `admin.list` (who
 * "you" are).
 * Layout, data and states: docs/ux/pages/updates-admins.md and
 * docs/mockups/15-updates-admins.html.
 */
import { useState } from "react";

import type { PageProps } from "~/app/routes";
import { useQuery } from "~/app/useCommand";
import { SectionError, useNow } from "~/components/ui/page";
import { TopBarTitle, useTopBarPollEvery } from "~/features/shell/TopBar";
import { POLL } from "../../../../core/poll";
import type { AdminList, Network, ReleaseNotes, Updates } from "../../../../core/model";

import { Admins } from "./Admins";
import { QuietHours } from "./QuietHours";
import { SoftwareCard } from "./SoftwareCard";
import { TransferNetwork } from "./TransferDialog";

export function UpdatesPage(_: PageProps) {
  const network = useQuery<Network>("network.get", undefined, { poll: true });
  const updates = useQuery<Updates>("updates.get", undefined, { poll: true });
  const notes = useQuery<ReleaseNotes | null>("updates.notes");
  const admins = useQuery<AdminList>("admin.list");
  const now = useNow(60_000);
  const [checking, setChecking] = useState(false);
  // The page's main data, eero's update state, polls every 15 minutes: Refresh's tooltip says so.
  useTopBarPollEvery(POLL.updates);

  const timezone = network.data?.timezone ?? null;
  const u = updates.data;
  const myRole = admins.data?.admins.find((a) => a.isYou)?.role ?? network.data?.role ?? null;
  // Check for updates (in the hero, beside Install now): `updates.get` past the engine cache.
  const check = () => {
    if (checking) return;
    setChecking(true);
    void updates.refetch({ fresh: true }).then(() => setChecking(false));
  };

  return (
    <>
      <TopBarTitle>Updates &amp; admins</TopBarTitle>
      {updates.error && !u ? (
        <SectionError what="software updates" error={updates.error} onRetry={() => void updates.refetch()} />
      ) : (
        <SoftwareCard
          updates={u}
          notes={notes.error ? null : notes.data}
          timezone={timezone}
          now={now}
          canInstall={myRole === "owner"}
          networkId={network.data?.id ?? null}
          fading={updates.fading}
          onCheck={check}
          checking={checking}
        />
      )}
      <div className="flex flex-col gap-14">
        <QuietHours preferredHour={u ? u.preferredHour : undefined} canChange={myRole === "owner"} />
        <Admins list={admins} timezone={timezone} myRole={myRole} />
        {myRole === "owner" && network.data && <TransferNetwork network={network.data} />}
      </div>
    </>
  );
}
