/**
 * eero notifications to the model: `GET {net}/notifications_history` rows,
 * `GET {net}/notifications/has_unread` and the `GET {net}/notifications`
 * switches. See docs/architecture/data-model.md (Activity and notifications).
 */

import type * as M from "../../model";
import type { RawHasUnread, RawNotification, RawNotificationSettings } from "../raw";
import { idFromUrl } from "../urls";

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * One history row, or null when it has no usable time. eero sends no read
 * flag per row, only `has_unread` for the whole network, so rows map as read
 * and the bell's dot follows `has_unread` (notifications.list).
 */
export function mapNotification(raw: RawNotification): M.Notification | null {
  const when = text(raw.created_at);
  const ms = when ? Date.parse(when) : Number.NaN;
  if (!Number.isFinite(ms)) return null;
  const at = new Date(ms).toISOString();
  const title = text(raw.title) ?? text(raw.body) ?? "Notification";
  const body = text(raw.body);
  const deviceUrl = text(raw.meta?.device_url);
  return {
    id: text(raw.uuid) ?? `${title}@${at}`,
    at,
    title,
    body: body && body !== title ? body : "",
    read: true,
    category: text(raw.category),
    refs: deviceUrl ? { deviceId: idFromUrl(deviceUrl) } : {},
  };
}

/** `{has_unread}` or a bare bool; anything else counts as nothing unread. */
export function mapHasUnread(raw: RawHasUnread | null | undefined): boolean {
  if (typeof raw === "boolean") return raw;
  return raw?.has_unread === true;
}

/** eero Plus switches (out of scope, see AGENTS.md). */
const PLUS_KEY = /^(premium|backup)\./;

/** The switch map with only boolean values and no eero Plus keys. Keys stay as sent (`device.new`). */
export function mapNotificationSettings(raw: RawNotificationSettings | null | undefined): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw)) if (typeof v === "boolean" && !PLUS_KEY.test(k)) out[k] = v;
  return out;
}
