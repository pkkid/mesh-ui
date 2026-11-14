/**
 * Notifications: the bell's list and the alert switches, plus the new-item
 * detection every desktop alert surface shares. See
 * docs/architecture/commands.md (notifications).
 *
 * eero keeps no read flag per notification, only `has_unread` for the whole
 * network. So `unread` (the bell's dot) comes from eero, rows are read unless
 * a backend knows better (the demo does), and "new" for desktop alerts means
 * an id this surface has not seen before, never a read flag.
 */

import { z } from "zod";
import type * as M from "../model";
import { POLL, TTL } from "../poll";
import { type AnyCommand, defineCommand } from "../spec";

/** Desktop alert choices when settings.json has none: on. */
export const DESKTOP_DEFAULTS: Readonly<Record<string, boolean>> = { enabled: true };

/** At most this many desktop alerts per poll, so a burst never floods the OS. */
export const MAX_ALERTS_PER_POLL = 5;

/** The number of unread rows on a page. */
export const unreadCount = (page: M.NotificationPage): number => (page.unread ? page.notifications.filter((n) => !n.read).length : 0);

/** A network or eero going offline: these alert first. */
export const isOfflineAlert = (n: M.Notification): boolean => (n.category === "network" || n.category === "eero") && /offline/i.test(`${n.title} ${n.body}`);

/** Whether desktop alerts are on. */
export const desktopEnabled = (desktop: Record<string, boolean> | null | undefined): boolean => desktop?.enabled !== false;

export type NewNotifications = {
  /** Items to alert, offline network and eero first, then newest first. Empty on the first page seen. */
  alerts: M.Notification[];
  /** Every id seen so far, to pass back on the next poll. */
  seen: Set<string>;
};

/**
 * New-item detection for desktop alerts. `seen` is null on the first load (or
 * after a network switch), which alerts nothing and only remembers the ids.
 * After that, every id not seen before is new, read or not.
 */
export function findNewNotifications(seen: ReadonlySet<string> | null, page: M.NotificationPage): NewNotifications {
  const next = new Set(seen ?? []);
  const fresh: M.Notification[] = [];
  for (const n of page.notifications) {
    if (next.has(n.id)) continue;
    next.add(n.id);
    if (seen) fresh.push(n);
  }
  fresh.sort((a, b) => Number(isOfflineAlert(b)) - Number(isOfflineAlert(a)) || b.at.localeCompare(a.at));
  return { alerts: fresh.slice(0, MAX_ALERTS_PER_POLL), seen: next };
}

export const commands: AnyCommand[] = [
  defineCommand({
    id: "notifications.list",
    label: "Notifications",
    description:
      "Network notifications newest first, a page at a time (pass nextCursor back as cursor), and whether any are unread. eero keeps one unread flag per network, not per notification.",
    icon: "bell",
    params: z.object({
      cursor: z.string().min(1).optional().describe("nextCursor from the previous page."),
    }),
    effect: "query",
    topic: "notifications",
    // Only the first page is cached; later pages are read fresh.
    ttl: (p) => (p.cursor ? 0 : TTL.notifications),
    poll: POLL.notifications,
    async run(ctx, p): Promise<M.NotificationPage> {
      const [chunk, unread] = await Promise.all([ctx.backend.notifications.list(ctx.net, p.cursor ?? null), ctx.backend.notifications.unread(ctx.net)]);
      // Nothing unread on eero's side means every row is read, whatever a row says.
      const notifications = unread ? chunk.notifications : chunk.notifications.map((n) => (n.read ? n : { ...n, read: true }));
      return { notifications, unread, nextCursor: chunk.nextCursor };
    },
  }),
  defineCommand({
    id: "notifications.settings.get",
    label: "Notification settings",
    description: "eero's alert switches for this network (keys as eero sends them, e.g. device.new), the account's push choices, and the desktop alert choices from app settings.",
    icon: "bell",
    params: z.object({}),
    effect: "query",
    topic: "notification_settings",
    async run(ctx): Promise<M.NotificationSettings> {
      const [eero, account, app] = await Promise.all([ctx.backend.notifications.settings(ctx.net), ctx.backend.account.get(), ctx.settings.get()]);
      return { eero, push: account.push, desktop: { ...DESKTOP_DEFAULTS, ...app.desktopNotifications } };
    },
  }),
];
