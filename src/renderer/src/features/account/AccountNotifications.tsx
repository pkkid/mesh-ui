/**
 * Account & Settings, Notifications (docs/ux/pages/account-settings.md, Layout 3):
 * the selected network's alerts, shown in the bell and as desktop
 * notifications. Header switch: Desktop notifications
 * (`notifications.settings.set` `{desktop: {enabled}}`). Rows: New device
 * joins with this week's device events from `events.summary`, the account's
 * push switches (Network goes offline, An eero goes offline;
 * `account.push.set`), then every other alert key eero sends for the
 * network (`notifications.settings.set` `{eero: {[key]}}`), the same rows as
 * the bell's settings sheet. Each switch writes at once with Undo.
 * Activity's settings icon opens it at `#/account/notifications`.
 *
 * Not here: the mockup's weekly report row (its `report_settings` source is
 * not captured; eero's own `network.dataUsageReport` key shows as "Data
 * usage report" when eero sends it) and Simple Setup (an integrations
 * setting, M6.10).
 */
import { BadgeCheck, Bell, CalendarClock, CirclePlus, Router, ShieldAlert, UserCog, WifiOff } from "lucide-react";
import type { ReactNode } from "react";

import { useQuery } from "~/app/useCommand";
import { useWrite } from "~/app/useWrite";
import { Card, Section } from "~/components/ui/card";
import { SectionError, useGate } from "~/components/ui/page";
import { alertOrder, EERO_LABELS, SwitchRow } from "~/features/notifications/NotificationSettings";
import { cn } from "~/lib/utils";
import type { Account, EventSummary, NetworkSummary, NotificationSettings } from "../../../../core/model";

const ICONS: Record<string, ReactNode> = {
  "device.new": <CirclePlus />,
  "network.scheduledUpdate.earlyNotification": <CalendarClock />,
  "network.scheduledUpdate.lateNotification": <CalendarClock />,
  "network.updated": <BadgeCheck />,
  "permissions.updates": <UserCog />,
  "port.security.blocked": <ShieldAlert />,
};

type SetParams = { networkId: string; eero?: Record<string, boolean>; desktop?: Record<string, boolean> };

export function AccountNotifications({ id }: { id?: string }) {
  const networks = useQuery<NetworkSummary[]>("network.list");
  const current = networks.data?.find((n) => n.selected) ?? networks.data?.[0] ?? null;
  const networkId = current?.id ?? null;
  const params = networkId ? { networkId } : undefined;
  const settings = useQuery<NotificationSettings>("notifications.settings.get", params, { enabled: networkId !== null });
  const account = useQuery<Account>("account.get", undefined, { poll: true });
  const week = useQuery<EventSummary>("events.summary", networkId ? { networkId, range: "week", type: ["devices"] } : undefined, { enabled: networkId !== null });

  const gate = useGate("notifications.settings.set");
  const pushGate = useGate("account.push.set");
  const set = useWrite<SetParams, NotificationSettings>("notifications.settings.set", { failure: "Couldn't change the alert" });
  const push = useWrite<{ networkOffline?: boolean; nodeOffline?: boolean }, Account>("account.push.set", { failure: "Couldn't change the phone alert" });

  const s = settings.data;
  const desktopOn = s ? s.desktop.enabled !== false : null;
  const pushOn = account.data?.push ?? s?.push ?? null;
  const name = current ? (current.nickname ?? current.name) : null;
  const keys = s ? Object.keys(s.eero).sort((a, b) => alertOrder(a) - alertOrder(b)) : [];
  const weekDetail = week.data ? `${week.data.total} device ${week.data.total === 1 ? "event" : "events"} this week` : undefined;

  const setEero = (key: string, on: boolean, label: string) => {
    if (!networkId) return;
    void set.run(
      { networkId, eero: { [key]: on } },
      { success: `${label}: ${on ? "on" : "off"}`, undo: { id: "notifications.settings.set", params: { networkId, eero: { [key]: !on } } } },
    );
  };
  const setDesktop = (on: boolean) => {
    if (!networkId) return;
    void set.run(
      { networkId, desktop: { enabled: on } },
      { success: on ? "Desktop notifications on" : "Desktop notifications off", undo: { id: "notifications.settings.set", params: { networkId, desktop: { enabled: !on } } } },
    );
  };
  const setPush = (key: "networkOffline" | "nodeOffline", on: boolean, label: string) =>
    void push.run({ [key]: on }, { success: `${label}: ${on ? "on" : "off"}`, undo: { id: "account.push.set", params: { [key]: !on } } });

  const busy = set.running || push.running;
  const usable = gate.allowed && !busy;

  return (
    <Section
      id={id}
      title="Notifications"
      subtitle={`${name ? `${name} alerts · ` : ""}shown in the bell and as desktop notifications`}
      tools={
        <label className="flex items-center gap-2 text-muted-foreground text-xs">
          Desktop notifications
          <HeaderSwitch on={desktopOn} disabled={!usable} onChange={setDesktop} />
        </label>
      }
    >
      {settings.error && !s ? (
        <SectionError what="notification settings" error={settings.error} onRetry={() => void settings.refetch()} />
      ) : (
        <Card className={cn("divide-y divide-border/50 px-4", (settings.fading || account.fading) && "opacity-40")}>
          <SwitchRow
            icon={<CirclePlus />}
            label={EERO_LABELS["device.new"]?.label ?? "New device joins"}
            detail={weekDetail}
            on={s ? (s.eero["device.new"] ?? null) : null}
            disabled={!usable || !s || !("device.new" in s.eero)}
            title={gate.reason ?? undefined}
            onChange={(on) => setEero("device.new", on, "New device joins")}
          />
          <SwitchRow
            icon={<WifiOff />}
            label="Network goes offline"
            detail="Phone alert from the eero app, for every network on the account"
            on={pushOn?.networkOffline ?? null}
            disabled={!pushGate.allowed || busy}
            onChange={(on) => setPush("networkOffline", on, "Network offline alerts")}
          />
          <SwitchRow
            icon={<Router />}
            label="An eero goes offline"
            detail="Phone alert from the eero app, for every network on the account"
            on={pushOn?.nodeOffline ?? null}
            disabled={!pushGate.allowed || busy}
            onChange={(on) => setPush("nodeOffline", on, "eero offline alerts")}
          />
          {keys
            .filter((k) => k !== "device.new")
            .map((k) => {
              const label = EERO_LABELS[k]?.label ?? k;
              return (
                <SwitchRow
                  key={k}
                  icon={ICONS[k] ?? <Bell />}
                  label={label}
                  detail={EERO_LABELS[k]?.detail}
                  on={s?.eero[k] ?? null}
                  disabled={!usable}
                  title={gate.reason ?? undefined}
                  onChange={(on) => setEero(k, on, label)}
                />
              );
            })}
          {!s && !settings.error && <div className="py-3 text-muted-foreground text-xs">Loading alerts.</div>}
        </Card>
      )}
    </Section>
  );
}

function HeaderSwitch({ on, disabled, onChange }: { on: boolean | null; disabled: boolean; onChange: (on: boolean) => void }) {
  const known = on !== null;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on === true}
      aria-label="Desktop notifications"
      disabled={disabled || !known}
      onClick={() => onChange(!on)}
      className={cn("relative h-5 w-9 shrink-0 rounded-full border", disabled || !known ? "cursor-not-allowed opacity-60" : "cursor-pointer", on ? "bg-foreground/70" : "bg-muted")}
    >
      <i className={cn("absolute top-0.5 size-3.5 rounded-full bg-background shadow-sm", on ? "right-0.5" : "left-0.5")} />
    </button>
  );
}
