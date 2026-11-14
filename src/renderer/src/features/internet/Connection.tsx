/**
 * Internet "Connection": the gateway line, Copy details (the plain-text block
 * from `internet.get {format: "text"}`), and the Internet provider and
 * Addressing cards; the Plan row opens the plan sheet. docs/ux/pages/internet.md (Layout 2, States).
 */
import { Check, Copy, Globe, Network as NetworkIcon, Settings2 } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { pathFor } from "~/app/router";
import { execute, useQuery } from "~/app/useCommand";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, Section } from "~/components/ui/card";
import { IconTile } from "~/components/ui/hero";
import { type KvItem, KvList } from "~/components/ui/kv-list";
import { HeaderLink, SectionError, useNow } from "~/components/ui/page";
import { Status } from "~/components/ui/status";
import { copyText } from "~/lib/clipboard";
import { cn } from "~/lib/utils";
import { formatMbps, formatRelative } from "../../../../core/format";
import type { Internet, Network, NetworkHealth } from "../../../../core/model";

import { openPlanSheet } from "./PlanSheet";

const WAN_LABEL: Record<NonNullable<Internet["wanType"]>, string> = { dhcp: "DHCP", static: "Static", pppoe: "PPPoE" };

/** A port speed as an Ethernet rate: "10 GbE", "2.5 GbE", "100 Mbps". */
function portLabel(mbps: number | null): string | null {
  if (mbps === null) return null;
  return mbps >= 1000 ? `${mbps / 1000} GbE` : formatMbps(mbps);
}

/**
 * A small header button that runs `load` and copies its text, then reads
 * `done` for a moment (there is no toast yet). Failures read "Couldn't copy".
 */
export function CopyCommandButton({ load, idle, done, icon }: { load: () => Promise<string | null>; idle: string; done: string; icon: ReactNode }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "failed">("idle");
  useEffect(() => {
    if (state !== "done" && state !== "failed") return;
    const t = setTimeout(() => setState("idle"), 1600);
    return () => clearTimeout(t);
  }, [state]);
  return (
    <Button
      size="xs"
      variant="outline"
      disabled={state === "busy"}
      onClick={() => {
        setState("busy");
        void load()
          .then((text) => (text === null ? false : copyText(text)))
          .then((ok) => setState(ok ? "done" : "failed"));
      }}
    >
      {state === "done" ? <Check /> : icon}
      {state === "done" ? done : state === "failed" ? "Couldn't copy" : idle}
    </Button>
  );
}

