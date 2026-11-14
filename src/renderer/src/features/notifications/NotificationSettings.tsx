/**
 * Notification settings (docs/ux/overview.md#notifications-bell), the sheet
 * the bell's gear opens: eero's alert switches for the selected network (the
 * keys `notifications.settings.get` returns, never an eero Plus one) and the
 * desktop alert choices kept in Mesh UI's settings. Save runs one
 * `notifications.settings.set` with only the changed keys; core merges them
 * into the whole map eero takes. Undo puts the changed keys back.
 */
import { BellRing } from "lucide-react";
import { useState } from "react";

import { useQuery } from "~/app/useCommand";
import { useWrite } from "~/app/useWrite";
import { useGate } from "~/components/ui/page";
import { Sheet } from "~/components/ui/sheet";
import { cn } from "~/lib/utils";
import type { DesktopKey } from "../../../../core/commands/notifications";
import type { NotificationSettings as Settings } from "../../../../core/model";

/** Labels for the eero keys seen so far; any other key shows as sent. */
const EERO_LABELS: Record<string, { label: string; detail?: string }> = {
  "device.new": { label: "New device joins", detail: "A device connects for the first time" },
  "device.restrict.new.private": { label: "New device with a private address", detail: "A device that hides its hardware address joins" },
  "network.updated": { label: "eeroOS updated", detail: "An update finished installing" },
  "network.scheduledUpdate.earlyNotification": { label: "Update scheduled", detail: "Ahead of a scheduled update" },
  "network.scheduledUpdate.lateNotification": { label: "Update starting soon", detail: "Just before a scheduled update" },
  "network.dataUsageReport": { label: "Data usage report" },
  "permissions.updates": { label: "Admin changes", detail: "Someone is added or removed as an admin" },
  "port.security.blocked": { label: "Port security blocked a device" },
};

const DESKTOP_ROWS: { key: Exclude<DesktopKey, "enabled">; label: string; detail: string }[] = [
  { key: "offline", label: "Network or eero offline", detail: "Shown first" },
  { key: "devices", label: "Devices", detail: "New and blocked devices" },
  { key: "other", label: "Everything else", detail: "Updates, admins and the rest" },
];

type Draft = { eero: Record<string, boolean>; desktop: Record<string, boolean> };

/** The keys whose value differs from `from`. */
const changed = (from: Record<string, boolean>, to: Record<string, boolean>): Record<string, boolean> =>
  Object.fromEntries(Object.entries(to).filter(([k, v]) => (from[k] ?? true) !== v));

/** The sheet, or nothing while closed. `networkId` is the bell's network. */
export function NotificationSettingsSheet({ networkId, networkName, open, onClose }: { networkId: string; networkName: string | null; open: boolean; onClose: () => void }) {
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
  const write = useWrite<{ networkId: string; eero?: Record<string, boolean>; desktop?: Record<string, boolean> }, Settings>("notifications.settings.set", {
    failure: "Couldn't save notification settings",
  });
  const [draft, setDraft] = useState<Draft>({ eero: { ...saved.eero }, desktop: { ...saved.desktop } });

  const eeroChanges = changed(saved.eero, draft.eero);
  const desktopChanges = changed(saved.desktop, draft.desktop);
  const dirty = Object.keys(eeroChanges).length + Object.keys(desktopChanges).length > 0;
  const desktopOn = draft.desktop.enabled !== false;
  const keys = Object.keys(saved.eero).sort((a, b) => order(a) - order(b));

  const save = () => {
    const pick = (keys: string[], from: Record<string, boolean>) => Object.fromEntries(keys.map((k) => [k, from[k] ?? true]));
    const undoEero = pick(Object.keys(eeroChanges), saved.eero);
    const undoDesktop = pick(Object.keys(desktopChanges), saved.desktop);
    const params = {
      networkId,
      ...(Object.keys(eeroChanges).length ? { eero: eeroChanges } : {}),
      ...(Object.keys(desktopChanges).length ? { desktop: desktopChanges } : {}),
    };
    return write.run(params, {
      form: true,
      success: "Saved notification settings",
      undo: {
        id: "notifications.settings.set",
        params: { networkId, ...(Object.keys(undoEero).length ? { eero: undoEero } : {}), ...(Object.keys(undoDesktop).length ? { desktop: undoDesktop } : {}) },
      },
    });
  };

  const set = (area: keyof Draft, key: string, on: boolean) => setDraft((d) => ({ ...d, [area]: { ...d[area], [key]: on } }));

  return (
    <Sheet
      open
      onClose={onClose}
      icon={<BellRing />}
      title="Notification settings"
      subtitle={`${networkName ?? "This network"} · eero alerts go to the eero app; desktop alerts show while Mesh UI runs`}
      dirty={dirty}
      valid={gate.allowed}
      onSave={save}
      error={write.error?.message ?? (gate.allowed ? null : gate.reason)}
    >
      {/* The sheet sits near the top of the window: scroll the switches, keep the footer in view. */}
      <div className="-mx-5 -my-4 flex max-h-[calc(100vh-13rem)] flex-col gap-4 overflow-y-auto px-5 py-4">
        <Group title="eero alerts" hint="Sent by eero for this network">
          {keys.length ? (
            keys.map((k) => (
              <Row key={k} label={EERO_LABELS[k]?.label ?? k} detail={EERO_LABELS[k]?.detail} on={draft.eero[k] === true} onChange={(on) => set("eero", k, on)} />
            ))
          ) : (
            <p className="py-2 text-muted-foreground text-xs">eero sent no alert switches for this network.</p>
          )}
        </Group>
        <Group title="Desktop alerts" hint="On this computer, for every network">
          <Row label="Show desktop alerts" on={desktopOn} onChange={(on) => set("desktop", "enabled", on)} />
          {DESKTOP_ROWS.map((r) => (
            <Row key={r.key} label={r.label} detail={r.detail} on={draft.desktop[r.key] !== false} disabled={!desktopOn} onChange={(on) => set("desktop", r.key, on)} />
          ))}
        </Group>
      </div>
    </Sheet>
  );
}

/** Keys in a stable order: the labelled ones as listed, then the rest by name. */
const LABEL_ORDER = Object.keys(EERO_LABELS);
const order = (k: string) => {
  const i = LABEL_ORDER.indexOf(k);
  return i === -1 ? LABEL_ORDER.length : i;
};

function Group({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between">
        <h3 className="font-medium text-foreground text-sm">{title}</h3>
        <span className="text-2xs text-muted-foreground">{hint}</span>
      </div>
      <div className="flex flex-col divide-y divide-border/50 rounded-lg border px-3">{children}</div>
    </section>
  );
}

function Row({ label, detail, on, disabled, onChange }: { label: string; detail?: string; on: boolean; disabled?: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className={cn("flex items-center gap-3 py-1.5", disabled && "opacity-60")}>
      <div className="min-w-0 flex-1">
        <div className="text-foreground/90 text-xs">{label}</div>
        {detail && <div className="text-2xs text-muted-foreground">{detail}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!on)}
        className={cn("relative h-5 w-9 shrink-0 rounded-full border", disabled ? "cursor-not-allowed" : "cursor-pointer", on ? "bg-foreground/70" : "bg-muted")}
      >
        <i className={cn("absolute top-0.5 size-3.5 rounded-full bg-background shadow-sm", on ? "right-0.5" : "left-0.5")} />
      </button>
    </div>
  );
}
