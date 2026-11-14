/**
 * Internet: is the ISP delivering, what addresses are in use, how speed
 * tests have gone, and how much data crossed the WAN. Layout, data and
 * states: docs/ux/pages/internet.md and docs/mockups/02-internet.html. Every
 * figure comes from a query command; the page only arranges and words it.
 */
import type { PageProps } from "~/app/routes";
import { useQuery } from "~/app/useCommand";
import { useNow } from "~/components/ui/page";
import { TopBarSubtitle } from "~/features/shell/TopBar";
import { formatRelative } from "../../../../core/format";
import type { Internet } from "../../../../core/model";

import { Connection } from "./Connection";
import { EarlierTests } from "./EarlierTests";
import { InternetHero } from "./InternetHero";
import { InternetUsage } from "./InternetUsage";
import { PlanSheet } from "./PlanSheet";
import { SpeedHistory } from "./SpeedHistory";

export function InternetPage(_props: PageProps) {
  const internet = useQuery<Internet>("internet.get", undefined, { poll: true });
  return (
    <>
      <TopBarSubtitle>
        <Freshness at={internet.fetchedAt} />
      </TopBarSubtitle>
      <InternetHero />
      <Connection />
      <SpeedHistory />
      <EarlierTests />
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