export function Connection() {
  const internet = useQuery<Internet>("internet.get", undefined, { poll: true });
  const network = useQuery<Network>("network.get", undefined, { poll: true });
  const health = useQuery<NetworkHealth>("network.health", undefined, { poll: true });
  const now = useNow();

  const i = internet.data;
  const n = network.data;
  const bridged = n?.connectionMode === "bridged";
  const offline = n?.status === "offline" || i?.status === "offline";
  const gw = i?.gateway;
  const port = portLabel(gw?.wanPortSpeedMbps ?? null);
  const subtitle = gw
    ? `Gateway: ${gw.location}${gw.model ? ` (${gw.model})` : ""}${port ? `, WAN port ${port}` : ""}`
    : undefined;

  const tools = (
    <>
      <CopyCommandButton
        icon={<Copy />}
        idle="Copy details"
        done="Details copied"
        load={async () => {
          const r = await execute<string>("internet.get", { format: "text" });
          return r.ok ? r.result : null;
        }}
      />
      <HeaderLink to={pathFor("advanced")} arrow>
        <Settings2 />
        ISP settings
      </HeaderLink>
    </>
  );

  if (internet.error && !i) {
    return (
      <Section title="Connection" tools={tools}>
        <SectionError what="the connection" error={internet.error} onRetry={() => void internet.refetch()} />
      </Section>
    );
  }

  const geo = i ? i.isp.name !== null || i.isp.org !== null : true;
  const place = i ? [[i.isp.city, i.isp.region].filter(Boolean).join(", "), i.isp.country].filter(Boolean).join(" · ") : null;
  const v6Off = !!i && i.publicIpv6 === null && i.ipv6Prefix === null;
  const v6 = (value: string | null | undefined): ReactNode =>
    v6Off ? <span className="text-muted-foreground">IPv6 is off</span> : value;

  const provider: KvItem[] = [
    { label: "ISP", value: i?.isp.name },
    ...(geo ? [{ label: "Organisation", value: i?.isp.org }, { label: "ASN", value: i?.isp.asn, mono: true }] : []),
    { label: "Location", value: place },
    {
      label: "Plan",
      value: i?.planMbps ? (
        <span className="inline-flex items-center gap-1.5">
          {formatMbps(i.planMbps.down)} / {formatMbps(i.planMbps.up)}
          <Badge>set by you</Badge>
          <button type="button" className="text-muted-foreground text-xs hover:text-foreground hover:underline" onClick={openPlanSheet}>
            Change
          </button>
        </span>
      ) : i ? (
        <span className="inline-flex items-center gap-1.5">
          <span className="text-muted-foreground">Not set</span>
          <button type="button" className="text-muted-foreground text-xs hover:text-foreground hover:underline" onClick={openPlanSheet}>
            Set your plan
          </button>
        </span>
      ) : null,
    },
  ];

  const addressing: KvItem[] = [
    {
      label: "WAN type",
      value: i?.wanType ? WAN_LABEL[i.wanType] : null,
    },
    { label: "Public IPv4", value: i?.publicIpv4, mono: true, copy: true },
    { label: "Public IPv6", value: v6(i?.publicIpv6), mono: !v6Off, copy: v6Off ? false : true },
    { label: "IPv6 prefix", value: v6(i?.ipv6Prefix), mono: !v6Off, copy: v6Off ? false : true },
    { label: "ISP gateway", value: i?.ispGateway, mono: true, copy: true },
    {
      label: "DNS in use",
      value: i?.dnsInUse.length ? (
        <span className="inline-flex items-center gap-1.5">
          <span className="font-mono text-xs">{i.dnsInUse.join(", ")}</span>
          {i.dnsMode && <Badge>{i.dnsMode === "automatic" ? "ISP auto" : "Custom"}</Badge>}
        </span>
      ) : null,
    },
    ...(bridged
      ? []
      : [
          {
            label: "Double NAT",
            value:
              i?.doubleNat == null ? null : i.doubleNat ? (
                <span className="text-warning">Detected</span>
              ) : (
                <span className="text-success">Not detected</span>
              ),
          },
        ]),
  ];

  const ispUp = health.data?.internet.ispUp;
  const asOf = offline && n?.lastSeen ? `as of ${formatRelative(n.lastSeen, now, n.timezone ?? "UTC")}` : null;

  return (
    <Section title="Connection" subtitle={subtitle} tools={tools}>
      <div className={cn("grid gap-4 transition-opacity lg:grid-cols-2", (internet.fading || offline) && "opacity-60")}>
        <ConnectionCard
          icon={Globe}
          title="Internet provider"
          sub={asOf ?? "From geo IP lookup"}
          badge={
            ispUp == null || offline ? null : ispUp ? <Status tone="success">ISP up</Status> : <Status tone="destructive">ISP down</Status>
          }
          items={provider}
        />
        <ConnectionCard
          icon={NetworkIcon}
          title="Addressing"
          sub={asOf ?? "WAN address and DNS in use"}
          badge={n?.connectionMode ? <Badge>{bridged ? "Bridge mode" : "NAT mode"}</Badge> : null}
          items={addressing}
        />
      </div>
    </Section>
  );
}

function ConnectionCard({
  icon,
  title,
  sub,
  badge,
  items,
}: {
  icon: typeof Globe;
  title: string;
  sub: string;
  badge: ReactNode;
  items: KvItem[];
}) {
  return (
    <Card padded className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <IconTile icon={icon} />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-sm">{title}</div>
          <div className="text-muted-foreground text-xs">{sub}</div>
        </div>
        {badge}
      </div>
      <KvList items={items} />
    </Card>
  );
}
