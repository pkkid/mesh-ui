/**
 * Tools, restarts and the scan reports. Run speed test works (the shared
 * runner from the Internet hero: a progress toast until the result lands).
 * The others run a write (blink, restarts) or read a 2.4 placement report
 * with no fixtures yet, so they stay disabled ("Coming soon") until those
 * commands are wired here.
 * docs/ux/pages/troubleshooting.md (Tools, Coverage scan, Upgrade report, Fixes).
 */
import type { ReactNode } from "react";

import { pathFor } from "~/app/router";
import { Card, Empty, Section } from "~/components/ui/card";
import { ComingSoonButton, GatedButton, HeaderLink } from "~/components/ui/page";
import { useSpeedTest } from "~/features/internet/InternetHero";
import type { Eero } from "../../../../core/model";

function ToolRow({ title, detail, children }: { title: string; detail: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[58px] items-center gap-3.5 px-[18px] py-[13px]">
      <div className="min-w-0 flex-1">
        <div className="font-medium text-sm">{title}</div>
        <div className="text-muted-foreground text-xs">{detail}</div>
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

export function Tools({ eeros }: { eeros: Eero[] | undefined }) {
  const gateway = eeros?.find((e) => e.isGateway)?.location ?? null;
  const speedTest = useSpeedTest();
  return (
    <Section title="Tools" subtitle="Speed test, find an eero and restarts">
      <Card className="divide-y">
        <ToolRow title="Run speed test" detail="Uses the WAN for about 30 s">
          <HeaderLink to={pathFor("internet")}>History</HeaderLink>
          <GatedButton gate={speedTest.gate} size="xs" variant="outline" onClick={() => void speedTest.run()}>
            {speedTest.testing ? "Testing..." : "Run"}
          </GatedButton>
        </ToolRow>
        <ToolRow title="Find an eero" detail="Cycle an eero's light for 30 s">
          <ComingSoonButton size="xs" variant="outline">
            Blink light
          </ComingSoonButton>
        </ToolRow>
        <ToolRow title="Restart a single eero" detail={gateway ? `Restarting ${gateway} takes the network offline` : "Restart one eero at a time"}>
          <ComingSoonButton size="xs" variant="outline">
            Restart
          </ComingSoonButton>
        </ToolRow>
        <ToolRow title="Restart network" detail="Every eero restarts; offline for about 2 to 3 minutes">
          <ComingSoonButton size="xs" variant="outline" className="text-destructive-foreground">
            Restart network
          </ComingSoonButton>
        </ToolRow>
      </Card>
    </Section>
  );
}

export function Reports() {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Section title="Coverage scan" subtitle="Link quality per room" tools={<ComingSoonButton size="xs" variant="outline">Scan now</ComingSoonButton>}>
        <Card>
          <Empty>No scan yet.</Empty>
        </Card>
      </Section>
      <Section title="Upgrade report" subtitle="Wi-Fi generation scan">
        <Card>
          <Empty>Not available yet.</Empty>
        </Card>
      </Section>
    </div>
  );
}
