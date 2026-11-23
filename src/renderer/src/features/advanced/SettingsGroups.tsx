/**
 * Advanced networking groups: Internet, Network services, Wireless and the
 * Danger zone, plus the row pieces PowerSaving, ThreadCard and Integrations
 * share.
 *
 * Internet and Network services are live (M5.2): IPv6, UPnP, SQM and DNS
 * caching are switches; DHCP, NAT port mode and DNS are segmented choices;
 * the ISP settings, a manual DHCP range and custom DNS open sheets with the
 * impact panel. Every write runs through useWrite: restarting ones confirm
 * inline with core's `settings.impact` message (bridge mode in the dialog),
 * and the side panel shows the pending change. Gates come from each
 * command's spec (`useGate(id)`), plus offline. In bridge mode the NAT-only
 * rows (NAT port mode, DNS, caching, UPnP, SQM) are hidden.
 * Wireless (M5.3): multi-link operation (segmented, confirm dialog), client
 * steering, fast roaming, legacy device mode (confirm dialog) and the Thread
 * card (ThreadCard.tsx); Simple Setup is a live switch with Undo. The danger
 * zone lives in DangerZone.tsx. Layout: docs/ux/pages/advanced-networking.md,
 * mockup 13.
 */
import { ChevronRight, Pencil } from "lucide-react";
import { Children, createContext, type ReactNode, use, useEffect, useId, useState } from "react";

import { Link, pathFor } from "~/app/router";
import { type ConfirmIn, fieldErrors, type Gate, useWrite, type WriteOptions, type WriteState } from "~/app/useWrite";
import { Badge } from "~/components/ui/badge";
import { Card, Section } from "~/components/ui/card";
import { WriteConfirmDialog } from "~/components/ui/confirm";
import { Input } from "~/components/ui/input";
import { useQuery } from "~/app/useCommand";
import { Footnote, GatedButton, SectionLink, useGate } from "~/components/ui/page";
import { type SegmentedOption } from "~/components/ui/segmented";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Sheet, SheetField } from "~/components/ui/sheet";
import { Switch } from "~/components/ui/switch";
import { cn } from "~/lib/utils";
import { dhcpProblem, IMPACT, isIpv4, isIpv6, wanStaticProblem } from "../../../../core/commands/settings";
import { MISSING } from "../../../../core/format";
import type { Internet, Network as NetworkData, NetworkSettings } from "../../../../core/model";
import type { PlaceRule } from "~/features/palette/placeRules";
import { placeAnchor } from "~/lib/places";
import { ImpactPanel, usePendingImpact } from "./ImpactPanel";
import { ThreadCard } from "./ThreadCard";

export { DangerZone } from "./DangerZone";

// ---------------------------------------------------------------------------
// Row pieces

/** "Restarts eeros" after a row's title: plain warning-coloured text, normal weight, no icon or outline. */
export function RestartBadge() {
  return <span className="font-normal text-warning-foreground text-xs">Restarts eeros</span>;
}

/**
 * Rows inside this provider (Advanced networking) fold their sub panel away: a chevron in front of the title opens and
 * closes it, closed by default, each row's state remembered on this computer (localStorage, `mesh-ui:expand:<page>:<title>`).
 * Rows with nothing under them get no chevron. Elsewhere rows always show their sub panel.
 */
const ExpandScope = createContext<string | null>(null);
export function ExpandableRows({ page, children }: { page: string; children: ReactNode }) {
  return <ExpandScope value={page}>{children}</ExpandScope>;
}

