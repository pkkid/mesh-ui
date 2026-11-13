/**
 * The grouped device table (docs/ux/pages/devices.md, Layout 4 and 5). Rows
 * arrive filtered and sorted by `device.list`; this file only groups them
 * (view state), lays out the columns and opens device detail on click.
 * Selection, the bulk bar and the row menu are shown but disabled until the
 * device actions land (M4).
 */
import {
  Ban,
  Bell,
  Bike,
  BookOpen,
  Cable,
  Cast,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Cpu,
  Ellipsis,
  Fan,
  Gamepad2,
  HardDrive,
  History,
  House,
  Info,
  Laptop,
  Lightbulb,
  type LucideIcon,
  Monitor,
  Pause,
  Play,
  Plug,
  Printer,
  Radar,
  Router,
  Shapes,
  Smartphone,
  Speaker,
  Tablet,
  Thermometer,
  Tv,
  UserRoundPlus,
  Users,
  Warehouse,
  Watch,
  Wifi,
  X,
} from "lucide-react";
import { Fragment, type ReactNode, useState } from "react";

import { Link, navigate, pathFor } from "~/app/router";
import { Button } from "~/components/ui/button";
import { Card, Empty } from "~/components/ui/card";
import { IconTile } from "~/components/ui/hero";
import { Status, type StatusTone } from "~/components/ui/status";
import { cn } from "~/lib/utils";
import { formatBytes, formatRelative, mbpsParts } from "../../../../core/format";
import type { Device, DeviceCategory } from "../../../../core/model";

import { COLUMN_LABELS, type ColumnKey, type GroupBy } from "./DeviceFilters";

// ---------------------------------------------------------------------------
// Icons and labels

const TYPE_ICONS: Record<string, LucideIcon> = {
  phone: Smartphone,
  tablet: Tablet,
  watch: Watch,
  ereader: BookOpen,
  laptop: Laptop,
  desktop: Monitor,
  nas: HardDrive,
  printer: Printer,
  tv: Tv,
  media_streamer: Cast,
  game_console: Gamepad2,
  speaker: Speaker,
  thermostat: Thermometer,
  light: Lightbulb,
  plug: Plug,
  garage: Warehouse,
  sensor: Radar,
  smoke_alarm: Bell,
  doorbell: Bell,
  smart_hub: Router,
  air_purifier: Fan,
  fitness: Bike,
  microcontroller: Cpu,
};

const CATEGORY_ICONS: Record<DeviceCategory, LucideIcon> = {
  phones_tablets: Smartphone,
  computers: Laptop,
  entertainment: Tv,
  smart_home: House,
  other: CircleHelp,
};

export function deviceIcon(d: Pick<Device, "type" | "category">): LucideIcon {
  return TYPE_ICONS[d.type] ?? CATEGORY_ICONS[d.category];
}

type DeviceState = "online" | "paused" | "offline" | "blocked";

const deviceState = (d: Device): DeviceState =>
  d.blocked ? "blocked" : !d.connected ? "offline" : d.paused ? "paused" : "online";

const STATE: Record<DeviceState, { tone: StatusTone; label: string }> = {
  online: { tone: "success", label: "Online" },
  paused: { tone: "warning", label: "Paused" },
  offline: { tone: "muted", label: "Offline" },
  blocked: { tone: "destructive", label: "Blocked" },
};

