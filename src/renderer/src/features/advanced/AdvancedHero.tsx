/**
 * Advanced networking hero (docs/ux/pages/advanced-networking.md, Layout 1):
 * the flat page header. Title is the page name; the status line is the
 * network's status and ISP, with a line under it saying which of eero's
 * connection modes it runs in (router, bridge, IP passthrough);
 * facts are the WAN address, DHCP, DNS and IPv6 as they are now. The right
 * column is "How changes apply" (PendingPanel), which becomes the pending
 * change's impact while a restarting change waits on its confirm.
 */
import { Metric, PageHeader } from "~/components/ui/hero";
import { networkStatus, Status } from "~/components/ui/status";
import { cn } from "~/lib/utils";
import type { ConnectionMode, Internet, Network, NetworkSettings } from "../../../../core/model";

import { PendingPanel } from "./ImpactPanel";

/** The line under the status: which of eero's connection modes the network is in, and what that means. */
const MODE_LINE: Record<ConnectionMode, string> = {
  nat: "Your eeros are running in router mode: they hand out addresses and handle NAT.",
  bridged: "Your eeros are running in bridge mode: another router hands out addresses, so profiles, reservations and port forwards are off.",
  ipPassthrough: "Your eeros are running in IP passthrough mode: the public address passes straight through, so profiles, reservations and port forwards are off.",
};

const mono = (text: string) => <span className="font-mono text-[15px]">{text}</span>;

export function AdvancedHero({
  network,
  internet,
  settings,
  fading,
  offline,
  bridged,
}: {
  network: Network | undefined;
  internet: Internet | undefined;
  settings: NetworkSettings | undefined;
  fading: boolean;
  offline: boolean;
  bridged: boolean;
}) {
  const s = settings;
  const mode = s?.connectionMode ?? network?.connectionMode ?? null;
  const status = network ? networkStatus(network.status) : null;
  const isp = internet?.isp.name ?? null;
  const dns = s ? (s.dns.mode === "custom" ? (s.dns.servers.length ? s.dns.servers.join(", ") : "Custom") : "ISP default") : null;
  return (
    <PageHeader
      flat
      data-slot="advanced-hero"
      className={cn("transition-opacity", fading && "opacity-40")}
      title="Advanced networking"
      status={
        status ? (
          <>
            <Status tone={status.tone}>{status.label}</Status>
            {isp && <span>{isp}</span>}
            {/* Its own line under the status (the status row wraps). */}
            {mode && <span className="basis-full">{MODE_LINE[mode]}</span>}
          </>
        ) : null
      }
      facts={
        <>
          <Metric label="WAN IP" value={internet?.publicIpv4 ? mono(internet.publicIpv4) : internet ? "-" : null} />
          <Metric label="DHCP" value={s ? (bridged ? "Off (bridge)" : s.dhcp.mode === "custom" ? "Manual range" : "Automatic") : null} />
          <Metric label="DNS" value={s ? (bridged ? "Off (bridge)" : s.dns.mode === "custom" ? mono(dns ?? "Custom") : dns) : null} />
          <Metric label="IPv6" value={s ? (s.ipv6.enabled === true ? "On" : s.ipv6.enabled === false ? "Off" : "-") : null} />
        </>
      }
      aside={<PendingPanel offline={offline} bridged={bridged} />}
    />
  );
}
