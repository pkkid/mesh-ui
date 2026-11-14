/**
 * Advanced networking groups: Internet, Network services, Wireless and the
 * Danger zone, plus the row pieces PowerSaving and Integrations share. Read
 * only for now: every switch, segmented choice and button is disabled with a
 * "Coming soon" tooltip until the settings writes and `settings.impact` land
 * (M5). Layout: docs/ux/pages/advanced-networking.md, mockup 13.
 */
import { RotateCcw } from "lucide-react";
import type { ReactNode } from "react";

import { Link, pathFor } from "~/app/router";
import { Badge } from "~/components/ui/badge";
import { Card, Section } from "~/components/ui/card";
import { ComingSoonButton } from "~/components/ui/page";
import { Segmented } from "~/components/ui/segmented";
import { Status } from "~/components/ui/status";
import { cn } from "~/lib/utils";
import { MISSING } from "../../../../core/format";
import type { Internet, NetworkSettings } from "../../../../core/model";

const SOON = "Coming soon";

// ---------------------------------------------------------------------------
// Row pieces

/** A switch that shows a setting's state. Disabled: changes come later. null shows an empty, dashed track. */
export function ReadSwitch({ on, label }: { on: boolean | null | undefined; label: string }) {
  const known = on === true || on === false;
  return (
    <span
      role="switch"
      aria-checked={on === true}
      aria-disabled
      aria-label={label}
      title={known ? SOON : "eero does not report this setting"}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-not-allowed items-center rounded-full border opacity-70",
        on === true ? "border-transparent bg-primary" : "bg-muted",
        !known && "border-dashed",
      )}
    >
      <span className={cn("size-4 rounded-full bg-background shadow-sm transition-transform", on === true ? "translate-x-4" : "translate-x-0.5")} />
    </span>
  );
}

/** A segmented choice with every option disabled, showing the current value. */
export function ReadChoice<T extends string>({ value, options, label }: { value: T | null; options: ReadonlyArray<{ value: T; label: string }>; label: string }) {
  return (
    <span title={SOON}>
      <Segmented<T> aria-label={label} value={(value ?? "") as T} onValueChange={() => {}} options={options.map((o) => ({ ...o, disabled: true }))} />
    </span>
  );
}

export function RestartBadge() {
  return (
    <Badge variant="outline" className="text-warning-foreground">
      <RotateCcw />
      Restarts eeros
    </Badge>
  );
}

/** One settings row: title (with badges), muted description, control on the right, optional sub panel below. */
export function Row({
  title,
  badge,
  description,
  control,
  children,
  dim = false,
}: {
  title: ReactNode;
  badge?: ReactNode;
  description?: ReactNode;
  control?: ReactNode;
  children?: ReactNode;
  dim?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 px-[18px] py-[14px]">
      <div className={cn("flex items-center gap-3.5", dim && "opacity-50")}>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-2 font-medium text-sm">
            {title}
            {badge}
          </div>
          {description && <div className="text-muted-foreground text-xs">{description}</div>}
        </div>
        {control && <div className="ms-auto flex shrink-0 items-center gap-2.5">{control}</div>}
      </div>
      {children}
    </div>
  );
}

/** The indented panel under a row: label over value pairs in a grid. */
export function SubPanel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-xl border bg-muted/30 px-4 py-3.5 sm:ms-0", className)}>{children}</div>;
}

