/**
 * Troubleshooting: the network health check (`health.check`, built in core
 * from cached reads, no active probes), tools and restarts (disabled until
 * their writes land), coverage and upgrade reports (no fixtures yet,
 * disabled) and Get help (`support.info`, `support.report`).
 * Layout, data and states: docs/ux/pages/troubleshooting.md and
 * docs/mockups/16-troubleshooting.html.
 */
import type { PageProps } from "~/app/routes";
import { useQuery } from "~/app/useCommand";
import { useNow } from "~/components/ui/page";
import { TopBarSubtitle, TopBarTitle } from "~/features/shell/TopBar";
import { formatRelative } from "../../../../core/format";
import type { Eero, HealthReport, Network, SupportInfo } from "../../../../core/model";

import { HealthChecks } from "./HealthChecks";
import { SupportCard } from "./SupportCard";
import { Reports, Tools } from "./Tools";

export function TroubleshootingPage(_: PageProps) {
  const network = useQuery<Network>("network.get", undefined, { poll: true });
  const health = useQuery<HealthReport>("health.check", undefined, { poll: true });
  const support = useQuery<SupportInfo>("support.info");
  const eeros = useQuery<Eero[]>("eero.list", undefined, { poll: true });
  const now = useNow();

  const at = health.data?.at ?? null;
  const offline = network.data?.status === "offline";

  return (
    <>
      <TopBarTitle>Troubleshooting</TopBarTitle>
      <TopBarSubtitle>{at ? `Last health check ${formatRelative(at, now)}` : "Health check"}</TopBarSubtitle>
      <div className="grid items-start gap-7 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <HealthChecks query={health} offline={offline} />
          <Tools eeros={eeros.data} />
          <Reports />
        </div>
        <aside className="flex flex-col gap-4 xl:sticky xl:top-0">
          <SupportCard query={support} />
        </aside>
      </div>
    </>
  );
}
