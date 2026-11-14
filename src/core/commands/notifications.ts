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
import { CommandError } from "../errors";
import type * as M from "../model";
import { POLL, TTL } from "../poll";
import { type AnyCommand, defineCommand } from "../spec";

/** Desktop alert choices when settings.json has none: on. */
export const DESKTOP_DEFAULTS: Readonly<Record<string, boolean>> = { enabled: true };

/**
 * The desktop choices `notifications.settings.set` takes: `enabled` is the
 * master switch, the rest pick kinds of alert (`desktopKind`). A missing kind
 * counts as on.
 */
export const DESKTOP_KEYS = ["enabled", "offline", "devices", "other"] as const;
export type DesktopKey = (typeof DESKTOP_KEYS)[number];

/** eero Plus switches (out of scope, AGENTS.md): never read, offered or sent. */
export const isPlusNotificationKey = (key: string): boolean => /^(premium|backup)\./.test(key);

/** At most this many desktop alerts per poll, so a burst never floods the OS. */
export const MAX_ALERTS_PER_POLL = 5;

/** The number of unread rows on a page. */
export const unreadCount = (page: M.NotificationPage): number => (page.unread ? page.notifications.filter((n) => !n.read).length : 0);

/** A network or eero going offline: these alert first. */
export const isOfflineAlert = (n: M.Notification): boolean => (n.category === "network" || n.category === "eero") && /offline/i.test(`${n.title} ${n.body}`);

/** Whether desktop alerts are on. */
export const desktopEnabled = (desktop: Record<string, boolean> | null | undefined): boolean => desktop?.enabled !== false;

/** Which desktop choice covers a notification: an offline network or eero, a device, or anything else. */
export const desktopKind = (n: M.Notification): Exclude<DesktopKey, "enabled"> => (isOfflineAlert(n) ? "offline" : n.category === "device" || n.category === "devices" ? "devices" : "other");

/** Whether the desktop choices allow an OS alert for this notification. */
export const desktopAllows = (desktop: Record<string, boolean> | null | undefined, n: M.Notification): boolean => desktopEnabled(desktop) && desktop?.[desktopKind(n)] !== false;

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

/**
 * New items to show as OS alerts under the desktop choices: the same
 * detection, with the kinds turned off (or everything, when `enabled` is
 * false) left out. Every id is still remembered, so turning alerts back on
 * does not replay old items.
 */
export function findDesktopAlerts(seen: ReadonlySet<string> | null, page: M.NotificationPage, desktop: Record<string, boolean> | null | undefined): NewNotifications {
  const found = findNewNotifications(seen, page);
  return { alerts: found.alerts.filter((n) => desktopAllows(desktop, n)), seen: found.seen };
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
    id: "notifications.mark_read",
    label: "Mark all read",
    description:
      "Marks every notification on the network read, which clears eero's network-wide unread flag (the bell's dot). eero has no per-notification read flag and no way to mark them unread again.",
    icon: "check-check",
    params: z.object({}),
    effect: "write",
    gate: { area: "network" },
    invalidates: ["notifications"],
    async run(ctx): Promise<{ unread: false }> {
      await ctx.backend.notifications.markRead(ctx.net);
      return { unread: false };
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
  defineCommand({
    id: "notifications.settings.set",
    label: "Set notification settings",
    description:
      "Turns eero's alerts for this network on or off (keys as notifications.settings.get shows them, e.g. device.new) and the desktop alert choices (enabled, offline, devices, other) kept in Mesh UI's settings. Only the keys passed change; eero gets the whole merged map, never an eero Plus key. Returns the settings as the next read shows them.",
    icon: "bell-ring",
    params: z
      .object({
        eero: z
          .record(z.string().min(1), z.boolean())
          .optional()
          .describe("eero switches to change, keys as sent (device.new). Unknown and eero Plus keys are rejected."),
        desktop: z
          .partialRecord(z.enum(DESKTOP_KEYS), z.boolean())
          .optional()
          .describe("Desktop alert choices to change: enabled (all), offline, devices, other."),
      })
      .refine((p) => Object.keys(p.eero ?? {}).length + Object.keys(p.desktop ?? {}).length > 0, "Pass at least one eero or desktop choice."),
    effect: "write",
    // eero's switches are the signed-in account's own alerts and the desktop
    // choices are app-local, so no permission, mode or capability limits it.
    gate: { area: null },
    invalidates: ["notification_settings"],
    async run(ctx, p): Promise<M.NotificationSettings> {
      const changes = p.eero ?? {};
      const keys = Object.keys(changes);
      let eero: Record<string, boolean>;
      if (keys.length) {
        const plus = keys.filter(isPlusNotificationKey);
        if (plus.length) throw new CommandError("bad_params", `${plus.join(", ")} ${plus.length === 1 ? "is an" : "are"} eero Plus ${plus.length === 1 ? "setting" : "settings"}, which Mesh UI does not change.`);
        const current = await ctx.backend.notifications.settings(ctx.net);
        const unknown = keys.filter((k) => !(k in current));
        if (unknown.length) throw new CommandError("bad_params", `Unknown eero notification ${unknown.length === 1 ? "key" : "keys"}: ${unknown.join(", ")}. See notifications.settings.get.`);
        // eero takes the whole map: send every known switch, never a Plus one.
        const merged = Object.fromEntries(Object.entries({ ...current, ...changes }).filter(([k]) => !isPlusNotificationKey(k)));
        eero = await ctx.backend.notifications.setSettings(ctx.net, merged);
      } else {
        eero = await ctx.backend.notifications.settings(ctx.net);
      }
      const app = await ctx.settings.get();
      let desktop = app.desktopNotifications;
      if (p.desktop && Object.keys(p.desktop).length) {
        desktop = { ...desktop, ...p.desktop };
        await ctx.settings.update({ desktopNotifications: desktop });
      }
      const account = await ctx.backend.account.get();
      return { eero, push: account.push, desktop: { ...DESKTOP_DEFAULTS, ...desktop } };
    },
  }),
];