/** "Apple · MacBook Pro", "Unknown manufacturer · random MAC". */
function makerLine(d: Device): string {
  const parts = [d.manufacturer ?? "Unknown manufacturer"];
  if (d.model && d.model.toLowerCase() !== "unknown") parts.push(d.model);
  if (d.privateMac) parts.push("random MAC");
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// Groups (view state)

type Group = { key: string; label: string; icon: LucideIcon; devices: Device[] };

const isOff = (d: Device) => !d.connected && !d.blocked;

function groupDevices(
  devices: ReadonlyArray<Device>,
  by: GroupBy,
  eeroName: ReadonlyMap<string, string>,
  profiles: ReadonlyMap<string, ProfileInfo>,
): Group[] {
  const pick = (pred: (d: Device) => boolean) => devices.filter(pred);
  switch (by) {
    case "none":
      return [{ key: "all", label: "All devices", icon: Shapes, devices: [...devices] }];
    case "category": {
      const live = (cats: DeviceCategory[]) => (d: Device) => d.connected && !d.blocked && cats.includes(d.category);
      return [
        { key: "personal", label: "Computers & Personal", icon: Laptop, devices: pick(live(["phones_tablets", "computers"])) },
        { key: "entertainment", label: "Entertainment", icon: Tv, devices: pick(live(["entertainment"])) },
        { key: "home", label: "Home", icon: House, devices: pick(live(["smart_home"])) },
        { key: "other", label: "Other", icon: Shapes, devices: pick(live(["other"])) },
        { key: "offline", label: "Recently online", icon: History, devices: pick(isOff) },
        { key: "blocked", label: "Blocked", icon: Ban, devices: pick((d) => d.blocked) },
      ];
    }
    case "status":
      return (["online", "paused", "offline", "blocked"] as const).map((s) => ({
        key: s,
        label: STATE[s].label,
        icon: s === "online" ? Wifi : s === "paused" ? Pause : s === "offline" ? History : Ban,
        devices: pick((d) => deviceState(d) === s),
      }));
    case "eero":
    case "profile": {
      const keyOf = (d: Device) => (by === "eero" ? d.eeroId : d.profileId);
      const nameOf = (id: string | null) =>
        by === "eero"
          ? id === null
            ? "Not connected"
            : (eeroName.get(id) ?? id)
          : id === null
            ? "Unassigned"
            : (profiles.get(id)?.name ?? id);
      const groups = new Map<string, Group>();
      for (const d of devices) {
        const id = keyOf(d);
        const key = id ?? "";
        let g = groups.get(key);
        if (!g) groups.set(key, (g = { key, label: nameOf(id), icon: by === "eero" ? Router : Users, devices: [] }));
        g.devices.push(d);
      }
      // Named groups A to Z, the "Not connected" or "Unassigned" bucket last.
      return [...groups.values()].sort((a, b) => (a.key === "" ? 1 : b.key === "" ? -1 : a.label.localeCompare(b.label)));
    }
  }
}

function collapsedLine(g: Group): string {
  const n = g.devices.length;
  const online = g.devices.filter((d) => d.connected && !d.blocked).length;
  const names = g.devices.slice(0, 4).map((d) => d.name);
  const more = n > 4 ? `, +${n - 4}` : "";
  const state = online === n ? "all online" : `${online} online`;
  return `${n} ${n === 1 ? "device" : "devices"} · ${state} · ${names.join(", ")}${more}`;
}

// ---------------------------------------------------------------------------
// Table

export type ProfileInfo = { name: string; color: string };

type DeviceTableProps = {
  devices: ReadonlyArray<Device> | undefined;
  groupBy: GroupBy;
  hidden: ReadonlySet<ColumnKey>;
  eeroName: ReadonlyMap<string, string>;
  profiles: ReadonlyMap<string, ProfileInfo>;
  /** Bytes used today per device id, from `usage.breakdown`. */
  usage: ReadonlyMap<string, number> | undefined;
  newIds: ReadonlySet<string>;
  /** A rates burst is pending: fade the Now column. */
  ratesPending: boolean;
  fading: boolean;
  error: string | null;
  onRetry: () => void;
  filtersActive: boolean;
  onResetFilters: () => void;
  networkName: string | null;
  /** Devices on the whole network (0 means nothing has joined). */
  total: number | undefined;
};

const DEFAULT_COLLAPSED = new Set(["category:home"]);

export function DeviceTable(props: DeviceTableProps) {
  const { devices, groupBy, hidden } = props;
  const [collapsed, setCollapsed] = useState<Set<string>>(DEFAULT_COLLAPSED);
  const show = (c: ColumnKey) => !hidden.has(c);
  // Checkbox, Device, Status and the row menu, plus the optional columns shown.
  const columns = 4 + (Object.keys(COLUMN_LABELS) as ColumnKey[]).filter(show).length;

  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  let body: ReactNode;
  if (props.error && !devices) {
    body = (
      <FullRow columns={columns}>
        <Empty className="flex items-center justify-center gap-3">
          <span>Could not load devices. {props.error}</span>
          <Button variant="outline" size="xs" onClick={props.onRetry}>
            Retry
          </Button>
        </Empty>
      </FullRow>
    );
  } else if (!devices) {
    body = Array.from({ length: 8 }, (_, i) => (
      <tr key={i} className="border-border/50 border-b">
        <td colSpan={columns} className="h-[49px]" />
      </tr>
    ));
  } else if (devices.length === 0) {
    body = (
      <FullRow columns={columns}>
        {props.total === 0 && !props.filtersActive ? (
          <Empty>No devices have joined {props.networkName ?? "this network"} yet.</Empty>
        ) : (
          <Empty className="flex items-center justify-center gap-3">
            <span>No devices match these filters.</span>
            <Button variant="outline" size="xs" onClick={props.onResetFilters}>
              Reset filters
            </Button>
          </Empty>
        )}
      </FullRow>
    );
  } else {
    const groups = groupDevices(devices, groupBy, props.eeroName, props.profiles);
    body = groups.map((g) => {
      // Groups with no devices are left out, whatever the filters.
      if (g.devices.length === 0) return null;
      const key = `${groupBy}:${g.key}`;
      const isCollapsed = collapsed.has(key);
      const Chevron = isCollapsed ? ChevronRight : ChevronDown;
      return (
        <Fragment key={key}>
          {groupBy !== "none" && (
            <tr className="bg-muted">
              <td colSpan={columns} className="p-0">
                <button
                  type="button"
                  aria-expanded={!isCollapsed}
                  onClick={() => toggle(key)}
                  className="flex w-full cursor-pointer items-center gap-1.5 px-2.5 py-2 text-start font-semibold text-3xs text-muted-foreground uppercase tracking-widest outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset [&_svg]:size-[13px]"
                >
                  <Chevron />
                  <g.icon />
                  {g.label}
                  <span className="ms-1.5 min-w-0 truncate font-medium text-muted-foreground/70 normal-case tracking-normal">
                    {isCollapsed ? collapsedLine(g) : g.devices.length}
                  </span>
                  {isCollapsed && <span className="ms-auto font-medium text-foreground/80 normal-case tracking-normal">Expand</span>}
                </button>
              </td>
            </tr>
          )}
          {!isCollapsed && g.devices.map((d) => <Row key={d.id} device={d} show={show} {...props} />)}
        </Fragment>
      );
    });
  }

  const th = "whitespace-nowrap px-2.5 py-[9px] text-start font-normal text-muted-foreground text-xs";
  return (
    <Card>
      <div className="overflow-x-auto">
        <table className={cn("w-full border-collapse text-[12.5px]", props.fading && "opacity-40")} aria-label="Devices">
          <thead>
            <tr className="border-b">
              <th className={cn(th, "w-7")}>
                <Checkbox label="Select all devices" />
              </th>
              <th className={th}>
                <span className="font-medium text-foreground">Device</span>
              </th>
              {show("profile") && <th className={th}>Profile</th>}
              {show("eero") && <th className={th}>Connected to</th>}
              {show("band") && <th className={th}>Band</th>}
              {show("signal") && <th className={th}>Signal</th>}
              {show("addr") && <th className={th}>IP · MAC</th>}
              {show("now") && (
                <th className={th}>
                  Now <span className="text-muted-foreground/70">down / up</span>
                </th>
              )}
              {show("today") && <th className={cn(th, "text-end")}>Today</th>}
              <th className={th}>Status</th>
              <th className={cn(th, "w-6")}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>{body}</tbody>
        </table>
      </div>
      <div className="flex items-center gap-2.5 border-t px-3.5 py-2.5 text-muted-foreground text-xs">
        <Info className="size-3.5 shrink-0" />
        Offline devices drop off the list after 7 days. Paused devices stay connected but have no internet.
        <span className="ms-auto flex shrink-0 items-center gap-1.5">
          <kbd className="rounded-[5px] border px-1.5 font-mono text-2xs">Shift</kbd>click to select a range
        </span>
      </div>
    </Card>
  );
}

function FullRow({ columns, children }: { columns: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={columns}>{children}</td>
    </tr>
  );
}

const SELECT_SOON = "Selecting devices comes with device actions in a later update";

function Checkbox({ label }: { label: string }) {
  return (
    <input
      type="checkbox"
      disabled
      aria-label={label}
      title={SELECT_SOON}
      className="size-3.5 cursor-not-allowed rounded-[4px] border accent-primary opacity-60"
    />
  );
}

type RowProps = DeviceTableProps & { device: Device; show: (c: ColumnKey) => boolean };

function Row({ device: d, show, eeroName, profiles, usage, newIds, ratesPending }: RowProps) {
  const state = deviceState(d);
  const off = state === "offline" || state === "blocked";
  const profile = d.profileId ? profiles.get(d.profileId) : undefined;
  const eero = d.eeroId ? (eeroName.get(d.eeroId) ?? null) : null;
  const used = usage?.get(d.id);
  const to = pathFor("device", { deviceId: d.id });
  const td = "px-2.5 py-[7px] align-middle";

  return (
    <tr
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a,button,input")) return;
        navigate(to);
      }}
      className={cn("cursor-pointer border-border/50 border-b last:border-b-0 hover:bg-muted/50", off && "text-muted-foreground")}
    >
      <td className={td}>
        <Checkbox label={`Select ${d.name}`} />
      </td>
      <td className={td}>
        <div className="flex min-w-0 items-center gap-2.5">
          <IconTile icon={deviceIcon(d)} size="sm" className={cn("size-7", off && "opacity-60")} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <Link to={to} className="truncate font-medium text-foreground outline-none focus-visible:underline">
                {d.name}
              </Link>
              {newIds.has(d.id) && <Tag>NEW</Tag>}
              {d.ssid === "guest" && <Tag muted>GUEST</Tag>}
            </div>
            <div className="max-w-64 truncate text-2xs text-muted-foreground">{makerLine(d)}</div>
          </div>
        </div>
      </td>
      {show("profile") && (
        <td className={td}>
          {profile ? (
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="grid size-5 shrink-0 place-items-center rounded-full font-semibold text-[10px] text-background"
                style={{ background: profile.color }}
              >
                {profile.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="truncate text-xs">{profile.name}</span>
            </span>
          ) : (
            <span className="text-muted-foreground/70 text-xs">Unassigned</span>
          )}
        </td>
      )}
      {show("eero") && <td className={cn(td, "whitespace-nowrap text-xs", off && "text-muted-foreground")}>{eero ?? "-"}</td>}
      {show("band") && (
        <td className={td}>
          {off || !d.band ? (
            <span className="text-muted-foreground/70 text-xs">-</span>
          ) : (
            <span className="inline-flex h-[19px] items-center gap-1 whitespace-nowrap rounded-[5px] border bg-muted px-1.5 font-medium text-[11px] text-foreground/80 tabular-nums [&_svg]:size-[11px]">
              {d.band === "wired" ? (
                <>
                  <Cable />
                  Wired
                </>
              ) : (
                `${d.band} GHz`
              )}
            </span>
          )}
        </td>
      )}
      {show("signal") && (
        <td className={td}>
          {d.band === "wired" ? <span className="text-muted-foreground/70 text-xs">-</span> : <SignalBars bars={off ? 0 : (d.signal?.bars ?? 0)} />}
        </td>
      )}
      {show("addr") && (
        <td className={cn(td, "whitespace-nowrap font-mono")}>
          <div className="text-[11.5px]">{d.ipv4 ?? "-"}</div>
          <div className="text-[10.5px] text-muted-foreground/70">{d.mac}</div>
        </td>
      )}
      {show("now") && (
        <td className={cn(td, "whitespace-nowrap transition-opacity", ratesPending && "opacity-40")}>
          <NowCell device={d} />
        </td>
      )}
      {show("today") && (
        <td className={cn(td, "whitespace-nowrap text-end tabular-nums")}>{used ? formatBytes(used) : "-"}</td>
      )}
      <td className={td}>
        <Status tone={STATE[state].tone}>{STATE[state].label}</Status>
      </td>
      <td className={td}>
        <button
          type="button"
          disabled
          aria-label={`Actions for ${d.name}`}
          title="Device actions come in a later update"
          className="grid size-6 cursor-not-allowed place-items-center rounded-md text-muted-foreground opacity-70"
        >
          <Ellipsis className="size-[15px]" />
        </button>
      </td>
    </tr>
  );
}

