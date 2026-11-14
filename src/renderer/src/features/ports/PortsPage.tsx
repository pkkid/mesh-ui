/**
 * Reservations & ports: the LAN address map, IPv4 reservations, port
 * forwards and IPv6 firewall rules, each joined to devices in core. Read-only
 * for now: add, edit, toggle and remove are disabled "Coming soon" controls
 * until their commands land. The three lists come from one cached routing
 * read. Layout, data and states: docs/ux/pages/reservations-ports.md and
 * docs/mockups/14-reservations-ports.html.
 */
import { Info } from "lucide-react";

import { Link, pathFor } from "~/app/router";
import type { PageProps } from "~/app/routes";
import { useQuery } from "~/app/useCommand";
import { Card, Empty } from "~/components/ui/card";
import { entityColors } from "~/lib/chartColors";
import { TopBarSubtitle } from "~/features/shell/TopBar";
import type { ForwardList, PinholeList, ReservationList } from "../../../../core/commands/routing";
import type { ConnectionMode, DeviceList, Eero, Internet, Network } from "../../../../core/model";

import { Forwards } from "./Forwards";
import { LanMap } from "./LanMap";
import { Pinholes } from "./Pinholes";
import { type Lookup, Reservations } from "./Reservations";

const MODE_LABEL: Record<ConnectionMode, string> = { nat: "NAT mode", bridged: "bridge mode", ipPassthrough: "IP passthrough mode" };
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function PortsPage(_: PageProps) {
  const network = useQuery<Network>("network.get", undefined, { poll: true });
  const reservations = useQuery<ReservationList>("reservation.list");
  const forwards = useQuery<ForwardList>("forward.list");
  const pinholes = useQuery<PinholeList>("pinhole.list");
  const devices = useQuery<DeviceList>("device.list", undefined, { poll: 60 });
  const eeros = useQuery<Eero[]>("eero.list", undefined, { poll: true });

  const mode = network.data?.connectionMode ?? null;
  // Core says why routing is off; the network's mode covers the moment before the lists answer.
  const unavailable = reservations.data?.unavailable ?? forwards.data?.unavailable ?? (mode && mode !== "nat" ? `Reservations and port forwards are off in ${MODE_LABEL[mode]}.` : null);
  const internet = useQuery<Internet>("internet.get", undefined, { enabled: network.data !== undefined && !unavailable });

  const byId = new Map((devices.data?.devices ?? []).map((d) => [d.id, d]));
  const colors = entityColors((eeros.data ?? []).map((e) => e.id));
  const eeroById = new Map((eeros.data ?? []).map((e) => [e.id, e]));
  const lookup: Lookup = {
    device: (id) => (id ? byId.get(id) : undefined),
    eero: (id) => {
      const e = id ? eeroById.get(id) : undefined;
      return e ? { name: e.location, color: colors[e.id] ?? "" } : undefined;
    },
  };

  return (
    <>
      {mode && <TopBarSubtitle>{capital(MODE_LABEL[mode])}</TopBarSubtitle>}
      {unavailable ? (
        <Card>
          <Empty className="flex flex-col items-center gap-2">
            <span>{unavailable}</span>
            <Link to={pathFor("advanced")} className="text-foreground text-xs underline-offset-2 hover:underline">
              Advanced networking
            </Link>
          </Empty>
        </Card>
      ) : (
        <div className="grid items-start gap-7 2xl:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="flex min-w-0 flex-col gap-7">
            {network.data?.status === "offline" && (
              <div className="flex items-center gap-2 text-muted-foreground text-xs">
                <Info className="size-3.5 shrink-0" />
                {network.data.name} is offline. These are the addresses and rules eero last reported.
              </div>
            )}
            <LanMap query={reservations} />
            <Reservations query={reservations} lookup={lookup} />
            <Forwards query={forwards} lookup={lookup} publicIp={internet.data?.publicIpv4 ?? null} />
            <Pinholes query={pinholes} lookup={lookup} />
          </div>
          <GoodToKnow publicIp={internet.data?.publicIpv4 ?? null} />
        </div>
      )}
    </>
  );
}

function GoodToKnow({ publicIp }: { publicIp: string | null }) {
  return (
    <aside>
      <Card padded className="flex flex-col gap-3">
        <div className="flex items-center gap-2 font-medium text-sm">
          <Info className="size-4 text-muted-foreground" />
          Good to know
        </div>
        <div className="flex flex-col gap-2 text-foreground/80 text-xs leading-relaxed">
          <p>A port forward needs a reservation. Picking a device that has none creates one.</p>
          <p>Hairpin NAT is always on, so {publicIp ? <span className="font-mono">{publicIp}</span> : "your public address"} also works from inside the house.</p>
          <p>Forwards and reservations are off in bridge mode. These changes apply instantly and never restart eeros.</p>
        </div>
      </Card>
    </aside>
  );
}
