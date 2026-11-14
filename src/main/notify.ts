/**
 * Desktop alerts (docs/architecture/engine.md#desktop-notifications), main
 * side: `mesh:notify` from the app's own pages shows one OS notification;
 * clicking it focuses the window and sends the alert's target back on
 * `mesh:notify-click`. No Electron values are imported here, so tests drive
 * it with a fake host; src/main/index.ts provides Electron `Notification`.
 *
 * Alerts carry eero text (device and eero names), so nothing here logs.
 */

import { type DesktopAlert, IPC } from "../shared/types";
import type { IpcMainLike, SenderEvent } from "./ipc";

export const ALERT_MAX_TITLE = 120;
export const ALERT_MAX_BODY = 300;

/** An app hash path such as "/devices/0a1b2c3d4e5f". Anything else is refused. */
const TARGET = /^\/[A-Za-z0-9/_.-]{0,200}$/;

/** What the host provides: show one notification and call `onClick` when it is clicked. */
export type NotifyHost = {
  show(alert: { title: string; body: string }, onClick: () => void): void;
  /** Focuses (and if needed restores) the main window, then opens `target` in it. */
  open(target: string): void;
};

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** Checks an alert from the renderer: short plain strings and an app path. null when refused. */
export function checkAlert(v: unknown): DesktopAlert | null {
  if (!v || typeof v !== "object") return null;
  const { title, body, target } = v as Record<string, unknown>;
  if (typeof title !== "string" || typeof body !== "string" || typeof target !== "string") return null;
  const t = title.trim();
  if (!t || !TARGET.test(target) || target.includes("..")) return null;
  return { title: clip(t, ALERT_MAX_TITLE), body: clip(body.trim(), ALERT_MAX_BODY), target };
}

/** Wires `mesh:notify`. `trusted` says whether the sender is one of the app's pages. Returns an unregister. */
export function registerNotify(ipcMain: IpcMainLike, trusted: (e: SenderEvent) => boolean, host: NotifyHost): () => void {
  ipcMain.on(IPC.notify, (e, payload) => {
    if (!trusted(e)) return;
    const alert = checkAlert(payload);
    if (!alert) return;
    try {
      host.show({ title: alert.title, body: alert.body }, () => host.open(alert.target));
    } catch {
      // No notification service (some Linux desktops): drop it quietly.
    }
  });
  return () => ipcMain.removeAllListeners(IPC.notify);
}