function NowCell({ device: d }: { device: Device }) {
  if (!d.connected) {
    const seen = formatRelative(d.lastActive, Date.now());
    return <span className="text-muted-foreground/70 text-xs">{d.paused && !d.blocked ? `${seen} · paused` : seen}</span>;
  }
  if (d.paused) return <span className="text-muted-foreground/70 text-xs">Paused</span>;
  if (!d.rates) return <span className="text-muted-foreground/70 text-xs">-</span>;
  return (
    <div className="w-[46px] text-end text-[11px] tabular-nums leading-tight">
      <div className="text-foreground">{mbpsParts(d.rates.downMbps).value}</div>
      <div className="text-muted-foreground">{mbpsParts(d.rates.upMbps).value}</div>
    </div>
  );
}

function Tag({ muted = false, children }: { muted?: boolean; children: ReactNode }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-[4px] border bg-muted px-[5px] py-px font-bold text-[9px] tracking-[0.08em]",
        muted ? "text-muted-foreground" : "text-foreground/80",
      )}
    >
      {children}
    </span>
  );
}

/** Four bars: one red, two yellow, three or four in the text colour (design-system.md). */
function SignalBars({ bars }: { bars: number }) {
  const n = Math.max(0, Math.min(4, Math.round(bars)));
  const on = n === 1 ? "bg-destructive" : n === 2 ? "bg-warning" : "bg-foreground/80";
  return (
    <span role="img" aria-label={n === 0 ? "No signal" : `Signal ${n} of 4`} className="inline-flex h-3 items-end gap-0.5">
      {[4, 6.5, 9, 12].map((h, i) => (
        <span key={h} className={cn("w-[3px] rounded-[1px]", i < n ? on : "bg-border")} style={{ height: h }} />
      ))}
    </span>
  );
}

/** The bulk action bar, shown but disabled until device actions land (M4). */
export function BulkBar() {
  return (
    <div
      title={SELECT_SOON}
      className="flex items-center gap-2.5 rounded-xl border bg-muted/60 py-2 ps-3.5 pe-2.5"
    >
      <Checkbox label="Select devices" />
      <span className="shrink-0 font-medium text-[13px]">0 selected</span>
      <span className="min-w-0 truncate text-muted-foreground text-xs">Pause, block or assign a profile to several devices at once in a later update.</span>
      <div className="ms-auto flex shrink-0 items-center gap-2">
        <Button variant="outline" size="xs" disabled>
          <Pause />
          Pause
        </Button>
        <Button variant="outline" size="xs" disabled>
          <Play />
          Resume
        </Button>
        <Button variant="outline" size="xs" disabled>
          <UserRoundPlus />
          Assign profile
          <ChevronDown />
        </Button>
        <Button variant="outline" size="xs" disabled className="text-destructive-foreground">
          <Ban />
          Block
        </Button>
        <span aria-hidden className="h-[18px] w-px bg-border" />
        <Button variant="ghost" size="xs" disabled>
          <X />
          Clear
        </Button>
      </div>
    </div>
  );
}
