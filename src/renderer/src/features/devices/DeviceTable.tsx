/**
 * The grouped device table (docs/ux/pages/devices.md, Layout 4 and 5). Rows
 * arrive filtered and sorted by `device.list`; this file only groups them
 * (view state, keeping the sorted order within each group), lays out the
 * columns, sorts on a header click and opens device detail on click.
 * Selection (checkbox, Shift click for a range, the header checkbox) is view
 * state held by DevicesPage for the bulk bar (BulkBar.tsx). The row menu
 * runs the device writes: pause or resume, rename in place, change profile,
 * block (after the app's confirm dialog) or unblock.
 */
import { ChevronsLeftRightEllipsis } from "lucide-react";
import {
  ArrowDown,
  ArrowUp,
  Ban,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Ellipsis,
  History,
  House,
  Laptop,
  type LucideIcon,
  Pause,
  Pencil,
  Play,
  Router,
  Shapes,
  Tv,
  UserRound,
  Users,
  Wifi,
} from "lucide-react";
import { Fragment, type ReactNode, type RefObject, useEffect, useRef, useState } from "react";

import { useLiveReadings } from "~/app/liveReadings";
import { useLiveMode } from "~/app/useLiveMode";
import { Link, navigate, pathFor } from "~/app/router";
import { type Gate, performWrite } from "~/app/useWrite";
import { Button } from "~/components/ui/button";
import { BandBadge } from "~/components/ui/band-badge";
import { MiniArea } from "~/components/charts/MiniArea";
import { Checkbox } from "~/components/ui/checkbox";
import { Card, Empty } from "~/components/ui/card";
import { IconTile } from "~/components/ui/hero";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuSub, MenuSubPopup, MenuSubTrigger, MenuTrigger } from "~/components/ui/menu";
import { Status, type StatusTone } from "~/components/ui/status";
import { deviceIcon } from "~/lib/deviceIcons";
import { seriesColors } from "~/lib/chartColors";
import { cn, hasTextSelection } from "~/lib/utils";
import { formatBytes, formatPercent, formatRelative, mbpsParts } from "../../../../core/format";
import type { DeviceSortKey } from "../../../../core/commands/device";
import type { Device, DeviceCategory } from "../../../../core/model";

import { blockRequest, pauseRequest, type ProfileOption, ProfileItems, profileRequest } from "./BulkBar";
import { COLUMN_LABELS, type ColumnKey, type GroupBy } from "./DeviceFilters";
import type { SortOrder } from "./deviceSort";

// ---------------------------------------------------------------------------
// States and labels

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
  /** The sticky block above the table (title, toolbar); the header row follows its bottom edge while scrolling. */
  pinUnder?: RefObject<HTMLElement | null>;
  devices: ReadonlyArray<Device> | undefined;
  groupBy: GroupBy;
  /** The `device.list` sort and its direction; a header click calls onSort with its key. */
  sort: DeviceSortKey;
  order: SortOrder;
  onSort: (key: DeviceSortKey) => void;
  hidden: ReadonlySet<ColumnKey>;
  eeroName: ReadonlyMap<string, string>;
  profiles: ReadonlyMap<string, ProfileInfo>;
  /** Bytes used in the last 24 hours per device id, from `usage.breakdown` range day. */
  usage: ReadonlyMap<string, number> | undefined;
  newIds: ReadonlySet<string>;
  fading: boolean;
  error: string | null;
  onRetry: () => void;
  filtersActive: boolean;
  onResetFilters: () => void;
  networkName: string | null;
  /** Devices on the whole network (0 means nothing has joined). */
  total: number | undefined;
  /** Selected device ids (view state, DevicesPage). */
  selected: ReadonlySet<string>;
  onSelect: (ids: string[]) => void;
  /** Profiles for the row menu's Change profile. */
  profileOptions: ReadonlyArray<ProfileOption>;
  /** Bridge mode: no pause, profiles or block in the row menu. */
  bridged: boolean;
  /** Pause, resume, rename and profiles. */
  gate: Gate;
  /** Block and unblock. */
  blockGate: Gate;
};

