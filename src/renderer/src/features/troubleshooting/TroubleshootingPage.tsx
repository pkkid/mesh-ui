/**
 * Troubleshooting: the flat hero from the network health check
 * (`health.check`, built in core from cached reads, no active probes) with
 * the score ring, then one full-width column of sections: Checks, Diagnose a
 * problem (`diagnostics.run`), Tools, Restart, Status light
 * colors and Get help (`support.info`, `support.report`). The coverage scan,
 * upgrade report and radio channels moved to the Signal page.
 * Layout, data and states: docs/ux/pages/troubleshooting.md.
 */
import type { PageProps } from "~/app/routes";
import { useQuery } from "~/app/useCommand";
import { TopBarTitle } from "~/features/shell/TopBar";
import type { Eero, Network, SupportInfo } from "../../../../core/model";

import { Diagnose } from "./Diagnose";
import { HealthChecks, HealthHero, useHealthCheck } from "./HealthChecks";
import { GetHelp } from "./GetHelp";
import { Restarts, StatusLights, Tools } from "./Tools";

export function TroubleshootingPage(_: PageProps) {
  const network = useQuery<Network>("network.get", undefined, { poll: true });
  const health = useHealthCheck();
  const support = useQuery<SupportInfo>("support.info");
  const eeros = useQuery<Eero[]>("eero.list", undefined, { poll: true });

  const offline = network.data?.status === "offline";

  return (
    <>
      <TopBarTitle>Troubleshooting</TopBarTitle>
      <HealthHero health={health} />
      <div className="flex flex-col gap-14">
        <HealthChecks health={health} />
        <Diagnose offline={offline} />
        <Tools eeros={eeros.data} offline={offline} />
        <Restarts eeros={eeros.data} networkName={network.data?.name ?? "the network"} />
        {/* Two quiet reference sections side by side. */}
        <div className="grid gap-x-7 gap-y-14 lg:grid-cols-2">
          <StatusLights />
          <GetHelp query={support} />
        </div>
      </div>
    </>
  );
}
