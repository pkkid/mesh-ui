/**
 * Wi-Fi: the main network's name, password (revealed only on request), QR
 * block, security per band, bands and their clients, nickname and time zone.
 * Read-only for now: every change is a disabled "Coming soon" control until
 * the write commands land. Layout, data and states: docs/ux/pages/wifi.md and
 * docs/mockups/12-wifi-settings.html.
 *
 * The password and the `WIFI:` payload come from the sensitive commands
 * (`wifi.password.get`, `wifi.share`), run with `execute` on an explicit
 * reveal, copy or "Show code", held only in this page's state and dropped on
 * a network switch or when the page unmounts. They never enter the query
 * store, so nothing polls them.
 */
import { CalendarClock, Clock, Tag } from "lucide-react";
import { useEffect, useState } from "react";

import type { PageProps } from "~/app/routes";
import { execute, useQuery } from "~/app/useCommand";
import { Card, Section } from "~/components/ui/card";
import { ComingSoonButton, SectionError, useNow } from "~/components/ui/page";
import { TopBarSubtitle } from "~/features/shell/TopBar";
import { formatRelative, networkClock } from "../../../../core/format";
import type { DeviceList, Network, NetworkHealth, WifiSettings, WifiShare } from "../../../../core/model";

import { WifiBands } from "./WifiBands";
import { WifiHero } from "./WifiHero";
import { ReadField, WifiNamePassword, WifiSecurity } from "./WifiSecurity";

export type Reveal = {
  share: WifiShare | null;
  loading: boolean;
  error: string | null;
  /** Reads `wifi.share` once; later calls reuse it. Returns null on failure. */
  load: () => Promise<WifiShare | null>;
};

/** The password and QR payload, read only when asked for and kept for this network only. */
function useReveal(networkId: string | null): Reveal {
  const [state, setState] = useState<{ net: string | null; share: WifiShare | null; loading: boolean; error: string | null }>({
    net: networkId,
    share: null,
    loading: false,
    error: null,
  });
  // A network switch drops what was revealed for the old one.
  useEffect(() => setState({ net: networkId, share: null, loading: false, error: null }), [networkId]);
  const share = state.net === networkId ? state.share : null;
  const load = async () => {
    if (share) return share;
    setState((s) => ({ ...s, loading: true, error: null }));
    const res = await execute<WifiShare>("wifi.share");
    if (!res.ok) {
      setState((s) => ({ ...s, loading: false, error: res.error.message }));
      return null;
    }
    setState({ net: networkId, share: res.result, loading: false, error: null });
    return res.result;
  };
  return { share, loading: state.loading, error: state.error, load };
}

export function WifiPage(_props: PageProps) {
  const wifi = useQuery<WifiSettings>("wifi.get", undefined, { poll: true });
  const network = useQuery<Network>("network.get", undefined, { poll: true });
  const health = useQuery<NetworkHealth>("network.health", undefined, { poll: true });
  const devices = useQuery<DeviceList>("device.list", {}, { poll: true });
  const reveal = useReveal(network.data?.id ?? null);

  const offline = health.data?.status === "offline" || network.data?.status === "offline";
  const data = wifi.data ?? null;

  return (
    <>
      <TopBarSubtitle>
        <Freshness at={wifi.fetchedAt} />
      </TopBarSubtitle>

      <WifiHero wifi={data} network={network.data ?? null} offline={offline} reveal={reveal} fading={wifi.fading} />

      {wifi.error && !data ? (
        <SectionError what="Wi-Fi settings" error={wifi.error} onRetry={() => void wifi.refetch()} />
      ) : (
        <>
          <WifiNamePassword wifi={data} reveal={reveal} />
          <WifiSecurity wifi={data} devices={devices.data?.devices ?? null} offline={offline} />
          <WifiBands wifi={data} offline={offline} fading={wifi.fading} />
        </>
      )}

      <Nickname network={network.data ?? null} />
    </>
  );
}

/** Network nickname and time zone, with the local time there. Both change later ("Coming soon"). */
function Nickname({ network }: { network: Network | null }) {
  const now = useNow(30_000);
  const tz = network?.timezone ?? null;
  const local = tz ? networkClock(tz).time(now) : null;
  return (
    <Section title="Nickname and location" subtitle="Shown under the network name and in the network switcher">
      <Card padded className="flex flex-col gap-4">
        <div className="grid gap-4 md:grid-cols-2">
          <ReadField
            icon={Tag}
            label="Network nickname"
            value={network?.nickname ?? null}
            hint="Helps tell networks apart on accounts with more than one"
          />
          <ReadField icon={Clock} label="Time zone" value={tz} hint={local ? `Local time ${local}` : null} />
        </div>
        <div className="flex items-center gap-3 text-[13px]">
          <CalendarClock aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 text-muted-foreground">Profile schedules, power saving and updates follow this time zone.</span>
          <ComingSoonButton size="sm" variant="outline">
            Edit
          </ComingSoonButton>
        </div>
      </Card>
    </Section>
  );
}

/** "Updated just now", counting up between polls. */
function Freshness({ at }: { at: number | null }) {
  const now = useNow(15_000);
  if (at === null) return null;
  return <>Updated {formatRelative(new Date(at).toISOString(), now)}</>;
}