const DEFAULT_COLLAPSED = new Set(["category:home"]);

/** The table's last row order (groups in order), for Prev and Next on device detail. View state. */
let shownOrder: readonly string[] = [];
export const devicesOrder = (): readonly string[] => shownOrder;
/** Rows on screen (collapsed groups left out), for Ctrl+A. View state. */
let visibleOrder: readonly string[] = [];
export const visibleDevices = (): readonly string[] => visibleOrder;

export function DeviceTable(props: DeviceTableProps) {
  const { devices, groupBy, hidden, selected, onSelect } = props;
  const [collapsed, setCollapsed] = useState<Set<string>>(DEFAULT_COLLAPSED);
  const [renaming, setRenaming] = useState<string | null>(null);
  const anchor = useRef<string | null>(null);
  const show = (c: ColumnKey) => !hidden.has(c);
  const headRef = useRef<HTMLTableSectionElement>(null);
  usePinnedHead(headRef, props.pinUnder);
  // Checkbox, Device and the row menu, plus the optional columns shown (Status among them).
  const columns = 3 + (Object.keys(COLUMN_LABELS) as ColumnKey[]).filter(show).length;

  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // Rows on screen (collapsed groups left out), for the header checkbox and Shift ranges.
  let visible: string[] = [];
  /** Checkbox on a row: toggles it, or with Shift selects the range from the last one clicked. */
  const pick = (id: string, shift: boolean) => {
    const from = anchor.current ? visible.indexOf(anchor.current) : -1;
    const to = visible.indexOf(id);
    if (shift && from >= 0 && to >= 0) {
      const range = visible.slice(Math.min(from, to), Math.max(from, to) + 1);
      onSelect([...new Set([...selected, ...range])]);
    } else {
      onSelect(selected.has(id) ? [...selected].filter((x) => x !== id) : [...selected, id]);
    }
    anchor.current = id;
  };

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
    shownOrder = groups.flatMap((g) => g.devices.map((d) => d.id));
    visible = groups.flatMap((g) => (collapsed.has(`${groupBy}:${g.key}`) ? [] : g.devices.map((d) => d.id)));
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
          {!isCollapsed &&
            g.devices.map((d) => (
              <Row
                key={d.id}
                device={d}
                show={show}
                {...props}
                isSelected={selected.has(d.id)}
                onPick={(shift) => pick(d.id, shift)}
                renaming={renaming === d.id}
                onRename={(on) => setRenaming(on ? d.id : null)}
              />
            ))}
        </Fragment>
      );
    });
  }

  visibleOrder = visible;
  const th = "whitespace-nowrap px-2.5 py-[9px] text-start font-normal text-muted-foreground text-xs";
  const sortable = (key: DeviceSortKey, label: ReactNode, className?: string) => (
    <SortHeader key={key} sortKey={key} active={props.sort === key} order={props.order} onSort={props.onSort} className={cn(th, className)}>
      {label}
    </SortHeader>
  );
  return (
    <Card>
      <div className="overflow-x-auto">
        <table className={cn("w-full border-collapse text-[12.5px]", props.fading && "opacity-40")} aria-label="Devices">
          <thead
            ref={headRef}
            // While pinned, the sticky block above draws the card's rounded top edge over this row (DevicesPage), and
            // a fade the height of the topbar's runs down from each header cell, so rows dissolve as they slide
            // under it instead of being cut off. The fade itself comes in with the scroll (--head-fade, 0 to 1
            // over the first HEAD_FADE_PX pinned), so it does not pop in.
            className={cn(
              "relative z-10 [--head-bg:color-mix(in_srgb,var(--color-card)_40%,var(--color-background))] [&_th]:bg-(--head-bg)",
              // A shield above the row, on the page background: it always sits behind the sticky block, but when the
              // row lags a frame behind a fast scroll up, it fills the gap so rows never show above the header.
              "[&_th]:before:pointer-events-none [&_th]:before:absolute [&_th]:before:inset-x-0 [&_th]:before:bottom-full [&_th]:before:h-10 [&_th]:before:bg-background [&_th]:before:content-['']",
              "[&_th]:relative data-pinned:[&_th]:after:pointer-events-none data-pinned:[&_th]:after:absolute data-pinned:[&_th]:after:inset-x-0 data-pinned:[&_th]:after:top-full data-pinned:[&_th]:after:h-(--topbar-scroll-fade-height) data-pinned:[&_th]:after:bg-linear-to-b data-pinned:[&_th]:after:from-(--head-bg) data-pinned:[&_th]:after:to-transparent data-pinned:[&_th]:after:opacity-(--head-fade) data-pinned:[&_th]:after:content-['']",
            )}
          >
            <tr className="border-b">
              <th className={cn(th, "w-7")}>
                <Checkbox
                  aria-label="Select all devices"
                  checked={visible.length > 0 && visible.every((id) => selected.has(id))}
                  indeterminate={visible.some((id) => selected.has(id)) && !visible.every((id) => selected.has(id))}
                  disabled={visible.length === 0}
                  onCheckedChange={() => onSelect(visible.every((id) => selected.has(id)) ? [] : visible)}
                />
              </th>
              {sortable("name", "Device", "w-full")}
              {show("profile") && sortable("profile", "Profile")}
              {show("eero") && sortable("eero", "Connected to")}
              {show("band") && sortable("band", "Band")}
              {show("signal") && sortable("signal", "Signal")}
              {show("addr") && sortable("ip", "IP · MAC")}
              {show("now") &&
                sortable(
                  "rate",
                  "Live data",
                )}
              {show("chart") && (
                <th className={cn(th, "whitespace-nowrap")}>Live chart</th>
              )}
              {show("today") && sortable("usage", "24h", "text-end")}
              {show("status") && sortable("status", "Status")}
              <th className={cn(th, "w-6")}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>{body}</tbody>
        </table>
      </div>
    </Card>
  );
}

