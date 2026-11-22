/**
 * The Reservations & ports sheets (docs/ux/pages/reservations-ports.md,
 * "Add port forward sheet"; mockup 14): one for a reservation, one for a
 * port forward and one for an IPv6 rule, laid out like the port forward
 * sheet. They are also opened from device detail (reserve this IP, open a
 * port). Every check is core's: the forward sheet shows `forward.validate`
 * as the fields change, and a save's `bad_params` lands under its field.
 *
 * The routing lists share one routing read in core, so a write here (or its
 * Undo) refreshes all of them and device detail's reservation (`RELATED` in
 * useCommand). Removals ask first in the app's confirm dialog.
 */
import { Bookmark, BookmarkPlus, Check, CircleAlert, Plus, ShieldPlus, Trash2 } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { useQuery } from "~/app/useCommand";
import { fieldErrors, performWrite, useWrite } from "~/app/useWrite";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Segmented } from "~/components/ui/segmented";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Sheet, SheetField } from "~/components/ui/sheet";
import { WriteSwitch } from "~/features/advanced/SettingsGroups";
import { cn } from "~/lib/utils";
import type { ForwardAdded, ForwardCheck, ForwardRemoved, PinholeRemoved, ReservationRemoved } from "../../../../core/commands/routing";
import type { Device, DeviceList, Forward, Internet, Pinhole, Protocol, Reservation } from "../../../../core/model";

const PROTOCOLS = [
  { value: "tcp", label: "TCP" },
  { value: "udp", label: "UDP" },
  { value: "both", label: "TCP + UDP" },
] as const;

const selectClass =
  "h-8 w-full cursor-pointer truncate rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 dark:bg-input/32";

/** Main-network devices, A to Z: the ones that can take a reservation, forward or rule. */
function useDevices(): Device[] {
  const devices = useQuery<DeviceList>("device.list");
  return (devices.data?.devices ?? []).filter((d) => d.ssid !== "guest").sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}

function DeviceSelect({ id, value, devices, onChange, disabled }: { id: string; value: string; devices: Device[]; onChange: (id: string) => void; disabled?: boolean }) {
  return (
    <select id={id} className={cn(selectClass, value === "" && "text-muted-foreground")} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      <option value="">Pick a device</option>
      {devices.map((d) => (
        <option key={d.id} value={d.id}>
          {d.name}
          {d.ipv4 ? ` · ${d.ipv4}` : ""}
        </option>
      ))}
    </select>
  );
}

/**
 * The port forward sheet's device dropdown: the app's styled Select, the
 * device's name in the trigger and its address beside each option. The
 * reservation and IPv6 rule sheets still use the native one, page by page.
 */