export function Fields({ items, mono = true, cols = 2 }: { items: ReadonlyArray<{ label: string; value: ReactNode; mono?: boolean }>; mono?: boolean; cols?: 2 | 3 }) {
  return (
    <dl className={cn("grid gap-x-6 gap-y-3", cols === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
      {items.map((f) => (
        <div key={f.label} className="flex min-w-0 flex-col gap-1">
          <dt className="text-2xs text-muted-foreground">{f.label}</dt>
          <dd className={cn("truncate text-sm tabular-nums", (f.mono ?? mono) && "font-mono text-xs")}>{f.value === null || f.value === undefined || f.value === "" ? MISSING : f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A group: section heading with its subtitle, rows in one card with faint dividers. */
export function Group({ title, subtitle, children, hint }: { title: string; subtitle: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <Section title={title} subtitle={subtitle}>
      {hint && <div className="text-muted-foreground text-xs">{hint}</div>}
      <Card className="divide-y">{children}</Card>
    </Section>
  );
}

const onOff = (v: boolean | null | undefined) => (v === true ? "On" : v === false ? "Off" : MISSING);

// ---------------------------------------------------------------------------
// Internet

const WAN_OPTIONS = [
  { value: "dhcp", label: "DHCP" },
  { value: "static", label: "Static IP" },
  { value: "pppoe", label: "PPPoE" },
] as const;

export function InternetGroup({ settings, internet, bridged }: { settings: NetworkSettings | undefined; internet: Internet | undefined; bridged: boolean }) {
  const s = settings;
  const isp = internet?.isp.name ?? null;
  const v6 = s?.ipv6.enabled;
  return (
    <Group title="Internet" subtitle={isp ? `How the gateway eero talks to ${isp}` : "How the gateway eero talks to your ISP"}>
      <Row
        title="WAN IP address"
        description={internet?.doubleNat === true ? "Behind another router (double NAT). Some games and port forwards may not work." : internet?.doubleNat === false ? "Public address, not behind another router (no double NAT)" : "Public address of the gateway eero"}
        control={<span className="font-mono text-sm tabular-nums">{internet?.publicIpv4 ?? MISSING}</span>}
      />
      <Row
        title="IPv6"
        badge={<RestartBadge />}
        description="Global IPv6 addresses for devices that support it"
        dim={bridged}
        control={
          <>
            {v6 === true && <Status tone="success">Active</Status>}
            <ReadSwitch on={v6} label="IPv6" />
          </>
        }
      >
        {v6 === true && (
          <SubPanel>
            <Fields
              items={[
                { label: "Delegated prefix", value: internet?.ipv6Prefix },
                { label: "WAN IPv6", value: internet?.publicIpv6 },
                { label: "IPv6 DNS", value: s && s.dns.ipv6Servers.length > 0 ? s.dns.ipv6Servers.join(", ") : "From ISP", mono: !!s && s.dns.ipv6Servers.length > 0 },
                { label: "Firewall rules", value: <Link to={pathFor("ports")} className="underline-offset-2 hover:underline">IPv6 pinholes</Link>, mono: false },
              ]}
            />
          </SubPanel>
        )}
      </Row>
      <Row
        title="ISP settings"
        description={isp ? `Only change these if ${isp} asks you to. Wrong values take the network offline.` : "Only change these if your ISP asks you to. Wrong values take the network offline."}
        control={<ReadChoice value={s?.wan.mode ?? null} options={WAN_OPTIONS} label="ISP connection type" />}
      >
        <SubPanel className="flex flex-col gap-3.5">
          <Fields
            cols={3}
            items={[
              { label: "Uplink VLAN tag", value: s ? (s.wan.vlan === null ? "Off" : String(s.wan.vlan)) : null },
              { label: "Static IP", value: s?.wan.static ? `${s.wan.static.ip} / ${s.wan.static.mask}` : s ? "Not used" : null, mono: !!s?.wan.static },
              { label: "Router IP", value: s?.wan.static?.router ?? (s ? "Not used" : null), mono: !!s?.wan.static },
              { label: "PPPoE username", value: s?.wan.pppoeUsername ?? (s ? "Not used" : null), mono: !!s?.wan.pppoeUsername },
              { label: "PPPoE password", value: s?.wan.mode === "pppoe" ? "••••••••" : s ? "Not used" : null, mono: false },
            ]}
          />
          <div className="flex items-center gap-3 border-t pt-3">
            <span className="text-muted-foreground text-xs">eero does not report the DHCP lease time</span>
            <ComingSoonButton size="xs" variant="outline" className="ms-auto">
              Save settings
            </ComingSoonButton>
          </div>
        </SubPanel>
      </Row>
    </Group>
  );
}

// ---------------------------------------------------------------------------
// Network services

const DHCP_OPTIONS = [
  { value: "automatic", label: "Automatic" },
  { value: "custom", label: "Manual" },
  { value: "bridged", label: "Bridge" },
] as const;

const NAT_OPTIONS = [
  { value: "direct", label: "Direct" },
  { value: "randomized", label: "Randomized" },
] as const;

const DNS_OPTIONS = [
  { value: "automatic", label: "ISP default" },
  { value: "custom", label: "Custom DNS" },
] as const;

export function ServicesGroup({ settings, bridged, children }: { settings: NetworkSettings | undefined; bridged: boolean; children?: ReactNode }) {
  const s = settings;
  const d = s?.dhcp;
  const nat = s?.natRandomization === true ? "randomized" : s?.natRandomization === false ? "direct" : null;
  return (
    <Group
      title="Network services"
      subtitle="Addressing, DNS and traffic handling"
      hint={bridged ? "In bridge mode another router handles addressing, so NAT, DNS, UPnP, SQM and reservations are off here." : undefined}
    >
      <Row title="eero Simple Setup" description="Adds new eero 6 or newer units automatically when they are plugged in by Ethernet" control={<ReadSwitch on={s?.simpleSetup} label="eero Simple Setup" />} />
      <Row title="DHCP and NAT" badge={<RestartBadge />} description="Who hands out addresses on your network" control={<ReadChoice value={d?.mode ?? null} options={DHCP_OPTIONS} label="DHCP mode" />}>
        {d && d.mode !== "bridged" && (
          <SubPanel className="flex flex-col gap-3">
            <Fields
              cols={3}
              items={[
                { label: "Subnet IP", value: d.subnetIp },
                { label: "Subnet mask", value: d.subnetMask },
                { label: "Gateway", value: d.gateway },
                { label: "Starting IP", value: d.startIp },
                { label: "Ending IP", value: d.endIp },
              ]}
            />
            <span className="text-2xs text-muted-foreground">Bridge turns off eero's DHCP and NAT and disables profiles, port forwards and reservations. Hairpin NAT is always on.</span>
          </SubPanel>
        )}
      </Row>
      <Row
        title="NAT port mode"
        badge={<RestartBadge />}
        description="Randomized picks unpredictable outbound ports; Direct suits most games"
        dim={bridged}
        control={<ReadChoice value={nat} options={NAT_OPTIONS} label="NAT port mode" />}
      />
      <Row
        title="Reservations and port forwarding"
        description="Fixed addresses for devices and ports opened to the internet"
        dim={bridged}
        control={
          bridged ? (
            <ComingSoonButton size="xs" variant="outline" title="Not available in bridge mode">
              Manage
            </ComingSoonButton>
          ) : (
            <Link to={pathFor("ports")} className="rounded-(--control-radius) border px-2 py-1 font-medium text-xs hover:bg-muted/50">
              Manage
            </Link>
          )
        }
      />
      <Row title="DNS" badge={<RestartBadge />} description="Name servers handed to every device" dim={bridged} control={<ReadChoice value={s?.dns.mode ?? null} options={DNS_OPTIONS} label="DNS mode" />}>
        {s && !bridged && (
          <SubPanel className="flex flex-col gap-3">
            {s.dns.mode === "custom" ? (
              <Fields
                cols={3}
                items={[
                  { label: "IPv4 nameserver 1", value: s.dns.servers[0] },
                  { label: "IPv4 nameserver 2", value: s.dns.servers[1] },
                  { label: "IPv6 nameserver", value: s.dns.ipv6Servers[0] },
                ]}
              />
            ) : null}
            <span className="text-muted-foreground text-xs">
              {s.dns.ispServers.length > 0 ? `ISP servers: ${s.dns.ispServers.join(" and ")}.` : "eero did not report the ISP's DNS servers."}
            </span>
          </SubPanel>
        )}
      </Row>
      <Row title="Local DNS caching" badge={<RestartBadge />} description="eeros remember lookups for faster browsing" dim={bridged} control={<ReadSwitch on={s?.dns.caching} label="Local DNS caching" />} />
      <Row title="UPnP" description="Lets consoles and apps open ports on their own" dim={bridged} control={<ReadSwitch on={s?.upnp} label="UPnP" />} />
      <Row
        title="Optimize for conferencing and gaming (SQM)"
        description="Smart queue management keeps calls smooth while others download. Not available in bridge mode."
        dim={bridged}
        control={<ReadSwitch on={s?.sqm} label="SQM" />}
      />
      {children}
    </Group>
  );
}

// ---------------------------------------------------------------------------
// Wireless

const MLO_LABEL = { disabled: "Off", single: "Single link", multi: "Multi-link" } as const;

export function WirelessGroup({ settings }: { settings: NetworkSettings | undefined }) {
  const s = settings;
  const t = s?.thread ?? null;
  return (
    <Group title="Wireless" subtitle="Radio features across all eeros">
      {s?.mlo !== null && (
        <Row
          title="Multi-link operation"
          badge={<Badge variant="outline">Wi-Fi 7</Badge>}
          description="Wi-Fi 7 devices use several bands at once. Changing it restarts the network for about 2 minutes and may turn on WPA3."
          control={
            <>
              {s && <span className="text-muted-foreground text-xs">{MLO_LABEL[s.mlo]}</span>}
              <ReadSwitch on={s ? s.mlo !== "disabled" : undefined} label="Multi-link operation" />
            </>
          }
        />
      )}
      <Row title="Client steering" description="Nudges devices to the best eero and band" control={<ReadSwitch on={s?.bandSteering} label="Client steering" />} />
      <Row title="Fast roaming (802.11r)" description="Phones and laptops hand over between eeros faster" control={<ReadSwitch on={s?.fastTransition} label="Fast roaming" />} />
      <Row
        title="Legacy device mode"
        description="Connects older devices that cannot detect Wi-Fi 6. Changing it restarts the network."
        control={<ReadSwitch on={s?.legacyMode} label="Legacy device mode" />}
      />
      {s && !t ? (
        <Row title="Thread" description="This network does not report a Thread border router" dim control={<Status tone="muted">Unavailable</Status>} />
      ) : (
        <Row
          title="Thread"
          badge={t?.enabled ? <Status tone="success">Border router</Status> : undefined}
          description="Low-power mesh for Matter and smart home accessories"
          control={<ReadSwitch on={t?.enabled} label="Thread" />}
        >
          {t && (
            <SubPanel className="flex flex-col gap-3.5">
              <Fields
                items={[
                  { label: "Network name", value: t.name, mono: false },
                  { label: "Channel", value: t.channel === null ? null : String(t.channel) },
                  { label: "PAN ID", value: t.panId },
                  { label: "Extended PAN ID", value: t.xpanId },
                  {
                    label: "Network key",
                    value: (
                      <span className="flex items-center gap-2">
                        <span className="tracking-[0.18em]">••••••••••••••••</span>
                        <ComingSoonButton size="xs" variant="outline">
                          Reveal
                        </ComingSoonButton>
                      </span>
                    ),
                  },
                  { label: "Border agent", value: t.borderAgent },
                ]}
              />
              <div className="flex items-center gap-3 border-t pt-3">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium text-xs">Share credentials with phone keychain</span>
                  <span className="text-2xs text-muted-foreground">Lets iOS and Android add Thread devices to this network</span>
                </div>
                <ReadSwitch on={t.credentialSync} label="Share credentials with phone keychain" />
              </div>
              <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                <ComingSoonButton size="xs" variant="outline">
                  Copy dataset
                </ComingSoonButton>
                <ComingSoonButton size="xs" variant="outline" className="text-destructive-foreground">
                  Regenerate credentials
                </ComingSoonButton>
                <span className="text-2xs text-muted-foreground">Regenerating disconnects every Thread device</span>
              </div>
            </SubPanel>
          )}
        </Row>
      )}
      <Row
        title="WPA3"
        description="Set per band on the Wi-Fi page"
        control={
          <Link to={pathFor("wifi")} className="rounded-(--control-radius) border px-2 py-1 font-medium text-xs hover:bg-muted/50">
            Wi-Fi
          </Link>
        }
      />
    </Group>
  );
}

// ---------------------------------------------------------------------------
// Danger zone

export function DangerZone({ owner, networkName }: { owner: boolean; networkName: string | null }) {
  return (
    <Group title="Danger zone" subtitle="Cannot be undone from here">
      <Row
        title="Restart network"
        badge={<Badge variant="warning">Disruptive</Badge>}
        description="Restarts every eero. Everything is offline for about 8 minutes."
        control={
          <ComingSoonButton size="sm" variant="outline">
            Restart network
          </ComingSoonButton>
        }
      />
      <Row
        title="Delete network"
        badge={<Badge variant="error">Destructive · owner</Badge>}
        description={`Factory-resets every eero and removes ${networkName ?? "this network"}, its profiles, history and admins. Cannot be undone.`}
        control={
          <ComingSoonButton size="sm" variant="destructive" title={owner ? SOON : "Owner only"}>
            Delete network
          </ComingSoonButton>
        }
      />
    </Group>
  );
}

export { onOff };