/** A sortable column header: the label is a button; the active one shows its direction. */
function SortHeader({
  sortKey,
  active,
  order,
  onSort,
  className,
  children,
}: {
  sortKey: DeviceSortKey;
  active: boolean;
  order: SortOrder;
  onSort: (key: DeviceSortKey) => void;
  className: string;
  children: ReactNode;
}) {
  const Arrow = order === "asc" ? ArrowUp : ArrowDown;
  return (
    <th className={className} aria-sort={active ? (order === "asc" ? "ascending" : "descending") : undefined}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "-mx-1 inline-flex cursor-pointer items-center gap-1 rounded-sm px-1 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
          active && "font-medium text-foreground",
        )}
      >
        <span>{children}</span>
        {active && <Arrow aria-hidden className="size-3 text-muted-foreground" />}
      </button>
    </th>
  );
}

function FullRow({ columns, children }: { columns: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={columns}>{children}</td>
    </tr>
  );
}

type RowProps = DeviceTableProps & {
  device: Device;
  show: (c: ColumnKey) => boolean;
  isSelected: boolean;
  onPick: (shift: boolean) => void;
  renaming: boolean;
  onRename: (on: boolean) => void;
};

function Row(props: RowProps) {
  const { device: d, show, eeroName, profiles, usage, newIds, isSelected, onPick, renaming, onRename } = props;
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
        // Menus render in a portal; their clicks still bubble here through React.
        if (!e.currentTarget.contains(e.target as Node)) return;
        if ((e.target as HTMLElement).closest("a,button,input,[role=checkbox],[data-select-cell]")) return;
        if (hasTextSelection()) return;
        navigate(to);
      }}
      aria-selected={isSelected}
      className={cn(
        "cursor-pointer border-border/50 border-b last:border-b-0 hover:bg-muted/50",
        off && "text-muted-foreground",
        // Offline: all text between the checkbox and the row menu takes the muted subtext colour at 30%
        // (name, MAC, status included), so the whole row reads as away; decorative marks (aria-hidden) keep their own.
        state === "offline" &&
          "[&>td:not(:first-child):not(:last-child)]:text-muted-foreground/30 [&>td:not(:first-child):not(:last-child)_*:not([aria-hidden])]:text-muted-foreground/30",
        isSelected && "bg-accent hover:bg-accent",
      )}
    >
      <td
        // The whole cell selects, so a click a little above or below the box picks the row instead of opening it.
        data-select-cell
        onClick={(e) => {
          // The box reports its own change (with Shift); this is for clicks around it.
          if (!(e.target as HTMLElement).closest("[role=checkbox],input")) onPick(e.shiftKey);
        }}
        className={cn(td, "cursor-pointer", isSelected && "shadow-[inset_2px_0_0_var(--color-foreground)]")}
      >
        <Checkbox aria-label={`Select ${d.name}`} checked={isSelected} onCheckedChange={(_, { shiftKey }) => onPick(shiftKey)} />
      </td>
      {/* The Device column takes the spare width and gives it back first: long names truncate so the table fits its card. */}
      <td className={cn(td, "min-w-44 max-w-0")}>
        <div className="flex min-w-0 items-center gap-2.5">
          <IconTile icon={deviceIcon(d)} size="sm" className={cn("size-7 shrink-0", off && "opacity-60")} />
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-1.5">
              {renaming ? (
                <RenameInput device={d} onDone={() => onRename(false)} />
              ) : (
                <Link to={to} className="min-w-0 truncate font-medium text-foreground outline-none focus-visible:underline">
                  {d.name}
                </Link>
              )}
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
                className={cn(
                  "grid size-5 shrink-0 place-items-center rounded-full font-semibold text-[10px] text-background",
                  state === "offline" && "opacity-50",
                )}
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
            <BandBadge band={d.band} />
          )}
        </td>
      )}
      {show("signal") && (
        <td className={td}>
          {d.band === "wired" ? <WiredSignal /> : <SignalBars bars={off ? 0 : (d.signal?.bars ?? 0)} />}
        </td>
      )}
      {show("addr") && (
        <td className={cn(td, "whitespace-nowrap font-mono")}>
          <div className="text-[11.5px]">{d.ipv4 ?? "-"}</div>
          <div className="text-[10.5px] text-muted-foreground/70">{d.mac}</div>
        </td>
      )}
      {show("now") && (
        <td className={cn(td, "whitespace-nowrap")}>
          <NowCell device={d} />
        </td>
      )}
      {show("chart") && (
        <td className={td}>
          <LiveSpark device={d} />
        </td>
      )}
      {show("today") && (
        <td className={cn(td, "whitespace-nowrap text-end tabular-nums")}>{used ? formatBytes(used) : "-"}</td>
      )}
      {show("status") && (
        <td className={td}>
          <Status tone={STATE[state].tone}>{STATE[state].label}</Status>
        </td>
      )}
      <td className={td}>
        <RowMenu {...props} />
      </td>
    </tr>
  );
}