function DevicePicker({ id, value, devices, onChange }: { id: string; value: string; devices: Device[]; onChange: (id: string) => void }) {
  const items = devices.map((d) => ({ value: d.id, label: d.name }));
  return (
    <Select items={items} value={value || null} onValueChange={(v) => v !== null && onChange(v)}>
      <SelectTrigger id={id} className="w-full min-w-0">
        <SelectValue placeholder="Pick a device" />
      </SelectTrigger>
      <SelectPopup align="start" className="text-sm">
        {devices.map((d) => (
          <SelectItem key={d.id} value={d.id}>
            <span className="flex items-center justify-between gap-6">
              <span className="truncate">{d.name}</span>
              {d.ipv4 && <span className="font-mono text-muted-foreground text-xs">{d.ipv4}</span>}
            </span>
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

/** Protocol as a dropdown (design-system.md: dropdowns, not pill toggles). */
function ProtocolPicker({ id, value, onChange }: { id: string; value: Protocol; onChange: (p: Protocol) => void }) {
  return (
    <Select items={PROTOCOLS} value={value} onValueChange={(v) => v && onChange(v as Protocol)}>
      <SelectTrigger id={id} className="w-full min-w-0">
        <SelectValue />
      </SelectTrigger>
      <SelectPopup align="start" className="text-sm">
        {PROTOCOLS.map((p) => (
          <SelectItem key={p.value} value={p.value}>
            {p.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

const ALWAYS: { allowed: boolean; reason: string | null } = { allowed: true, reason: null };

/** A state line under the fields: a check or a warning, with its text. */
function CheckLine({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <div className={cn("flex items-center gap-2 text-xs", ok ? "text-foreground/80" : "text-warning-foreground")}>
      {ok ? <Check className="size-3.5 text-success" /> : <CircleAlert className="size-3.5" />}
      <span>{children}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reservation

export type ReservationSheetMode = { kind: "add"; deviceId?: string } | { kind: "edit"; reservation: Reservation };

/**
 * Add or edit a reservation. With `removable`, editing also offers
 * Remove reservation… on the left of the footer (device detail, which has
 * no other way to remove one; the Reservations list removes from its rows).
 */
export function ReservationSheet({ mode, onClose, removable = false }: { mode: ReservationSheetMode | null; onClose: () => void; removable?: boolean }) {
  return mode ? (
    <ReservationBody key={mode.kind === "add" ? `add:${mode.deviceId ?? ""}` : mode.reservation.id} mode={mode} onClose={onClose} removable={removable} />
  ) : null;
}

function ReservationBody({ mode, onClose, removable }: { mode: ReservationSheetMode; onClose: () => void; removable: boolean }) {
  const devices = useDevices();
  const ids = { device: useId(), ip: useId(), name: useId() };
  const initial = mode.kind === "edit" ? mode.reservation : null;
  const [deviceId, setDeviceId] = useState(mode.kind === "add" ? (mode.deviceId ?? "") : (initial?.deviceId ?? ""));
  const device = devices.find((d) => d.id === deviceId);
  const [ip, setIp] = useState(initial?.ip ?? "");
  const [ipTouched, setIpTouched] = useState(mode.kind === "edit");
  const [name, setName] = useState(initial?.name ?? "");
  const [removing, setRemoving] = useState(false);
  // A new reservation suggests the device's current address until the person types one.
  const shownIp = ipTouched ? ip : (device?.ipv4 ?? "");

  const add = useWrite<Record<string, unknown>, Reservation>("reservation.add", { form: true });
  const update = useWrite<Record<string, unknown>, Reservation>("reservation.update", { form: true });
  const active = mode.kind === "add" ? add : update;
  const errors = fieldErrors(active.error);

  const dirty = mode.kind === "add" ? deviceId !== "" : shownIp !== initial?.ip || name.trim() !== initial?.name;
  const valid = mode.kind === "edit" || deviceId !== "";

  const save = () => {
    if (mode.kind === "add") {
      return add.run(
        { device: deviceId, ...(shownIp.trim() ? { ip: shownIp.trim() } : {}), ...(name.trim() ? { description: name.trim() } : {}) },
        {
          success: (r) => `Reserved ${r.ip} for ${device?.name ?? r.name}`,
          undo: (r) => ({ id: "reservation.remove", params: { reservation: r.id } }),
        },
      );
    }
    const r = mode.reservation;
    return update.run(
      { reservation: r.id, ip: shownIp.trim(), description: name.trim() },
      {
        success: (saved) => `Saved the reservation for ${device?.name ?? saved.name}`,
        undo: { id: "reservation.update", params: { reservation: r.id, ip: r.ip, description: r.name } },
      },
    );
  };

  return (
    <Sheet
      open
      onClose={onClose}
      icon={mode.kind === "add" ? <BookmarkPlus /> : <Bookmark />}
      title={mode.kind === "add" ? "Add a reservation" : "Edit reservation"}
      subtitle="The device always gets this address. Applies instantly, no restart."
      dirty={dirty}
      valid={valid}
      onSave={save}
      footerStart={
        removable && initial ? (
          // Asks first (the confirm also names any port forwards that go with it), so it ends in an ellipsis.
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-destructive-foreground"
            disabled={removing}
            onClick={() => {
              setRemoving(true);
              void removeReservation(initial, device?.name ?? initial.name)
                .then((r) => r?.ok && onClose())
                .finally(() => setRemoving(false));
            }}
          >
            <Trash2 />
            Remove reservation{"\u2026"}
          </Button>
        ) : undefined
      }
      saveLabel={mode.kind === "add" ? "Save reservation" : "Save"}
      error={errors._form}
    >
      <SheetField label="Device" htmlFor={ids.device} error={errors.device ?? errors.mac} helper={device ? `${device.mac}${device.connected ? "" : " · offline"}` : undefined}>
        <DeviceSelect id={ids.device} value={deviceId} devices={devices} onChange={setDeviceId} disabled={mode.kind === "edit"} />
      </SheetField>
      <SheetField
        label="Reserved IP"
        htmlFor={ids.ip}
        error={errors.ip}
        helper={mode.kind === "add" && !shownIp ? "Leave empty for the first free address in the static range." : "Inside your network, not in use by another device."}
      >
        <Input
          id={ids.ip}
          className="font-mono"
          inputMode="decimal"
          placeholder="192.168.4.20"
          value={shownIp}
          onChange={(e) => {
            setIpTouched(true);
            setIp(e.currentTarget.value);
          }}
        />
      </SheetField>
      <SheetField label="Description" htmlFor={ids.name} helper="Optional. Defaults to the device's name.">
        <Input id={ids.name} maxLength={64} placeholder={device?.name ?? "Description"} value={name} onChange={(e) => setName(e.currentTarget.value)} />
      </SheetField>
    </Sheet>
  );
}

/** Removes a reservation after a confirm; with forwards on it, the confirm also removes those. */
export function removeReservation(r: Reservation, name: string) {
  const n = r.forwards;
  return performWrite<Record<string, unknown>, ReservationRemoved>({
    params: { reservation: r.id, removeForwards: n > 0 },
    askFirst: true,
    confirm: {
      title: `Remove the reservation for ${name}?`,
      message:
        n > 0
          ? `This also removes ${n === 1 ? "the port forward" : `the ${n} port forwards`} on ${r.ip}. ${name} takes a DHCP address next time it joins.`
          : `${name} takes a DHCP address next time it joins. Applies instantly, no restart.`,
      confirmLabel: n > 0 ? `Remove reservation and ${n === 1 ? "forward" : "forwards"}` : "Remove reservation",
    },
    // Removed elsewhere (the eero app) since the list was read: core says so, the list refreshes.
    success: (res) => (res.alreadyGone ? `The reservation for ${name} was already removed` : `Removed the reservation for ${name}`),
    failure: `Couldn't remove the reservation for ${name}`,
    // Undo puts the reservation back; removed forwards are gone for good, so no Undo then.
    undo: (res) =>
      res.reservation && !res.removedForwards.length ? { id: "reservation.add", params: { mac: res.reservation.mac, ip: res.reservation.ip, description: res.reservation.name } } : null,
    id: "reservation.remove",
  });
}

// ---------------------------------------------------------------------------
// Port forward

export type ForwardSheetMode = { kind: "add"; deviceId?: string } | { kind: "edit"; forward: Forward };

export function ForwardSheet({ mode, onClose }: { mode: ForwardSheetMode | null; onClose: () => void }) {
  return mode ? <ForwardBody key={mode.kind === "add" ? `add:${mode.deviceId ?? ""}` : mode.forward.id} mode={mode} onClose={onClose} /> : null;
}

/** The value after it has stayed put for `ms`. */
function useSettled<T>(value: T, ms = 300): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

function ForwardBody({ mode, onClose }: { mode: ForwardSheetMode; onClose: () => void }) {
  const devices = useDevices();
  const internet = useQuery<Internet>("internet.get");
  const ids = { device: useId(), name: useId(), ext: useId(), int: useId(), protocol: useId() };
  const f = mode.kind === "edit" ? mode.forward : null;
  const [deviceId, setDeviceId] = useState(mode.kind === "add" ? (mode.deviceId ?? "") : (f?.deviceId ?? ""));
  const [name, setName] = useState(f?.name ?? "");
  const [ext, setExt] = useState(f?.externalPort ?? "");
  const [int, setInt] = useState(f && f.internalPort !== f.externalPort ? f.internalPort : "");
  const [protocol, setProtocol] = useState<Protocol>(f?.protocol ?? "tcp");
  const [enabled, setEnabled] = useState(f?.enabled ?? true);
  const device = devices.find((d) => d.id === deviceId);

  const draft = { device: deviceId, externalPort: ext.trim(), internalPort: int.trim() || ext.trim(), protocol, ...(f ? { forward: f.id } : {}) };
  // Settle a string, not the object: a fresh object each render would never settle.
  const settled = JSON.parse(useSettled(JSON.stringify(draft))) as typeof draft;
  const ready = settled.device !== "" && settled.externalPort !== "";
  const check = useQuery<ForwardCheck>("forward.validate", settled, { enabled: ready });
  const issues = check.data && ready ? Object.fromEntries(check.data.issues.map((i) => [i.field, i.message])) : {};

  const add = useWrite<Record<string, unknown>, ForwardAdded>("forward.add", { form: true });
  const update = useWrite<Record<string, unknown>, Forward>("forward.update", { form: true });
  const active = mode.kind === "add" ? add : update;
  const errors = { ...issues, ...fieldErrors(active.error) };

  const dirty =
    mode.kind === "add" || deviceId !== (f?.deviceId ?? "") || name.trim() !== f?.name || ext.trim() !== f?.externalPort || (int.trim() || ext.trim()) !== f?.internalPort || protocol !== f?.protocol || enabled !== f?.enabled;
  const valid = deviceId !== "" && name.trim() !== "" && ext.trim() !== "" && check.data?.ok !== false;
  const label = name.trim() || "the port forward";

  const params = { device: deviceId, description: name.trim(), externalPort: ext.trim(), internalPort: int.trim() || ext.trim(), protocol, enabled };
  const save = () =>
    mode.kind === "add"
      ? add.run(
          params,
          {
            success: (r) => (r.reservation ? `Added ${r.forward.name} and reserved ${r.reservation.ip}` : `Added ${r.forward.name}`),
            undo: (r) => ({ id: "forward.remove", params: { forward: r.forward.id } }),
          },
        )
      : update.run(
          { forward: mode.forward.id, ...params },
          {
            success: `Saved ${label}`,
            undo: { id: "forward.update", params: forwardParams(mode.forward) },
          },
        );

  const publicIp = internet.data?.publicIpv4 ?? null;
  const reserved = check.data && ready ? !check.data.needsReservation : null;

  return (
    <Sheet
      open
      onClose={onClose}
      icon={<Plus />}
      title={mode.kind === "add" ? "Add port forward" : "Edit port forward"}
      subtitle={publicIp ? `Open to the internet on ${publicIp}` : "Open to the internet"}
      dirty={dirty}
      valid={valid}
      onSave={save}
      saveLabel={mode.kind === "add" ? "Save port forward" : "Save"}
      error={errors._form}
    >
      <SheetField
        label="Device"
        htmlFor={ids.device}
        error={errors.device}
        helper={
          device
            ? reserved === false
              ? `${device.ipv4 ?? "No address"}, not reserved yet: saving reserves it`
              : `${device.ipv4 ?? "-"}, reserved: it never changes`
            : undefined
        }
      >
        <DevicePicker id={ids.device} value={deviceId} devices={devices} onChange={setDeviceId} />
      </SheetField>
      <SheetField label="Nickname" htmlFor={ids.name} error={errors.description}>
        <Input id={ids.name} maxLength={64} placeholder="Media server" value={name} onChange={(e) => setName(e.currentTarget.value)} />
      </SheetField>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_8rem] gap-3">
        <SheetField label="External port" htmlFor={ids.ext} error={errors.externalPort} helper="One port or a range">
          <Input id={ids.ext} className="font-mono" inputMode="numeric" placeholder="8080" value={ext} onChange={(e) => setExt(e.currentTarget.value)} />
        </SheetField>
        <SheetField label="Internal port" htmlFor={ids.int} error={errors.internalPort} helper="Same as external if empty">
          <Input id={ids.int} className="font-mono" inputMode="numeric" placeholder={ext || "8080"} value={int} onChange={(e) => setInt(e.currentTarget.value)} />
        </SheetField>
        <SheetField label="Protocol" htmlFor={ids.protocol}>
          <ProtocolPicker id={ids.protocol} value={protocol} onChange={setProtocol} />
        </SheetField>
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-xs">Enabled</span>
          <span className="text-muted-foreground text-xs">Off keeps the rule but closes the port</span>
        </div>
        <WriteSwitch on={enabled} label="Enabled" gate={ALWAYS} onToggle={setEnabled} />
      </div>
      {ready && check.data && (
        <div className={cn("flex flex-col gap-1.5 transition-opacity", check.fading && "opacity-40")}>
          <CheckLine ok={!issues.externalPort}>{issues.externalPort ? "Conflicts with an existing port forward" : "No conflict with existing port forwards"}</CheckLine>
          <CheckLine ok>Applies instantly, no restart</CheckLine>
        </div>
      )}
    </Sheet>
  );
}

/** A forward as forward.update params, for Undo. */
const forwardParams = (f: Forward) => ({
  forward: f.id,
  ...(f.deviceId ? { device: f.deviceId } : {}),
  description: f.name || "Port forward",
  externalPort: f.externalPort,
  internalPort: f.internalPort,
  protocol: f.protocol,
  enabled: f.enabled,
});

/** Turns a forward on or off, with Undo. */
export function setForwardEnabled(f: Forward, enabled: boolean) {
  const name = f.name || "Port forward";
  return performWrite<Record<string, unknown>, Forward>({
    params: { forward: f.id, enabled },
    success: `${enabled ? "Turned on" : "Turned off"} ${name}`,
    failure: `Couldn't turn ${enabled ? "on" : "off"} ${name}`,
    undo: { id: "forward.update", params: { forward: f.id, enabled: !enabled } },
    id: "forward.update",
  });
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Removes a forward after a confirm, with Undo that adds it back. */
export function removeForward(f: Forward) {
  const name = f.name || "this port forward";
  return performWrite<Record<string, unknown>, ForwardRemoved>({
    params: { forward: f.id },
    askFirst: true,
    confirm: { title: `Remove ${name}?`, message: `Port ${f.externalPort} closes on the internet side. Applies instantly, no restart.`, confirmLabel: "Remove port forward" },
    success: (res) => (res.alreadyGone ? `${capitalize(name)} was already removed` : `Removed ${name}`),
    failure: `Couldn't remove ${name}`,
    undo: ({ forward: r }) =>
      r?.deviceId
        ? { id: "forward.add", params: { device: r.deviceId, description: r.name || "Port forward", externalPort: r.externalPort, internalPort: r.internalPort, protocol: r.protocol, enabled: r.enabled } }
        : null,
    id: "forward.remove",
  });
}

// ---------------------------------------------------------------------------
// IPv6 rule

export function PinholeSheet({ open, deviceId, onClose }: { open: boolean; deviceId?: string; onClose: () => void }) {
  return open ? <PinholeBody key={deviceId ?? ""} deviceId={deviceId} onClose={onClose} /> : null;
}

function PinholeBody({ deviceId: initial, onClose }: { deviceId?: string; onClose: () => void }) {
  const devices = useDevices();
  const ids = { device: useId(), port: useId() };
  const [deviceId, setDeviceId] = useState(initial ?? "");
  const [port, setPort] = useState("");
  const [protocol, setProtocol] = useState<Protocol>("tcp");
  const device = devices.find((d) => d.id === deviceId);
  const add = useWrite<Record<string, unknown>, Pinhole>("pinhole.add", { form: true });
  const errors = fieldErrors(add.error);

  const save = () =>
    add.run(
      { device: deviceId, port: port.trim(), protocol },
      {
        success: (p) => `Opened port ${p.port} to ${device?.name ?? "the device"}`,
        undo: (p) => ({ id: "pinhole.remove", params: { pinhole: p.id } }),
      },
    );

  return (
    <Sheet
      open
      onClose={onClose}
      icon={<ShieldPlus />}
      title="Add IPv6 firewall rule"
      subtitle="Lets the internet reach one device over IPv6. Applies instantly, no restart."
      dirty={deviceId !== "" || port !== ""}
      valid={deviceId !== "" && port.trim() !== ""}
      onSave={save}
      saveLabel="Save rule"
      error={errors._form}
    >
      <SheetField label="Device" htmlFor={ids.device} error={errors.device} helper={device ? (device.ipv6[0] ?? "No IPv6 address yet") : undefined}>
        <DeviceSelect id={ids.device} value={deviceId} devices={devices} onChange={setDeviceId} />
      </SheetField>
      <SheetField label="Port" htmlFor={ids.port} error={errors.port} helper="A port or a range (27015-27030)">
        <Input id={ids.port} className="font-mono" inputMode="numeric" placeholder="443" value={port} onChange={(e) => setPort(e.currentTarget.value)} />
      </SheetField>
      <SheetField label="Protocol">
        <Segmented aria-label="Protocol" value={protocol} onValueChange={setProtocol} options={PROTOCOLS} />
      </SheetField>
    </Sheet>
  );
}

/** Removes an IPv6 rule after a confirm, with Undo that adds it back. */
export function removePinhole(p: Pinhole, deviceName: string) {
  return performWrite<Record<string, unknown>, PinholeRemoved>({
    params: { pinhole: p.id },
    askFirst: true,
    confirm: { title: `Close port ${p.port} to ${deviceName}?`, message: "The IPv6 firewall blocks this port again. Applies instantly, no restart.", confirmLabel: "Remove rule" },
    success: (res) => (res.alreadyGone ? `The rule on port ${p.port} was already removed` : `Closed port ${p.port} to ${deviceName}`),
    failure: `Couldn't remove the rule on port ${p.port}`,
    undo: ({ pinhole: r }) => (r?.deviceId ? { id: "pinhole.add", params: { device: r.deviceId, port: r.port, protocol: r.protocol } } : null),
    id: "pinhole.remove",
  });
}
