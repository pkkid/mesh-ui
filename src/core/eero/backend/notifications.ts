/**
 * eero backend, notifications area: `GET {net}/notifications_history`
 * (`limit=50`, paged by `timestamp`, the `created_at` of the last row),
 * `GET {net}/notifications/has_unread` and `GET {net}/notifications`,
 * `POST {net}/notifications/mark_read` (empty-JSON body, network-wide), and
 * `PUT {net}/notifications` with the whole switch map (dotted keys as sent,
 * never an eero Plus key; core merges the change into the current map).
 */

import type { NotificationChunk } from "../../backend";
import type * as M from "../../model";
import { mapHasUnread, mapNotification, mapNotificationSettings } from "../map/notifications";
import { asList, type RawHasUnread, type RawNotification, type RawNotificationSettings } from "../raw";
import { networkPath } from "../urls";
import type { EeroArea } from "./index";

export const NOTIFICATION_PAGE_SIZE = 50;

export const notifications: EeroArea<"notifications"> = ({ client }) => ({
  async list(net, cursor): Promise<NotificationChunk> {
    const data = await client.request<unknown>({
      method: "GET",
      path: networkPath(net, "notifications_history"),
      query: { limit: NOTIFICATION_PAGE_SIZE, timestamp: cursor ?? undefined },
    });
    const raw = asList<RawNotification>(data, "notifications");
    const last = raw[raw.length - 1];
    const lastTime = typeof last?.created_at === "string" && last.created_at ? last.created_at : null;
    const rows = raw.map(mapNotification).filter((n): n is M.Notification => n !== null);
    rows.sort((a, b) => b.at.localeCompare(a.at));
    return { notifications: rows, nextCursor: raw.length >= NOTIFICATION_PAGE_SIZE && lastTime ? lastTime : null };
  },
  async unread(net) {
    return mapHasUnread(await client.request<RawHasUnread | null>({ method: "GET", path: networkPath(net, "notifications/has_unread") }));
  },
  async markRead(net) {
    await client.request<unknown>({ method: "POST", path: networkPath(net, "notifications/mark_read"), encoding: "empty" });
  },
  async settings(net) {
    return mapNotificationSettings(await client.request<RawNotificationSettings | null>({ method: "GET", path: networkPath(net, "notifications") }));
  },
  async setSettings(net, settings) {
    // mapNotificationSettings keeps only booleans and drops eero Plus keys, so none is ever sent.
    const body = mapNotificationSettings(settings);
    const data = await client.request<RawNotificationSettings | null>({ method: "PUT", path: networkPath(net, "notifications"), body });
    // eero's answer to the PUT is not captured: use it when it is the map, else what was sent.
    const echoed = mapNotificationSettings(data);
    return Object.keys(echoed).length ? echoed : body;
  },
});