/** The row's `...` menu (devices.md, Actions): pause or resume, rename, change profile, block or unblock. */
function RowMenu({ device: d, bridged, gate, blockGate, profileOptions, networkName, onRename }: RowProps) {
  const guest = d.ssid === "guest";
  const canPause = !bridged && !guest && !d.blocked;
  const reason = (g: Gate) => (g.allowed ? undefined : (g.reason ?? undefined));
  return (
    <Menu>
      <MenuTrigger
        aria-label={`Actions for ${d.name}`}
        className="grid size-6 cursor-pointer place-items-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[popup-open]:bg-muted"
      >
        <Ellipsis className="size-[15px]" />
      </MenuTrigger>
      <MenuPopup align="end">
        {canPause && (
          <MenuItem disabled={!gate.allowed} title={reason(gate)} onClick={() => void performWrite(pauseRequest([d], !d.paused))}>
            {d.paused ? <Play /> : <Pause />}
            {d.paused ? "Resume" : "Pause…"}
          </MenuItem>
        )}
        <MenuItem disabled={!gate.allowed} title={reason(gate)} onClick={() => onRename(true)}>
          <Pencil />
          Rename…
        </MenuItem>
        {canPause && (
          <MenuSub>
            <MenuSubTrigger disabled={!gate.allowed} title={reason(gate)}>
              <UserRound />
              Change profile
            </MenuSubTrigger>
            <MenuSubPopup side="left">
              <ProfileItems profiles={profileOptions} current={d.profileId} onPick={(p) => void performWrite(profileRequest([d], p))} />
            </MenuSubPopup>
          </MenuSub>
        )}
        {!bridged && (
          <>
            <MenuSeparator />
            {d.blocked ? (
              <MenuItem disabled={!blockGate.allowed} title={reason(blockGate)} onClick={() => void performWrite(blockRequest([d], false))}>
                <CircleCheck />
                Unblock
              </MenuItem>
            ) : (
              <MenuItem
                variant="destructive"
                disabled={!blockGate.allowed}
                title={reason(blockGate)}
                onClick={() => void performWrite(blockRequest([d], true, { networkName }))}
              >
                <Ban />
                Block…
              </MenuItem>
            )}
          </>
        )}
      </MenuPopup>
    </Menu>
  );
}

