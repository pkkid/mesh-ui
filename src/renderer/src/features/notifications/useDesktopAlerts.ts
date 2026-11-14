/**
 * The bell's data and desktop alerts (docs/ux/overview.md#notifications-bell).
 *
 * - `useNotificationPage()` is the one `notifications.list` poll, for the
 *   selected network, shared by the bell and the alerts.
 * - `useDesktopAlerts()` passes each new page to an alerter, which finds new
 *   items with core's `findNewNotifications` and asks the host for one OS
 *   notification each through `window.mesh.notify`. Nothing on the first
 *   page seen for a network, and nothing while the desktop choice is off.
 *   A clicked alert comes back with its path and network: it switches to
 *   that network if another is selected now, then opens the page.
 *
 * No `~` imports and no router import, so the pure parts are unit tested in
 * Node (useDesktopAlerts.test.ts); opening a page sets the hash the router follows.
 *
 * Alert text is eero data: it goes to the host and nowhere else (no logs).
 */
import { useEffect, useRef } from "react";

import { execute, useQuery } from "../../app/useCommand";
import { desktopEnabled, findNewNotifications, isOfflineAlert } from "../../../../core/commands/notifications";
import type { NetworkSummary, Notification, NotificationPage, NotificationSettings } from "../../../../core/model";
import type { AlertTarget, DesktopAlert, MeshApi } from "../../../../shared/types";

/** The page a notification is about: its device, the eeros, the network, Updates, Profiles or Activity. */
export function notificationPath(n: Notification): string {
  if (n.refs.deviceId) return `/devices/${encodeURIComponent(n.refs.deviceId)}`;
  const text = `${n.title} ${n.body}`;
  switch (n.category) {
    case "eero":
      return "/eeros";
    case "profile":
      return "/profiles";
    case "device":
      return "/devices";
    case "network":
      if (isOfflineAlert(n)) return "/overview";
      if (/update|eeroos/i.test(text)) return "/settings/updates";
      return "/overview";
    default:
      return "/activity";
  }
}

export type Alerter = {
  /** Feeds one page for a network. Returns how many alerts it asked the host for. */
  update(networkId: string, page: NotificationPage, enabled: boolean): number;
};

/** Remembers the ids seen per selected network; a network switch starts over without alerting. */
export function createAlerter(notify: (alert: DesktopAlert) => void): Alerter {
  let network: string | null = null;
  let seen: Set<string> | null = null;
  return {
    update(networkId, page, enabled) {
      if (networkId !== network) {
        network = networkId;
        seen = null;
      }
      const found = findNewNotifications(seen, page);
      seen = found.seen;
      // Off: keep remembering, so turning alerts on later does not replay old items.
      if (!enabled) return 0;
      for (const n of found.alerts) notify({ title: n.title, body: n.body, target: notificationPath(n), networkId });
      return found.alerts.length;
    },
  };
}

/**
 * A clicked alert: selects the network it came from when another one is
 * selected now, then returns the path to open (null when it cannot).
 */
export async function openAlert(
  click: AlertTarget,
  selected: string | null,
  run: (id: string, params: unknown) => Promise<{ ok: boolean }>,
): Promise<string | null> {
  // main only passes app paths (src/main/notify.ts checkAlert).
  if (!click.target.startsWith("/")) return null;
  if (click.networkId !== selected && !(await run("network.select", { network: click.networkId })).ok) return null;
  return click.target;
}

const mesh = (): Partial<MeshApi> | undefined => (window as { mesh?: Partial<MeshApi> }).mesh;

/** The selected network's first notifications page, polled every 60 s. */
export function useNotificationPage() {
  const networks = useQuery<NetworkSummary[]>("network.list");
  const current = networks.data?.find((n) => n.selected) ?? networks.data?.[0] ?? null;
  const networkId = current?.id ?? null;
  const page = useQuery<NotificationPage>("notifications.list", networkId ? { networkId } : undefined, { poll: true, enabled: networkId !== null });
  return { networkId, ...page };
}

export function useDesktopAlerts(networkId: string | null, page: NotificationPage | null): void {
  const settings = useQuery<NotificationSettings>("notifications.settings.get", networkId ? { networkId } : undefined, { enabled: networkId !== null });
  const alerter = useRef<Alerter | null>(null);
  const current = useRef(networkId);
  current.current = networkId;
  // Until settings load, remember ids without alerting; if they cannot load, alerts stay on (the default).
  const enabled = settings.data ? desktopEnabled(settings.data.desktop) : settings.error !== null;

  useEffect(() => {
    const notify = mesh()?.notify;
    if (!networkId || !page || typeof notify !== "function") return;
    alerter.current ??= createAlerter(notify);
    alerter.current.update(networkId, page, enabled);
  }, [networkId, page, enabled]);

  useEffect(() => {
    const on = mesh()?.onNotificationClick;
    if (typeof on !== "function") return;
    return on(async (click) => {
      const path = await openAlert(click, current.current, execute);
      if (path) window.location.hash = path;
    });
  }, []);
}
