/**
 * Internet: is the ISP delivering, what addresses are in use, how speed
 * tests have gone, and how much data crossed the WAN. Layout, data and
 * states: docs/ux/pages/internet.md and docs/mockups/02-internet.html. Every
 * figure comes from a query command; the page only arranges and words it.
 */
import { useEffect } from "react";

import { scrollToSection } from "~/app/router";
import type { PageProps } from "~/app/routes";
import { useQuery } from "~/app/useCommand";
import { useNow } from "~/components/ui/page";
import { TopBarSubtitle } from "~/features/shell/TopBar";
import { formatRelative } from "../../../../core/format";
import type { Internet } from "../../../../core/model";

import { Connection } from "./Connection";
import { InternetHero } from "./InternetHero";
import { InternetUsage } from "./InternetUsage";
import { PlanSheet } from "./PlanSheet";
import { SpeedHistory } from "./SpeedHistory";

/** Sections `#/internet/<section>` scrolls to, with their DOM ids. */
const SECTION_IDS: Readonly<Record<string, string>> = { history: "internet-history" };

export function InternetPage({ params }: PageProps) {
  const internet = useQuery<Internet>("internet.get", undefined, { poll: true });
  const section = params.section;
  useEffect(() => {
    const id = section ? SECTION_IDS[section] : undefined;
    if (id) scrollToSection(id);
  }, [section]);
  return (
    <>
      <TopBarSubtitle>
        <Freshness at={internet.fetchedAt} />
      </TopBarSubtitle>
      <InternetHero />
      <Connection />
      <SpeedHistory id={SECTION_IDS.history} />
      <InternetUsage />
      <PlanSheet />
    </>
  );
}

/** "Updated just now", counting up between polls. */
function Freshness({ at }: { at: number | null }) {
  const now = useNow(15_000);
  if (at === null) return null;
  return <>Updated {formatRelative(new Date(at).toISOString(), now)}</>;
}
