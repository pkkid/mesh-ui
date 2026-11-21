/**
 * Reservations & ports: a flat hero (status and routing mode, counts, the
 * public IP; Good to know on the right), then the LAN address map, IPv4
 * reservations, port forwards and IPv6 firewall rules in one full-width
 * column, each joined to devices in core. Add,
 * edit, the Enabled switch and remove run the routing writes through the
 * sheets in RuleSheet.tsx. The three lists come from one cached routing
 * read and poll, so rules changed in the eero app show up. Layout, data and
 * states: docs/ux/pages/reservations-ports.md and
 * docs/mockups/14-reservations-ports.html.
 */
import { pathFor } from "~/app/router";
import type { PageProps } from "~/app/routes";
import { useQuery } from "~/app/useCommand";
import { Card, Empty } from "~/components/ui/card";
import { Metric, PageHeader } from "~/components/ui/hero";
import { SectionLink } from "~/components/ui/page";
import { networkStatus, Status } from "~/components/ui/status";
import { entityColors } from "~/lib/chartColors";
import type { ForwardList, PinholeList, ReservationList } from "../../../../core/commands/routing";
import { formatCount } from "../../../../core/format";
import type { ConnectionMode, DeviceList, Eero, Internet, Network, NetworkSettings } from "../../../../core/model";

import { Forwards } from "./Forwards";
import { LanMap } from "./LanMap";
import { Pinholes } from "./Pinholes";
import { type Lookup, Reservations } from "./Reservations";

const MODE_LABEL: Record<ConnectionMode, string> = { nat: "NAT mode", bridged: "bridge mode", ipPassthrough: "IP passthrough mode" };
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function PortsPage(_: PageProps) {
  const network = useQuery<Network>("network.get", undefined, { poll: true });
  const reservations = useQuery<ReservationList>("reservation.list", undefined, { poll: true });
  const forwards = useQuery<ForwardList>("forward.list", undefined, { poll: true });
  const pinholes = useQuery<PinholeList>("pinhole.list", undefined, { poll: true });
  const devices = useQuery<DeviceList>("device.list", undefined, { poll: 60 });
  // IPv6 off: no firewall rules section, and no IPv6 rules fact (the same cached read Pinholes uses).
  const ipv6Off = useQuery<NetworkSettings>("settings.get", undefined, { poll: true }).data?.ipv6.enabled === false;
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

  const offline = network.data?.status === "offline";
  const status = network.data ? networkStatus(network.data.status) : null;
  const r = reservations.data?.reservations;
  const f = forwards.data?.forwards;
  const p = pinholes.data?.pinholes;
  const fOn = f?.filter((x) => x.enabled).length ?? 0;
  const publicIp = internet.data?.publicIpv4 ?? null;

  return (
    <>
      <PageHeader
        flat
        data-slot="ports-hero"
        title="Reservations & ports"
        status={
          status ? (
            <>
              <Status tone={status.tone}>{status.label}</Status>
              {mode && <span>{capital(MODE_LABEL[mode])}</span>}
              {offline && <span className="basis-full">{network.data?.name} is offline. These are the addresses and rules eero last reported.</span>}
            </>
          ) : null
        }
        facts={
          unavailable ? undefined : (
            <>
              <Metric label="Reservations" value={r ? formatCount(r.length) : null} />
              <Metric label="Port forwards" value={f ? <>{formatCount(f.length)}{f.length > 0 && <span className="font-normal text-muted-foreground text-xs"> · {formatCount(fOn)} on</span>}</> : null} />
              {!ipv6Off && <Metric label="IPv6 rules" value={p ? formatCount(p.length) : null} />}
              <Metric label="Public IP" value={publicIp ? <span className="font-mono text-[15px]">{publicIp}</span> : internet.data ? "-" : null} />
            </>
          )
        }
        aside={<GoodToKnow publicIp={publicIp} bridged={mode !== null && mode !== "nat"} />}
      />
      {unavailable ? (
        <Card>
          <Empty className="flex flex-col items-center gap-2">
            <span>{unavailable}</span>
            <SectionLink to={pathFor("advanced")}>View advanced networking</SectionLink>
          </Empty>
        </Card>
      ) : (
        <div className="flex flex-col gap-14">
          <LanMap query={reservations} />
          <Reservations query={reservations} lookup={lookup} />
          <Forwards query={forwards} lookup={lookup} publicIp={publicIp} />
          <Pinholes query={pinholes} lookup={lookup} />
        </div>
      )}
    </>
  );
}

/** The hero's right-hand column, flat under a title like Advanced networking's How changes apply. */
function GoodToKnow({ publicIp, bridged }: { publicIp: string | null; bridged: boolean }) {
  return (
    <div data-slot="good-to-know" className="flex w-72 flex-col gap-2 text-xs">
      <h2 className="font-semibold text-base text-foreground leading-7">Good to know</h2>
      <div className="flex flex-col gap-2 text-muted-foreground">
        <p>A port forward needs a reservation. Picking a device that has none creates one. These changes apply instantly and never restart eeros.</p>
        <p>Hairpin NAT is always on, so {publicIp ? <span className="font-mono text-foreground/80">{publicIp}</span> : "your public address"} also works from inside the house.</p>
        {/* Only worth saying while it is true. */}
        {bridged && <p>Forwards and reservations are off in bridge mode.</p>}
      </div>
    </div>
  );
}
