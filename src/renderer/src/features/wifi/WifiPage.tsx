/**
 * Wi-Fi: the main network's name, password (revealed only on request), QR
 * block, security per band, bands and their clients, nickname and time zone.
 * Read-only for now: every change is a disabled "Coming soon" control until
 * the write commands land. Layout, data and states: docs/ux/pages/wifi.md and
 * docs/mockups/12-wifi-settings.html.
 *
 * The password comes from `wifi.password.get` (reveal or copy) and the QR
 * payload from `wifi.share` ("Show code"), each run with `execute` only when
 * asked, held only in this page's state and dropped on a network switch or
 * when the page unmounts. They never enter the query
 * store, so nothing polls them.
 */
import { CalendarClock, Clock, Tag } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { PageProps } from "~/app/routes";
import { bridge, execute, useQuery } from "~/app/useCommand";
import { Card, Section } from "~/components/ui/card";
import { ComingSoonButton, SectionError, useNow } from "~/components/ui/page";
import { TopBarSubtitle } from "~/features/shell/TopBar";
import { formatRelative, networkClock } from "../../../../core/format";
import type { WifiPassword } from "../../../../core/commands/wifi";
import type { DeviceList, Network, NetworkHealth, WifiSettings, WifiShare } from "../../../../core/model";

import { WifiBands } from "./WifiBands";
import { WifiHero } from "./WifiHero";
import { ReadField, WifiNamePassword, WifiSecurity } from "./WifiSecurity";

/** A credential read on demand: `wifi.password.get` for the password field, `wifi.share` for the QR block. */
export type Secret<R> = {
  value: R | null;
  loading: boolean;
  error: string | null;
  /** Reads once for this network; later calls reuse it. Returns null on failure or after a network switch. */
  load: () => Promise<R | null>;
  clear: () => void;
};

type SecretState<R> = { value: R | null; loading: boolean; error: string | null };
const NONE = { value: null, loading: false, error: null };

/**
 * Runs a sensitive command only when asked, for an explicit network, and keeps
 * the answer in this component only. A network switch (the host's
 * `network.selected`, or a new `networkId`) drops it, and an answer that
 * arrives after a switch is discarded.
 */
function useSecret<R>(id: string, networkId: string | null): Secret<R> {
  const [state, setState] = useState<SecretState<R>>(NONE);
  const generation = useRef(0);
  const clear = useCallback(() => {
    generation.current += 1;
    setState(NONE);
  }, []);
  useEffect(() => clear, [networkId, clear]);
  // The network the host switched to; until network.get catches up, `networkId` is still the old one.
  const selected = useRef<string | null>(null);
  useEffect(
    () =>
      bridge().on?.((e) => {
        if (e.type !== "network.selected") return;
        selected.current = e.networkId;
        clear();
      }),
    [clear],
  );
  const load = async (): Promise<R | null> => {
    if (state.value) return state.value;
    if (!networkId || (selected.current !== null && selected.current !== networkId)) return null;
    const gen = generation.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    const res = await execute<R>(id, { networkId });
    if (gen !== generation.current) return null;
    setState(res.ok ? { value: res.result, loading: false, error: null } : { value: null, loading: false, error: res.error.message });
    return res.ok ? res.result : null;
  };
  return { ...state, load, clear };
}

export function WifiPage(_props: PageProps) {
  const wifi = useQuery<WifiSettings>("wifi.get", undefined, { poll: true });
  const network = useQuery<Network>("network.get", undefined, { poll: true });
  const health = useQuery<NetworkHealth>("network.health", undefined, { poll: true });
  const devices = useQuery<DeviceList>("device.list", {}, { poll: true });
  const networkId = network.data?.id ?? null;
  const password = useSecret<WifiPassword>("wifi.password.get", networkId);
  const share = useSecret<WifiShare>("wifi.share", networkId);

  const offline = health.data?.status === "offline" || network.data?.status === "offline";
  const data = wifi.data ?? null;

  return (
    <>
      <TopBarSubtitle>
        <Freshness at={wifi.fetchedAt} />
      </TopBarSubtitle>

      <WifiHero wifi={data} network={network.data ?? null} offline={offline} share={share} password={password} fading={wifi.fading} />

      {wifi.error && !data ? (
        <SectionError what="Wi-Fi settings" error={wifi.error} onRetry={() => void wifi.refetch()} />
      ) : (
        <>
          <WifiNamePassword wifi={data} password={password} />
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
