/**
 * Notification settings (docs/ux/overview.md#notifications-bell): the one
 * editor for every alert choice, a sheet any page opens with
 * `openNotificationSettings()` (the bell's gear, Activity's settings icon,
 * the Notifications row on App & account and its `#/account/notifications`
 * deep link). The bell hosts it (`NotificationSettingsHost`), so it opens
 * wherever you are, for the selected network.
 *
 * Three groups: eero alerts for the network (the keys
 * `notifications.settings.get` returns, never an eero Plus one; New device
 * joins shows this week's device events), the account's phone alerts
 * (Network goes offline, An eero goes offline; `account.push.set`) and the
 * desktop alert choices kept in Mesh UI's settings. Nothing saves until
 * Save: one `notifications.settings.set` with only the changed eero and
 * desktop keys, then `account.push.set` with the changed push keys. The
 * "Saved notification settings" toast's Undo puts every changed key back.
 */
import { BadgeCheck, Bell, BellRing, CalendarClock, CirclePlus, Router, ShieldAlert, UserCog, WifiOff } from "lucide-react";
import { type ReactNode, useState, useSyncExternalStore } from "react";

import { useQuery } from "~/app/useCommand";
import { performWrite, useWrite } from "~/app/useWrite";
import { useGate } from "~/components/ui/page";
import { Sheet } from "~/components/ui/sheet";
import { toast } from "~/components/ui/toast";
import { cn } from "~/lib/utils";
import type { DesktopKey } from "../../../../core/commands/notifications";
import type { Account, EventSummary, NetworkSummary, NotificationSettings as Settings } from "../../../../core/model";

// ---------------------------------------------------------------------------
// Open from anywhere

let isOpen = false;
const listeners = new Set<() => void>();
const setOpen = (next: boolean) => {
  isOpen = next;
  listeners.forEach((l) => l());
};

/** Opens the notification settings sheet over the current page. */
export const openNotificationSettings = () => setOpen(true);

function useSheetOpen(): boolean {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => isOpen,
  );
}

/** The selected network: the one the sheet edits and the Account row summarises. */
export function useSelectedNetwork(): NetworkSummary | null {
  const networks = useQuery<NetworkSummary[]>("network.list");
  return networks.data?.find((n) => n.selected) ?? networks.data?.[0] ?? null;
}

/** Renders the sheet while it is open. Mounted once, by the bell. */
export function NotificationSettingsHost() {
  const open = useSheetOpen();
  const network = useSelectedNetwork();
  if (!network) return null;
  return <NotificationSettingsSheet networkId={network.id} networkName={network.nickname ?? network.name} open={open} onClose={() => setOpen(false)} />;
}

// ---------------------------------------------------------------------------
// Rows

/** Labels for the eero keys seen so far; any other key shows as sent. */
const EERO_LABELS: Record<string, { label: string; detail?: string; icon?: ReactNode }> = {
  "device.new": { label: "New device joins", detail: "A device connects for the first time", icon: <CirclePlus /> },
  "device.restrict.new.private": { label: "New device with a private address", detail: "A device that hides its hardware address joins" },
  "network.updated": { label: "eeroOS updated", detail: "An update finished installing", icon: <BadgeCheck /> },
  "network.scheduledUpdate.earlyNotification": { label: "Update scheduled", detail: "Ahead of a scheduled update", icon: <CalendarClock /> },
  "network.scheduledUpdate.lateNotification": { label: "Update starting soon", detail: "Just before a scheduled update", icon: <CalendarClock /> },
  "network.dataUsageReport": { label: "Data usage report" },
  "permissions.updates": { label: "Admin changes", detail: "Someone is added or removed as an admin", icon: <UserCog /> },
  "port.security.blocked": { label: "Port security blocked a device", icon: <ShieldAlert /> },
};

type PushKey = keyof NonNullable<Settings["push"]>;

const PUSH_ROWS: { key: PushKey; label: string; icon: ReactNode }[] = [
  { key: "networkOffline", label: "Network goes offline", icon: <WifiOff /> },
  { key: "nodeOffline", label: "An eero goes offline", icon: <Router /> },
];

const DESKTOP_ROWS: { key: Exclude<DesktopKey, "enabled">; label: string; detail: string }[] = [
  { key: "offline", label: "Network or eero offline", detail: "Shown first" },
  { key: "devices", label: "Devices", detail: "New and blocked devices" },
  { key: "other", label: "Everything else", detail: "Updates, admins and the rest" },
];

/** Keys in a stable order: the labelled ones as listed, then the rest by name. */
const LABEL_ORDER = Object.keys(EERO_LABELS);
const alertOrder = (k: string) => {
  const i = LABEL_ORDER.indexOf(k);
  return i === -1 ? LABEL_ORDER.length : i;
};
const sortedKeys = (eero: Record<string, boolean>) => Object.keys(eero).sort((a, b) => alertOrder(a) - alertOrder(b) || a.localeCompare(b));