/** The name cell while renaming: Enter saves (with Undo), Esc or leaving the field cancels. */
function RenameInput({ device: d, onDone }: { device: Device; onDone: () => void }) {
  const [value, setValue] = useState(d.nickname ?? d.name);
  const ref = useRef<HTMLInputElement>(null);
  const saving = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const save = async () => {
    const nickname = value.trim();
    if (saving.current) return;
    if (nickname === (d.nickname ?? d.name)) return onDone();
    saving.current = true;
    const res = await performWrite({
      id: "device.rename",
      params: { device: d.id, nickname },
      success: nickname ? `Renamed to ${nickname}` : `Cleared the nickname of ${d.name}`,
      failure: `Couldn't rename ${d.name}`,
      undo: { id: "device.rename", params: { device: d.id, nickname: d.nickname ?? "" } },
    });
    saving.current = false;
    if (res?.ok) onDone();
  };
  return (
    <input
      ref={ref}
      aria-label={`New name for ${d.name}`}
      value={value}
      maxLength={32}
      placeholder={d.hostname ?? d.name}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") void save();
        if (e.key === "Escape") onDone();
      }}
      onBlur={() => {
        if (!saving.current) onDone();
      }}
      className="h-6 w-48 rounded-md border bg-background px-1.5 font-medium text-foreground text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
    />
  );
}

function NowCell({ device: d }: { device: Device }) {
  const [live] = useLiveMode();
  if (!d.connected) {
    const seen = formatRelative(d.lastActive, Date.now());
    return <span className="text-muted-foreground/70 text-xs">{d.paused && !d.blocked ? `${seen} · paused` : seen}</span>;
  }
  if (d.paused) return <span className="text-muted-foreground/70 text-xs">Paused</span>;
  if (!d.rates || !live) return <span className="text-muted-foreground/70 text-xs">-</span>;
  const share = d.rates.sharePct;
  return (
    <div className="flex items-center gap-2.5">
      <div className="w-[68px] text-end text-[11px] tabular-nums leading-tight">
        <Rate mbps={d.rates.downMbps} className="text-foreground" />
        <Rate mbps={d.rates.upMbps} className="text-muted-foreground" />
      </div>
      {/* Share of the network's current traffic, like the eero app's live view. */}
      <span className="w-8 text-end text-2xs text-muted-foreground tabular-nums">{share ? formatPercent(share) : ""}</span>
    </div>
  );
}