function readOpen(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeOpen(key: string, open: boolean) {
  try {
    if (open) localStorage.setItem(key, "1");
    else localStorage.removeItem(key);
  } catch {
    // Storage blocked: the row still opens and closes, it just is not remembered.
  }
}

/** One settings row: title (with badges), muted description, control on the right, optional sub panel below. */
export function Row({
  title,
  badge,
  description,
  control,
  children,
  dim = false,
  expandKey,
  when: _when,
}: {
  title: ReactNode;
  badge?: ReactNode;
  description?: ReactNode;
  control?: ReactNode;
  children?: ReactNode;
  dim?: boolean;
  /** The name this row's open state is remembered under; defaults to the title when it is text. */
  expandKey?: string;
  /** The show-if rule when the page renders this row only sometimes (features/palette/placeRules.ts). Not used at runtime. */
  when?: PlaceRule;
}) {
  const scope = use(ExpandScope);
  const hasBody = Children.toArray(children).length > 0;
  const name = expandKey ?? (typeof title === "string" ? title : null);
  const key = scope && name ? `mesh-ui:expand:${scope}:${name}` : null;
  const foldable = key !== null && hasBody;
  const [open, setOpen] = useState(() => (key ? readOpen(key) : false));
  const bodyId = useId();
  const toggle = () => {
    if (!key) return;
    writeOpen(key, !open);
    setOpen(!open);
  };
  return (
    // T3 Code's SettingsRow: px-4 py-3, title over a muted description, control 32px away. `data-place` is the anchor
    // the search palette's Places jumps to (lib/places.ts).
    <div className="flex flex-col gap-3 px-4 py-3" data-place={placeAnchor(title)}>
      <div className={cn("flex items-center gap-8", dim && "opacity-50")}>
        {foldable && (
          // The chevron sits in front of the title; the title and description move right to make room for it.
          <button
            type="button"
            aria-expanded={open}
            aria-controls={bodyId}
            aria-label={`${open ? "Hide" : "Show"} ${name} details`}
            title={open ? "Hide details" : "Show details"}
            onClick={toggle}
            className="-me-6 -ms-1 grid size-5 shrink-0 cursor-pointer place-items-center self-start rounded-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronRight className={cn("size-4 transition-transform", open && "rotate-90")} />
          </button>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex min-h-5 flex-wrap items-center gap-2 font-medium text-foreground text-sm">
            {title}
            {badge}
          </div>
          {description && <div className="max-w-2xl text-pretty text-muted-foreground text-xs leading-normal">{description}</div>}
        </div>
        {control && <div className="ms-auto flex shrink-0 items-center gap-2.5">{control}</div>}
      </div>
      {foldable ? (
        open && (
          <div id={bodyId} className="ps-6">
            {children}
          </div>
        )
      ) : (
        children
      )}
    </div>
  );
}

/** The indented panel under a row: label over value pairs in a grid. */
export function SubPanel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-xl border border-border/60 bg-muted/20 px-4 py-3.5 sm:ms-0", className)}>{children}</div>;
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

/**
 * A group: section heading with its data-driven description under it, rows in one card with faint dividers, and an
 * optional footnote under the card (design-system.md, Sections and Footnotes).
 */
export function Group({ id, title, description, children, note, when }: { id?: string; title: string; description: string; children: ReactNode; note?: ReactNode; when?: PlaceRule }) {
  return (
    <Section id={id} title={title} description={description} className="gap-[15px]" when={when}>
      <Card className="divide-y divide-border/50">{children}</Card>
      {note && <Footnote>{note}</Footnote>}
    </Section>
  );
}

/**
 * A choice between a few settings values as a dropdown (design-system.md, Buttons and links: dropdowns, not pill
 * toggles). Takes the same props Segmented did, so each option can be disabled with its own tooltip. With `asks`,
 * picking an option opens a confirm or a sheet before anything changes, so each option in the list ends in an
 * ellipsis ("Bridge…"; design-system.md, an ellipsis means "asks first"); the closed dropdown shows the plain name.
 */
export function ChoiceSelect<T extends string>({
  value,
  onValueChange,
  options,
  asks = false,
  className,
  ...props
}: {
  value: T;
  onValueChange: (v: T) => void;
  options: ReadonlyArray<SegmentedOption<T>>;
  asks?: boolean;
  className?: string;
  "aria-label": string;
}) {
  const known = options.some((o) => o.value === value);
  return (
    <Select items={options.map((o) => ({ value: o.value, label: o.label }))} value={known ? value : null} onValueChange={(v) => v && onValueChange(v as T)}>
      <SelectTrigger className={cn("w-40", className)} aria-label={props["aria-label"]} disabled={options.every((o) => o.disabled || o.value === value)}>
        <SelectValue placeholder={MISSING} />
      </SelectTrigger>
      <SelectPopup>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} disabled={o.disabled} title={o.title}>
            {/* The current value does nothing when picked again, so it needs no ellipsis. */}
            {asks && o.value !== value ? `${o.label}\u2026` : o.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

const onOff = (v: boolean | null | undefined) => (v === true ? "On" : v === false ? "Off" : MISSING);

// ---------------------------------------------------------------------------
// Live controls (M5.2): every change runs through the write kit

/** Writes are blocked while the network is offline: they cannot reach the eeros. */
export const OFFLINE = "Your network is offline, changes cannot reach the eeros";

/** Whether the network is offline, from the cached network.get the page already reads. */
export function useOffline(): boolean {
  return useQuery<NetworkData>("network.get").data?.status === "offline";
}

type SettingsWrite<P> = { gate: Gate; write: WriteState<P, NetworkSettings> };

/**
 * One settings write for a control: its gate from the command spec (plus
 * offline), and useWrite with a progress toast whose estimate comes from
 * core's IMPACT table. While its confirm waits, the side panel shows its
 * impact as the pending change.
 */
export function useSettingsWrite<P>(id: string, what: string, offline: boolean, opts: WriteOptions<P, NetworkSettings> & { confirmIn?: ConfirmIn } = {}): SettingsWrite<P> {
  const base = useGate(id);
  const gate = base.allowed && offline ? { allowed: false, reason: OFFLINE } : base;
  const rule = IMPACT[id];
  const write = useWrite<P, NetworkSettings>(id, {
    ...(rule?.restarts ? { progress: `Applying ${what}...`, progressDetail: `Every eero restarts, ${rule.estimate}`, confirm: { confirmLabel: "Apply and restart" } } : {}),
    ...opts,
  });
  usePendingImpact(`${id}|${what}`, id, what, write.asking !== null);
  return { gate, write };
}

/** A switch (ui/switch.tsx) that runs a write: disabled by the gate, with its reason, or while busy. null shows the dashed unknown track. */
export function WriteSwitch({ on, label, gate, busy = false, onToggle, className }: { on: boolean | null | undefined; label: string; gate: Gate; busy?: boolean; onToggle: (next: boolean) => void; className?: string }) {
  return <Switch checked={on} aria-label={label} disabled={!gate.allowed || busy} title={gate.reason} onCheckedChange={onToggle} className={className} />;
}

/** A row whose switch runs one `{enabled}` write. Live ones offer Undo; restarting ones confirm in the dialog. */
export function ToggleRow({
  id,
  value,
  title,
  what,
  description,
  offline,
  badge,
  children,
  when: _when,
}: {
  id: string;
  value: boolean | null | undefined;
  title: string;
  /** The show-if rule (features/palette/placeRules.ts): this row hides itself while eero does not report the value. */
  when?: PlaceRule;
  /** Names the change in toasts and the pending panel: "UPnP". */
  what: string;
  description: ReactNode;
  offline: boolean;
  badge?: ReactNode;
  children?: ReactNode;
}) {
  const restarts = IMPACT[id]?.restarts === true;
  const { gate, write } = useSettingsWrite<{ enabled: boolean }>(id, what, offline);
  // Copy for a live toggle core still confirms (fast roaming); restarting ones keep useSettingsWrite's "Apply and restart".
  const ask = (on: boolean) => (restarts ? {} : { confirm: { title: `Turn ${what.toLowerCase()} ${on ? "on" : "off"}?`, confirmLabel: `Turn ${on ? "on" : "off"}` } });
  const toggle = (enabled: boolean) =>
    void write.run(
      { enabled },
      {
        ...ask(enabled),
        success: `${what} turned ${enabled ? "on" : "off"}`,
        undo: restarts ? undefined : { id, params: { enabled: !enabled }, ...ask(!enabled), success: `${what} turned ${enabled ? "off" : "on"}` },
      },
    );
  // eero does not report this setting on this network (null once loaded): the row is left out, not shown dashed.
  if (value === null) return null;
  return (
    <Row title={title} badge={badge} description={description} control={<WriteSwitch on={value} label={title} gate={gate} busy={write.running} onToggle={toggle} />}>
      {children}
    </Row>
  );
}

/** A labelled input for a sheet, with its problem under it. */
function AddressField({ id, label, value, onChange, error, helper, placeholder }: { id: string; label: string; value: string; onChange: (v: string) => void; error?: string; helper?: ReactNode; placeholder?: string }) {
  return (
    <SheetField label={label} htmlFor={id} error={error} helper={helper}>
      <Input id={id} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value.trim())} autoComplete="off" spellCheck={false} className="font-mono" aria-invalid={error ? true : undefined} />
    </SheetField>
  );
}

// ---------------------------------------------------------------------------
// Internet

const WAN_OPTIONS = [
  { value: "dhcp", label: "DHCP" },
  { value: "static", label: "Static IP" },
  { value: "pppoe", label: "PPPoE" },
] as const;

type WanMode = NetworkSettings["wan"]["mode"];
type WanParams = { mode: WanMode; static?: { ip: string; mask: string; router: string }; pppoe?: { username: string; password: string }; vlan: number | null };

export function InternetGroup({ settings, internet, bridged, offline = false }: { settings: NetworkSettings | undefined; internet: Internet | undefined; bridged: boolean; offline?: boolean }) {
  const s = settings;
  const isp = internet?.isp.name ?? null;
  const v6 = s?.ipv6.enabled;
  const [editing, setEditing] = useState(false);
  const wanGate = useGate("settings.wan.set");
  const gate = wanGate.allowed && offline ? { allowed: false, reason: OFFLINE } : wanGate;
  return (
    <Group title="Internet" description={internetLine(s, internet, isp)}>
      <Row
        title="WAN IP address"
        description={internet?.doubleNat === true ? "Behind another router (double NAT). Some games and port forwards may not work." : internet?.doubleNat === false ? "Public address, not behind another router (no double NAT)" : "Public address of the gateway eero"}
        control={<span className="font-mono text-sm tabular-nums">{internet?.publicIpv4 ?? MISSING}</span>}
      />
      <ToggleRow
        id="settings.ipv6.set"
        value={v6}
        title="IPv6"
        what="IPv6"
        badge={<RestartBadge />}
        description="Global IPv6 addresses for devices that support it"
        offline={offline}
      >
        {v6 === true && !bridged && (
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
      </ToggleRow>
      <Row
        title="ISP settings"
        badge={<RestartBadge />}
        description={isp ? `Only change these if ${isp} asks you to. Wrong values take the network offline.` : "Only change these if your ISP asks you to. Wrong values take the network offline."}
        control={
          <>
            {s && <span className="text-muted-foreground text-xs">{WAN_OPTIONS.find((o) => o.value === s.wan.mode)?.label}</span>}
            <GatedButton variant="outline" gate={gate} disabled={!s} onClick={() => setEditing(true)}>
              <Pencil />
              Edit{"\u2026"}
            </GatedButton>
          </>
        }
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
          <span className="border-t pt-3 text-muted-foreground text-xs">eero does not report the DHCP lease time</span>
        </SubPanel>
      </Row>
      {s && <WanSheet open={editing} onClose={() => setEditing(false)} settings={s} isp={isp} offline={offline} />}
    </Group>
  );
}

function WanSheet({ open, onClose, settings, isp, offline }: { open: boolean; onClose: () => void; settings: NetworkSettings; isp: string | null; offline: boolean }) {
  const w = settings.wan;
  const [mode, setMode] = useState<WanMode>(w.mode);
  const [ip, setIp] = useState("");
  const [mask, setMask] = useState("");
  const [router, setRouter] = useState("");
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [vlanOn, setVlanOn] = useState(false);
  const [vlan, setVlan] = useState("");
  useEffect(() => {
    if (!open) return;
    setMode(w.mode);
    setIp(w.static?.ip ?? "");
    setMask(w.static?.mask ?? "255.255.255.0");
    setRouter(w.static?.router ?? "");
    setUser(w.pppoeUsername ?? "");
    setPassword("");
    setVlanOn(w.vlan !== null);
    setVlan(w.vlan === null ? "" : String(w.vlan));
  }, [open]);

  const { write } = useSettingsWrite<WanParams>("settings.wan.set", "ISP settings", offline, { form: true, confirmIn: "nested", success: "ISP settings saved" });
  const errors = fieldErrors(write.error);
  const staticProblem = mode === "static" ? wanStaticProblem({ ip, mask, router }) : null;
  const vlanNumber = Number(vlan);
  const vlanProblem = vlanOn && !(Number.isInteger(vlanNumber) && vlanNumber >= 1 && vlanNumber <= 4094) ? "VLAN IDs run from 1 to 4094." : undefined;
  const pppoeProblem = mode === "pppoe" && (user === "" || password === "");
  const nextVlan = vlanOn ? vlanNumber : null;
  const dirty =
    mode !== w.mode ||
    nextVlan !== w.vlan ||
    (mode === "static" && (ip !== (w.static?.ip ?? "") || mask !== (w.static?.mask ?? "255.255.255.0") || router !== (w.static?.router ?? ""))) ||
    (mode === "pppoe" && (user !== (w.pppoeUsername ?? "") || password !== ""));
  const show = (field: "ip" | "mask" | "router", value: string) => (value !== "" && staticProblem?.field === field ? staticProblem.message : undefined);

  const params = (): WanParams => ({
    mode,
    ...(mode === "static" ? { static: { ip, mask, router } } : {}),
    ...(mode === "pppoe" ? { pppoe: { username: user, password } } : {}),
    vlan: nextVlan,
  });

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="ISP settings"
      subtitle={`Only change these if ${isp ?? "your ISP"} asks you to · every eero restarts`}
      dirty={dirty}
      valid={!staticProblem && !vlanProblem && !pppoeProblem}
      onSave={() => write.run(params())}
      saves={["settings.wan.set"]}
      saveLabel="Save and restart"
      error={errors._form ?? errors.static ?? errors.pppoe}
    >
      <SheetField label="Connection type">
        <ChoiceSelect<WanMode> aria-label="ISP connection type" value={mode} onValueChange={setMode} options={WAN_OPTIONS} />
      </SheetField>
      {mode === "static" && (
        <div className="grid gap-3 sm:grid-cols-3">
          <AddressField id="wan-ip" label="IP address" value={ip} onChange={setIp} error={show("ip", ip)} placeholder="e.g. 203.0.113.10" />
          <AddressField id="wan-mask" label="Subnet mask" value={mask} onChange={setMask} error={show("mask", mask)} placeholder="e.g. 255.255.255.0" />
          <AddressField id="wan-router" label="Router IP" value={router} onChange={setRouter} error={show("router", router)} placeholder="e.g. 203.0.113.1" />
        </div>
      )}
      {mode === "pppoe" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <SheetField label="PPPoE user name" htmlFor="wan-user">
            <Input id="wan-user" value={user} onChange={(e) => setUser(e.target.value)} autoComplete="off" spellCheck={false} />
          </SheetField>
          <SheetField label="PPPoE password" htmlFor="wan-password" helper="Never shown again or logged">
            <Input id="wan-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          </SheetField>
        </div>
      )}
      {/* A switch row (as a schedule's "Schedule on"); the tag's field appears under it while it is on. */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="font-medium text-sm">Uplink VLAN tag</div>
          <div className="text-muted-foreground text-xs">Only if your ISP tags its traffic</div>
        </div>
        <WriteSwitch on={vlanOn} label="Uplink VLAN tag" gate={{ allowed: true, reason: null }} onToggle={setVlanOn} />
      </div>
      {vlanOn && (
        <SheetField label="VLAN ID" htmlFor="wan-vlan" error={(vlan !== "" ? vlanProblem : undefined) ?? errors.vlan} helper="1 to 4094">
          <Input id="wan-vlan" inputMode="numeric" value={vlan} onChange={(e) => setVlan(e.target.value.replace(/\D/g, ""))} className="w-28 font-mono" aria-invalid={vlanProblem ? true : undefined} />
        </SheetField>
      )}
      <ImpactPanel ids={dirty ? ["settings.wan.set"] : []} />
      <WriteConfirmDialog write={write} />
    </Sheet>
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

type DhcpMode = NetworkSettings["dhcp"]["mode"];
type DhcpParams = { mode: "automatic" | "custom"; subnetIp?: string; subnetMask?: string; startIp?: string; endIp?: string };
type DnsParams = { mode?: "automatic" | "custom"; servers?: string[]; ipv6Servers?: string[]; caching?: boolean };

export function ServicesGroup({ settings, bridged, offline = false, children }: { settings: NetworkSettings | undefined; bridged: boolean; offline?: boolean; children?: ReactNode }) {
  const s = settings;
  const d = s?.dhcp;
  const nat = s?.natRandomization === true ? "randomized" : s?.natRandomization === false ? "direct" : null;
  const [sheet, setSheet] = useState<"dhcp" | "dns" | null>(null);

  const dhcp = useSettingsWrite<DhcpParams>("settings.dhcp.set", "the DHCP change", offline, { success: "DHCP set to automatic" });
  const toNat = useSettingsWrite<{ mode: "nat" }>("settings.connection_mode.set", "router mode", offline, { success: "eero is the router again" });
  const toBridge = useSettingsWrite<{ mode: "bridged" }>("settings.connection_mode.set", "bridge mode", offline, {
    success: "Bridge mode on",
    confirm: { title: "Turn on bridge mode?", confirmLabel: "Bridge and restart" },
  });
  const natWrite = useSettingsWrite<{ randomized: boolean }>("settings.nat_randomization.set", "the NAT port mode", offline);
  const dnsAuto = useSettingsWrite<DnsParams>("settings.dns.set", "ISP default DNS", offline, { success: "DNS set to the ISP default" });
  const caching = useSettingsWrite<DnsParams>("settings.dns.set", "DNS caching", offline);

  const chooseDhcp = (mode: DhcpMode) => {
    if (!d || mode === d.mode) return;
    if (mode === "bridged") return void toBridge.write.run({ mode: "bridged" });
    if (d.mode === "bridged") return void toNat.write.run({ mode: "nat" });
    if (mode === "custom") return setSheet("dhcp");
    void dhcp.write.run({ mode: "automatic" });
  };
  const dhcpOptions = DHCP_OPTIONS.map((o) => {
    const g = o.value === "bridged" || d?.mode === "bridged" ? toBridge.gate : dhcp.gate;
    const busy = dhcp.write.running || toNat.write.running || toBridge.write.running;
    // From bridge mode only Automatic (back to router mode) is offered; a manual range comes after.
    const fromBridge = d?.mode === "bridged" && o.value === "custom";
    return { ...o, disabled: !d || busy || fromBridge || (o.value !== d.mode && !g.allowed) };
  });
  const dhcpReason = d?.mode === "bridged" ? toNat.gate.reason : dhcp.gate.reason;

  return (
    <Group
      title="Network services"
      description={servicesLine(s, bridged)}
      note={bridged ? "In bridge mode another router handles addressing, so NAT, DNS, UPnP, SQM and reservations are off here." : undefined}
    >
      <ToggleRow
        id="settings.simple_setup.set"
        value={s?.simpleSetup}
        title="eero Simple Setup"
        what="eero Simple Setup"
        description="Adds new eero 6 or newer units automatically when they are plugged in by Ethernet"
        offline={offline}
      />
      <Row
        title="DHCP and NAT"
        badge={<RestartBadge />}
        description="Who hands out addresses on your network"
        control={
          <>
            {d?.mode === "custom" && (
              <GatedButton size="xs" variant="outline" gate={dhcp.gate} onClick={() => setSheet("dhcp")}>
                <Pencil />
                Edit range
              </GatedButton>
            )}
            <span title={dhcpReason ?? undefined}>
              <ChoiceSelect<DhcpMode> asks aria-label="DHCP mode" value={(d?.mode ?? "") as DhcpMode} onValueChange={chooseDhcp} options={dhcpOptions} />
            </span>
          </>
        }
      >
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
      {/* Hidden where eero does not report it (null once loaded). */}
      {!bridged && !(s && nat === null) && (
        <Row
          title="NAT port mode" when="natPortMode"
          badge={<RestartBadge />}
          description="Randomized picks unpredictable outbound ports; Direct suits most games"
          control={
            nat === null ? (
              <span className="text-muted-foreground text-xs" title="eero does not report this setting">
                {MISSING}
              </span>
            ) : (
              <span title={natWrite.gate.reason ?? undefined}>
                <ChoiceSelect
                  asks
                  aria-label="NAT port mode"
                  value={nat}
                  onValueChange={(v) => v !== nat && void natWrite.write.run({ randomized: v === "randomized" }, { success: `NAT port mode set to ${v}` })}
                  options={NAT_OPTIONS.map((o) => ({ ...o, disabled: o.value !== nat && (!natWrite.gate.allowed || natWrite.write.running) }))}
                />
              </span>
            )
          }
        >
        </Row>
      )}
      <Row
        title="Reservations and port forwarding"
        description="Fixed addresses for devices and ports opened to the internet"
        dim={bridged}
        control={
          bridged ? (
            <span className="text-muted-foreground text-xs">Not available in bridge mode</span>
          ) : (
            <SectionLink to={pathFor("ports")}>View reservations and ports</SectionLink>
          )
        }
      />
      {!bridged && (
        <>
          <Row
            title="DNS" when="nat"
            badge={<RestartBadge />}
            description="Name servers handed to every device"
            control={
              <>
                {s?.dns.mode === "custom" && (
                  <GatedButton size="xs" variant="outline" gate={dnsAuto.gate} onClick={() => setSheet("dns")}>
                    <Pencil />
                    Edit
                  </GatedButton>
                )}
                <span title={dnsAuto.gate.reason ?? undefined}>
                  <ChoiceSelect
                    asks
                    aria-label="DNS mode"
                    value={s?.dns.mode ?? ("" as "automatic")}
                    onValueChange={(v) => {
                      if (!s || v === s.dns.mode) return;
                      if (v === "custom") setSheet("dns");
                      else void dnsAuto.write.run({ mode: "automatic" });
                    }}
                    options={DNS_OPTIONS.map((o) => ({ ...o, disabled: !s || (o.value !== s.dns.mode && (!dnsAuto.gate.allowed || dnsAuto.write.running)) }))}
                  />
                </span>
              </>
            }
          >
            {s && (
              <SubPanel className="flex flex-col gap-3">
                {s.dns.mode === "custom" ? (
                  <Fields
                    cols={3}
                    items={[
                      { label: "Nameserver 1", value: s.dns.servers[0] },
                      { label: "Nameserver 2", value: s.dns.servers[1] },
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
          {s?.dns.caching !== null && (
          <Row
            title="Local DNS caching" when="dnsCaching"
            badge={<RestartBadge />}
            description="eeros remember lookups for faster browsing"
            control={<WriteSwitch on={s?.dns.caching} label="Local DNS caching" gate={caching.gate} busy={caching.write.running} onToggle={(on) => void caching.write.run({ caching: on }, { success: `DNS caching turned ${on ? "on" : "off"}` })} />}
          >
          </Row>
          )}
          <ToggleRow id="settings.upnp.set" value={s?.upnp} title="UPnP" when="upnp" what="UPnP" description="Lets consoles and apps open ports on their own" offline={offline} />
          <ToggleRow
            id="settings.sqm.set"
            value={s?.sqm}
            title="Optimize for conferencing and gaming (SQM)" when="sqm"
            what="SQM"
            description="Smart queue management keeps calls smooth while others download. Not available in bridge mode."
            offline={offline}
          />
        </>
      )}
      {children}
      {s && <DhcpSheet open={sheet === "dhcp"} onClose={() => setSheet(null)} settings={s} offline={offline} />}
      {s && <DnsSheet open={sheet === "dns"} onClose={() => setSheet(null)} settings={s} offline={offline} />}
    </Group>
  );
}

/** eero's automatic range, the starting point for a manual one. */
const DEFAULT_RANGE = { subnetIp: "192.168.4.0", subnetMask: "255.255.252.0", startIp: "192.168.4.100", endIp: "192.168.7.254" };

function DhcpSheet({ open, onClose, settings, offline }: { open: boolean; onClose: () => void; settings: NetworkSettings; offline: boolean }) {
  const d = settings.dhcp;
  const current = { subnetIp: d.subnetIp ?? DEFAULT_RANGE.subnetIp, subnetMask: d.subnetMask ?? DEFAULT_RANGE.subnetMask, startIp: d.startIp ?? DEFAULT_RANGE.startIp, endIp: d.endIp ?? DEFAULT_RANGE.endIp };
  const [range, setRange] = useState(current);
  useEffect(() => {
    if (open) setRange(current);
  }, [open]);
  const { write } = useSettingsWrite<DhcpParams>("settings.dhcp.set", "the DHCP range", offline, { form: true, confirmIn: "nested", success: "DHCP range saved" });
  const problem = dhcpProblem(range);
  const errors = fieldErrors(write.error);
  const dirty = d.mode !== "custom" || (Object.keys(range) as (keyof typeof range)[]).some((k) => range[k] !== current[k]);
  const field = (key: keyof typeof range, label: string) => (
    <AddressField id={`dhcp-${key}`} label={label} value={range[key]} onChange={(v) => setRange((r) => ({ ...r, [key]: v }))} error={(problem?.field === key ? problem.message : undefined) ?? errors[key]} />
  );
  const gateway = !problem ? range.subnetIp.replace(/\d+$/, (n) => String(Number(n) + 1)) : null;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Manual DHCP range"
      subtitle="Devices get new addresses · every eero restarts"
      dirty={dirty}
      valid={!problem}
      onSave={() => write.run({ mode: "custom", ...range })}
      saves={["settings.dhcp.set"]}
      saveLabel="Save and restart"
      error={errors._form}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {field("subnetIp", "Subnet IP")}
        {field("subnetMask", "Subnet mask")}
        {field("startIp", "Starting IP")}
        {field("endIp", "Ending IP")}
      </div>
      <span className="text-muted-foreground text-xs">{gateway ? `The gateway eero takes ${gateway}. Use a private range: 10.x, 172.16 to 172.31, or 192.168.` : "Use a private range: 10.x, 172.16 to 172.31, or 192.168."}</span>
      <ImpactPanel ids={dirty ? ["settings.dhcp.set"] : []} />
      <WriteConfirmDialog write={write} />
    </Sheet>
  );
}

function DnsSheet({ open, onClose, settings, offline }: { open: boolean; onClose: () => void; settings: NetworkSettings; offline: boolean }) {
  const dns = settings.dns;
  const [one, setOne] = useState("");
  const [two, setTwo] = useState("");
  const [v6, setV6] = useState("");
  useEffect(() => {
    if (!open) return;
    setOne(dns.servers[0] ?? "");
    setTwo(dns.servers[1] ?? "");
    setV6(dns.ipv6Servers[0] ?? "");
  }, [open]);
  const { write } = useSettingsWrite<DnsParams>("settings.dns.set", "custom DNS", offline, { form: true, confirmIn: "nested", success: "Custom DNS saved" });
  const errors = fieldErrors(write.error);
  const bad = (v: string, v6Only = false) => (v === "" ? undefined : (v6Only ? isIpv6(v) : isIpv4(v) || isIpv6(v)) ? undefined : v6Only ? "Not an IPv6 address." : "Not an IPv4 or IPv6 address.");
  const servers = [one, two].filter((x) => x !== "");
  const ipv6Servers = v6 === "" ? [] : [v6];
  const problems = [bad(one), bad(two), bad(v6, true)];
  const dirty = dns.mode !== "custom" || servers.join() !== dns.servers.slice(0, 2).join() || ipv6Servers.join() !== dns.ipv6Servers.slice(0, 1).join();
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Custom DNS"
      subtitle="Name servers for every device · every eero restarts"
      dirty={dirty}
      valid={servers.length > 0 && problems.every((p) => !p)}
      onSave={() => write.run({ mode: "custom", servers, ipv6Servers })}
      saves={["settings.dns.set"]}
      saveLabel="Save and restart"
      error={errors._form}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <AddressField id="dns-1" label="Nameserver 1" value={one} onChange={setOne} error={problems[0] ?? errors.servers} placeholder="e.g. 1.1.1.1" />
        <AddressField id="dns-2" label="Nameserver 2 (optional)" value={two} onChange={setTwo} error={problems[1]} placeholder="e.g. 9.9.9.9" />
      </div>
      <AddressField id="dns-v6" label="IPv6 nameserver (optional)" value={v6} onChange={setV6} error={problems[2] ?? errors.ipv6Servers} placeholder="e.g. 2606:4700:4700::1111" />
      <span className="text-muted-foreground text-xs">{dns.ispServers.length > 0 ? `Your ISP's servers are ${dns.ispServers.join(" and ")}.` : "Choose ISP default to go back to your ISP's servers."}</span>
      <ImpactPanel ids={dirty ? ["settings.dns.set"] : []} />
      <WriteConfirmDialog write={write} />
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Wireless

const MLO_OPTIONS = [
  { value: "disabled", label: "Off" },
  { value: "single", label: "Single link" },
  { value: "multi", label: "Multi-link" },
] as const;

type MloMode = NonNullable<NetworkSettings["mlo"]>;

export function WirelessGroup({ settings }: { settings: NetworkSettings | undefined }) {
  const s = settings;
  const offline = useOffline();
  const mlo = useSettingsWrite<{ mode: MloMode }>("settings.mlo.set", "multi-link operation", offline);
  return (
    <Group title="Wireless" description={wirelessLine(s)}>
      {s?.mlo !== null && (
        <Row
          title="Multi-link operation" when="mlo"
          badge={
            <>
              <Badge variant="outline">Wi-Fi 7</Badge>
              <RestartBadge />
            </>
          }
          description="Wi-Fi 7 devices use several bands at once. Changing it restarts the network and may turn on WPA3."
          control={
            <span title={mlo.gate.reason ?? undefined}>
              <ChoiceSelect<MloMode>
                asks
                aria-label="Multi-link operation"
                value={(s?.mlo ?? "") as MloMode}
                onValueChange={(v) => s && v !== s.mlo && void mlo.write.run({ mode: v }, { success: `Multi-link operation set to ${MLO_OPTIONS.find((o) => o.value === v)?.label.toLowerCase()}` })}
                options={MLO_OPTIONS.map((o) => ({ ...o, disabled: !s || (o.value !== s.mlo && (!mlo.gate.allowed || mlo.write.running)) }))}
              />
            </span>
          }
        >
        </Row>
      )}
      <ToggleRow id="settings.band_steering.set" value={s?.bandSteering} title="Client steering" what="Client steering" description="Nudges devices to the best eero and band" offline={offline} />
      <ToggleRow
        id="settings.fast_transition.set"
        value={s?.fastTransition}
        title="Fast roaming (802.11r)"
        what="Fast roaming"
        description="Phones and laptops hand over between eeros faster"
        offline={offline}
      />
      <ToggleRow
        id="settings.legacy_mode.set"
        value={s?.legacyMode}
        title="Legacy device mode"
        what="Legacy device mode"
        badge={<RestartBadge />}
        description="Connects older devices that cannot detect Wi-Fi 6"
        offline={offline}
      />
      <ThreadCard settings={s} offline={offline} />
      <Row
        title="WPA3"
        description="Set per band on the Wi-Fi network page"
        control={<SectionLink to={pathFor("wifi")}>View Wi-Fi network</SectionLink>}
      />
    </Group>
  );
}

/** "203.0.113.48 on Ziply Fiber, IPv6 on": the address and ISP, then IPv6. */
function internetLine(s: NetworkSettings | undefined, internet: Internet | undefined, isp: string | null): string {
  if (!s && !internet) return "-";
  const where = [internet?.publicIpv4, isp && `on ${isp}`].filter(Boolean).join(" ");
  return [where || null, s ? `IPv6 ${s.ipv6.enabled ? "on" : "off"}` : null, internet?.doubleNat ? "double NAT" : null].filter(Boolean).join(", ") || "-";
}

/** "DHCP automatic, ISP DNS, UPnP on": how addressing and name servers are handed out right now. */
function servicesLine(s: NetworkSettings | undefined, bridged: boolean): string {
  if (!s) return "-";
  if (bridged) return "Bridge mode, another router handles addressing";
  const dhcp = s.dhcp.mode === "custom" ? "DHCP manual range" : "DHCP automatic";
  const dns = s.dns.mode === "custom" ? `custom DNS (${s.dns.servers.length})` : "ISP DNS";
  return [dhcp, dns, s.upnp === null ? null : `UPnP ${s.upnp ? "on" : "off"}`].filter(Boolean).join(", ");
}

/** "Client steering on, Thread on": the radio features that are on. */
function wirelessLine(s: NetworkSettings | undefined): string {
  if (!s) return "-";
  const on = [s.bandSteering && "client steering", s.fastTransition && "fast roaming", s.legacyMode && "legacy device mode", s.thread?.enabled && "Thread"].filter(Boolean) as string[];
  if (on.length === 0) return "Every radio feature off";
  const list = on.length > 1 ? `${on.slice(0, -1).join(", ")} and ${on.at(-1)}` : on[0]!;
  return `${list[0]!.toUpperCase()}${list.slice(1)} on`;
}

export { onOff };