/** One line for the Account row: "Desktop on · 6 of 9 alerts on" (eero and phone alerts). */
export function notificationSummary(s: Settings): string {
  const alerts = [...Object.values(s.eero), ...(s.push ? Object.values(s.push) : [])];
  const on = alerts.filter(Boolean).length;
  return `Desktop ${s.desktop.enabled === false ? "off" : "on"} · ${on} of ${alerts.length} alerts on`;
}

// ---------------------------------------------------------------------------
// The sheet

type Draft = { eero: Record<string, boolean>; push: Record<string, boolean>; desktop: Record<string, boolean> };

/** The keys whose value differs from `from`. */
const changed = (from: Record<string, boolean>, to: Record<string, boolean>): Record<string, boolean> =>
  Object.fromEntries(Object.entries(to).filter(([k, v]) => (from[k] ?? true) !== v));
const pick = (keys: string[], from: Record<string, boolean>) => Object.fromEntries(keys.map((k) => [k, from[k] ?? true]));
const some = (o: Record<string, boolean>) => Object.keys(o).length > 0;

/** The sheet, or nothing while closed. */
function NotificationSettingsSheet({ networkId, networkName, open, onClose }: { networkId: string; networkName: string | null; open: boolean; onClose: () => void }) {
  const settings = useQuery<Settings>("notifications.settings.get", { networkId }, { enabled: open });
  if (!open) return null;
  if (!settings.data) {
    // Open at once: loading, or the read failed with a Retry.
    return (
      <Sheet open onClose={onClose} icon={<BellRing />} title="Notification settings" dirty={false} onSave={async () => null}>
        <p className="py-4 text-center text-muted-foreground text-xs">
          {settings.error ? (
            <>
              Could not load notification settings.{" "}
              <button type="button" className="underline hover:text-foreground" onClick={() => void settings.refetch()}>
                Retry
              </button>
            </>
          ) : (
            "Loading notification settings."
          )}
        </p>
      </Sheet>
    );
  }
  return <SettingsForm networkId={networkId} networkName={networkName} saved={settings.data} onClose={onClose} />;
}