/** Live chart: a mini chart of the device's download and upload since Live was turned on. */
function LiveSpark({ device: d }: { device: Device }) {
  const [live] = useLiveMode();
  // Recorded on every page while Live is on (LiveCollector).
  const readings = useLiveReadings(`device:${d.id}`);
  if (!live || !d.connected || d.paused || d.blocked || readings.length === 0) return null;
  return (
    <MiniArea
      ariaLabel={`Download and upload for ${d.name} since Live was turned on`}
      series={[
        { id: "down", color: seriesColors.download, values: readings.map((r) => r.down) },
        { id: "up", color: seriesColors.upload, values: readings.map((r) => r.up) },
      ]}
    />
  );
}

/** A live rate with its unit, "4.2 Mbps", "320 kbps"; a real zero is a bare "0" so idle rows stay quiet. */
function Rate({ mbps, className }: { mbps: number; className: string }) {
  const p = mbpsParts(mbps);
  return (
    <div className={className}>
      {p.value}
      {mbps !== 0 && <span className="ms-0.5 text-3xs text-muted-foreground/70 leading-none">{p.unit}</span>}
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

/** Signal for a wired device: the `<···>` link mark the eero app shows, in place of bars. */
export function WiredSignal() {
  return (
    <span role="img" aria-label="Wired" title="Wired" className="inline-flex h-3 items-center text-foreground/80">
      <ChevronsLeftRightEllipsis aria-hidden className="size-4" />
    </span>
  );
}

/** Four bars: one red, two yellow, three or four in the text colour (design-system.md). */
export function SignalBars({ bars }: { bars: number }) {
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

/** Pixels scrolled past the pin point over which the fade under the header row comes in (about one row). */
const HEAD_FADE_PX = 50;

/**
 * Keeps the header row under the sticky block above the table while the page
 * scrolls, so rows slide up behind it. CSS `sticky` cannot do it here: the
 * table sits in a box that scrolls sideways on narrow windows, and that box
 * would capture a sticky header. So the row is moved with a transform instead,
 * once a frame at most, and stops at the last row.
 */
function usePinnedHead(head: RefObject<HTMLTableSectionElement | null>, pinUnder: RefObject<HTMLElement | null> | undefined) {
  useEffect(() => {
    const el = head.current;
    const block = pinUnder?.current;
    const scroller = el?.closest<HTMLElement>("[data-page-scroll]");
    if (!el || !block || !scroller) return;
    let frame = 0;
    const place = () => {
      frame = 0;
      const table = el.parentElement;
      if (!table) return;
      const t = table.getBoundingClientRect();
      const shift = Math.min(Math.max(0, block.getBoundingClientRect().bottom - t.top), Math.max(0, t.height - el.offsetHeight));
      el.style.transform = shift > 0 ? `translateY(${shift}px)` : "";
      el.toggleAttribute("data-pinned", shift > 0);
      el.style.setProperty("--head-fade", String(Math.min(1, shift / HEAD_FADE_PX)));
      block.toggleAttribute("data-table-pinned", shift > 0);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(place);
    };
    scroller.addEventListener("scroll", schedule, { passive: true });
    const sizes = new ResizeObserver(schedule);
    sizes.observe(block);
    sizes.observe(el.parentElement ?? el);
    place();
    return () => {
      scroller.removeEventListener("scroll", schedule);
      sizes.disconnect();
      cancelAnimationFrame(frame);
      el.style.transform = "";
      el.removeAttribute("data-pinned");
      block.removeAttribute("data-table-pinned");
    };
  }, [head, pinUnder]);
}