function SettingsForm({ networkId, networkName, saved, onClose }: { networkId: string; networkName: string | null; saved: Settings; onClose: () => void }) {
  const gate = useGate("notifications.settings.set");
  const pushGate = useGate("account.push.set");
  const write = useWrite<{ networkId: string; eero?: Record<string, boolean>; desktop?: Record<string, boolean> }, Settings>("notifications.settings.set", {
    failure: "Couldn't save notification settings",
  });
  const push = useWrite<Record<string, boolean>, Account>("account.push.set", { failure: "Couldn't save phone alerts" });
  const week = useQuery<EventSummary>("events.summary", { networkId, range: "week", type: ["devices"] });
  const savedPush: Record<string, boolean> = saved.push ?? {};
  const [draft, setDraft] = useState<Draft>({ eero: { ...saved.eero }, push: { ...savedPush }, desktop: { ...saved.desktop } });

  const eeroChanges = changed(saved.eero, draft.eero);
  const pushChanges = changed(savedPush, draft.push);
  const desktopChanges = changed(saved.desktop, draft.desktop);
  const dirty = some(eeroChanges) || some(pushChanges) || some(desktopChanges);
  const desktopOn = draft.desktop.enabled !== false;
  const keys = sortedKeys(saved.eero);
  const weekDetail = week.data ? `${week.data.total} device ${week.data.total === 1 ? "event" : "events"} this week` : undefined;

  const save = async () => {
    // Undo is built from what was saved before, for exactly the keys this save changes.
    const undoEero = pick(Object.keys(eeroChanges), saved.eero);
    const undoDesktop = pick(Object.keys(desktopChanges), saved.desktop);
    const undoPush = pick(Object.keys(pushChanges), savedPush);
    const settingsUndo =
      some(undoEero) || some(undoDesktop)
        ? { id: "notifications.settings.set", params: { networkId, ...(some(undoEero) ? { eero: undoEero } : {}), ...(some(undoDesktop) ? { desktop: undoDesktop } : {}) } }
        : null;
    const pushUndo = some(undoPush) ? { id: "account.push.set", params: undoPush } : null;

    let last: unknown = null;
    if (some(eeroChanges) || some(desktopChanges)) {
      last = await write.run({ networkId, ...(some(eeroChanges) ? { eero: eeroChanges } : {}), ...(some(desktopChanges) ? { desktop: desktopChanges } : {}) }, { form: true });
      if (!isOk(last)) return last;
    }
    if (some(pushChanges)) {
      last = await push.run(pushChanges, { form: true });
      if (!isOk(last)) return last;
    }
    toast.success("Saved notification settings", {
      action: {
        label: "Undo",
        run: async () => {
          if (settingsUndo) await performWrite({ ...settingsUndo, success: pushUndo ? undefined : "Undone" });
          if (pushUndo) await performWrite({ ...pushUndo, success: "Undone" });
        },
      },
    });
    return last;
  };

  const set = (area: keyof Draft, key: string, on: boolean) => setDraft((d) => ({ ...d, [area]: { ...d[area], [key]: on } }));

  return (
    <Sheet
      open
      onClose={onClose}
      icon={<BellRing />}
      title="Notification settings"
      subtitle={`${networkName ?? "This network"} · shown in the bell, on your phone and as desktop alerts`}
      dirty={dirty}
      onSave={save}
      error={write.error?.message ?? push.error?.message ?? null}
    >
      {/* The sheet sits near the top of the window: scroll the switches, keep the footer in view. */}
      <div className="-mx-5 -my-4 flex max-h-[calc(100vh-13rem)] flex-col gap-4 overflow-y-auto px-5 py-4">
        <Group title="eero alerts" hint="Sent by eero for this network">
          {keys.length ? (
            keys.map((k) => (
              <SwitchRow
                key={k}
                icon={EERO_LABELS[k]?.icon ?? <Bell />}
                label={EERO_LABELS[k]?.label ?? k}
                detail={k === "device.new" ? (weekDetail ?? EERO_LABELS[k]?.detail) : EERO_LABELS[k]?.detail}
                on={draft.eero[k] === true}
                disabled={!gate.allowed}
                title={gate.reason ?? undefined}
                onChange={(on) => set("eero", k, on)}
              />
            ))
          ) : (
            <p className="py-2 text-muted-foreground text-xs">eero sent no alert switches for this network.</p>
          )}
        </Group>
        {saved.push && (
          <Group title="Phone alerts" hint="From the eero app, for every network on the account">
            {PUSH_ROWS.map((r) => (
              <SwitchRow
                key={r.key}
                icon={r.icon}
                label={r.label}
                on={draft.push[r.key] ?? null}
                disabled={!pushGate.allowed}
                title={pushGate.reason ?? undefined}
                onChange={(on) => set("push", r.key, on)}
              />
            ))}
          </Group>
        )}
        <Group title="Desktop alerts" hint="On this computer, for every network">
          <SwitchRow label="Show desktop alerts" on={desktopOn} onChange={(on) => set("desktop", "enabled", on)} />
          {DESKTOP_ROWS.map((r) => (
            <SwitchRow key={r.key} label={r.label} detail={r.detail} on={draft.desktop[r.key] !== false} disabled={!desktopOn} onChange={(on) => set("desktop", r.key, on)} />
          ))}
        </Group>
      </div>
    </Sheet>
  );
}

const isOk = (res: unknown) => typeof res === "object" && res !== null && (res as { ok?: unknown }).ok === true;

function Group({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="shrink-0 font-medium text-foreground text-sm">{title}</h3>
        <span className="truncate text-2xs text-muted-foreground">{hint}</span>
      </div>
      <div className="flex flex-col divide-y divide-border/50 rounded-lg border px-3">{children}</div>
    </section>
  );
}

/**
 * One switch row: optional icon, label, muted detail, and a switch. `on` null
 * (eero sent no value) shows a dashed track that cannot be used. Also used
 * by App & account's Account section.
 */
export function SwitchRow({
  icon,
  label,
  detail,
  on,
  disabled,
  title,
  onChange,
  className,
}: {
  icon?: ReactNode;
  label: string;
  detail?: ReactNode;
  on: boolean | null | undefined;
  disabled?: boolean;
  /** Tooltip on the switch, e.g. why it is off. */
  title?: string;
  onChange: (on: boolean) => void;
  className?: string;
}) {
  const known = on === true || on === false;
  const off = disabled || !known;
  return (
    <div className={cn("flex items-center gap-3 py-1.5", disabled && "opacity-60", className)}>
      {icon && <span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground [&_svg]:size-3.5">{icon}</span>}
      <div className="min-w-0 flex-1">
        <div className="text-foreground/90 text-xs">{label}</div>
        {detail && <div className="text-2xs text-muted-foreground">{detail}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on === true}
        aria-label={label}
        disabled={off}
        title={!known ? "eero does not report this setting" : title}
        onClick={() => onChange(!on)}
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full border",
          off ? "cursor-not-allowed" : "cursor-pointer",
          on ? "bg-foreground/70" : "bg-muted",
          !known && "border-dashed",
        )}
      >
        <i className={cn("absolute top-0.5 size-3.5 rounded-full bg-background shadow-sm", on ? "right-0.5" : "left-0.5")} />
      </button>
    </div>
  );
}
